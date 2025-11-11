/**
 * CPPN Output Buffer Processor
 *
 * Architecture:
 * 1. Main thread activates CPPN in chunks using GPU.js
 * 2. Transfers chunks to this AudioWorklet via MessagePort
 * 3. This processor buffers chunks and outputs CPPN values sample-by-sample
 * 4. Outputs are multi-channel audio-rate signals (one channel per CPPN output)
 * 5. Main thread connects these outputs to virtual-audio-graph for DSP processing
 *
 * This solves the time-state problem by providing continuous CPPN signals
 * without needing to reimplement DSP in the AudioWorklet.
 */

class CPPNOutputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const config = options.processorOptions || {};

    // Configuration
    this.numberOfOutputs = config.numberOfOutputs || 18; // One per CPPN output
    this.samplesPerChunk = config.samplesPerChunk || 48000;
    this.totalDuration = config.duration || 4;
    this.sampleRate = config.sampleRate || 48000;
    this.totalSamples = this.totalDuration * this.sampleRate;

    // CPPN chunk storage
    // Map: chunkIndex → { outputs: { "0": Float32Array, "1": Float32Array, ... } }
    this.cppnChunks = new Map();

    // Playback position tracking
    this.currentChunkIndex = 0;
    this.currentSampleInChunk = 0;
    this.totalSamplesProcessed = 0;

    // Buffering state
    this.isBuffering = true;
    this.minBufferedChunks = 2; // Minimum chunks to buffer before starting

    // Debug state
    this.hasLoggedFirstOutput = false;

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
        const { chunkIndex, outputs } = message;

        // Store the chunk
        this.cppnChunks.set(chunkIndex, { outputs });

        // Check if we can start playback
        if (this.isBuffering && this.cppnChunks.size >= this.minBufferedChunks) {
          this.isBuffering = false;
          this.port.postMessage({ type: 'playback-started' });
        }

        // Notify main thread
        this.port.postMessage({
          type: 'chunk-received',
          chunkIndex,
          bufferedChunks: this.cppnChunks.size
        });
        break;

      case 'reset':
        this.resetState();
        break;
    }
  }

  resetState() {
    this.cppnChunks.clear();
    this.currentChunkIndex = 0;
    this.currentSampleInChunk = 0;
    this.totalSamplesProcessed = 0;
    this.isBuffering = true;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];

    // Output is configured as multi-channel:
    // output[0] = CPPN output 0
    // output[1] = CPPN output 1
    // ... etc
    const channelCount = output.length;

    // Debug: Log first process call
    if (this.totalSamplesProcessed === 0) {
      this.port.postMessage({
        type: 'debug',
        message: `First process() call: channelCount=${channelCount}, buffering=${this.isBuffering}, chunks=${this.cppnChunks.size}`
      });
    }

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

      // If still buffering, output silence (but DON'T increment counters)
      if (this.isBuffering) {
        for (let channel = 0; channel < channelCount; channel++) {
          output[channel][i] = 0;
        }
        // Don't increment totalSamplesProcessed - time "pauses" during buffering
        continue;
      }

      // Get CPPN values for current sample
      const cppnValues = this.getCPPNValuesAtCurrentSample();

      if (!cppnValues) {
        // Chunk not available - underrun
        this.port.postMessage({ type: 'underrun', sample: this.totalSamplesProcessed });

        for (let channel = 0; channel < channelCount; channel++) {
          output[channel][i] = 0;
        }
      } else {
        // Output each CPPN value to its corresponding channel
        for (let channel = 0; channel < channelCount; channel++) {
          const cppnOutputIndex = channel.toString();
          output[channel][i] = cppnValues[cppnOutputIndex] || 0;
        }

        // Debug: Log first actual output samples (after buffering stops)
        if (!this.hasLoggedFirstOutput) {
          this.port.postMessage({
            type: 'debug',
            message: `First real output! Sample ${this.totalSamplesProcessed}: output[0]=${(cppnValues['0'] || 0).toFixed(4)}, keys=${Object.keys(cppnValues).slice(0, 3).join(',')}`
          });
          this.hasLoggedFirstOutput = true;
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

          // Notify main thread so it can generate more chunks
          this.port.postMessage({
            type: 'chunk-consumed',
            chunkIndex: chunkToDelete
          });
        }

        // Check buffer level and request more chunks if needed
        const bufferedChunksAhead = this.cppnChunks.size - 1; // -1 for current chunk
        if (bufferedChunksAhead < this.minBufferedChunks) {
          this.port.postMessage({
            type: 'buffer-low',
            bufferedChunks: bufferedChunksAhead,
            currentChunk: this.currentChunkIndex
          });
        }
      }
    }

    return true; // Keep processing
  }

  getCPPNValuesAtCurrentSample() {
    const chunk = this.cppnChunks.get(this.currentChunkIndex);
    if (!chunk) {
      return null; // Chunk not yet available
    }

    // Extract values from all CPPN outputs at this sample position
    const values = {};
    for (const [outputIndex, samples] of Object.entries(chunk.outputs)) {
      values[outputIndex] = samples[this.currentSampleInChunk];
    }

    return values;
  }
}

// Register the processor
registerProcessor('cppn-output-processor', CPPNOutputProcessor);
