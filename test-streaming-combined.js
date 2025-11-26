#!/usr/bin/env node
/**
 * Test streaming render with combined wavetable + additive genome
 */

import fs from 'fs';
import { getAudioBufferFromGenomeAndMeta } from './util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext, OfflineAudioContext } = NodeWebAudioAPI;
import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

// Combined wavetable + additive genome
const GENOME_ID = '01JF0WHAXBZK7Z59003FCC3CVK';
const DB_PATH = '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';
const DURATION = 1.0;
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

async function testCombinedRender() {
    console.log('='.repeat(80));
    console.log('COMBINED WAVETABLE + ADDITIVE TEST');
    console.log('='.repeat(80));
    console.log();

    console.log('📂 Loading combined genome...');
    const genome = await loadGenome(GENOME_ID, DB_PATH);
    console.log('   ✓ Genome loaded');
    console.log();

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const offlineContext = new OfflineAudioContext({
        numberOfChannels: 1,
        length: Math.round(SAMPLE_RATE * DURATION),
        sampleRate: SAMPLE_RATE
    });

    const genomeAndMeta = {
        genome: genome,
        duration: DURATION,
        noteDelta: 0,
        velocity: 0.5,
        reverse: false
    };

    console.log('🎵 Rendering with STREAMING mode (wavetable + additive)...');
    const startTime = performance.now();

    const buffer = await getAudioBufferFromGenomeAndMeta(
        genomeAndMeta, DURATION, 0, 0.5, false, false,
        offlineContext, audioContext, false, true, false, false,
        undefined, undefined, 'streaming'
    );

    const renderTime = performance.now() - startTime;
    console.log();
    console.log(`✓ Rendered in ${renderTime.toFixed(1)}ms`);

    const samples = buffer.getChannelData(0);
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

    console.log();
    console.log('📊 Statistics:');
    console.log(`   Total:   ${samples.length}`);
    console.log(`   Valid:   ${valid} (${((valid / samples.length) * 100).toFixed(2)}%)`);
    console.log(`   Zero:    ${zeros}`);
    console.log(`   NaN:     ${nans}`);
    console.log(`   Inf:     ${infs}`);
    console.log(`   Peak:    ${peak.toFixed(6)}`);
    console.log();

    if (nans === 0 && infs === 0 && valid > 0) {
        console.log('✅ SUCCESS: Combined wavetable + additive rendered valid audio!');
        console.log('='.repeat(80));
        process.exit(0);
    } else {
        console.log('❌ FAIL: Audio contains NaN or Inf values');
        console.log('='.repeat(80));
        process.exit(1);
    }
}

testCombinedRender().catch(err => {
    console.error('Test failed:', err);
    console.error(err.stack);
    process.exit(1);
});
