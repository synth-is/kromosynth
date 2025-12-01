/**
 * AudioWorklet Processor for Capturing Audio During Rendering
 *
 * This processor captures audio samples as they flow through the audio graph,
 * allowing incremental capture during suspend/resume rendering.
 *
 * Used for streaming audio generation while maintaining identical output
 * to batch rendering.
 */

export const CAPTURE_PROCESSOR_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.totalCaptured = 0;
    // Increase chunk size to reduce message overhead and match server batching
    // 4096 samples is ~85ms at 48kHz, similar to ServerStreamingClient's 4800 samples
    this.chunkSize = 4096; 

    // Listen for flush commands
    this.port.onmessage = (event) => {
      if (event.data.type === 'flush') {
        this.flush();
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Guard against undefined inputs/outputs (can happen at end of rendering)
    if (!input || !output || input.length === 0 || output.length === 0) {
      // Flush any remaining buffered samples
      if (this.buffer.length > 0) {
        this.sendChunk();
      }
      // Stop processor when no more data
      return false;
    }

    // Pass through audio (copy input to output)
    for (let channel = 0; channel < Math.min(input.length, output.length); channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      // Guard against undefined channels
      if (!inputChannel || !outputChannel) {
        continue;
      }

      // Copy samples
      for (let i = 0; i < inputChannel.length; i++) {
        outputChannel[i] = inputChannel[i];
      }

      // Capture samples from first channel only
      if (channel === 0) {
        // Add to buffer
        this.buffer.push(...inputChannel);
        this.totalCaptured += inputChannel.length;

        // Send chunk when buffer reaches chunk size
        if (this.buffer.length >= this.chunkSize) {
          this.sendChunk();
        }
      }
    }

    // Keep processor alive
    return true;
  }

  sendChunk() {
    if (this.buffer.length === 0) return;

    // Convert to Float32Array and send
    const chunk = new Float32Array(this.buffer);
    this.port.postMessage({
      type: 'audioChunk',
      data: chunk,
      totalCaptured: this.totalCaptured
    });

    // Clear buffer
    this.buffer = [];
  }

  flush() {
    // Send any remaining samples
    if (this.buffer.length > 0) {
      this.sendChunk();
    }
  }
}

registerProcessor('capture-processor', CaptureProcessor);
`;
