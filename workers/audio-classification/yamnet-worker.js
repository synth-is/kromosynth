import { isBrowser } from "browser-or-node";
import * as tfBrowser from '@tensorflow/tfjs';
import tf from '@tensorflow/tfjs-node-gpu'; // https://github.com/tensorflow/tfjs/tree/master/tfjs-node
import { yamnetTags } from './classificationTags.js';

let _tf;
let _graphModel;
let model;

async function initializeGraphModel( graphModel, modelUrl, useGPU ) {
  console.log("Initializing YAMNet graph model...");
  const startYamnetInitialization = performance.now();
  _graphModel = graphModel;
  let _modelUrl;
  if( modelUrl ) {
    _modelUrl = modelUrl;
  } else {
    switch (graphModel) {
      case 'yamnet':
        _modelUrl = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
        break;
      default:
        _modelUrl = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
    }
  }
  if( !useGPU ) {
    _tf.setBackend('cpu');
  }
  model = await _tf.loadGraphModel(_modelUrl, { fromTFHub: modelUrl === undefined });
  const endYamnetInitialization = performance.now();
  console.log(`Initialized YAMNet graph model in ${endYamnetInitialization-startYamnetInitialization} ms.`);
}

export async function getTaggedPredictions( audioData, graphModel, modelUrl, useGPU ) {
  try {
    if( ! _tf ) {
      if( isBrowser ) {
        _tf = tfBrowser;
      } else {
        _tf = tf;
      }
    }
    if( graphModel !== _graphModel || !model ) {
      await initializeGraphModel( graphModel, modelUrl, useGPU );
    }

    // see https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1

    const waveform = _tf.tensor(audioData);


    // let model = await tf.loadGraphModel(modelUrl, { fromTFHub: false /*modelUrl === undefined*/ });
    // let waveform = tf.tensor(audioData);

    const [
      scores
      // , embeddings, spectrogram
    ] = model.predict(waveform);
    const verbose = true;
    const axis = 0;

    // scores.print(verbose);  // shape [N, 521]
    // embeddings.print(verbose);  // shape [N, 1024]
    // spectrogram.print(verbose);  // shape [M, 64]
    // // Find class with the top score when mean-aggregated across frames
    // scores.mean(axis).print(verbose);
    // console.log("scores.mean(axis)",scores.mean(axis).array());
    // scores.mean(axis).argMax().print(verbose);
    // // Should print 494 corresponding to 'Silence' in YAMNet Class Map.

    const predictions = await scores.mean(axis).array();
    // const predictions = new Array(yamnetTags.length);
    // for (let i = 0; i < predictions.length; i++) {
    //   predictions[i] = Math.random();
    // }

    let taggedPredictions = {};
    predictions.map( (p, i) => { taggedPredictions[yamnetTags[i]] = p; return 0} );

    const topPredictionIdx = await scores.mean(axis).argMax().array();
    // const topPredictionIdx = Math.floor(Math.random() * yamnetTags.length);
    const taggedTopPredictions = { [yamnetTags[topPredictionIdx]]: predictions[topPredictionIdx] };

    return { taggedPredictions, taggedTopPredictions };
  } catch (e) {
    return undefined;
  }
}

// onmessage = async (e) => {
//   try {
//     if( e.data.graphModel !== _graphModel || !model ) {
//       await initializeGraphModel( e.data.graphModel, e.data.useGPU );
//     }

//     // see https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1

//     const waveform = tf.tensor(e.data.audioData);

//     const [scores, embeddings, spectrogram] = model.predict(waveform);
//     const verbose = true;
//     const axis = 0;

//     // scores.print(verbose);  // shape [N, 521]
//     // embeddings.print(verbose);  // shape [N, 1024]
//     // spectrogram.print(verbose);  // shape [M, 64]
//     // // Find class with the top score when mean-aggregated across frames
//     // scores.mean(axis).print(verbose);
//     // console.log("scores.mean(axis)",scores.mean(axis).array());
//     // scores.mean(axis).argMax().print(verbose);
//     // // Should print 494 corresponding to 'Silence' in YAMNet Class Map.

//     const predictions = await scores.mean(axis).array();

//     let taggedPredictions = {};
//     predictions.map( (p, i) => { taggedPredictions[yamnetTags[i]] = p; return 0} );

//     const topPredictionIdx = await scores.mean(axis).argMax().array();
//     const taggedTopPredictions = { [yamnetTags[topPredictionIdx]]: predictions[topPredictionIdx] };

//     postMessage({ taggedPredictions, taggedTopPredictions });
//   } catch (e) {
//     postMessage(undefined);
//   }
// }
