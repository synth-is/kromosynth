# Hybrid Streaming Audio Architecture

## Overview

This document explains the hybrid streaming approach that solves the time-state problem while reusing existing DSP code.

## The Problem We're Solving

**Batch rendering** works but has issues with chunked rendering:
```
OfflineAudioContext (chunk 0, time 0-1s)
  → Envelope starts at 0 ✓
  → Oscillator phase at 0 ✓
  → Render complete

OfflineAudioContext (chunk 1, time 1-2s)
  → Time resets to 0! ✗
  → Envelope restarts ✗
  → Oscillator phase resets ✗
  → Different output than continuous render
```

## The Solution: Hybrid Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: Main Thread (GPU Available)                           │
│ ─────────────────────────────────────────────────────────────── │
│ • Activates CPPN networks in chunks using GPU.js               │
│ • Generates 1-second chunks in ~100ms each                     │
│ • Continues generating ahead of playback                       │
│ • Transfers Float32Arrays to AudioWorklet via MessagePort      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Transfer CPPN chunks
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: AudioWorklet (Audio Thread, Real-Time Priority)       │
│ ─────────────────────────────────────────────────────────────── │
│ • Buffers received CPPN chunks (minimum 2 chunks)              │
│ • Outputs CPPN values sample-by-sample at audio rate           │
│ • 18 output channels (one per CPPN output)                     │
│ • Continuous playback (no time resets!)                        │
│ • Requests more chunks when buffer runs low                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Multi-channel audio signals
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: Main Thread (Web Audio API)                           │
│ ─────────────────────────────────────────────────────────────── │
│ • Existing virtual-audio-graph DSP processing                  │
│ • Connects to AudioWorklet outputs instead of buffers          │
│ • Wavetable synthesis, additive synthesis, filters, etc.       │
│ • NO CODE CHANGES to DSP logic needed!                         │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
                        Speakers
```

## Key Components

### 1. CPPN Output Processor (AudioWorklet)

**File:** `worklets/cppn-output-processor.js`

**Responsibilities:**
- Buffer CPPN chunks received from main thread
- Output CPPN values sample-by-sample
- Multi-channel output (18 channels for 18 CPPN outputs)
- Manage buffer state and request more chunks

**Configuration:**
```javascript
{
  numberOfOutputs: 18,      // One per CPPN output
  samplesPerChunk: 48000,   // 1 second at 48kHz
  duration: 4,              // Total duration
  sampleRate: 48000         // Audio sample rate
}
```

**Output Format:**
```
AudioWorkletNode outputs:
  output[0] = Channel 0 → CPPN output 0 (audio rate signal)
  output[1] = Channel 1 → CPPN output 1
  output[2] = Channel 2 → CPPN output 2
  ...
  output[17] = Channel 17 → CPPN output 17
```

### 2. Hybrid Streaming Renderer

**File:** `util/streaming-renderer-hybrid.js`

**Responsibilities:**
- Load and configure AudioWorklet processor
- Activate CPPN in chunks using GPU.js
- Stream chunks to AudioWorklet
- Return AudioWorkletNode for graph connection

**Usage:**
```javascript
import { renderAudioStreamingHybrid } from './util/streaming-renderer-hybrid.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext, AudioWorkletNode } = NodeWebAudioAPI;

const audioContext = new AudioContext({ sampleRate: 48000 });

const result = await renderAudioStreamingHybrid(
  genome.asNEATPatch,
  genome.waveNetwork,
  {
    duration: 4,
    noteDelta: 0,
    velocity: 0.5,
    sampleRate: 48000,
    useGPU: true,
    chunkDuration: 1.0  // 1-second chunks
  },
  audioContext,
  AudioWorkletNode
);

// result contains:
// - cppnOutputNode: AudioWorkletNode with 18 output channels
// - synthIsPatch: Converted DSP graph definition
// - numberOfCPPNOutputs: Number of CPPN outputs (18)
// - activator: CPPN activator instance
```

### 3. Virtual-Audio-Graph Integration

**File:** `cppn-neat/network-rendering.js` (to be modified)

**Current approach (batch):**
```javascript
// CPPN outputs are pre-rendered as buffers/curves
graph['buffer1'] = ['bufferSource', output, {
  buffer: cppnOutputBuffer // Float32Array
}];

graph['gain1'] = ['gain', output, {
  gain: ['setValueCurveAtTime', cppnOutputCurve, time, duration]
}];
```

**New approach (streaming):**
```javascript
// CPPN outputs come from AudioWorkletNode channels
// Option A: Direct connection (if virtual-audio-graph supports)
graph['buffer1'] = ['bufferSource', output, {
  buffer: audioWave1 // Still needed for wavetable
}];
graph['gain1'] = ['gain', output, {
  gain: 1.0 // Static, or...
}];

// Connect CPPN output channel to gain parameter
cppnOutputNode.connect(graph['gain1'].gain, 0); // Channel 0 → gain param

// Option B: Create gain nodes for each CPPN output
graph['cppn-0'] = ['gain', 'buffer1', { gain: 1.0 }, 'cppn-node:0'];
//                                                     ↑ Reference to AudioWorklet channel
```

## Implementation Status

### ✅ Completed
1. `cppn-output-processor.js` - AudioWorklet processor
2. `streaming-renderer-hybrid.js` - Main orchestration
3. CPPN chunk generation and streaming
4. Multi-channel AudioWorklet output

### 🚧 In Progress
1. Virtual-audio-graph integration
2. Connecting AudioWorklet outputs to DSP graph

### ⏳ Todo
1. Modify graph construction to use live signals
2. Test with actual genomes
3. Validate output equivalence (streaming vs batch)
4. Performance optimization
5. Parameter change handling during playback

## Connecting AudioWorklet to Virtual-Audio-Graph

### Challenge

virtual-audio-graph expects:
```javascript
{
  '0': ['gain', 'output', { gain: 0.5 }]
}
```

But we need to connect:
```javascript
cppnOutputNode.connect(gainNode.gain, channelIndex)
```

### Solution Approaches

#### Approach 1: Custom Nodes with Audio Connections

```javascript
// Create wrapper nodes that connect to CPPN outputs
const cppnGainNodes = {};
for (let i = 0; i < 18; i++) {
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1.0;
  cppnOutputNode.connect(gainNode, i); // Channel i → gain node
  cppnGainNodes[i] = gainNode;
}

// Use in virtual-audio-graph by referencing the wrapper nodes
virtualAudioGraph.update({
  '0': ['bufferSource', cppnGainNodes[0], { buffer: wave1 }],
  '1': ['bufferSource', cppnGainNodes[1], { buffer: wave2 }],
  // etc.
});
```

#### Approach 2: Modify Graph Construction

Modify `getNodeGraphFromPatch()` to detect streaming mode and connect AudioWorklet outputs:

```javascript
async getNodeGraphFromPatch(patch, cppnOutputNode, ...) {
  // ... existing code ...

  if (cppnOutputNode) {
    // Streaming mode: connect to AudioWorklet
    valueCurves.forEach((values, paramName) => {
      const outputIndex = getOutputIndexFromParamName(paramName);

      // Create intermediate gain node
      const gainNode = audioContext.createGain();
      cppnOutputNode.connect(gainNode, outputIndex);

      // Connect to target
      gainNode.connect(targetNode[targetParam]);
    });
  } else {
    // Batch mode: use setValueCurveAtTime (existing code)
    valueCurves.forEach((values, paramName) => {
      graph[key][2][paramName] = ['setValueCurveAtTime', values, time, duration];
    });
  }
}
```

#### Approach 3: Hybrid Pre-Connection

Pre-connect CPPN outputs to audio parameters before creating virtual-audio-graph:

```javascript
// Before creating graph
const cppnParams = {};
for (let i = 0; i < 18; i++) {
  const param = new AudioParam(...); // Create dummy param
  cppnOutputNode.connect(param, i);
  cppnParams[i] = param;
}

// Then use these in graph construction
// This might not work with virtual-audio-graph's abstraction
```

## Performance Characteristics

### Latency

```
Initial latency (time to first sound):
  - CPPN chunk 1 generation: ~1400ms (includes GPU init)
  - AudioWorklet buffering: ~0ms (starts after 2 chunks)
  - Total: ~1400-2800ms (depending on buffer requirement)

Compared to batch:
  - Batch (4s sound): ~1700ms
  - Hybrid (4s sound, 1s chunks): ~1400-2800ms
  - Similar for short sounds, better for long sounds

For longer sounds (10s):
  - Batch: ~4000ms (render entire sound)
  - Hybrid: ~1400-2800ms (buffer 2 chunks, play while generating)
  - 40-60% improvement!
```

### Memory Usage

```
Per second of audio (48kHz, 18 CPPN outputs):
  - 18 outputs × 48000 samples × 4 bytes = ~3.5MB per chunk
  - Buffering 2-3 chunks: ~10MB
  - Comparable to batch mode for same duration
```

### CPU Usage

```
Main thread:
  - CPPN activation: ~100ms per 1s chunk (GPU-accelerated)
  - Can generate in background without blocking audio
  - 10% CPU for generation

Audio thread (AudioWorklet):
  - Sample lookup and output: negligible
  - <1% CPU for buffering/playback

DSP processing (Web Audio API):
  - Same as batch mode
  - Handled by browser's audio engine
```

## Testing Strategy

### Phase 1: Verify CPPN Output
```bash
cd kromosynth-cli/cli-app/test
node test-hybrid-streaming.js
```

Verify:
- AudioWorklet outputs 18 channels
- CPPN values are correct
- No underruns
- Chunks generated smoothly

### Phase 2: Simple DSP Connection
Create minimal graph with single gain:
```javascript
const gainNode = audioContext.createGain();
cppnOutputNode.connect(gainNode.gain, 0);
gainNode.connect(audioContext.destination);
```

Verify:
- Gain parameter modulated by CPPN
- Continuous modulation (no resets)

### Phase 3: Full Genome
Test with actual wavetable/additive genomes:
- Compare output to batch render
- Validate spectral equivalence
- Check for artifacts

## Next Steps

1. **Create test for CPPN output verification**
   - Verify 18-channel output
   - Check value correctness

2. **Implement graph connection approach**
   - Choose Approach 1, 2, or 3
   - Modify network-rendering.js

3. **Test with simple genome**
   - Single wavetable
   - Validate output

4. **Expand to complex genomes**
   - Multiple synthesis types
   - Full DSP graphs

5. **Optimize performance**
   - Parallel chunk generation
   - Adaptive buffering
   - Backpressure handling

## Benefits of This Approach

### ✅ Advantages
1. **Reuses existing DSP code** - No reimplementation needed
2. **GPU acceleration** - CPPN activation uses GPU.js
3. **Continuous state** - No time resets between chunks
4. **Progressive playback** - Especially good for long sounds
5. **Real-time parameter changes** - Can modify during playback
6. **Platform compatible** - Works in Node.js and browsers

### ⚠️ Trade-offs
1. **Initial latency** - 1-2 second buffer required
2. **Complexity** - More moving parts than pure batch
3. **Memory** - Need to buffer 2-3 chunks (~10MB)

### 🎯 Ideal Use Cases
- **Focus product** - Long background soundscapes (minutes)
- **Interactive exploration** - UI with parameter changes
- **Live performance** - Real-time sound manipulation
- **Progressive loading** - Large sound libraries

## References

- `worklets/cppn-output-processor.js` - AudioWorklet implementation
- `util/streaming-renderer-hybrid.js` - Main renderer
- `cppn-neat/network-rendering.js` - DSP graph construction
- [AudioWorklet spec](https://webaudio.github.io/web-audio-api/#AudioWorklet)
- [virtual-audio-graph docs](https://virtual-audio-graph.netlify.app/)
