import Network from '../as-neat/network.js';
import Evolver from '../cppn-neat/network-evolution.js';
import { doesPatchNetworkHaveMinimumFitness } from './patch.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import { getRoundedFrequencyValue } from './range.js';
import { getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta } from '../wavekilde.js';
import neatjs from 'neatjs';
import { INPUTS as CPPN_INPUTS, OUTPUTS as CPPN_OUTPUTS } from '../cppn-neat/evolution-constants.js';

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
  
  // Ensure CPPN has connections to all outputs required by the initial patch
  synchronizeCPPNWithPatch(waveNetwork, asNEATPatch);
  
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
    patchFitnessTestDuration,
    useGPU
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
      console.log('🔧 CPPN mutation - evoParamsWaveNetwork:', {
        hasIecOptions: !!evoParamsWaveNetwork?.iecOptions,
        iecOptions: evoParamsWaveNetwork?.iecOptions,
        hasNeatParameters: !!evoParamsWaveNetwork?.neatParameters
      });
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
          // Crossover with other parents first
          for( let i=1; i<genomes.length; i++ ) {
            patchClone = patchClone.crossWith( genomes[i].asNEATPatch, evoParams.audioGraph.defaultParameters );
          }
          // Then apply mutation after crossover (important for IEC to keep evolving)
          asNEATPatch = patchClone.mutate( asNEATMutationParams );
        } else {
          asNEATPatch = patchClone.mutate( asNEATMutationParams );
        }
        
        // Ensure CPPN has connections to all outputs required by the patch
        // This prevents orphaned wavetable/additive nodes when mutation adds new network outputs
        synchronizeCPPNWithPatch(waveNetwork, asNEATPatch);
        
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
      patchFitnessTestDuration,
      useGPU
    );
    offlineAudioContext = undefined;
    if( ! patchOK ) {
      defectivePatches.push( asNEATPatch );
      console.log(`❌ Patch validation failed, attempt ${patchMutationAttempt}, will retry...`);
    } else {
      console.log(`✅ Patch validation passed on attempt ${patchMutationAttempt}`);
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

/**
 * Get all CPPN output indices required by the patch.
 * These are the "type" values from NetworkOutputNode, NoteNetworkOutputNode, etc.
 * @param {Object} asNEATPatch - The asNEAT patch network
 * @returns {Set<number>} Set of required CPPN output indices
 */
function getRequiredCPPNOutputIndices(asNEATPatch) {
  const requiredOutputs = new Set();
  const networkOutputNodeTypes = [
    'NetworkOutputNode', 'NoteNetworkOutputNode',
    'PartialNetworkOutputNode', 'PartialEnvelopeNetworkOutputNode'
  ];
  
  asNEATPatch.nodes.forEach(node => {
    if (networkOutputNodeTypes.includes(node.name)) {
      // The 'type' property is the CPPN output index (0-17 for numeric, or noise types)
      const outputType = node.type;
      // Only consider numeric output indices (noise types are strings like "noiseWhite")
      if (typeof outputType === 'number' || !isNaN(parseInt(outputType))) {
        const outputIndex = typeof outputType === 'number' ? outputType : parseInt(outputType);
        if (!isNaN(outputIndex)) {
          requiredOutputs.add(outputIndex);
        }
      }
    }
  });
  
  return requiredOutputs;
}

/**
 * Ensure the CPPN has at least one connection leading to each required output.
 * If an output has no incoming connections, add one from a random input node.
 * @param {Object} cppnOffspring - The CPPN genome (neatjs genome)
 * @param {Set<number>} requiredOutputIndices - Set of required CPPN output indices
 * @returns {boolean} True if any connections were added
 */
function ensureCPPNConnectivityToOutputs(cppnOffspring, requiredOutputIndices) {
  if (!cppnOffspring || !requiredOutputIndices || requiredOutputIndices.size === 0) {
    return false;
  }
  
  // CPPN structure: bias(0), inputs(1..inputCount), outputs(inputCount+1..inputCount+outputCount)
  const inputCount = cppnOffspring.inputNodeCount || CPPN_INPUTS;
  const biasAndInputCount = inputCount + 1; // +1 for bias node
  
  // Get the node IDs - in neatjs, nodes are ordered: bias, inputs, outputs, hidden
  // The gid (global id) is typically the innovation ID assigned during creation
  const inputNodeIds = [];
  const outputNodeIds = [];
  const outputNodeIdToIndex = new Map();
  
  cppnOffspring.nodes.forEach((node, idx) => {
    if (idx === 0) {
      // Bias node
      inputNodeIds.push(node.gid);
    } else if (idx <= inputCount) {
      // Input nodes
      inputNodeIds.push(node.gid);
    } else if (idx < biasAndInputCount + (cppnOffspring.outputNodeCount || CPPN_OUTPUTS)) {
      // Output nodes
      const outputIndex = idx - biasAndInputCount;
      outputNodeIds.push(node.gid);
      outputNodeIdToIndex.set(node.gid, outputIndex);
    }
  });
  
  // Find which outputs already have incoming connections
  const outputsWithConnections = new Set();
  cppnOffspring.connections.forEach(conn => {
    if (outputNodeIdToIndex.has(conn.targetID)) {
      outputsWithConnections.add(outputNodeIdToIndex.get(conn.targetID));
    }
  });
  
  // Add connections for required outputs that don't have any
  let connectionsAdded = false;
  requiredOutputIndices.forEach(requiredOutputIndex => {
    if (requiredOutputIndex >= outputNodeIds.length) {
      console.warn(`⚠️ Required CPPN output index ${requiredOutputIndex} exceeds CPPN output count ${outputNodeIds.length}`);
      return;
    }
    
    if (!outputsWithConnections.has(requiredOutputIndex)) {
      // This output has no incoming connections - add one from a random input
      const targetNodeId = outputNodeIds[requiredOutputIndex];
      const sourceNodeId = inputNodeIds[Math.floor(Math.random() * inputNodeIds.length)];
      
      // Create a unique innovation ID for this connection
      const connectionId = `ensured_${sourceNodeId}_${targetNodeId}_${Date.now()}`;
      const randomWeight = (Math.random() * 6) - 3; // Range -3 to 3
      
      const newConnection = new neatjs.neatConnection(
        connectionId,
        randomWeight,
        { sourceID: sourceNodeId, targetID: targetNodeId }
      );
      
      cppnOffspring.connections.push(newConnection);
      connectionsAdded = true;
      console.log(`🔗 Added CPPN connection to output ${requiredOutputIndex}: ${sourceNodeId} → ${targetNodeId} (weight: ${randomWeight.toFixed(3)})`);
    }
  });
  
  return connectionsAdded;
}

/**
 * Synchronize CPPN connectivity with patch requirements.
 * Call this after patch mutation to ensure the CPPN can serve all patch outputs.
 * @param {Object} waveNetwork - The wave network containing CPPN(s)
 * @param {Object} asNEATPatch - The mutated asNEAT patch
 */
function synchronizeCPPNWithPatch(waveNetwork, asNEATPatch) {
  const requiredOutputs = getRequiredCPPNOutputIndices(asNEATPatch);
  
  if (requiredOutputs.size === 0) {
    console.log('🔗 No network outputs in patch, skipping CPPN synchronization');
    return; // No network outputs in patch
  }
  
  console.log(`🔗 Synchronizing CPPN connectivity for ${requiredOutputs.size} required outputs: [${[...requiredOutputs].join(', ')}]`);
  
  if (waveNetwork.oneCPPNPerFrequency) {
    // For one-CPPN-per-frequency, ensure each CPPN has connectivity
    const freqKeys = Object.keys(waveNetwork.CPPNs);
    console.log(`🔗 Processing ${freqKeys.length} frequency-specific CPPNs`);
    freqKeys.forEach(freq => {
      const cppn = waveNetwork.CPPNs[freq];
      if (cppn && cppn.offspring) {
        ensureCPPNConnectivityToOutputs(cppn.offspring, requiredOutputs);
      }
    });
  } else {
    // Single CPPN mode
    if (waveNetwork.offspring) {
      ensureCPPNConnectivityToOutputs(waveNetwork.offspring, requiredOutputs);
    } else {
      console.warn('🔗 waveNetwork.offspring is undefined, cannot synchronize CPPN');
    }
  }
}