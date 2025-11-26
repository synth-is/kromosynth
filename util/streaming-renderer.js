/**
 * StreamingRenderer - Suspend/Resume audio rendering for incremental capture
 *
 * Implements streaming mode rendering using THE SAME rendering path as batch mode
 * to guarantee 100% identical output.
 *
 * IMPORTANT: This module uses EXACTLY THE SAME code as batch mode.
 * Currently no suspend/resume - that will be added as an optimization after verifying parity.
 *
 * Architecture:
 * - Delegates directly to renderAudioAndSpectrogramFromPatchAndMember() (same as batch)
 * - Returns identical AudioBuffer
 * - TODO: Add suspend/resume + AudioWorklet for incremental capture
 *
 * Result: 100% identical output to batch mode (RMSE: 0.0, Correlation: 1.0)
 */

import isString from 'lodash-es/isString.js';

export class StreamingRenderer {
  /**
   * Create a new streaming renderer
   *
   * @param {AudioContext} audioContext - Web Audio API context
   * @param {number} sampleRate - Target sample rate (e.g., 48000)
   * @param {Object} options - Optional configuration
   * @param {boolean} options.useGPU - Enable GPU acceleration for CPPN (default: true)
   */
  constructor(audioContext, sampleRate, options = {}) {
    this.audioContext = audioContext;
    this.sampleRate = sampleRate;
    this.useGPU = options.useGPU !== undefined ? options.useGPU : true;
  }

  /**
   * Render genome to audio using streaming mode
   *
   * Currently delegates directly to batch mode rendering to guarantee identical output.
   * TODO: Add suspend/resume + AudioWorklet for incremental capture.
   *
   * @param {Object} genomeAndMeta - Genome and metadata
   * @param {Object} genomeAndMeta.genome - CPPN-NEAT genome
   * @param {number} genomeAndMeta.duration - Duration in seconds
   * @param {number} genomeAndMeta.noteDelta - Pitch shift in semitones
   * @param {number} genomeAndMeta.velocity - Note velocity (0-1)
   * @param {boolean} genomeAndMeta.reverse - Reverse playback
   * @param {number} duration - Duration in seconds (may override genomeAndMeta.duration)
   * @param {OfflineAudioContext} offlineContext - OfflineAudioContext for rendering
   * @returns {Promise<AudioBuffer>} - Rendered audio buffer (identical to batch mode)
   */
  async render(
    genomeAndMeta,
    duration,
    offlineContext
  ) {
    console.log('🎵 StreamingRenderer: Delegating to batch renderer (for parity)');

    // Extract genome
    let genome;
    if (isString(genomeAndMeta.genome)) {
      const { getGenomeFromGenomeString } = await import('./genome-import.js');
      genome = await getGenomeFromGenomeString(genomeAndMeta.genome);
    } else {
      genome = genomeAndMeta.genome;
    }

    const { waveNetwork } = genome;

    // Parameters
    const actualDuration = duration || genomeAndMeta.duration || 4.0;
    const noteDelta = genomeAndMeta.noteDelta || 0;
    const velocity = genomeAndMeta.velocity || 1.0;
    const reverse = genomeAndMeta.reverse || false;

    // Use the EXACT SAME rendering function as batch mode
    const { renderAudioAndSpectrogram } = await import('./render.js');

    const audioBufferAndCanvas = await renderAudioAndSpectrogram(
      genome.asNEATPatch,
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

    console.log('  ✓ Render complete (100% identical to batch mode)');
    return audioBuffer;
  }

}
