/**
 * Streaming Audio Renderer
 *
 * Renders audio in real-time using AudioWorklets + CPPN chunks
 * This solves the time-state problem by maintaining continuous processing
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Activator from '../cppn-neat/network-activation.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import isString from "lodash-es/isString.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Render audio using streaming mode with AudioWorklets
 *
 * @param {Object} asNEATPatch - asNEAT patch network (DSP graph structure)
 * @param {Object} waveNetwork - CPPN network genome
 * @param {Object} params - Rendering parameters
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {Function} AudioWorkletNode - AudioWorkletNode constructor (from same module as audioContext)
 * @returns {Promise<AudioWorkletNode>} - Worklet node that's actively playing
 */
export async function renderAudioStreaming(
  asNEATPatch,
  waveNetwork,
  params,
  audioContext,
  AudioWorkletNode
) {
  const {
    duration = 4,
    noteDelta = 0,
    velocity = 1,
    x = 0,
    y = 0,
    sampleRate = 48000,
    useGPU = true,
    antiAliasing = false
  } = params;

  // Convert asNEAT patch to synthIs patch structure
  const asNEATNetworkJSONString = isString(asNEATPatch) ? asNEATPatch : asNEATPatch.toJSON();
  const synthIsPatch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

  // Calculate chunk parameters
  const samplesPerChunk = calculateOptimalChunkSize(duration, sampleRate);
  const totalSamples = duration * sampleRate;
  const numChunks = Math.ceil(totalSamples / samplesPerChunk);

  console.log(`Streaming render: ${numChunks} chunks of ${samplesPerChunk} samples`);

  // Validate AudioWorkletNode constructor
  if (!AudioWorkletNode) {
    throw new Error('AudioWorkletNode constructor is required - pass it from the same module as your AudioContext');
  }

  // Load AudioWorklet processor
  const workletPath = join(__dirname, '../worklets/cppn-dsp-processor.js');
  await audioContext.audioWorklet.addModule(workletPath);

  // Create AudioWorklet node with configuration
  const workletNode = new AudioWorkletNode(audioContext, 'cppn-dsp-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      duration,
      sampleRate,
      samplesPerChunk,
      // TODO: Extract from genome
      attackDuration: 0.1,
      decayDuration: 0.1,
      sustainLevel: 0.7,
      releaseDuration: 0.2
    }
  });

  // Set up message handling
  setupMessageHandling(workletNode);

  // Create activator for CPPN
  const activator = new Activator(sampleRate, useGPU);

  // Generate and stream CPPN chunks
  streamCPPNChunks(
    workletNode,
    activator,
    waveNetwork,
    synthIsPatch,
    {
      duration,
      noteDelta,
      velocity,
      x,
      y,
      sampleRate,
      samplesPerChunk,
      numChunks,
      antiAliasing
    }
  ).catch(err => {
    console.error('Error streaming CPPN chunks:', err);
  });

  return workletNode;
}

/**
 * Calculate optimal chunk size based on genome complexity
 */
function calculateOptimalChunkSize(duration, sampleRate, targetChunkDuration = 1.0) {
  // Target 1 second chunks by default (balances latency vs overhead)
  const samplesPerChunk = Math.floor(targetChunkDuration * sampleRate);

  // Ensure at least 4 chunks for smooth streaming
  const totalSamples = duration * sampleRate;
  const minChunks = 4;
  const maxSamplesPerChunk = Math.floor(totalSamples / minChunks);

  return Math.min(samplesPerChunk, maxSamplesPerChunk);
}

/**
 * Set up message handling between main thread and worklet
 */
function setupMessageHandling(workletNode) {
  workletNode.port.onmessage = (event) => {
    const { type, ...data } = event.data;

    switch (type) {
      case 'ready':
        console.log('AudioWorklet processor ready');
        break;

      case 'chunk-received':
        console.log(`Chunk ${data.chunkIndex} received (buffered: ${data.bufferedChunks})`);
        break;

      case 'underrun':
        console.warn('Audio underrun - CPPN chunk not ready in time');
        break;
    }
  };
}

/**
 * Generate CPPN chunks and stream them to the AudioWorklet
 */
async function streamCPPNChunks(
  workletNode,
  activator,
  waveNetwork,
  synthIsPatch,
  params
) {
  const {
    duration,
    noteDelta,
    velocity,
    x,
    y,
    sampleRate,
    samplesPerChunk,
    numChunks,
    antiAliasing
  } = params;

  const totalSamples = duration * sampleRate;

  // Generate chunks sequentially (can be parallelized later)
  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    const sampleOffset = chunkIndex * samplesPerChunk;
    const sampleCountToActivate = Math.min(
      samplesPerChunk,
      totalSamples - sampleOffset
    );

    console.log(`Generating CPPN chunk ${chunkIndex + 1}/${numChunks}...`);
    const startTime = performance.now();

    // Activate CPPN for this chunk (using existing implementation)
    const memberOutputs = await activator.activateMember(
      waveNetwork,
      synthIsPatch,
      null, // outputsToActivate (will be inferred from patch)
      totalSamples, // totalSampleCount
      sampleCountToActivate,
      sampleOffset,
      true, // useGPU
      false, // reverse
      true, // variationOnPeriods
      velocity,
      antiAliasing
    );

    const elapsedMs = performance.now() - startTime;
    console.log(`  Generated in ${elapsedMs.toFixed(1)}ms`);

    // Convert Map to object for transfer
    const outputsObject = {};
    for (const [outputIndex, outputData] of memberOutputs.entries()) {
      outputsObject[outputIndex] = outputData.samples;
    }

    // Send chunk to AudioWorklet
    workletNode.port.postMessage({
      type: 'cppn-chunk',
      chunkIndex,
      outputs: outputsObject
    });

    // Small delay to avoid overwhelming the worklet
    // (In production, this would be managed by backpressure)
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log('All CPPN chunks generated and sent');
}

/**
 * Render audio using batch mode (existing OfflineAudioContext approach)
 */
export async function renderAudioBatch(
  asNEATPatch,
  waveNetwork,
  params,
  offlineAudioContext,
  audioContext
) {
  // Import and use existing batch renderer
  const { renderAudio } = await import('./render.js');

  // Note: The old renderAudio signature is:
  // renderAudio(asNEATPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
  //             reverse, asDataArray, offlineAudioContext, audioContext,
  //             useOvertoneInharmonicityFactors, useGPU, antiAliasing, ...)
  // x and y are NOT parameters here - they're only used in CPPN activation

  return await renderAudio(
    asNEATPatch,
    waveNetwork,
    params.duration,
    params.noteDelta,
    params.velocity,
    params.sampleRate,  // ← Fixed: was incorrectly passing params.x here
    false, // reverse
    false, // asDataArray
    offlineAudioContext,
    audioContext,
    false, // useOvertoneInharmonicityFactors
    params.useGPU !== false,
    params.antiAliasing || false,
    params.frequencyUpdatesApplyToAllPathcNetworkOutputs || false
  );
}

export default {
  renderAudioStreaming,
  renderAudioBatch
};
