import {
  getOutputsForMemberInCurrentPopulation,
  getAudioBuffersForMember,
  wireUpAudioGraph
} from '../wavekilde.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import isString from "lodash-es/isString.js";

export function renderAudio(
  asNEATPatch, waveNetwork, duration = 1, noteDelta = 0, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors
) {
  // anomaly handling
  if( Array.isArray(duration) ) duration = duration[0];
  if( Array.isArray(noteDelta) ) noteDelta = noteDelta[0];
  if( Array.isArray(velocity) ) velocity = velocity[0];

  return renderAudioAndSpectrogram(
    asNEATPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors
  ).then( audioBufferAndCanvas => {
    return audioBufferAndCanvas.audioBuffer
  } );
}

export function renderAudioFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors
) {
  return renderAudioAndSpectrogramFromPatchAndMember(
    synthIsPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors
  ).then(audioBufferAndCanvas => {
    const {audioBuffer} = audioBufferAndCanvas;
    return audioBuffer;
  });
}

export function renderAudioAndSpectrogram(
  asNEATPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors
) {
  const asNEATNetworkJSONString = isString(asNEATPatch) ? asNEATPatch : asNEATPatch.toJSON();
  const synthIsPatch = patchFromAsNEATnetwork( asNEATNetworkJSONString );
  // console.log("synthIsPatch",synthIsPatch);
  return renderAudioAndSpectrogramFromPatchAndMember(
    synthIsPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors
  );
}

export function renderAudioAndSpectrogramFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors
) {
  return new Promise( (resolve,reject) => {
    startMemberOutputsRendering(
      waveNetwork, synthIsPatch,
      duration,
      noteDelta,
      sampleRate,
      velocity,
      reverse,
      useOvertoneInharmonicityFactors
    ).then( memberOutputs => {
      // console.log("memberOutputs",memberOutputs);
      startAudioBuffersRendering(
        memberOutputs, synthIsPatch, duration, noteDelta, sampleRate, asDataArray,
        offlineAudioContext,
        audioContext,
        useOvertoneInharmonicityFactors
      ).then( audioBufferAndCanvas => resolve( audioBufferAndCanvas ) )
      .catch( e => reject(e) );
    }).catch( e => reject(e) );
  }).catch( async e => {
    console.error(e); // TODO: error creating virtual audio graph here
  } );
}

export function wireUpAudioGraphForPatchAndWaveNetwork(
  genome,
  duration, noteDelta, velocity = 1, sampleRate,
  audioContextInstance,
  reverse
) {
  const waveNetwork = genome.waveNetwork;
  let synthIsPatch;
  if( genome.asNEATPatch ) {
    const asNEATNetworkJSONString = isString(genome.asNEATPatch) ? genome.asNEATPatch : genome.asNEATPatch.toJSON();
    synthIsPatch = patchFromAsNEATnetwork( asNEATNetworkJSONString );
  } else {
    // TODO: we should be storing "synthIsPatch" externally and come here for all published patches,
    // but currently aren't (asNEATPatch is in published patches (2022-10))
    synthIsPatch = genome.synthIsPatch || genome.patch;
  }
  return new Promise( (resolve, reject) => {
    startMemberOutputsRendering(
      waveNetwork, synthIsPatch,
      duration,
      noteDelta,
      sampleRate,
      velocity,
      reverse
    ).then( memberOutputs => {
      wireUpAudioGraph(
        memberOutputs, synthIsPatch, duration, noteDelta, audioContextInstance
      ).then( virtualAudioGraph => resolve(virtualAudioGraph) )
      .catch( e => reject(e) );
    }).catch( e => reject(e) );
  }).catch( e => console.error(e) );
}

// similar to renderedSoundExport.js HoC in synth.is web app, but different (overloaded) methods and param ordering:
export function startMemberOutputsRendering(
  member, patch, duration, noteDelta, sampleRate, velocity, reverse,
  useOvertoneInharmonicityFactors
  // TODO: should we accept audioContext instead of sampleRate, which can be obtained from the former?
) {
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
    reverse,
    useOvertoneInharmonicityFactors
  );
}

export function startAudioBuffersRendering(
  memberOutputs, patch, duration, noteDelta, sampleRate, asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors
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
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors
  );
}
