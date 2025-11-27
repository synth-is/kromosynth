#!/usr/bin/env node
/**
 * Real-Time Streaming Audio Demo
 *
 * Demonstrates progressive audio rendering with immediate playback:
 * - Load any genome from database
 * - Specify duration, pitch (noteDelta), and velocity
 * - Hear audio within milliseconds as it renders
 * - Audio plays to your default audio device in real-time!
 *
 * Usage:
 *   node demo-realtime-streaming.js [duration] [noteDelta] [velocity]
 *
 * Examples:
 *   node demo-realtime-streaming.js                    # 10s, note 0, velocity 0.5
 *   node demo-realtime-streaming.js 30                 # 30s render
 *   node demo-realtime-streaming.js 20 -12 0.8         # 20s, octave down, louder
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { writeFileSync } from 'fs';
import { StreamingRenderer } from './util/streaming-renderer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext, AudioContext } = NodeWebAudioAPI;

const gunzip = promisify(zlib.gunzip);

// Configuration
const GENOME_ID = '01JF2RQPZHG2SPEKM7AFK7PX31'; // '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
const DB_PATH = '/Users/bjornpjo/QD/evoruns/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';
const SAMPLE_RATE = 48000;

// Parse command-line arguments
const args = process.argv.slice(2);
const DURATION = args[0] ? parseFloat(args[0]) : 10.0;
const NOTE_DELTA = args[1] ? parseFloat(args[1]) : 0;
const VELOCITY = args[2] ? parseFloat(args[2]) : 0.5;

async function loadGenome(genomeId, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT data FROM genomes WHERE id = ?').get(genomeId);
  if (!row) throw new Error(`Genome ${genomeId} not found`);

  const jsonData = await gunzip(row.data);
  const genomeData = JSON.parse(jsonData);
  db.close();

  return genomeData.genome || genomeData;
}

function writeWavFile(audioBuffer, filename) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = channelData.length;

  // Convert float32 to int16
  const int16Data = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // Create WAV header
  const dataSize = int16Data.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const bytes = new Uint8Array(buffer);
  bytes.set(new Uint8Array(int16Data.buffer), 44);

  writeFileSync(filename, Buffer.from(buffer));
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

class RealtimeAudioPlayer {
  constructor(audioContext, sampleRate, minBufferDuration = 0.05, scheduleBatchSize = 0.1) {
    this.audioContext = audioContext;
    this.sampleRate = sampleRate;
    this.chunks = [];
    this.nextPlayTime = null;
    this.totalSamplesReceived = 0;
    this.totalSamplesScheduled = 0;
    this.isPlaying = false;
    this.minBufferSamples = Math.round(minBufferDuration * sampleRate);

    // Batching to reduce AudioBuffer creation overhead
    this.scheduleBatchSize = Math.round(scheduleBatchSize * sampleRate); // e.g., 0.1s = 4800 samples
    this.pendingBatch = [];
    this.pendingBatchSamples = 0;
  }

  /**
   * Add a chunk and schedule it for playback (with batching)
   */
  addChunk(chunkData) {
    this.chunks.push(chunkData);
    this.totalSamplesReceived += chunkData.length;

    // Start playback once we have minimum buffer
    if (!this.isPlaying && this.totalSamplesReceived >= this.minBufferSamples) {
      this.isPlaying = true;
      this.nextPlayTime = this.audioContext.currentTime + 0.15; // 150ms initial delay for smooth start
      const bufferDuration = this.totalSamplesReceived / this.sampleRate;
      console.log(`\n🔊 Starting playback with ${bufferDuration.toFixed(2)}s buffer...`);
    }

    // Batch chunks together before scheduling (reduces AudioBuffer overhead)
    if (this.isPlaying) {
      this.pendingBatch.push(chunkData);
      this.pendingBatchSamples += chunkData.length;

      // Schedule batch when it reaches target size
      if (this.pendingBatchSamples >= this.scheduleBatchSize) {
        this.scheduleBatch();
      }
    }
  }

  /**
   * Schedule accumulated batch of chunks as a single AudioBuffer
   */
  scheduleBatch() {
    if (this.pendingBatch.length === 0) return;

    // Combine pending chunks into single Float32Array
    const combinedData = new Float32Array(this.pendingBatchSamples);
    let offset = 0;
    for (const chunk of this.pendingBatch) {
      combinedData.set(chunk, offset);
      offset += chunk.length;
    }

    // Schedule the combined buffer
    this.scheduleChunk(combinedData);

    // Reset batch
    this.pendingBatch = [];
    this.pendingBatchSamples = 0;
  }

  /**
   * Flush any remaining batched chunks
   */
  flushBatch() {
    if (this.pendingBatch.length > 0) {
      this.scheduleBatch();
    }
  }

  /**
   * Schedule a chunk for playback
   */
  scheduleChunk(chunkData) {
    // Create AudioBuffer from chunk
    const buffer = this.audioContext.createBuffer(
      1, // mono
      chunkData.length,
      this.sampleRate
    );
    buffer.copyToChannel(chunkData, 0);

    // Create source node
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    // Schedule playback
    source.start(this.nextPlayTime);

    // Update next play time
    const chunkDuration = chunkData.length / this.sampleRate;
    this.nextPlayTime += chunkDuration;
    this.totalSamplesScheduled += chunkData.length;
  }

  /**
   * Get current playback status
   */
  getStatus() {
    const currentTime = this.audioContext.currentTime;
    const playbackProgress = this.totalSamplesScheduled / this.sampleRate;
    const timeUntilComplete = Math.max(0, this.nextPlayTime - currentTime);

    return {
      currentTime,
      playbackProgress,
      timeUntilComplete,
      chunksReceived: this.chunks.length,
      samplesReceived: this.totalSamplesReceived,
      samplesScheduled: this.totalSamplesScheduled
    };
  }
}

async function demo() {
  console.log('='.repeat(80));
  console.log('🎵 REAL-TIME STREAMING AUDIO DEMO');
  console.log('='.repeat(80));
  console.log();
  console.log('This demo progressively renders audio and plays it in real-time');
  console.log('to your default audio device. Listen as the sound emerges!');
  console.log();
  console.log(`Genome:    ${GENOME_ID}`);
  console.log(`Duration:  ${DURATION}s`);
  console.log(`Pitch:     ${NOTE_DELTA > 0 ? '+' : ''}${NOTE_DELTA} semitones`);
  console.log(`Velocity:  ${VELOCITY}`);
  console.log();

  // Load genome
  console.log('📂 Loading genome...');
  const genomeLoadStart = Date.now();
  const genome = await loadGenome(GENOME_ID, DB_PATH);
  const genomeLoadTime = Date.now() - genomeLoadStart;
  console.log(`   ✓ Loaded in ${genomeLoadTime}ms`);
  console.log();

  const genomeAndMeta = {
    genome,
    duration: DURATION,
    noteDelta: NOTE_DELTA,
    velocity: VELOCITY,
    reverse: false
  };

  // Create audio contexts
  const onlineAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const offlineAudioContext = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(SAMPLE_RATE * DURATION),
    sampleRate: SAMPLE_RATE
  });

  // Create real-time player with 2-second buffer (balance between latency and smoothness)
  const player = new RealtimeAudioPlayer(onlineAudioContext, SAMPLE_RATE, 2.0);

  // Create renderer (measureRTF disabled for instant startup)
  const renderer = new StreamingRenderer(onlineAudioContext, SAMPLE_RATE, {
    useGPU: true,
    measureRTF: false,  // Skip ~3s RTF measurement for instant startup
    defaultChunkDuration: 0.25,  // 250ms chunks for faster first audio
    enableAdaptiveChunking: true
  });

  console.log('🎬 Starting progressive render...');
  console.log();

  let firstChunkReceived = false;
  const startTime = Date.now();

  // Start rendering with progressive playback
  const renderPromise = renderer.render(
    genomeAndMeta,
    DURATION,
    offlineAudioContext,
    {
      onChunk: (chunk) => {
        if (!firstChunkReceived) {
          const latency = Date.now() - startTime;
          console.log(`⚡ FIRST AUDIO in ${latency}ms!`);
          console.log();
          firstChunkReceived = true;
        }

        // Add chunk to player - it will be scheduled for real-time playback
        player.addChunk(chunk);

        // Periodic status updates (disabled - console.log can block audio thread)
        // const now = Date.now();
        // if (now - lastProgressUpdate > 500) {  // Update every 500ms
        //   const status = player.getStatus();
        //   const receivedSeconds = status.samplesReceived / SAMPLE_RATE;
        //   const scheduledSeconds = status.samplesScheduled / SAMPLE_RATE;

        //   process.stdout.write(
        //     `\r  Rendering: ${receivedSeconds.toFixed(1)}s / ${DURATION}s  |  ` +
        //     `Playing: ${scheduledSeconds.toFixed(1)}s  |  ` +
        //     `Buffer: ${status.timeUntilComplete.toFixed(1)}s ahead     `
        //   );

        //   lastProgressUpdate = now;
        // }
      },
      onProgress: () => {
        // Progress tracking handled by onChunk callback
      }
    }
  );

  // Wait for rendering to complete
  const finalBuffer = await renderPromise;
  const totalTime = Date.now() - startTime;

  // Flush any remaining batched chunks
  player.flushBatch();

  console.log();
  console.log();
  console.log('✅ Rendering complete!');
  console.log();

  // Write to WAV file for verification
  const wavFilename = `./realtime-streaming-${GENOME_ID.slice(-8)}_${DURATION}s.wav`;
  console.log(`💾 Writing WAV file: ${wavFilename}`);
  writeWavFile(finalBuffer, wavFilename);
  console.log(`   ✓ WAV file written`);
  console.log();

  const status = player.getStatus();
  console.log(`Total render time:  ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Audio duration:     ${DURATION}s`);
  console.log(`Chunks received:    ${status.chunksReceived}`);
  console.log(`Samples received:   ${status.samplesReceived.toLocaleString()}`);
  console.log();
  console.log(`🔊 Audio is still playing... (${status.timeUntilComplete.toFixed(1)}s remaining)`);
  console.log();
  console.log('Press Ctrl+C to stop playback and exit.');
  console.log();

  // Keep process alive while audio plays
  const checkInterval = setInterval(() => {
    const status = player.getStatus();
    if (status.timeUntilComplete <= 0) {
      console.log();
      console.log('🎵 Playback complete!');
      console.log();
      clearInterval(checkInterval);
      onlineAudioContext.close();
      process.exit(0);
    }
  }, 100);
}

demo().catch(err => {
  // Ignore AudioWorklet cleanup errors (known issue in node-web-audio-api)
  if (err.message && err.message.includes('expect Object, got: Undefined')) {
    console.log();
    console.log('⚠️  AudioWorklet cleanup error (known issue - does not affect playback)');
    console.log();
    process.exit(0);
  }

  console.error('Demo failed:', err);
  console.error(err.stack);
  process.exit(1);
});

// Handle uncaught errors (AudioWorklet cleanup happens async)
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('expect Object, got: Undefined')) {
    // Don't exit - let playback complete!
    // The setInterval below will exit when playback finishes
    return;
  }
  throw err;
});
