
import Utils from'../utils';
import Node from './node';
import asNEAT from '../asNEAT';
import _ from "lodash";

let { context } = asNEAT,
    name = "AudioBufferSourceNode";

var AudioBufferSourceNode = function(parameters) {
  Node.call(this, parameters);
};

AudioBufferSourceNode.prototype = Object.create(Node.prototype);
AudioBufferSourceNode.prototype.name = name;
AudioBufferSourceNode.prototype.defaultParameters = {
  buffer: null,
  detune: 0,
  playbackRate: 0,

  connectableParameters: [
    {
      name: 'buffer',
      randomRange: {min: -1, max: 1},
      // TODO: deltaRange and mutationDeltaAllowableRange doesn't seem to make sense here
      // - is it a problem to ommit those?
    }
  ]
  // TODO: detune and playbackRate connectable and/or mutable ?
};

AudioBufferSourceNode.prototype.clone = function() {
  return new AudioBufferSourceNode({
    id: this.id,
    buffer: this.buffer,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};


AudioBufferSourceNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

AudioBufferSourceNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  // TODO: multiple buffers or should this one buffer be considered a placeholder for all incoming connections?
  var node = contextPair.context.createBufferSource();
  node.buffer = this.buffer;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

AudioBufferSourceNode.prototype.getParameters = function() {
  // TODO: How to serialize the buffer? Will be different each
  // time it's created
  return {
    name: name,
    id: this.id
  };
};

AudioBufferSourceNode.prototype.toString = function() {
  return this.id+": AudioBufferSourceNode()";
};

/*
  @return a AudioBufferSourceNode
*/
AudioBufferSourceNode.random = function() {
  return new AudioBufferSourceNode();
};

export default AudioBufferSourceNode;
