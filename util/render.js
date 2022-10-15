import {
  getOutputsForMemberInCurrentPopulation,
  getAudioBuffersForMember,
} from '../wavekilde';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge';
import isString from "lodash/isString";

export function renderAudio(
  asNEATPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray
) {
  // anomaly handling
  if( Array.isArray(duration) ) duration = duration[0];
  if( Array.isArray(noteDelta) ) noteDelta = noteDelta[0];
  if( Array.isArray(velocity) ) velocity = velocity[0];

  return renderAudioAndSpectrogram(
    asNEATPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray
  ).then( audioBufferAndCanvas => {
    return audioBufferAndCanvas.audioBuffer
  } );
}

export function renderAudioFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray
) {
  return renderAudioAndSpectrogramFromPatchAndMember(
    synthIsPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray
  ).then(audioBufferAndCanvas => {
    const {audioBuffer} = audioBufferAndCanvas;
    return audioBuffer;
  });
}

export function renderAudioAndSpectrogram(
  asNEATPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray
) {
  const asNEATNetworkJSONString = isString(asNEATPatch) ? asNEATPatch : asNEATPatch.toJSON();
  const synthIsPatch = patchFromAsNEATnetwork( asNEATNetworkJSONString );
  console.log("synthIsPatch",synthIsPatch);
  return renderAudioAndSpectrogramFromPatchAndMember(
    synthIsPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray
  );
}

export function renderAudioAndSpectrogramFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
) {
  return new Promise( (resolve,reject) => {
    startMemberOutputsRendering(
      waveNetwork, synthIsPatch,
      duration,
      noteDelta,
      sampleRate,
      velocity,
      reverse
    ).then( memberOutputs => {
      console.log("memberOutputs",memberOutputs);
      startAudioBuffersRendering(
        memberOutputs, synthIsPatch, duration, noteDelta, sampleRate, asDataArray
      ).then( audioBufferAndCanvas => resolve( audioBufferAndCanvas ) )
      .catch( e => reject(e) );
    }).catch( e => reject(e) );
  }).catch( async e => {
    console.error(e); // TODO: error creating virtual audio graph here
  } );
}

// similar to renderedSoundExport.js HoC in synth.is web app, but different (overloaded) methods and param ordering:
export function startMemberOutputsRendering(
  member, patch, duration, noteDelta, sampleRate, velocity, reverse
) {
console.log("startMemberOutputsRendering", member, patch, duration, noteDelta, sampleRate, velocity, reverse);
  return getOutputsForMemberInCurrentPopulation(
    null, // populationIndex,
    null, //memberIndex, // TODO: this needs refactoring
    duration,
    null, // totalSampleCount
    null, //outputsToActivate,
    noteDelta,
    true, // useGPU,
    sampleRate,
    member, patch,
    velocity,
    undefined, // audioCtx,
    reverse
  );
}

export function startAudioBuffersRendering(
  memberOutputs, patch, duration, noteDelta, sampleRate, asDataArray
) {
  return getAudioBuffersForMember(
    memberOutputs /*existingMemberOutputs*/,
    null, // populationIndex,
    null, //memberIndex,
    duration,
    noteDelta,
    null, /* reverse */
    sampleRate,
    patch,
    true, // renderSpectrograms
    {width: 600, height: 314}, // spectrogramDimensions
    asDataArray
  );
}
