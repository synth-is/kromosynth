
import Utils from '../utils.js';
import Node from './node.js';
import _ from "lodash-es";

let name = "FilterNode",
    freqMin = 0,
    freqMax = 1500,
    qMin = 0.0001,
    qMax = 20,
    gainMin = -5,
    gainMax = 5
    ;

var FilterNode = function(parameters) {
  Node.call(this, parameters);
  if (typeof this.type === 'string') {
    this.type = FilterNode.TYPES.indexFor(this.type);
  }
};

FilterNode.prototype = Object.create(Node.prototype);
FilterNode.prototype.name = name;
FilterNode.prototype.defaultParameters = {
  type: 0,
  frequency: 500,
  detune: 0,
  q: 1,
  gain: 1,

  mutatableParameters: [{
      name: 'type',
      mutationDeltaChance: 0,
      randomMutationRange: {min: 0, max: 7},
      allowRandomInverse: false,
      discreteMutation: true
    },{
      name: 'frequency',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [10, 100], max: [300, 700]},
      mutationDeltaAllowableRange: {min: freqMin, max: freqMax},
      allowDeltaInverse: true,
      randomMutationRange: {min: freqMin, max: freqMax}
  }],
  connectableParameters: [
    {
      name: "frequency",
      deltaRange: {min: [10, 100], max: [300, 700]},
      randomRange: {min: freqMin, max: freqMax},
      mutationDeltaAllowableRange: {min: freqMin, max: freqMax},
    },{
      name: "Q",
      deltaRange: {min: [0.0001, 1], max: [3, 10]},
      randomRange: {min: qMin, max: qMax},
      mutationDeltaAllowableRange: {min: qMin, max: qMax},
    },{
      name: "gain",
      deltaRange: {min: [0.1, 1], max: [2, 6]},
      randomRange: {min: gainMin, max: gainMax},
      mutationDeltaAllowableRange: {min: gainMin, max: gainMax},
    }
  ]
  // TODO: (bthj) detune connectable and/or mutable?
};

FilterNode.prototype.clone = function() {
  return new FilterNode({
    id: this.id,
    type: this.type,
    frequency: this.frequency,
    detune: this.detune,
    q: this.q,
    gain: this.gain,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

// Refreshes the cached node to be played again
FilterNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

FilterNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var node = contextPair.context.createBiquadFilter();
  node.type = FilterNode.TYPES[this.type];
  node.frequency.value = this.frequency;
  node.detune.value = this.detune;
  node.Q.value = this.q;
  node.gain.value = this.gain;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

FilterNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    type: FilterNode.TYPES.nameFor(this.type),
    frequency: this.frequency,
    detune: this.detune,
    q: this.q,
    gain: this.gain,
  };
};

FilterNode.prototype.toString = function() {
  return this.id+": FilterNode("+this.type+","+this.frequency.toFixed(2)+")";
};

FilterNode.TYPES = [
  "lowpass",
  "highpass",
  "bandpass",
  "lowshelf",
  "highshelf",
  "peaking",
  "notch",
  "allpass"
];
FilterNode.TYPES.nameFor = function(type) {
  if (typeof type ==="string") return type;
  return FilterNode.TYPES[type];
};
FilterNode.TYPES.indexFor = function(type) {
  return _.indexOf(FilterNode.TYPES, type);
};
FilterNode.random = function() {
  var typeI = Utils.randomIndexIn(0,FilterNode.TYPES.length),
      // A0 to C8
      freq = Utils.randomIn(freqMin, freqMax),
      q = Utils.randomIn(qMin, qMax),
      gain = Utils.randomIn(gainMin, gainMax);

  // frequency - 350Hz, with a nominal range of 10 to the Nyquist frequency (half the sample-rate).
  // Q - 1, with a nominal range of 0.0001 to 1000.
  // gain - 0, with a nominal range of -40 to 40.

  return new FilterNode({
    type: FilterNode.TYPES[typeI],
    frequency: freq,
    // TODO: specefic ranges based on type
    q: q,
    gain: gain
    //detune: 0,
  });
};

export default FilterNode;
