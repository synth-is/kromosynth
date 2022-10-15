import Activator from '../cppn-neat/network-activation';

onmessage = function(e) {
  console.log('data from message to subworker: ', e.data );

  const activator = new Activator( e.data.sampleRate );
  activator.activateMember(
    e.data.member,
    e.data.currentPatch,
    e.data.outputsToActivate,
    e.data.totalSampleCount,
    e.data.sampleCountToActivate,
    e.data.sampleOffset,
    false, /* useGPU */
    false, /* reverse */
    true, /* variationOnPeriods */
    e.data.velocity
 ).then( memberOutputs => {
    postMessage({
      slice: e.data.slice,
      populationIndex: e.data.populationIndex,
      memberIndex: e.data.memberIndex,
      memberOutputs
    }
    , [...memberOutputs.values()].map( oneOutput => oneOutput.samples.buffer ) /*<- transfer list*/
    );
  });
}
