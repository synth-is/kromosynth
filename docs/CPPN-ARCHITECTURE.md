# CPPN Architecture Documentation

## Overview

This document provides comprehensive technical documentation of the JavaScript CPPN (Compositional Pattern Producing Networks) implementation in kromosynth, focusing on architecture, capabilities, and integration points.

## Core Architecture

### Component Structure

```
kromosynth/cppn-neat/
├── network-evolution.js    # Population management, genome generation
├── network-activation.js   # CPPN evaluation and signal generation  
├── activation-functions.js # Custom activation function definitions
└── evolution-constants.js  # Default parameters (inputs, outputs, etc.)
```

### Key Classes

**`Evolver` (network-evolution.js)**
- Singleton class managing CPPN population evolution
- Integrates with `neatjs` and `cppnjs` libraries
- Handles genome creation, mutation, and population management

**`Activator` (network-activation.js)**  
- Primary interface for CPPN evaluation
- GPU-accelerated network activation via gpu.js
- Handles input signal generation and output collection
- Supports anti-aliasing and batch processing

## Current Configuration

### Default Parameters
```javascript
// From evolution-constants.js
INPUTS: 2        // Number of network inputs
OUTPUTS: 18      // Number of network outputs  
SEED_COUNT: 5    // Initial population seeds
POPULATION_SIZE: 12
```

### Available Activation Functions
```javascript
// From activation-functions.js - with default probabilities
triangle: 0.25      // Triangle wave
sawtooth: 0.25      // Sawtooth wave  
StepFunction: 0.25  // Step/Square function
Sine: 0.25          // Basic sine wave
Sine2: 0.25         // Double-frequency sine

// Available but disabled by default (probability 0):
cos, arctan, spike, BipolarSigmoid, PlainSigmoid, 
Gaussian, Linear, NullFn
```

## Network Activation Process

### Input Signal Generation
```javascript
// Current implementation generates 2 inputs:
// Input 0: Sine/cosine modulation based on frequency
// Input 1: Linear ramp from -1 to 1 over time
getInputSignals(totalSampleCount, sampleCountToActivate, sampleOffset, 
                inputPeriods, variationOnPeriods, velocity)
```

### Key Methods

**`activateMember()`** - Primary CPPN evaluation interface:
```javascript
activateMember(
  member,                    // CPPN genome
  patch,                     // Output configuration
  outputsToActivate,         // Which outputs to compute
  totalSampleCount,          // Total duration in samples
  sampleCountToActivate,     // Actual samples to compute
  sampleOffset,              // Start offset
  useGPU = false,            // GPU acceleration flag
  reverse = false,           // Reverse time direction
  variationOnPeriods = true, // Input modulation type
  velocity = 1,              // Amplitude scaling
  antiAliasing = false       // Oversampling flag
)
```

**`getCPPNFromMember()`** - Genome decoding:
- Handles multiple genome formats (NeatGenome objects, serialized data)
- Creates executable CPPN networks via `networkDecode()`

## GPU Acceleration

### Current Capabilities
- GPU.js-based parallel evaluation
- Automatic kernel generation from CPPN topology
- Web Workers support (partial implementation)
- String-based function compilation for GPU execution

### Performance Characteristics
- CPU evaluation: ~1-50ms per activation (depending on network size)  
- GPU evaluation: Significant speedup for batch processing
- Memory usage: Scales with network complexity and sample count

### GPU Pipeline
```javascript
1. CPPN topology → String functions via createPureCPPNFunctions()
2. Function dependency analysis → Required node calculation
3. GPU kernel generation → Dynamic code compilation  
4. Batch parallel execution → Results collection
```

## Integration Points for DDSP

### Current Limitations for DDSP Integration

**Input Count**: Current default (2 inputs) insufficient for DDSP requirements
- Need: time (normalized, absolute, sine), gesture coordinates (x,y,pressure), bias
- Minimum recommended: 6 inputs

**Output Count**: Current default (18 outputs) insufficient for DDSP synthesis  
- Need: f0 (1) + loudness (1) + harmonics (60) + filter coefficients (65) = ~127 outputs
- Must override `evolution-constants.js` defaults

**Parameter Normalization**: Current system optimized for audio-rate synthesis
- DDSP needs control-rate parameters (50-100Hz) with specific ranges
- Requires parameter mapping and bounds checking layer

### Recommended Integration Strategy

**1. Configuration Override**:
```javascript
// Custom constants for DDSP integration
const DDSP_INPUTS = 6;   // time variants + gesture + bias
const DDSP_OUTPUTS = 127; // f0 + loudness + harmonics + filters

// Custom activation function probabilities
const ddspActivationProbs = {
  Sine: 0.3,
  triangle: 0.2, 
  sawtooth: 0.2,
  Gaussian: 0.15,
  BipolarSigmoid: 0.1,
  Linear: 0.05
};
```

**2. Parameter Mapping Layer**:
```javascript
function mapCPPNOutputsToDDSP(cppnOutputs) {
  return {
    f0: denormalize(cppnOutputs[0], 80, 1200),        // 80-1200 Hz
    loudness: normalize(cppnOutputs[1], 0, 1),         // 0-1
    harmonics: cppnOutputs.slice(2, 62).map(h =>      // 60 harmonics 
      normalize(h, 0, 1)),
    filterCoeffs: cppnOutputs.slice(62, 127)          // 65 coefficients
  };
}
```

**3. Custom Input Generation**:
```javascript
function getDDSPInputs(t, gestureX, gestureY, pressure) {
  return [
    Math.sin(2 * Math.PI * t),           // Periodic time
    (t % 4.0) * 2 - 1,                   // Normalized time (-1 to 1)  
    t,                                    // Absolute time
    gestureX,                             // Gesture X (-1 to 1)
    gestureY,                             // Gesture Y (-1 to 1) 
    pressure,                             // Pressure (0 to 1)
    1                                     // Bias
  ];
}
```

## Performance Considerations

### Memory Usage
- CPPN genome: ~1-10KB (topology + weights)
- Activation state: Scales with network depth and width
- Output buffers: sampleCount × outputCount × 4 bytes (Float32Array)

### Computational Complexity
- Network evaluation: O(connections × activations)
- GPU overhead: Kernel compilation (one-time), data transfer (per evaluation)
- Recommended: Cache compiled networks, batch evaluations

### Bottlenecks for DDSP Integration
1. **Output Count**: 127 outputs vs current 18 (7x increase)
2. **Evaluation Frequency**: Control-rate evaluation (50-100Hz) vs audio-rate
3. **Parameter Dependencies**: DDSP parameters have interdependencies not present in current DSP synthesis

## Testing and Validation

### Current Test Coverage
- Basic genome generation and mutation (`test-genome.js`)
- Audio buffer rendering via `getAudioBufferFromGenomeAndMeta()`
- Population evolution with fitness evaluation

### Recommended DDSP Tests
```javascript
// Test CPPN evaluation with DDSP parameter count
const cppnOutputs = await activator.activateMember(
  ddspGenome, 
  null,
  Array.from({length: 127}, (_, i) => ({index: i, frequency: 440})),
  sampleRate * 0.1,  // 0.1 second test
  null, null, false
);

// Verify parameter ranges and validity
const ddspParams = mapCPPNOutputsToDDSP(cppnOutputs);
assert(ddspParams.f0 >= 80 && ddspParams.f0 <= 1200);
assert(ddspParams.harmonics.every(h => h >= 0 && h <= 1));
```

## Migration Recommendations

### Phase 1: Core Integration
1. Override evolution constants for DDSP parameter count
2. Implement custom input generation for time + gesture inputs
3. Create parameter mapping and normalization layer
4. Test CPPN evaluation with target output count

### Phase 2: Optimization  
1. Profile performance with 127 outputs vs current 18
2. Implement control-rate evaluation (reduce sample count)
3. Add parameter validation and bounds checking
4. Optimize for real-time parameter generation

### Phase 3: Advanced Features
1. GPU-accelerated batch evaluation for QD search  
2. Custom activation functions optimized for synthesis parameters
3. Multi-rate evaluation (fast parameters vs slow parameters)
4. Parameter interpolation and smoothing

## API Compatibility

### Current Integration Points
```javascript
// Existing functions to maintain compatibility
getNewAudioSynthesisGenome()           // Genome creation
getNewAudioSynthesisGenomeByMutation() // Mutation  
getAudioBufferFromGenomeAndMeta()      // Rendering
```

### Proposed DDSP Extensions
```javascript
// New functions for DDSP integration
getNewCPPNDDSPGenome(inputCount, outputCount, evoParams)
activateCPPNForDDSP(genome, timeInputs, gestureInputs) 
mapCPPNOutputsToSynthesis(outputs, synthesisTarget)
```

This architecture provides a solid foundation for DDSP integration while maintaining backward compatibility with existing kromosynth functionality.
