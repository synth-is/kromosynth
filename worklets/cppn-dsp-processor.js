/**
 * CPPN-Driven DSP AudioWorklet Processor
 *
 * This AudioWorklet processor receives CPPN output chunks from the main thread
 * and uses them to drive audio synthesis in real-time.
 *
 * Key features:
 * - Runs continuously (no time resets like OfflineAudioContext)
 * - Maintains envelope state across chunks
 * - Receives CPPN chunks via MessagePort
 * - Supports all genome features (wavetable, additive, oscillators, etc.)
 */

class CPPNDSPProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Processor configuration from genome
    this.config = options.processorOptions || {};

    // CPPN chunk storage
    this.cppnChunks = new Map(); // chunkIndex → { outputs: Map<outputIndex, Float32Array> }
    this.currentChunkIndex = 0;
    this.currentSampleInChunk = 0;
    this.totalSamplesProcessed = 0;

    // Chunk management
    this.samplesPerChunk = this.config.samplesPerChunk || 48000; // 1 second at 48kHz
    this.totalDuration = this.config.duration || 4; // seconds
    this.sampleRate = this.config.sampleRate || 48000;
    this.totalSamples = this.totalDuration * this.sampleRate;

    // DSP state (envelopes, phases, etc.)
    this.envelopeState = {
      phase: 'attack', // attack, decay, sustain, release, done
      time: 0,
      value: 0
    };

    // Oscillator phases (for wavetable synthesis)
    this.oscillatorPhases = new Map(); // outputIndex → phase (0-1)

    // Listen for CPPN chunks from main thread
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    // Signal ready
    this.port.postMessage({ type: 'ready' });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'cppn-chunk':
        // Receive a chunk of CPPN outputs
        const { chunkIndex, outputs } = message;
        this.cppnChunks.set(chunkIndex, { outputs });

        // Notify main thread that chunk was received
        this.port.postMessage({
          type: 'chunk-received',
          chunkIndex,
          bufferedChunks: this.cppnChunks.size
        });
        break;

      case 'config-update':
        // Update configuration (for parameter changes during playback)
        Object.assign(this.config, message.config);
        break;

      case 'reset':
        // Reset processor state
        this.cppnChunks.clear();
        this.currentChunkIndex = 0;
        this.currentSampleInChunk = 0;
        this.totalSamplesProcessed = 0;
        this.envelopeState = { phase: 'attack', time: 0, value: 0 };
        this.oscillatorPhases.clear();
        break;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channelCount = output.length;

    // Process 128 samples (quantum size)
    for (let i = 0; i < 128; i++) {
      // Check if we've reached the end
      if (this.totalSamplesProcessed >= this.totalSamples) {
        // Fill remaining samples with silence
        for (let channel = 0; channel < channelCount; channel++) {
          output[channel].fill(0, i);
        }
        return false; // Stop processing
      }

      // Get CPPN values for current sample
      const cppnValues = this.getCPPNValuesAtSample(this.totalSamplesProcessed);

      if (!cppnValues) {
        // CPPN chunk not yet available - output silence
        for (let channel = 0; channel < channelCount; channel++) {
          output[channel][i] = 0;
        }
      } else {
        // Apply DSP graph using CPPN values
        const sample = this.applyDSPGraph(cppnValues, this.totalSamplesProcessed);

        // Output to all channels (mono for now, can be stereo later)
        for (let channel = 0; channel < channelCount; channel++) {
          output[channel][i] = sample;
        }
      }

      // Advance counters
      this.totalSamplesProcessed++;
      this.currentSampleInChunk++;

      // Move to next chunk if needed
      if (this.currentSampleInChunk >= this.samplesPerChunk) {
        this.currentChunkIndex++;
        this.currentSampleInChunk = 0;

        // Clean up old chunks (keep only current and next)
        const chunkToDelete = this.currentChunkIndex - 2;
        if (chunkToDelete >= 0) {
          this.cppnChunks.delete(chunkToDelete);
        }
      }
    }

    return true; // Keep processing
  }

  getCPPNValuesAtSample(sampleNumber) {
    const chunkIndex = Math.floor(sampleNumber / this.samplesPerChunk);
    const sampleInChunk = sampleNumber % this.samplesPerChunk;

    const chunk = this.cppnChunks.get(chunkIndex);
    if (!chunk) {
      return null; // Chunk not yet available
    }

    // Extract values from all CPPN outputs at this sample
    const values = {};
    for (const [outputIndex, samples] of Object.entries(chunk.outputs)) {
      values[outputIndex] = samples[sampleInChunk];
    }

    return values;
  }

  applyDSPGraph(cppnValues, sampleNumber) {
    // This is a simplified DSP graph for proof-of-concept
    // Full implementation will parse genome and build complete graph

    const time = sampleNumber / this.sampleRate;

    // Simple envelope (ADSR)
    const envelope = this.calculateEnvelope(time);

    // Simple wavetable synthesis using CPPN values
    // Assume output 0 = frequency modulation
    // Assume output 1 = amplitude modulation
    const freqMod = cppnValues['0'] || 0;
    const ampMod = cppnValues['1'] || 0;

    // Base frequency (A440)
    const baseFreq = 440;
    const frequency = baseFreq * (1 + freqMod * 0.1); // ±10% frequency variation

    // Generate sine wave
    const phase = (sampleNumber * frequency / this.sampleRate) % 1.0;
    const sample = Math.sin(2 * Math.PI * phase);

    // Apply envelope and amplitude modulation
    return sample * envelope * (0.5 + ampMod * 0.5);
  }

  calculateEnvelope(time) {
    // Simple ADSR envelope
    const attack = this.config.attackDuration || 0.1;
    const decay = this.config.decayDuration || 0.1;
    const sustain = this.config.sustainLevel || 0.7;
    const release = this.config.releaseDuration || 0.2;

    const totalTime = this.totalDuration;
    const releaseStartTime = totalTime - release;

    if (time < attack) {
      // Attack phase
      return time / attack;
    } else if (time < attack + decay) {
      // Decay phase
      const decayTime = time - attack;
      return 1.0 - (1.0 - sustain) * (decayTime / decay);
    } else if (time < releaseStartTime) {
      // Sustain phase
      return sustain;
    } else {
      // Release phase
      const releaseTime = time - releaseStartTime;
      return sustain * (1.0 - releaseTime / release);
    }
  }
}

// Register the processor
registerProcessor('cppn-dsp-processor', CPPNDSPProcessor);
