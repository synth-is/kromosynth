# TODO: Investigate Multiple Network Outputs Targeting Single Buffer Source

## Issue Summary

During debugging of batch rendering (Nov 2025), we discovered that **multiple CPPN network outputs can connect to the same bufferSource node** with the same parameter name (`buffer`). This is semantically incorrect for bufferSource nodes, which should only have one buffer input.

## Example Case

**Genome:** `01JF2N9RZ07V06EJ4DJ9ZGCM2D`
**DB path** `/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel`
**Node:** `P1ek7W` (bufferSource)
**Problem:** 4 different CPPN outputs all trying to set the `buffer` parameter

### Network Outputs Connecting to P1ek7W:

```javascript
[0] networkOutput: '11', frequency: 1396.91 Hz, paramName: 'buffer', weight: 0.281
    → Creates: 0_0_buffer
[2] networkOutput: 'noiseWhite', frequency: 155.56 Hz, paramName: 'buffer', weight: 1.0
    → Creates: 2_0_buffer
[3] networkOutput: '4', frequency: 1318.51 Hz, paramName: 'buffer', weight: 0.437
    → Creates: 3_0_buffer
[4] networkOutput: '8', frequency: 1046.50 Hz, paramName: 'buffer', weight: 0.673
    → Creates: 4_0_buffer
```

### Current Behavior

All four parameters extract to the same name:
```javascript
const _paramName = paramName.split('_')[2];  // All become "buffer"
graph[nodeKey][2][_paramName] = values;      // Overwrites previous!
```

**Result:** Only the LAST buffer (4_0_buffer from CPPN output 8) is used. The other 3 CPPN outputs are silently discarded.

## Historical Context

### Removed TODO Comment (commit c4595b0)

The original code had this TODO that was removed during streaming implementation:

```javascript
// TODO: if multiple network outputs point to the same graph node and parameter
// add ChannelmergerNode to graph, for fan-in of all the networkOutputs
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API#fan-in_and_fan-out
```

This indicates the issue was **known but unresolved**.

### Why Both Old and New Code Work Despite This

Both the old (v1.0.35) and reverted code produce **0 NaN values** despite only using the last buffer. This suggests:
1. Either the "overwrite behavior" is accidentally correct for these genomes
2. Or the unused CPPN outputs don't affect the final audio quality significantly

## Questions to Investigate

### 1. Is This By Design or a Bug?

**Possible explanations:**

**A) Bug in patch generation:**
- The genome evolution process creates invalid connections
- Should be filtered during fitness evaluation
- Multiple buffers to one bufferSource makes no semantic sense

**B) Intended but misunderstood:**
- Maybe these should be wavetable nodes, not bufferSource?
- Wavetable nodes CAN accept multiple buffer inputs
- Check if node type detection is wrong

**C) Weight-based selection:**
- Perhaps only the connection with highest weight should be used?
- Current code uses "last wins" but should use "highest weight wins"?

### 2. How Common Is This?

**Investigation needed:**
- Scan genome database for nodes with multiple buffer connections
- Check what percentage of genomes have this pattern
- Determine if it's rare edge case or common issue

### 3. What Should the Correct Behavior Be?

**Option A: Mix/Sum the buffers** (as attempted during debugging)
```javascript
// Create mixed buffer from all inputs
const mixedSamples = new Float32Array(sampleLength);
group.forEach(({values, weight}) => {
  const channelData = values.getChannelData(0);
  for (let i = 0; i < sampleLength; i++) {
    mixedSamples[i] += channelData[i] * weight;  // Use connection weight!
  }
});
```
**Result when tested:** Created MORE NaN values (119 → 1886), so this is NOT correct.

**Option B: Use highest-weight connection**
```javascript
const selectedBuffer = group.reduce((max, curr) =>
  curr.weight > max.weight ? curr : max
);
```

**Option C: Validate and reject during evolution**
- Add genome validation: bufferSource nodes can only have ONE buffer input
- Reject genomes with multiple buffer connections during fitness evaluation
- Force evolution to use wavetable nodes for multi-input scenarios

**Option D: Convert to appropriate node type**
- If multiple buffers detected → convert bufferSource to wavetable
- Or create a custom node that properly handles multiple inputs

## Impact Assessment

### Current Impact: Low
- Existing genomes render without NaN values
- Audio output is valid (though potentially not using all CPPN outputs)
- No user-visible errors

### Potential Issues:
1. **Lost creativity:** 3 out of 4 CPPN outputs discarded → less sonic complexity
2. **Evolution inefficiency:** Fitness evaluation based on incomplete sound
3. **Semantic incorrectness:** Graph structure doesn't match intent
4. **Future bugs:** Could cause issues when adding new features

## Recommended Investigation Steps

### Phase 1: Data Analysis (1-2 hours)
```javascript
// Scan genome database
for (const genome of genomes) {
  const patch = genome.asNEATPatch;
  for (const node of patch.audioGraph) {
    const bufferConnections = countBufferConnections(node);
    if (bufferConnections > 1) {
      log({ genomeId, nodeId, nodeType, connectionCount: bufferConnections });
    }
  }
}
```

**Questions to answer:**
- How many genomes have this issue?
- Which node types are affected? (bufferSource, wavetable, both?)
- Is there a pattern in connection weights?

### Phase 2: Semantic Analysis (2-3 hours)
- Review NEAT-to-AudioGraph bridge code
- Check if bufferSource vs wavetable node type assignment is correct
- Verify connection weights are used appropriately

### Phase 3: Solution Implementation (varies)
Based on findings, implement appropriate fix:
- **If rare edge case:** Add validation warning, document behavior
- **If common issue:** Implement proper mixing/selection logic
- **If design flaw:** Fix genome generation to prevent invalid connections

## Files to Review

### Core Files:
- `cppn-neat/network-rendering.js:521-548` - Parameter application logic
- `cppn-neat/network-rendering.js:695-808` - Value curve creation
- `as-neat/audio-graph-asNEAT-bridge.js` - NEAT → AudioGraph conversion

### Related:
- Genome evolution code (fitness evaluation)
- Patch generation from NEAT networks
- Node type detection logic

## Testing Strategy

When implementing a fix:

1. **Test with known genome** (`01JF2N9RZ07V06EJ4DJ9ZGCM2D`)
2. **Compare against baseline** (v1.0.35 output)
3. **Verify 0 NaN values** maintained
4. **Check audio quality** (listen to output)
5. **Test edge cases:**
   - Single buffer connection (should work as before)
   - Multiple buffers with different weights
   - Noise + CPPN outputs mixed
   - All same weight vs varying weights

## References

- **Investigation discussion:** Conversation from 2025-11-26
- **Breaking commit:** c4595b0 "Complete wavetable and additive synthesis streaming support"
- **Removed TODO:** network-rendering.js (commit c4595b0^)
- **Test genome:** `/Volumes/T7/evoruns/.../genome_01JF2N9RZ07V06EJ4DJ9ZGCM2D.json`

## Priority

**Current: Low** (batch rendering works, no user-visible bugs)
**Future: Medium** (semantic correctness, optimization potential)

---

*Document created: 2025-11-26*
*Status: Investigation needed*
