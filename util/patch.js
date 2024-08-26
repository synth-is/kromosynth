import {
  getOutputsForMemberInCurrentPopulation,
  getAudioBuffersForMember
} from '../wavekilde.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';

export async function doesPatchNetworkHaveMinimumFitness(
  asNEATNetwork, waveNetworkPopulationMember, 
  audioCtx, 
  // TODO offlineAudioContext
  checkDataAmplitude,
  offlineAudioContext,
  patchFitnessTestDuration
) {
  let hasMinimumFitness = false;
  // verify suitability of x by running it through virtualAudioGraph
  const asNEATNetworkJSONString = asNEATNetwork.toJSON();
  const synthIsPatch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

  const duration = patchFitnessTestDuration || 0.1;
  let memberOutputs = await getOutputsForMemberInCurrentPopulation(
    0, // populationIndex - TODO: isn't really used?
    0, // memberIndex - TODO: isn't really used?
    duration, // duration
    null, // totalSampleCount
    null, // outputsToActivate
    null, // noteDelta
    true, // useGPU
    null, // sampleRateIn
    waveNetworkPopulationMember,
    synthIsPatch,
    1, // velocity
    audioCtx
  ).catch( e => {
    console.error("getOutputsForMemberInCurrentPopulation rejected:", e);
  } );
  let audioBufferAndCanvas;
  try {
    if( memberOutputs ) {
      audioBufferAndCanvas = await getAudioBuffersForMember(
        memberOutputs,
        0, // populationIndex
        0, // memberIndexOrKey
        duration, // duration
        null, // noteDelta
        null, //reverse
        audioCtx.sampleRate, // sample rate
        synthIsPatch,
        false, // renderSpectrograms
        null, // spectrogramDimensions
        undefined, // getDataArray
        offlineAudioContext,
        audioCtx
      ).catch( e => {
        console.error("getAudioBuffersForMember rejected:", e);
      } );
    }
  } finally {
    memberOutputs = null;
  }
  if( audioBufferAndCanvas && audioBufferAndCanvas.audioBuffer ) {
    const audioBuffer = audioBufferAndCanvas.audioBuffer;
    if( audioBuffer ) {
      // we got an audio buffer without an exception being thrown,
      if( checkDataAmplitude ) {
        // - let's check if it contains any significant data
        let channelData = audioBuffer.getChannelData(0); // mono
        for( let i=1; i < channelData.length; i++ ) {
          if( Math.abs(channelData[i]) > 0.2 ) {
            // there is some movement in the channel data
            hasMinimumFitness = true;
            break;
          }
        }
      } else {
        hasMinimumFitness = true;
      }
    }
  }
  return hasMinimumFitness;
}
