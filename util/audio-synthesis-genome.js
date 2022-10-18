import Network from '../as-neat/network';
import Evolver from '../cppn-neat/network-evolution';
import { doesPatchNetworkHaveMinimumFitness } from './patch';
import neatjs from 'neatjs';

let evolver;

function getEvolver() {
  if( ! evolver ) evolver = new Evolver();
  return evolver;
}

// returns a new basic individual for synthesizing sound, consisting of
// a wave generating network and an audio signal patch (accepting wave inputs from the network)
export function getNewAudioSynthesisGenome(evolutionRunId, generationNumber, parentIndex) {
  const waveNetwork = initializeWaveNetwork();
  const asNEATPatch = getInitialPatchASNEAT();
  return {
    waveNetwork, asNEATPatch,
    evolutionRunId, generationNumber, parentIndex,
    updated: Date.now()
  };
}

export async function getNewAudioSynthesisGenomeByMutation(
    genome,
    evolutionRunId, generationNumber, parentIndex, algorithm,
    probabilityMutatingWaveNetwork = 0.5,
    probabilityMutatingPatch = 0.5,
    asNEATMutationParams = {}
) {
  let waveNetwork, asNEATPatch;
  const patchHasNetworkOutputs = genome.asNEATPatch.nodes.filter(
    n => n.name === "NetworkOutputNode" || n.name === "NoteNetworkOutputNode"
  ).length > 0;
  if( Math.random() < probabilityMutatingWaveNetwork && patchHasNetworkOutputs ) {
    // mutate the wave network outputs
    waveNetwork = getEvolver().getNextCPPN_NEATgenome( [genome.waveNetwork.offspring] );
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
      patchOK = await doesPatchNetworkHaveMinimumFitness(asNEATPatch, waveNetwork, audioCtx);
      if( ! patchOK ) {
        defectivePatches.push( defectivePatches );
      }
      patchMutationAttempt++;
    } while( ! patchOK );
  } else {
    asNEATPatch = genome.asNEATPatch;
  }
  return {
    waveNetwork, asNEATPatch,
    evolutionRunId, generationNumber, parentIndex, algorithm,
    updated: Date.now()
  };
}

function initializeWaveNetwork() {
  let cppnNeatWaveNetwork = getEvolver().getInitialCPPN_NEATgenome();

  // mutation example
  // let i, num;
  // let cppnNeatParent = cppnNeatWaveNetwork;
  // for (i=0, num=this.state.numberOfNewParentMutations; i<num; ++i) {
  //   cppnNeatWaveNetwork = evolver.getNextCPPN_NEATgenome( [cppnNeatParent.offspring] );
  //   cppnNeatParent = cppnNeatWaveNetwork
  // }

  console.log(cppnNeatWaveNetwork);
  return cppnNeatWaveNetwork;
}

function getInitialPatchASNEAT() {
  const audioNetwork = new Network({});

  // mutation example
  // let i, num;
  // for (i=0, num=this.state.numberOfNewParentMutations/10; i<num; ++i) {
  //   audioNetwork.mutate(
  //     this.state.mutationParams
  //   );
  // }

  console.log(audioNetwork);
  return audioNetwork;
}


export async function getGenomeFromGenomeString( genomeString ) {
  const genomePartiallyStringified = JSON.parse(genomeString);

  const asNEATPatch = await Network.createFromJSON(
    genomePartiallyStringified.asNEATPatch
  );
  const neatOffspring = genomePartiallyStringified.waveNetwork.offspring;
  genomePartiallyStringified.waveNetwork.offspring = new neatjs.neatGenome(
    `${Math.random()}`,
    neatOffspring.nodes,
    neatOffspring.connections,
    neatOffspring.inputNodeCount,
    neatOffspring.outputNodeCount
  );
  const waveNetwork = genomePartiallyStringified.waveNetwork;
  return { waveNetwork, asNEATPatch };
}
