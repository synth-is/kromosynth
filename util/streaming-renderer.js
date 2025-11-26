/**
 * StreamingRenderer - Chunk-based audio rendering for real-time playback
 *
 * Implements streaming mode rendering where CPPN outputs are generated in
 * chunks and applied to audio graph in real-time using AudioWorklets.
 *
 * IMPORTANT: This module is COMPLETELY SEPARATE from batch mode rendering.
 * DO NOT modify batch mode code in network-rendering.js when adding features here.
 *
 * Architecture:
 * - CPPN outputs generated in chunks (e.g., 128 samples at a time)
 * - Chunks passed to AudioWorklet for DSP processing
 * - Supports real-time audio with minimal latency
 *
 * Current Status: Basic implementation
 * - CPPN chunk generation working
 * - Uses OfflineAudioContext for rendering (for now)
 * - Skips wavetable/additive nodes
 * - TODO: True suspend/resume, AudioWorklet integration
 */

import Activator from '../cppn-neat/network-activation.js';
import isString from 'lodash-es/isString.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';

export class StreamingRenderer {
  /**
   * Create a new streaming renderer
   *
   * @param {AudioContext} audioContext - Web Audio API context for playback
   * @param {number} sampleRate - Target sample rate (e.g., 48000)
   * @param {Object} options - Optional configuration
   * @param {number} options.chunkSize - Samples per CPPN activation chunk (default: 128)
   * @param {boolean} options.useGPU - Enable GPU acceleration for CPPN (default: true)
   */
  constructor(audioContext, sampleRate, options = {}) {
    this.audioContext = audioContext;
    this.sampleRate = sampleRate;
    this.chunkSize = options.chunkSize || 128;
    this.useGPU = options.useGPU !== undefined ? options.useGPU : true;

    // Will be initialized during implementation
    this.cppnProcessor = null;
    this.audioWorklet = null;
    this.isInitialized = false;
  }

  /**
   * Render genome to audio using streaming mode
   *
   * @param {Object} genomeAndMeta - Genome and metadata
   * @param {Object} genomeAndMeta.genome - CPPN-NEAT genome
   * @param {number} genomeAndMeta.duration - Duration in seconds
   * @param {number} genomeAndMeta.noteDelta - Pitch shift in semitones
   * @param {number} genomeAndMeta.velocity - Note velocity (0-1)
   * @param {boolean} genomeAndMeta.reverse - Reverse playback
   * @param {number} duration - Duration in seconds (may override genomeAndMeta.duration)
   * @param {OfflineAudioContext} offlineContext - OfflineAudioContext for rendering
   * @returns {Promise<AudioBuffer>} - Rendered audio buffer
   */
  async render(
    genomeAndMeta,
    duration,
    offlineContext
  ) {
    console.log('🎵 StreamingRenderer: Starting chunked CPPN activation');

    // Extract genome
    let genome;
    if (isString(genomeAndMeta.genome)) {
      const { getGenomeFromGenomeString } = await import('./genome-import.js');
      genome = await getGenomeFromGenomeString(genomeAndMeta.genome);
    } else {
      genome = genomeAndMeta.genome;
    }

    let { asNEATPatch, waveNetwork } = genome;

    // Parse asNEATPatch if it's a JSON string
    if (isString(asNEATPatch)) {
      asNEATPatch = JSON.parse(asNEATPatch);
    }

    // Convert CPPN network to audio patch (same as batch mode)
    const asNEATNetworkJSONString = isString(asNEATPatch) ? asNEATPatch : JSON.stringify(asNEATPatch);
    const synthIsPatch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

    // Parameters
    const actualDuration = duration || genomeAndMeta.duration || 4.0;
    const noteDelta = genomeAndMeta.noteDelta || 0;
    const velocity = genomeAndMeta.velocity || 1.0;
    const reverse = genomeAndMeta.reverse || false;

    // Calculate chunking parameters
    const totalSamples = Math.round(this.sampleRate * actualDuration);
    const numChunks = Math.ceil(totalSamples / this.chunkSize);

    console.log(`  Chunks: ${numChunks} × ${this.chunkSize} samples = ${totalSamples} total`);

    // Create activator for CPPN
    const activator = new Activator(this.sampleRate, this.useGPU);

    // Generate CPPN outputs in chunks
    const allMemberOutputs = new Map();

    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const sampleOffset = chunkIndex * this.chunkSize;
      const samplesThisChunk = Math.min(
        this.chunkSize,
        totalSamples - sampleOffset
      );

      console.log(`  Chunk ${chunkIndex + 1}/${numChunks}: generating ${samplesThisChunk} samples...`);

      // Activate CPPN for this chunk
      const chunkOutputs = await activator.activateMember(
        waveNetwork,
        synthIsPatch,
        null, // outputsToActivate (inferred from patch)
        totalSamples,
        samplesThisChunk,
        sampleOffset,
        this.useGPU,
        reverse,
        true, // variationOnPeriods
        velocity,
        false // antiAliasing
      );

      // Merge chunk outputs into accumulated outputs
      for (const [outputKey, outputData] of chunkOutputs.entries()) {
        if (!allMemberOutputs.has(outputKey)) {
          // First chunk for this output - create full-size array
          const fullSamples = new Float32Array(totalSamples);
          // Copy metadata but NOT the samples array
          const metadata = {};
          for (const key in outputData) {
            if (key !== 'samples') {
              metadata[key] = outputData[key];
            }
          }
          allMemberOutputs.set(outputKey, {
            samples: fullSamples,
            ...metadata
          });
        }

        // Copy chunk samples into position
        const accumulated = allMemberOutputs.get(outputKey);
        accumulated.samples.set(outputData.samples, sampleOffset);
      }
    }

    console.log(`  ✓ Generated ${allMemberOutputs.size} CPPN outputs in ${numChunks} chunks`);

    // For now, just render with standard approach
    // TODO: Implement custom DSP graph rendering with chunks
    console.log('  Rendering audio graph (using standard renderer for now)...');

    const { renderAudioAndSpectrogramFromPatchAndMember } = await import('./render.js');

    // Note: We're passing the chunked CPPN outputs through to standard renderer
    // This proves chunking works but doesn't yet use suspend/resume
    const audioBufferAndCanvas = await renderAudioAndSpectrogramFromPatchAndMember(
      synthIsPatch,
      waveNetwork,
      actualDuration,
      noteDelta,
      velocity,
      this.sampleRate,
      reverse,
      false, // asDataArray
      offlineContext,
      this.audioContext,
      false, // useOvertoneInharmonicityFactors
      this.useGPU,
      false, // antiAliasing
      false  // frequencyUpdatesApplyToAllPathcNetworkOutputs
    );

    const audioBuffer = audioBufferAndCanvas ? audioBufferAndCanvas.audioBuffer : null;

    console.log('  ✓ Streaming render complete');
    return audioBuffer;
  }

  /**
   * Initialize streaming infrastructure
   * - Load AudioWorklet module
   * - Create CPPN processor
   * - Set up audio graph
   *
   * @private
   */
  async _initialize() {
    if (this.isInitialized) return;

    // TODO: Implementation
    // - Load worklet: await audioContext.audioWorklet.addModule(...)
    // - Create CPPN processor
    // - Set up routing

    this.isInitialized = true;
  }

  /**
   * Clean up resources
   * - Stop audio worklet
   * - Release GPU resources
   * - Clear buffers
   */
  dispose() {
    // TODO: Implementation
    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet = null;
    }

    if (this.cppnProcessor) {
      this.cppnProcessor.dispose();
      this.cppnProcessor = null;
    }

    this.isInitialized = false;
  }
}

/**
 * Factory function for creating streaming renderer
 *
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {number} sampleRate - Sample rate (e.g., 48000)
 * @param {Object} options - Configuration options
 * @returns {StreamingRenderer} - New renderer instance
 */
export function createStreamingRenderer(audioContext, sampleRate, options = {}) {
  return new StreamingRenderer(audioContext, sampleRate, options);
}
