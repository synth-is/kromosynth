/**
 * StreamingDSPProcessor - Custom DSP for streaming mode wavetable/additive nodes
 *
 * COMPLETELY SEPARATE from batch mode rendering (network-rendering.js).
 * Takes accumulated CPPN chunk outputs and creates audio buffers for
 * wavetable and additive synthesis nodes.
 *
 * Architecture:
 * 1. Receives: Full CPPN outputs (accumulated from chunks)
 * 2. Identifies: Wavetable and additive nodes in patch
 * 3. Creates: Custom AudioBuffers for these nodes
 * 4. Builds: Audio graph with custom buffers
 * 5. Renders: Final audio using OfflineAudioContext
 *
 * IMPORTANT: Does NOT share code with batch mode wavetable/additive logic.
 */

export class StreamingDSPProcessor {
  /**
   * Create a new streaming DSP processor
   *
   * @param {Object} patch - Audio patch (from patchFromAsNEATnetwork)
   * @param {Map} cppnOutputs - Map of accumulated CPPN outputs (outputKey → {samples, ...})
   * @param {number} sampleRate - Sample rate (e.g., 48000)
   * @param {number} duration - Duration in seconds
   */
  constructor(patch, cppnOutputs, sampleRate, duration) {
    this.patch = patch;
    this.cppnOutputs = cppnOutputs;
    this.sampleRate = sampleRate;
    this.duration = duration;
    this.totalSamples = Math.round(sampleRate * duration);
  }

  /**
   * Identify nodes by type in the audio graph
   *
   * @param {string} nodeType - 'wavetable' or 'additive'
   * @returns {Array<string>} - Array of node keys
   */
  identifyNodesByType(nodeType) {
    const nodes = [];

    if (!this.patch.audioGraph) {
      return nodes;
    }

    // Check each node in the audioGraph
    for (const [nodeKey, nodeData] of Object.entries(this.patch.audioGraph)) {
      const type = nodeData[0]; // First element is node type
      if (type === nodeType) {
        nodes.push(nodeKey);
      }
    }

    return nodes;
  }

  /**
   * Create wavetable buffer from CPPN outputs
   *
   * Wavetable synthesis:
   * - Multiple CPPN outputs provide audio waveforms
   * - One CPPN output provides mix control (how to blend waves)
   * - Result: Single AudioBuffer with blended waveform
   *
   * @param {string} nodeKey - Audio graph node key
   * @returns {AudioBuffer|null} - Created wavetable buffer
   */
  createWavetableBuffer(nodeKey) {
    console.log(`  Creating wavetable buffer for node: ${nodeKey}`);

    // Wavetable nodes synthesize from ALL buffer-targeted CPPN outputs in the patch
    // (not just connections to this specific node)
    const audioWaves = []; // CPPN outputs for buffer parameter
    let mixWave = null;     // CPPN output for mix parameter

    for (const networkOutput of this.patch.networkOutputs) {
      // Check ALL audio graph nodes for buffer/mix parameters
      for (const [graphNodeKey, connections] of Object.entries(networkOutput.audioGraphNodes)) {
        for (const connection of connections) {
          const outputKey = this.getCPPNOutputKey(networkOutput.networkOutput, networkOutput.frequency);

          if (connection.paramName === 'buffer') {
            // This CPPN output provides audio content
            const cppnOutput = this.cppnOutputs.get(outputKey);
            if (cppnOutput) {
              audioWaves.push({
                samples: cppnOutput.samples,
                weight: connection.weight || 1.0,
                outputKey,
                targetNode: graphNodeKey
              });
            }
          } else if (connection.paramName === 'mix') {
            // This CPPN output controls blending
            const cppnOutput = this.cppnOutputs.get(outputKey);
            if (cppnOutput) {
              mixWave = cppnOutput.samples;
            }
          }
        }
      }
    }

    if (audioWaves.length === 0) {
      console.warn(`    No audio waves found for wavetable ${nodeKey}`);
      return null;
    }

    console.log(`    Found ${audioWaves.length} audio waves`);
    console.log(`    Mix control: ${mixWave ? 'yes' : 'no'}`);

    // Step 2: Blend audio waves using mix control
    const blendedSamples = this.blendWavetableWaves(audioWaves, mixWave);

    // Step 3: Create AudioBuffer (Note: will be used later in graph building)
    // For now, just store the samples - we'll create actual AudioBuffer in buildAudioGraph
    return {
      samples: blendedSamples,
      nodeKey
    };
  }

  /**
   * Get CPPN output key from network output index and frequency
   */
  getCPPNOutputKey(networkOutput, frequency) {
    if (networkOutput === 'noiseWhite' || networkOutput === 'noiseBrown' || networkOutput === 'noisePink') {
      return `${networkOutput}_${frequency}`;
    }
    return `${networkOutput}_${frequency}`;
  }

  /**
   * Blend multiple audio waves using mix control
   *
   * @param {Array} audioWaves - Array of {samples, weight} objects
   * @param {Float32Array|null} mixWave - Mix control samples (0-1)
   * @returns {Float32Array} - Blended samples
   */
  blendWavetableWaves(audioWaves, mixWave) {
    const totalSamples = this.totalSamples;
    const blended = new Float32Array(totalSamples);

    if (audioWaves.length === 1) {
      // Single wave - no blending needed
      return audioWaves[0].samples;
    }

    if (!mixWave) {
      // No mix control - use equal weighted average
      console.log(`    Using equal weighted blend (${audioWaves.length} waves)`);
      for (let i = 0; i < totalSamples; i++) {
        let sum = 0;
        for (const wave of audioWaves) {
          sum += wave.samples[i] * wave.weight;
        }
        blended[i] = sum / audioWaves.length;
      }
    } else {
      // Use mix control to blend between waves
      console.log(`    Using mix-controlled blend (${audioWaves.length} waves)`);
      for (let i = 0; i < totalSamples; i++) {
        const mixValue = mixWave[i]; // 0-1 value

        // Simple linear interpolation between waves based on mix value
        // TODO: More sophisticated blending if needed
        const waveIndex = Math.floor(mixValue * (audioWaves.length - 1));
        const nextIndex = Math.min(waveIndex + 1, audioWaves.length - 1);
        const fraction = (mixValue * (audioWaves.length - 1)) - waveIndex;

        const sample1 = audioWaves[waveIndex].samples[i] * audioWaves[waveIndex].weight;
        const sample2 = audioWaves[nextIndex].samples[i] * audioWaves[nextIndex].weight;

        blended[i] = sample1 * (1 - fraction) + sample2 * fraction;
      }
    }

    return blended;
  }

  /**
   * Create additive synthesis buffer from CPPN outputs
   *
   * Additive synthesis:
   * - CPPN outputs provide partial buffers (harmonic content)
   * - CPPN outputs provide gain envelopes (per-harmonic amplitude over time)
   * - Result: Single AudioBuffer with summed harmonics
   *
   * @param {string} nodeKey - Audio graph node key
   * @returns {AudioBuffer|null} - Created additive buffer
   */
  createAdditiveBuffer(nodeKey) {
    console.log(`  Creating additive buffer for node: ${nodeKey}`);

    // TODO: Implementation
    // 1. Find CPPN outputs for partialBuffer parameter
    // 2. Find CPPN outputs for partialGainEnvelope parameter
    // 3. Apply gain envelopes to harmonics
    // 4. Sum all partials
    // 5. Create AudioBuffer with result

    return null;
  }

  /**
   * Build audio graph with custom buffers for wavetable/additive nodes
   *
   * @param {OfflineAudioContext} offlineContext - Rendering context
   * @returns {Object} - Virtual-audio-graph compatible graph definition
   */
  buildAudioGraph(offlineContext) {
    console.log('  Building audio graph with custom DSP nodes...');

    // TODO: Implementation
    // 1. Start with base graph from patch
    // 2. Replace wavetable nodes with custom buffers
    // 3. Replace additive nodes with custom buffers
    // 4. Return modified graph

    return null;
  }

  /**
   * Render audio with custom DSP processing
   *
   * @param {OfflineAudioContext} offlineContext - Rendering context
   * @returns {Promise<AudioBuffer>} - Rendered audio
   */
  async renderToBuffer(offlineContext) {
    console.log('🎛️  StreamingDSPProcessor: Rendering with custom DSP');

    // Identify special nodes
    const wavetableNodes = this.identifyNodesByType('wavetable');
    const additiveNodes = this.identifyNodesByType('additive');

    console.log(`  Found ${wavetableNodes.length} wavetable nodes`);
    console.log(`  Found ${additiveNodes.length} additive nodes`);

    // Create custom buffers for each special node
    const wavetableBuffers = new Map();
    for (const nodeKey of wavetableNodes) {
      const buffer = this.createWavetableBuffer(nodeKey);
      if (buffer) {
        wavetableBuffers.set(nodeKey, buffer);
        console.log(`  ✓ Created wavetable buffer for ${nodeKey}`);
      } else {
        console.warn(`  ✗ Failed to create wavetable buffer for ${nodeKey}`);
      }
    }

    const additiveBuffers = new Map();
    for (const nodeKey of additiveNodes) {
      const buffer = this.createAdditiveBuffer(nodeKey);
      if (buffer) {
        additiveBuffers.set(nodeKey, buffer);
        console.log(`  ✓ Created additive buffer for ${nodeKey}`);
      } else {
        console.warn(`  ✗ Failed to create additive buffer for ${nodeKey}`);
      }
    }

    // For now: Simple implementation - just return first wavetable buffer
    // TODO: Full audio graph integration
    if (wavetableBuffers.size > 0) {
      const firstBuffer = wavetableBuffers.values().next().value;
      console.log(`  Using simplified rendering (first wavetable only)`);

      // Create AudioBuffer from samples
      const audioBuffer = offlineContext.createBuffer(
        1, // mono
        this.totalSamples,
        this.sampleRate
      );

      const channelData = audioBuffer.getChannelData(0);
      channelData.set(firstBuffer.samples);

      console.log(`  ✓ Custom DSP render complete`);
      return audioBuffer;
    }

    if (additiveBuffers.size > 0) {
      const firstBuffer = additiveBuffers.values().next().value;
      console.log(`  Using simplified rendering (first additive only)`);

      const audioBuffer = offlineContext.createBuffer(
        1,
        this.totalSamples,
        this.sampleRate
      );

      const channelData = audioBuffer.getChannelData(0);
      channelData.set(firstBuffer.samples);

      console.log(`  ✓ Custom DSP render complete`);
      return audioBuffer;
    }

    throw new Error('No wavetable or additive buffers created');
  }

  /**
   * Check if patch contains wavetable or additive nodes
   *
   * @param {Object} patch - Audio patch
   * @returns {boolean} - True if special DSP nodes present
   */
  static hasCustomDSPNodes(patch) {
    if (!patch || !patch.audioGraph) {
      return false;
    }

    // Check for wavetable or additive nodes in audioGraph
    for (const nodeData of Object.values(patch.audioGraph)) {
      const nodeType = nodeData[0];
      if (nodeType === 'wavetable' || nodeType === 'additive') {
        return true;
      }
    }

    return false;
  }
}

/**
 * Factory function for creating streaming DSP processor
 *
 * @param {Object} patch - Audio patch
 * @param {Map} cppnOutputs - Accumulated CPPN outputs
 * @param {number} sampleRate - Sample rate
 * @param {number} duration - Duration in seconds
 * @returns {StreamingDSPProcessor} - New processor instance
 */
export function createStreamingDSPProcessor(patch, cppnOutputs, sampleRate, duration) {
  return new StreamingDSPProcessor(patch, cppnOutputs, sampleRate, duration);
}
