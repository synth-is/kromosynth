#!/usr/bin/env node
/**
 * Quick test to verify batch mode still works after streaming changes
 */

import fs from 'fs';
import { getAudioBufferFromGenomeAndMeta } from './util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext, OfflineAudioContext } = NodeWebAudioAPI;
import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

const GENOME_ID = '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
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

async function testBatchRender() {
    console.log('Testing BATCH mode (regression check)...');

    const genome = await loadGenome(GENOME_ID, DB_PATH);
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

    const buffer = await getAudioBufferFromGenomeAndMeta(
        genomeAndMeta, DURATION, 0, 0.5, false, false,
        offlineContext, audioContext, false, true, false, false,
        undefined, undefined,
        'batch'  // Explicit batch mode
    );

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

    console.log(`Valid: ${valid}/${samples.length} (${((valid / samples.length) * 100).toFixed(2)}%)`);
    console.log(`NaN: ${nans}, Inf: ${infs}, Peak: ${peak.toFixed(6)}`);

    if (nans === 0 && infs === 0 && valid > 0) {
        console.log('✅ BATCH MODE: Still working correctly');
        process.exit(0);
    } else {
        console.log('❌ BATCH MODE: REGRESSION DETECTED!');
        process.exit(1);
    }
}

testBatchRender().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
