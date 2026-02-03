import neatjs from 'neatjs';
import cppnjs from 'cppnjs';
import { setActivationFunctions } from './activation-functions.js';
import { getMemberOutputsKey } from '../util/network-output.js';
import { addInputFunctionsToGPU } from '../util/gpu-functions.js';
import { lerp, getRoundedFrequencyValue } from '../util/range.js';
import { randomFromInterval, halfChance } from '../util/random.js';
import {GPU} from 'gpu.js';

const ENVIRONMENT_IS_NODE = typeof process==="object"&&typeof process.versions==="object"&&typeof process.versions.node==="string";

// import NetworkActivationGPUWorker from "../workers/network-activation-gpu-worker.js?worker";

/**
 * Activates outputs of the provided network
 */

// let gpu;

class Activator {

  constructor( sampleRate, useGPU = false ) {

    this.sampleRate = sampleRate;
    this.useGPU = useGPU;

    setActivationFunctions( cppnjs );
    
    this.gpu = null;
  }

  getGPU() {
    if( !this.gpu && this.useGPU ) {
      console.log('🚀 GPU acceleration enabled for CPPN rendering');
      this.gpu = new GPU();
      addInputFunctionsToGPU( this.gpu );
    } else if (!this.useGPU) {
      console.warn('⚠️  GPU acceleration is DISABLED - using CPU rendering');
    }
    return this.gpu;
  }

  destroy() {
    if (this.gpu) {
      this.gpu.destroy();
      this.gpu = null;
    }
  }

  getInputSignals(
      totalSampleCount, sampleCountToActivate, sampleOffset,
      inputPeriods, variationOnPeriods,
      velocity = 1
    ) {

    const startInputSignalsCalculation = performance.now();
    let inputSignals = Array(sampleCountToActivate).fill(0).map((v,c) => {
      let rangeFraction = (c+sampleOffset) / (totalSampleCount-1);
      let mainInputSignal = lerp( -1, 1, rangeFraction );
      if( variationOnPeriods ) {
        var extraInput = Math.sin( inputPeriods * mainInputSignal );
      } else {
        var extraInput = Math.sin( inputPeriods * Math.abs(mainInputSignal) );
      }
      return [extraInput * velocity, mainInputSignal /* * velocity*/];
    });
    const endInputSignalsCalculation = performance.now();
    // console.log(`%c InputSignalsCalculation took ${endInputSignalsCalculation - startInputSignalsCalculation} milliseconds for inputPeriods: ${inputPeriods}`,'color:orange');
    return inputSignals;
  }

  getOutputSignals( inputSignals, outputIndexes, memberCPPN ) {
    // const startOutputSignalsCalculation = performance.now();

    const outputSignals = {};
    // outputIndexes.forEach( outputIndex => {
    for( let outputIndex of outputIndexes ) {
      // typed array for samples; results in faster transfers via message passing from worker
      outputSignals[outputIndex] = new Float32Array( inputSignals.length );
    } //);

    let recursiveActivationTime = 0;
    // inputSignals.forEach( (signalSet, sampleIndex) => {
    for( let sampleIndex = 0; sampleIndex < inputSignals.length; sampleIndex++ ) {
      const signalSet = inputSignals[sampleIndex];

      memberCPPN.clearSignals();
      memberCPPN.setInputSignals( signalSet );
      const startRecursiveActivation = performance.now();
      memberCPPN.recursiveActivation();
      const endRecursiveActivation = performance.now();
      recursiveActivationTime += endRecursiveActivation - startRecursiveActivation;

      // outputIndexes.forEach( outputIndex => {
      for( let outputIndex of outputIndexes ) {
        outputSignals[outputIndex][sampleIndex] = memberCPPN.getOutputSignal(outputIndex);
      } //);
    } //);
    // const endOutputSignalsCalculation = performance.now();
    // const outputSignalsCalculationTime = endOutputSignalsCalculation - startOutputSignalsCalculation
    // console.log(`%c OutputSignalsCalculation took
    //   ${outputSignalsCalculationTime} milliseconds,
    //   of which recursive activation took ${recursiveActivationTime},
    //   ${(recursiveActivationTime/outputSignalsCalculationTime)*100}%`,
    //   'color:orange');
    return outputSignals;
  }

  getCPPNFromMember( member ) {
    let cppn;
    if( member === undefined ) {
      throw "Member is undefined";
    }
    if( member.constructor.name === 'NeatGenome' ) {
      cppn = member.networkDecode();
    } else if( member.offspring.networkDecode ) {
      cppn = member.offspring.networkDecode();
    } else {
      // we didn't receive member as a neatjs/cppnjs instance,
      // but rather an object representation of it,
      // so we'll use the data from that object to create a new instance:
      cppn = new neatjs.neatGenome(`${Math.random()}`,
      member.offspring.nodes,
      member.offspring.connections,
      member.offspring.inputNodeCount,
      member.offspring.outputNodeCount ).networkDecode();
    }
    return cppn;
  }

  activateMember(
    member,
    patch,
    outputsToActivate,
    totalSampleCount,
    sampleCountToActivate,
    sampleOffset,
    useGPU = false,
    reverse = false,
    variationOnPeriods = true,
    velocity = 1,
    antiAliasing = false
  ) {

    let _totalSampleCount;
    let _sampleCountToActivate;
    if( antiAliasing ) {
      _totalSampleCount = totalSampleCount * 2;
      if( sampleCountToActivate ) {
        _sampleCountToActivate = sampleCountToActivate * 2;
      }
    } else {
      _totalSampleCount = totalSampleCount;
      if( sampleCountToActivate ) {
        _sampleCountToActivate = sampleCountToActivate;
      }
    }

    if( ! _sampleCountToActivate ) {
      // ^ optional constructor parameter,
      // to only create input signals to activate a subset
      // of the desired total sampleCount,
      // useful for multicore computation on multiple sub-web workers.
      _sampleCountToActivate = _totalSampleCount;
    }
    if( ! sampleOffset ) sampleOffset = 0;

    return new Promise( async (resolve, reject) => {

      let memberCPPN;
      if( ! member.oneCPPNPerFrequency ) {
        memberCPPN = this.getCPPNFromMember( member );
      } // otherwise we'll fetch a CPPN for each unique frequency below

      let memberOutputs = new Map();

      let _outputsToActivate;
      if( outputsToActivate ) {
        _outputsToActivate = outputsToActivate;
      } else if( patch && ! Number.isInteger(patch) ) {
        _outputsToActivate = this.getOutputsToActivateFromPatch( patch );
      } else {
        // activate all outputs, each with random frequency,
        // or a fixed one if patch is an integer:
        _outputsToActivate = Array.apply(null, Array(memberCPPN.outputNeuronCount))
            .map(function(x,i){
              let frequency = Number.isInteger(patch) ? patch : null;
              if( ! frequency ) {
                frequency: halfChance() ?
                  randomFromInterval( 1, 19 )  // LFO
                  : randomFromInterval( 20, 20000 ); // Audio frequency
              }
              return {
                index: i,
                frequency
              };
            }.bind(this));  //wtf: http://www.2ality.com/2013/11/initializing-arrays.html
      }
      // console.log("---_outputsToActivate:",_outputsToActivate);
      // const frequenciesUpdated = {};

      // _outputsToActivate.forEach( function(oneOutput) {
      for( let oneOutput of _outputsToActivate ) {
        const memberOutputsKey = getMemberOutputsKey( oneOutput );
        memberOutputs.set( memberOutputsKey, {
          samples: undefined,
          frequency: oneOutput.frequency,
          // Store original frequency for CPPN lookup when using oneCPPNPerFrequency with noteDelta
          originalFrequency: oneOutput.originalFrequency || oneOutput.frequency
        });

        // if( oneOutput.frequencyUpdated ) {
        //   frequenciesUpdated[oneOutput.frequency] = true;
        // }
      } //.bind(this));

      // let's only activate the network once per unique input periods value / sample
      let uniqueFrequencies = new Set( _outputsToActivate.map( o => {
          const memberOutputsKey = getMemberOutputsKey( o );
          return memberOutputs.get(memberOutputsKey).frequency;
        })
      );

      let nodeOrder, stringFunctions;
      if( useGPU && ! member.oneCPPNPerFrequency ) {
        const pureCPPNFunctions = memberCPPN.createPureCPPNFunctions();
        nodeOrder = pureCPPNFunctions.nodeOrder;
        stringFunctions = pureCPPNFunctions.stringFunctions;
      }

      const outputSignalsPromises = [];
      const networkActivationStart = performance.now();
      // uniqueFrequencies.forEach(function( frequency ) {
      for( let frequency of uniqueFrequencies ) {

        const outputIndexs = [];
        if( member.oneCPPNPerFrequency ) {
          // we have one CPPN specialised on each unique frequency
          // Use originalFrequency (before noteDelta) for CPPN lookup
          // Find the original frequency by checking any output with this modified frequency
          let frequencyForLookup = frequency;
          for( let oneOutput of _outputsToActivate ) {
            const memberOutputsKey = getMemberOutputsKey( oneOutput );
            const outputData = memberOutputs.get(memberOutputsKey);
            if( outputData.frequency === frequency && outputData.originalFrequency ) {
              frequencyForLookup = outputData.originalFrequency;
              break;
            }
          }
          const lookupFreq = getRoundedFrequencyValue( frequencyForLookup );
          let oneFrequencyCPPNMember = member.CPPNs[lookupFreq];

          if (!oneFrequencyCPPNMember) {
            console.warn(`[NetworkActivation] Missing CPPN for freq ${frequencyForLookup} (rounded: ${lookupFreq}). Keys:`, Object.keys(member.CPPNs).slice(0, 5));
            // Fallback: try to find a nearby key
            const keys = Object.keys(member.CPPNs).map(Number);
            if (keys.length > 0) {
              const closest = keys.reduce((prev, curr) => Math.abs(curr - lookupFreq) < Math.abs(prev - lookupFreq) ? curr : prev);
              console.warn(`[NetworkActivation] Using fallback CPPN at ${closest}`);
              oneFrequencyCPPNMember = member.CPPNs[closest];
            }
          }

          memberCPPN = this.getCPPNFromMember( oneFrequencyCPPNMember );

          // we have CPPNs with only one output in this case
          // TODO: no, let's for now have each per-frequency-CPPN still have 18 outputs (when coupled with a DSP; not CPPN-only)
          // outputIndexs.push( 0 );
        } // otherwise we have one CPPN for all frequencies

        // collect output indexes associated with the input periods value being activated for
        // _outputsToActivate.forEach( oneOutput => {
        for( let oneOutput of _outputsToActivate ) {
          const memberOutputsKey = getMemberOutputsKey( oneOutput );
          const outputFreq = memberOutputs.get(memberOutputsKey).frequency;
          // Match against the actual frequency in memberOutputs (which may be modified by noteDelta)
          if( frequency == outputFreq ) {
            outputIndexs.push( parseInt(oneOutput.index) ); // when patch comes in from asNEAT, the index is a string
          }
        } //);
          
        // console.log("---frequency:",frequency);
        const inputPeriods = frequency * (_totalSampleCount / this.sampleRate);
        // let outputSignals;
        console.log(`🔧 Rendering ${_sampleCountToActivate} samples at ${frequency}Hz, useGPU=${useGPU}, this.useGPU=${this.useGPU}`);
        if( useGPU ) {

          if( member.oneCPPNPerFrequency ) {
            const pureCPPNFunctions = memberCPPN.createPureCPPNFunctions();
            nodeOrder = pureCPPNFunctions.nodeOrder;
            stringFunctions = pureCPPNFunctions.stringFunctions;
          }

          outputSignalsPromises.push(
            this.renderOutputSignalsWithGPU(
              nodeOrder,
              stringFunctions,
              3, // totalIn - TODO: infer from CPPN somehow?
              outputIndexs,
              _totalSampleCount,
              _sampleCountToActivate,
              sampleOffset,
              inputPeriods,
              variationOnPeriods,
              velocity
            ).then( async outputSignals => {
              // outputIndexs.forEach( async outputIndex => {
              for( let outputIndex of outputIndexs ) {
                const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
                if( reverse ) outputSignals[outputIndex].reverse();
                let _samples;
                if( antiAliasing ) {
                  _samples = await this.downsampleAndFilterOversampledSignal(
                    outputSignals[outputIndex], _totalSampleCount, totalSampleCount
                  );
                } else {
                  _samples = outputSignals[outputIndex];
                }
                memberOutputs.get( memberOutputsKey ).samples = _samples;
              }
              // );
            }).catch(e => {
              console.error("Error in renderOutputSignalsWithGPU", e);
              // reload in hopse that the GPU rendering error will be resolved by that
              // location.reload();
            })
          );

        } else {

          const inputSignals = this.getInputSignals(
            _totalSampleCount, _sampleCountToActivate, sampleOffset,
            inputPeriods, variationOnPeriods,
            velocity
          );
          let outputSignals = this.getOutputSignals(
            inputSignals, outputIndexs, memberCPPN );

          // outputIndexs.forEach( async outputIndex => {
          for( let outputIndex of outputIndexs ) {
            const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
            if( reverse ) outputSignals[outputIndex].reverse();
            let _samples;
            if( antiAliasing ) {
              _samples = await this.downsampleAndFilterOversampledSignal(
                outputSignals[outputIndex], 
                _sampleCountToActivate, // _totalSampleCount, 
                sampleCountToActivate || totalSampleCount
              );
            } else {
              _samples = outputSignals[outputIndex];
            }   
            memberOutputs.get( memberOutputsKey ).samples = _samples;
          } //);
        }

        // const startApplyMemberOutputs = performance.now();
        // outputIndexs.forEach( outputIndex => {
        //   const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
        //   memberOutputs.get( memberOutputsKey ).samples = outputSignals[outputIndex];
        // });
        // const endApplyMemberOutputs = performance.now();
        // console.log(`%c Applying member outputs for one input period took ${endApplyMemberOutputs - startApplyMemberOutputs} milliseconds`,'color:orange');

      }
      //.bind(this));

      const networkActivationEnd = performance.now();
      if(ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") {
        console.log(`%c Activating network,
        for ${uniqueFrequencies.size} unique periods
        and ${sampleCountToActivate} samples,
        took ${networkActivationEnd - networkActivationStart}  milliseconds.`,'color:darkorange');
      }

      if( outputSignalsPromises.length ) {
        Promise.all( outputSignalsPromises ).then( () => {
          try {
            if( memberOutputs.size ) {
              const result = new Map(memberOutputs);
              memberOutputs.clear();
              resolve( result );
            } else {
              reject( "No member outputs activated" );
            }
          } finally {
            memberOutputs = null;
          }
        });
      } else {
        try {
          const result = new Map(memberOutputs);
          memberOutputs.clear();
          resolve( result );
        } finally {
          memberOutputs = null;
        }
      }
    });
  }

  // async downsampleAndFilterOversampledSignal(input, inputSampleRate, outputSampleRate) {
  //   // Calculate the length of the output signal
  //   const outputLength = Math.floor(input.length * outputSampleRate / inputSampleRate);
    
  //   // Create an offline context for the oversampled rate
  //   const offlineCtxOversampled = new OfflineAudioContext(1, input.length, inputSampleRate);
    
  //   // Create a buffer source for the oversampled context
  //   let inputBuffer = offlineCtxOversampled.createBuffer(1, input.length, inputSampleRate);
  //   inputBuffer.copyToChannel(input, 0);
    
  //   // Create the anti-aliasing filter (lowpass filter at Nyquist frequency)
  //   const nyquistFrequency = outputSampleRate / 2;
  //   const filter = offlineCtxOversampled.createBiquadFilter();
  //   filter.type = 'lowpass';
  //   filter.frequency.value = nyquistFrequency;
    
  //   // Connect filter
  //   const source = offlineCtxOversampled.createBufferSource();
  //   source.buffer = inputBuffer;
  //   source.connect(filter).connect(offlineCtxOversampled.destination);
  //   source.start(0);
  
  //   // Render the buffer
  //   const renderedBuffer = await offlineCtxOversampled.startRendering();
    
  //   // Create an offline context for the downsampled rate
  //   const offlineCtxDownsampled = new OfflineAudioContext(1, outputLength, outputSampleRate);
  
  //   // Create a buffer source for the downsampled context
  //   let outputBuffer = offlineCtxDownsampled.createBuffer(1, outputLength, outputSampleRate);
  //   outputBuffer.copyToChannel(renderedBuffer.getChannelData(0), 0);
    
  //   const outputSource = offlineCtxDownsampled.createBufferSource();
  //   outputSource.buffer = outputBuffer;
  //   outputSource.connect(offlineCtxDownsampled.destination);
  //   outputSource.start(0);
  
  //   // Render and return anti-aliased buffer
  //   const downsampledRenderedBuffer = await offlineCtxDownsampled.startRendering();
    
  //   // Get Float32Array from the anti-aliased and downsampled buffer
  //   const downsampledData = downsampledRenderedBuffer.getChannelData(0);
    
  //   return downsampledData;
  // }

  async downsampleAndFilterOversampledSignal(input, totalSampleCount, targetSampleCount) {
    const baseSampleRate = this.sampleRate;
    const inputSampleRate = baseSampleRate * (totalSampleCount / targetSampleCount);
    const outputSampleRate = baseSampleRate;
  
    // Calculate the length of the output signal
    const outputLength = targetSampleCount;
    
    // Create an offline context for the oversampled rate
    const offlineCtxOversampled = new OfflineAudioContext(1, input.length, inputSampleRate);
    
    // Create a buffer source for the oversampled context
    let inputBuffer = offlineCtxOversampled.createBuffer(1, input.length, inputSampleRate);
    inputBuffer.copyToChannel(input, 0);
    
    // Create the anti-aliasing filter (lowpass filter at Nyquist frequency)
    const nyquistFrequency = outputSampleRate / 2;
    const filter = offlineCtxOversampled.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = nyquistFrequency;
    
    // Connect filter
    const source = offlineCtxOversampled.createBufferSource();
    source.buffer = inputBuffer;
    source.connect(filter).connect(offlineCtxOversampled.destination);
    source.start(0);
  
    // Render the buffer
    const renderedBuffer = await offlineCtxOversampled.startRendering();
    
    // Create an offline context for the downsampled rate
    const offlineCtxDownsampled = new OfflineAudioContext(1, outputLength, outputSampleRate);
  
    // Create a buffer source for the downsampled context
    let outputBuffer = offlineCtxDownsampled.createBuffer(1, outputLength, outputSampleRate);
    outputBuffer.copyToChannel(renderedBuffer.getChannelData(0), 0);
    
    const outputSource = offlineCtxDownsampled.createBufferSource();
    outputSource.buffer = outputBuffer;
    outputSource.connect(offlineCtxDownsampled.destination);
    outputSource.start(0);
  
    // Render and return anti-aliased buffer
    const downsampledRenderedBuffer = await offlineCtxDownsampled.startRendering();
    
    // Get Float32Array from the anti-aliased and downsampled buffer
    return downsampledRenderedBuffer.getChannelData(0);
  }

  /////////// GPU - begin

  // getGPU() {
  //   if( !gpu ) {
  //     gpu = new GPU();
  //     addInputFunctionsToGPU( gpu );
  //   }
  //   return gpu;
  // }

  renderOutputSignalsWithGPU(
    nodeOrder, stringFunctions, totalIn, outputIndexes,
    totalSampleCount, sampleCountToActivate, sampleOffset,
    inputPeriods, variationOnPeriods,
    velocity = 1
  ) {
    // console.log("---renderOutputSignalsWithGPU outputIndexes:",outputIndexes,
    // ", sampleCount:", sampleCount, ", inputPeriods:",inputPeriods,
    // ", variationOnPeriods:",variationOnPeriods);

    // console.log("---nodeOrder:",nodeOrder);
    // console.log("---stringFunctions:",stringFunctions);

    const outputNodes = {};
    const requiredNodesForOutputNode = {};
    // outputIndexes.forEach( oneOutputIndex => {
    for( let oneOutputIndex of outputIndexes ) {
      const fIx = totalIn + oneOutputIndex;
      if( stringFunctions[fIx] ) {

        requiredNodesForOutputNode[fIx] = this.getRequiredNodes( fIx, stringFunctions );

        outputNodes[fIx] = this.renameNodeOutputsInStringFunc( stringFunctions[fIx] );
      } else {
        // Fix: Handle missing string functions for complex networks
        console.warn(`Missing string function for output index ${oneOutputIndex} (fIx: ${fIx})`);
        outputNodes[fIx] = 'return 0.0;'; // Provide safe default
        requiredNodesForOutputNode[fIx] = []; // Empty dependencies
      }
    } //);
    // console.log("---outputNodes:",outputNodes);
    // console.log("---requiredNodesForOutputNode:", requiredNodesForOutputNode);
    const requiredNodeIndexes = [
      ...new Set(this.concat(...Object.values(requiredNodesForOutputNode)))
    ].reduce( (map, val) => { map[val] = true; return map; }, {} );
    // console.log("---requiredNodeIndexes:",requiredNodeIndexes);

    const requiredNodes = {};
    let filteredRequiredNodeIndexes = Object.keys(requiredNodeIndexes).filter( i => i >= totalIn );
    // Object.keys(requiredNodeIndexes)
    // .filter( i => i >= totalIn ).forEach( oneRequiredNodeIndex => {
    for( let oneRequiredNodeIndex of filteredRequiredNodeIndexes ) {
      requiredNodes[oneRequiredNodeIndex] = this.renameNodeOutputsInStringFunc(
        stringFunctions[oneRequiredNodeIndex] ) ;
    } //);


    let isOffscreenCanvasAvailable = false;
    // let isOffscreenCanvasAvailable;
    // var canvasTest = document.createElement('canvas');
    // if( typeof canvasTest.transferControlToOffscreen === "function" ) {
    //   console.log("---OffscreenCanvas IS available");
    //   isOffscreenCanvasAvailable = true;
    // } else {
    //   console.log("---OffscreenCanvas is NOT available");
    //   isOffscreenCanvasAvailable = false;
    //   // TODO: if FireFox version 46 or above, show note on how to enable it
    //   // with the gfx.offscreencanvas.enabled preference
    //   // https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/OffscreenCanvas
    // }

    const outputSignals = {};
    const activationPromises = [];

    let networkActivationWorkerMessages = [];
    let deferreds = [];

    let updatedOutputIndexes = outputIndexes.map( i => i + totalIn );
    // outputIndexes.map( i => i + totalIn ).forEach( oneOutputIndex => {
    for( let oneOutputIndex of updatedOutputIndexes ) {
      const allRequiredNodeIndexes = [
        ...requiredNodesForOutputNode[oneOutputIndex], `${oneOutputIndex}`
      ].reduce( (map, val) => { map[val] = true; return map; }, {} );
      const activationStringForOneOutput = this.getRequiredAndOutputNodeStrings(
        nodeOrder, allRequiredNodeIndexes, requiredNodes, outputNodes
      );

      if( isOffscreenCanvasAvailable ) {

        networkActivationWorkerMessages.push({
            activationStringForOneOutput,
            totalSampleCount,
            sampleCountToActivate,
            sampleOffset,
            inputPeriods,
            variationOnPeriods,
            velocity
        });
        const oneActivationPromise = new Promise( (resolve, reject) =>
          deferreds.push({resolve, reject}) );

        activationPromises.push( oneActivationPromise );
      } else {
        //TODO: look into combining kernels: https://github.com/gpujs/gpu.js/#combining-kernels
        //    ...or https://github.com/gpujs/gpu.js/#create-kernel-map
        const settings = {
          name: 'cppnNetworkActivation',
          constants: {
            totalSampleCount,
            sampleCountToActivate: sampleCountToActivate || totalSampleCount,
            sampleOffset: sampleOffset || 0,
            inputPeriods,
            variationOnPeriods: variationOnPeriods ? 1 : 0,
            velocity
          },
          output: [sampleCountToActivate || totalSampleCount]
        };

        const gpu = this.getGPU();
        // addInputFunctionsToGPU( gpu ); // Already added in getGPU

        // const oneOutputKernel = this.getGPU().createKernel(
        //   new Function(activationStringForOneOutput), settings );
        const oneOutputKernel = gpu.createKernel(
          new Function(activationStringForOneOutput), settings
        );

        // promise api - is it really returning a promise?:  https://github.com/gpujs/gpu.js/blob/develop/test/src/features/promise-api.js
        activationPromises.push(
          new Promise( (resolve, reject) => {
            try {
              // console.log("---oneOutputKernel:",oneOutputKernel);
              let outputResult = oneOutputKernel();
              if(oneOutputKernel.kernel && oneOutputKernel.kernel.texture) oneOutputKernel.kernel.texture.delete();
              resolve( outputResult );
            } catch (e) {
              reject( e );
            }
          })
        );
      }

    } //);
/*
    if( networkActivationWorkerMessages.length ) {
      // call function to create a NetworkActivationGPUWorker,
      // post message to it and when it completes, the onmessage handler
      // will recursively call that function for the next element in the array
      callNetworkActivationGPUWorkers(0);
    }

    function callNetworkActivationGPUWorkers(i) {
      // TODO: step size?
      const networkActivationGPUWorker = new NetworkActivationGPUWorker();
      networkActivationGPUWorker.postMessage(networkActivationWorkerMessages[i]);
      networkActivationGPUWorker.onmessage = (e) => {
        console.log("---got message from networkActivationGPUWorker");
        deferreds[i].resolve(e.data.outputResult);
        if( i < networkActivationWorkerMessages.length-1 ) {
          // compute the next network output
          callNetworkActivationGPUWorkers(++i);
        }
      };
    }
*/
    return Promise.all( activationPromises ).then( outputResults => {
      for (const [resultIndex, oneOutputResult] of outputResults.entries()) { // https://flaviocopes.com/how-to-get-index-in-for-of-loop/
        // console.log("---oneOutputResult:",oneOutputResult);
        if( oneOutputResult === undefined ) {
          throw 'Output signal missing (probably due to GPU error)';
        } else {
          outputSignals[outputIndexes[resultIndex]] = oneOutputResult;
        }
      }
      return outputSignals;
    });

    // return outputSignals;
  }


  getRequiredNodes( fIx, stringFunctions ) {
    const requiredNodes = [];
    const reg = /this\.rf\[(.+?)\]/g;
    let requiredNodesFound;
    let functionIndexesToExamine = [fIx];
    do {
      requiredNodesFound = false;
      let nextFunctionIndexesToExamine = [];
      functionIndexesToExamine.forEach( oneIdx => {
        let result;
        while( (result = reg.exec(stringFunctions[oneIdx])) !== null ) {
          requiredNodes.push( result[1] );
          nextFunctionIndexesToExamine.push(result[1]);
          requiredNodesFound = true;
        }
      });
      functionIndexesToExamine = nextFunctionIndexesToExamine;
    } while( requiredNodesFound );
    const uniqueRequiredNodes = [...new Set(requiredNodes)];
    return uniqueRequiredNodes;
  }

  renameNodeOutputsInStringFunc( strFnc ) {
    // Fix: Add null/undefined check to prevent "Cannot read properties of undefined" error
    if (!strFnc || typeof strFnc !== 'string') {
      console.warn('renameNodeOutputsInStringFunc received invalid input:', strFnc);
      return 'return 0.0;'; // Return a safe default function
    }
    
    return strFnc
      .replace(new RegExp("this\\.rf\\[(.+?)\\]", "g"), "node$1")
      .replace( /Math\.PI/g, "3.141592653589793" );
  }

  getInputNodeStrings() {
    const inputNodeString = `
      const node0 = getBias();
      
      const sampleNumber = this.thread.x + this.constants.sampleOffset;
      const rangeFraction = sampleNumber / (this.constants.totalSampleCount-1);
      const node2 = -1 + rangeFraction * 2;
      
      let extraInput = 0.0;
      if( this.constants.variationOnPeriods === 1 ) {
        extraInput = Math.sin( this.constants.inputPeriods * node2 );
      } else {
        extraInput = Math.sin( this.constants.inputPeriods * Math.abs(node2) );
      }
      const node1 = extraInput * this.constants.velocity;
    `;
    return inputNodeString;
  }

  getRequiredAndOutputNodeStrings(
    nodeOrder, allRequiredNodeIndexes, requiredNodes, outputNodes
  ) {
    let requiredNodeStrings = this.getInputNodeStrings();
    const declaredNodes = new Set([0, 1, 2]); // Track declared nodes (input nodes already declared in getInputNodeStrings)
    
    nodeOrder.forEach( oneNodeIndex => {
      if( allRequiredNodeIndexes[oneNodeIndex] && !declaredNodes.has(oneNodeIndex) ) {
        const requiredNodeString = requiredNodes[oneNodeIndex];
        const outputNodeString = outputNodes[oneNodeIndex];
        
        // Prioritize output nodes over required nodes if both exist
        if( outputNodeString ) {
          requiredNodeStrings = requiredNodeStrings.concat(
            outputNodeString.replace( /^return/, `
              const node${oneNodeIndex} =` )
          ).concat(`
            return node${oneNodeIndex};
          `);
          declaredNodes.add(oneNodeIndex);
        } else if( requiredNodeString ) {
          requiredNodeStrings = requiredNodeStrings.concat(
            requiredNodeString.replace( /^return/, `
              const node${oneNodeIndex} =` )
          );
          declaredNodes.add(oneNodeIndex);
        }
      }
    });
    return requiredNodeStrings;
  }

  getKernelMap( // TODO: unused?
    requiredNodes, outputNodes, requiredNodesForRequiredNode, requiredNodesForOutputNode
  ) {
    const kernelMap = {
      fResult0: function getBias() {
        return 1.0;
      },
      fResult1: function getInputSignalMain() {
        const sampleNumber = this.thread.x;
        const totalSampleCount = this.constants.totalSampleCount;
        const rangeFraction = sampleNumber / (totalSampleCount-1);
        return -1 + rangeFraction * 2; // lerp( -1, 1, rangeFraction );
      },
      fResult2: function getInputSignalExtra( mainInputSignal ) {
        let extraInput = 0.0;
        if( this.constants.variationOnPeriods === 1 ) {
          extraInput = Math.sin( this.constants.inputPeriods * mainInputSignal );
        } else {
          extraInput = Math.sin( this.constants.inputPeriods * Math.abs(mainInputSignal) );
        }
        return extraInput;
      }
    };

    for( let nodeIndex in outputNodes ) {
      const oneOutputNodeFunc = new Function(
        ...[
          ...requiredNodesForOutputNode[nodeIndex].map( n => `node${n}`),
          outputNodes[nodeIndex]
        ]
      );
      Object.defineProperty(oneOutputNodeFunc, "name", { value: `f${nodeIndex}` });
      kernelMap[`fResult${nodeIndex}`] = oneOutputNodeFunc;
    }

    for( let nodeIndex in requiredNodes ) {
      const oneRequiredNodeFunc = new Function( requiredNodes[nodeIndex] );
      Object.defineProperty(oneRequiredNodeFunc, "name", { value: `f${nodeIndex}` });
      kernelMap[`fResult${nodeIndex}`] = oneRequiredNodeFunc;
    }

    return kernelMap;
  }


  getKernelFunction( nodeOrder, totalIn,
    requiredNodesForRequiredNode, requiredNodesForOutputNode
  ) {
    let kernelFuncString = `
      const node0 = getBias();
      const node1 = getInputSignalMain();
      const node2 = getInputSignalExtra( node1 );
    `;
    nodeOrder.filter( i => i >= totalIn ).forEach( oneNodeIndex => {
      if( requiredNodesForRequiredNode[oneNodeIndex] ) {
        kernelFuncString = kernelFuncString.concat(
          this.getNodeFuncCallString( oneNodeIndex, requiredNodesForRequiredNode )
        );
      }
      if( requiredNodesForOutputNode[oneNodeIndex] ) {
        kernelFuncString = kernelFuncString.concat(
          this.getNodeFuncCallString( oneNodeIndex, requiredNodesForOutputNode )
        );
      }
    });
    kernelFuncString = kernelFuncString.concat("return 1;");
    console.log("---kernelFuncString:",kernelFuncString);
    return new Function( kernelFuncString );
  }

  getNodeFuncCallString( nodeIndex, nodeFuncParamIndexes ) {
    return `const node${nodeIndex} = f${nodeIndex}(
      ${nodeFuncParamIndexes[nodeIndex].map( n => `node${n}` ).join()}
    );
    `
  }

  getCombinedKernelFunction( allRequiredNodeIndexes,
    requiredNodesForRequiredNode, requiredNodesForOutputNode
  ) {
    let kernelFuncString = `
      const nodeResult0 = f0();
      const nodeResult1 = f1();
      const nodeResult2 = f2();
    `;
    allRequiredNodeIndexes.forEach( oneNodeIndex => {
      if( requiredNodesForRequiredNode[oneNodeIndex] ) {
        kernelFuncString = kernelFuncString.concat(
          this.getKernelArgumentCallString( oneNodeIndex, requiredNodesForRequiredNode )
        );
      }
      if( requiredNodesForOutputNode[oneNodeIndex] ) {
        kernelFuncString = kernelFuncString.concat(
          this.getKernelArgumentCallString( oneNodeIndex, requiredNodesForOutputNode )
        );
      }
    });
    kernelFuncString = kernelFuncString.concat(
      `return nodeResult${allRequiredNodeIndexes[allRequiredNodeIndexes.length-1]};`);
    console.log("---kernelFuncString:",kernelFuncString);
    return new Function( kernelFuncString );
    // return kernelFuncString;
  }

  getKernelArgumentCallString( nodeIndex, nodeFuncParamIndexes ) {
    return `const nodeResult${nodeIndex} = f${nodeIndex}(
      ${nodeFuncParamIndexes[nodeIndex].map( n => `nodeResult${n}` ).join()}
    );
    `
  }

  // getBias() {
  //   return 1.0;
  // }
  // getInputSignalMain( sampleNumber, totalSampleCount ) {
  //   const rangeFraction = sampleNumber / (totalSampleCount-1);
  //   return -1 + rangeFraction * ( 1 - (-1) ); // lerp( -1, 1, rangeFraction );
  // }
  // getInputSignalExtra( mainInputSignal, inputPeriods, variationOnPeriods ) {
  //   if( variationOnPeriods === 1 ) {
  //     var extraInput = Math.sin( inputPeriods * mainInputSignal );
  //   } else {
  //     var extraInput = Math.sin( inputPeriods * Math.abs(mainInputSignal) );
  //   }
  // }

  concat(...args) { // https://gist.github.com/yesvods/51af798dd1e7058625f4#gistcomment-2129224
    return args.reduce((acc, val) => [...acc, ...val]);
  }

  /////////// GPU - end


  getOutputsToActivateFromPatch( patch ) {
    return patch.networkOutputs
    .filter( oneOutputConfig => {
      // make sure "network output" is not a noise type, but rather an index to a CPPN output
      const networkOutputIsANumber = !isNaN(oneOutputConfig.networkOutput);
      return networkOutputIsANumber;
    } )
    .map( oneOutputConfig => {
      return {
        index: oneOutputConfig.networkOutput,
        frequency: oneOutputConfig.frequency,
        // Include originalFrequency for CPPN lookup with noteDelta
        originalFrequency: oneOutputConfig.originalFrequency,
        // frequencyUpdated: oneOutputConfig.frequencyUpdated,
      };
    });
  }
}

export default Activator;
