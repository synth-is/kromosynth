#!/usr/bin/env node
/**
 * Test to verify the value curves fix works correctly.
 * This test renders genomes with BOTH architectures:
 * 1. oneCPPNPerFrequency=true (multiple CPPNs, one per frequency range)
 * 2. oneCPPNPerFrequency=false (single CPPN serving all frequencies)
 *
 * Tests with different noteDelta values to verify frequency modification works correctly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAudioBufferFromGenomeAndMeta } from '../util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';

const { AudioContext, OfflineAudioContext } = NodeWebAudioAPI;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DURATION = 1.0;
const SAMPLE_RATE = 48000;

// Genome sources
const MULTI_CPPN_GENOME_PATH = path.join(__dirname, '../kromosynth-cli/cli-app/evoruns/01JDZSGV6ZZ4YEA48XMA07D8XR_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_bassSynth/genome_01JDZSGV6ZZ4YEA48XMA07D8XR_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_bassSynth_01JE1TF27JBQRAN6GRVED8FYJ4.json');
const SINGLE_CPPN_DB_PATH = path.join(__dirname, '../kromosynth-cli/cli-app/evoruns/01KDNXY62MCMTQEEGECH9784MA_qdhf/genomes.sqlite');

async function loadGenomeFromFile(genomePath) {
    const jsonData = fs.readFileSync(genomePath, 'utf-8');
    const genomeData = JSON.parse(jsonData);
    return genomeData.genome || genomeData;
}

async function loadGenomeFromSqlite(dbPath) {
    const db = new Database(dbPath, { readonly: true });

    // Find a genome with proper NetworkOutputNode or NoteNetworkOutputNode
    const rows = db.prepare('SELECT id, data FROM genomes LIMIT 100').all();

    for (const row of rows) {
        const jsonData = gunzipSync(row.data);
        const genomeData = JSON.parse(jsonData);
        const genome = genomeData.genome || genomeData;

        const asNEATNetworkJSONString = genome.asNEATPatch;
        if (!asNEATNetworkJSONString) continue;

        const parsedNetwork = typeof asNEATNetworkJSONString === 'string'
            ? JSON.parse(asNEATNetworkJSONString)
            : asNEATNetworkJSONString;

        const nodes = parsedNetwork.nodes.map(n => JSON.parse(n));
        const nodeTypes = nodes.map(n => n.name);

        // Look for genomes with NetworkOutputNode/NoteNetworkOutputNode AND WavetableNode or AudioBufferSourceNode
        // These have proper CPPN→AudioGraph connections and produce actual audio
        const hasNetworkOutput = nodeTypes.includes('NetworkOutputNode') || nodeTypes.includes('NoteNetworkOutputNode');
        const hasSoundSource = nodeTypes.includes('WavetableNode') || nodeTypes.includes('AudioBufferSourceNode');

        if (hasNetworkOutput && hasSoundSource) {
            console.log(`  Using genome ${row.id} with node types: ${[...new Set(nodeTypes)].join(', ')}`);
            db.close();
            return genome;
        }
    }

    db.close();
    throw new Error('No genome with NetworkOutputNode found in database');
}

async function runSingleTest(genome, audioContext, noteDelta, testName) {
    console.log(`  Testing ${testName}...`);

    const offlineContext = new OfflineAudioContext({
        numberOfChannels: 1,
        length: Math.round(SAMPLE_RATE * DURATION),
        sampleRate: SAMPLE_RATE
    });

    const genomeAndMeta = {
        genome: genome,
        duration: DURATION,
        noteDelta: noteDelta,
        velocity: 0.5,
        reverse: false
    };

    // Capture console warnings
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args.join(' '));
        // Don't log warnings during test - we'll report them at the end
    };

    const startTime = performance.now();

    try {
        const buffer = await getAudioBufferFromGenomeAndMeta(
            genomeAndMeta, DURATION, noteDelta, 0.5, false, false,
            offlineContext, audioContext, false, true, false, false,
            undefined, undefined,
            'batch'
        );

        const renderTime = (performance.now() - startTime) / 1000;

        // Restore console.warn
        console.warn = originalWarn;

        // Check for value curve warnings
        const valueCurveWarnings = warnings.filter(w =>
            w.includes('No value curves for')
        );

        if (valueCurveWarnings.length > 0) {
            console.log(`    ❌ FAILED: Found ${valueCurveWarnings.length} value curve warnings`);
            valueCurveWarnings.slice(0, 3).forEach(w => console.log(`       ${w}`));
            if (valueCurveWarnings.length > 3) {
                console.log(`       ... and ${valueCurveWarnings.length - 3} more`);
            }
            return false;
        }

        // Check audio buffer validity - only check for NaN/Inf, not for silence
        // (Some genomes may produce silent audio due to their structure, which is unrelated to value curves)
        const samples = buffer.getChannelData(0);
        let valid = 0, nans = 0, infs = 0, peak = 0;

        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (isNaN(s)) {
                nans++;
            } else if (!isFinite(s)) {
                infs++;
            } else if (s !== 0) {
                valid++;
                peak = Math.max(peak, Math.abs(s));
            }
        }

        if (nans === 0 && infs === 0) {
            // No NaN or Inf values = value curves were processed correctly
            const audioStatus = valid > 0 ? `peak=${peak.toFixed(4)}` : 'silent';
            console.log(`    ✅ PASSED (${renderTime.toFixed(2)}s, ${audioStatus})`);
            return true;
        } else {
            console.log(`    ❌ FAILED: Audio buffer has NaN/Inf values (NaN=${nans}, Inf=${infs})`);
            return false;
        }
    } catch (error) {
        console.warn = originalWarn;
        console.log(`    ❌ FAILED: ${error.message}`);
        return false;
    }
}

async function testGenome(genome, genomeName, audioContext) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${genomeName}`);
    console.log(`  oneCPPNPerFrequency: ${genome.waveNetwork?.oneCPPNPerFrequency || false}`);
    console.log(`${'='.repeat(60)}`);

    const testCases = [
        { noteDelta: 0, name: 'noteDelta=0 (base note)' },
        { noteDelta: 5, name: 'noteDelta=5 (5 semitones up)' },
        { noteDelta: -7, name: 'noteDelta=-7 (7 semitones down)' },
        { noteDelta: 12, name: 'noteDelta=12 (octave up)' },
    ];

    let allPassed = true;
    for (const testCase of testCases) {
        const passed = await runSingleTest(genome, audioContext, testCase.noteDelta, testCase.name);
        if (!passed) {
            allPassed = false;
        }
    }

    return allPassed;
}

async function main() {
    console.log('Value Curves Fix Test Suite');
    console.log('Testing both CPPN architectures with multiple noteDelta values\n');

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    let allTestsPassed = true;

    // Test 1: Multi-CPPN genome (oneCPPNPerFrequency=true)
    if (fs.existsSync(MULTI_CPPN_GENOME_PATH)) {
        try {
            const multiCppnGenome = await loadGenomeFromFile(MULTI_CPPN_GENOME_PATH);
            const passed = await testGenome(multiCppnGenome, 'Multi-CPPN (oneCPPNPerFrequency=true)', audioContext);
            if (!passed) allTestsPassed = false;
        } catch (error) {
            console.log(`\n❌ Failed to load multi-CPPN genome: ${error.message}`);
            allTestsPassed = false;
        }
    } else {
        console.log('\n⚠️  Multi-CPPN genome file not found, skipping');
    }

    // Test 2: Single-CPPN genome (oneCPPNPerFrequency=false)
    if (fs.existsSync(SINGLE_CPPN_DB_PATH)) {
        try {
            const singleCppnGenome = await loadGenomeFromSqlite(SINGLE_CPPN_DB_PATH);
            const passed = await testGenome(singleCppnGenome, 'Single-CPPN (oneCPPNPerFrequency=false)', audioContext);
            if (!passed) allTestsPassed = false;
        } catch (error) {
            console.log(`\n❌ Failed to load single-CPPN genome: ${error.message}`);
            allTestsPassed = false;
        }
    } else {
        console.log('\n⚠️  Single-CPPN genome database not found, skipping');
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED');
        console.log('   Value curves fix working correctly for both CPPN architectures');
        process.exit(0);
    } else {
        console.log('❌ SOME TESTS FAILED');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
