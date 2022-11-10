import Activator from './cppn-neat/network-activation.js';
import Renderer from './cppn-neat/network-rendering.js';
import { concatenateTypedArrays } from './util/arrays.js';
import { numWorkers } from './util/range.js';
import asNeatUtils from './as-neat/utils.js';
import clone from 'clone';

// const ActivationSubWorker = require("worker!../workers/network-activation-sub-worker.js");
// inlining the worker seems necessary when visiting react-router path with /:parameters !?!!
// const ActivationSubWorker = require("worker?inline!../workers/network-activation-sub-worker.js");
import ActivationSubWorker from "./workers/network-activation-sub-worker.js?worker";

let activator;
let renderer;

///// network activation

function getOutputsForMemberInCurrentPopulation(
  populationIndex, memberIndex, duration, totalSampleCount,
  outputsToActivate, noteDelta,
  /* pass in useGPU here, gpu for audio, cpu(workers) for ui stuff */
  useGPU, sampleRateIn,
  memberParam, patchParam,
  velocity,
  audioCtx,
  reverse
) {
  return new Promise( (resolve, reject) => {

    let currentPatch = patchParam;

    if( ! currentPatch ) {

      resolve( new Map() );

    } else {

      if( duration ) currentPatch.duration = duration;

      if( noteDelta && noteDelta != 0 ) {
        const frequencyUpdates = getBufferFrequencyUpdatesAccordingToNoteDelta(
          currentPatch, noteDelta );
        currentPatch = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
          currentPatch,
          frequencyUpdates,
          noteDelta
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

      if( useGPU ) {

        // keep singleton instance
        if( ! activator || activator.sampleRate !== sampleRate ) {
          activator = new Activator( sampleRate );
        }

        activator.activateMember(
          member,
          currentPatch,
          outputsToActivate,
          _totalSampleCount,
          null, /* sampleCountToActivate */
          null, /* sampleOffset */
          useGPU,
          reverse,
          true, /* variationOnPeriods */
          velocity
        ).then( memberOutputs => {
            resolve( memberOutputs );
          },
          rejection => reject( rejection )
        ).catch( e => {
          console.error("failed to activateMember on GPU", member);
          // TODO: encapsulate those things in functions
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
            memberOutputs => resolve( memberOutputs ),
            rejection => reject( rejection )
          );
          // reject("failed to activateMember on GPU");
        });
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
          memberOutputs => resolve( memberOutputs ),
          rejection => reject( rejection )
        );
      }
    }
  });
}

function spawnMultipleNetworkActivationWebWorkers( data ) {

  const activationPromises = [];

  const samplesPerWorker = Math.round( data.totalSampleCount / numWorkers );
  for( let i=0; i < numWorkers; i+=1 ) {

    activationPromises.push(
      spawnOneNetworkActivationWebWorker( data, i, samplesPerWorker, data.velocity )
    );
  }

  return Promise.all( activationPromises ).then( activationSubResults => {

    const memberOutputs =
      getCombinedMemberOutputsFromSubResults( activationSubResults );

    return memberOutputs;
  });
}

function spawnOneNetworkActivationWebWorker( data, sliceIndex, samplesPerWorker, velocity ) {

  return new Promise( (resolve, reject) => {

    const sampleOffset = sliceIndex * samplesPerWorker;
    let sampleCountToActivate;
    if( sampleOffset + samplesPerWorker > data.totalSampleCount ) {
      sampleCountToActivate = data.totalSampleCount - sampleOffset;
    } else {
      sampleCountToActivate = samplesPerWorker;
    }
    const activationSubWorker = new ActivationSubWorker();
    const messageToWorker = {
      slice: sliceIndex,  // TODO: no longer needed?
      populationIndex: data.populationIndex,
      memberIndex: data.memberIndex,
      outputsToActivate: data.outputsToActivate,
      totalSampleCount: data.totalSampleCount,
      sampleRate: data.sampleRate,
      member: data.member,
      currentPatch: data.currentPatch,
      sampleCountToActivate,
      sampleOffset,
      velocity
    };
    activationSubWorker.postMessage( messageToWorker );
    activationSubWorker.onmessage = (e) => {

      resolve( e.data.memberOutputs );
    };
  });
}

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

function getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
    patch,
    frequencyUpdates,
    noteDelta,
) {
  const modifiedPatch = clone(patch);

  const networkOutputs = new Array();

  modifiedPatch.networkOutputs.forEach( oneNetworkOutput => {
    // TODO: at some point it might be interesting to offer the option to
    // update network output frequencies for if oneConnection is to a buffer,
    // even though there are other sibling connections to other parameters;
    // - but for now default to the the updated implementation where only
    //  frequencies for buffer connections are updated:
    if( true ) {

      let networkOutputConnectedToBuffer;
      let networkOutputConnectedToOtherParams;
      for( let oneNodeKey in oneNetworkOutput.audioGraphNodes ) {
        const oneGraphNodeConnections = oneNetworkOutput.audioGraphNodes[oneNodeKey];
        for( let oneConnection of oneGraphNodeConnections ) {
          if( 'buffer' === oneConnection.paramName ) {
            if( ! networkOutputConnectedToBuffer ) {
              networkOutputConnectedToBuffer = {
                audioGraphNodes: {},
                frequency: getFrequencyToNoteDelta(
                  oneNetworkOutput.frequency,
                  noteDelta
                ),
                networkOutput: oneNetworkOutput.networkOutput,
                id: asNeatUtils.createHash()
              };
            }
            if( ! networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey] ) {
              networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey] = new Array();
            }
            networkOutputConnectedToBuffer.audioGraphNodes[oneNodeKey].push( oneConnection );
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
        networkOutputConnectedToBuffer.frequency = getFrequencyToNoteDelta(
          networkOutputConnectedToBuffer.frequency,
          noteDelta
        );
        networkOutputs.push( networkOutputConnectedToBuffer );
      }
      if( networkOutputConnectedToOtherParams ) {
        networkOutputs.push( networkOutputConnectedToOtherParams );
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

export function getFrequencyToNoteDelta( freq, noteDelta ) {
  // https://en.wikipedia.org/wiki/Cent_(music)#Use
  const cents = 100 * noteDelta;
  return freq * Math.pow( 2, (cents/1200) );
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
  offlineAudioContext
) {
  return new Promise( (resolve, reject) => {

    let patch = patchParam;
    if( noteDelta && noteDelta != 0 ) {
      const frequencyUpdates = getBufferFrequencyUpdatesAccordingToNoteDelta(
        patch, noteDelta );
      patch = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
        patch,
        frequencyUpdates,
        noteDelta
      );
    }

    if( duration ) patch.duration = duration;

    // keep a singleton instance
    if( ! renderer || renderer.sampleRate !== sampleRateIn ) {
      renderer = new Renderer( sampleRateIn );
    }

    // Render an audio graph with Renderer,
    // providing it with an audio graph patch from application state.
    // Wait for a promise to be fulfilled with the audio buffer of a rendered audio graph.
    return renderer
      .renderNetworksOutputSamplesAsAudioBuffer(
        memberOutputs, patch, noteDelta, spectrogramDimensions,
        getDataArray,
        offlineAudioContext
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
