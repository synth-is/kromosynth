import { remapNumberToRange } from './range.js';
import { renderAudioFromPatchAndMember, renderAudio } from './render.js';
import { getGenomeFromGenomeString } from './audio-synthesis-genome.js';
import isString from "lodash-es/isString.js";

export function getAudioBuffer( samplesArrays, audioCtx, sampleCount ) {

    let channels = samplesArrays.length;

    let arrayBuffer = audioCtx.createBuffer(
        channels, sampleCount, audioCtx.sampleRate );

    // Fill the buffer with signals according to the network outputs
    for( let channel=0; channel < channels; channel++ ) {

        // This gives us the actual ArrayBuffer that contains the data
        let nowBuffering = arrayBuffer.getChannelData( channel );
        let networkOutputBuffer = samplesArrays[channel];
        // ensureBufferStartsAndEndsAtZero(
        //     samplesArrays[channel] 
        // );
        for( let i=0; i < sampleCount; i++ ) {
        nowBuffering[i] = networkOutputBuffer[i];
        }
        arrayBuffer.copyToChannel(nowBuffering, channel);
    }
    return arrayBuffer;
}

export function normalizeAudioBuffer( renderedBuffer, sampleCount, audioContext, getDataArray ) {

    const bufferChannelData = renderedBuffer.getChannelData(0);

    // ensure values are not outside the [-1, 1] range, to have consistence between DACs and storage in WAV files
    let minSampleValue = 0, maxSampleValue = 0;
    bufferChannelData.forEach( (oneSample, sampleIndex) => {
        if( oneSample < minSampleValue ) {
            minSampleValue = oneSample;
        }
        if( oneSample > maxSampleValue ) {
            maxSampleValue = oneSample;
        }
    });
    if( minSampleValue < -1 || maxSampleValue > 1 ) {
        for (var i = 0; i < bufferChannelData.length; i++) {
            bufferChannelData[i] = remapNumberToRange(bufferChannelData[i], minSampleValue, maxSampleValue, -1, 1 );
        }
    }
    minSampleValue = 0, maxSampleValue = 0;
    bufferChannelData.forEach( (oneSample, sampleIndex) => {
        if( oneSample < minSampleValue ) {
            minSampleValue = oneSample;
        }
        if( oneSample > maxSampleValue ) {
            maxSampleValue = oneSample;
        }
    });
    // return the data array or re-create an AudioBuffer after the remap
    let networkIndividualSound;
    if( getDataArray ) {
        networkIndividualSound = bufferChannelData;
    } else {
        const renderedBufferAfterRemapToRange = getAudioBuffer( [bufferChannelData], audioContext, sampleCount );
        // networkIndividualSound = ensureBufferStartsAndEndsAtZero(renderedBufferAfterRemapToRange);
        networkIndividualSound = renderedBufferAfterRemapToRange;
    }
    return networkIndividualSound;
}

function ensureBufferStartsAndEndsAtZero( buffer ) {
    const samplesToFadeFromZero = 128;
    if( 0 != buffer[0] ) {
        for( let i=0; i < samplesToFadeFromZero; i++ ) {
        buffer[i] = buffer[i] * (i/samplesToFadeFromZero);
        }
    }
    if( 0 != buffer[buffer.length-1] ) {
        for( let i=samplesToFadeFromZero; i > 0; --i ) {
        buffer[buffer.length-i] =
            buffer[buffer.length-i] * ((i-1) / samplesToFadeFromZero);
        }
    }
    // TODO: this isn't finding sharp carckles such as in https://synth.is/in/01c3h7x73dfqg1fncf4r7wjp1r/10/9/01c83z14pkc78vxxny682j33f4/6000/MTJfMC0wX24xMi00X244LThfbjEwLTEy
    // if( false /*shouldDoCavemanCrackleRemoval*/ ) {
    //   const changeThreshold = .1;
    //   console.log("---buffer.length:",buffer.length, buffer[0], buffer[Math.round(buffer.length/2)]);
    //   let maxValue = 0;
    //   let minValue = 0;
    //   let sharpestChange = 0;
    //   for( let i=0; i < buffer.length-1; i++ ) {
    //     const changeBetweenSamples = Math.abs(buffer[i] - buffer[i+1]);
    //     if( changeBetweenSamples > sharpestChange ) sharpestChange = changeBetweenSamples;
    //     if( changeThreshold < changeBetweenSamples ) {
    //       console.log("---change above threshold: ", Math.abs(buffer[i] - buffer[i+1]));
    //       const maxGapSize = 128;
    //       let indexWithinChangeThreshold = -1;
    //       for( let j=i+1; j-i < maxGapSize; j++ ) {
    //         if( changeThreshold > Math.abs(buffer[i] - buffer[j]) ) {
    //           indexWithinChangeThreshold = j;
    //           break;
    //         }
    //       }
    //       if( -1 < indexWithinChangeThreshold ) {
    //         for( let k=i+1; k < indexWithinChangeThreshold; k++ ) {
    //           const rangeFraction = k / (indexWithinChangeThreshold - i);
    //           const kSignal = lerp( buffer[i], buffer[indexWithinChangeThreshold], rangeFraction );
    //           buffer[k] = kSignal;
    //         }
    //       }
    //       i = indexWithinChangeThreshold + 1;
    //     }
    //
    //     if( buffer[i] < minValue ) minValue = buffer[i];
    //     if( buffer[i] > maxValue ) maxValue = buffer[i];
    //
    //   }
    //   console.log("---maxValue:", maxValue, ", minValue:", minValue, ", sharpestChange:", sharpestChange);
    // }
    return buffer;
}

// based on getAudioBuffer in live-coding-container.jsx
export async function getAudioBufferFromGenomeAndMeta(
    genomeAndMeta, duration, noteDelta, velocity, reverse, asDataArray,
    offlineAudioContext, // optional
    audioContext, // optional
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing = false,
    frequencyUpdatesApplyToAllPathcNetworkOutputs = false,
    sampleCountToActivate,
    sampleOffset,
    mode = 'batch',  // 'batch' or 'streaming'
) {
    // MODE GUARD: Route to streaming renderer if requested
    // This prevents any mixing of batch and streaming code paths
    if (mode === 'streaming') {
        const { StreamingRenderer } = await import('./streaming-renderer.js');
        const sampleRate = audioContext ? audioContext.sampleRate : offlineAudioContext.sampleRate;
        const renderer = new StreamingRenderer(audioContext, sampleRate, {
            useGPU,
            chunkSize: 128  // Can be made configurable later
        });

        return await renderer.render(genomeAndMeta, duration, offlineAudioContext);
    }

    // BATCH MODE: Original implementation (unchanged)
    let audioBuffer;
    if( genomeAndMeta.type === "favoriteSound" ) {
        const { patch, member } = genomeAndMeta.genome;
        audioBuffer = await renderAudioFromPatchAndMember(
            patch, member, duration, noteDelta, velocity,
            audioContext ? audioContext.sampleRate : offlineAudioContext.sampleRate,
            reverse,
            asDataArray,
            offlineAudioContext,
            audioContext,
            useOvertoneInharmonicityFactors,
            useGPU,
            antiAliasing,
            frequencyUpdatesApplyToAllPathcNetworkOutputs,
            sampleCountToActivate,
            sampleOffset,
        );
    } else {
        let genome;
        if( isString(genomeAndMeta.genome) ) {
            genome = await getGenomeFromGenomeString(genomeAndMeta.genome);
        } else {
            genome = genomeAndMeta.genome;
        }
        const {asNEATPatch, waveNetwork} = genome;
        audioBuffer = await renderAudio(
            asNEATPatch, waveNetwork, duration, noteDelta, velocity,
            audioContext ? audioContext.sampleRate : offlineAudioContext.sampleRate,
            reverse,
            asDataArray,
            offlineAudioContext,
            audioContext,
            useOvertoneInharmonicityFactors,
            useGPU,
            antiAliasing,
            frequencyUpdatesApplyToAllPathcNetworkOutputs,
            sampleCountToActivate,
            sampleOffset,
        );
    }
    return audioBuffer;
}
