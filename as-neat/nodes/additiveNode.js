
import Node from './node.js';
import Utils from '../utils.js';
import _ from "lodash-es";

let name = "AdditiveNode",
  gainMin = 0.5,
  gainMax = 1.5;

var AdditiveNode = function(parameters) {
  Node.call(this, parameters);
};

AdditiveNode.prototype = Object.create(Node.prototype);
AdditiveNode.prototype.name = name;
AdditiveNode.prototype.defaultParameters = {
  // one buffer and envelopes are considered as placeholders for all incoming connections
  partialBuffer: null,
  partialGainEnvelope: null,
  
  gain: 1,

  // same as in GainNode
  mutatableParameters: [
    {
      name: 'gain',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.02, 0.1], max: [0.2, 0.4]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: -1*gainMax, max: gainMax},
      randomMutationRange: {min: gainMin, max: gainMax},
      allowRandomInverse:true
    }
  ],
  connectableParameters: [
    {
      name: 'gain',
      deltaRange: {min: [0.1, 0.3], max: [0.5, 1]},
      randomRange: {min: gainMin, max: gainMax},
      mutationDeltaAllowableRange: {min: 0.1, max: gainMax},
    },
    {
      name: 'partialBuffer',
      randomRange: {min: 0, max: 1},
      // ...
    },
    {
      name: 'partialGainEnvelope',
      randomRange: {min: 0, max: 1},
      // TODO: deltaRange and mutationDeltaAllowableRange doesn't seem to make sense here
      // - is it a problem to ommit those?
    }
  ]
};

AdditiveNode.prototype.clone = function() {
  return new AdditiveNode({
    id: this.id,
    partialBuffer: this.partialBuffer,
    partialGainEnvelope: this.partialGainEnvelope,
    gain: this.gain,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};


AdditiveNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

AdditiveNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  // TODO: multiple buffers or should this one buffer be considered a placeholder for all incoming connections?
  var node = contextPair.context.createBufferSource();
  node.buffer = this.buffer;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

AdditiveNode.prototype.getParameters = function() {
  // TODO: How to serialize the buffer? Will be different each
  // time it's created
  return {
    name: name,
    id: this.id
  };
};

AdditiveNode.prototype.toString = function() {
  return this.id+": AdditiveNode()";
};

/*
  @return a AdditiveNode
*/
AdditiveNode.random = function() {
  return new AdditiveNode();
};

export default AdditiveNode;
