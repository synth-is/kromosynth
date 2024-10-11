import {
  getOutputsForMemberInCurrentPopulation,
  getAudioBuffersForMember,
  wireUpAudioGraph
} from '../wavekilde.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import isString from "lodash-es/isString.js";

export async function renderAudio(
  asNEATPatch, waveNetwork, duration = 1, noteDelta = 0, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors,
  useGPU,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
) {
  // anomaly handling
  if( Array.isArray(duration) ) duration = duration[0];
  if( Array.isArray(noteDelta) ) noteDelta = noteDelta[0];
  if( Array.isArray(velocity) ) velocity = velocity[0];

  const audioBufferAndCanvas = await renderAudioAndSpectrogram(
    asNEATPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  );
  if (!audioBufferAndCanvas) {
    console.error("No audioBufferAndCanvas");
  }
  return audioBufferAndCanvas ? audioBufferAndCanvas.audioBuffer : null;
}

export function renderAudioFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors,
  useGPU,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
) {
  return renderAudioAndSpectrogramFromPatchAndMember(
    synthIsPatch, waveNetwork, duration, noteDelta, velocity, sampleRate,
    reverse,
    asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
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
  useOvertoneInharmonicityFactors,
  useGPU,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
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
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  );
}

export async function renderAudioAndSpectrogramFromPatchAndMember(
  synthIsPatch, waveNetwork, duration, noteDelta, velocity = 1, sampleRate,
  reverse,
  asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors,
  useGPU,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
) {
  const memberOutputs = await startMemberOutputsRendering(
    waveNetwork, synthIsPatch,
    duration,
    noteDelta,
    sampleRate,
    velocity,
    reverse,
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  )
  const audioBufferAndCanvas = await startAudioBuffersRendering(
    memberOutputs, synthIsPatch, duration, noteDelta, sampleRate, asDataArray,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  );

  return audioBufferAndCanvas;
}

export function wireUpAudioGraphForPatchAndWaveNetwork(
  genome,
  duration, noteDelta, velocity = 1, sampleRate,
  audioContextInstance,
  reverse,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
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
      reverse,
      antiAliasing,
      frequencyUpdatesApplyToAllPathcNetworkOutputs
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
  useOvertoneInharmonicityFactors,
  useGPU = true,
  antiAliasing = false,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
  // TODO: should we accept audioContext instead of sampleRate, which can be obtained from the former?
) {
  return getOutputsForMemberInCurrentPopulation(
    null, // populationIndex,
    null, //memberIndex, // TODO: this needs refactoring
    duration,
    null, // totalSampleCount
    null, //outputsToActivate,
    noteDelta,
    useGPU,
    sampleRate,
    member, patch,
    velocity,
    undefined, // audioCtx,
    reverse,
    useOvertoneInharmonicityFactors,
    antiAliasing,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  );
}

export function startAudioBuffersRendering(
  memberOutputs, patch, duration, noteDelta, sampleRate, asDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false
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
    useOvertoneInharmonicityFactors,
    frequencyUpdatesApplyToAllPathcNetworkOutputs
  );
}

///// virtual instrument

export function getBaseNoteFrequencyFromASNEATPatch( asNEATNetworkJSONString ) {
  const synthIsPatch = patchFromAsNEATnetwork( asNEATNetworkJSONString );
  return getBaseNoteFrequencyFromPatch( synthIsPatch );
}

// based on getBaseNoteFrequency from renderedSoundExport.jsx in the synth.is web app
export function getBaseNoteFrequencyFromPatch( patch ) {
  const bufferFrequencies = [];
  patch.networkOutputs.forEach( oneNetworkOutput => {
    let isBufferInput = false;
    if( oneNetworkOutput.audioGraphNodes && Object.values(oneNetworkOutput.audioGraphNodes).length ) {
      connectionParamsIteration:
      for( let oneConnectionParams of Object.values(oneNetworkOutput.audioGraphNodes) ) {
        if( oneConnectionParams ) {
          for( let oneConnectionParamEntry of oneConnectionParams ) {
            if( "buffer" === oneConnectionParamEntry.paramName || ("partialBuffer" === oneConnectionParamEntry.paramName && 1 === oneConnectionParamEntry.partialNumber ) ) {
              isBufferInput = true;
              break connectionParamsIteration;
            }
          }
        }
      }
    }
    if( isBufferInput ) bufferFrequencies.push( oneNetworkOutput.frequency );
  } );
  const baseNoteFrequency = bufferFrequencies
    .reduce((all, one, _, src) => all += one / src.length, 0); // https://stackoverflow.com/questions/29544371/finding-the-average-of-an-array-using-js#comment100454415_29544442
  return baseNoteFrequency;
}
function frequencyToNoteMark( frequency ) {

}
function getMidiNumberFromNoteMark( noteMark ) {

}