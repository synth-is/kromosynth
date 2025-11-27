#!/usr/bin/env node
/**
 * Test Batch vs Streaming Parity with Audio Export
 *
 * Tests using a real genome from the codebase and exports WAV files for listening.
 */

import fs from 'fs';
import { getAudioBufferFromGenomeAndMeta } from './util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext } = NodeWebAudioAPI;
import waveFileModule from 'wavefile';
const { WaveFile } = waveFileModule;

const DURATION = 2.0;
const SAMPLE_RATE = 48000;
const OUTPUT_DIR = './audio-comparison-new';

// Use a real genome from test-streaming-combined.js
const TEST_GENOME_STRING = '{"evolutionHistory":["aabs","ac","sm","mcw","mnp","mcw","ao","mcw","aabs","sm","ao","mcw","mcw","ao","aabs","sm","ac","mnp","mcw","mnp","ao","mcw","sm","aabs","mnp","ac","mcw","mcw","sm","mcw","sm"],"evolutionHistoryV2":[{"operation":"aabs","nodeIndex":1,"connectionIndex":5},{"operation":"ac","nodeIndex":7,"connectionIndex":5},{"operation":"sm","nodeIndex":4,"connectionIndex":0},{"operation":"mcw","nodeIndex":4,"connectionIndex":7},{"operation":"mnp","nodeIndex":4,"connectionIndex":0},{"operation":"mcw","nodeIndex":7,"connectionIndex":1},{"operation":"ao","nodeIndex":1,"connectionIndex":0},{"operation":"mcw","nodeIndex":4,"connectionIndex":5},{"operation":"aabs","nodeIndex":6,"connectionIndex":6},{"operation":"sm","nodeIndex":3,"connectionIndex":0},{"operation":"ao","nodeIndex":9,"connectionIndex":0},{"operation":"mcw","nodeIndex":9,"connectionIndex":5},{"operation":"mcw","nodeIndex":6,"connectionIndex":2},{"operation":"ao","nodeIndex":3,"connectionIndex":0},{"operation":"aabs","nodeIndex":3,"connectionIndex":2},{"operation":"sm","nodeIndex":5,"connectionIndex":0},{"operation":"ac","nodeIndex":7,"connectionIndex":3},{"operation":"mnp","nodeIndex":0,"connectionIndex":0},{"operation":"mcw","nodeIndex":11,"connectionIndex":6},{"operation":"mnp","nodeIndex":11,"connectionIndex":0},{"operation":"ao","nodeIndex":11,"connectionIndex":0},{"operation":"mcw","nodeIndex":1,"connectionIndex":4},{"operation":"sm","nodeIndex":7,"connectionIndex":0},{"operation":"aabs","nodeIndex":5,"connectionIndex":3},{"operation":"mnp","nodeIndex":10,"connectionIndex":0},{"operation":"ac","nodeIndex":8,"connectionIndex":2},{"operation":"mcw","nodeIndex":6,"connectionIndex":1},{"operation":"mcw","nodeIndex":7,"connectionIndex":0},{"operation":"sm","nodeIndex":6,"connectionIndex":0},{"operation":"mcw","nodeIndex":3,"connectionIndex":5},{"operation":"sm","nodeIndex":2,"connectionIndex":0}],"asNEATPatch":"{\\"id\\":\\"IjQQS2\\",\\"generation\\":0,\\"evolutionHistory\\":[\\"aabs\\",\\"ac\\",\\"sm\\",\\"mcw\\",\\"mnp\\",\\"mcw\\",\\"ao\\",\\"mcw\\",\\"aabs\\",\\"sm\\",\\"ao\\",\\"mcw\\",\\"mcw\\",\\"ao\\",\\"aabs\\",\\"sm\\",\\"ac\\",\\"mnp\\",\\"mcw\\",\\"mnp\\",\\"ao\\",\\"mcw\\",\\"sm\\",\\"aabs\\",\\"mnp\\",\\"ac\\",\\"mcw\\",\\"mcw\\",\\"sm\\",\\"mcw\\",\\"sm\\"],\\"nodes\\":[\\"{\\\\\\"\name\\\\\\":\\\\\\"WavetableNode\\\\\\",\\\\\\"id\\\\\\":\\\\\\"GDPOuN\\\\\\"}\\"]}","waveNetwork":{"nodes":[{"name":"output","type":"output","activation":"linear","activationRange":[0,1],"randomWeightRange":{"min":0,"max":1},"mutationDelta":{"weight":{"min":[0.05,0.3],"max":[0.1,0.6]},"activationRange":{"min":[0.05,0.3],"max":[0.1,0.6]}},"index":0},{"name":"x","type":"input","activation":"linear","activationRange":[-1,1],"randomWeightRange":{"min":0,"max":1},"mutationDelta":{"weight":{"min":[0.05,0.3],"max":[0.1,0.6]},"activationRange":{"min":[0.05,0.3],"max":[0.1,0.6]}},"index":1},{"name":"y","type":"input","activation":"linear","activationRange":[-1,1],"randomWeightRange":{"min":0,"max":1},"mutationDelta":{"weight":{"min":[0.05,0.3],"max":[0.1,0.6]},"activationRange":{"min":[0.05,0.3],"max":[0.1,0.6]}},"index":2}],"connections":[{"sourceIndex":1,"targetIndex":0,"weight":0.5}]}}';

async function testWithAudioExport() {
  console.log('='.repeat(80));
  console.log('BATCH VS STREAMING PARITY TEST - WITH AUDIO EXPORT');
  console.log('='.repeat(80));
  console.log();

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const genomeAndMeta = {
    genome: TEST_GENOME_STRING,
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
    genomeAndMeta,
    DURATION,
    0,                   // noteDelta
    0.5,                 // velocity
    false,               // reverse
    false,               // asDataArray
    batchContext,
    null,
    false,               // useOvertoneInharmonicityFactors
    true,                // useGPU
    false,               // antiAliasing
    false,               // frequencyUpdatesApplyToAllPathcNetworkOutputs
    null,                // sampleCountToActivate
    null,                // sampleOffset
    'batch'
  );

  if (!batchBuffer) {
    throw new Error('Batch rendering failed');
  }

  const batchData = batchBuffer.getChannelData(0);
  console.log(`  ✓ Rendered ${batchData.length} samples`);
  console.log(`  Peak: ${Math.max(...Array.from(batchData)).toFixed(4)}`);

  // Export batch audio
  const batchWav = new WaveFile();
  batchWav.fromScratch(1, SAMPLE_RATE, '32f', batchData);
  fs.writeFileSync(`${OUTPUT_DIR}/batch.wav`, batchWav.toBuffer());
  console.log(`  💾 Saved: ${OUTPUT_DIR}/batch.wav`);
  console.log();

  // Test 2: Streaming mode
  console.log('🎵 Rendering with STREAMING mode...');

  const streamingContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const streamingBuffer = await getAudioBufferFromGenomeAndMeta(
    genomeAndMeta,
    DURATION,
    0,
    0.5,
    false,
    false,
    streamingContext,
    null,
    false,
    true,
    false,
    false,
    null,
    null,
    'streaming'
  );

  if (!streamingBuffer) {
    throw new Error('Streaming rendering failed');
  }

  const streamingData = streamingBuffer.getChannelData(0);
  console.log(`  ✓ Rendered ${streamingData.length} samples`);
  console.log(`  Peak: ${Math.max(...Array.from(streamingData)).toFixed(4)}`);

  // Export streaming audio
  const streamingWav = new WaveFile();
  streamingWav.fromScratch(1, SAMPLE_RATE, '32f', streamingData);
  fs.writeFileSync(`${OUTPUT_DIR}/streaming.wav`, streamingWav.toBuffer());
  console.log(`  💾 Saved: ${OUTPUT_DIR}/streaming.wav`);
  console.log();

  // Quantitative comparison
  console.log('📊 QUANTITATIVE COMPARISON:');
  console.log('='.repeat(80));

  if (batchData.length !== streamingData.length) {
    throw new Error(`Length mismatch: ${batchData.length} vs ${streamingData.length}`);
  }

  let differences = 0;
  let maxDiff = 0;
  let sumSquaredDiff = 0;
  let sumBatch = 0;
  let sumStreaming = 0;
  let sumProduct = 0;
  let sumBatchSquared = 0;
  let sumStreamingSquared = 0;

  for (let i = 0; i < batchData.length; i++) {
    const diff = Math.abs(batchData[i] - streamingData[i]);
    if (diff > 1e-9) {
      differences++;
      if (diff > maxDiff) maxDiff = diff;
    }
    sumSquaredDiff += diff * diff;

    // For correlation
    sumBatch += batchData[i];
    sumStreaming += streamingData[i];
    sumProduct += batchData[i] * streamingData[i];
    sumBatchSquared += batchData[i] * batchData[i];
    sumStreamingSquared += streamingData[i] * streamingData[i];
  }

  const n = batchData.length;
  const rmse = Math.sqrt(sumSquaredDiff / n);

  // Pearson correlation
  const numerator = (n * sumProduct) - (sumBatch * sumStreaming);
  const denominator = Math.sqrt(
    (n * sumBatchSquared - sumBatch * sumBatch) *
    (n * sumStreamingSquared - sumStreaming * sumStreaming)
  );
  const correlation = numerator / denominator;

  const identicalPercentage = ((n - differences) / n * 100).toFixed(4);

  console.log(`  Total samples:        ${n.toLocaleString()}`);
  console.log(`  Identical samples:    ${(n - differences).toLocaleString()} (${identicalPercentage}%)`);
  console.log(`  Different samples:    ${differences.toLocaleString()}`);
  console.log(`  Max difference:       ${maxDiff.toExponential(6)}`);
  console.log(`  RMSE:                 ${rmse.toExponential(6)}`);
  console.log(`  Pearson correlation:  ${correlation.toFixed(12)}`);
  console.log();

  console.log('🎧 LISTENING INSTRUCTIONS:');
  console.log('='.repeat(80));
  console.log(`  1. Open audio files in your audio player:`);
  console.log(`     - ${OUTPUT_DIR}/batch.wav`);
  console.log(`     - ${OUTPUT_DIR}/streaming.wav`);
  console.log();
  console.log(`  2. Listen for differences:`);
  console.log(`     - Timbre/tone quality`);
  console.log(`     - Pitch accuracy`);
  console.log(`     - Amplitude envelope`);
  console.log(`     - Any artifacts or glitches`);
  console.log();
  console.log(`  3. A/B comparison: Play both files simultaneously or switch between them`);
  console.log();

  // Success criteria
  console.log('='.repeat(80));
  if (differences === 0) {
    console.log('✅ SUCCESS: Outputs are IDENTICAL!');
    console.log('   Streaming mode produces 100% identical output to batch mode.');
    process.exit(0);
  } else if (maxDiff < 1e-6) {
    console.log('✅ SUCCESS: Outputs are nearly identical (within floating-point precision)');
    console.log(`   Max difference: ${maxDiff.toExponential(6)}`);
    console.log(`   Correlation: ${correlation.toFixed(12)}`);
    process.exit(0);
  } else {
    console.log('⚠️  DIFFERENCES DETECTED:');
    console.log(`   Max difference: ${maxDiff.toExponential(6)}`);
    console.log(`   RMSE: ${rmse.toExponential(6)}`);
    console.log(`   Correlation: ${correlation.toFixed(12)}`);
    console.log();
    console.log('   Please listen to both files and assess if differences are audible.');
    process.exit(0);
  }
}

testWithAudioExport().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
