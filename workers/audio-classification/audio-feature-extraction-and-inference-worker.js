// TODO: split feature extraction and predictions into separate workers, as in https://glitch.com/edit/#!/essentiajs-models-rt?path=scripts%2Ffeature-extract-processor.js%3A43%3A81
import Essentia from '../../vendor/essentia/essentia.js-core.es.js'
import {EssentiaWASM} from '../../vendor/essentia/essentia-wasm.es.js';
import {EssentiaTFInputExtractor, TensorflowMusiCNN} from '../../vendor/essentia/essentia.js-model.es.js';
import * as tf from '@tensorflow/tfjs';

let _graphModel;

const modelURL_MSD = 'https://storage.googleapis.com/tensorflow-graph-models/msd-musicnn-1/model.json'; // '../vendor/tensorflow/msd-musicnn-1/model.json'
const modelURL_MTT = 'https://storage.googleapis.com/tensorflow-graph-models/mtt-musicnn-1/model.json';
let modelURL;

const msdTags = ["rock", "pop", "alternative", "indie", "electronic", "female vocalists", "dance", "2000s", "alternative rock", "jazz", "beautiful", "metal", "chillout", "male vocalists", "classic rock", "soul", "indie rock", "mellow", "electronica", "80s", "folk", "90s", "chill", "instrumental", "punk", "oldies", "blues", "hard rock", "ambient", "acoustic", "experimental", "female vocalist", "guitar", "hip-hop", "70s", "party", "country", "easy listening", "sexy", "catchy", "funk", "electro", "heavy metal", "progressive rock", "60s", "rnb", "indie pop", "sad", "house", "happy"];
const mttTags = ["guitar", "classical", "slow", "techno", "strings", "drums", "electronic", "rock", "fast", "piano", "ambient", "beat", "violin", "vocal", "synth", "female", "indian", "opera", "male", "singing", "vocals", "no vocals", "harpsichord", "loud", "quiet", "flute", "woman", "male vocal", "no vocal", "pop", "soft", "sitar", "solo", "man", "classic", "choir", "voice", "new age", "dance", "male voice", "female vocal", "beats", "harp", "cello", "no voice", "weird", "country", "metal", "female voice", "choral"];
let modelTags;

let extractor;
let model;

async function initializeEssentia( graphModel, useGPU ) {
  console.log("initializeEssentia",EssentiaWASM);
  extractor = new EssentiaTFInputExtractor(
    EssentiaWASM,
    // 'vggish'
    'musicnn'
  );
  console.log("extractor:",extractor);

  const essentia = new Essentia(EssentiaWASM);
  // prints version of essentia wasm backend
  console.log(essentia.version);
  // prints all the available algorithm methods in Essentia
  console.log(essentia.algorithmNames);

  _graphModel = graphModel;
  switch (graphModel) {
    case "msd-musicnn-1":
      modelURL = modelURL_MSD;
      modelTags = msdTags;
      break;
    case "mtt-musicnn-1":
      modelURL = modelURL_MTT;
      modelTags = mttTags;
      break;
    default:
      modelURL = mttTags;
      modelTags = mttTags;
  }

  console.info('about to initialize model');
  console.log("TensorflowMusiCNN",TensorflowMusiCNN);
  console.log("tf",tf);
  console.log("modelURL",modelURL);
  if( !useGPU ) {
    tf.setBackend('cpu');
  }
  model = new TensorflowMusiCNN(tf, modelURL);
  console.log("model",model);
  await model.initialize();
  console.log('Model has been loaded!', model);
}

export async function featureExtractionAndInference( audioData, graphModel, useGPU ) {
  if( e.data.graphModel !== _graphModel ) {
    await initializeEssentia( graphModel, useGPU );
  }

  console.log("audioData", audioData);

  let features;
  try {
    features = await extractor.computeFrameWise(audioData, 256);
  } catch (e) {
    return { error: e };
  }

  // const features = await extractor.computeFrameWise(e.data.audioData, 400);
  console.log("features",features);
  // postMessage({features});

  // await musicnn.initialize();
  // console.log("model",model);
  // const predictions = await model.predict(features, true);
  // console.log("predictions");

  if( features ) {
    model.predict(features, true).then(predictions => {
      predictions = predictions[0]; // model.predict returns a [Array(50)]
      let taggedPredictions = {};
      predictions.map( (p, i) => { taggedPredictions[modelTags[i]] = p; return 0} );
      predictions.sort();
      // console.log("predictions", predictions);

      let topPredictions = predictions.slice(-5);
      let taggedTopPredictions = modelTags.filter(label => topPredictions.includes(taggedPredictions[label]));

      return { taggedPredictions, taggedTopPredictions };
    } );
  } else {
    return undefined;
  }
}

// onmessage = async (e) => {
//   if( e.data.graphModel !== _graphModel ) {
//     await initializeEssentia( e.data.graphModel, e.data.useGPU );
//   }

//   console.log("e.data.audioData",e.data.audioData);

//   let features;
//   try {
//     features = await extractor.computeFrameWise(e.data.audioData, 256);
//   } catch (e) {
//     postMessage({ error: e });
//   }

//   // const features = await extractor.computeFrameWise(e.data.audioData, 400);
//   console.log("features",features);
//   // postMessage({features});

//   // await musicnn.initialize();
//   // console.log("model",model);
//   // const predictions = await model.predict(features, true);
//   // console.log("predictions");

//   if( features ) {
//     model.predict(features, true).then(predictions => {
//       predictions = predictions[0]; // model.predict returns a [Array(50)]
//       let taggedPredictions = {};
//       predictions.map( (p, i) => { taggedPredictions[modelTags[i]] = p; return 0} );
//       predictions.sort();
//       // console.log("predictions", predictions);

//       let topPredictions = predictions.slice(-5);
//       let taggedTopPredictions = modelTags.filter(label => topPredictions.includes(taggedPredictions[label]));

//       postMessage({ taggedPredictions, taggedTopPredictions });
//     } );
//   }
// }
