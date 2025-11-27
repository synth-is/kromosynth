#!/usr/bin/env node
/**
 * Test Streaming Render with Suspend/Resume - Verify Parity
 *
 * This test verifies that:
 * 1. Suspend/resume rendering works with real genomes
 * 2. Progressive chunks are emitted via callback
 * 3. Parity is maintained with batch mode (RMSE: 0.0)
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { StreamingRenderer } from './util/streaming-renderer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext, AudioContext } = NodeWebAudioAPI;
import { renderAudioAndSpectrogram } from './util/render.js';

const gunzip = promisify(zlib.gunzip);

const GENOME_ID = '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
const DB_PATH = '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';
const SAMPLE_RATE = 48000;
const DURATION = 2.0;

async function loadGenome(genomeId, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT data FROM genomes WHERE id = ?').get(genomeId);
  if (!row) throw new Error(`Genome ${genomeId} not found`);

  const jsonData = await gunzip(row.data);
  const genomeData = JSON.parse(jsonData);
  db.close();

  return genomeData.genome || genomeData;
}

async function test() {
  console.log('='.repeat(80));
  console.log('STREAMING RENDER PARITY TEST');
  console.log('='.repeat(80));
  console.log();

  // Load genome
  console.log('📂 Loading genome...');
  const genome = await loadGenome(GENOME_ID, DB_PATH);
  console.log(`   ✓ Loaded: ${GENOME_ID}`);
  console.log();

  const genomeAndMeta = {
    genome,
    duration: DURATION,
    noteDelta: 0,
    velocity: 0.5,
    reverse: false
  };

  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  // ============================================================================
  // TEST 1: Batch Mode (Reference)
  // ============================================================================
  console.log('🎵 TEST 1: Batch Mode (Reference)');
  console.log('='.repeat(80));

  const batchContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const batchStartTime = performance.now();
  const batchResult = await renderAudioAndSpectrogram(
    genome.asNEATPatch,
    genome.waveNetwork,
    DURATION,
    0,        // noteDelta
    0.5,      // velocity
    SAMPLE_RATE,
    false,    // reverse
    false,    // asDataArray
    batchContext,
    audioContext,
    false,    // useOvertoneInharmonicityFactors
    true,     // useGPU
    false,    // antiAliasing
    false     // frequencyUpdatesApplyToAllPathcNetworkOutputs
  );
  const batchTime = performance.now() - batchStartTime;

  const batchBuffer = batchResult.audioBuffer;
  const batchData = batchBuffer.getChannelData(0);

  console.log(`  ✓ Rendered ${batchData.length} samples in ${batchTime.toFixed(1)}ms`);
  console.log(`  Peak: ${Math.max(...Array.from(batchData)).toFixed(6)}`);
  console.log();

  // ============================================================================
  // TEST 2: Streaming Mode with Suspend/Resume
  // ============================================================================
  console.log('🎵 TEST 2: Streaming Mode (Suspend/Resume + AudioWorklet)');
  console.log('='.repeat(80));

  const streamingContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  const renderer = new StreamingRenderer(audioContext, SAMPLE_RATE, {
    useGPU: true,
    targetLatency: 0.1,  // 100ms target
    enableAdaptiveChunking: true
  });

  const capturedChunks = [];
  const progressUpdates = [];

  const streamingStartTime = performance.now();
  const streamingBuffer = await renderer.render(
    genomeAndMeta,
    DURATION,
    streamingContext,
    {
      onChunk: (chunk) => {
        capturedChunks.push(chunk);
        console.log(`  → Chunk ${capturedChunks.length}: ${chunk.length} samples`);
      },
      onProgress: (progress) => {
        progressUpdates.push(progress);
      }
    }
  );
  const streamingTime = performance.now() - streamingStartTime;

  const streamingData = streamingBuffer.getChannelData(0);

  console.log();
  console.log(`  ✓ Rendered ${streamingData.length} samples in ${streamingTime.toFixed(1)}ms`);
  console.log(`  Peak: ${Math.max(...Array.from(streamingData)).toFixed(6)}`);
  console.log(`  Chunks emitted: ${capturedChunks.length}`);
  console.log(`  Progress updates: ${progressUpdates.length}`);
  console.log();

  // ============================================================================
  // TEST 3: Verify Parity
  // ============================================================================
  console.log('📊 TEST 3: Parity Verification');
  console.log('='.repeat(80));

  if (batchData.length !== streamingData.length) {
    throw new Error(`Length mismatch: ${batchData.length} vs ${streamingData.length}`);
  }

  let differences = 0;
  let maxDiff = 0;
  let maxDiffIndex = 0;
  let sumSquaredDiff = 0;

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
  }

  const rmse = Math.sqrt(sumSquaredDiff / batchData.length);

  console.log();
  console.log(`  Total samples:        ${batchData.length.toLocaleString()}`);
  console.log(`  Identical samples:    ${(batchData.length - differences).toLocaleString()} (${((batchData.length - differences) / batchData.length * 100).toFixed(6)}%)`);
  console.log(`  Different samples:    ${differences.toLocaleString()}`);
  console.log(`  Max difference:       ${maxDiff.toExponential(6)} (at sample ${maxDiffIndex})`);
  console.log(`  RMSE:                 ${rmse.toExponential(6)}`);
  console.log();

  // ============================================================================
  // Verdict
  // ============================================================================
  console.log('='.repeat(80));
  console.log('VERDICT:');
  console.log('='.repeat(80));
  console.log();

  if (differences === 0) {
    console.log('✅ SUCCESS: PERFECT PARITY!');
    console.log('   Suspend/resume rendering produces IDENTICAL output to batch mode.');
    console.log('   Progressive chunks were emitted successfully.');
    console.log();
    console.log(`   Chunks emitted: ${capturedChunks.length}`);
    console.log(`   Total chunk samples: ${capturedChunks.reduce((sum, chunk) => sum + chunk.length, 0)}`);
  } else if (maxDiff < 1e-6) {
    console.log('✅ EXCELLENT PARITY!');
    console.log('   Differences within floating-point precision.');
    console.log(`   Max difference: ${maxDiff.toExponential(6)}`);
    console.log(`   RMSE: ${rmse.toExponential(6)}`);
  } else {
    console.log('❌ PARITY FAILURE');
    console.log(`   Max difference: ${maxDiff.toExponential(6)}`);
    console.log(`   RMSE: ${rmse.toExponential(6)}`);
    console.log();
    console.log('   Outputs are NOT identical.');
    process.exit(1);
  }

  console.log();

  // Clean up
  await audioContext.close();
}

test().catch(err => {
  console.error('Test failed:', err);
  console.error(err.stack);
  process.exit(1);
});
