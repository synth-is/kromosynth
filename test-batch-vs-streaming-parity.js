#!/usr/bin/env node
/**
 * Test Batch vs Streaming Parity
 *
 * Verifies that streaming mode produces IDENTICAL output to batch mode
 * by comparing sample-by-sample.
 */

import { getAudioBufferFromGenomeAndMeta } from './util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext } = NodeWebAudioAPI;

const DURATION = 1.0; // Short duration for testing
const SAMPLE_RATE = 48000;

// Simple test genome with oscillator
const TEST_GENOME = {
  "asNEATPatch": JSON.stringify({
    "id": "test-simple",
    "generation": 0,
    "nodes": [
      "{\"name\":\"OscillatorNode\",\"id\":\"osc1\",\"type\":\"sine\",\"frequency\":440}",
      "{\"name\":\"GainNode\",\"id\":\"gain1\",\"gain\":0.5}",
      "{\"name\":\"OutNode\",\"id\":0}"
    ],
    "connections": [
      "{\"id\":\"conn1\",\"sourceNode\":\"osc1\",\"targetNode\":\"gain1\",\"weight\":1,\"enabled\":true}",
      "{\"id\":\"conn2\",\"sourceNode\":\"gain1\",\"targetNode\":0,\"weight\":1,\"enabled\":true}"
    ]
  }),
  "waveNetwork": {
    "nodes": {},
    "connections": []
  }
};

async function testParity() {
  console.log('='.repeat(80));
  console.log('BATCH VS STREAMING PARITY TEST');
  console.log('='.repeat(80));
  console.log();

  const genomeAndMeta = {
    genome: TEST_GENOME,
    duration: DURATION,
    noteDelta: 0,
    velocity: 0.5,
    reverse: false
  };

  // Test 1: Batch mode
  console.log('🎵 Rendering with BATCH mode...');

  const batchContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const batchBuffer = await getAudioBufferFromGenomeAndMeta(
    genomeAndMeta,        // genomeAndMeta
    DURATION,            // duration
    0,                   // noteDelta
    0.5,                 // velocity
    false,               // reverse
    false,               // asDataArray
    batchContext,        // offlineAudioContext
    null,                // audioContext
    false,               // useOvertoneInharmonicityFactors
    true,                // useGPU
    false,               // antiAliasing
    false,               // frequencyUpdatesApplyToAllPathcNetworkOutputs
    null,                // sampleCountToActivate
    null,                // sampleOffset
    'batch'              // mode (explicit)
  );

  if (!batchBuffer) {
    throw new Error('Batch rendering failed - no audio buffer');
  }

  const batchData = batchBuffer.getChannelData(0);
  console.log(`  ✓ Rendered ${batchData.length} samples`);
  console.log(`  Peak: ${Math.max(...batchData).toFixed(4)}`);
  console.log();

  // Test 2: Streaming mode
  console.log('🎵 Rendering with STREAMING mode...');

  const streamingContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const streamingBuffer = await getAudioBufferFromGenomeAndMeta(
    genomeAndMeta,        // genomeAndMeta
    DURATION,            // duration
    0,                   // noteDelta
    0.5,                 // velocity
    false,               // reverse
    false,               // asDataArray
    streamingContext,    // offlineAudioContext
    null,                // audioContext
    false,               // useOvertoneInharmonicityFactors
    true,                // useGPU
    false,               // antiAliasing
    false,               // frequencyUpdatesApplyToAllPathcNetworkOutputs
    null,                // sampleCountToActivate
    null,                // sampleOffset
    'streaming'          // mode (explicit)
  );

  if (!streamingBuffer) {
    throw new Error('Streaming rendering failed - no audio buffer');
  }

  const streamingData = streamingBuffer.getChannelData(0);
  console.log(`  ✓ Rendered ${streamingData.length} samples`);
  console.log(`  Peak: ${Math.max(...streamingData).toFixed(4)}`);
  console.log();

  // Compare outputs
  console.log('📊 Comparing outputs...');

  if (batchData.length !== streamingData.length) {
    throw new Error(`Length mismatch: ${batchData.length} vs ${streamingData.length}`);
  }

  let differences = 0;
  let maxDiff = 0;
  let sumSquaredDiff = 0;

  for (let i = 0; i < batchData.length; i++) {
    const diff = Math.abs(batchData[i] - streamingData[i]);
    if (diff > 1e-9) {
      differences++;
      if (diff > maxDiff) maxDiff = diff;
    }
    sumSquaredDiff += diff * diff;
  }

  const rmse = Math.sqrt(sumSquaredDiff / batchData.length);
  const identicalPercentage = ((batchData.length - differences) / batchData.length * 100).toFixed(2);

  console.log(`  Total samples: ${batchData.length}`);
  console.log(`  Differences: ${differences} (${identicalPercentage}% identical)`);
  console.log(`  Max difference: ${maxDiff.toFixed(12)}`);
  console.log(`  RMSE: ${rmse.toFixed(12)}`);
  console.log();

  // Success criteria
  console.log('='.repeat(80));
  if (differences === 0) {
    console.log('✅ SUCCESS: Outputs are IDENTICAL!');
    console.log('   Streaming mode produces 100% identical output to batch mode.');
    process.exit(0);
  } else if (maxDiff < 1e-6) {
    console.log('⚠️  MINOR DIFFERENCES: Outputs are nearly identical (floating-point precision)');
    console.log('   Max difference:', maxDiff);
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Outputs differ significantly');
    console.log('   Max difference:', maxDiff);
    console.log('   RMSE:', rmse);
    process.exit(1);
  }
}

testParity().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
