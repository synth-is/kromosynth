
import Utils from '../utils.js';
import Node from './node.js';

let name = "CompressorNode";

var CompressorNode = function(parameters) {
  Node.call(this, parameters);
};

CompressorNode.prototype = Object.create(Node.prototype);
CompressorNode.prototype.name = name;
CompressorNode.prototype.defaultParameters = {
  // The decibel value above which the compression will start taking effect.
  // Its default value is -24, with a nominal range of -100 to 0.
  threshold: 0,

  // A decibel value representing the range above the threshold where the curve
  // smoothly transitions to the "ratio" portion. Its default value is 30, with
  // a nominal range of 0 to 40.
  knee: 0,

  // The amount of dB change in input for a 1 dB change in output. Its default
  // value is 12, with a nominal range of 1 to 20.
  ratio: 0,

  // A read-only decibel value for metering purposes, representing the current
  // amount of gain reduction that the compressor is applying to the signal.
  // If fed no signal the value will be 0 (no gain reduction). The nominal range
  // is -20 to 0.
  reduction: 0,

  // The amount of time (in seconds) to reduce the gain by 10dB. Its default
  // value is 0.003, with a nominal range of 0 to 1.
  attack: 0,

  // The amount of time (in seconds) to increase the gain by 10dB. Its default
  // value is 0.250, with a nominal range of 0 to 1.
  release: 0,

  mutatableParameters: [
    {
      name: 'threshold',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [1, 10], max: [5, 15]},
      mutationDeltaAllowableRange: {min: -50, max: 0},
      allowDeltaInverse: true,
      randomMutationRange: {min: -50, max: 0}
    },{
      name: 'knee',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [1, 10], max: [5, 15]},
      mutationDeltaAllowableRange: {min: 0, max: 40},
      allowDeltaInverse: true,
      randomMutationRange: {min: 20, max: 40}
    },{
      name: 'ratio',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.5], max: [1, 4]},
      mutationDeltaAllowableRange: {min: 1, max: 20},
      allowDeltaInverse: true,
      randomMutationRange: {min: 8, max: 16}
    },{
      name: 'reduction',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.5], max: [1, 4]},
      mutationDeltaAllowableRange: {min: -20, max: 20},
      allowDeltaInverse: true,
      randomMutationRange: {min: -10, max: 0}
    },{
      name: 'attack',
      // doesn't make sense to change type by a delta
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.005, 0.05], max: [0.1, 0.2]},
      mutationDeltaAllowableRange: {min: 0, max: 1},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0, max: 0.5}
    },{
      name: 'release',
      // doesn't make sense to change type by a delta
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.005, 0.02], max: [0.01, 0.05]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: 0, max: 1},
      randomMutationRange: {min: 0, max: 0.1}
    }
  ]
};

CompressorNode.prototype.clone = function() {
  return new CompressorNode({
    id: this.id,
    threshold: this.threshold,
    knee: this.knee,
    ratio: this.ratio,
    reduction: this.reduction,
    attack: this.attack,
    release: this.release,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

// Refreshes the cached node to be played again
CompressorNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

CompressorNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var node = contextPair.context.createDynamicsCompressor();
  node.threshold.value = this.threshold;
  node.knee.value = this.knee;
  node.ratio.value = this.ratio;
  node.reduction.value = this.reduction;
  node.attack.value = this.attack;
  node.release.value = this.release;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

CompressorNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    threshold: this.threshold,
    knee: this.knee,
    ratio: this.ratio,
    reduction: this.reduction,
    attack: this.attack,
    release: this.release
  };
};

CompressorNode.prototype.toString = function() {
  return this.id+": CompressorNode("+
    this.threshold.toFixed(2)+","+
    this.knee.toFixed(2)+","+
    this.ratio.toFixed(2)+","+
    this.reduction.toFixed(2)+","+
    this.attack.toFixed(2)+","+
    this.release.toFixed(2)+")";
};

CompressorNode.random = function() {
  var threshold = Utils.randomIn(-50, 10),
      knee = Utils.randomIn(20, 40),
      ratio = Utils.randomIn(8, 16),
      reduction = Utils.randomIn(-10, 0),
      attack = Utils.randomIn(0, 0.1),
      release = Utils.randomIn(0, 0.1);

  return new CompressorNode({
    threshold: threshold,
    knee: knee,
    ratio: ratio,
    reduction: reduction,
    attack: attack,
    release: release
  });
};

export default CompressorNode;
