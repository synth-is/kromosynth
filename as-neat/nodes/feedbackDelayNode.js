
import Utils from '../utils.js';
import Node from './node.js';
import _ from "lodash-es";

let name = "FeedbackDelayNode";

var FeedbackDelayNode = function(parameters) {
  Node.call(this, parameters);
};

FeedbackDelayNode.prototype = Object.create(Node.prototype);
FeedbackDelayNode.prototype.name = name;
FeedbackDelayNode.prototype.defaultParameters = {
  // in seconds
  delayTime: 0,

  // [0,1], although >=1 is allowed... not advised
  feedbackRatio: 0.2,

  mutatableParameters: [
    {
      name: 'delayTime',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.1, 0.4], max: [0.4, 0.8]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: 0, max: 3},
      randomMutationRange: {min: 0.0, max: 3.0}
    },{
      name: 'feedbackRatio',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.05, 0.1], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: -1, max: 1},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0, max: 0.6}
    }
  ]
};

FeedbackDelayNode.prototype.clone = function() {
  return new FeedbackDelayNode({
    id: this.id,
    delayTime: this.delayTime,
    feedbackRatio: this.feedbackRatio,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

FeedbackDelayNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

FeedbackDelayNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  // base passthrough gain
  var passthroughGain = contextPair.context.createGain();
  passthroughGain.gain.value = 1.0;

  var delayNode = contextPair.context.createDelay();
  delayNode.delayTime.value = this.delayTime;

  // add an additional gain node for 'delay' feedback
  var feedbackGainNode = contextPair.context.createGain();
  feedbackGainNode.gain.value = this.feedbackRatio;

  passthroughGain.connect(delayNode);
  delayNode.connect(feedbackGainNode);
  feedbackGainNode.connect(passthroughGain);

  var nodeName = prefix ? (prefix+'Node') : 'node';
  this[nodeName] = passthroughGain;
}


FeedbackDelayNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    delayTime: this.delayTime,
    feedbackRatio: this.feedbackRatio
  };
};

FeedbackDelayNode.prototype.toString = function() {
  return this.id+": FeedbackDelayNode("+
    this.delayTime.toFixed(2)+","+
    this.feedbackRatio.toFixed(2)+")";
};

FeedbackDelayNode.random = function() {
  return new FeedbackDelayNode({
    delayTime: Utils.randomIn(0.0, 3.0),
    feedbackRatio: Utils.randomIn(0, 0.6)
  });
};

export default FeedbackDelayNode;
