import { isAudible, remapNumberToRange, numWorkers } from '../util/range.js';
import { concatenateTypedArrays } from '../util/arrays.js';
import { getMemberOutputsKey } from '../util/network-output.js';
import { getFrequencyToNoteDelta } from '../wavekilde.js';
// import { lerp } from '../util/range';
import { getAudioBuffer, normalizeAudioBuffer } from '../util/audio-buffer.js';
import { createVirtualAudioGraphWithCompiler } from '../util/audio-graph-compiler.js';
import clone from 'clone';  // TODO: replace with import cloneDeep from "lodash/cloneDeep"; ?
import chroma from 'chroma-js';
import isString from "lodash-es/isString.js";
import { spawn, Thread, Worker, Transfer } from "threads";
// imports for when not using workers - see this.useWorkers
import {gainValuesPerAudioWave} from "../workers/gain-values-per-audio-wave-worker.js";
import {remapControlArrayToValueCurveRange} from '../workers/remap-control-array-to-value-curve-range-worker.js';

const ENVIRONMENT_IS_NODE = typeof process==="object"&&typeof process.versions==="object"&&typeof process.versions.node==="string";

/**
 * Renders audio buffers from CPPN network output samples
 * by wiring an audio graph from a provided patch definition.
 */
class Renderer {

  constructor( sampleRate ) {
    this.sampleRate = sampleRate;
    this.useWorkers = false; //TODO: ensure workers work (!) smoothly with node and browser
  }

  wireUpAudioGraphAndConnectToAudioContextDestination(
      memberOutputs, patch, noteDelta,
      audioContextInstance,
      sampleCount,
      wrapperNodes = null,
      mode = 'batch',
      captureNode = null  // Optional: AudioWorklet node for incremental capture
  ) {

    return new Promise( (resolve, reject) => {

      if( ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") console.log('Wiring up audio graph...');
      const startWiringAudioGraph = performance.now();

      // getSubtractiveSynthesisExampleGraph();

      // getWawetableSynthesisExampleGraph();

      // If captureNode provided, use it as output and connect to destination
      // Otherwise connect directly to destination (batch mode)
      const outputNode = captureNode || audioContextInstance.destination;
      if (captureNode) {
        captureNode.connect(audioContextInstance.destination);
      }

      const virtualAudioGraph = createVirtualAudioGraphWithCompiler({
        audioContext: audioContextInstance,
        output: outputNode,
      });

      // this.updateWithTestFMAudioGraph(
      //   virtualAudioGraph, memberOutputs, offlineCtx, sampleCount, patch.duration );


      // let's clone the patch,
      // to not clutter the saved patch definition with value curve sample data
      const _patch = clone(patch);

      this.getNodeGraphFromPatch(
        _patch,
        memberOutputs,
        sampleCount, patch.duration,
        virtualAudioGraph,
        audioContextInstance,
        noteDelta,
        wrapperNodes,
        mode
      ).then( graphDefinition => {

        try {
          virtualAudioGraph.update( graphDefinition );

          // In streaming mode, connect wrapper nodes to AudioParams
          if (mode === 'streaming' && wrapperNodes) {
            this.connectWrapperNodesToGraph(
              _patch, wrapperNodes, virtualAudioGraph, audioContextInstance
            );
          }

          resolve( virtualAudioGraph )
        }
        catch (e) {
          console.error("Error creating virtual audio graph", e);
          reject("Error creating virtual audio graph:", e);
        }

        const endWiringAudioGraph = performance.now();
        if( ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") console.log(`Done wiring up audio graph in ${endWiringAudioGraph-startWiringAudioGraph} ms, will now render.`);
      });

    });
  }



  renderNetworksOutputSamplesAsAudioBuffer(
      memberOutputs, patch, noteDelta, spectrogramDimensions,
      getDataArray,
      offlineAudioContext,
      audioContext,
      captureNode = null  // Optional: AudioWorklet node for incremental capture
  ) {
    return new Promise( (resolve, reject) => {

      // TODO: move in hardcoded rendering from IndividualContainer

      const startAudioCtxInstance = performance.now();
      let offlineAudioContextInstance;
      if ( offlineAudioContext ) {
        offlineAudioContextInstance = offlineAudioContext;
      } else {
        offlineAudioContextInstance = new (OfflineAudioContext || webkitOfflineAudioContext)( 1 /*channels*/,
        this.sampleRate * patch.duration, this.sampleRate);
      }
      let audioContextInstance;
      if( audioContext ) {
        audioContextInstance = audioContext;
      } else {
        audioContextInstance = new AudioContext();
      }
      const endAudioCtxInstance = performance.now();
      if( ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") console.log(`%c instantiating audio context took ${endAudioCtxInstance-startAudioCtxInstance} milliseconds`,'color:darkorange');

      const sampleCount = Math.round(this.sampleRate * patch.duration);

      this.wireUpAudioGraphAndConnectToAudioContextDestination(
          memberOutputs, patch, noteDelta,
          offlineAudioContextInstance,
          sampleCount,
          null,  // wrapperNodes
          'batch',  // mode
          captureNode  // Pass captureNode through
      ).then( virtualAudioGraph => {

        /////////// spectrogram
        // migrate to AudioWorklet node?
        // https://www.warpdesign.fr/webaudio-from-scriptprocessornode-to-the-new-audioworklet-api/
        // as ScriptProcessorNode is deprecated:
        // https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode
        // https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode
        let freqDataArrays;
        if( // TODO after upgrading node-web-audio-api, AudioDestinationNode is not defined, so we'll disable this for now; it was specific to the web IEC presentation
          false
          // spectrogramDimensions && virtualAudioGraph.audioContext.createScriptProcessor && typeof virtualAudioGraph.audioContext.createScriptProcessor === 'function' 
        ) {

          // https://gist.github.com/moust/95f5cd5daa095f1aad89
          // https://stackoverflow.com/a/46069463/169858
          const scp = virtualAudioGraph.audioContext.createScriptProcessor(2048, 1, 1);
          scp.connect(virtualAudioGraph.audioContext.destination);

          const analyser = virtualAudioGraph.audioContext.createAnalyser();
          analyser.smoothingTimeConstant = 0;
          analyser.fftSize = 1024;
          analyser.connect(scp);

          for( const audioNodeKey in virtualAudioGraph.virtualNodes ) {
            if(
              virtualAudioGraph.virtualNodes[audioNodeKey].connections
              &&
              virtualAudioGraph.virtualNodes[audioNodeKey].connections
              .filter( conn => conn instanceof AudioDestinationNode )
              .length > 0
            ) {
              virtualAudioGraph.virtualNodes[audioNodeKey].audioNode.connect(analyser);
            }
          }

          freqDataArrays = [];

          scp.onaudioprocess = () => {
            const freqData = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(freqData);
            // this.drawSpectrogram(freqData, getColor, canvas, canvasCtx, tempCanvas, tempCanvasCtx);
            freqDataArrays.push( freqData );
          };

        } else {
          freqDataArrays = null;
        }
        /////////// spectrogram - end

        const startRenderAudioGraph = performance.now();

        // Offline rendering of the audio graph to a reusable buffer
        // TODO: assuming virtualAudioGraph.audioContext is offline - verify?
        if (captureNode) console.log('  ⏱️ Calling startRendering()...');
        virtualAudioGraph.audioContext.startRendering().then(function( renderedBuffer ) {
          const endRenderAudioGraph = performance.now();
          if( ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") console.log(`%c Rendering audio graph took ${endRenderAudioGraph - startRenderAudioGraph} milliseconds`, 'color:darkorange');

          const networkIndividualSound = normalizeAudioBuffer( renderedBuffer, sampleCount, audioContextInstance, getDataArray );

          let canvas, canvasCtx, tempCanvas, tempCanvasCtx;
          if( freqDataArrays && spectrogramDimensions ) {
            canvas = document.createElement('canvas');
            canvasCtx = canvas.getContext('2d');
            tempCanvas = document.createElement('canvas');
            tempCanvasCtx = tempCanvas.getContext('2d');

            const { width, height } = spectrogramDimensions;

            canvas.width = width;
            tempCanvas.width = width;
            canvas.height = height;
            tempCanvas.height = height;

            const getColor = chroma.scale(
              ['white','#676768']
              // ['yellow', '008ae5']
              // ['#000000', '#ff0000', '#ffff00', '#ffffff'], [0, .25, .75, 1]
              // ['#b5cc18', '#f2711c']
            ).domain([0, 300]);

            freqDataArrays.forEach( freqData => {
              this.drawSpectrogram(freqData, freqDataArrays.length, getColor, canvas, canvasCtx, tempCanvas, tempCanvasCtx);
            })
          } else {
            canvas = null;
          }

          //resolve( networkIndividualSound );

          if (canvas) {
            canvas.toBlob(canvasBlob => {
              resolve({
                audioBuffer: networkIndividualSound,
                canvasDataURL: canvas.toDataURL(),
                canvasBlob
              });
            });
          } else {
            resolve({
              audioBuffer: networkIndividualSound,
              canvasDataURL: null,
              canvasBlob: null
            });
            offlineAudioContextInstance = null;
          }

        }.bind(this)).catch(function( err ) {
          console.log('Rendering failed: ' + err);

          reject( "Not able to render audio buffer from member outputs with provided audio graph patch: "
            + err );
          offlineAudioContextInstance = null;
        });

      }).catch( // this.wireUpAudioGraphAndConnectToAudioContextDestination(
        e => reject( "Error from wireUpAudioGraphAndConnectToAudioContextDestination:" + e )
      );

      // TODO: ...then, dynamic rendering pipeline according to patch
    });
  }


  drawSpectrogram (freqData, numSegments, getColor, canvas, canvasCtx, tempCanvas, tempCanvasCtx) {
      // copy the current canvas onto the temp canvas
      tempCanvasCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);

      const segmentWidth = canvas.width / numSegments;
      for(var i = 0; i < freqData.length; i++) {
        canvasCtx.fillStyle = getColor(freqData[i]).hex();
        canvasCtx.fillRect(canvas.width - segmentWidth, canvas.height - i, segmentWidth, segmentWidth);
      }

      // set translate on the canvas
      canvasCtx.translate(-segmentWidth, 0);
      // draw the copied image
      canvasCtx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

      // reset the transformation matrix
      canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Connect wrapper gain nodes to virtual-audio-graph AudioParams in streaming mode
   *
   * @param {Object} patch - Audio patch with networkOutputs definitions
   * @param {Map<number, GainNode>} wrapperNodes - Map of outputIndex → wrapper GainNode
   * @param {Object} virtualAudioGraph - Virtual audio graph instance
   * @param {AudioContext} audioContext - Audio context
   */
  connectWrapperNodesToGraph(patch, wrapperNodes, virtualAudioGraph, audioContext) {
    if (ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") {
      console.log('Connecting wrapper nodes to audio graph...');
    }

    let connectionsCount = 0;

    patch.networkOutputs.forEach((oneOutput, outputIndex) => {
      // Get the wrapper node for this CPPN output
      const wrapperNode = wrapperNodes.get(oneOutput.networkOutput);

      if (!wrapperNode) {
        console.warn(`No wrapper node found for output ${oneOutput.networkOutput}`);
        return;
      }

      // Connect this wrapper node to all its target audio graph nodes
      for (const audioGraphNodeKey in oneOutput.audioGraphNodes) {
        const connections = oneOutput.audioGraphNodes[audioGraphNodeKey];

        // Get the virtual node from the graph
        const virtualNode = virtualAudioGraph.virtualNodes[audioGraphNodeKey];

        if (!virtualNode || !virtualNode.audioNode) {
          console.warn(`Virtual node ${audioGraphNodeKey} not found in graph`);
          continue;
        }

        const audioNode = virtualNode.audioNode;

        connections.forEach((connection) => {
          const paramName = connection.paramName;

          // Skip buffer and curve parameters (handled differently)
          if (paramName === 'buffer' || paramName === 'curve' ||
              paramName === 'partialBuffer' || paramName === 'partialGainEnvelope') {
            console.warn(`Streaming mode does not yet support ${paramName} parameters`);
            return;
          }

          // Connect wrapper node to AudioParam
          if (audioNode[paramName] && audioNode[paramName].constructor.name === 'AudioParam') {
            wrapperNode.connect(audioNode[paramName]);
            connectionsCount++;

            if (ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") {
              console.log(`  Connected wrapper ${oneOutput.networkOutput} → ${audioGraphNodeKey}.${paramName}`);
            }
          } else {
            console.warn(`AudioParam ${paramName} not found on node ${audioGraphNodeKey}`);
          }
        });
      }
    });

    if (ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") {
      console.log(`✅ Connected ${connectionsCount} wrapper nodes to audio graph parameters`);
    }
  }


  async getNodeGraphFromPatch(
    patch, memberOutputs, sampleCount, duration, virtualAudioGraph, audioContext, noteDelta,
    wrapperNodes = null, mode = 'batch' ) {

    const graph = patch.audioGraph;
    const graphNodeKeysToValueCurves = this.getValueCurvesFromPatch(
      patch, memberOutputs, sampleCount, audioContext, wrapperNodes, mode );

    const {currentTime} = virtualAudioGraph;

    // In streaming mode, add wrapper nodes to the graph first so they can be referenced
    if (mode === 'streaming' && wrapperNodes) {
      console.log(`Adding ${wrapperNodes.size} wrapper nodes to graph for referencing`);
      for (const [outputIndex, gainNode] of wrapperNodes.entries()) {
        // Add wrapper node as a virtual node that wraps the real AudioNode
        const wrapperKey = `cppn_output_${outputIndex}`;
        // Use 'gain' node type with the actual GainNode
        graph[wrapperKey] = ['gain', [], {gain: 1.0}];
        // We'll manually connect the actual gainNode after graph creation
      }
    }

    // const wavetableGraphNodeEntryPromises = [];
    for( const oneAudioGraphNodeKey in graph ) {
      const valueCurves = graphNodeKeysToValueCurves.get( oneAudioGraphNodeKey );
      const nodeType = graph[oneAudioGraphNodeKey][0];
      const outputKeys = graph[oneAudioGraphNodeKey][1];

      // Handle wavetable and additive nodes (work differently in streaming vs batch mode)
      if( 'wavetable' === nodeType ) {

          if (mode === 'streaming' && wrapperNodes) {
            // Streaming mode: use wrapper nodes
            console.log(`🎹 Creating wavetable node in STREAMING mode: ${oneAudioGraphNodeKey}`);
            const wavetableGraphNode = await this.getWavetableGraphNodeEntryStreaming(
              oneAudioGraphNodeKey, outputKeys, patch, wrapperNodes, currentTime, duration
            );
            if (wavetableGraphNode) {
              console.log(`  ✓ Wavetable node created successfully`);
              graph[oneAudioGraphNodeKey] = wavetableGraphNode;
            } else {
              console.log(`  ✗ Wavetable node creation failed - deleting from graph`);
              delete graph[oneAudioGraphNodeKey];
            }
          } else{
            // Batch mode: use pre-rendered buffers
            if (!valueCurves) {
              console.log(`  ⚠️  No value curves for wavetable ${oneAudioGraphNodeKey} - skipping`);
              delete graph[oneAudioGraphNodeKey];
            } else {
              const mixWaveSamples = this.getWavetableMixWaveFromPatch(valueCurves);
              const audioWavesSamples = this.getWavetableAudioWavesFromPatch(valueCurves);

              const wavetableGraphNode = await this.getWavetableGraphNodeEntry(
                oneAudioGraphNodeKey, outputKeys, mixWaveSamples, audioWavesSamples,
                currentTime, duration
              );
              if (wavetableGraphNode) {
                graph[oneAudioGraphNodeKey] = wavetableGraphNode;
              } else {
                delete graph[oneAudioGraphNodeKey];
              }
            }
          }
        } else if( 'additive' === nodeType ) {

          if (mode === 'streaming' && wrapperNodes) {
            // Streaming mode: use wrapper nodes
            console.log(`🎼 Creating additive node in STREAMING mode: ${oneAudioGraphNodeKey}`);
            const additiveGraphNode = await this.getAdditiveSynthesisGraphNodeEntryStreaming(
              outputKeys, patch, oneAudioGraphNodeKey, wrapperNodes, currentTime, duration
            );
            if (additiveGraphNode) {
              console.log(`  ✓ Additive node created successfully`);
              graph[oneAudioGraphNodeKey] = additiveGraphNode;
            } else {
              console.log(`  ✗ Additive node creation failed - deleting from graph`);
              delete graph[oneAudioGraphNodeKey];
            }
          } else {
            // Batch mode: use pre-rendered buffers
            if (!valueCurves) {
              console.log(`  ⚠️  No value curves for additive ${oneAudioGraphNodeKey} - skipping`);
              delete graph[oneAudioGraphNodeKey];
            } else {
              const partialBuffers = this.getAdditiveSynthesisPartialBuffersFromPatch(valueCurves);
              const gainEnvelopes = this.getAdditiveSynthesisPartialGainEnvelopeValueCurvesFromPatch(valueCurves);
              const partailGainWeights = this.getPartialGainWeightsFromPatch(patch, oneAudioGraphNodeKey);

              const additiveGrahpNode = await this.getAdditiveSynthesisGraphNodeEntry(
                outputKeys, partialBuffers, gainEnvelopes, partailGainWeights, currentTime, duration
              );

              if (additiveGrahpNode) {
                graph[oneAudioGraphNodeKey] = additiveGrahpNode;
              } else {
                delete graph[oneAudioGraphNodeKey];
              }
            }
          }

      } else if (valueCurves) {
        // Standard nodes with value curves (batch mode) or AudioParam connections (streaming mode)
        if( ! graph[oneAudioGraphNodeKey][2] ) {
          graph[oneAudioGraphNodeKey][2] = {}; // https://github.com/benji6/virtual-audio-graph/#updating-the-audio-graph
        }
        valueCurves.forEach( (values, paramName) => {
          const _paramName = paramName.split('_')[2];
          if( 'buffer' === _paramName || 'curve' === _paramName ) {
            graph[oneAudioGraphNodeKey][2][_paramName] = values;
          } else {
            graph[oneAudioGraphNodeKey][2][_paramName] =
              ['setValueCurveAtTime', values, currentTime, duration];
          }
        });
      }

      if( 'feedbackDelay' === nodeType ) {
        const feedbackDelayNodeEntry = [
          this.getFeedbackGainNodeFunction(),
          outputKeys,
          graph[oneAudioGraphNodeKey][2]
        ];
        graph[oneAudioGraphNodeKey] = feedbackDelayNodeEntry;
      }

      // if oscillator, not connected to audio node param, take noteDelta into account
      // - noteDeltas (noteOffsets) for CPPN network outputs are otherwise handled in the 'rendering' action component
      if( 'oscillator' === nodeType ) {
        let isAnyConnectionToAudioNodeParam = false;
        let isAnyConnectionToAudioNode = false;
        // const oneAudioGraphNodeKeyForFreqUpdates = `${oneAudioGraphNodeKey}_freqUpdates`;  // may not be used, if no freq updates
        if( Array.isArray(outputKeys) ) {
          for( let oneConnection of outputKeys ) {
            if( typeof oneConnection === 'object' ) {
              isAnyConnectionToAudioNodeParam = true;
              // break;
            } else if( oneConnection.split('-').length === 3 ) {
              // there is a connection to an audio node like:
              // OCjFdS-frequency-weight
              // which in turn is connected to an audio node parameter
              isAnyConnectionToAudioNodeParam = true;
              // break;
            } else if(
              (oneConnection.split('-').length === 2 || 'output' === oneConnection)
              /*
              &&
              ! Array.isArray(graph[oneAudioGraphNodeKey][2]['frequency']) // then it is setValueCurveAtTime
              */
            ) {
              isAnyConnectionToAudioNode = true;
              // attempt to split the ocillator into two nodes,
              // one pointing to audio params and the other to audio nodes proper
              // but that doesn't take into account what subsequent nodes may point to,
              // e.g. osc -> feedbackDelay -> gain
              /*
              if( !graph[oneAudioGraphNodeKeyForFreqUpdates] ) {
                graph[oneAudioGraphNodeKeyForFreqUpdates] = clone(graph[oneAudioGraphNodeKey]);
                graph[oneAudioGraphNodeKeyForFreqUpdates][1] = [];  // reset the outputKeys
              }
              graph[oneAudioGraphNodeKeyForFreqUpdates][1].push( oneConnection );
              // remove the connection from the corresponding (original) oscillator node:
              graph[oneAudioGraphNodeKey][1].splice( graph[oneAudioGraphNodeKey][1].indexOf(oneConnection), 1 );
              */
            }
          }
        } else if( typeof outputKeys === 'object' ) {
          isAnyConnectionToAudioNodeParam = true;
        }
        // if ! isAnyConnectionToAudioNodeParam && isAnyConnectionToAudioNode
        if(
            // ! isAnyConnectionToAudioNodeParam
            isAnyConnectionToAudioNode
        ) {
          // so this oscillator is only a source of audio signal, let's take noteDelta into account
          if( ! graph[oneAudioGraphNodeKey][2] ) graph[oneAudioGraphNodeKey][2] = {};
          if( ! graph[oneAudioGraphNodeKey][2]['frequency'] ) graph[oneAudioGraphNodeKey][2]['frequency'] = 440;
          if( ! Array.isArray(graph[oneAudioGraphNodeKey][2]['frequency']) ) {
            const oscillatorNoteOffset = getFrequencyToNoteDelta(
              graph[oneAudioGraphNodeKey][2]['frequency'], noteDelta
            );
            graph[oneAudioGraphNodeKey][2]['frequency'] = oscillatorNoteOffset;
          } // otherwise it's value curve definition in an array
        }
      }

    }
    let removeEdgeClicks = true; // TODO
    // Skip edge click removal in streaming mode (uses setTargetAtTime which requires fixed duration)
    if( removeEdgeClicks && mode !== 'streaming' ) {
      const edgeTimeConstant = 0.015;
      if( graph[0] ) {
        graph[0][1] = 'clickRemoval';
      } else if( graph['0-'] ) { // this patch came in from asNEAT, where 0 is reserved for the OutNode
        graph['0-'][1] = 'clickRemoval';
      } else { // TODO: 2021-11-24 what was that again?
        for( const audioNodeKey in graph ) {
          if( ! graph[audioNodeKey] ) {
            console.log("graph[audioNodeKey]", audioNodeKey, graph);
          }
          graph[audioNodeKey][1].map( conn =>
            conn === 'output' ? 'clickRemoval' : conn
          );
        }
      }

      graph['clickRemoval'] = ['gain', 'output', {
        gain:
        [
          ['setValueAtTime', 0, currentTime],
          ['setTargetAtTime', 1, currentTime, edgeTimeConstant],
          ['setTargetAtTime', 0, currentTime+duration-edgeTimeConstant*2, edgeTimeConstant],
        ]
      }];

      // https://devdocs.io/dom/dynamicscompressornode
      // https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode
      // https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createDynamicsCompressor
      // https://mdn.github.io/webaudio-examples/compressor-example/ ... https://mdn.github.io/webaudio-examples/compressor-example
      // via https://stackoverflow.com/q/51252732/169858
      // TODO: doesn't seem to help with values out of range - which don't translate well to wav files
      // graph['compressor'] = ['dynamicsCompressor', 'output', {
      //     attack: 0,
      //     knee: 40,
      //     ratio: 12,
      //     // reduction: 0,
      //     release: 0.25,
      //     threshold: -50
      // }];
    }
    return graph;
  }

  getValueCurvesFromPatch( patch, memberOutputs, sampleCount, audioContext,
                           wrapperNodes = null, mode = 'batch' ) {
    const graphNodeKeysToValueCurves = new Map();

    // In streaming mode, skip value curve creation (connections handled separately)
    if (mode === 'streaming' && wrapperNodes) {
      return graphNodeKeysToValueCurves; // Return empty map
    }

    patch.networkOutputs.forEach( (oneOutput, outputIndex) => {

      let samples;
      if( isString(oneOutput.networkOutput) && oneOutput.networkOutput.startsWith("noise") ) { // see ../as-neat/nodes/networkOutputNode.js
        samples = this.getNoiseSamples( oneOutput.networkOutput, sampleCount );
      } else {
        const memberOutputsKey = getMemberOutputsKey(
          {index: oneOutput.networkOutput, frequency: oneOutput.frequency} );
        if( memberOutputs && memberOutputs.get(memberOutputsKey) ) {
          samples = memberOutputs.get(memberOutputsKey).samples;
        }
      }
      if( samples ) {
        for( const oneAudioGraphNodeKey in oneOutput.audioGraphNodes ) {
          const paramNameToValueCurve = new Map();
          oneOutput.audioGraphNodes[oneAudioGraphNodeKey]
          .forEach( (oneAudioGraphNodeConn, connectionIndex) => {
            let valueCurve;
            if( oneAudioGraphNodeConn.range ) {
              // TODO: worker... get(Gain)ControlArrayRemappedToValueCurveRange
              valueCurve = samples.map( oneSample => {
                return remapNumberToRange( oneSample, -1, 1,
                  oneAudioGraphNodeConn.range[0], oneAudioGraphNodeConn.range[1] );
              });
            } else {
              valueCurve = samples;
            }
            if( 'buffer' === oneAudioGraphNodeConn.paramName ) {
              const audioBuffer = getAudioBuffer(
                [valueCurve], audioContext, sampleCount );
              paramNameToValueCurve.set(
                `${outputIndex}_${connectionIndex}_${oneAudioGraphNodeConn.paramName}`, audioBuffer );
            } else if( 'partialBuffer' === oneAudioGraphNodeConn.paramName ) {
              const audioBuffer = getAudioBuffer(
                [valueCurve], audioContext, sampleCount );
              paramNameToValueCurve.set(
                `partialNumber_${oneAudioGraphNodeConn.partialNumber}_${oneAudioGraphNodeConn.paramName}`, audioBuffer );
            } else if( 'partialGainEnvelope' === oneAudioGraphNodeConn.paramName ) {
              paramNameToValueCurve.set(
                `partialNumber_${oneAudioGraphNodeConn.partialNumber}_${oneAudioGraphNodeConn.paramName}`, valueCurve
              );
            } else {
              paramNameToValueCurve.set(
                `${outputIndex}_${connectionIndex}_${oneAudioGraphNodeConn.paramName}`, valueCurve
              );
            }
          });
          const existingGraphNodeKeyToValueCurvesMap =
            graphNodeKeysToValueCurves.get(oneAudioGraphNodeKey);
          if( existingGraphNodeKeyToValueCurvesMap ) {
            graphNodeKeysToValueCurves.set(
              oneAudioGraphNodeKey,
              new Map([
                ...existingGraphNodeKeyToValueCurvesMap,
                ...paramNameToValueCurve
              ])
            );
          } else {
            graphNodeKeysToValueCurves.set(
              oneAudioGraphNodeKey, paramNameToValueCurve );
          }
        }
      }
    });
    return graphNodeKeysToValueCurves;
  }

  getPartialGainWeightsFromPatch( patch, audioGraphNodeKey ) {
    // similar round as in getValueCurvesFromPatch, but combining this collection in the loop there would increase the mess, probably with little gain...
    const partialGainWeights = [];
    patch.networkOutputs.forEach( (oneOutput, outputIndex) => {
      for( const oneAudioGraphNodeKey in oneOutput.audioGraphNodes ) {
        if( audioGraphNodeKey === oneAudioGraphNodeKey ) {
          oneOutput.audioGraphNodes[audioGraphNodeKey]
          .forEach( (oneAudioGraphNodeConn, connectionIndex) => {
            if( oneAudioGraphNodeConn.paramName === 'partialGainEnvelope' ) {
              partialGainWeights.push( oneAudioGraphNodeConn.weight );
            }
          });
        }
      }
    });
    return partialGainWeights;
  }

  getNoiseSamples( noiseType, sampleCount ) {
    // noise generation based on https://github.com/zacharydenton/noise.js
    switch (noiseType) {
      case "noisePink":
        return this.getPinkNoiseSamples( sampleCount );
      case "noiseBrown":
        return this.getWBrownNoiseSamples( sampleCount );
      default:
        return this.getWhiteNoiseSamples( sampleCount );
    }
  }

  getWhiteNoiseSamples( sampleCount ) {
    const samples = new Float32Array( sampleCount );
    for( let i = 0; i < sampleCount; i++ ) {
      samples[i] = Math.random() * 2 - 1;
    }
    return samples;
  }

  getPinkNoiseSamples( sampleCount ) {
    const samples = new Float32Array( sampleCount );
    let b0, b1, b2, b3, b4, b5, b6;
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
    for( let i = 0; i < sampleCount; i++ ) {
      let white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      samples[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      samples[i] *= 0.11; // (roughly) compensate for gain
      b6 = white * 0.115926;
    }
    return samples;
  }

  getWBrownNoiseSamples( sampleCount ) {
    const samples = new Float32Array( sampleCount );
    let lastOut = 0.0;
    for( let i = 0; i < sampleCount; i++ ) {
      let white = Math.random() * 2 - 1;
      samples[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = samples[i];
      samples[i] *= 3.5; // (roughly) compensate for gain
    }
    return samples;
  }

  updateWithTestFMAudioGraph(
    virtualAudioGraph, memberOutputs, audioContext, sampleCount, duration ) {

    const testAudioBuffer = getAudioBuffer(
      [memberOutputs.get(5).samples], audioContext, sampleCount );
    const testDetuneValues = memberOutputs.get(0).samples.map( oneSample => {
      return remapNumberToRange(oneSample, -1, 1, -1000, 1000);
    });

    const {currentTime} = virtualAudioGraph

    const graph = {
      0: ['gain', 'output', {gain: .8}],
      1: ['bufferSource', 0, {
        buffer: testAudioBuffer,
        detune: ['setValueCurveAtTime', testDetuneValues, currentTime, duration]
      }]
    }

    virtualAudioGraph.update(graph);
  }

  getSubtractiveSynthesisExampleGraph() {

    /*
          // Stereo
          let channels = 2;



          let myArrayBuffer = offlineCtx.createBuffer(
            channels, this.state.frameCount, offlineCtx.sampleRate );

          // Fill the buffer with signals according to the network outputs
          for( let channel=0; channel < channels; channel++ ) {

            // This gives us the actual ArrayBuffer that contains the data
            let nowBuffering = myArrayBuffer.getChannelData( channel );
            let networkOutputBuffer = this.ensureBufferStartsAndEndsAtZero(
              this.state.memberOutputs[channel].samples );
            for( let i=0; i < this.state.frameCount; i++ ) {
              nowBuffering[i] = networkOutputBuffer[i];
            }
          }

          // Get an AudioBufferSourceNode.
          // This is the AudioNode to use when we want to play an AudioBuffer
          let source = offlineCtx.createBufferSource();
          // set the buffer in the AudioBufferSourceNode
          source.buffer = myArrayBuffer;
    */


    /*    AM, FM, subtractive synthesis, distortion - TODO: to be assignable to waves in UI

      // create a "Voltage Controlled" Amplifier
      let VCA = offlineCtx.createGain();
      // set the amplifier's initial gain value
      VCA.gain.value = .5;

      let biquadFilter = offlineCtx.createBiquadFilter();
      biquadFilter.type = 'lowpass'; // moar types at https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode
      biquadFilter.frequency.value = 1000;

      let distortion = offlineCtx.createWaveShaper();

      source.connect( distortion );
      distortion.connect( biquadFilter );
      biquadFilter.connect( VCA );
      // connect the Amplifier to the
      // destination so we can hear the sound
      VCA.connect(offlineCtx.destination);

      // TODO: use scheduling in the future, shared with the audio sources's .start(...) ?
      // start controlling the amplifier's gain:  AM
      VCA.gain.setValueCurveAtTime(
        new Float32Array( this.state.memberOutputs.get(2).samples.map(function(oneSample) {
          return remapNumberToRange(oneSample, -1, 1, 0, 1);
        }.bind(this)) ),
        offlineCtx.currentTime, this.state.duration
      );
      // use a control signal to mess with the detuning of the audio source:  FM
      source.detune.setValueCurveAtTime(
        new Float32Array( this.state.memberOutputs.get(3).samples.map(function(oneSample) {
          return remapNumberToRange(oneSample, -1, 1, -1000, 1000);
        }.bind(this)) ),
        offlineCtx.currentTime, this.state.duration*1.1
        // multiplier to have the k-rate (detune) param cover the entire playback duration
        // ...with limited understanding of how those k-rate params actually work:
        // https://developer.mozilla.org/en-US/docs/Web/API/AudioParam#k-rate
      );
      // assign a sample array from one neural network output to sweep the filter:  subtractive synthesis
      biquadFilter.frequency.setValueCurveAtTime(
        new Float32Array(this.state.memberOutputs.get(4).samples.map(function(oneSample) {
          return remapNumberToRange(oneSample, -1, 1, 0, 2000);
        }.bind(this)) ),
        offlineCtx.currentTime, this.state.duration
      ); // TODO: use network outputs to control filter's gain or Q ?
      // distortion
      distortion.curve = new Float32Array(this.state.memberOutputs.get(5).samples);


      // start the source playing
      source.start();
    */
  }


  ///// wavetable

  getWawetableSynthesisExampleGraph( memberOutputs, offlineCtx, sampleCount, patch ) {

    return new Promise( resolve => {

      const startWaveTypeCategorization = performance.now();

      ///// wave table (or vector) synthes:
      // get a control wave for the mix
      let waveTableMixWave = memberOutputs.get('0_950');
      // and the audio waves for the wave table, which the control wave will mix together
      let audioWaves = [];
      for( let [outputIndex, output] of memberOutputs ) {
        const _outputIndex = outputIndex.split('_')[0];
        if( isAudible(output.frequency) && 0 != _outputIndex ) {
          audioWaves.push( output );
        }
      }

      let audioSources = audioWaves.map( oneOutput => {
        return getAudioBufferSourceNode(
          [oneOutput.samples], offlineCtx, sampleCount );
      });

      const endWaveTypeCategorization = performance.now();
      console.log(`%c Wave type categorization took ${endWaveTypeCategorization - startWaveTypeCategorization} milliseconds`, 'color:darkorange');

      // gain values for each audio wave in the wave table,
      // each controlled by a value curve from the calculated gain values
      console.log('Calculating gain values...');
      const startCalculatingGainValues = performance.now();
      // let gainValues = this.getGainValuesPerAudioWave( audioWaves.length, waveTableMixWave.samples );
      this.spawnMultipleGainValuesPerAudioWaveWorkers(
        audioWaves.length, waveTableMixWave.samples
      ).then( gainValues => {

        const endCalculatingGainValues = performance.now();
        console.log(`%c Calculating gain values took ${endCalculatingGainValues - startCalculatingGainValues} milliseconds`, 'color:darkorange');

        const startApplyingGainValues = performance.now();

        this.getAudioSourceGains( gainValues, offlineCtx, patch.duration )
        .then( audioSourceGains => {

          const endApplyingGainValues = performance.now();
          console.log(`%c Applying gain values took ${endApplyingGainValues - startApplyingGainValues} milliseconds`, 'color:darkorange');
          console.log('Done calculating gain values.');

          const startConnectingAudioGraph = performance.now();

          // connect each audio source to a gain node,
          audioSources.forEach(
            (audioSource, index) => audioSource.connect( audioSourceGains[index] ) );

          // instantiate a merger; mixer
          let mergerNode = offlineCtx.createChannelMerger( audioSources.length );

          // connect the output of each audio source gain to the mixer
          audioSourceGains.forEach(
            (audioGain, index) => audioGain.connect( mergerNode, 0, index ) );

          // connect the mixer to the output device
          mergerNode.connect( offlineCtx.destination );

          const endConnectingAudioGraph = performance.now();
          console.log(`%c Connecting audio graph took ${endConnectingAudioGraph - startConnectingAudioGraph} milliseconds`, 'color:darkorange');

          // start all the audio sources
          let currentTime = offlineCtx.currentTime;
          audioSources.forEach( audioSource => audioSource.start(currentTime) );


          // return promise?
          resolve();


        }); // gain value curve remapping promise

      }).bind(this); // gain calculation promise

    });

  }


  getFeedbackGainNodeFunction() {
    const feedbackDelay = ({
      delayTime = 0,
      feedbackRatio = 0.2
    } = {}) => ({
      'feedbackGainNode': ['gain', 'passthroughGain', {gain: feedbackRatio}], // {gain: 0.90}
      // Increase maxDelayTime to support larger delays from genome (up to 5s)
      'delayNode': ['delay', 'feedbackGainNode', {delayTime, maxDelayTime: 5.0}], // {delayTime:0.1}
      'passthroughGain': ['gain', ['output', 'delayNode'], {gain: 1.0}, 'input']
    });
    return feedbackDelay;
  }


  ///// wavetable

  async getGainValueCurvesForWavetable( numberOfAudiowaves, mixWaveSamples ) {
    const gainValues = await this.spawnMultipleGainValuesPerAudioWaveWorkers(
      numberOfAudiowaves, mixWaveSamples
    );
    const gainValueCurves = new Array( gainValues.length );
    for (const [gainIndex, oneGainControlArray] of gainValues.entries() ) {
      gainValueCurves[gainIndex] = await
        this.getGainControlArrayRemappedToValueCurveRange(oneGainControlArray);
    }
    return gainValueCurves;
  }

  getWavetableAudioNodeFunction( numberOfAudiowaves ) {

    const functionParams = ['numberOfAudiowaves', 'currentTime', 'duration'];
    const wavetableNodeDefinition = [
      "zero: ['channelMerger', 'output', {numberOfInputs: numberOfAudiowaves}]"
    ];
    for( let i = 1; i <= numberOfAudiowaves; i++ ) {
      const oneGainValueCurveKey = `gainValueCurve${i}`;
      const oneAudioWaveKey = `audioWave${i}`;
      functionParams.push(oneGainValueCurveKey);
      functionParams.push(oneAudioWaveKey);

      wavetableNodeDefinition.push(
        `g${i}: ['gain', 'zero', {gain: ['setValueCurveAtTime', ${oneGainValueCurveKey}, currentTime, duration]}]`
      ); // TODO a CPPN worklet would connect to the gain parameter of this node
      wavetableNodeDefinition.push(
        `a${i}: ['bufferSource', 'g${i}', {buffer: ${oneAudioWaveKey}}]`
      ); // TODO this would be a CPPN worklet
    }

    const functionBody = `
      const { ${functionParams.join(',')} } = params;
      return { ${wavetableNodeDefinition.join(',')} };
    `;

    const wavetable = new Function( 'params', functionBody );

    // const wavetableStringified = wavetable.toString();

    return wavetable;
  }

  async getWavetableGraphNodeEntry(
    graphKey, outputKeys, mixWaveSamples, audioWavesSamples, currentTime, duration
  ) {
    if( mixWaveSamples && audioWavesSamples.length ) {
      let gainValueCurveArrays = await this.getGainValueCurvesForWavetable(
        audioWavesSamples.length, mixWaveSamples
      );
      const wavetable = this.getWavetableAudioNodeFunction( audioWavesSamples.length );
      const wavetableNodeFunctionParameters = {
        numberOfAudiowaves: audioWavesSamples.length,
        currentTime,
        duration
      };
      gainValueCurveArrays.forEach( (oneValueCurveArray, valueCurveIndex) => {
        wavetableNodeFunctionParameters[`gainValueCurve${valueCurveIndex+1}`] =
          oneValueCurveArray;
      });
      audioWavesSamples.forEach( (oneAudioWaveSamples, audioWaveIndex) => {
        wavetableNodeFunctionParameters[`audioWave${audioWaveIndex+1}`] =
          oneAudioWaveSamples;
      });
      const wavetableNodeEntry = [wavetable, outputKeys, wavetableNodeFunctionParameters];
      return wavetableNodeEntry;
    } else {
      return null;
    }
  }

  getWavetableMixWaveFromPatch( valueCurves ) {
    for( let [paramName, values] of valueCurves.entries() ) {
      const _paramName = paramName.split('_')[2];
      if( _paramName === 'mix' ) {
        return values;
      }
    }
  }

  getWavetableAudioWavesFromPatch( valueCurves ) {
    // see getValueCurvesFromPatch
    return this.getParameterValuesFromValueCurvesMap( 'buffer', valueCurves );
  }

  /**
   * Get wavetable graph node entry for streaming mode
   * Uses wrapper gain nodes instead of pre-rendered buffers
   */
  async getWavetableGraphNodeEntryStreaming(
    audioGraphNodeKey, outputKeys, patch, wrapperNodes, currentTime, duration
  ) {
    // Find all CPPN outputs that connect to this wavetable node with buffer parameter
    const audioWaveWrapperNodeKeys = [];
    let mixWaveWrapperNodeKey = null;

    patch.networkOutputs.forEach((oneOutput) => {
      const connections = oneOutput.audioGraphNodes[audioGraphNodeKey];
      if (!connections) return;

      connections.forEach((connection) => {
        if (connection.paramName === 'buffer') {
          // This is an audio wave for the wavetable
          const wrapperNode = wrapperNodes.get(oneOutput.networkOutput);
          if (wrapperNode) {
            audioWaveWrapperNodeKeys.push(`cppn_output_${oneOutput.networkOutput}`);
          } else {
            console.warn(`No wrapper node found for output ${oneOutput.networkOutput} (wavetable buffer)`);
          }
        } else if (connection.paramName === 'mix') {
          // This is the mix control wave
          const wrapperNode = wrapperNodes.get(oneOutput.networkOutput);
          if (wrapperNode) {
            mixWaveWrapperNodeKey = `cppn_output_${oneOutput.networkOutput}`;
          } else {
            console.warn(`No wrapper node found for output ${oneOutput.networkOutput} (wavetable mix)`);
          }
        }
      });
    });

    if (audioWaveWrapperNodeKeys.length === 0) {
      console.warn(`No audio wave wrapper nodes found for wavetable ${audioGraphNodeKey}`);
      return null;
    }

    // Create wavetable node function for streaming mode
    const wavetableStreaming = this.getWavetableAudioNodeFunctionStreaming(
      audioWaveWrapperNodeKeys.length
    );

    const wavetableNodeFunctionParameters = {
      numberOfAudiowaves: audioWaveWrapperNodeKeys.length,
      currentTime,
      duration
    };

    // Add wrapper node keys as parameters (they're already in the graph)
    audioWaveWrapperNodeKeys.forEach((key, index) => {
      wavetableNodeFunctionParameters[`audioWaveKey${index + 1}`] = key;
    });

    // Mix control is handled differently in streaming mode
    // For now, we'll use equal gain for all waves (TODO: implement mix control)
    // In streaming mode, use constant gain (no setValueCurveAtTime on real-time context)
    audioWaveWrapperNodeKeys.forEach((_, index) => {
      wavetableNodeFunctionParameters[`gainValue${index + 1}`] = 1.0 / audioWaveWrapperNodeKeys.length;
    });

    const wavetableNodeEntry = [wavetableStreaming, outputKeys, wavetableNodeFunctionParameters];
    return wavetableNodeEntry;
  }

  /**
   * Create wavetable audio node function for streaming mode
   * Uses wrapper GainNodes by referencing their keys in the graph
   */
  getWavetableAudioNodeFunctionStreaming(numberOfAudiowaves) {
    const functionParams = ['numberOfAudiowaves', 'currentTime', 'duration'];
    const wavetableNodeDefinition = [
      "zero: ['channelMerger', 'output', {numberOfInputs: numberOfAudiowaves}]"
    ];

    for (let i = 1; i <= numberOfAudiowaves; i++) {
      const oneGainValueKey = `gainValue${i}`;
      const oneAudioWaveKeyParam = `audioWaveKey${i}`;
      functionParams.push(oneGainValueKey);
      functionParams.push(oneAudioWaveKeyParam);

      // In streaming mode, use constant gain (no setValueCurveAtTime on real-time context)
      wavetableNodeDefinition.push(
        `g${i}: ['gain', 'zero', {gain: ${oneGainValueKey}}]`
      );
      // Connect from the wrapper node (by key) to the gain
      wavetableNodeDefinition.push(
        `c${i}: ['gain', 'g${i}', {gain: 1.0}, ${oneAudioWaveKeyParam}]`
      );
    }

    const functionBody = `
      const { ${functionParams.join(',')} } = params;
      return { ${wavetableNodeDefinition.join(',')} };
    `;

    return new Function('params', functionBody);
  }

  getAdditiveSynthesisPartialBuffersFromPatch( valueCurves ) {
    return this.getParameterValuesFromValueCurvesMap( 'partialBuffer', valueCurves );
  }

  getAdditiveSynthesisPartialGainEnvelopeValueCurvesFromPatch( valueCurves ) {
    return this.getParameterValuesFromValueCurvesMap( 'partialGainEnvelope', valueCurves );
  }

  /**
   * Get additive synthesis graph node entry for streaming mode
   * Uses wrapper gain nodes instead of pre-rendered buffers
   */
  async getAdditiveSynthesisGraphNodeEntryStreaming(
    outputKeys, patch, audioGraphNodeKey, wrapperNodes, currentTime, duration
  ) {
    // Find all CPPN outputs that connect to this additive node
    const partialWrapperNodeKeys = [];
    const gainEnvelopeWrapperNodeKeys = [];
    const partialGainWeights = [];

    patch.networkOutputs.forEach((oneOutput) => {
      const connections = oneOutput.audioGraphNodes[audioGraphNodeKey];
      if (!connections) return;

      connections.forEach((connection) => {
        if (connection.paramName === 'partialBuffer') {
          // This is a partial/harmonic audio wave
          const wrapperNode = wrapperNodes.get(oneOutput.networkOutput);
          if (wrapperNode) {
            partialWrapperNodeKeys.push(`cppn_output_${oneOutput.networkOutput}`);
          } else {
            console.warn(`No wrapper node found for output ${oneOutput.networkOutput} (partial buffer)`);
          }
        } else if (connection.paramName === 'partialGainEnvelope') {
          // This is a gain envelope for a partial
          const wrapperNode = wrapperNodes.get(oneOutput.networkOutput);
          if (wrapperNode) {
            gainEnvelopeWrapperNodeKeys.push(`cppn_output_${oneOutput.networkOutput}`);
          } else {
            console.warn(`No wrapper node found for output ${oneOutput.networkOutput} (gain envelope)`);
          }
          partialGainWeights.push(connection.weight || 1);
        }
      });
    });

    if (partialWrapperNodeKeys.length === 0) {
      console.warn(`No partial wrapper nodes found for additive node ${audioGraphNodeKey}`);
      return null;
    }

    // Create additive node function for streaming mode
    const additiveStreaming = this.getAdditiveSynthesisAudioNodeFunctionStreaming(
      partialWrapperNodeKeys.length
    );

    const additiveNodeFunctionParameters = {
      numberOfPartialBufferAndGainValuePairs: partialWrapperNodeKeys.length,
      currentTime,
      duration
    };

    // Add wrapper node keys as parameters (they're already in the graph)
    partialWrapperNodeKeys.forEach((key, index) => {
      additiveNodeFunctionParameters[`audioWaveKey${index + 1}`] = key;
    });

    // Add gain envelope wrapper node keys (or use constant gain if not present)
    const constantGainCurve = new Float32Array(48000).fill(1.0);
    gainEnvelopeWrapperNodeKeys.forEach((key, index) => {
      // TODO: For now, using constant gain - need to connect envelope wrapper nodes
      additiveNodeFunctionParameters[`gainValueCurve${index + 1}`] = constantGainCurve;
    });
    // Fill remaining with constant curves if fewer envelopes than partials
    for (let i = gainEnvelopeWrapperNodeKeys.length; i < partialWrapperNodeKeys.length; i++) {
      additiveNodeFunctionParameters[`gainValueCurve${index + 1}`] = constantGainCurve;
    }

    // Add gain weights
    partialGainWeights.forEach((weight, index) => {
      additiveNodeFunctionParameters[`gainWeight${index + 1}`] = weight;
    });
    // Fill remaining with weight 1 if needed
    for (let i = partialGainWeights.length; i < partialWrapperNodeKeys.length; i++) {
      additiveNodeFunctionParameters[`gainWeight${i + 1}`] = 1;
    }

    const additiveNodeEntry = [additiveStreaming, outputKeys, additiveNodeFunctionParameters];
    return additiveNodeEntry;
  }

  /**
   * Create additive synthesis audio node function for streaming mode
   * Uses wrapper GainNodes by referencing their keys in the graph
   */
  getAdditiveSynthesisAudioNodeFunctionStreaming(numberOfPartialBufferAndGainValuePairs) {
    const functionParams = ['numberOfPartialBufferAndGainValuePairs', 'currentTime', 'duration'];
    const additiveNodeDefinition = [
      "zero: ['channelMerger', 'output', {numberOfInputs: numberOfPartialBufferAndGainValuePairs}]"
    ];

    for (let i = 1; i <= numberOfPartialBufferAndGainValuePairs; i++) {
      const oneAudioWaveKeyParam = `audioWaveKey${i}`;
      const oneGainValueCurveKey = `gainValueCurve${i}`;
      const oneGainWeightKey = `gainWeight${i}`;
      functionParams.push(oneAudioWaveKeyParam);
      functionParams.push(oneGainValueCurveKey);
      functionParams.push(oneGainWeightKey);

      if (1 < i) {
        additiveNodeDefinition.push(
          `gainWeight${i}: ['gain', 'zero', {gain:${oneGainWeightKey}}]`
        );
      } else {
        // First partial always has full constant gain
        additiveNodeDefinition.push(
          `gainWeight${i}: ['gain', 'zero', {gain:1}]`
        );
      }
      // In streaming mode, use constant gain (envelope comes from CPPN)
      additiveNodeDefinition.push(
        `gainValueCurve${i}: ['gain', 'gainWeight${i}', {gain: 1.0}]`
      );
      // Connect from the wrapper node (by key) to the gain
      additiveNodeDefinition.push(
        `c${i}: ['gain', 'gainValueCurve${i}', {gain: 1.0}, ${oneAudioWaveKeyParam}]`
      );
    }

    const functionBody = `
      const { ${functionParams.join(',')} } = params;
      return { ${additiveNodeDefinition.join(',')} };
    `;

    return new Function('params', functionBody);
  }

  getParameterValuesFromValueCurvesMap( paramName, valueCurves ) {
    const paramValues = [];
    for( let [paramKey, values] of valueCurves.entries() ) {
      const paramKeyNamePart = paramKey.split('_')[2];
      if( paramKeyNamePart === paramName ) paramValues.push( values );
    }
    return paramValues;
  }


  ///// additive synthesis

  getAdditiveSynthesisAudioNodeFunction( numberOfPartialBufferAndGainValuePairs ) {
    const functionParams = ['numberOfPartialBufferAndGainValuePairs', 'currentTime', 'duration'];
    const additiveNodeDefinition = [
      "zero: ['channelMerger', 'output', {numberOfInputs: numberOfPartialBufferAndGainValuePairs}]"
    ];
    for( let i = 1; i <= numberOfPartialBufferAndGainValuePairs; i++ ) {
      const oneAudioWaveKey = `audioWave${i}`;
      const oneGainValueCurveKey = `gainValueCurve${i}`;
      const oneGainWeightKey = `gainWeight${i}`;
      functionParams.push(oneAudioWaveKey);
      functionParams.push(oneGainValueCurveKey);
      functionParams.push(oneGainWeightKey);

      if( 1 < i ) {
        additiveNodeDefinition.push(
          `gainWeight${i}: ['gain', 'zero', {gain:${oneGainWeightKey}}]`
        );
      } else {
        // let's allow the first partial / fundamental frequency always have full constant gain
        // (while being affected by a gain envelope as the other overtones)
        // TODO: maybe there is no reason to implement this special case?
        additiveNodeDefinition.push(
          `gainWeight${i}: ['gain', 'zero', {gain:1}]`
        );
      }
      additiveNodeDefinition.push(
        `gainValueCurve${i}: ['gain', 'gainWeight${i}', {gain: ['setValueCurveAtTime', ${oneGainValueCurveKey}, currentTime, duration]}]`
      );
      additiveNodeDefinition.push(
        `audioWave${i}: ['bufferSource', 'gainValueCurve${i}', {buffer: ${oneAudioWaveKey}}]`
      );
      // dummy input destination - additive synthesis node does not really have a direct input,
      // - but rather accepts inputs via the audioWave and gainValueCurve parameters
      // - https://github.com/synth-is/virtual-audio-graph/tree/graphs-as-arrays?tab=readme-ov-file#custom-nodes
      // additiveNodeDefinition.push(
      //   `dummyInput: ['gain', 'output', {gain:1}, 'input']`
      // ); 
    }

    const functionBody = `
      const { ${functionParams.join(',')} } = params;
      return { ${additiveNodeDefinition.join(',')} };
    `;

    const additiveSynth = new Function( 'params', functionBody );
    return additiveSynth;
  }

  async getAdditiveSynthesisGraphNodeEntry(
    outputKeys, partialBuffers, gainEnvelopes, partailGainWeights, currentTime, duration
  ) {
    if( partialBuffers && partialBuffers.length && gainEnvelopes && gainEnvelopes.length ) {
      const additive = this.getAdditiveSynthesisAudioNodeFunction( partialBuffers.length );
      const additiveNodeFunctionParameters = {
        numberOfPartialBufferAndGainValuePairs: partialBuffers.length,
        currentTime,
        duration
      };
      partialBuffers.forEach( (onePartialBuffer, partialBufferIndex) => {
        additiveNodeFunctionParameters[`audioWave${partialBufferIndex+1}`] = onePartialBuffer;
      });
      gainEnvelopes.forEach( (oneGainEnvelopeValueCurveArray, gainEnvelopeIndex) => {
        additiveNodeFunctionParameters[`gainValueCurve${gainEnvelopeIndex+1}`] = oneGainEnvelopeValueCurveArray;
      });
      partailGainWeights.forEach( (onePartialGainWeight, gainWeightIndex) => {
        additiveNodeFunctionParameters[`gainWeight${gainWeightIndex+1}`] = onePartialGainWeight;
      });
      const additiveNodeEntry = [additive, outputKeys, additiveNodeFunctionParameters];
      return additiveNodeEntry;
    } else {
      return null;
    }
  }

  getAudioBufferSourceNode( samplesArrays, audioCtx, sampleCount ) {

    // Get an AudioBufferSourceNode.
    // This is the AudioNode to use when we want to play an AudioBuffer
    let audioBufferSourceNode = audioCtx.createBufferSource();
    // set the buffer in the AudioBufferSourceNode
    audioBufferSourceNode.buffer =
      getAudioBuffer( samplesArrays, audioCtx, sampleCount );

    return audioBufferSourceNode;
  }

  async spawnMultipleGainValuesPerAudioWaveWorkers( audioWaveCount, controlWave ) {
    // const chunk = Math.round(
    //   controlWave.length / 1 // chrome tends to crash, so we'll skip this for now: numWorkers
    // );
    // const gainValuePromises = [];
    // for( let i=0, j=controlWave.length; i<j; i+=chunk ) {
    //   const controlWaveSlice = controlWave.slice( i, i+chunk );
    //
    //   gainValuePromises.push(
    //     this.spawnOneGainValuesPerAudioWaveWorker(
    //       audioWaveCount, controlWaveSlice )
    //   );
    // }
    // return Promise.all( gainValuePromises ).then( arrayOfSubGainValues => {
    //
    //   return this.getCombinedGainValuesFromSubResults( arrayOfSubGainValues );
    // });

    return this.spawnOneGainValuesPerAudioWaveWorker(
      audioWaveCount, controlWave
    );
  }

  spawnOneGainValuesPerAudioWaveWorker( audioWaveCount, _controlWave ) {
    const promise = new Promise( async (resolve, reject) => {

      let controlWave = new Float32Array(_controlWave);

      let gainValues;
      if( this.useWorkers ) {
        const gainValuesPerAudioWaveWorker = await spawn(new Worker("../workers/gain-values-per-audio-wave-worker.js"));
        gainValues = await gainValuesPerAudioWaveWorker(audioWaveCount, Transfer(controlWave.buffer));

        await Thread.terminate(gainValuesPerAudioWaveWorker);
      } else {
        gainValues = gainValuesPerAudioWave( audioWaveCount, controlWave );
      }
      resolve( gainValues );
    });
    return promise;
  }

  getCombinedGainValuesFromSubResults( arrayOfSubGainValues ) {

    // initialize a Map of gain values using the first sub result as template
    const gainValues = new Map( [...arrayOfSubGainValues[0].entries()].map( oneEntry => {
      return [
         oneEntry[0],
         // will hold sub sample arrays, which will then be concatenated:
         new Array(arrayOfSubGainValues.length)
       ];
    }) );

    // combine gain values from each sub result
    const gainSubArrays = [];
    arrayOfSubGainValues.forEach( (subGainValues, subIndex) => {
      for( let [gainIndex, gainSubValues] of subGainValues ) {
        // add sub array of gain values
        gainValues.get( gainIndex )[subIndex] = gainSubValues;
      }
    });
    for( let [gainIndex, gainValuesSubArrays] of gainValues ) {
      gainValues.set(gainIndex,
        // combine the sub arrays
        concatenateTypedArrays(Float32Array, gainValuesSubArrays) );
    }
    return gainValues;
  }



  getAudioSourceGains( gainValues, audioCtx, duration ) {

    const gainValueCurvePromises = [];
    gainValues.forEach( (oneGainControlArray, gainIndex) => {

      gainValueCurvePromises.push(
        this.getGainControlArrayRemappedToValueCurveRange( oneGainControlArray )
      );
    });
    return Promise.all( gainValueCurvePromises ).then( gainValueCurveArrays => {
      const audioSourceGains = [];
      gainValueCurveArrays.forEach( oneValueCurveArray => {
        let VCA = audioCtx.createGain();
        VCA.gain.setValueCurveAtTime(
          oneValueCurveArray, audioCtx.currentTime, duration );
        audioSourceGains.push( VCA );
      });
      return audioSourceGains;
    });
  }

  async getGainControlArrayRemappedToValueCurveRange( _gainControlArray ) {

    const promise = new Promise( async (resolve, reject) => {

      let gainControlArray = new Float32Array(_gainControlArray);

      let remappedGainControlArray;
      if( this.useWorkers ) {
        const remapControlArrayToValueCurveRangeWorker = await spawn(new Worker("../workers/remap-control-array-to-value-curve-range-worker.js"));
        remappedGainControlArray = await remapControlArrayToValueCurveRangeWorker( Transfer(gainControlArray.buffer) );

        await Thread.terminate(remapControlArrayToValueCurveRangeWorker);
      } else {
        remappedGainControlArray = remapControlArrayToValueCurveRange(gainControlArray.buffer);
      }

      resolve( remappedGainControlArray );
    });
    return promise;
  }

}

export default Renderer;
