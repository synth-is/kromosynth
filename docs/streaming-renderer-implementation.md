# Streaming Audio Renderer Implementation

**Status**: In Progress
**Date**: November 2025
**Branch**: `feature/streaming-audio-rendering`

## Overview

This document captures an abandoned implementation effort / approach to enable real-time streaming audio rendering for CPPN+DSP graph genomes. The goal is to replace batch OfflineAudioContext rendering with AudioWorklet-based streaming that provides:

1. Fast initial playback (~100-150ms to first audio)
2. Real-time parameter changes during playback
3. Bit-identical audio output to batch mode
4. Support for both browser and Node.js environments
5. HTTP chunk serving for disk-cached reuse

## Problem Statement

The existing batch rendering system using OfflineAudioContext takes 1-2 seconds even for 4-second sounds. While faster than real-time playback, this delay prevents:
- Immediate audio feedback during sound evolution
- Real-time parameter manipulation (pitch, velocity, x/y coordinates)
- Progressive audio streaming to clients

### The Time-State Problem

Initial attempts to chunk OfflineAudioContext rendering revealed a fundamental issue: DSP nodes (envelopes, oscillators) reset their state to time 0 when rendering each chunk separately. This causes 100% sample difference between chunked and full rendering.

**Example from test results:**
```
Full render sample 0: -0.992391
Chunked render sample 0: 0.015674
Difference: 1.008065 (100% different)
```

This time-state problem is inherent to OfflineAudioContext and cannot be solved without maintaining continuous processing state.

## Architecture Solution: Hybrid Streaming Renderer

The chosen approach uses AudioWorklets to maintain continuous time-state while leveraging existing DSP code:

```
┌─────────────────────────────────────────────────────────┐
│ Main Thread (GPU Available)                             │
│   1. Activate CPPN in chunks using GPU.js               │
│      - ~100ms per 1s chunk                              │
│      - Generate chunks ahead of playback                │
└───────────────────┬─────────────────────────────────────┘
                    │ MessagePort transfer
                    ↓
┌─────────────────────────────────────────────────────────┐
│ AudioWorklet (Audio Thread)                             │
│   2. Buffer CPPN chunks                                 │
│      - Output sample-by-sample                          │
│      - 18 channels (one per CPPN output)                │
│      - Apply mix wave processing                        │
│      - Apply range remapping                            │
└───────────────────┬─────────────────────────────────────┘
                    │ Multi-channel audio signals
                    ↓
┌─────────────────────────────────────────────────────────┐
│ Main Thread (Web Audio API)                             │
│   3. Process with virtual-audio-graph                   │
│      - Existing DSP code (wavetable, additive, etc.)    │
└───────────────────┬─────────────────────────────────────┘
                    ↓
                 Speakers
```

### Key Benefits
- **Continuous state**: No time resets between chunks
- **GPU acceleration**: CPPN activation uses existing GPU.js kernels
- **Code reuse**: All DSP processing logic remains unchanged
- **Real-time control**: Parameters can change during playback
- **Progressive buffering**: Initial playback starts after ~2s of buffering

## Files Created

### 1. `/util/audio-graph-compiler.js`
**Purpose**: Translates array-based audio graph syntax (from forked virtual-audio-graph v0.x) to function-based syntax required by upstream virtual-audio-graph v1.6.1+

**Key functions**:
- `compileAudioGraph(arrayBasedGraph, customNodes)` - Recursively compiles graph definitions
- `createVirtualAudioGraphWithCompiler(options)` - Wrapper that auto-compiles graphs
- Handles custom nodes (wavetable, additive, feedbackDelay) using `createNode()`
- Patches channelMerger to support `numberOfInputs` parameter

**Why needed**: Genome-generated graphs use array syntax `[nodeType, output, params]` but virtual-audio-graph v1.6+ requires function calls `nodeType(output, params)`. This compiler maintains backward compatibility while enabling AudioWorklet support.

### 2. `/worklets/cppn-output-processor.js`
**Purpose**: AudioWorklet processor that receives CPPN chunks from main thread and outputs them as multi-channel audio-rate signals

**Architecture**:
- Receives chunks via MessagePort from main thread
- Buffers minimum 2 chunks before starting playback
- Outputs 18 channels (one per CPPN output)
- Maintains continuous time-state (no resets)
- Processes 128-sample quantums

**Special processing**:
1. **Mix wave transformation**: For outputs controlling wavetable gain mixing:
   ```javascript
   // Batch mode formula: gain = 1 - |mixWave| / 2
   value = 1 - Math.abs(value) / 2;
   ```

2. **Range remapping**: For non-mix outputs (e.g., audioWave buffers):
   ```javascript
   // Remap from [-1, 1] to [0, 1]
   value = (value + 1) / 2;
   ```

### 3. `/util/streaming-renderer-hybrid.js`
**Purpose**: Orchestrates the hybrid streaming rendering process

**Key functionality**:
- Loads AudioWorklet processor module
- Creates AudioWorklet node with configuration
- Generates CPPN chunks using existing `Activator` class
- Creates wrapper gain nodes connecting AudioWorklet channels to virtual-audio-graph
- Wires up DSP graph using existing `Renderer.wireUpAudioGraphAndConnectToAudioContextDestination()`
- Streams chunks to worklet via MessagePort
- Handles output index mapping (network indices → sequential channel indices)

**Parameters supported**:
- `duration` - Total render duration
- `noteDelta` - Pitch transposition
- `velocity` - Note velocity
- `x`, `y` - Kaoss pad-style control coordinates (for future use)
- `sampleRate` - Audio sample rate
- `useGPU` - Enable GPU acceleration for CPPN
- `chunkDuration` - Chunk size in seconds (default: 1.0s)

### 4. `/worklets/cppn-dsp-processor.js` and `/worklets/cppn-dsp-processor-v2.js`
**Purpose**: Earlier prototypes that attempted to implement full DSP processing inside AudioWorklet

**Status**: Deprecated in favor of hybrid approach

**Why abandoned**: Reimplementing all DSP logic (wavetable synthesis, additive synthesis, filters, delays, etc.) in AudioWorklet would duplicate code and introduce bugs. The hybrid approach reuses existing battle-tested DSP code.

### 5. `/util/streaming-renderer.js`
**Purpose**: Earlier prototype of streaming renderer

**Status**: Superseded by `streaming-renderer-hybrid.js`

## Files Modified

### 1. `/cppn-neat/network-rendering.js`

**Key changes**:

#### Support for custom output nodes
```javascript
wireUpAudioGraphAndConnectToAudioContextDestination(
  memberOutputs, patch, noteDelta,
  audioContextInstance,
  sampleCount,
  wrapperNodes = null,
  mode = 'batch',
  outputNode = null  // NEW: Optional custom output node
) {
  const finalOutput = outputNode || audioContextInstance.destination;

  const virtualAudioGraph = createVirtualAudioGraphWithCompiler({
    audioContext: audioContextInstance,
    output: finalOutput,
  });
  // ...
}
```

This enables capturing rendered audio to a MediaStreamDestination or other node instead of speakers.

#### Streaming mode wrapper node connections
```javascript
// In streaming mode, connect wrapper nodes to AudioParams
if (mode === 'streaming' && wrapperNodes) {
  this.connectWrapperNodesToGraph(
    _patch, wrapperNodes, virtualAudioGraph,
    audioContextInstance, outputNode
  );
}
```

Wrapper nodes are gain nodes that receive CPPN values from AudioWorklet channels and connect them to DSP graph parameters.

#### Mix wave metadata transfer
```javascript
if (wavetableGraphNode._mixWaveInfo) {
  // Store in both local graph and patch.audioGraph
  graph[oneAudioGraphNodeKey]._mixWaveInfo = wavetableGraphNode._mixWaveInfo;

  if (patch.audioGraph) {
    patch.audioGraph[oneAudioGraphNodeKey]._mixWaveInfo = wavetableGraphNode._mixWaveInfo;
  }
}
```

Mix wave connections need special handling - they modulate gain parameters rather than providing audio buffers.

#### Streaming wavetable synthesis
```javascript
const wavetableNodeEntry = [wavetableStreaming, outputKeys, wavetableNodeFunctionParameters];

// Store mix wave info for manual connection after graph is created
if (mixWaveWrapperGainNode) {
  wavetableNodeEntry._mixWaveInfo = {
    wrapperNode: mixWaveWrapperGainNode,
    numberOfWaves: audioWaveWrapperGainNodes.length
  };
}
```

#### Extensive debug logging
Added debug output at `LOG_LEVEL=debug` to trace:
- CPPN value ranges (checking for NaN, Inf)
- AudioBuffer creation
- Value curve setValueCurveAtTime ranges
- Graph structure in both modes
- Wrapper node connections

**Aspects considered from network-rendering.js**:

1. **Patch structure** (`synthIsPatch`):
   - `networkOutputs[]` - Maps CPPN outputs to DSP nodes
   - `audioGraphNodes{}` - Connections and parameter mappings
   - `audioGraph{}` - Node definitions
   - `valueCurves{}` - CPPN control signals

2. **DSP node types**:
   - Standard Web Audio nodes (gain, oscillator, biquadFilter, etc.)
   - Custom nodes (wavetable, additive, feedbackDelay)
   - Sub-graph encapsulation using `createNode()`

3. **Parameter automation**:
   - `setValueCurveAtTime()` for batch mode
   - Direct AudioParam connections for streaming mode
   - Range remapping for different parameter scales

4. **Connection patterns**:
   - Audio connections (node → node)
   - AudioParam connections (signal → parameter)
   - Mix wave special case (modulates gain)

### 2. `/util/audio-buffer.js`

**Key changes**:

#### Extensive debug logging
```javascript
if (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL === "debug") {
  let nanCount = 0, infCount = 0, validCount = 0, peak = 0;
  for (let i = 0; i < channelData.length; i++) {
    if (isNaN(channelData[i])) nanCount++;
    else if (!isFinite(channelData[i])) infCount++;
    else {
      validCount++;
      const abs = Math.abs(channelData[i]);
      if (abs > peak) peak = abs;
    }
  }
  console.log(`Valid: ${validCount}, NaN: ${nanCount}, Inf: ${infCount}, Peak: ${peak}`);
}
```

Added throughout `getAudioBuffer()` and `normalizeAudioBuffer()` to track:
- NaN and Infinity values in audio data
- Sample value ranges before/after normalization
- Buffer states at each processing stage

**No functional changes** - only diagnostic logging to help debug audio quality issues.

**Aspects considered from audio-buffer.js**:

1. **Buffer creation**:
   - `createBuffer(channels, sampleCount, sampleRate)`
   - Channel data copying with `getChannelData()` and `copyToChannel()`

2. **Normalization pipeline**:
   - Find min/max values
   - Remap to [-1, 1] range if exceeded
   - Ensure consistency between DACs and WAV storage

3. **Data flow**:
   - Input: Array of sample arrays (one per channel)
   - Process: Copy to AudioBuffer with normalization
   - Output: AudioBuffer ready for rendering or file export

### 3. `/util/configurable-renderer.js`

**Changes**: Minor adjustments to support streaming mode parameter passing

### 4. `/worklets/cppn-output-processor.js` (modified)

**Key evolution**:

#### Mix wave processing
Initially, the worklet output raw CPPN values. Through testing, we discovered batch mode applies a transformation for mix waves:

```javascript
// For mix wave outputs controlling wavetable gain
if (this.mixWaveOutputs.has(parseInt(cppnOutputIndex))) {
  value = 1 - Math.abs(value) / 2;
} else {
  // For regular audio wave buffers
  value = (value + 1) / 2;
}
```

This ensures streaming mode produces identical gain modulation to batch mode.

#### Enhanced debug output
```javascript
const processedValues = [];
for (let ch = 0; ch < channelCount; ch++) {
  const cppnOutputIndex = ch.toString();
  let value = cppnValues[cppnOutputIndex] || 0;
  if (this.mixWaveOutputs.has(parseInt(cppnOutputIndex))) {
    value = 1 - Math.abs(value) / 2;
    processedValues.push(`[${ch}]=${value.toFixed(4)}(MW)`);
  } else {
    processedValues.push(`[${ch}]=${value.toFixed(4)}`);
  }
}
console.log(`Raw CPPN: ${rawValues}\nProcessed: ${processedValues.join(', ')}`);
```

## Test Files Created

A comprehensive test suite was created to validate the implementation:

### Core Tests

1. **`test-chunked-rendering.js`**
   - Tests CPPN chunking + batch DSP rendering
   - Compares full render vs chunked render sample-by-sample
   - **Result**: Confirmed time-state problem (100% samples differ)

2. **`test-audioworklet-support.js`**
   - Validates node-web-audio-api AudioWorklet support
   - **Result**: ✅ AudioWorklet is supported

3. **`test-streaming-render.js`**
   - Tests basic streaming renderer setup
   - Validates AudioWorklet node creation

### Comparison Tests

4. **`test-batch-vs-streaming-comparison.js`**
   - Comprehensive sample-by-sample comparison
   - Captures both modes to buffers and compares
   - Tracks NaN, Inf, and value range differences

5. **`test-batch-vs-streaming-working.js`**
   - Working version after mix wave processing added
   - Validates transformations match between modes

6. **`compare-streaming-batch.js`**
   - High-level comparison harness
   - Tests multiple genomes

### Debug Tests

7. **`test-batch-debug.js`**
   - Deep dive into batch rendering with debug logging
   - Traces value curves, audio buffers, normalization

8. **`test-batch-value-curves-debug.js`**
   - Specifically examines setValueCurveAtTime data
   - Checks for extreme values causing NaN/Inf

9. **`test-batch-cppn-capture.js`**
   - Captures raw CPPN output in batch mode
   - Validates CPPN chunking correctness

### Streaming Tests

10. **`test-streaming-capture.js`**
    - Captures streaming output to buffer
    - Validates AudioWorklet output

11. **`test-streaming-playback.js`**
    - Tests real-time playback (not just capture)
    - Validates buffering and chunk streaming

12. **`test-streaming-to-wav.js`**
    - Exports streaming render to WAV file
    - Validates file format and audio quality

13. **`test-hybrid-streaming.js`**
    - Tests the hybrid renderer approach
    - Validates CPPN → AudioWorklet → DSP pipeline

### Batch Reference Tests

14. **`test-original-batch-render.js`**
    - Reference batch render without modifications
    - Baseline for comparison

15. **`test-batch-full-render.js`**
    - Full batch render with all DSP features

16. **`test-batch-with-dsp.js`**
    - Batch render with specific DSP graph

### Edge Case Tests

17. **`test-streaming-cpu.js`**
    - Streaming without GPU acceleration
    - Validates CPU fallback

18. **`test-streaming-no-aa.js`**
    - Streaming without anti-aliasing

19. **`test-streaming-multiple-genomes.js`**
    - Tests multiple genome renders in sequence
    - Validates cleanup and reset

### Audio Output Tests

20. **`test-streaming-audio-output.js`**
    - Validates audio output node connections

21. **`test-compare-cpu-batch.js`**
    - Compares CPU vs GPU batch rendering

22. **`test-compare-batch-streaming-full.js`**
    - Comprehensive full-pipeline comparison

## Current Implementation Status

### ✅ Completed

1. **Migration to virtual-audio-graph v1.6.1**
   - Upgraded from forked v0.x to upstream version
   - Implemented backward-compatible compiler for array syntax
   - Fixed channelMerger numberOfInputs parameter

2. **AudioWorklet infrastructure**
   - Created CPPN output processor
   - Implemented chunk buffering and streaming
   - Validated node-web-audio-api support

3. **Hybrid renderer architecture**
   - Separated CPPN activation (main thread) from DSP (Web Audio)
   - Created wrapper node system for channel connections
   - Implemented output index mapping

4. **CPPN chunking**
   - GPU.js kernels support `sampleOffset` and `sampleCountToActivate`
   - Chunks generated ahead of playback
   - Transfer via MessagePort

5. **Mix wave processing**
   - Identified batch mode formula: `gain = 1 - |mixWave| / 2`
   - Implemented in AudioWorklet processor
   - Special connection handling for gain parameters

6. **Range remapping**
   - Identified batch mode remaps audioWave buffers from [-1,1] to [0,1]
   - Implemented in AudioWorklet for non-mix outputs

7. **Debug infrastructure**
   - Extensive logging throughout pipeline
   - NaN/Inf detection
   - Sample-by-sample comparison tools

### 🔨 In Progress

1. **Output validation**
   - Testing if streaming now matches batch after all transformations
   - Sample-by-sample comparison with latest code

2. **Remaining DSP features**
   - Some custom nodes may need streaming-specific handling
   - Edge cases in parameter automation

### 🔜 Pending

1. **HTTP chunk serving**
   - API endpoint: `GET /render/:genomeId/chunk/:index?pitch=X&velocity=Y&x=X&y=Y&duration=Z&mode=batch`
   - Disk-based cache with keys including all parameters
   - Content-Type: audio/raw or custom format

2. **Client-side progressive playback**
   - Parallel chunk fetching
   - Web Audio API buffer scheduling
   - Seamless parameter changes during playback

3. **Real-time parameter changes**
   - Implement x,y coordinate control
   - Dynamic pitch/velocity modulation
   - Crossfading between parameter states

4. **Performance optimization**
   - Tune chunk size for optimal latency vs overhead
   - Implement chunk cleanup to prevent memory leaks
   - Optimize GPU.js kernel invocations

5. **Error handling**
   - Graceful degradation when chunks delayed
   - Recovery from AudioWorklet crashes
   - User-visible buffering indicators

## Key Technical Decisions

### 1. Hybrid Approach vs. Full AudioWorklet DSP

**Decision**: Use AudioWorklet only for CPPN output, not DSP processing

**Rationale**:
- Existing DSP code is complex and battle-tested
- Reimplementing in AudioWorklet would introduce bugs
- virtual-audio-graph provides declarative API that's hard to replicate
- Hybrid approach maintains continuous CPPN state (solving time-state problem) while reusing DSP code

**Trade-offs**:
- ✅ Code reuse, fewer bugs
- ✅ Easier maintenance
- ❌ More complex architecture
- ❌ Additional latency from main thread DSP

### 2. Array Syntax Compatibility

**Decision**: Create compiler instead of rewriting genome graph generation

**Rationale**:
- Genomes generate graphs in array format: `[nodeType, output, params]`
- Rewriting graph generation would be massive undertaking
- Compiler provides backward compatibility
- Can migrate to function syntax gradually

**Trade-offs**:
- ✅ Minimal changes to existing code
- ✅ Gradual migration path
- ❌ Additional compilation step
- ❌ Potential performance overhead

### 3. MessagePort vs. SharedArrayBuffer

**Decision**: Use MessagePort for chunk transfer

**Rationale**:
- SharedArrayBuffer requires COOP/COEP headers (deployment complexity)
- MessagePort transfers ownership (zero-copy)
- Simpler mental model

**Trade-offs**:
- ✅ Easier deployment
- ✅ Broader browser support
- ❌ Ownership transfer means main thread can't reuse buffers
- ❌ Slightly more code

### 4. HTTP Chunks vs. WebSocket Streaming

**Decision**: Use HTTP chunk serving (not implemented yet)

**Rationale**:
- HTTP chunks can be cached (CDN, browser cache)
- Similar to HLS/DASH video streaming
- Stateless (easier scaling)
- Chunks are deterministic (same genome + params = same chunk)

**Trade-offs**:
- ✅ Better caching
- ✅ Simpler server implementation
- ❌ More initial latency than WebSocket
- ❌ Requires chunk-based API design

### 5. Chunk Size: 1 Second

**Decision**: Default 1-second chunks (configurable)

**Rationale**:
- Balance between overhead and latency
- ~100ms CPPN activation per chunk (acceptable)
- 2-chunk minimum buffer = 2s initial latency
- Allows parameter changes every ~1s

**Trade-offs**:
- ✅ Reasonable latency
- ✅ Not too many chunks
- ❌ 2s initial delay still noticeable
- ❌ 1s parameter change granularity

## Architecture Diagrams

### Batch Mode (Current)

```
┌─────────────────────────────────────────────────────────┐
│ Main Thread                                              │
│                                                          │
│  ┌─────────────┐       ┌─────────────────────────┐     │
│  │   Genome    │  →    │  OfflineAudioContext    │     │
│  └─────────────┘       │  (CPPN + DSP together)  │     │
│                        └───────────┬─────────────┘     │
│                                    ↓                     │
│                            AudioBuffer (full)            │
│                                                          │
└─────────────────────────────────────────────────────────┘

Time to first audio: 1-2 seconds
Parameter changes: Not possible during render
State continuity: N/A (single render)
```

### Streaming Mode (New)

```
┌─────────────────────────────────────────────────────────┐
│ Main Thread                                              │
│                                                          │
│  ┌─────────────┐       ┌─────────────────────────┐     │
│  │   Genome    │  →    │  CPPN Activator (GPU)   │     │
│  └─────────────┘       │  - Chunk 0 (0-1s)       │     │
│                        │  - Chunk 1 (1-2s)       │     │
│                        │  - Chunk 2 (2-3s)       │     │
│                        └───────────┬─────────────┘     │
│                                    │ MessagePort        │
└────────────────────────────────────┼─────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────┐
│ AudioWorklet Thread                                      │
│                                                          │
│  ┌─────────────────────────────────────────────┐       │
│  │ CPPNOutputProcessor                         │       │
│  │  - Buffer chunks                            │       │
│  │  - Output 18 channels sample-by-sample     │       │
│  │  - Apply mix wave processing                │       │
│  │  - Apply range remapping                    │       │
│  └─────────────┬───────────────────────────────┘       │
│                │ 18-channel audio                       │
└────────────────┼───────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────┐
│ Main Thread                                              │
│                                                          │
│  ┌─────────────────────────────────────────────┐       │
│  │ Wrapper Gain Nodes (18x)                    │       │
│  │  - One per CPPN output channel              │       │
│  └─────────────┬───────────────────────────────┘       │
│                ↓                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ virtual-audio-graph DSP                     │       │
│  │  - Wavetable synthesis                      │       │
│  │  - Additive synthesis                       │       │
│  │  - Filters, delays, effects                 │       │
│  └─────────────┬───────────────────────────────┘       │
│                ↓                                         │
│           Destination                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘

Time to first audio: ~100-150ms (2-chunk buffer = 2s initially)
Parameter changes: Possible in real-time
State continuity: ✅ Continuous (no time resets)
```

## Data Transformations

### Mix Wave Processing

**Batch mode** (in `network-rendering.js`):
```javascript
// Mix wave controls gain via setValueCurveAtTime
// Formula applied to CPPN values:
const gainCurve = mixWaveCPPN.map(val => 1 - Math.abs(val) / 2);
gainParam.setValueCurveAtTime(gainCurve, startTime, duration);
```

**Streaming mode** (in `cppn-output-processor.js`):
```javascript
// Mix wave processed in AudioWorklet before output
if (this.mixWaveOutputs.has(parseInt(cppnOutputIndex))) {
  value = 1 - Math.abs(value) / 2;  // Same formula
}
```

**Range**: [-1, 1] → [0, 1] (but using `1 - |x|/2` formula)

### Audio Wave Range Remapping

**Batch mode** (in `network-rendering.js`):
```javascript
// Audio wave buffers use range [0, 1] for wavetable lookup
if (oneAudioGraphNodeConn.range) {
  valueCurve = samples.map(s =>
    remapNumberToRange(s, -1, 1, range[0], range[1])
  );
}
// For wavetable buffer params, range is [0, 1]
```

**Streaming mode** (in `cppn-output-processor.js`):
```javascript
// Non-mix outputs (audio waves) remapped to [0, 1]
else {
  value = (value + 1) / 2;  // [-1,1] → [0,1]
}
```

**Range**: [-1, 1] → [0, 1] (linear remap)

### Normalization

**Both modes** use identical normalization in `normalizeAudioBuffer()`:

```javascript
// Find peak value
let minSampleValue = 0, maxSampleValue = 0;
bufferChannelData.forEach(sample => {
  if (sample < minSampleValue) minSampleValue = sample;
  if (sample > maxSampleValue) maxSampleValue = sample;
});

// Remap to [-1, 1] if exceeded
if (minSampleValue < -1 || maxSampleValue > 1) {
  for (let i = 0; i < bufferChannelData.length; i++) {
    bufferChannelData[i] = remapNumberToRange(
      bufferChannelData[i],
      minSampleValue, maxSampleValue,
      -1, 1
    );
  }
}
```

## Known Issues and Debugging

### Issue 1: NaN/Infinity in Audio Output

**Symptoms**: Rendered audio contains NaN or Inf values, causing silence or distortion

**Debug approach**:
1. Enable `LOG_LEVEL=debug` environment variable
2. Check CPPN output for NaN/Inf
3. Check value curves before `setValueCurveAtTime()`
4. Check audio buffers after `getAudioBuffer()`
5. Check final output after `normalizeAudioBuffer()`

**Common causes**:
- Division by zero in CPPN activation
- Extreme parameter ranges causing overflow
- Improper buffer initialization

### Issue 2: Streaming Output Differs from Batch

**Symptoms**: Sample-by-sample comparison shows differences

**Debug approach**:
1. Capture both modes with `LOG_LEVEL=debug`
2. Compare raw CPPN output (should be identical)
3. Compare processed values (check transformations)
4. Check for timing differences (sample alignment)
5. Verify mix wave vs. audio wave classification

**Recent fixes**:
- Added mix wave processing formula to AudioWorklet
- Added range remapping for non-mix outputs
- Fixed wrapper node connections to gain parameters

### Issue 3: AudioWorkletNode Constructor Issues

**Symptoms**: `AudioWorkletNode is not defined` or type errors

**Cause**: AudioWorkletNode and AudioContext must come from same module instance

**Solution**: Pass AudioWorkletNode constructor from same import as AudioContext:
```javascript
import { AudioContext } from 'node-web-audio-api';
const audioContext = new AudioContext();
const { AudioWorkletNode } = audioContext.constructor;
```

## Future Work

### 1. Complete Output Validation
- Finalize sample-by-sample comparison tests
- Verify all genome types (wavetable, additive, feedback delay)
- Test edge cases (extreme parameters, long durations)

### 2. HTTP Chunk Serving API
- Design REST API for chunk requests
- Implement cache key generation
- Add disk-based storage
- Configure CDN caching headers

### 3. Client-Side Progressive Playback
- Implement chunk fetcher with parallel requests
- Buffer management and scheduling
- Seamless looping
- Error recovery and retry logic

### 4. Real-Time Parameter Control
- X/Y coordinate modulation
- Pitch bend during playback
- Velocity changes
- Smooth parameter interpolation

### 5. Performance Optimization
- Profile CPPN activation times
- Optimize chunk size for different genome types
- Implement adaptive bitrate (different quality levels)
- Add Web Worker pool for CPPN activation

### 6. Production Deployment
- Browser compatibility testing
- Mobile device optimization
- Network resilience (offline playback)
- Analytics (chunk cache hit rates, latency metrics)

## References

### Key Files
- `/cppn-neat/network-rendering.js` - Core DSP graph wiring
- `/util/audio-buffer.js` - Buffer creation and normalization
- `/util/audio-graph-compiler.js` - Array to function syntax compiler
- `/util/streaming-renderer-hybrid.js` - Hybrid renderer orchestrator
- `/worklets/cppn-output-processor.js` - AudioWorklet processor

### Test Files
- `/test/test-batch-vs-streaming-comparison.js` - Main comparison test
- `/test/test-chunked-rendering.js` - Time-state problem demonstration
- `/test/test-audioworklet-support.js` - Platform capability check

### Related Documentation
- `/docs/CPPN-ARCHITECTURE.md` - CPPN network architecture
- virtual-audio-graph docs: https://github.com/benji6/virtual-audio-graph

### External Resources
- Web Audio API spec: https://www.w3.org/TR/webaudio/
- AudioWorklet guide: https://developers.google.com/web/updates/2017/12/audio-worklet
- GPU.js documentation: https://gpu.rocks/

---

**Document Version**: 1.0
**Last Updated**: November 2025
**Author**: Documentation by Claude Code, edited by bthj
