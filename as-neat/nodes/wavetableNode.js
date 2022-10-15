
import Utils from '../utils';
import Node from './node';
import context from '../asNEAT';
import _ from "lodash";

let name = "WavetableNode";

var WavetableNode = function(parameters) {
  Node.call(this, parameters);
};

WavetableNode.prototype = Object.create(Node.prototype);
WavetableNode.prototype.name = name;
WavetableNode.prototype.defaultParameters = {
  mix: null,
  buffer: null,

  // TODO: multiple buffers or should this one buffer be considered a placeholder for all incoming connections?
  connectableParameters: [
    {
      name: 'mix',
      randomRange: {min: 0, max: 1},
      // ...
    },
    {
      name: 'buffer',
      randomRange: {min: 0, max: 1},
      // TODO: deltaRange and mutationDeltaAllowableRange doesn't seem to make sense here
      // - is it a problem to ommit those?
    }
  ]
};

WavetableNode.prototype.clone = function() {
  return new WavetableNode({
    id: this.id,
    mix: this.mix,
    buffer: this.buffer,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};


WavetableNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

WavetableNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  // TODO: multiple buffers or should this one buffer be considered a placeholder for all incoming connections?
  var node = contextPair.context.createBufferSource();
  node.buffer = this.buffer;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

WavetableNode.prototype.getParameters = function() {
  // TODO: How to serialize the buffer? Will be different each
  // time it's created
  return {
    name: name,
    id: this.id
  };
};

WavetableNode.prototype.toString = function() {
  return this.id+": WavetableNode()";
};

/*
  @return a WavetableNode
*/
WavetableNode.random = function() {
  return new WavetableNode();
};

export default WavetableNode;
