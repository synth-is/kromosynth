import { spawn, Thread, Worker, Transfer } from "threads";
import { renderAudio } from "./render.js";
// TODO: this doesn't work for browser deployments:
if( typeof AudioContext === 'undefined' ) { // Node.js
  const NodeWebAudioAPI = await import('node-web-audio-api');
  global.AudioContext = NodeWebAudioAPI.default.AudioContext;
  global.OfflineAudioContext = NodeWebAudioAPI.default.OfflineAudioContext;
}

// import FeatureExtractionAndInferenceWorker from "../workers/audio-classification/audio-feature-extraction-and-inference-worker?worker";
// import YamnetAudioClassificationWorker from "../workers/audio-classification/yamnet-worker.js?worker";
// imports for when not using workers - see _useWorkers
import { getTaggedPredictions } from "../workers/audio-classification/yamnet-worker.js";
// import { featureExtractionAndInference } from "../workers/audio-classification/audio-feature-extraction-and-inference-worker.js";

const _useWorkers = false; // TODO: configurable or dependent on environment; spawn multiple workers according to available / configured threading
const SAMPLE_RATE = 16000; // Essentia.js input extractor sample rate:  https://mtg.github.io/essentia.js/docs/api/machinelearning_tfjs_input_extractor.js.html#line-92
let _audioCtx;

const ENVIRONMENT_IS_NODE=typeof process==="object"&&typeof process.versions==="object"&&typeof process.versions.node==="string";

/**
 * For the given sound genome, obtain a map of class keys to the respective class scores 
 * along with the combination of duration, note delta and velocity that received the highest score.
 * @param {object} genome Sound genome as JSON
 * @param {array} classScoringDurations Array of durations in seconds to use when finding class scores (fitness) of the sound
 * @param {array} classScoringNoteDeltas Array of note deltas to use when finding class scores (fitness) of the sound
 * @param {array} classScoringVelocities Array of velocities in the range [0, 1] to use when finding class scores (fitness) of the sound
 * @param {string} classificationGraphModel String key for the classification model
 * @param {boolean} useGPU Flag controlling the use of a GPU during classification
 * @param {boolean} supplyOfflineAudioContextInstance Indicate wether an OfflineAudioContext should be supplied (node-web-audio-api) or obtained from the (web browser) runtime environment
 * @returns A map (object) from class keys to the respective class scores along with the combination of duration, note delta and velocity that received the highest score
 */
export async function getClassScoresForGenome(
  genome,
  classScoringDurations = [0.5, 1, 2, 5],
  classScoringNoteDeltas = [-36, -24, -12, 0, 12, 24, 36],
  classScoringVelocities = [0.25, 0.5, 0.75, 1],
  classificationGraphModel = 'yamnet', modelUrl,
  useGPU,
  antiAliasing,
  supplyAudioContextInstances,
  useOvertoneInharmonicityFactors = true,
) {
  const startGenomeClassification = performance.now();
  const predictionsAggregate = {};
  for( let duration of classScoringDurations ) {
    for( let noteDelta of classScoringNoteDeltas ) {
      // TODO: choose notes within octave according to classScoringOctaveNoteCount
      for( let velocity of classScoringVelocities ) {

        let offlineAudioContext;
        let audioContext;
        if( supplyAudioContextInstances ) {
          offlineAudioContext = new OfflineAudioContext({
            numberOfChannels: 2,
            length: SAMPLE_RATE * duration,
            sampleRate: SAMPLE_RATE,
          });
          audioContext = getAudioContext();
        } else {
          offlineAudioContext = undefined;
          audioContext = undefined;
        }
        const predictions = await getGenomeClassPredictions(
          classificationGraphModel, modelUrl,
          genome, duration, noteDelta, velocity,
          useGPU,
          offlineAudioContext,
          audioContext,
          useOvertoneInharmonicityFactors,
          antiAliasing
        );
        if( predictions ) {
          for( const classKey in predictions.taggedPredictions ) {
            let isCurrentBestClassCandidate;
            if( ! predictionsAggregate[classKey] ||
              predictionsAggregate[classKey].score < predictions.taggedPredictions[classKey]
            ) {
              isCurrentBestClassCandidate = true;
            }
            if( isCurrentBestClassCandidate ) {
              const classPrediction = {
                score: predictions.taggedPredictions[classKey],
                duration,
                noteDelta,
                velocity
              };
              predictionsAggregate[classKey] = classPrediction;
            }
          }
        }
      }
    }
  }
  const endGenomeClassification = performance.now();
  console.log(`Getting class scores for genome ${genome._id} 
    for ${classScoringDurations.length} classScoringDurations
    and ${classScoringNoteDeltas.length} classScoringNoteDeltas
    and ${classScoringVelocities.length} classScoringVelocities
    in total ${classScoringDurations.length*classScoringNoteDeltas.length*classScoringVelocities.length} iterations
    took ${endGenomeClassification-startGenomeClassification} ms.
  `);
  return predictionsAggregate;
}

export async function getGenomeClassPredictions( 
    classificationModel, modelUrl,
    genome, duration, noteDelta, velocity,
    useGPU,
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors = true,
    antiAliasing = false
) {
  const {asNEATPatch, waveNetwork} = genome;
  const audioBuffer = await renderAudio(
    asNEATPatch, waveNetwork, duration, noteDelta, velocity,
    SAMPLE_RATE, // Essentia.js input extractor sample rate:  https://mtg.github.io/essentia.js/docs/api/machinelearning_tfjs_input_extractor.js.html#line-92
    false, // reverse
    true, // asDataArray
    offlineAudioContext,
    audioContext,
    useOvertoneInharmonicityFactors,
    useGPU,
    antiAliasing
  ).catch( e => console.error(`Error from renderAudio called form getGenomeClassPredictions, for genomem ${genome._id}`, e ) );
  let predictions;
  if( audioBuffer ) {
    const startGenomeClassPrediction = performance.now();
    predictions = await getAudioClassPredictions(
      audioBuffer, classificationModel, modelUrl, useGPU
    );
    const endGenomeClassPrediction = performance.now();
    if(ENVIRONMENT_IS_NODE && process.env.LOG_LEVEL === "debug") console.log(`Computing class predictions for genome ${genome._id} took ${endGenomeClassPrediction-startGenomeClassPrediction} ms.`);
  }
  return predictions;
}


///// classification from an audio buffer according to a declared classification model

export async function getAudioClassPredictions( audioBuffer, classificationModel, modelUrl, useGPU ) {
  try {
    switch (classificationModel) {
      // case "msd-musicnn-1":
      //   return getAudioClassesEssentiaJSTensorFlowJS( audioBuffer, "msd-musicnn-1", useGPU );
      // case "mtt-musicnn-1":
      //   return getAudioClassesEssentiaJSTensorFlowJS( audioBuffer, "mtt-musicnn-1", useGPU );
      case "yamnet":
        return getAudioClassesTensorFlowJS( audioBuffer, "yamnet", modelUrl, useGPU );
      default:
    }
  } catch (e) {
    // assuming we got here due to a GPU error, let's try to reload as a resolution:
    // location.reload();
  }
}

function getAudioClassPredictionsCombinedFromExternalClassifiers(
  batchIterationResults,
  classifiers
) {
  for( let oneClassifier of classifiers ) {
    switch (oneClassifier) {
      case "yamnet-tensorflow-python":
        // TODO call python script with batchIterationResults
        break;
      case "dcase-2023-task-7-tensorflow-python":
        // TODO call python script with batchIterationResults
        break;
      default:
        break;
    }
  }
  return batchIterationResults;
}

/* TODO fix (ES) module format issues
function getAudioClassesEssentiaJSTensorFlowJS( audioBuffer, classificationModel, useGPU = true ) {
  return new Promise( async (resolve) => {
    const audioData = audioBuffer.getChannelData(0);

    let taggedPredictions;
    if( _useWorkers ) {
      const featureExtractionAndInferenceWorker = await spawn(new Worker("../workers/audio-classification/audio-feature-extraction-and-inference-worker.js"));
      taggedPredictions = await featureExtractionAndInferenceWorker( Transfer(audioData.buffer), classificationModel, useGPU );
      await Thread.terminate(featureExtractionAndInferenceWorker);
    } else {
      taggedPredictions = await featureExtractionAndInference( audioData, classificationModel, useGPU );
    }
    resolve( taggedPredictions );

    // featureExtractionAndInferenceWorker.postMessage(
    //   {audioData, graphModel: classificationModel, useGPU},
    //   [audioData.buffer]
    // );
    // featureExtractionAndInferenceWorker.onmessage = (e) => {
    //   resolve( e.data );
    // };
    // featureExtractionAndInferenceWorker.onerror = (e) => {
    //   reject( e );
    // };
  });
}
*/

async function getAudioClassesTensorFlowJS( audioBuffer, classificationModel, modelUrl, useGPU = true ) {
  return new Promise( async (resolve) => {
    const audioData = audioBuffer;
    let taggedPredictions;
    if( _useWorkers ) {
      const getTaggedPredictionsWorker = await spawn(new Worker("../workers/audio-classification/yamnet-worker.js"));
      taggedPredictions = await getTaggedPredictionsWorker( Transfer(audioData.buffer), classificationModel, modelUrl, useGPU );
      await Thread.terminate(getTaggedPredictionsWorker);
    } else {
      taggedPredictions = await getTaggedPredictions( audioData, classificationModel, modelUrl, useGPU );
    }
    resolve( taggedPredictions );

    // yamnetAudioClassificationWorker.postMessage(
    //   {audioData, graphModel: classificationModel, useGPU},
    //   [audioData.buffer]
    // );
    // yamnetAudioClassificationWorker.onmessage = (e) => {
    //   resolve( e.data );
    // };
    // yamnetAudioClassificationWorker.onerror = (e) => {
    //   reject( e );
    // };
  }).catch( e => console.error(e) );
}


function getAudioContext() {
	if( ! _audioCtx ) _audioCtx = new AudioContext({sampleRate: SAMPLE_RATE});
	return _audioCtx;
}