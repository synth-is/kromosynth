import * as tf from '@tensorflow/tfjs';
import { yamnetTags } from './classificationTags.js';

let _graphModel;
let model;

async function initializeGraphModel( graphModel, useGPU ) {
  _graphModel = graphModel;
  let modelUrl;
  switch (graphModel) {
    case 'yamnet':
      modelUrl = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
      break;
    default:
      modelUrl = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
  }
  if( !useGPU ) {
    tf.setBackend('cpu');
  }
  model = await tf.loadGraphModel(modelUrl, { fromTFHub: true });
}

onmessage = async (e) => {
  try {
    if( e.data.graphModel !== _graphModel || !model ) {
      await initializeGraphModel( e.data.graphModel, e.data.useGPU );
    }

    // see https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1

    const waveform = tf.tensor(e.data.audioData);

    const [scores, embeddings, spectrogram] = model.predict(waveform);
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

    let taggedPredictions = {};
    predictions.map( (p, i) => { taggedPredictions[yamnetTags[i]] = p; return 0} );

    const topPredictionIdx = await scores.mean(axis).argMax().array();
    const taggedTopPredictions = { [yamnetTags[topPredictionIdx]]: predictions[topPredictionIdx] };

    postMessage({ taggedPredictions, taggedTopPredictions });
  } catch (e) {
    postMessage(undefined);
  }
}
