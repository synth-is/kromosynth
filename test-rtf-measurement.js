#!/usr/bin/env node
/**
 * Test RTF Measurement and Adaptive Chunk Calculation
 *
 * Measures how fast we can render audio and calculates optimal chunk sizes
 * for millisecond-range latency to first sound.
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { StreamingRenderer } from './util/streaming-renderer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext, AudioContext } = NodeWebAudioAPI;

const gunzip = promisify(zlib.gunzip);

const GENOME_ID = '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
const DB_PATH = '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';
const SAMPLE_RATE = 48000;

async function loadGenome(genomeId, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT data FROM genomes WHERE id = ?').get(genomeId);
  if (!row) throw new Error(`Genome ${genomeId} not found`);

  const jsonData = await gunzip(row.data);
  const genomeData = JSON.parse(jsonData);
  db.close();

  return genomeData.genome || genomeData;
}

async function testRTF() {
  console.log('='.repeat(80));
  console.log('RTF MEASUREMENT & ADAPTIVE CHUNKING TEST');
  console.log('='.repeat(80));
  console.log();

  // Load genome
  console.log('📂 Loading genome...');
  const genome = await loadGenome(GENOME_ID, DB_PATH);
  console.log(`   ✓ Loaded: ${GENOME_ID}`);
  console.log();

  const genomeAndMeta = {
    genome,
    duration: 2.0,
    noteDelta: 0,
    velocity: 0.5,
    reverse: false
  };

  // Create AudioContext for CPPN rendering
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  // Test with different target latencies
  const targetLatencies = [0.05, 0.1, 0.5, 1.0, 2.0]; // 50ms, 100ms, 500ms, 1s, 2s

  for (const targetLatency of targetLatencies) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Target Latency: ${targetLatency * 1000}ms`);
    console.log('─'.repeat(80));

    const renderer = new StreamingRenderer(audioContext, SAMPLE_RATE, {
      useGPU: true,
      targetLatency,
      enableAdaptiveChunking: true
    });

    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: Math.round(SAMPLE_RATE * 2.0),
      sampleRate: SAMPLE_RATE
    });

    // This will measure RTF and calculate optimal chunk size
    await renderer.render(genomeAndMeta, 2.0, context);

    console.log();
  }

  console.log();
  console.log('='.repeat(80));
  console.log('✅ RTF MEASUREMENT COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Summary:');
  console.log('  - RTF measured by rendering 0.5s test chunk');
  console.log('  - Chunk size adaptively calculated: targetLatency / RTF');
  console.log('  - Clamped to 0.1s - 5.0s range');
  console.log();
  console.log('Next step: Implement suspend/resume with calculated chunk sizes');
  console.log('           for progressive audio delivery!');
  console.log();

  // Clean up
  await audioContext.close();
}

testRTF().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
