import { isAudible, remapNumberToRange, numWorkers } from '../util/range';
import { concatenateTypedArrays } from '../util/arrays';
import { getMemberOutputsKey } from '../util/network-output';
import { getFrequencyToNoteDelta } from '../wavekilde';
// import { lerp } from '../util/range';
import createVirtualAudioGraph from 'virtual-audio-graph';
import clone from 'clone';  // TODO: replace with import cloneDeep from "lodash/cloneDeep"; ?
import chroma from 'chroma-js';
import isString from "lodash/isString";
import isNumber from "lodash/isNumber";

import GainValuesPerAudioWavesWorker from "../workers/gain-values-per-audio-wave-worker?worker";
import RemapControlArrayToValueCurveRangeWorker from "../workers/remap-control-array-to-value-curve-range-worker?worker";


/**
 * Renders audio buffers from CPPN network output samples
 * by wiring an audio graph from a provided patch definition.
 */
class Renderer {

  constructor( sampleRate ) {
    this.sampleRate = sampleRate;
  }

  renderNetworksOutputSamplesAsAudioBuffer(
      memberOutputs, patch, noteDelta, spectrogramDimensions,
      getDataArray
  ) {
    const sampleCount = Math.round(this.sampleRate * patch.duration);

    return new Promise( (resolve, reject) => {

      // TODO: move in hardcoded rendering from IndividualContainer

      console.log('Wiring up audio graph...');

      const startAudioCtxInstance = performance.now();

      const offlineCtx = new (OfflineAudioContext || webkitOfflineAudioContext)( 1 /*channels*/,
        this.sampleRate * patch.duration, this.sampleRate);

      const endAudioCtxInstance = performance.now();
      console.log(`%c instantiating audio context took ${endAudioCtxInstance-startAudioCtxInstance} milliseconds`,'color:darkorange');


      // getSubtractiveSynthesisExampleGraph();

      // getWawetableSynthesisExampleGraph();


      const virtualAudioGraph = createVirtualAudioGraph({
        audioContext: offlineCtx,
        output: offlineCtx.destination,
      });

      // this.updateWithTestFMAudioGraph(
      //   virtualAudioGraph, memberOutputs, offlineCtx, sampleCount, patch.duration );

      // let's clone the patch,
      // to not clutter the saved patch definition with value curve sample data
      const _patch = clone(patch);

// /*
      this.getNodeGraphFromPatch(
        _patch,
        memberOutputs,
        sampleCount, patch.duration,
        virtualAudioGraph,
        offlineCtx,
        noteDelta
      ).then( graphDefinition => {

        try {
          virtualAudioGraph.update( graphDefinition );
        }
        catch (e) {
          console.log("Error creating virtual audio graph");
          reject("Error creating virtual audio graph:", e);
        }

        console.log('Done wiring up audio graph, will now render.');

        /////////// spectrogram
        // migrate to AudioWorklet node?
        // https://www.warpdesign.fr/webaudio-from-scriptprocessornode-to-the-new-audioworklet-api/
        // as ScriptProcessorNode is deprecated:
        // https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode
        // https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode
        let freqDataArrays;
        if( spectrogramDimensions ) {

          // https://gist.github.com/moust/95f5cd5daa095f1aad89
          // https://stackoverflow.com/a/46069463/169858
          const scp = offlineCtx.createScriptProcessor(2048, 1, 1);
          scp.connect(offlineCtx.destination);

          const analyser = offlineCtx.createAnalyser();
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
// */

/*
      this.getWawetableSynthesisExampleGraph(
        memberOutputs, offlineCtx, sampleCount, patch
      ).then( () => {
        const startRenderAudioGraph = performance.now();
*/
        // Offline rendering of the audio graph to a reusable buffer
        offlineCtx.startRendering().then(function( renderedBuffer ) {
          console.log('Rendering completed successfully');
          const endRenderAudioGraph = performance.now();
          console.log(`%c Rendering audio graph took ${endRenderAudioGraph - startRenderAudioGraph} milliseconds`, 'color:darkorange');

          const bufferChannelData = renderedBuffer.getChannelData(0);

          // ensure values are not outside the [-1, 1] range, to have consistence between DACs and storage in WAV files
          let minSampleValue = 0, maxSampleValue = 0;
          bufferChannelData.forEach( (oneSample, sampleIndex) => {
            if( oneSample < minSampleValue ) {
              minSampleValue = oneSample;
            }
            if( oneSample > maxSampleValue ) {
              maxSampleValue = oneSample;
            }
          });
          if( minSampleValue < -1 || maxSampleValue > 1 ) {
            for (var i = 0; i < bufferChannelData.length; i++) {
              bufferChannelData[i] = remapNumberToRange(bufferChannelData[i], minSampleValue, maxSampleValue, -1, 1 );
            }
          }

          // return the data array or re-create an AudioBuffer after the remap
          let networkIndividualSound;
          if( getDataArray ) {
            networkIndividualSound = bufferChannelData;
          } else {
            const renderedBufferAfterRemapToRange = this.getAudioBuffer( [bufferChannelData], offlineCtx, sampleCount );
            networkIndividualSound = this.ensureBufferStartsAndEndsAtZero(renderedBufferAfterRemapToRange);
          }

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
            })
          }

        }.bind(this)).catch(function( err ) {
          console.log('Rendering failed: ' + err);

          reject( "Not able to render audio buffer from member outputs with provided audio graph patch: "
            + err );
        });

      });

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


  async getNodeGraphFromPatch(
    patch, memberOutputs, sampleCount, duration, virtualAudioGraph, audioContext, noteDelta ) {

    const graph = patch.audioGraph;
    const graphNodeKeysToValueCurves = this.getValueCurvesFromPatch(
      patch, memberOutputs, sampleCount, audioContext );

    const {currentTime} = virtualAudioGraph;

    // const wavetableGraphNodeEntryPromises = [];
    for( const oneAudioGraphNodeKey in graph ) {
      const valueCurves = graphNodeKeysToValueCurves.get( oneAudioGraphNodeKey );
      const nodeType = graph[oneAudioGraphNodeKey][0];
      const outputKeys = graph[oneAudioGraphNodeKey][1];
      if( valueCurves ) {

        // TODO: if multiple network outputs point to the same graph node and parameter
        // add ChannelmergerNode to graph, for fan-in of all the networkOutputs
        // https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API#fan-in_and_fan-out
        // via AudioParam notes at https://developer.mozilla.org/en-US/docs/Web/API/AudioNode/connect#audioparam_example
        // - see audioGraphTargetsToSources and audioGraphTargetsToNetworkOutputs in audio-graph-asNEAT-bridge

        if( 'wavetable' === nodeType ) {

          const mixWaveSamples = this.getWavetableMixWaveFromPatch(
            valueCurves );
          const audioWavesSamples = this.getWavetableAudioWavesFromPatch(
            valueCurves );

          const wavetableGraphNode =  await this.getWavetableGraphNodeEntry(
            oneAudioGraphNodeKey, outputKeys, mixWaveSamples, audioWavesSamples,
            currentTime, duration
          );
          if( wavetableGraphNode ) {
            graph[oneAudioGraphNodeKey] = wavetableGraphNode;
          } else {
            delete graph[oneAudioGraphNodeKey];
          }

        } else {

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
      } else if( 'wavetable' === nodeType ) {
        // no value curves are present (from networkOutputs) for those custom nodes,
        // so the custom node virtual-audio-graph functions haven't been defined and added to the audio signal graph
        // (a custom audio graph function actually be returned for feedbackDelay, as it doesn't require samples...)
        // - delete the nodes for now
        delete graph[oneAudioGraphNodeKey];
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
    if( removeEdgeClicks ) {
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

  getValueCurvesFromPatch( patch, memberOutputs, sampleCount, audioContext ) {
    const graphNodeKeysToValueCurves = new Map();
    patch.networkOutputs.forEach( (oneOutput, outputIndex) => {

      let samples;
      if( isString(oneOutput.networkOutput) && oneOutput.networkOutput.startsWith("noise") ) { // see ../as-neat/nodes/networkOutputNode.js
        samples = this.getNoiseSamples( oneOutput.networkOutput, sampleCount );
      } else {
        const memberOutputsKey = getMemberOutputsKey(
          {index: oneOutput.networkOutput, frequency: oneOutput.frequency} );
        if( memberOutputs.get(memberOutputsKey) ) {
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
              const audioBuffer = this.getAudioBuffer(
                [valueCurve], audioContext, sampleCount );
              paramNameToValueCurve.set(
                `${outputIndex}_${connectionIndex}_${oneAudioGraphNodeConn.paramName}`, audioBuffer );
            } else {
              paramNameToValueCurve.set(
                `${outputIndex}_${connectionIndex}_${oneAudioGraphNodeConn.paramName}`, valueCurve );
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

    const testAudioBuffer = this.getAudioBuffer(
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
        return this.getAudioBufferSourceNode(
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

      }); // gain calculation promise

    });

  }


  getFeedbackGainNodeFunction() {
    const feedbackDelay = ({
      delayTime = 0,
      feedbackRatio = 0.2
    } = {}) => ({
      'feedbackGainNode': ['gain', 'passthroughGain', {gain: feedbackRatio}], // {gain: 0.90}
      'delayNode': ['delay', 'feedbackGainNode', {delayTime}], // {delayTime:0.1}
      'passthroughGain': ['gain', ['output', 'delayNode'], {gain: 1.0}, 'input']
    });
    return feedbackDelay;
  }


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
      "zero: ['channelMerger', 'output', {numberOfOutputs: numberOfAudiowaves}]"
    ];
    for( let i = 1; i <= numberOfAudiowaves; i++ ) {
      const oneGainValueCurveKey = `gainValueCurve${i}`;
      const oneAudioWaveKey = `audioWave${i}`;
      functionParams.push(oneGainValueCurveKey);
      functionParams.push(oneAudioWaveKey);

      wavetableNodeDefinition.push(
        `g${i}: ['gain', 'zero', {gain: ['setValueCurveAtTime', ${oneGainValueCurveKey}, currentTime, duration]}]`
      );
      wavetableNodeDefinition.push(
        `a${i}: ['bufferSource', 'g${i}', {buffer: ${oneAudioWaveKey}}]`
      );
    }

    const functionBody = `
      const { ${functionParams.join(',')} } = params;
      return { ${wavetableNodeDefinition.join(',')} };
    `;

    const wavetable = new Function( 'params', functionBody );

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
    const audioWavesSamples = [];
    for( let [paramName, values] of valueCurves.entries() ) {
      const _paramName = paramName.split('_')[2];
      if( _paramName === 'buffer' ) {
        audioWavesSamples.push( values );
      }
    }
    return audioWavesSamples;
  }


  ensureBufferStartsAndEndsAtZero( buffer ) {
    const samplesToFadeFromZero = 128;
    if( 0 != buffer[0] ) {
      for( let i=0; i < samplesToFadeFromZero; i++ ) {
        buffer[i] = buffer[i] * (i/samplesToFadeFromZero);
      }
    }
    if( 0 != buffer[buffer.length-1] ) {
      for( let i=samplesToFadeFromZero; i > 0; --i ) {
        buffer[buffer.length-i] =
          buffer[buffer.length-i] * ((i-1) / samplesToFadeFromZero);
      }
    }
    // TODO: this isn't finding sharp carckles such as in https://synth.is/in/01c3h7x73dfqg1fncf4r7wjp1r/10/9/01c83z14pkc78vxxny682j33f4/6000/MTJfMC0wX24xMi00X244LThfbjEwLTEy
    // if( false /*shouldDoCavemanCrackleRemoval*/ ) {
    //   const changeThreshold = .1;
    //   console.log("---buffer.length:",buffer.length, buffer[0], buffer[Math.round(buffer.length/2)]);
    //   let maxValue = 0;
    //   let minValue = 0;
    //   let sharpestChange = 0;
    //   for( let i=0; i < buffer.length-1; i++ ) {
    //     const changeBetweenSamples = Math.abs(buffer[i] - buffer[i+1]);
    //     if( changeBetweenSamples > sharpestChange ) sharpestChange = changeBetweenSamples;
    //     if( changeThreshold < changeBetweenSamples ) {
    //       console.log("---change above threshold: ", Math.abs(buffer[i] - buffer[i+1]));
    //       const maxGapSize = 128;
    //       let indexWithinChangeThreshold = -1;
    //       for( let j=i+1; j-i < maxGapSize; j++ ) {
    //         if( changeThreshold > Math.abs(buffer[i] - buffer[j]) ) {
    //           indexWithinChangeThreshold = j;
    //           break;
    //         }
    //       }
    //       if( -1 < indexWithinChangeThreshold ) {
    //         for( let k=i+1; k < indexWithinChangeThreshold; k++ ) {
    //           const rangeFraction = k / (indexWithinChangeThreshold - i);
    //           const kSignal = lerp( buffer[i], buffer[indexWithinChangeThreshold], rangeFraction );
    //           buffer[k] = kSignal;
    //         }
    //       }
    //       i = indexWithinChangeThreshold + 1;
    //     }
    //
    //     if( buffer[i] < minValue ) minValue = buffer[i];
    //     if( buffer[i] > maxValue ) maxValue = buffer[i];
    //
    //   }
    //   console.log("---maxValue:", maxValue, ", minValue:", minValue, ", sharpestChange:", sharpestChange);
    // }
    return buffer;
  }


  getAudioBuffer( samplesArrays, audioCtx, sampleCount ) {

    let channels = samplesArrays.length;

    let arrayBuffer = audioCtx.createBuffer(
      channels, sampleCount, audioCtx.sampleRate );

    // Fill the buffer with signals according to the network outputs
    for( let channel=0; channel < channels; channel++ ) {

      // This gives us the actual ArrayBuffer that contains the data
      let nowBuffering = arrayBuffer.getChannelData( channel );
      let networkOutputBuffer = this.ensureBufferStartsAndEndsAtZero(
        samplesArrays[channel] );
      for( let i=0; i < sampleCount; i++ ) {
        nowBuffering[i] = networkOutputBuffer[i];
      }
    }
    return arrayBuffer;
  }

  getAudioBufferSourceNode( samplesArrays, audioCtx, sampleCount ) {

    // Get an AudioBufferSourceNode.
    // This is the AudioNode to use when we want to play an AudioBuffer
    let audioBufferSourceNode = audioCtx.createBufferSource();
    // set the buffer in the AudioBufferSourceNode
    audioBufferSourceNode.buffer =
      this.getAudioBuffer( samplesArrays, audioCtx, sampleCount );

    return audioBufferSourceNode;
  }



  spawnMultipleGainValuesPerAudioWaveWorkers( audioWaveCount, controlWave ) {
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
    const promise = new Promise( (resolve, reject) => {
      const gainValuesPerAudioWaveWorker = new GainValuesPerAudioWavesWorker();
      let controlWave = new Float32Array(_controlWave);
      gainValuesPerAudioWaveWorker.postMessage({
        audioWaveCount,
        controlWave
      }, [controlWave.buffer] );
      gainValuesPerAudioWaveWorker.onmessage = (e) => {
        gainValuesPerAudioWaveWorker.terminate();
        resolve( e.data.gainValues );
      };
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

  getGainControlArrayRemappedToValueCurveRange( gainControlArray ) {

    return new Promise(function(resolve, reject) {
      const remapControlArrayToValueCurveRangeWorker =
        new RemapControlArrayToValueCurveRangeWorker();

      remapControlArrayToValueCurveRangeWorker.postMessage({
        gainControlArray
      }, [gainControlArray.buffer] );

      remapControlArrayToValueCurveRangeWorker.onmessage = (e) => {
        remapControlArrayToValueCurveRangeWorker.terminate();
        resolve( e.data.valueCurve );
      };
    });
  }

}

export default Renderer;
