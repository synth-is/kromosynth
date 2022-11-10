
import Utils from '../utils.js';
import Node from './node.js';
import asNEAT from '../asNEAT.js';
let {context} = asNEAT;
let name = "ConvolverNode";

var ConvolverNode = function(parameters) {
  Node.call(this, parameters);

  // TODO: Different types of convolution instead of just noise
  if (this.buffer === null && context.supported) {
    var noiseBuffer = context.createBuffer(2, 0.5 * context.sampleRate, context.sampleRate),
        left = noiseBuffer.getChannelData(0),
        right = noiseBuffer.getChannelData(1);

    for (var i = 0; i < noiseBuffer.length; i++) {
        left[i] = Math.random() * 2 - 1;
        right[i] = Math.random() * 2 - 1;
    }

    this.buffer = noiseBuffer;
  }

};

ConvolverNode.prototype = Object.create(Node.prototype);
ConvolverNode.prototype.name = name;
ConvolverNode.prototype.defaultParameters = {
  buffer: null,

  connectableParameters: [
    {
      name: 'buffer',
      randomRange: {min: -1, max: 1},
      // TODO: deltaRange and mutationDeltaAllowableRange doesn't seem to make sense here
      // - is it a problem to ommit those?
    }
  ]

  // TODO: ConvolverNode.NORMALIZE TRUE || FALSE ...sbr FilterNode.TYPES
};

ConvolverNode.prototype.clone = function() {
  return new ConvolverNode({
    id: this.id,
    buffer: this.buffer,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};


ConvolverNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

ConvolverNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var node = contextPair.context.createConvolver();
  node.buffer = this.buffer;

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = node;
}

ConvolverNode.prototype.getParameters = function() {
  // TODO: How to serialize the buffer? Will be different each
  // time it's created
  return {
    name: name,
    id: this.id
  };
};

ConvolverNode.prototype.toString = function() {
  return this.id+": ConvolverNode()";
};

/*
  @return a ConvolverNode
*/
ConvolverNode.random = function() {
  return new ConvolverNode();
};

export default ConvolverNode;
