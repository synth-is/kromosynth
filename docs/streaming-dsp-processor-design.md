# Streaming DSP Processor Design

**Goal:** Implement wavetable and additive synthesis for streaming mode with complete separation from batch mode.

## Architecture Overview

```
┌──────────────────────────────┐
│   StreamingRenderer          │
│   (util/streaming-renderer.js)│
└───────────┬──────────────────┘
            │
            │ 1. Generate CPPN outputs in chunks
            │
            ▼
┌──────────────────────────────┐
│  StreamingDSPProcessor       │
│  (util/streaming-dsp-processor.js) │
│                              │
│  • processAudioGraph()       │
│  • applyChunkToNodes()       │
│  • handleWavetableNode()     │
│  • handleAdditiveNode()      │
└──────────────────────────────┘
```

## Current Understanding

### Batch Mode Approach
1. **Pre-compute all CPPN outputs** → Full-length Float32Arrays
2. **Create value curves** → setValueCurveAtTime() on AudioParams
3. **For wavetables/additive:**
   - Create BufferSource nodes
   - Fill buffers with pre-rendered waveforms
   - Use gain nodes for mixing

### Streaming Mode Requirements
- **CPPN outputs arrive in chunks** (e.g., 128 samples at a time)
- **Cannot use setValueCurveAtTime()** with chunks (needs complete arrays)
- **Need real-time application** of CPPN values to nodes

## Two Possible Approaches

### Option A: OfflineAudioContext with Suspend/Resume
**Pros:**
- Can use setValueCurveAtTime() with partial arrays
- Closer to batch mode architecture
- Uses standard Web Audio API

**Cons:**
- Complex suspend/resume logic
- May not work well with chunking
- OfflineAudioContext is designed for batch rendering

### Option B: AudioWorklet with Custom Processing
**Pros:**
- True real-time chunk processing
- Full control over DSP
- Designed for streaming audio

**Cons:**
- More complex implementation
- Need to implement wavetable/additive logic in worklet
- Requires separate worklet file

## Recommended Approach: Hybrid (Phase 4A + 4B)

### Phase 4A: Simple Offline Rendering (Current)
**Status:** ✅ Already working
- Generate all CPPN chunks
- Accumulate into full arrays
- Pass to standard renderer
- **Limitation:** Can't handle wavetable/additive (gets skipped)

### Phase 4B: Custom Buffer Processing (Next)
**For wavetable/additive nodes:**
1. Generate CPPN outputs in chunks (already done)
2. After all chunks accumulated, **manually** create wavetable buffers:
   - Use CPPN outputs as mix controls
   - Use CPPN outputs as audio content
   - Create AudioBuffers directly (bypass AudioParams)
3. Wire up standard Web Audio graph with these buffers

This is essentially **batch mode but with chunked CPPN generation**.

### Phase 4C: True Streaming (Future)
- Use AudioWorklet
- Apply chunks in real-time
- Enable dynamic parameter changes during playback

## Phase 4B Implementation Plan

### Step 1: Identify Wavetable/Additive Nodes
```javascript
// In StreamingRenderer.render()
const wavetableNodes = identifyNodesByType(synthIsPatch, 'wavetable');
const additiveNodes = identifyNodesByType(synthIsPatch, 'additive');
```

### Step 2: Create StreamingDSPProcessor
```javascript
// util/streaming-dsp-processor.js
export class StreamingDSPProcessor {
  constructor(patch, cppnOutputs, sampleRate, duration) {
    this.patch = patch;
    this.cppnOutputs = cppnOutputs; // Map of accumulated CPPN outputs
    this.sampleRate = sampleRate;
    this.duration = duration;
  }

  // Create wavetable buffer from CPPN outputs
  createWavetableBuffer(nodeKey) {
    // 1. Find CPPN outputs connected to this node's 'buffer' param
    // 2. Find CPPN outputs connected to 'mix' param
    // 3. Synthesize final buffer using mix to blend audio waves
    // 4. Return AudioBuffer
  }

  // Create additive synthesis buffer from CPPN outputs
  createAdditiveBuffer(nodeKey) {
    // 1. Find CPPN outputs for partialBuffer
    // 2. Find CPPN outputs for partialGainEnvelope
    // 3. Synthesize harmonics with gain envelopes
    // 4. Return AudioBuffer
  }

  // Build modified audio graph with custom buffers
  buildAudioGraph(offlineContext) {
    // Return virtual-audio-graph compatible graph
  }
}
```

### Step 3: Integrate into StreamingRenderer
```javascript
// After accumulating all CPPN chunks:
if (hasWavetableOrAdditiveNodes) {
  const dspProcessor = new StreamingDSPProcessor(
    synthIsPatch, allMemberOutputs, this.sampleRate, actualDuration
  );

  const audioBuffer = await dspProcessor.renderToBuffer(offlineContext);
} else {
  // Use standard renderer (current approach)
  const audioBuffer = await renderAudioAndSpectrogramFromPatchAndMember(...);
}
```

## Key Design Decisions

### 1. Complete Separation
- ❌ Don't modify `network-rendering.js`
- ❌ Don't share wavetable/additive logic with batch mode
- ✅ Create independent streaming implementations

### 2. Progressive Implementation
- **Phase 4B.1:** Wavetable support only
- **Phase 4B.2:** Additive support
- **Phase 4B.3:** Combined testing

### 3. Testing Strategy
```bash
# Test genome with wavetables
node test-streaming-wavetable.js

# Compare batch vs streaming output
node test-compare-modes.js --genome-id <id>

# Verify batch mode unchanged
node test-batch-render-quick.js
```

## Questions to Answer

1. **How does mix parameter work in wavetables?**
   - Need to understand the blending algorithm
   - Check batch mode implementation

2. **What is partialGainEnvelope in additive?**
   - Per-harmonic amplitude envelope
   - Time-varying gain for each partial

3. **Can we reuse any batch mode utilities?**
   - Pure math functions (interpolation, etc.) - YES
   - Audio graph building - NO (mode-specific)

## Success Criteria (Phase 4B)

- ✅ Genomes with wavetables render without "skipping" warning
- ✅ Genomes with additive render correctly
- ✅ Batch mode still works (0 NaN)
- ✅ Streaming mode produces valid audio (0 NaN)
- ✅ Audio content is musically coherent (not just valid data)

## Next Steps

1. Create `streaming-dsp-processor.js` skeleton
2. Implement wavetable buffer creation
3. Test with genome 01JF2N9RZ07V06EJ4DJ9ZGCM2D (has wavetable)
4. Implement additive buffer creation
5. Integration testing

---

**Status:** Design complete, ready for implementation
**Approach:** Phase 4B - Custom buffer processing with chunked CPPN
