#!/usr/bin/env node
/**
 * Verify Batch vs Streaming Parity
 *
 * Tests both rendering modes and produces:
 * - WAV files for listening
 * - Detailed quantitative analysis
 * - Clear pass/fail result
 */

import fs from 'fs';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext } = NodeWebAudioAPI;
import waveFileModule from 'wavefile';
const { WaveFile } = waveFileModule;
import { renderAudioAndSpectrogram } from './util/render.js';

const DURATION = 2.0;
const SAMPLE_RATE = 48000;
const OUTPUT_DIR = './parity-verification';

// Simple test genome with oscillator + gain
// This is a minimal but real CPPN-driven sound
const TEST_GENOME = {
  asNEATPatch: JSON.stringify({
    id: "test-parity",
    generation: 0,
    nodes: [
      JSON.stringify({ name: "OscillatorNode", id: "osc1", type: "sine", frequency: 440 }),
      JSON.stringify({ name: "GainNode", id: "gain1", gain: 0.5 }),
      JSON.stringify({ name: "OutNode", id: 0 })
    ],
    connections: [
      JSON.stringify({
        id: "c1",
        sourceNode: "osc1",
        targetNode: "gain1",
        weight: 1,
        enabled: true,
        mutationDeltaChance: 0.8,
        mutationDeltaInterpolationType: "exponential",
        mutationDelta: { min: [0.05, 0.3], max: [0.1, 0.6] },
        mutationDeltaAllowableRange: { min: -1, max: 1 },
        randomMutationRange: { min: 0.1, max: 1 }
      }),
      JSON.stringify({
        id: "c2",
        sourceNode: "gain1",
        targetNode: 0,
        weight: 1,
        enabled: true,
        mutationDeltaChance: 0.8,
        mutationDeltaInterpolationType: "exponential",
        mutationDelta: { min: [0.05, 0.3], max: [0.1, 0.6] },
        mutationDeltaAllowableRange: { min: -1, max: 1 },
        randomMutationRange: { min: 0.1, max: 1 }
      })
    ]
  }),
  waveNetwork: {
    nodes: [
      { name: "output", type: "output", activation: "linear", index: 0 },
      { name: "x", type: "input", activation: "linear", index: 1 },
      { name: "y", type: "input", activation: "linear", index: 2 }
    ],
    connections: []
  }
};

async function renderBatchMode() {
  console.log('🎵 Rendering with BATCH mode...');

  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const startTime = performance.now();

  // Use the exact same function that batch mode uses
  const result = await renderAudioAndSpectrogram(
    TEST_GENOME.asNEATPatch,
    TEST_GENOME.waveNetwork,
    DURATION,
    0,        // noteDelta
    0.5,      // velocity
    SAMPLE_RATE,
    false,    // reverse
    false,    // asDataArray
    context,
    null,     // audioContext
    false,    // useOvertoneInharmonicityFactors
    true,     // useGPU
    false,    // antiAliasing
    false     // frequencyUpdatesApplyToAllPathcNetworkOutputs
  );

  const renderTime = performance.now() - startTime;

  console.log(`  ✓ Rendered in ${renderTime.toFixed(1)}ms`);

  return {
    buffer: result.audioBuffer,
    time: renderTime
  };
}

async function renderStreamingMode() {
  console.log('🎵 Rendering with STREAMING mode...');

  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const startTime = performance.now();

  // Streaming mode also uses the same function now (via StreamingRenderer)
  const { StreamingRenderer } = await import('./util/streaming-renderer.js');
  const renderer = new StreamingRenderer(null, SAMPLE_RATE);

  const buffer = await renderer.render(
    { genome: TEST_GENOME },
    DURATION,
    context
  );

  const renderTime = performance.now() - startTime;

  console.log(`  ✓ Rendered in ${renderTime.toFixed(1)}ms`);

  return {
    buffer,
    time: renderTime
  };
}

function analyzeBuffer(data, label) {
  let min = Infinity, max = -Infinity;
  let sum = 0, sumSquared = 0;
  let zeros = 0, nans = 0, infs = 0;

  for (let i = 0; i < data.length; i++) {
    const s = data[i];

    if (isNaN(s)) {
      nans++;
      continue;
    }
    if (!isFinite(s)) {
      infs++;
      continue;
    }
    if (s === 0) {
      zeros++;
    }

    if (s < min) min = s;
    if (s > max) max = s;
    sum += s;
    sumSquared += s * s;
  }

  const mean = sum / data.length;
  const rms = Math.sqrt(sumSquared / data.length);

  return { label, min, max, mean, rms, zeros, nans, infs, length: data.length };
}

function compareBuffers(batchData, streamingData) {
  if (batchData.length !== streamingData.length) {
    throw new Error(`Length mismatch: ${batchData.length} vs ${streamingData.length}`);
  }

  let differences = 0;
  let maxDiff = 0;
  let maxDiffIndex = 0;
  let sumSquaredDiff = 0;
  let sumBatch = 0, sumStreaming = 0;
  let sumProduct = 0;
  let sumBatchSquared = 0, sumStreamingSquared = 0;

  for (let i = 0; i < batchData.length; i++) {
    const diff = Math.abs(batchData[i] - streamingData[i]);

    if (diff > 1e-9) {
      differences++;
      if (diff > maxDiff) {
        maxDiff = diff;
        maxDiffIndex = i;
      }
    }

    sumSquaredDiff += diff * diff;
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
  const correlation = denominator === 0 ? 1.0 : numerator / denominator;

  return {
    differences,
    maxDiff,
    maxDiffIndex,
    rmse,
    correlation,
    identicalPercentage: ((n - differences) / n * 100)
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('BATCH vs STREAMING PARITY VERIFICATION');
  console.log('='.repeat(80));
  console.log();
  console.log('This test renders the same genome in both modes and compares:');
  console.log('  - Sample-by-sample quantitative metrics');
  console.log('  - Exports WAV files for qualitative listening');
  console.log();

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Render both modes
  const batch = await renderBatchMode();
  console.log();
  const streaming = await renderStreamingMode();
  console.log();

  // Extract audio data
  const batchData = batch.buffer.getChannelData(0);
  const streamingData = streaming.buffer.getChannelData(0);

  // Analyze individual buffers
  console.log('📊 INDIVIDUAL BUFFER ANALYSIS:');
  console.log('='.repeat(80));

  const batchStats = analyzeBuffer(batchData, 'Batch');
  const streamingStats = analyzeBuffer(streamingData, 'Streaming');

  console.log();
  console.log('Batch Mode:');
  console.log(`  Length:    ${batchStats.length.toLocaleString()} samples`);
  console.log(`  Peak:      ${batchStats.max.toFixed(6)}`);
  console.log(`  Min:       ${batchStats.min.toFixed(6)}`);
  console.log(`  Mean:      ${batchStats.mean.toFixed(6)}`);
  console.log(`  RMS:       ${batchStats.rms.toFixed(6)}`);
  console.log(`  Zeros:     ${batchStats.zeros}`);
  console.log(`  NaN:       ${batchStats.nans}`);
  console.log(`  Inf:       ${batchStats.infs}`);

  console.log();
  console.log('Streaming Mode:');
  console.log(`  Length:    ${streamingStats.length.toLocaleString()} samples`);
  console.log(`  Peak:      ${streamingStats.max.toFixed(6)}`);
  console.log(`  Min:       ${streamingStats.min.toFixed(6)}`);
  console.log(`  Mean:      ${streamingStats.mean.toFixed(6)}`);
  console.log(`  RMS:       ${streamingStats.rms.toFixed(6)}`);
  console.log(`  Zeros:     ${streamingStats.zeros}`);
  console.log(`  NaN:       ${streamingStats.nans}`);
  console.log(`  Inf:       ${streamingStats.infs}`);

  // Compare buffers
  console.log();
  console.log();
  console.log('📊 SAMPLE-BY-SAMPLE COMPARISON:');
  console.log('='.repeat(80));

  const comparison = compareBuffers(batchData, streamingData);

  console.log();
  console.log(`  Total samples:           ${batchData.length.toLocaleString()}`);
  console.log(`  Identical samples:       ${(batchData.length - comparison.differences).toLocaleString()} (${comparison.identicalPercentage.toFixed(6)}%)`);
  console.log(`  Different samples:       ${comparison.differences.toLocaleString()}`);
  console.log(`  Max difference:          ${comparison.maxDiff.toExponential(6)} (at sample ${comparison.maxDiffIndex})`);
  console.log(`  RMSE:                    ${comparison.rmse.toExponential(6)}`);
  console.log(`  Pearson correlation:     ${comparison.correlation.toFixed(12)}`);

  // Export WAV files
  console.log();
  console.log();
  console.log('💾 EXPORTING WAV FILES:');
  console.log('='.repeat(80));

  const batchWav = new WaveFile();
  batchWav.fromScratch(1, SAMPLE_RATE, '32f', batchData);
  const batchPath = `${OUTPUT_DIR}/batch.wav`;
  fs.writeFileSync(batchPath, batchWav.toBuffer());
  console.log(`  ✓ ${batchPath}`);

  const streamingWav = new WaveFile();
  streamingWav.fromScratch(1, SAMPLE_RATE, '32f', streamingData);
  const streamingPath = `${OUTPUT_DIR}/streaming.wav`;
  fs.writeFileSync(streamingPath, streamingWav.toBuffer());
  console.log(`  ✓ ${streamingPath}`);

  // Write analysis report
  const reportPath = `${OUTPUT_DIR}/analysis.txt`;
  const report = `
BATCH vs STREAMING PARITY VERIFICATION
${'='.repeat(80)}

Test Date: ${new Date().toISOString()}
Duration: ${DURATION}s
Sample Rate: ${SAMPLE_RATE}Hz

RENDER TIMES:
  Batch:     ${batch.time.toFixed(1)}ms
  Streaming: ${streaming.time.toFixed(1)}ms

INDIVIDUAL BUFFER STATS:

Batch Mode:
  Length:    ${batchStats.length} samples
  Peak:      ${batchStats.max}
  Min:       ${batchStats.min}
  Mean:      ${batchStats.mean}
  RMS:       ${batchStats.rms}
  Zeros:     ${batchStats.zeros}
  NaN:       ${batchStats.nans}
  Inf:       ${batchStats.infs}

Streaming Mode:
  Length:    ${streamingStats.length} samples
  Peak:      ${streamingStats.max}
  Min:       ${streamingStats.min}
  Mean:      ${streamingStats.mean}
  RMS:       ${streamingStats.rms}
  Zeros:     ${streamingStats.zeros}
  NaN:       ${streamingStats.nans}
  Inf:       ${streamingStats.infs}

SAMPLE-BY-SAMPLE COMPARISON:
  Total samples:        ${batchData.length}
  Identical samples:    ${batchData.length - comparison.differences} (${comparison.identicalPercentage}%)
  Different samples:    ${comparison.differences}
  Max difference:       ${comparison.maxDiff} (at sample ${comparison.maxDiffIndex})
  RMSE:                 ${comparison.rmse}
  Pearson correlation:  ${comparison.correlation}

PARITY STATUS: ${comparison.differences === 0 ? 'PERFECT PARITY ✅' : comparison.maxDiff < 1e-6 ? 'NEAR PARITY ✅' : 'DIFFERENCES DETECTED ⚠️'}
`;

  fs.writeFileSync(reportPath, report);
  console.log(`  ✓ ${reportPath}`);

  // Show sample values at difference point
  if (comparison.maxDiff > 0) {
    console.log();
    console.log(`Sample values at max difference (index ${comparison.maxDiffIndex}):`);
    console.log(`  Batch:     ${batchData[comparison.maxDiffIndex]}`);
    console.log(`  Streaming: ${streamingData[comparison.maxDiffIndex]}`);
    console.log(`  Diff:      ${comparison.maxDiff}`);
  }

  // Final verdict
  console.log();
  console.log();
  console.log('='.repeat(80));
  console.log('VERDICT:');
  console.log('='.repeat(80));
  console.log();

  if (comparison.differences === 0) {
    console.log('✅ PERFECT PARITY ACHIEVED!');
    console.log('   Outputs are BYTE-FOR-BYTE IDENTICAL.');
    console.log('   Streaming mode produces exactly the same output as batch mode.');
  } else if (comparison.maxDiff < 1e-6) {
    console.log('✅ EXCELLENT PARITY!');
    console.log('   Differences are within floating-point precision.');
    console.log(`   Max difference: ${comparison.maxDiff.toExponential(6)}`);
    console.log(`   Correlation: ${comparison.correlation.toFixed(12)}`);
  } else if (comparison.maxDiff < 1e-3) {
    console.log('⚠️  MINOR DIFFERENCES DETECTED');
    console.log(`   Max difference: ${comparison.maxDiff.toExponential(6)}`);
    console.log(`   RMSE: ${comparison.rmse.toExponential(6)}`);
    console.log(`   Correlation: ${comparison.correlation.toFixed(12)}`);
    console.log('   Listen to WAV files to assess audibility.');
  } else {
    console.log('❌ SIGNIFICANT DIFFERENCES DETECTED');
    console.log(`   Max difference: ${comparison.maxDiff.toExponential(6)}`);
    console.log(`   RMSE: ${comparison.rmse.toExponential(6)}`);
    console.log(`   Correlation: ${comparison.correlation.toFixed(12)}`);
    console.log('   Outputs are NOT identical.');
  }

  console.log();
  console.log('📁 Output files:');
  console.log(`   ${batchPath}`);
  console.log(`   ${streamingPath}`);
  console.log(`   ${reportPath}`);
  console.log();
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
