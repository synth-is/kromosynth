/**
 * Hybrid Streaming Audio Renderer
 *
 * ARCHITECTURE:
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Main Thread (GPU Available):
 *   ┌─────────────────────────────────────────┐
 *   │ 1. Activate CPPN in chunks (GPU.js)     │
 *   │    - ~100ms per 1s chunk                │
 *   │    - Generate chunks ahead of playback  │
 *   └──────────────┬──────────────────────────┘
 *                  │ (MessagePort transfer)
 *                  ↓
 * AudioWorklet (Audio Thread):
 *   ┌─────────────────────────────────────────┐
 *   │ 2. Buffer CPPN chunks                   │
 *   │    - Output sample-by-sample            │
 *   │    - 18 channels (one per CPPN output)  │
 *   └──────────────┬──────────────────────────┘
 *                  │ (Multi-channel audio signals)
 *                  ↓
 * Main Thread (Web Audio API):
 *   ┌─────────────────────────────────────────┐
 *   │ 3. Process with virtual-audio-graph     │
 *   │    - Existing DSP code (no changes!)    │
 *   │    - Wavetable, additive, filters, etc. │
 *   └──────────────┬──────────────────────────┘
 *                  ↓
 *              Speakers
 *
 * BENEFITS:
 * - Continuous CPPN state (no time resets)
 * - GPU acceleration for CPPN
 * - Reuses existing virtual-audio-graph DSP
 * - Real-time parameter changes possible
 * - Progressive playback (initial buffering ~2s)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Activator from '../cppn-neat/network-activation.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import { createCPPNWrapperNodes } from './cppn-wrapper-nodes.js';
import isString from "lodash-es/isString.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Render audio using hybrid streaming mode
 *
 * Returns an AudioWorkletNode that outputs CPPN values as multi-channel audio.
 * These outputs should be connected to virtual-audio-graph for DSP processing.
 *
 * @param {Object} asNEATPatch - asNEAT patch network (DSP graph structure)
 * @param {Object} waveNetwork - CPPN network genome
 * @param {Object} params - Rendering parameters
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {Function} AudioWorkletNode - AudioWorkletNode constructor (from same module as audioContext)
 * @returns {Promise<AudioWorkletNode>} - Worklet node outputting CPPN values (18 channels)
 */
export async function renderAudioStreamingHybrid(
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
    antiAliasing = false,
    chunkDuration = 1.0 // Configurable chunk size in seconds
  } = params;

  // Convert asNEAT patch to synthIs patch structure
  const asNEATNetworkJSONString = isString(asNEATPatch) ? asNEATPatch : asNEATPatch.toJSON();
  const synthIsPatch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

  // Calculate chunk parameters
  const samplesPerChunk = Math.floor(chunkDuration * sampleRate);
  const totalSamples = duration * sampleRate;
  const numChunks = Math.ceil(totalSamples / samplesPerChunk);

  // Determine number of CPPN outputs (typically 18)
  const numberOfCPPNOutputs = waveNetwork.oneCPPNPerFrequency
    ? Object.keys(waveNetwork.CPPNs).length
    : (waveNetwork.outputNeuronCount || 18);

  console.log(`Hybrid streaming render:`);
  console.log(`  Duration: ${duration}s (${numChunks} chunks of ${chunkDuration}s)`);
  console.log(`  CPPN outputs: ${numberOfCPPNOutputs}`);
  console.log(`  Sample rate: ${sampleRate}Hz`);

  // Validate AudioWorkletNode constructor
  if (!AudioWorkletNode) {
    throw new Error('AudioWorkletNode constructor is required');
  }

  // Load CPPN output processor
  const workletPath = join(__dirname, '../worklets/cppn-output-processor.js');
  await audioContext.audioWorklet.addModule(workletPath);

  // Create AudioWorklet node with multi-channel output
  const cppnOutputNode = new AudioWorkletNode(audioContext, 'cppn-output-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [numberOfCPPNOutputs], // One channel per CPPN output
    processorOptions: {
      numberOfOutputs: numberOfCPPNOutputs,
      samplesPerChunk,
      duration,
      sampleRate
    }
  });

  // Set up message handling
  setupMessageHandling(cppnOutputNode);

  // Create activator for CPPN
  const activator = new Activator(sampleRate, useGPU);

  // Create wrapper gain nodes for CPPN outputs
  // These connect AudioWorklet channels to virtual-audio-graph
  const wrapperNodes = createCPPNWrapperNodes(
    cppnOutputNode,
    audioContext,
    numberOfCPPNOutputs
  );

  // Generate and stream CPPN chunks
  streamCPPNChunks(
    cppnOutputNode,
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

  return {
    cppnOutputNode,
    wrapperNodes,
    synthIsPatch,
    numberOfCPPNOutputs,
    activator,
    mode: 'streaming'
  };
}

/**
 * Set up message handling between main thread and worklet
 */
function setupMessageHandling(workletNode) {
  workletNode.port.onmessage = (event) => {
    const { type, ...data } = event.data;

    switch (type) {
      case 'ready':
        console.log('CPPN output processor ready');
        break;

      case 'playback-started':
        console.log('Playback started (minimum buffer reached)');
        break;

      case 'chunk-received':
        console.log(`Chunk ${data.chunkIndex} received (buffered: ${data.bufferedChunks})`);
        break;

      case 'chunk-consumed':
        console.log(`Chunk ${data.chunkIndex} consumed`);
        break;

      case 'buffer-low':
        console.warn(`Buffer low: ${data.bufferedChunks} chunks (current: ${data.currentChunk})`);
        break;

      case 'underrun':
        console.error(`Audio underrun at sample ${data.sample}`);
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

  // Generate chunks sequentially
  // TODO: Could parallelize chunk generation for better performance
  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    const sampleOffset = chunkIndex * samplesPerChunk;
    const sampleCountToActivate = Math.min(
      samplesPerChunk,
      totalSamples - sampleOffset
    );

    console.log(`Generating CPPN chunk ${chunkIndex + 1}/${numChunks}...`);
    const startTime = performance.now();

    // Activate CPPN for this chunk
    const memberOutputs = await activator.activateMember(
      waveNetwork,
      synthIsPatch,
      null, // outputsToActivate (inferred from patch)
      totalSamples,
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
    // (In production, use backpressure from 'buffer-low' messages)
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log('All CPPN chunks generated and sent');
}

/**
 * Calculate optimal chunk size based on use case
 */
function calculateOptimalChunkSize(duration, sampleRate, targetChunkDuration = 1.0) {
  const samplesPerChunk = Math.floor(targetChunkDuration * sampleRate);
  const totalSamples = duration * sampleRate;
  const minChunks = 4;
  const maxSamplesPerChunk = Math.floor(totalSamples / minChunks);

  return Math.min(samplesPerChunk, maxSamplesPerChunk);
}

export default {
  renderAudioStreamingHybrid
};
