
import Utils from '../utils.js';
import Node from './node.js';
import context from '../asNEAT.js';
import _ from "lodash-es";

let name = "WaveShaperNode";

var WaveShaperNode = function(parameters) {
  Node.call(this, parameters);
};

WaveShaperNode.prototype = Object.create(Node.prototype);
WaveShaperNode.prototype.name = name;
WaveShaperNode.prototype.defaultParameters = {
  curve: null,

  // mutatableParameters: [
  //   {
  //     name: 'curve',
  //     mutationDeltaChance: 0.8,
  //     mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
  //     mutationDelta: {min: [0.02, 0.1], max: [0.2, 0.4]},
  //     allowDeltaInverse: true,
  //     mutationDeltaAllowableRange: {min: -1, max: 1},
  //     randomMutationRange: {min: 0.1, max: 1.0},
  //     allowRandomInverse:true
  //   }
  // ],
  connectableParameters: [
    {
      name: 'curve',
      deltaRange: {min: [0.1, 1], max: [2, 6]},
      randomRange: {min: -1, max: 1},
      mutationDeltaAllowableRange: {min: -1, max: 1},
    }
  ]
};

WaveShaperNode.prototype.clone = function() {
  return new WaveShaperNode({
    id: this.id,
    curve: this.curve,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};


WaveShaperNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

WaveShaperNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var node = contextPair.context.createWaveShaper();
  node.curve = this.curve;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

WaveShaperNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    curve: this.curve
  };
};

WaveShaperNode.prototype.toString = function() {
  return this.id+": WaveShaperNode()";
};

/*
  @return a WaveShaperNode
*/
WaveShaperNode.random = function() {
  return new WaveShaperNode();
};

export default WaveShaperNode;
