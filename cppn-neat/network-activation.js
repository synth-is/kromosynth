import neatjs from 'neatjs';
import cppnjs from 'cppnjs';
import { setActivationFunctions } from './activation-functions.js';
import { getMemberOutputsKey } from '../util/network-output.js';
import { addInputFunctionsToGPU } from '../util/gpu-functions.js';
import { lerp } from '../util/range.js';
import { randomFromInterval, halfChance } from '../util/random.js';
import {GPU} from 'gpu.js';

const ENVIRONMENT_IS_NODE = typeof process==="object"&&typeof process.versions==="object"&&typeof process.versions.node==="string";

// import NetworkActivationGPUWorker from "../workers/network-activation-gpu-worker.js?worker";

/**
 * Activates outputs of the provided network
 */

// let gpu;

class Activator {

  constructor( sampleRate ) {

    this.sampleRate = sampleRate;

    setActivationFunctions( cppnjs );
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
    console.log(`%c InputSignalsCalculation took ${endInputSignalsCalculation - startInputSignalsCalculation} milliseconds for inputPeriods: ${inputPeriods}`,'color:orange');
    return inputSignals;
  }

  getOutputSignals( inputSignals, outputIndexes, memberCPPN ) {
    const startOutputSignalsCalculation = performance.now();

    const outputSignals = {};
    outputIndexes.forEach( outputIndex => {
      // typed array for samples; results in faster transfers via message passing from worker
      outputSignals[outputIndex] = new Float32Array( inputSignals.length );
    });

    let recursiveActivationTime = 0;
    inputSignals.forEach( (signalSet, sampleIndex) => {
      memberCPPN.clearSignals();
      memberCPPN.setInputSignals( signalSet );
      const startRecursiveActivation = performance.now();
      memberCPPN.recursiveActivation();
      const endRecursiveActivation = performance.now();
      recursiveActivationTime += endRecursiveActivation - startRecursiveActivation;

      outputIndexes.forEach( outputIndex => {
        outputSignals[outputIndex][sampleIndex] = memberCPPN.getOutputSignal(outputIndex);
      });
    });
    const endOutputSignalsCalculation = performance.now();
    const outputSignalsCalculationTime = endOutputSignalsCalculation - startOutputSignalsCalculation
    console.log(`%c OutputSignalsCalculation took
      ${outputSignalsCalculationTime} milliseconds,
      of which recursive activation took ${recursiveActivationTime},
      ${(recursiveActivationTime/outputSignalsCalculationTime)*100}%`,
      'color:orange');
    return outputSignals;
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
  ) {
    if( ! sampleCountToActivate ) {
      // ^ optional constructor parameter,
      // to only create input signals to activate a subset
      // of the desired total sampleCount,
      // useful for multicore computation on multiple sub-web workers.
      sampleCountToActivate = totalSampleCount;
    }
    if( ! sampleOffset ) sampleOffset = 0;

    return new Promise( (resolve, reject) => {

      let memberCPPN;
      if( member.offspring.networkDecode ) {
        memberCPPN = member.offspring.networkDecode();
      } else {
        // we didn't receive member as a neatjs/cppnjs instance,
        // but rather an object representation of it,
        // so we'll use the data from that object to create a new instance:
        memberCPPN = new neatjs.neatGenome(`${Math.random()}`,
        member.offspring.nodes,
        member.offspring.connections,
        member.offspring.inputNodeCount,
        member.offspring.outputNodeCount ).networkDecode();
      }

      const memberOutputs = new Map();

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

      _outputsToActivate.forEach( function(oneOutput) {
        const memberOutputsKey = getMemberOutputsKey( oneOutput );
        memberOutputs.set( memberOutputsKey, {
          samples: undefined,
          frequency: oneOutput.frequency
        });

        // if( oneOutput.frequencyUpdated ) {
        //   frequenciesUpdated[oneOutput.frequency] = true;
        // }
      }.bind(this));

      // let's only activate the network once per unique input periods value / sample
      let uniqueFrequencies = new Set( _outputsToActivate.map( o => {
          const memberOutputsKey = getMemberOutputsKey( o );
          return memberOutputs.get(memberOutputsKey).frequency;
        })
      );

      let nodeOrder, stringFunctions;
      if( useGPU ) {
        const pureCPPNFunctions = memberCPPN.createPureCPPNFunctions();
        nodeOrder = pureCPPNFunctions.nodeOrder;
        stringFunctions = pureCPPNFunctions.stringFunctions;
      }

      const outputSignalsPromises = [];
      const networkActivationStart = performance.now();
      uniqueFrequencies.forEach(function( frequency ) {

//         if( frequenciesUpdated[frequency] ) {
// console.log("--setting velocity to 1");
//           velocity = 1
//         } else {
// console.log("--did not set velocity to 1", velocity);
//         }

          // collect output indexes associated with the input periods value being activated for
          const outputIndexs = [];
          _outputsToActivate.forEach( oneOutput => {
            const memberOutputsKey = getMemberOutputsKey( oneOutput );
            if( frequency == memberOutputs.get(memberOutputsKey).frequency ) {
              outputIndexs.push( parseInt(oneOutput.index) ); // when patch comes in from asNEAT, the index is a string
            }
          });

          // console.log("---frequency:",frequency);
          const inputPeriods = frequency * (totalSampleCount / this.sampleRate);
          // let outputSignals;
          if( useGPU ) {

            // outputSignals = this.renderOutputSignalsWithGPU(
            //   nodeOrder,
            //   stringFunctions,
            //   3, // totalIn - TODO: infer from CPPN somehow?
            //   outputIndexs,
            //   totalSampleCount,
            //   inputPeriods,
            //   variationOnPeriods
            // );
            outputSignalsPromises.push(
              this.renderOutputSignalsWithGPU(
                nodeOrder,
                stringFunctions,
                3, // totalIn - TODO: infer from CPPN somehow?
                outputIndexs,
                totalSampleCount,
                inputPeriods,
                variationOnPeriods,
                velocity
              ).then( outputSignals => {
                outputIndexs.forEach( outputIndex => {
                  const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
                  if( reverse ) outputSignals[outputIndex].reverse();
                  memberOutputs.get( memberOutputsKey ).samples = outputSignals[outputIndex];
                });
              }).catch(e => {
                console.error("Error in renderOutputSignalsWithGPU", e);
                // reload in hopse that the GPU rendering error will be resolved by that
                // location.reload();
              })
            );

          } else {

            const inputSignals = this.getInputSignals(
              totalSampleCount, sampleCountToActivate, sampleOffset,
              inputPeriods, variationOnPeriods,
              velocity
            );
            let outputSignals = this.getOutputSignals(
              inputSignals, outputIndexs, memberCPPN );

            outputIndexs.forEach( outputIndex => {
              const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
              if( reverse ) outputSignals[outputIndex].reverse();
              memberOutputs.get( memberOutputsKey ).samples = outputSignals[outputIndex];
            });
          }

          // const startApplyMemberOutputs = performance.now();
          // outputIndexs.forEach( outputIndex => {
          //   const memberOutputsKey = getMemberOutputsKey( {index: outputIndex, frequency} );
          //   memberOutputs.get( memberOutputsKey ).samples = outputSignals[outputIndex];
          // });
          // const endApplyMemberOutputs = performance.now();
          // console.log(`%c Applying member outputs for one input period took ${endApplyMemberOutputs - startApplyMemberOutputs} milliseconds`,'color:orange');

      }.bind(this));

      const networkActivationEnd = performance.now();
      if(ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") {
        console.log(`%c Activating network,
        for ${uniqueFrequencies.size} unique periods
        and ${sampleCountToActivate} samples,
        took ${networkActivationEnd - networkActivationStart}  milliseconds.`,'color:darkorange');
      }

      if( outputSignalsPromises.length ) {
        Promise.all( outputSignalsPromises ).then( () => {
          if( memberOutputs.size ) {
            resolve( memberOutputs );
          } else {
            reject( "No member outputs activated" );
          }
        });
      } else {
        resolve( memberOutputs );
      }
    });
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
    sampleCount, inputPeriods, variationOnPeriods,
    velocity = 1
  ) {
    // console.log("---renderOutputSignalsWithGPU outputIndexes:",outputIndexes,
    // ", sampleCount:", sampleCount, ", inputPeriods:",inputPeriods,
    // ", variationOnPeriods:",variationOnPeriods);

    // console.log("---nodeOrder:",nodeOrder);
    // console.log("---stringFunctions:",stringFunctions);

    const outputNodes = {};
    const requiredNodesForOutputNode = {};
    outputIndexes.forEach( oneOutputIndex => {
      const fIx = totalIn + oneOutputIndex;
      if( stringFunctions[fIx] ) {

        requiredNodesForOutputNode[fIx] = this.getRequiredNodes( fIx, stringFunctions );

        outputNodes[fIx] = this.renameNodeOutputsInStringFunc( stringFunctions[fIx] );
      }
    });
    // console.log("---outputNodes:",outputNodes);
    // console.log("---requiredNodesForOutputNode:", requiredNodesForOutputNode);
    const requiredNodeIndexes = [
      ...new Set(this.concat(...Object.values(requiredNodesForOutputNode)))
    ].reduce( (map, val) => { map[val] = true; return map; }, {} );
    // console.log("---requiredNodeIndexes:",requiredNodeIndexes);

    const requiredNodes = {};
    Object.keys(requiredNodeIndexes)
    .filter( i => i >= totalIn ).forEach( oneRequiredNodeIndex => {
      requiredNodes[oneRequiredNodeIndex] = this.renameNodeOutputsInStringFunc(
        stringFunctions[oneRequiredNodeIndex] ) ;
    });


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

    outputIndexes.map( i => i + totalIn ).forEach( oneOutputIndex => {
      const allRequiredNodeIndexes = [
        ...requiredNodesForOutputNode[oneOutputIndex], `${oneOutputIndex}`
      ].reduce( (map, val) => { map[val] = true; return map; }, {} );
      const activationStringForOneOutput = this.getRequiredAndOutputNodeStrings(
        nodeOrder, allRequiredNodeIndexes, requiredNodes, outputNodes
      );

      if( isOffscreenCanvasAvailable ) {

        networkActivationWorkerMessages.push({
            activationStringForOneOutput,
            sampleCount,
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
            totalSampleCount: sampleCount,
            inputPeriods: inputPeriods,
            variationOnPeriods: variationOnPeriods ? 1 : 0,
            velocity
          },
          output: [sampleCount]
        };

        const gpu = new GPU();
        addInputFunctionsToGPU( gpu );

        // const oneOutputKernel = this.getGPU().createKernel(
        //   new Function(activationStringForOneOutput), settings );
        const oneOutputKernel = gpu.createKernel(
          new Function(activationStringForOneOutput), settings
        );

        // promise api - is it really returning a promise?:  https://github.com/gpujs/gpu.js/blob/develop/test/src/features/promise-api.js
        activationPromises.push(
          new Promise( (resolve, reject) => {
            try {
              let outputResult = oneOutputKernel();
              resolve( outputResult );
            } catch (e) {
              reject( e );
            }
          })
        );
      }

    });
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

    return strFnc
      .replace(new RegExp("this\\.rf\\[(.+?)\\]", "g"), "node$1")
      .replace( /Math\.PI/g, "3.141592653589793" );
  }

  getInputNodeStrings() {
/*
    const inputNodeString = `
    const node0 = 1.0;

    const sampleNumber = this.thread.x;
    const totalSampleCount = this.constants.totalSampleCount;
    const rangeFraction = sampleNumber / (totalSampleCount-1);
    const node1 = -1 + rangeFraction * 2; // this.lerp( -1, 1, rangeFraction );

    let extraInput = 0.0;
    if( this.constants.variationOnPeriods === 1 ) {
      extraInput = Math.sin( this.constants.inputPeriods * node1 );
    } else {
      extraInput = Math.sin( this.constants.inputPeriods * Math.abs(node1) );
    }
    const node2 = extraInput;
    `;
*/
    const inputNodeString = `
      const node0 = getBias();
      const node2 = getInputSignalMain();
      const node1 = getInputSignalExtra( node2 );
    `;
    return inputNodeString;
  }

  getRequiredAndOutputNodeStrings(
    nodeOrder, allRequiredNodeIndexes, requiredNodes, outputNodes
  ) {
    let requiredNodeStrings = this.getInputNodeStrings();
    nodeOrder.forEach( oneNodeIndex => {
      if( allRequiredNodeIndexes[oneNodeIndex] ) {
        const requiredNodeString = requiredNodes[oneNodeIndex];
        if( requiredNodeString ) {
          requiredNodeStrings = requiredNodeStrings.concat(
            requiredNodeString.replace( /^return/, `
              const node${oneNodeIndex} =` )
          );
        }
        const outputNodeString = outputNodes[oneNodeIndex];
        if( outputNodeString ) {
          requiredNodeStrings = requiredNodeStrings.concat(
            outputNodeString.replace( /^return/, `
              const node${oneNodeIndex} =` )
          ).concat(`
            return node${oneNodeIndex};
          `)
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
        // frequencyUpdated: oneOutputConfig.frequencyUpdated,
      };
    });
  }
}

export default Activator;
