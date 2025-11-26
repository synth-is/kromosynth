# Streaming vs Batch Rendering Audio Comparisons

This directory contains WAV files comparing batch and streaming rendering modes.

## Files

### 1. Combined Wavetable + Additive Genome (01JF0WHAXBZK7Z59003FCC3CVK)

**Genome Type:** Has both wavetable (1 node) and additive (1 node) with valid CPPN connections

- `01JF0WHAXBZK7Z59003FCC3CVK_batch.wav` - Batch mode rendering
- `01JF0WHAXBZK7Z59003FCC3CVK_streaming.wav` - Streaming mode rendering

**Comparison Results:**
- Both produce 100% valid audio (0 NaN, 0 Inf)
- Streaming successfully renders wavetable and additive buffers
- Current limitation: Uses "simplified rendering" (first wavetable buffer only)

**What to listen for:**
- Both should produce valid musical sound
- Streaming version may sound different due to incomplete audio graph integration

---

### 2. Wavetable Genome (01JF2N9RZ07V06EJ4DJ9ZGCM2D)

**Genome Type:** Has 1 wavetable node with 4 audio waves, no mix control

- `01JF2N9RZ07V06EJ4DJ9ZGCM2D_batch.wav` - Batch mode rendering (Peak: 1.0)
- `01JF2N9RZ07V06EJ4DJ9ZGCM2D_streaming.wav` - Streaming mode rendering (Peak: 0.338)

**Comparison Results:**
- Both produce 100% valid audio (0 NaN, 0 Inf)
- RMSE: 0.559, Correlation: 0.895
- Outputs differ significantly (expected)

**What to listen for:**
- Both produce valid sound but with different characteristics
- Batch version is louder (peak 1.0 vs 0.338)
- Streaming uses equal weighted blend of 4 waves
- Missing gain nodes and other audio graph processing in streaming

**Technical Notes:**
- Batch mode: "No value curves for wavetable lDigNn - skipping" (then uses default rendering)
- Streaming mode: Creates wavetable buffer with 4 audio waves, equal weighted blend

---

## Testing Approach

### Quantitative Analysis
Run the comparison script to see detailed metrics:
```bash
node util/compare-batch-streaming.js \
  --genome-id <GENOME_ID> \
  --db-path <PATH_TO_DB>
```

### Qualitative Analysis
Listen to the exported WAV files to hear the differences:
- Import into your DAW
- Use any audio player (QuickTime, VLC, etc.)
- Compare side-by-side in an audio editor

## Known Limitations

**Streaming Mode (Current Implementation):**
- ✅ Correctly generates CPPN outputs in chunks
- ✅ Correctly creates wavetable/additive buffers
- ⚠️ Uses "simplified rendering" - returns first buffer only
- ❌ Does not integrate buffers into full audio graph
- ❌ Missing gain nodes, filters, and other processing

**Why the differences exist:**
The streaming implementation correctly performs the core DSP (wavetable blending, additive synthesis) but doesn't yet build the complete audio graph with all nodes and connections. This is documented as a known limitation in `util/streaming-dsp-processor.js:360-377`.

## Success Criteria

The current tests validate:
1. ✅ No NaN or Inf values (valid audio data)
2. ✅ Wavetable buffer creation works
3. ✅ Additive buffer creation works
4. ✅ Graceful fallback for unconnected nodes
5. ⚠️ Full audio graph integration (future work)

## Next Steps

To achieve identical output between batch and streaming:
1. Implement full audio graph building in `streaming-dsp-processor.js:309-319`
2. Integrate custom buffers into virtual-audio-graph structure
3. Add support for gain nodes, filters, and other audio graph nodes
4. Test with more complex genomes with multiple nodes and connections
