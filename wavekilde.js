import Activator from './cppn-neat/network-activation.js';
import Renderer from './cppn-neat/network-rendering.js';
import { concatenateTypedArrays } from './util/arrays.js';
import { numWorkers } from './util/range.js';
import asNeatUtils from './as-neat/utils.js';
import clone from 'clone';

// const ActivationSubWorker = require("worker!../workers/network-activation-sub-worker.js");
// inlining the worker seems necessary when visiting react-router path with /:parameters !?!!
// const ActivationSubWorker = require("worker?inline!../workers/network-activation-sub-worker.js");
// import ActivationSubWorker from "./workers/network-activation-sub-worker.js?worker";
import { partial } from 'lodash-es';

// let activator;
// let renderer;

///// network activation

/** TODO: simplify the API
 * 
 * @param {object} cppn 
 * @param {object} audioGraph 
 * @param {double} duration 
 * @param {*} noteDelta 
 * @param {*} velocity 
 * @param {*} reverse 
 * @param {*} useOvertoneInharmonicityFactors 
 * @param {*} sampleRate 
 * @param {*} audioContext 
 * @param {*} useGPU 
 */
function getCPPNWaveformOutputs(
  cppn, audioGraph,
  duration, noteDelta, velocity,
  reverse,
  // TODO tunings
  useOvertoneInharmonicityFactors,
  sampleRate, audioContext,
  useGPU
) {

}

function getOutputsForMemberInCurrentPopulation(
  populationIndex, memberIndex, duration, totalSampleCount,
  outputsToActivate, noteDelta,
  /* pass in useGPU here, gpu for audio, cpu(workers) for ui stuff */
  useGPU, sampleRateIn,
  memberParam, patchParam,
  velocity,
  audioCtx,
  reverse,
  useOvertoneInharmonicityFactors,
  antiAliasing, // if true, oversample and low-pass filter
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false, // regardless of whether they are connected to a buffer
  sampleCountToActivate,
  sampleOffset,
) {
  return new Promise( (resolve, reject) => {

    let currentPatch = patchParam;

    if( ! currentPatch ) {

      resolve( { memberOutputs: new Map(), patch: null } );

    } else {

      if( duration ) currentPatch.duration = duration;

      if( true // now we'll always want to do this, as there might be 'partialBuffer' (overtone) connections, not just when:
        // noteDelta && noteDelta != 0
      ) {
        currentPatch = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
          currentPatch,
          noteDelta,
          useOvertoneInharmonicityFactors,
          frequencyUpdatesApplyToAllPathcNetworkOutputs
        );
        if( outputsToActivate ) {
          outputsToActivate = getOutputsToActivateWithBufferFrequenciesUpdatedAccordingToNoteDelta(
            outputsToActivate, frequencyUpdates );
        }
        // oscillator frequency upddates are handled in
        // Renderer.getNodeGraphFromPatch (network-rendering.js)
        // TODO: might want to colocate this!
      }

      let member = memberParam;

      const sampleRate = sampleRateIn || audioCtx.sampleRate;

      const _totalSampleCount = Math.round(totalSampleCount ? totalSampleCount
                              : sampleRate * currentPatch.duration);

      if( true /*useGPU*/ ) { // for now always going this route and let activator.activateMember handle the choice of CPU vs GPU; multiple workers not relevant when distributing rendering across multiple rendering node instances

        // // keep singleton instance
        // if( ! activator || activator.sampleRate !== sampleRate ) {
        //   activator = new Activator( sampleRate );
        // }

        let activator = new Activator( sampleRate );

        try {

          activator.activateMember(
            member,
            currentPatch,
            outputsToActivate,
            _totalSampleCount,
            sampleCountToActivate,
            sampleOffset,
            useGPU,
            reverse,
            true, /* variationOnPeriods */
            velocity,
            antiAliasing
          ).then( memberOutputs => {
            try {
              // Return both memberOutputs and the modified patch so callers can use the same patch
              // for subsequent operations (avoiding key mismatches from double-modification)
              resolve( { memberOutputs, patch: currentPatch } );
            } finally {
              memberOutputs = undefined;
            }
          },
            rejection => reject( rejection )
          ).catch( e => {
            console.error("failed to activateMember on GPU", member);
            // TODO: encapsulate those things in functions
            // ... TODO: no longer in use - won't be used?
            spawnMultipleNetworkActivationWebWorkers({
              populationIndex,
              memberIndex, // TOOO: handle if scratchpad member; we've already fetched the member above
              outputsToActivate,
              member,
              currentPatch,
              sampleRate,
              totalSampleCount: _totalSampleCount,
              velocity
            }).then(
              memberOutputs => resolve( { memberOutputs, patch: currentPatch } ),
              rejection => reject( rejection )
            );
            // reject("failed to activateMember on GPU");
          });

        } finally {
          if (activator && activator.destroy) {
            activator.destroy();
          }
          activator = undefined;
        }

        // resolve( new Map() );


      } else {

        // Perform network actiation on worker
        // ...dispatch receiveOutputsForMember when worker posts back:

        if( ! window.Worker ) {
          alert("Please use a modern web browser that supports Web Workers");
        }

        spawnMultipleNetworkActivationWebWorkers({
          populationIndex,
          memberIndex, // TOOO: handle if scratchpad member; we've already fetched the member above
          outputsToActivate,
          member,
          currentPatch,
          sampleRate,
          totalSampleCount: _totalSampleCount,
          velocity
        }).then(
          memberOutputs => resolve( { memberOutputs, patch: currentPatch } ),
          rejection => reject( rejection )
        );
      }
    }
  });
}

// function spawnMultipleNetworkActivationWebWorkers( data ) {

//   const activationPromises = [];

//   const samplesPerWorker = Math.round( data.totalSampleCount / numWorkers );
//   for( let i=0; i < numWorkers; i+=1 ) {

//     activationPromises.push(
//       spawnOneNetworkActivationWebWorker( data, i, samplesPerWorker, data.velocity )
//     );
//   }

//   return Promise.all( activationPromises ).then( activationSubResults => {

//     const memberOutputs =
//       getCombinedMemberOutputsFromSubResults( activationSubResults );

//     return memberOutputs;
//   });
// }

// function spawnOneNetworkActivationWebWorker( data, sliceIndex, samplesPerWorker, velocity ) {

//   return new Promise( (resolve, reject) => {

//     const sampleOffset = sliceIndex * samplesPerWorker;
//     let sampleCountToActivate;
//     if( sampleOffset + samplesPerWorker > data.totalSampleCount ) {
//       sampleCountToActivate = data.totalSampleCount - sampleOffset;
//     } else {
//       sampleCountToActivate = samplesPerWorker;
//     }
//     const activationSubWorker = new ActivationSubWorker();
//     const messageToWorker = {
//       slice: sliceIndex,  // TODO: no longer needed?
//       populationIndex: data.populationIndex,
//       memberIndex: data.memberIndex,
//       outputsToActivate: data.outputsToActivate,
//       totalSampleCount: data.totalSampleCount,
//       sampleRate: data.sampleRate,
//       member: data.member,
//       currentPatch: data.currentPatch,
//       sampleCountToActivate,
//       sampleOffset,
//       velocity
//     };
//     activationSubWorker.postMessage( messageToWorker );
//     activationSubWorker.onmessage = (e) => {

//       resolve( e.data.memberOutputs );
//     };
//   });
// }

function getCombinedMemberOutputsFromSubResults( subResults ) {

  // let's initialize a Map for memberOutputs
  // using the first sub result as a template
  const memberOutputs = new Map( subResults[0].entries() );

  // then combine samples from each sub results for each nework output
  const subResultsSliceIndexes = Object.keys(subResults).sort();
  [...memberOutputs.keys()].forEach( outputIndex => {
    const sampleArraysForOneOutput = [];
    subResultsSliceIndexes.forEach( oneSliceIndex => {
      sampleArraysForOneOutput.push( subResults[oneSliceIndex].get(outputIndex).samples )
    });
    const samplesForOneOutput = concatenateTypedArrays(
      Float32Array, sampleArraysForOneOutput );
    memberOutputs.get(outputIndex).samples = samplesForOneOutput;
  });
  return memberOutputs;
}

export function getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
    patch,
    noteDelta,
    useOvertoneInharmonicityFactors,
    updateAllNetworkOutputs = false, // regardless of whether they are connected to a buffer
) {
  const modifiedPatch = clone(patch);

  const networkOutputs = new Array();

  let frequencyUpdates;
  // if( updateAllNetworkOutputs ) {
  //   frequencyUpdates = getBufferFrequencyUpdatesAccordingToNoteDelta(
  //     patch, noteDelta 
  //   );
  // }
  modifiedPatch.networkOutputs.forEach( oneNetworkOutput => {
    // TODO: at some point it might be interesting to offer the option to
    // update network output frequencies for if oneConnection is to a buffer,
    // even though there are other sibling connections to other parameters;
    // - but for now default to the the updated implementation where only
    //  frequencies for buffer connections are updated:
    if( true ) {

      let networkOutputConnectedToBuffer;
      let networkOutputConnectedToPartialBuffer;
      let networkOutputConnectedToOtherParams;
      for( let oneNodeKey in oneNetworkOutput.audioGraphNodes ) {
        const oneGraphNodeConnections = oneNetworkOutput.audioGraphNodes[oneNodeKey];
        for( let oneConnection of oneGraphNodeConnections ) {
          if( 'buffer' === oneConnection.paramName ) {
            if( ! networkOutputConnectedToBuffer ) {
              networkOutputConnectedToBuffer = {
                audioGraphNodes: {},
                frequency: oneNetworkOutput.frequency,
                networkOutput: oneNetworkOutput.networkOutput,
                id: asNeatUtils.createHash()
              };
            }
            if( ! networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey] ) {
              networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey] = new Array();
            }
            networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey].push( oneConnection );
          } else if( 'partialBuffer' === oneConnection.paramName ) {
            if( ! networkOutputConnectedToPartialBuffer ) {
              networkOutputConnectedToPartialBuffer = {
                audioGraphNodes: {},
                frequency: oneNetworkOutput.frequency,
                networkOutput: oneNetworkOutput.networkOutput,
                id: asNeatUtils.createHash()
              };
            }
            if( ! networkOutputConnectedToPartialBuffer.audioGraphNodes[oneNodeKey] ) {
              networkOutputConnectedToPartialBuffer.audioGraphNodes[oneNodeKey] = new Array();
            }
            networkOutputConnectedToPartialBuffer.audioGraphNodes[oneNodeKey].push( oneConnection );
          } else {
            if( ! networkOutputConnectedToOtherParams ) {
              networkOutputConnectedToOtherParams = {
                audioGraphNodes: {},
                frequency: oneNetworkOutput.frequency,
                networkOutput: oneNetworkOutput.networkOutput,
                id: asNeatUtils.createHash()
              };
            }
            if( ! networkOutputConnectedToOtherParams.audioGraphNodes[oneNodeKey] ) {
              networkOutputConnectedToOtherParams.audioGraphNodes[oneNodeKey] = new Array();
            }
            networkOutputConnectedToOtherParams.audioGraphNodes[oneNodeKey].push( oneConnection );
          }
        }
      }
      if( networkOutputConnectedToBuffer ) {
        // Store original frequency for CPPN lookup (oneCPPNPerFrequency mode)
        networkOutputConnectedToBuffer.originalFrequency = networkOutputConnectedToBuffer.frequency;
        networkOutputConnectedToBuffer.frequency = getFrequencyToNoteDelta(
          networkOutputConnectedToBuffer.frequency,
          noteDelta
        );
        networkOutputs.push( networkOutputConnectedToBuffer );
      }
      if( networkOutputConnectedToPartialBuffer ) {
        // assume that there is just one audioGraphNode in this networkOutput connected to a partialBuffer
        // TODO sophisticate?
        const partailBufferConnection = Object.values(networkOutputConnectedToPartialBuffer.audioGraphNodes)[0][0];
        // Store original frequency for CPPN lookup (oneCPPNPerFrequency mode)
        networkOutputConnectedToPartialBuffer.originalFrequency = networkOutputConnectedToPartialBuffer.frequency;
        const frequencyToNoteDelta = getFrequencyToNoteDelta(
          networkOutputConnectedToPartialBuffer.frequency,
          noteDelta
        );
        if( partailBufferConnection.partialNumber > 1 ) { // non-fundamental overtone
          if( partailBufferConnection.inharmonicityFactor !== 0 ) {
            console.log('inharmonicityFactor:', partailBufferConnection.inharmonicityFactor);
          }
          networkOutputConnectedToPartialBuffer.frequency = getOvertoneFrequency(
            frequencyToNoteDelta,
            partailBufferConnection.partialNumber,
            partailBufferConnection.inharmonicityFactor,
            useOvertoneInharmonicityFactors
          );
        } else {
          networkOutputConnectedToPartialBuffer.frequency = frequencyToNoteDelta;
        }
        networkOutputs.push( networkOutputConnectedToPartialBuffer );
      }
      if( networkOutputConnectedToOtherParams ) {
        if( updateAllNetworkOutputs ) {
          // Store original frequency for CPPN lookup (oneCPPNPerFrequency mode)
          networkOutputConnectedToOtherParams.originalFrequency = networkOutputConnectedToOtherParams.frequency;
          networkOutputConnectedToOtherParams.frequency = getFrequencyToNoteDelta(
            networkOutputConnectedToOtherParams.frequency,
            noteDelta
          );
          networkOutputs.push( networkOutputConnectedToOtherParams );
        } else {
          networkOutputs.push( networkOutputConnectedToOtherParams );
        }
      }
      modifiedPatch.networkOutputs = networkOutputs;

    } else {
      const originalFrequency = oneNetworkOutput.frequency;
      const newFrequency = frequencyUpdates.get(originalFrequency);
      if( newFrequency ) {
        oneNetworkOutput.frequency = newFrequency;
        // oneNetworkOutput.frequencyUpdated = true;
      }

    }
  });
  return modifiedPatch;
}

function getOutputsToActivateWithBufferFrequenciesUpdatedAccordingToNoteDelta(
  outputsToActivate, frequencyUpdates
) {
  const modifiedOutputsToActivate = clone(outputsToActivate);
  modifiedOutputsToActivate.forEach( oneOutput => {
    const originalFrequency = oneOutput.frequency;
    const newFrequency = frequencyUpdates.get(originalFrequency);
    if( newFrequency ) {
      oneOutput.frequency = newFrequency;
    }
  });
  return modifiedOutputsToActivate;
}

function getBufferFrequencyUpdatesAccordingToNoteDelta( patch, noteDelta ) {
  const frequencyUpdates = new Map();
  patch.networkOutputs.forEach( oneNetworkOutput => {
    let isNetworkOutputConnectedToBuffer = false;
    bufferConnectionCheck:
    for( let oneNodeKey in oneNetworkOutput.audioGraphNodes ) {
      const oneGraphNodeConnections = oneNetworkOutput.audioGraphNodes[oneNodeKey];
      for( let oneConnection of oneGraphNodeConnections ) {
        if( 'buffer' === oneConnection.paramName ) {
          isNetworkOutputConnectedToBuffer = true;
          break bufferConnectionCheck;
        }
      };
    }
    if( isNetworkOutputConnectedToBuffer ) {
      const originalFrequency = oneNetworkOutput.frequency;
      const newFrequency = getFrequencyToNoteDelta( originalFrequency, noteDelta );
      frequencyUpdates.set( originalFrequency, newFrequency );
    }
  });
  return frequencyUpdates;
}

// TODO tunings
export function getFrequencyToNoteDelta( freq, noteDelta ) {
  if( noteDelta && typeof noteDelta === 'object' && 'r1' in noteDelta && 'r2' in noteDelta ) {
    // we have multiplication coefficients for a tuning lattice, r1 and r2, so let's use those
    return freq * noteDelta.r1 * noteDelta.r2;
  } else {
    // https://en.wikipedia.org/wiki/Cent_(music)#Use
    const cents = 100 * noteDelta;
    return freq * Math.pow( 2, (cents/1200) );
  }
}

// see comment at the inharmonicityFactor member variable in PartialNetworkOutputNode (partialNetworkOutputNode.js)
function getOvertoneFrequency(
  frequency, partialNumber, inharmonicityFactor, useOvertoneInharmonicityFactors = true
) {
  return frequency * partialNumber + (useOvertoneInharmonicityFactors ? frequency * inharmonicityFactor : 0);
}


///// audio buffer rendering

function getAudioBuffersForMember(
  memberOutputs,
  populationIndex, memberIndexOrKey,  // TODO: refactor those away
  duration,
  noteDelta, reverse, sampleRateIn,  // TODO: reverse is not used (clients can reverse the rendered audio buffer; see e.g. live-coding-container in the synth.is web app)
  patchParam,
  renderSpectrograms, // TODO: unused?
  spectrogramDimensions,
  getDataArray,
  offlineAudioContext,
  audioContext,
  useOvertoneInharmonicityFactors,
  frequencyUpdatesApplyToAllPathcNetworkOutputs = false,
  captureNode = null,  // Optional: AudioWorklet node for incremental capture
  patchAlreadyModified = false  // If true, skip getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta (patch was already modified by getOutputsForMemberInCurrentPopulation)
) {
  return new Promise( (resolve, reject) => {

    let patch = patchParam;
    if( !patchAlreadyModified // skip if patch was already modified by getOutputsForMemberInCurrentPopulation
      // as in getOutputsForMemberInCurrentPopulation: now we'll always want to do this, as there might be 'partialBuffer' (overtone) connections, not just when:
      // noteDelta && noteDelta != 0
    ) {
      patch = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
        patch,
        noteDelta,
        useOvertoneInharmonicityFactors,
        frequencyUpdatesApplyToAllPathcNetworkOutputs
      );
    }

    if( duration ) patch.duration = duration;

    // keep a singleton instance
    // if( ! renderer || renderer.sampleRate !== sampleRateIn ) {
    //   renderer = new Renderer( sampleRateIn );
    // }

    let renderer = new Renderer( sampleRateIn );

    // Render an audio graph with Renderer,
    // providing it with an audio graph patch from application state.
    // Wait for a promise to be fulfilled with the audio buffer of a rendered audio graph.
    return renderer
      .renderNetworksOutputSamplesAsAudioBuffer(
        memberOutputs, patch, noteDelta, spectrogramDimensions,
        getDataArray,
        offlineAudioContext,
        audioContext,
        captureNode
      )
      .then(
        audioBufferAndCanvas => resolve(audioBufferAndCanvas),
        rejection => reject( rejection )
      );

  });
}

function wireUpAudioGraph(
  memberOutputs, synthIsPatch, duration, noteDelta, audioContextInstance
) {
  const sampleCount = Math.round(audioContextInstance.sampleRate * duration);
  // keep a singleton instance
  if( ! renderer || renderer.sampleRate !== audioContextInstance.sampleRate ) {
    renderer = new Renderer( audioContextInstance.sampleRate );
  }
  return renderer.wireUpAudioGraphAndConnectToAudioContextDestination(
    memberOutputs, synthIsPatch, noteDelta,
    audioContextInstance,
    sampleCount
  );
}

export {
  getOutputsForMemberInCurrentPopulation,
  getAudioBuffersForMember,
  wireUpAudioGraph
};
