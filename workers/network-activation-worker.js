import Activator from '../cppn-neat/network-activation.js';

const ActivationSubWorker = require("worker!./network-activation-sub-worker.js");

/**
 * This worker currently not in use.
 * Initially used for single threaded network activation *or* (optionally via message parameter)
 * multi threaded activation by spawning multiple sub-workers;
 * unfortunately, Chrome / Safari don't currently support spawner sub-workers
 * from a web worker - Firefox does - so the rendering action getOutputsForMember
 * spawns multiple workers directly, using network-activation-sub-worker.js
 */

const numWorkers = 4;
const pendingWorkers = {};
const subResults = {};
function storeSubResult(e) {
  console.log("got sub results: ", e.data);
  subResults[getTaskKey(e)][e.data.slice] = e.data.memberOutputs;
  pendingWorkers[getTaskKey(e)] -= 1;
  if( pendingWorkers[getTaskKey(e)] <= 0 ) {
    // TODO: combine memberOutputs in subResults to one memberOutputs object
    // then, postMessage({..., memberOutputs})
  }
}

onmessage = function(e) {
  console.log('Message received from main script');
  console.log('data from message: ', e.data );

  if( e.data.multicoreComputation ) {

    // split .frameCount into subsets and hand over to subworkers:
    pendingWorkers[getTaskKey(e)] = numWorkers;
    subResults[getTaskKey(e)] = {};
    const samplesPerWorker = Math.round( e.data.frameCount / numWorkers );
    for( let i=0; i < numWorkers; i+=1 ) {
      const sampleOffset = i * samplesPerWorker;
      let sampleCountToActivate;
      if( sampleOffset + samplesPerWorker > e.data.frameCount ) {
        sampleCountToActivate = e.data.frameCount - sampleOffset;
      } else {
        sampleCountToActivate = samplesPerWorker;
      }

      const activationSubWorker = new ActivationSubWorker();
      // console.log("Worker: ", Worker);
      // const activationSubWorker = new self.Worker('network-activation-sub-worker.js');
      activationSubWorker.postMessage({
        slice: i,
        populationIndex: e.data.populationIndex,
        memberIndex: e.data.memberIndex,
        frameCount: e.data.frameCount,
        sampleRate: e.data.sampleRate,
        member: e.data.member,
        currentPatch: e.data.currentPatch,
        sampleCountToActivate,
        sampleOffset
      });
      activationSubWorker.onmessage = storeSubResult;
    }

  } else {

    const activator = new Activator( e.data.frameCount, e.data.sampleRate );
    console.log("about to activateMember");
    activator.activateMember( e.data.member, e.data.currentPatch )
    .then( memberOutputs => {
      console.log("done activating, memberOutputs: ", memberOutputs);
      console.log("transferables: ", [...memberOutputs.values()].map( oneOutput => oneOutput.samples.buffer ) );
      postMessage({
        startSending: performance.now(),
        populationIndex: e.data.populationIndex,
        memberIndex: e.data.memberIndex,
        memberOutputs
      }
      , [...memberOutputs.values()].map( oneOutput => oneOutput.samples.buffer ) /*<- transfer list*/
      );
    });
  }

}

function getTaskKey( event ) {
  return `${event.data.populationIndex}-${event.data.memberIndex}`;
}
