
import Utils from '../utils';
import Node from './node';

let name = "DelayNode";

var DelayNode = function(parameters) {
  Node.call(this, parameters);
};

DelayNode.prototype = Object.create(Node.prototype);
DelayNode.prototype.name = name;
DelayNode.prototype.defaultParameters = {
  // in seconds
  delayTime: 0,

  mutatableParameters: [
    {
      name: 'delayTime',
      // doesn't make sense to change type by a delta
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.05, 0.5], max: [0.1, 1]},
      mutationDeltaAllowableRange: {min: 0, max: 3},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.0, max: 3.0}
    }
  ]
};

DelayNode.prototype.clone = function() {
  return new DelayNode({
    id: this.id,
    delayTime: this.delayTime,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

// Refreshes the cached node to be played again
DelayNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

DelayNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var delayNode = contextPair.context.createDelay();
  delayNode.delayTime.value = this.delayTime;
  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = delayNode;
}

DelayNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    delayTime: this.delayTime
  };
};

DelayNode.prototype.toString = function() {
  return this.id+": DelayNode("+
    this.delayTime.toFixed(2)+")";
};

DelayNode.random = function() {
  return new DelayNode({
    delayTime: Utils.randomIn(0.0, 3.0)
  });
};

export default DelayNode;
