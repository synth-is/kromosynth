#!/usr/bin/env node
/**
 * Test that streaming mode guard works correctly
 * - Should throw clear error message
 * - Should route to StreamingRenderer
 */

import { getAudioBufferFromGenomeAndMeta } from './util/audio-buffer.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext } = NodeWebAudioAPI;

async function testStreamingGuard() {
    console.log('Testing streaming mode guard...\n');

    const audioContext = new AudioContext({ sampleRate: 48000 });

    const genomeAndMeta = {
        genome: {
            asNEATPatch: '{}',  // Minimal dummy genome
            waveNetwork: {}
        },
        duration: 1.0
    };

    try {
        await getAudioBufferFromGenomeAndMeta(
            genomeAndMeta,
            1.0,      // duration
            0,        // noteDelta
            0.5,      // velocity
            false,    // reverse
            false,    // asDataArray
            null,     // offlineAudioContext (not used in streaming)
            audioContext,
            false,    // useOvertoneInharmonicityFactors
            true,     // useGPU
            false,    // antiAliasing
            false,    // frequencyUpdatesApplyToAllPathcNetworkOutputs
            undefined, // sampleCountToActivate
            undefined, // sampleOffset
            'streaming'  // MODE: streaming
        );

        console.log('❌ FAIL: Should have thrown error');
        process.exit(1);

    } catch (error) {
        if (error.message.includes('StreamingRenderer.render() not yet implemented')) {
            console.log('✅ SUCCESS: Streaming guard working correctly\n');
            console.log('Error message:');
            console.log(error.message);
            process.exit(0);
        } else {
            console.log('❌ FAIL: Wrong error thrown');
            console.log(error);
            process.exit(1);
        }
    }
}

testStreamingGuard().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
