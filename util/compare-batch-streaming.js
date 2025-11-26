#!/usr/bin/env node
/**
 * Compare batch and streaming rendering modes
 *
 * Features:
 * - Sample-by-sample quantitative comparison
 * - Audio file export for qualitative comparison
 * - Statistical analysis (correlation, RMSE, max difference)
 * - Single genome or bulk database testing
 *
 * Usage:
 *   # Single genome
 *   node util/compare-batch-streaming.js --genome-id 01JF2N9RZ07V06EJ4DJ9ZGCM2D
 *
 *   # Bulk test (first N genomes)
 *   node util/compare-batch-streaming.js --db-path /path/to/genomes.sqlite --count 10
 *
 *   # Export audio files
 *   node util/compare-batch-streaming.js --genome-id <id> --export-audio ./output
 */

import fs from 'fs';
import path from 'path';
import { getAudioBufferFromGenomeAndMeta } from './audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext, OfflineAudioContext } = NodeWebAudioAPI;
import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { writeFile } from 'node:fs/promises';

const gunzip = promisify(zlib.gunzip);

const DEFAULT_DB_PATH = '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';
const DURATION = 1.0;
const SAMPLE_RATE = 48000;

/**
 * Load genome from database
 */
async function loadGenome(genomeId, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT data FROM genomes WHERE id = ?').get(genomeId);
  db.close();

  if (!row) return null;

  const jsonData = await gunzip(row.data);
  const genomeData = JSON.parse(jsonData);
  return genomeData.genome || genomeData;
}

/**
 * Render genome in specified mode
 */
async function renderGenome(genome, mode, duration = DURATION) {
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * duration),
    sampleRate: SAMPLE_RATE
  });

  const genomeAndMeta = {
    genome,
    duration,
    noteDelta: 0,
    velocity: 0.5,
    reverse: false
  };

  try {
    const buffer = await getAudioBufferFromGenomeAndMeta(
      genomeAndMeta, duration, 0, 0.5, false, false,
      offlineContext, audioContext, false, true, false, false,
      undefined, undefined, mode
    );

    return {
      success: true,
      buffer,
      samples: buffer.getChannelData(0)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Compare two sample arrays
 */
function compareSamples(samples1, samples2, label1 = 'batch', label2 = 'streaming') {
  const length = Math.min(samples1.length, samples2.length);

  let sumSquaredDiff = 0;
  let maxDiff = 0;
  let maxDiffIndex = 0;
  let sumProduct = 0;
  let sumSquares1 = 0;
  let sumSquares2 = 0;
  let identicalCount = 0;
  let closeCount = 0; // Within 1% of peak

  for (let i = 0; i < length; i++) {
    const s1 = samples1[i];
    const s2 = samples2[i];
    const diff = Math.abs(s1 - s2);

    sumSquaredDiff += diff * diff;

    if (diff > maxDiff) {
      maxDiff = diff;
      maxDiffIndex = i;
    }

    if (diff === 0) {
      identicalCount++;
    } else if (diff < 0.01) {
      closeCount++;
    }

    // For correlation
    sumProduct += s1 * s2;
    sumSquares1 += s1 * s1;
    sumSquares2 += s2 * s2;
  }

  const rmse = Math.sqrt(sumSquaredDiff / length);
  const correlation = sumProduct / (Math.sqrt(sumSquares1) * Math.sqrt(sumSquares2));

  return {
    length,
    rmse,
    maxDiff,
    maxDiffIndex,
    maxDiffSample: { [label1]: samples1[maxDiffIndex], [label2]: samples2[maxDiffIndex] },
    correlation,
    identicalCount,
    identicalPercent: (identicalCount / length) * 100,
    closeCount,
    closePercent: (closeCount / length) * 100,
    areIdentical: identicalCount === length,
    areSimilar: correlation > 0.99 && rmse < 0.01
  };
}

/**
 * Analyze audio buffer
 */
function analyzeBuffer(samples, label) {
  let valid = 0, zeros = 0, nans = 0, infs = 0, peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (isNaN(s)) {
      nans++;
    } else if (!isFinite(s)) {
      infs++;
    } else if (s === 0) {
      zeros++;
    } else {
      valid++;
      peak = Math.max(peak, Math.abs(s));
    }
  }

  return {
    label,
    total: samples.length,
    valid,
    validPercent: (valid / samples.length) * 100,
    zeros,
    nans,
    infs,
    peak,
    isValid: nans === 0 && infs === 0
  };
}

/**
 * Export audio buffer to WAV file
 */
async function exportWav(samples, sampleRate, filePath) {
  // Simple WAV file writer
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * bitsPerSample / 8;
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // Chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;  // Audio format (PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    buffer.writeInt16LE(intSample, offset);
    offset += 2;
  }

  await writeFile(filePath, buffer);
}

/**
 * Compare single genome
 */
async function compareSingleGenome(genomeId, dbPath, exportAudioPath = null) {
  console.log('='.repeat(80));
  console.log(`COMPARING GENOME: ${genomeId}`);
  console.log('='.repeat(80));
  console.log();

  // Load genome
  console.log('📂 Loading genome...');
  const genome = await loadGenome(genomeId, dbPath);
  if (!genome) {
    console.error('❌ Genome not found');
    return { success: false, error: 'Genome not found' };
  }
  console.log('   ✓ Loaded');
  console.log();

  // Render in batch mode
  console.log('🎵 Rendering in BATCH mode...');
  const batchStart = performance.now();
  const batchResult = await renderGenome(genome, 'batch');
  const batchTime = performance.now() - batchStart;

  if (!batchResult.success) {
    console.error(`   ❌ Failed: ${batchResult.error}`);
    return { success: false, mode: 'batch', error: batchResult.error };
  }
  console.log(`   ✓ Completed in ${batchTime.toFixed(1)}ms`);
  console.log();

  // Render in streaming mode
  console.log('🎵 Rendering in STREAMING mode...');
  const streamingStart = performance.now();
  const streamingResult = await renderGenome(genome, 'streaming');
  const streamingTime = performance.now() - streamingStart;

  if (!streamingResult.success) {
    console.error(`   ❌ Failed: ${streamingResult.error}`);
    return { success: false, mode: 'streaming', error: streamingResult.error };
  }
  console.log(`   ✓ Completed in ${streamingTime.toFixed(1)}ms`);
  console.log();

  // Analyze each buffer
  console.log('📊 ANALYSIS');
  console.log('-'.repeat(80));
  const batchAnalysis = analyzeBuffer(batchResult.samples, 'batch');
  const streamingAnalysis = analyzeBuffer(streamingResult.samples, 'streaming');

  console.log(`Batch:     Valid: ${batchAnalysis.validPercent.toFixed(2)}%, Peak: ${batchAnalysis.peak.toFixed(6)}, NaN: ${batchAnalysis.nans}, Inf: ${batchAnalysis.infs}`);
  console.log(`Streaming: Valid: ${streamingAnalysis.validPercent.toFixed(2)}%, Peak: ${streamingAnalysis.peak.toFixed(6)}, NaN: ${streamingAnalysis.nans}, Inf: ${streamingAnalysis.infs}`);
  console.log();

  // Compare samples
  console.log('📊 COMPARISON');
  console.log('-'.repeat(80));
  const comparison = compareSamples(batchResult.samples, streamingResult.samples);

  console.log(`Samples:      ${comparison.length}`);
  console.log(`RMSE:         ${comparison.rmse.toFixed(8)}`);
  console.log(`Correlation:  ${comparison.correlation.toFixed(8)}`);
  console.log(`Max diff:     ${comparison.maxDiff.toFixed(8)} at index ${comparison.maxDiffIndex}`);
  console.log(`  Batch:      ${comparison.maxDiffSample.batch.toFixed(8)}`);
  console.log(`  Streaming:  ${comparison.maxDiffSample.streaming.toFixed(8)}`);
  console.log(`Identical:    ${comparison.identicalCount} (${comparison.identicalPercent.toFixed(2)}%)`);
  console.log(`Close (<1%):  ${comparison.closeCount} (${comparison.closePercent.toFixed(2)}%)`);
  console.log();

  // Verdict
  console.log('VERDICT');
  console.log('-'.repeat(80));
  if (comparison.areIdentical) {
    console.log('✅ IDENTICAL: Batch and streaming produce identical output');
  } else if (comparison.areSimilar) {
    console.log('✅ SIMILAR: Batch and streaming produce very similar output');
    console.log('   (Correlation > 0.99, RMSE < 0.01)');
  } else {
    console.log('⚠️  DIFFERENT: Outputs differ significantly');
    console.log(`   Correlation: ${comparison.correlation.toFixed(4)}, RMSE: ${comparison.rmse.toFixed(6)}`);
  }
  console.log();

  // Export audio files if requested
  if (exportAudioPath) {
    console.log('💾 EXPORTING AUDIO');
    console.log('-'.repeat(80));

    if (!fs.existsSync(exportAudioPath)) {
      fs.mkdirSync(exportAudioPath, { recursive: true });
    }

    const batchPath = path.join(exportAudioPath, `${genomeId}_batch.wav`);
    const streamingPath = path.join(exportAudioPath, `${genomeId}_streaming.wav`);

    await exportWav(batchResult.samples, SAMPLE_RATE, batchPath);
    await exportWav(streamingResult.samples, SAMPLE_RATE, streamingPath);

    console.log(`   Batch:     ${batchPath}`);
    console.log(`   Streaming: ${streamingPath}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log();

  return {
    success: true,
    genomeId,
    batchTime,
    streamingTime,
    batchAnalysis,
    streamingAnalysis,
    comparison
  };
}

/**
 * Bulk comparison
 */
async function bulkCompare(dbPath, count = 10, exportAudioPath = null) {
  console.log('='.repeat(80));
  console.log(`BULK COMPARISON: First ${count} genomes`);
  console.log('='.repeat(80));
  console.log();

  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id FROM genomes LIMIT ?').all(count);
  db.close();

  const results = [];
  let successCount = 0;
  let identicalCount = 0;
  let similarCount = 0;
  let differentCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const genomeId = rows[i].id;
    console.log(`[${i + 1}/${rows.length}] ${genomeId}`);

    const result = await compareSingleGenome(genomeId, dbPath, exportAudioPath);
    results.push(result);

    if (result.success) {
      successCount++;
      if (result.comparison.areIdentical) {
        identicalCount++;
      } else if (result.comparison.areSimilar) {
        similarCount++;
      } else {
        differentCount++;
      }
    }
  }

  // Summary
  console.log();
  console.log('='.repeat(80));
  console.log('BULK COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total tested:  ${rows.length}`);
  console.log(`Successful:    ${successCount}`);
  console.log(`Identical:     ${identicalCount}`);
  console.log(`Similar:       ${similarCount}`);
  console.log(`Different:     ${differentCount}`);
  console.log(`Failed:        ${rows.length - successCount}`);
  console.log('='.repeat(80));

  return results;
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  const genomeId = args[args.indexOf('--genome-id') + 1];
  const dbPath = args[args.indexOf('--db-path') + 1] || DEFAULT_DB_PATH;
  const count = parseInt(args[args.indexOf('--count') + 1] || '10');
  const exportAudio = args.includes('--export-audio')
    ? args[args.indexOf('--export-audio') + 1]
    : null;

  if (genomeId) {
    // Single genome comparison
    await compareSingleGenome(genomeId, dbPath, exportAudio);
  } else {
    // Bulk comparison
    await bulkCompare(dbPath, count, exportAudio);
  }
}

main().catch(err => {
  console.error('Comparison failed:', err);
  console.error(err.stack);
  process.exit(1);
});
