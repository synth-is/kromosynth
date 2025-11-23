# CPPN Range Validation

## Overview

Optional validation step in genome mutation that rejects genomes whose CPPN outputs exceed the `[-1, 1]` range. This helps prevent potential rendering discrepancies between different Web Audio API implementations.

## Usage

The `getNewAudioSynthesisGenomeByMutation` function now accepts two additional optional parameters:

### Basic Usage

```javascript
import { getNewAudioSynthesisGenomeByMutation } from './util/audio-synthesis-genome.js';

const newGenome = await getNewAudioSynthesisGenomeByMutation(
  parentGenomes,
  evolutionRunId,
  generationNumber,
  parentIndex,
  algorithm,
  audioCtx,
  probabilityMutatingWaveNetwork,
  probabilityMutatingPatch,
  asNEATMutationParams,
  evoParams,
  OfflineAudioContext,
  patchFitnessTestDuration,
  useGPU,
  true, // ← Enable CPPN range validation
  {} // ← Use default options
);
```

### Advanced Configuration

```javascript
const newGenome = await getNewAudioSynthesisGenomeByMutation(
  parentGenomes,
  evolutionRunId,
  generationNumber,
  parentIndex,
  algorithm,
  audioCtx,
  probabilityMutatingWaveNetwork,
  probabilityMutatingPatch,
  asNEATMutationParams,
  evoParams,
  OfflineAudioContext,
  patchFitnessTestDuration,
  useGPU,
  true, // Enable validation
  {
    sampleRate: 48000,        // Sample rate for CPPN activation
    duration: 1,              // Duration in seconds (lower = faster)
    sampleStep: 5000,         // Analyze every Nth sample (higher = faster)
    maxExceedanceRate: 0.0,   // Maximum allowed exceedance rate (0.0 = no exceedances)
    testFrequencies: [1, 10, 100, 440, 1000, 4000] // Frequencies to test
  }
);
```

## Parameters

### `validateCPPNRanges` (boolean)
- **Default**: `false`
- **Description**: Enable/disable CPPN range validation
- **Impact**: When enabled, genomes with out-of-range CPPN values will be rejected and mutation will retry (up to `maxMutationAttempts`)

### `cppnRangeValidationOptions` (object)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleRate` | number | 48000 | Sample rate for CPPN activation (Hz) |
| `duration` | number | 1 | Duration to test (seconds) |
| `sampleStep` | number | 5000 | Analyze every Nth sample (performance vs. thoroughness) |
| `maxExceedanceRate` | number | 0.0 | Maximum allowed rate of out-of-range values (0.0 = strict, no exceedances) |
| `testFrequencies` | number[] | [1, 10, 100, 440, 1000, 4000] | Frequencies to test for single-CPPN genomes |

## How It Works

### For Single-CPPN Genomes
1. Activates the CPPN at multiple test frequencies (default: 6 frequencies)
2. Tests all 18 CPPN outputs at each frequency
3. Checks ~10 samples per output (with default settings)
4. Rejects genome if any value exceeds [-1, 1]

### For Multi-CPPN Genomes
1. Activates each CPPN at its designated frequency
2. Tests all frequency-specific CPPNs
3. Checks ~10 samples per CPPN output
4. Rejects genome if any value exceeds [-1, 1]

## Performance Considerations

CPPN validation adds computational overhead to the mutation process:

| Configuration | Time per Mutation | Thoroughness |
|---------------|-------------------|--------------|
| Disabled (default) | 0ms | N/A |
| Enabled (default options) | ~50-200ms | Good |
| Strict (step=1000) | ~200-500ms | High |
| Ultra-strict (step=100) | ~1-3s | Very High |

**Recommendation**: Use default options for most cases. The validation is fast enough (~100-200ms) to not significantly impact evolution speed, while catching problematic genomes.

## Integration with Evolution Runs

### In Evolution Configuration

Add to your evolution run configuration JSON:

```json
{
  "evolution": {
    "cppnRangeValidation": {
      "enabled": true,
      "options": {
        "sampleRate": 48000,
        "duration": 1,
        "sampleStep": 5000,
        "maxExceedanceRate": 0.0
      }
    }
  }
}
```

Then in your evolution code, pass these settings to the mutation function.

### When to Enable

**Enable validation if:**
- You're experiencing rendering discrepancies across platforms
- You want to ensure Web Audio API compliance
- You're generating sounds for production use

**Disable validation if:**
- You're doing exploratory evolution
- Performance is critical
- Your analysis (via `cppn-range-analysis.js`) shows no exceedances in your population

## Error Handling

The validation function includes error handling:
- Malformed CPPNs that fail to activate will **pass** validation (return `true`)
- Rationale: Malformed CPPNs will fail other fitness tests anyway
- This prevents blocking all mutations due to occasional malformed genomes

## Related Tools

See `cli-app/analysis/cppn-range-analysis.js` for:
- Batch analysis of existing genome populations
- Detailed statistics on CPPN value ranges
- Identification of problematic genomes in evolution runs

## Example: Strict Validation

For production-critical applications where you want zero out-of-range values:

```javascript
const newGenome = await getNewAudioSynthesisGenomeByMutation(
  parentGenomes,
  // ... other params ...
  true, // Enable validation
  {
    sampleRate: 48000,
    duration: 2,              // Test longer duration
    sampleStep: 1000,         // More thorough sampling
    maxExceedanceRate: 0.0,   // Strict: no exceedances allowed
    testFrequencies: [1, 5, 10, 50, 100, 200, 440, 880, 1000, 2000, 4000] // More frequencies
  }
);
```

This configuration will:
- Test for 2 seconds
- Check every 1000th sample (~96 samples total)
- Test at 11 different frequencies
- Reject any genome with even a single out-of-range value
- Take ~500ms per mutation attempt
