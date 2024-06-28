
var ns = {};

// TODO: review if Web Audio API (context) is really needed
let audioContext;
if( typeof window === 'undefined' ) { // Node.js
  // const NodeWebAudioAPI = await import('node-web-audio-api');
  // console.log("NodeWebAudioAPI",NodeWebAudioAPI);
  // const { AudioContext } = NodeWebAudioAPI.default;
  // console.log("AudioContext",AudioContext);
  // ns.context = new AudioContext();
  ns.context = function() {this.supported = false;};
} else {
  ns.context = new (window.AudioContext || window.webkitAudioContext || function() {this.supported = false;})();
}
// TODO: ?
// if (typeof ns.context.supported === 'undefined')
//   ns.context.supported = true;

let offlineAudioContext
if( typeof window === 'undefined' ) { // Node.js
  // const NodeWebAudioAPI = await import('node-web-audio-api');
  // const { OfflineAudioContext } = NodeWebAudioAPI;
  // offlineAudioContext = OfflineAudioContext;
  offlineAudioContext = function() {this.supported = false;};
} else {
  offlineAudioContext = window.OfflineAudioContext ||
    window.webkitOfflineAudioContext ||
    function() {this.supported = false;};
}

// only create the gain if context is found
// (helps on tests)
if (ns.context.supported) {
  ns.globalGain = ns.context.createGain();
  ns.globalGain.gain.value = 0.5;
  ns.globalGain.connect(ns.context.destination);
}

// A list of all created outNodes, so they can all be reset
// from one place if needed (hard panic reset)
ns.OutNodes = [];
// ns.resetOutNodes = function() {
//   _.forEach(ns.OutNodes, function(outNode) {
//     outNode.resetLocalGain();
//   });
// };
// ns.resetOutNodes();

/**
  Get a new usable offlineContext since you can only
  render a single time for each one (aka, can't reuse)
*/
ns.createOfflineContextAndGain = function() {
  var offlineContext = new offlineAudioContext(2, 10 * 44100, 44100),
      offlineGlobalGain;
  if (typeof offlineContext.supported === 'undefined')
    offlineContext.supported = true;

  if (offlineContext.supported) {
    offlineGlobalGain = offlineContext.createGain();
    offlineGlobalGain.gain.value = ns.globalGain.gain.value;
    offlineGlobalGain.connect(offlineContext.destination);
  }

  return {
    context: offlineContext,
    globalGain: offlineGlobalGain
  };
};

// All the registered usable nodes
// TODO: Give weights for selection in mutation?
ns.nodeTypes = [
  'gainNode',
  'filterNode',
  'delayNode',
  'feedbackDelayNode',

  //'pannerNode' // Implemented, but doesn't do much without other mutations

  'compressorNode',
  'convolverNode',

  'waveShaperNode',
  'networkOutputNode',
  'noteNetworkOutputNode',
  'wavetableNode',
  'additiveNode',
  'audioBufferSourceNode',

  //wave shaper node? // like distortion? eq?
];

export default ns;
