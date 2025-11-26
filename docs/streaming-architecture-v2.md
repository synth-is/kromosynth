# Streaming Renderer Architecture V2

**Design Goal:** Implement streaming audio rendering without affecting batch mode.

## Core Principle: Complete Mode Separation

```
┌─────────────────────────────────────────┐
│     getAudioBufferFromGenomeAndMeta     │
│              (entry point)               │
└────────────────┬────────────────────────┘
                 │
       ┌─────────┴─────────┐
       │   mode check      │
       └─────────┬─────────┘
                 │
        ┌────────┴────────┐
        │                 │
   ┌────▼────┐      ┌────▼────┐
   │  BATCH  │      │STREAMING│
   │  MODE   │      │  MODE   │
   └────┬────┘      └────┬────┘
        │                 │
   NO SHARED CODE PATHS   │
   (except utilities)     │
        │                 │
   [existing]        [new module]
```

## File Structure

### New Files
```
util/streaming-renderer.js          - Main streaming renderer class
util/streaming-cppn-processor.js    - CPPN chunk processing
worklets/streaming-processor.js     - AudioWorklet DSP processor
```

### Modified Files (minimal)
```
util/audio-buffer.js                - Add mode guard at entry
cppn-neat/network-rendering.js      - NO CHANGES (batch only)
```

## Implementation Plan

### Step 1: Create Skeleton Module
```javascript
// util/streaming-renderer.js
export class StreamingRenderer {
  constructor(audioContext, sampleRate) {
    this.audioContext = audioContext;
    this.sampleRate = sampleRate;
  }

  async render(genomeAndMeta, duration) {
    // For now, just throw error to prevent accidental use
    throw new Error('Streaming mode not yet implemented');
  }
}
```

### Step 2: Add Entry Point Guard
```javascript
// util/audio-buffer.js - getAudioBufferFromGenomeAndMeta()
export async function getAudioBufferFromGenomeAndMeta(...args) {
  const mode = args[...]; // Extract mode from args

  if (mode === 'streaming') {
    const renderer = new StreamingRenderer(audioContext, sampleRate);
    return await renderer.render(genomeAndMeta, duration);
  }

  // Existing batch mode code (unchanged)
  return await batchRender(...args);
}
```

### Step 3: Implement Basic Streaming (No Custom Nodes)
- Render CPPN outputs in chunks
- Apply to standard AudioParam nodes (gain, frequency, etc.)
- Skip wavetable/additive nodes initially
- **Test:** Verify batch mode still works, streaming returns error

### Step 4: Add Wavetable Support
- Implement chunk-based wavetable rendering
- Use separate code path from batch wavetable
- **Test:** Both modes work for genomes with wavetables

### Step 5: Add Additive Support
- Similar to wavetable, separate implementation
- **Test:** Both modes work for all node types

## Testing Strategy

### After EVERY commit:
```bash
# Test batch mode (must always work)
node test-batch-render.js --genome-id 01JF2N9RZ07V06EJ4DJ9ZGCM2D

# Expect: 0 NaN, 100% valid samples
# If this fails, REVERT immediately

# Test streaming mode (when implemented)
node test-streaming-render.js --genome-id 01JF2N9RZ07V06EJ4DJ9ZGCM2D

# Both should produce valid audio (may differ in samples)
```

### Regression Test Suite
Create `test-both-modes.js`:
```javascript
const testGenomes = [
  '01JF2N9RZ07V06EJ4DJ9ZGCM2D',  // Multiple buffer sources
  // Add more diverse test cases
];

for (const genomeId of testGenomes) {
  const batchResult = await renderBatch(genomeId);
  const streamResult = await renderStreaming(genomeId);

  assert(batchResult.nanCount === 0, 'Batch must have 0 NaN');
  assert(streamResult.nanCount === 0, 'Streaming must have 0 NaN');

  // Audio may differ, but both should be valid
}
```

## Code Guidelines

### Mode Separation Rules
1. **NO shared code paths** - batch and streaming use separate functions
2. **NO mode conditionals** in shared utilities - create separate utilities if needed
3. **Batch code is FROZEN** - only bug fixes, no features
4. **Streaming is isolated** - all new code in streaming-*.js files

### Acceptable Shared Code
- Pure utilities: `remapNumberToRange()`, `getAudioBuffer()`
- Data structures: genome, patch, CPPN network
- Constants: sample rates, frequencies
- Helper functions with NO mode dependencies

### Unacceptable Shared Code
- ❌ Node graph building (`getNodeGraphFromPatch`)
- ❌ Value curve creation (`getValueCurvesFromPatch`)
- ❌ Wavetable/additive node processing
- ❌ AudioContext rendering logic

## Commit Strategy

### Template
```
[streaming] <feature>: <description>

- What was added/changed
- Why it was needed
- Testing performed

Batch mode: ✅ Tested, 0 NaN
Streaming mode: [status]
```

### Example
```
[streaming] Add basic CPPN chunk processor

- Created StreamingCPPNProcessor class
- Implements chunk-based CPPN activation
- No AudioGraph integration yet (returns samples only)

Batch mode: ✅ Tested with genome 01JF2N9..., 0 NaN
Streaming mode: Not yet integrated (unused code)
```

## Migration from Old Implementation

### What to Keep
- Chunk-based CPPN activation approach ✓
- AudioWorklet concept for DSP ✓
- Wrapper nodes for CPPN outputs ✓

### What to Change
- ❌ Don't modify existing `network-rendering.js`
- ❌ Don't add mode conditionals to batch code
- ✅ Create completely separate module
- ✅ Add clean entry point guard

### Lessons Learned from Failed Attempt
1. **Restructuring batch code is dangerous** - broke parameter handling
2. **Mode conditionals are fragile** - easy to miss edge cases
3. **Shared functions with mode params** - creates tight coupling
4. **TODO comments ignored** - led to regression (multiple buffer sources)

## Success Criteria

### Phase 3 Complete When:
- ✅ Streaming mode renders basic genomes (no wavetable/additive)
- ✅ Batch mode unchanged and working (0 NaN)
- ✅ Clean separation: streaming code in separate files
- ✅ Entry point guard prevents accidental batch/streaming mixing
- ✅ Test suite covers both modes

### Phase 4 (Future):
- Add wavetable support to streaming
- Add additive support to streaming
- Performance optimization
- Memory leak prevention

## Architecture Validation

Before writing ANY code, verify:
- [ ] Design document reviewed
- [ ] Mode separation is COMPLETE (no shared paths)
- [ ] Testing strategy is clear
- [ ] Commit template understood
- [ ] Revert strategy known (if batch breaks, git revert immediately)

---

**Document status:** Design complete, ready for implementation
**Next step:** Create util/streaming-renderer.js skeleton
