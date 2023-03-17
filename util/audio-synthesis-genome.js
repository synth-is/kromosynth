import Network from '../as-neat/network.js';
import Evolver from '../cppn-neat/network-evolution.js';
import { doesPatchNetworkHaveMinimumFitness } from './patch.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import neatjs from 'neatjs';

let evolver;

function getEvolver(evoParamsWaveNetwork) {
  if( ! evolver ) evolver = new Evolver(evoParamsWaveNetwork);
  return evolver;
}

// returns a new basic individual for synthesizing sound, consisting of
// a wave generating network and an audio signal patch (accepting wave inputs from the network)
export function getNewAudioSynthesisGenome(evolutionRunId, generationNumber, parentIndex, evoParams) {
  const waveNetwork = initializeWaveNetwork( evoParams );
  const asNEATPatch = getInitialPatchASNEAT( evoParams );
  const virtualAudioGraph = patchFromAsNEATnetwork( asNEATPatch.toJSON() );
  return {
    waveNetwork, asNEATPatch, virtualAudioGraph,
    evolutionRunId, generationNumber, parentIndex,
    updated: Date.now()
  };
}

export async function getNewAudioSynthesisGenomeByMutation(
    genome,
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
  if( Math.random() < probabilityMutatingWaveNetwork 
    // && patchHasNetworkOutputs 
  ) {
    // mutate the wave network outputs
    const evoParamsWaveNetwork = getWaveNetworkParamsFromEvoParams( evoParams );
    waveNetwork = getEvolver(evoParamsWaveNetwork).getNextCPPN_NEATgenome( [genome.waveNetwork.offspring] );
  } else {
    waveNetwork = genome.waveNetwork;
  }
  if( Math.random() < probabilityMutatingPatch ) {
    let patchOK;
    let patchMutationAttempt = 0;
    const defectivePatches = [];
    do {
      let patchClone = genome.asNEATPatch.clone();
      asNEATPatch = patchClone.mutate( asNEATMutationParams );
      let offlineAudioContext;
      if( OfflineAudioContext ) {
        const SAMPLE_RATE = 44100;
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
      if( ! patchOK ) {
        defectivePatches.push( asNEATPatch );
      }
      patchMutationAttempt++;
    } while( ! patchOK );
  } else {
    asNEATPatch = genome.asNEATPatch;
  }
  const virtualAudioGraph = patchFromAsNEATnetwork( asNEATPatch.toJSON() );
  return {
    waveNetwork, asNEATPatch, virtualAudioGraph,
    evolutionRunId, generationNumber, parentIndex, algorithm,
    updated: Date.now()
  };
}

function initializeWaveNetwork( evoParams ) {
  const evoParamsWaveNetwork = getWaveNetworkParamsFromEvoParams( evoParams );
  let cppnNeatWaveNetwork = getEvolver(evoParamsWaveNetwork).getInitialCPPN_NEATgenome();

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
  const neatOffspring = genome.waveNetwork.offspring;
  genome.waveNetwork.offspring = new neatjs.neatGenome(
    `${Math.random()}`,
    neatOffspring.nodes,
    neatOffspring.connections,
    neatOffspring.inputNodeCount,
    neatOffspring.outputNodeCount
  );
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