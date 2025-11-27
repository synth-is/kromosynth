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
import { StreamingRenderer } from './util/streaming-renderer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { OfflineAudioContext, AudioContext } = NodeWebAudioAPI;

const gunzip = promisify(zlib.gunzip);

// Configuration
const GENOME_ID = '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
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

class RealtimeAudioPlayer {
  constructor(audioContext, sampleRate, minBufferDuration = 0.05) {
    this.audioContext = audioContext;
    this.sampleRate = sampleRate;
    this.chunks = [];
    this.nextPlayTime = null;
    this.totalSamplesReceived = 0;
    this.totalSamplesScheduled = 0;
    this.isPlaying = false;
    this.minBufferSamples = Math.round(minBufferDuration * sampleRate);
  }

  /**
   * Add a chunk and schedule it for playback
   */
  addChunk(chunkData) {
    this.chunks.push(chunkData);
    this.totalSamplesReceived += chunkData.length;

    // Start playback once we have minimum buffer
    if (!this.isPlaying && this.totalSamplesReceived >= this.minBufferSamples) {
      this.isPlaying = true;
      this.nextPlayTime = this.audioContext.currentTime + 0.05; // 50ms initial delay
      const bufferDuration = this.totalSamplesReceived / this.sampleRate;
      console.log(`\n🔊 Starting playback with ${bufferDuration.toFixed(2)}s buffer...`);
    }

    // Schedule this chunk if playback started
    if (this.isPlaying) {
      this.scheduleChunk(chunkData);
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
  const genome = await loadGenome(GENOME_ID, DB_PATH);
  console.log(`   ✓ Loaded`);
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

  // Create real-time player with 2-second buffer to prevent underruns
  // (important for slow renders where RTF > 1)
  const player = new RealtimeAudioPlayer(onlineAudioContext, SAMPLE_RATE, 2.0);

  // Create renderer
  const renderer = new StreamingRenderer(onlineAudioContext, SAMPLE_RATE, {
    useGPU: true,
    targetLatency: 0.1,  // 100ms target
    enableAdaptiveChunking: true
  });

  console.log('🎬 Starting progressive render...');
  console.log();

  let lastProgressUpdate = Date.now();
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

        // Periodic status updates
        const now = Date.now();
        if (now - lastProgressUpdate > 500) {  // Update every 500ms
          const status = player.getStatus();
          const receivedSeconds = status.samplesReceived / SAMPLE_RATE;
          const scheduledSeconds = status.samplesScheduled / SAMPLE_RATE;

          process.stdout.write(
            `\r  Rendering: ${receivedSeconds.toFixed(1)}s / ${DURATION}s  |  ` +
            `Playing: ${scheduledSeconds.toFixed(1)}s  |  ` +
            `Buffer: ${status.timeUntilComplete.toFixed(1)}s ahead     `
          );

          lastProgressUpdate = now;
        }
      },
      onProgress: () => {
        // Progress tracking handled by onChunk callback
      }
    }
  );

  // Wait for rendering to complete
  await renderPromise;
  const totalTime = Date.now() - startTime;

  console.log();
  console.log();
  console.log('✅ Rendering complete!');
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
    console.log();
    console.log('⚠️  AudioWorklet cleanup error (known issue - audio completed successfully)');
    console.log();
    process.exit(0);
  }
  throw err;
});
