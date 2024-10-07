import Network from '../as-neat/network.js';
import Evolver from '../cppn-neat/network-evolution.js';
import { doesPatchNetworkHaveMinimumFitness } from './patch.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import { getRoundedFrequencyValue } from './range.js';
import { getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta } from '../wavekilde.js';
import neatjs from 'neatjs';

// let evolver;
function getEvolver(evoParamsWaveNetwork) {
   // if( ! evolver ) evolver = new Evolver(evoParamsWaveNetwork);
  // return evolver;
  return new Evolver(evoParamsWaveNetwork, false/*singleton*/);
}

// returns a new basic individual for synthesizing sound, consisting of
// a wave generating network and an audio signal patch (accepting wave inputs from the network)
export function getNewAudioSynthesisGenome(
    evolutionRunId, generationNumber, parentIndex, evoParams,
    oneCPPNPerFrequency = false
  ) {
  const asNEATPatch = getInitialPatchASNEAT( evoParams );
  let virtualAudioGraph = patchFromAsNEATnetwork( asNEATPatch.toJSON() ); // aka synthIsPatch
  let waveNetwork;
  if( oneCPPNPerFrequency ) {

    // TODO add config to params for only one CPPN output

    waveNetwork = { 
      oneCPPNPerFrequency,
      CPPNs: {}
    };

    virtualAudioGraph = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
      virtualAudioGraph, 
      0, // noteDelta
      true, // useOvertoneInharmonicityFactors
      false // updateAllNetworkOutputs
    );
    initialiseCPPNForEachFrequencyIfNotExists( waveNetwork, virtualAudioGraph, evoParams );
  } else {
    // only one CPPN, serving all frequencies
    waveNetwork = initializeWaveNetwork( evoParams );
  }
  
  return {
    waveNetwork, asNEATPatch, virtualAudioGraph,
    evolutionRunId, generationNumber, parentIndex,
    updated: Date.now()
  };
}

export async function getNewAudioSynthesisGenomeByMutation(
    genomes,
    evolutionRunId, generationNumber, parentIndex, algorithm, audioCtx,
    probabilityMutatingWaveNetwork = 0.5,
    probabilityMutatingPatch = 0.5,
    asNEATMutationParams = {}, // TODO: this could be obtained from evoParams (below)
    evoParams,
    OfflineAudioContext,
    patchFitnessTestDuration
) {
  let waveNetwork, asNEATPatch;
  // TODO: the rationale behind this condition needs to be revisited (and then it needs to include PartialEnvelopeNetworkOutputNode and PartialNetworkOutputNode)
  // const patchHasNetworkOutputs = genome.asNEATPatch.nodes.filter(
  //   n => n.name === "NetworkOutputNode" || n.name === "NoteNetworkOutputNode"
  // ).length > 0;

  let patchOK;
  let patchMutationAttempt = 0; // TODO: do something with this or remove
  const maxMutationAttempts = 10;
  const defectivePatches = []; // TODO: do something with this or remove
  do { // mutate the patch (CPPN and DSP according to mutation rates); continue doing that until it passes a health check

    if( Math.random() < probabilityMutatingWaveNetwork 
      // && patchHasNetworkOutputs 
    ) {
      // mutate the wave network outputs
      const evoParamsWaveNetwork = getWaveNetworkParamsFromEvoParams( evoParams );
      let evolver = getEvolver(evoParamsWaveNetwork);
      if( genomes[0].waveNetwork.oneCPPNPerFrequency ) {
        // we have one CPPN per frequency
        waveNetwork = { 
          oneCPPNPerFrequency: true,
          CPPNs: {}
        };
        Object.keys( genomes[0].waveNetwork.CPPNs ).forEach( oneFrequency => {
          // we've won the probability of mutating CPPN(s)
          // but as we have one CPPN specialsing on each frequency, let's have another probability of mutating each:
          // - for now just half chance - TODO: configurable?
          if( Math.random() < 0.5 ) {
            if( waveNetwork.CPPNs[oneFrequency] === undefined ) {
              waveNetwork.CPPNs[oneFrequency] = {};
            }
            const offspring = evolver.getNextCPPN_NEATgenome( 
              genomes.map( g => {
                // find the CPPN with a frequency key closets to oneFrequency
                const frequencyKeys = Object.keys( g.waveNetwork.CPPNs );
                const closestFrequency = frequencyKeys.reduce( (prev, curr) => Math.abs(curr - oneFrequency) < Math.abs(prev - oneFrequency) ? curr : prev );
                return g.waveNetwork.CPPNs[closestFrequency].offspring;
              } )
            ).offspring;
            waveNetwork.CPPNs[oneFrequency].offspring = offspring;
          } else { // no mutation
            waveNetwork.CPPNs[oneFrequency] = genomes[0].waveNetwork.CPPNs[oneFrequency];
          }
        });
      } else {
        waveNetwork = evolver.getNextCPPN_NEATgenome( genomes.map( g => g.waveNetwork.offspring ) );
      }
      evolver = undefined;
    } else {
      waveNetwork = genomes[0].waveNetwork;
    }
    if( Math.random() < probabilityMutatingPatch ) {
        let patchClone = genomes[0].asNEATPatch.clone();
        if( genomes.length > 1 ) {
          for( let i=1; i<genomes.length; i++ ) {
            patchClone = patchClone.crossWith( genomes[i].asNEATPatch, evoParams.audioGraph.defaultParameters );
          }
          asNEATPatch = patchClone;
        } else {
          asNEATPatch = patchClone.mutate( asNEATMutationParams );
        }
        if( genomes[0].waveNetwork.oneCPPNPerFrequency ) {
          // // let's check if there are new frequencies which don't yet have an associated / specialised CPPN
          let virtualAudioGraph = patchFromAsNEATnetwork( asNEATPatch.toJSON() ); // aka synthIsPatch
          initialiseCPPNForEachFrequencyIfNotExists( waveNetwork, virtualAudioGraph, evoParams );
          // TODO for some reason, it doesn't suffice to initialise the CPPN for each frequency here, 
          // - se we'll do it below again, for unknown reasons!
        }
    } else {
      asNEATPatch = genomes[0].asNEATPatch;
    }

    // gene health-check
    let offlineAudioContext;
    if( OfflineAudioContext ) {
      const SAMPLE_RATE = 16000;
      offlineAudioContext = new OfflineAudioContext({
        numberOfChannels: 2,
        length: SAMPLE_RATE * patchFitnessTestDuration,
        sampleRate: SAMPLE_RATE,
      });
    } else {
      offlineAudioContext = undefined;
    }
    patchOK = await doesPatchNetworkHaveMinimumFitness(
      asNEATPatch, waveNetwork, 
      audioCtx,
      false, // checkDataAmplitude
      offlineAudioContext,
      patchFitnessTestDuration
    );
    offlineAudioContext = undefined;
    if( ! patchOK ) {
      defectivePatches.push( asNEATPatch );
    }
    patchMutationAttempt++;

    console.log("patchMutationAttempt:",patchMutationAttempt);

  } while( ! patchOK && patchMutationAttempt < maxMutationAttempts );

  if( ! patchOK ) {
    return undefined;
  } else {
    
    let virtualAudioGraph = patchFromAsNEATnetwork( asNEATPatch.toJSON() );
    // this call above should suffice, but for some reason it doesn't, so we'll do it here again:
    if( genomes[0].waveNetwork.oneCPPNPerFrequency ) {
      initialiseCPPNForEachFrequencyIfNotExists( waveNetwork, virtualAudioGraph, evoParams );
    }
    
    return {
      waveNetwork, asNEATPatch, virtualAudioGraph,
      evolutionRunId, generationNumber, parentIndex, algorithm,
      updated: Date.now()
    };
  }
}

// for a one-CPPN-per-frequency configuration, initialise a CPPN for each, if not already present
function initialiseCPPNForEachFrequencyIfNotExists( waveNetwork, virtualAudioGraph, evoParams ) {
  // similar functionality in network-activation.js (getOutputsToActivateFromPatch)

  // we need to call getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta, as it's responsible for updating the frequencies for additive synthesis partials
  // TODO this may all be refactored to be more clear
  const updatedVirtualAudioGraph = getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta(
    virtualAudioGraph, 
    0, 
    true, // useOvertoneInharmonicityFactors 
    false // updateAllNetworkOutputs
  );
  const uniqueFrequencies = new Set(
    updatedVirtualAudioGraph.networkOutputs
    .filter( oneOutputConfig => {
      // make sure "network output" is not a noise type, but rather an index to a CPPN output
      const networkOutputIsANumber = !isNaN(oneOutputConfig.networkOutput);
      return networkOutputIsANumber;
    } )
    .map( oneOutputConfig => getRoundedFrequencyValue(oneOutputConfig.frequency) )
  );
  for( let oneFrequency of uniqueFrequencies ) {
    if( ! waveNetwork.CPPNs[oneFrequency] ) {
      const oneCPPN = initializeWaveNetwork( evoParams );
      waveNetwork.CPPNs[oneFrequency] = oneCPPN;
    }
  }
}

function initializeWaveNetwork( evoParams ) {
  const evoParamsWaveNetwork = getWaveNetworkParamsFromEvoParams( evoParams );
  let evolver = getEvolver(evoParamsWaveNetwork);
  let cppnNeatWaveNetwork = evolver.getInitialCPPN_NEATgenome();
  evolver = undefined;

  // mutation example
  // let i, num;
  // let cppnNeatParent = cppnNeatWaveNetwork;
  // for (i=0, num=this.state.numberOfNewParentMutations; i<num; ++i) {
  //   cppnNeatWaveNetwork = evolver.getNextCPPN_NEATgenome( [cppnNeatParent.offspring] );
  //   cppnNeatParent = cppnNeatWaveNetwork
  // }

  // console.log(cppnNeatWaveNetwork);
  return cppnNeatWaveNetwork;
}

function getInitialPatchASNEAT( evoParams ) {
  const defaultParameters = getASNEATDefaultParamsFromEvoParams( evoParams );
  const audioNetwork = new Network(defaultParameters);

  // mutation example
  // let i, num;
  // for (i=0, num=this.state.numberOfNewParentMutations/10; i<num; ++i) {
  //   audioNetwork.mutate(
  //     this.state.mutationParams
  //   );
  // }

  // console.log(audioNetwork);
  return audioNetwork;
}


export async function getGenomeFromGenomeString( genomeString, evoParams ) {
  const genomePartiallyStringified = JSON.parse(genomeString);
  const genome = genomePartiallyStringified.genome ? genomePartiallyStringified.genome : genomePartiallyStringified;
  const defaultParameters = getASNEATDefaultParamsFromEvoParams( evoParams );
  const asNEATPatch = await Network.createFromJSON(
    genome.asNEATPatch,
    defaultParameters
  );
  if( genome.waveNetwork.oneCPPNPerFrequency ) {
    // we have one CPPN per frequency
    Object.keys( genome.waveNetwork.CPPNs ).forEach( oneFrequency => {
      if( genome.waveNetwork.CPPNs[oneFrequency].offspring === undefined ) {
        console.error("CPPN offspring missing for frequency", oneFrequency);
      }
      genome.waveNetwork.CPPNs[oneFrequency].offspring = new neatjs.neatGenome(
        `${Math.random()}`,
        genome.waveNetwork.CPPNs[oneFrequency].offspring.nodes,
        genome.waveNetwork.CPPNs[oneFrequency].offspring.connections,
        genome.waveNetwork.CPPNs[oneFrequency].offspring.inputNodeCount,
        genome.waveNetwork.CPPNs[oneFrequency].offspring.outputNodeCount
      );
    });
  } else {
    genome.waveNetwork.offspring = new neatjs.neatGenome(
      `${Math.random()}`,
      genome.waveNetwork.offspring.nodes,
      genome.waveNetwork.offspring.connections,
      genome.waveNetwork.offspring.inputNodeCount,
      genome.waveNetwork.offspring.outputNodeCount
    );
  }
  const waveNetwork = genome.waveNetwork;
  return { 
    id: genomePartiallyStringified._id,
    waveNetwork, asNEATPatch,
    tags: genome.tags,
    parentGenomes: genome.parentGenomes,
    generationNumber: genome.generationNumber
  };
}


function getWaveNetworkParamsFromEvoParams( evoParams ) {
  let evoParamsWaveNetwork;
  if( evoParams && evoParams["waveNetwork"] ) {
    evoParamsWaveNetwork = evoParams["waveNetwork"];
  } else {
    evoParamsWaveNetwork = undefined;
  }
  return evoParamsWaveNetwork;
}
function getASNEATDefaultParamsFromEvoParams( evoParams ) {
  let evoParamsAudioGraph;
  if( evoParams && evoParams["audioGraph"] ) {
    evoParamsAudioGraph = evoParams["audioGraph"];
  } else {
    evoParamsAudioGraph = undefined;
  }
  let defaultParameters;
  if( evoParamsAudioGraph && evoParamsAudioGraph["defaultParameters"] ) {
    defaultParameters = evoParamsAudioGraph["defaultParameters"];
  } else {
    defaultParameters = {};
  }
  return defaultParameters;
}