/**
 * Configurable Audio Renderer
 *
 * Unified entry point supporting both batch and streaming modes.
 * Mode selection via configuration parameter.
 *
 * USAGE:
 * ═════════════════════════════════════════════════════════════════════════
 *
 * // Batch mode (existing approach)
 * const result = await renderAudio(genome, params, {
 *   renderMode: 'batch',
 *   offlineAudioContext,
 *   audioContext
 * });
 *
 * // Streaming mode (new hybrid approach)
 * const result = await renderAudio(genome, params, {
 *   renderMode: 'streaming',
 *   audioContext,
 *   AudioWorkletNode
 * });
 *
 * CONFIGURATION:
 * ═════════════════════════════════════════════════════════════════════════
 *
 * renderMode: 'batch' | 'streaming'
 *   - batch: Traditional OfflineAudioContext rendering (default)
 *   - streaming: Hybrid AudioWorklet + virtual-audio-graph
 *
 * chunkDuration: number (seconds, streaming mode only)
 *   - Size of CPPN chunks (default: 1.0s)
 *   - Smaller = faster initial playback, more overhead
 *   - Larger = slower initial playback, less overhead
 */

import { renderAudioBatch } from './streaming-renderer.js';
import { renderAudioStreamingHybrid } from './streaming-renderer-hybrid.js';

/**
 * Render audio with configurable mode
 *
 * @param {Object} genome - Genome containing asNEATPatch and waveNetwork
 * @param {Object} params - Rendering parameters
 * @param {Object} config - Renderer configuration
 * @returns {Promise<Object>} - Render result (structure depends on mode)
 */
export async function renderAudio(genome, params, config = {}) {
  const {
    renderMode = 'batch',
    audioContext,
    offlineAudioContext,
    AudioWorkletNode
  } = config;

  // Extract genome components
  const { asNEATPatch, waveNetwork } = genome;

  if (!asNEATPatch || !waveNetwork) {
    throw new Error('Genome must contain asNEATPatch and waveNetwork');
  }

  if (renderMode === 'streaming') {
    // Streaming mode: Hybrid AudioWorklet approach
    if (!audioContext) {
      throw new Error('audioContext is required for streaming mode');
    }
    if (!AudioWorkletNode) {
      throw new Error('AudioWorkletNode is required for streaming mode');
    }

    console.log('🎵 Rendering in STREAMING mode (hybrid AudioWorklet)');

    return await renderAudioStreamingHybrid(
      asNEATPatch,
      waveNetwork,
      params,
      audioContext,
      AudioWorkletNode
    );

  } else if (renderMode === 'batch') {
    // Batch mode: Traditional OfflineAudioContext
    if (!offlineAudioContext && !audioContext) {
      throw new Error('offlineAudioContext or audioContext is required for batch mode');
    }

    console.log('🎵 Rendering in BATCH mode (OfflineAudioContext)');

    return await renderAudioBatch(
      asNEATPatch,
      waveNetwork,
      params,
      offlineAudioContext,
      audioContext
    );

  } else {
    throw new Error(`Unknown renderMode: ${renderMode}. Use 'batch' or 'streaming'`);
  }
}

/**
 * Get default configuration for render mode
 *
 * @param {string} renderMode - 'batch' or 'streaming'
 * @returns {Object} - Default configuration
 */
export function getDefaultConfig(renderMode) {
  if (renderMode === 'streaming') {
    return {
      renderMode: 'streaming',
      chunkDuration: 1.0,  // 1-second chunks
      minBufferedChunks: 2 // Buffer 2 chunks before playback
    };
  } else {
    return {
      renderMode: 'batch'
    };
  }
}

/**
 * Validate render configuration
 *
 * @param {Object} config - Configuration to validate
 * @returns {boolean} - True if valid
 * @throws {Error} - If configuration is invalid
 */
export function validateConfig(config) {
  const { renderMode, audioContext, offlineAudioContext, AudioWorkletNode } = config;

  if (!renderMode || !['batch', 'streaming'].includes(renderMode)) {
    throw new Error('renderMode must be "batch" or "streaming"');
  }

  if (renderMode === 'streaming') {
    if (!audioContext) {
      throw new Error('audioContext is required for streaming mode');
    }
    if (!AudioWorkletNode) {
      throw new Error('AudioWorkletNode constructor is required for streaming mode');
    }
  }

  if (renderMode === 'batch') {
    if (!offlineAudioContext && !audioContext) {
      throw new Error('offlineAudioContext or audioContext is required for batch mode');
    }
  }

  return true;
}

export default {
  renderAudio,
  getDefaultConfig,
  validateConfig
};
