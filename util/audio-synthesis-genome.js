import Network from '../as-neat/network.js';
import Evolver from '../cppn-neat/network-evolution.js';
import { doesPatchNetworkHaveMinimumFitness } from './patch.js';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';
import { getRoundedFrequencyValue } from './range.js';
import { getPatchWithBufferFrequenciesUpdatedAccordingToNoteDelta } from '../wavekilde.js';
import neatjs from 'neatjs';
import Activator from '../cppn-neat/network-activation.js';

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
    patchFitnessTestDuration,
    useGPU,
    validateCPPNRanges = false, // Optional CPPN range validation (disabled by default)
    cppnRangeValidationOptions = {} // Options for CPPN range validation
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
        
        // Collect all unique frequency keys from all parent genomes
        const allFrequencyKeys = new Set();
        genomes.forEach(g => {
          Object.keys(g.waveNetwork.CPPNs).forEach(key => {
            // Skip "all" key - it's universal and should be used for actual frequencies
            if (key !== 'all') {
              allFrequencyKeys.add(key);
            }
          });
        });
        
        // If no specific frequencies found, use a default set
        if (allFrequencyKeys.size === 0) {
          console.log('⚠️  No specific frequency keys found, using default frequencies');
          // Use some default frequencies if all parents are universal
          allFrequencyKeys.add('280');
          allFrequencyKeys.add('730');
        }
        
        console.log('🎯 Breeding CPPNs for frequencies:', Array.from(allFrequencyKeys));
        
        Array.from(allFrequencyKeys).forEach( oneFrequency => {
          // we've won the probability of mutating CPPN(s)
          // but as we have one CPPN specialsing on each frequency, let's have another probability of mutating each:
          // - for now just half chance - TODO: configurable?
          if( Math.random() < 0.5 ) {
            if( waveNetwork.CPPNs[oneFrequency] === undefined ) {
              waveNetwork.CPPNs[oneFrequency] = {};
            }
            
            console.log(`🧬 Preparing to breed CPPN for frequency: ${oneFrequency}`);
            
            try {
              // Collect parent CPPNs with detailed logging
              const parentCPPNs = genomes.map((g, idx) => {
                const frequencyKeys = Object.keys( g.waveNetwork.CPPNs );
                
                console.log(`  Parent ${idx}:`, {
                  frequencyKeys,
                  isUniversal: frequencyKeys.includes('all'),
                  targetFrequency: oneFrequency
                });
                
                // Handle universal CPPN (key="all") - use it for any frequency
                if( frequencyKeys.includes('all') ) {
                  const universalCPPN = g.waveNetwork.CPPNs['all'].offspring;
                  console.log(`  Parent ${idx}: Using universal CPPN`, {
                    hasOffspring: !!universalCPPN,
                    offspringType: typeof universalCPPN,
                    hasNodes: !!universalCPPN?.nodes,
                    hasConnections: !!universalCPPN?.connections,
                    nodeCount: universalCPPN?.nodes?.length,
                    connectionCount: universalCPPN?.connections?.length
                  });
                  return universalCPPN;
                }
                
                // Handle specific frequency CPPNs - find closest match
                const closestFrequency = frequencyKeys.reduce( 
                  (prev, curr) => Math.abs(curr - oneFrequency) < Math.abs(prev - oneFrequency) ? curr : prev 
                );
                const specificCPPN = g.waveNetwork.CPPNs[closestFrequency].offspring;
                console.log(`  Parent ${idx}: Using frequency-specific CPPN (${closestFrequency})`, {
                  hasOffspring: !!specificCPPN,
                  offspringType: typeof specificCPPN,
                  hasNodes: !!specificCPPN?.nodes,
                  hasConnections: !!specificCPPN?.connections,
                  nodeCount: specificCPPN?.nodes?.length,
                  connectionCount: specificCPPN?.connections?.length
                });
                return specificCPPN;
              });
              
              console.log(`🔬 Calling evolver.getNextCPPN_NEATgenome for frequency ${oneFrequency}...`);
              const result = evolver.getNextCPPN_NEATgenome( parentCPPNs );
              console.log(`✅ Evolver returned result:`, {
                hasResult: !!result,
                resultType: typeof result,
                hasOffspring: !!result?.offspring,
                offspringType: typeof result?.offspring
              });
              
              const offspring = result.offspring;
              waveNetwork.CPPNs[oneFrequency].offspring = offspring;
              console.log(`✅ Successfully bred CPPN for frequency ${oneFrequency}`);
            } catch (error) {
              console.error(`❌ Error breeding CPPN for frequency ${oneFrequency}:`, error);
              console.error('Stack trace:', error.stack);
              throw error;
            }
          } else { // no mutation
            console.log(`⏭️  Skipping mutation for frequency ${oneFrequency}, copying from parent`);
            
            // Check if the first parent has this specific frequency or a universal CPPN
            const firstParentKeys = Object.keys(genomes[0].waveNetwork.CPPNs);
            
            if (firstParentKeys.includes(oneFrequency)) {
              // Parent has this specific frequency - copy it directly
              console.log(`  ↳ Copying frequency-specific CPPN from parent`);
              waveNetwork.CPPNs[oneFrequency] = genomes[0].waveNetwork.CPPNs[oneFrequency];
            } else if (firstParentKeys.includes('all')) {
              // Parent has universal CPPN - copy it for this frequency
              console.log(`  ↳ Copying universal CPPN from parent`);
              const universalCPPN = genomes[0].waveNetwork.CPPNs['all'];
              const newCPPN = JSON.parse(JSON.stringify(universalCPPN));
              
              // Update frequency range to be specific
              newCPPN.frequencyRange = {
                min: parseInt(oneFrequency) - 50,
                max: parseInt(oneFrequency) + 50
              };
              
              // CRITICAL: Reconstruct the NEAT genome fresh from the serialized data
              if (universalCPPN.offspring) {
                const genomeData = universalCPPN.offspring.toJSON ? 
                  universalCPPN.offspring.toJSON() : 
                  universalCPPN.offspring;
                newCPPN.offspring = new neatjs.neatGenome(
                  `${Math.random()}`,
                  genomeData.nodes,
                  genomeData.connections,
                  genomeData.inputNodeCount,
                  genomeData.outputNodeCount
                );
              }
              
              waveNetwork.CPPNs[oneFrequency] = newCPPN;
            } else {
              // No matching frequency - try to find closest or use from other parent
              console.log(`  ↳ First parent missing frequency ${oneFrequency}, trying other parents`);
              let copiedFromOtherParent = false;
              for (let i = 1; i < genomes.length; i++) {
                const parentKeys = Object.keys(genomes[i].waveNetwork.CPPNs);
                if (parentKeys.includes(oneFrequency)) {
                  waveNetwork.CPPNs[oneFrequency] = genomes[i].waveNetwork.CPPNs[oneFrequency];
                  copiedFromOtherParent = true;
                  console.log(`  ↳ Copied from parent ${i}`);
                  break;
                } else if (parentKeys.includes('all')) {
                  const universalCPPN = genomes[i].waveNetwork.CPPNs['all'];
                  const newCPPN = JSON.parse(JSON.stringify(universalCPPN));
                  
                  newCPPN.frequencyRange = {
                    min: parseInt(oneFrequency) - 50,
                    max: parseInt(oneFrequency) + 50
                  };
                  
                  // CRITICAL: Reconstruct the NEAT genome fresh from the serialized data
                  if (universalCPPN.offspring) {
                    const genomeData = universalCPPN.offspring.toJSON ? 
                      universalCPPN.offspring.toJSON() : 
                      universalCPPN.offspring;
                    newCPPN.offspring = new neatjs.neatGenome(
                      `${Math.random()}`,
                      genomeData.nodes,
                      genomeData.connections,
                      genomeData.inputNodeCount,
                      genomeData.outputNodeCount
                    );
                  }
                  
                  waveNetwork.CPPNs[oneFrequency] = newCPPN;
                  copiedFromOtherParent = true;
                  console.log(`  ↳ Copied universal CPPN from parent ${i}`);
                  break;
                }
              }
              if (!copiedFromOtherParent) {
                console.warn(`  ⚠️ No parent has frequency ${oneFrequency}, will initialize later`);
              }
            }
          }
        });
      } else {
        // This branch should never execute now (all genomes normalized to multi-CPPN)
        console.warn('⚠️ Unexpected: genome without oneCPPNPerFrequency after normalization');
        waveNetwork = evolver.getNextCPPN_NEATgenome( genomes.map( g => g.waveNetwork.offspring ) );
      }
      evolver = undefined;
    } else {
      // No wave network mutation - copy from first parent
      console.log('⏭️  Skipping wave network mutation, copying from parent');
      
      // Deep copy to avoid modifying the original
      waveNetwork = JSON.parse(JSON.stringify(genomes[0].waveNetwork));
      
      // CRITICAL: Reconstruct NEAT genomes after JSON copy
      // JSON.parse(JSON.stringify(...)) strips methods from reconstructed NEAT genome objects
      if (waveNetwork.oneCPPNPerFrequency && waveNetwork.CPPNs) {
        Object.keys(waveNetwork.CPPNs).forEach(frequencyKey => {
          const cppn = waveNetwork.CPPNs[frequencyKey];
          if (cppn && cppn.offspring) {
            // Reconstruct fresh NEAT genome with all methods
            const genomeData = cppn.offspring;
            cppn.offspring = new neatjs.neatGenome(
              `${Math.random()}`,
              genomeData.nodes,
              genomeData.connections,
              genomeData.inputNodeCount,
              genomeData.outputNodeCount
            );
            console.log(`  ↳ Reconstructed NEAT genome for frequency ${frequencyKey}`);
          }
        });
      }
      
      // If the parent has a universal CPPN (key="all"), we need to expand it
      // to the specific frequencies that will be needed by the patch
      if (waveNetwork.oneCPPNPerFrequency && waveNetwork.CPPNs && waveNetwork.CPPNs['all']) {
        console.log('🔄 Parent has universal CPPN, will expand to specific frequencies after patch creation');
        // We'll let initialiseCPPNForEachFrequencyIfNotExists handle this by
        // using the universal CPPN as a template for missing frequencies
      }
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
      patchFitnessTestDuration,
      useGPU
    );
    offlineAudioContext = undefined;

    // Optional CPPN range validation
    let cppnRangesOK = true;
    if (patchOK && validateCPPNRanges && waveNetwork) {
      cppnRangesOK = await validateCPPNOutputRanges(waveNetwork, cppnRangeValidationOptions);
      if (!cppnRangesOK) {
        console.log(`⚠️  CPPN range validation failed (attempt ${patchMutationAttempt}), retrying...`);
      }
    }

    // Combine both validations
    patchOK = patchOK && cppnRangesOK;

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
  
  // Check if we have a universal CPPN that can be used as a template
  const hasUniversalCPPN = waveNetwork.CPPNs && waveNetwork.CPPNs['all'];
  
  for( let oneFrequency of uniqueFrequencies ) {
    if( ! waveNetwork.CPPNs[oneFrequency] ) {
      console.log(`🔧 Initializing CPPN for frequency ${oneFrequency}`);
      
      // If we have a universal CPPN, copy it for this specific frequency
      if (hasUniversalCPPN) {
        console.log(`  ↳ Using universal CPPN as template`);
        
        // Deep copy the universal CPPN structure for this frequency
        const universalCPPN = waveNetwork.CPPNs['all'];
        const newCPPN = JSON.parse(JSON.stringify(universalCPPN));
        
        // Update the frequency range to be specific
        newCPPN.frequencyRange = {
          min: oneFrequency - 50,
          max: oneFrequency + 50
        };
        
        // CRITICAL: If the universal CPPN has a reconstructed NEAT genome (offspring property),
        // we need to reconstruct it fresh for this frequency-specific CPPN
        if (universalCPPN.offspring) {
          console.log(`  ↳ Reconstructing NEAT genome for frequency ${oneFrequency}`);
          // Access the genome data directly (works whether offspring is reconstructed or not)
          const offspringData = universalCPPN.offspring;
          
          // Reconstruct fresh NEAT genome for this frequency
          newCPPN.offspring = new neatjs.neatGenome(
            `${Math.random()}`,
            offspringData.nodes,
            offspringData.connections,
            offspringData.inputNodeCount,
            offspringData.outputNodeCount
          );
        }
        
        waveNetwork.CPPNs[oneFrequency] = newCPPN;
      } else {
        // No universal CPPN available, create a new one from scratch
        console.log(`  ↳ Creating new CPPN from scratch`);
        const oneCPPN = initializeWaveNetwork( evoParams );
        waveNetwork.CPPNs[oneFrequency] = oneCPPN;
      }
    }
  }
  
  // If we used a universal CPPN as a template and created frequency-specific copies,
  // we can optionally remove the universal CPPN (or keep it for backward compatibility)
  // For now, we'll keep it to maintain compatibility with the breeding logic
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
  
  // Unwrap genome data - handle both single and double nesting
  let genome = genomePartiallyStringified.genome ? genomePartiallyStringified.genome : genomePartiallyStringified;
  
  // If still nested (has .genome property but no asNEATPatch/waveNetwork), unwrap again
  if (genome.genome && !genome.asNEATPatch && !genome.waveNetwork) {
    console.log('🔄 Double-nested genome detected, unwrapping again...');
    genome = genome.genome;
  }
  
  // Validate genome architecture
  const hasSingleCPPN = genome.waveNetwork?.offspring && !genome.waveNetwork?.oneCPPNPerFrequency;
  const hasMultiCPPN = genome.waveNetwork?.CPPNs && genome.waveNetwork?.oneCPPNPerFrequency;
  
  if (!hasSingleCPPN && !hasMultiCPPN) {
    console.error('❌ Invalid genome structure:', {
      hasOffspring: !!genome.waveNetwork?.offspring,
      hasCPPNs: !!genome.waveNetwork?.CPPNs,
      oneCPPNPerFrequency: genome.waveNetwork?.oneCPPNPerFrequency,
      waveNetworkKeys: genome.waveNetwork ? Object.keys(genome.waveNetwork) : 'undefined'
    });
    throw new Error('Genome has invalid waveNetwork structure - must have either offspring (single CPPN) or CPPNs (multi-CPPN) format');
  }
  
  // NORMALIZE: Convert single-CPPN to multi-CPPN format for compatibility
  // Single CPPN becomes a universal CPPN that handles all frequency ranges
  if (hasSingleCPPN) {
    console.log('🔄 Normalizing single-CPPN genome to multi-CPPN format (universal CPPN)');
    const singleCPPNData = genome.waveNetwork.offspring;
    
    // Create CPPNs object with special "all" key representing all frequencies
    genome.waveNetwork = {
      oneCPPNPerFrequency: true,
      CPPNs: {
        "all": {
          offspring: singleCPPNData,
          frequencyRange: { min: 0, max: Infinity } // Universal range
        }
      }
    };
  }
  
  console.log('🔍 Genome architecture:', {
    format: 'Multi-CPPN (normalized)',
    isUniversalCPPN: !!genome.waveNetwork.CPPNs?.all,
    frequencyKeys: Object.keys(genome.waveNetwork.CPPNs || {}),
    hasAsNEATPatch: !!genome.asNEATPatch,
    hasWaveNetwork: !!genome.waveNetwork
  });
  
  const defaultParameters = getASNEATDefaultParamsFromEvoParams( evoParams );
  const asNEATPatch = await Network.createFromJSON(
    genome.asNEATPatch,
    defaultParameters
  );
  
  // Process all CPPNs (now guaranteed to be in multi-CPPN format)
  Object.keys( genome.waveNetwork.CPPNs ).forEach( oneFrequency => {
    if( genome.waveNetwork.CPPNs[oneFrequency].offspring === undefined ) {
      console.error("❌ CPPN offspring missing for frequency", oneFrequency);
      throw new Error(`CPPN offspring undefined for frequency ${oneFrequency}`);
    }
    
    const offspringData = genome.waveNetwork.CPPNs[oneFrequency].offspring;
    console.log(`🔧 Reconstructing NEAT genome for frequency ${oneFrequency}:`, {
      hasNodes: !!offspringData.nodes,
      hasConnections: !!offspringData.connections,
      nodeCount: offspringData.nodes?.length,
      connectionCount: offspringData.connections?.length,
      inputNodeCount: offspringData.inputNodeCount,
      outputNodeCount: offspringData.outputNodeCount
    });
    
    // Validate required properties before creating NEAT genome
    if (!offspringData.nodes) {
      throw new Error(`CPPN for frequency ${oneFrequency} missing 'nodes' property`);
    }
    if (!offspringData.connections) {
      throw new Error(`CPPN for frequency ${oneFrequency} missing 'connections' property`);
    }
    if (offspringData.inputNodeCount === undefined) {
      throw new Error(`CPPN for frequency ${oneFrequency} missing 'inputNodeCount' property`);
    }
    if (offspringData.outputNodeCount === undefined) {
      throw new Error(`CPPN for frequency ${oneFrequency} missing 'outputNodeCount' property`);
    }
    
    genome.waveNetwork.CPPNs[oneFrequency].offspring = new neatjs.neatGenome(
      `${Math.random()}`,
      offspringData.nodes,
      offspringData.connections,
      offspringData.inputNodeCount,
      offspringData.outputNodeCount
    );
    
    console.log(`✅ NEAT genome reconstructed for frequency ${oneFrequency}`);
  });
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
 * Validates that CPPN outputs stay within the [-1, 1] range
 * Returns true if valid, false if out-of-range values detected
 *
 * @param {Object} waveNetwork - The CPPN network to validate
 * @param {Object} options - Validation options
 * @param {number} options.sampleRate - Sample rate for activation (default: 48000)
 * @param {number} options.duration - Duration in seconds (default: 1)
 * @param {number} options.sampleStep - Analyze every Nth sample (default: 5000)
 * @param {number} options.maxExceedanceRate - Maximum allowed exceedance rate (default: 0.0, i.e., no exceedances)
 * @param {Array<number>} options.testFrequencies - Frequencies to test (default: [1, 10, 100, 440, 1000, 4000])
 */
async function validateCPPNOutputRanges(waveNetwork, options = {}) {
  const {
    sampleRate = 48000,
    duration = 1,
    sampleStep = 5000,
    maxExceedanceRate = 0.0,
    testFrequencies = [1, 10, 100, 440, 1000, 4000]
  } = options;

  const activator = new Activator(sampleRate);
  const totalSamples = sampleRate * duration;
  const samplesToAnalyze = Math.ceil(totalSamples / sampleStep);

  try {
    let allOutputs = new Map();

    if (waveNetwork.oneCPPNPerFrequency && waveNetwork.CPPNs) {
      // Multi-CPPN mode: Activate each CPPN at its designated frequency
      const cppnFrequencies = Object.keys(waveNetwork.CPPNs).map(f => parseFloat(f));

      const outputIndexes = cppnFrequencies.map(freq => ({
        index: 0,
        frequency: freq
      }));

      const outputs = await activator.activateMember(
        waveNetwork,
        null, // patch
        outputIndexes,
        samplesToAnalyze,
        null, // sampleCountToActivate
        0, // sampleOffset
        false, // useGPU
        false, // reverse
        true, // variationOnPeriods
        1, // velocity
        false // antiAliasing
      );

      for (const [key, value] of outputs.entries()) {
        allOutputs.set(key, value);
      }

    } else {
      // Single-CPPN mode: Test at multiple frequencies
      const numberOfOutputs = waveNetwork.offspring?.outputNeuronCount || waveNetwork.outputNeuronCount || 18;

      for (const freq of testFrequencies) {
        const outputIndexes = Array.from({ length: numberOfOutputs }, (_, i) => ({
          index: i,
          frequency: freq
        }));

        const outputs = await activator.activateMember(
          waveNetwork,
          null, // patch
          outputIndexes,
          samplesToAnalyze,
          null, // sampleCountToActivate
          0, // sampleOffset
          false, // useGPU
          false, // reverse
          true, // variationOnPeriods
          1, // velocity
          false // antiAliasing
        );

        for (const [key, value] of outputs.entries()) {
          allOutputs.set(key, value);
        }
      }
    }

    // Check for exceedances
    let totalSamplesChecked = 0;
    let exceedances = 0;

    for (const [, outputData] of allOutputs.entries()) {
      const samples = outputData.samples;
      if (!samples) continue;

      for (let i = 0; i < samples.length; i++) {
        const value = samples[i];
        totalSamplesChecked++;

        if (value < -1.0 || value > 1.0) {
          exceedances++;
        }
      }
    }

    const exceedanceRate = totalSamplesChecked > 0 ? exceedances / totalSamplesChecked : 0;

    // Return true if exceedance rate is within acceptable limits
    return exceedanceRate <= maxExceedanceRate;

  } catch (error) {
    console.warn('⚠️  CPPN range validation error:', error.message);
    // On error, consider it valid to avoid blocking evolution
    // (malformed CPPNs will likely fail other fitness tests anyway)
    return true;
  }
}