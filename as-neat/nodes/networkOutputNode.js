
import Utils from '../utils.js';
import Node from './node.js';
import _ from "lodash-es";

let name = "NetworkOutputNode",
    utils = {},
    A0 = 27.5,
    C6 = 1046.5,
    C8 = 4186.0;

var NetworkOutputNode = function(parameters) {
  Node.call(this, parameters);
  if (typeof this.type === 'string') {
    this.type = NetworkOutputNode.TYPES.indexFor(this.type);
  }
};

NetworkOutputNode.prototype = Object.create(Node.prototype);
NetworkOutputNode.prototype.name = name;

NetworkOutputNode.prototype.defaultParameters = {
  type: 0,
  frequency: 1000,

  // ADSR model
  attackDuration: 0.2,
  decayDuration: 0.4,
  releaseDuration: 0.2,
  sustainDuration: 0.5,
  attackVolume: 1.1,
  sustainVolume: 1.0,

  mutatableParameters: [
    {
      name: 'type', // synth.is network output number
      mutationDeltaChance: 0,
      randomMutationRange: {min: 0, max: 21},
      allowRandomInverse: false,
      discreteMutation: true
    },{
      name: 'frequency',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [10, 200], max: [50, 800]},
      mutationDeltaAllowableRange: {min: C6*-1, max: C6},
      allowDeltaInverse: true,
      randomMutationRange: {min: A0, max: C6}
    },{
      name: 'attackDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'decayDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'releaseDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'attackVolume',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.5, max: 1.5}
    }
  ],
  connectableParameters: [
    // {
    //   name: "frequency",
    //   nodeName: "oscNode",
    //   deltaRange: {min: [10, 200], max: [300, 700]},
    //   mutationDeltaAllowableRange: {min: -2000, max: 2000},
    //   randomRange: {min: -2000, max: 2000}
    // }
  ] // detune and playbackRate will be connectable on the corresponding AudioBufferSourceNode
};

NetworkOutputNode.prototype.clone = function() {
  return new NetworkOutputNode({
    id: this.id,
    type: this.type,
    frequency: this.frequency,
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

// Refreshes the cached node to be played again
NetworkOutputNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};

NetworkOutputNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  // TODO (synth.is), switch out for AudioBufferSourceNode ?
  var oscillator = contextPair.context.createOscillator();
  oscillator.type = "sine"; // not using the oscillator here for now, so just fix it at "sine" ... NetworkOutputNode.TYPES[this.type];
  oscillator.frequency.value = this.frequency;
  var gainNode = contextPair.context.createGain();
  oscillator.connect(gainNode);

  var oscName = prefix ? (prefix + 'OscNode') : 'oscNode';
  var nodeName = prefix ? (prefix + 'Node') : 'node';
  this[oscName] = oscillator;
  this[nodeName] = gainNode;
}

NetworkOutputNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    type: NetworkOutputNode.TYPES.nameFor(this.type),
    frequency: this.frequency,
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume
  };
};

NetworkOutputNode.prototype.toString = function() {
  return this.id+": NetworkOutputNode(t:"+this.type+", f:"+this.frequency.toFixed(2)+
    ", ADSR: "+this.attackDuration.toFixed(2)+" ("+this.attackVolume.toFixed(2)+"), "+
             this.decayDuration.toFixed(2)+", "+
             this.sustainDuration.toFixed(2)+" ("+this.sustainVolume.toFixed(2)+"), "+
             this.releaseDuration.toFixed(2)+")";
};


NetworkOutputNode.TYPES = [
  "0",  // synth.is network outputs
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "noiseWhite",
  "noisePink",
  "noiseBrown",
];
NetworkOutputNode.TYPES.nameFor = function(type) {
  if (typeof type ==="string") return type;
  return NetworkOutputNode.TYPES[type];
};
NetworkOutputNode.TYPES.indexFor = function(type) {
  return _.indexOf(NetworkOutputNode.TYPES, type);
};
NetworkOutputNode.random = function( includeNoise ) {
  var typeI = Utils.randomIndexIn(0, includeNoise ? NetworkOutputNode.TYPES.length : NetworkOutputNode.TYPES.length - 3),
      freq = Utils.randomIn(A0, C6),
      attackDuration = Utils.randomIn(0.01, 1.0),
      decayDuration = Utils.randomIn(0.01, 1.0),
      releaseDuration = Utils.randomIn(0.01, 1.0),
      sustainDuration = Utils.randomIn(0.1, 1.0),
      attackVolume = Utils.randomIn(0.5, 1.5);

  // From w3 spec
  // frequency - 350Hz, with a nominal range of 10 to the Nyquist frequency (half the sample-rate).
  // Q - 1, with a nominal range of 0.0001 to 1000.
  // gain - 0, with a nominal range of -40 to 40.

  return new NetworkOutputNode({
    type: NetworkOutputNode.TYPES[typeI],
    frequency: freq,
    attackDuration: attackDuration,
    decayDuration: decayDuration,
    releaseDuration: releaseDuration,
    sustainDuration: sustainDuration,
    attackVolume: attackVolume
  });
};

// All params passed in in case the calling oscillator has changed its parameters before releasing the osc
NetworkOutputNode.setupEnvelope = function(
  context, gainNode, oscNode, attackVolume, attackDuration,
  sustainVolume, decayDuration, delayTime)
{
  var time = context.currentTime;
  if (typeof delayTime === 'undefined') delayTime = 0;
  gainNode.gain.cancelScheduledValues(time);
  gainNode.gain.value = 1.0;
  gainNode.gain.setValueAtTime(0, delayTime + time);
  gainNode.gain.linearRampToValueAtTime(attackVolume, delayTime + time + attackDuration);
  gainNode.gain.linearRampToValueAtTime(sustainVolume, delayTime + time + attackDuration + decayDuration);
  oscNode.start(delayTime + time);
};

/**
  @param context
  @param releaseTime (in seconds)
  @Param gainNode
  @param oscNode
  @param releaseDuration
*/
NetworkOutputNode.setupRelease = function(
  context, releaseTime, gainNode, oscNode,
  releaseDuration, delayTime)
{
  var currentTime = context.currentTime;
  if (typeof delayTime === 'undefined') delayTime = 0;
  if (delayTime + releaseTime <= currentTime)
    gainNode.gain.cancelScheduledValues(0);

  gainNode.gain.setValueAtTime(gainNode.gain.value, delayTime + releaseTime);
  gainNode.gain.linearRampToValueAtTime(0, delayTime + releaseTime + releaseDuration);
  oscNode.stop(delayTime + releaseTime + releaseDuration);
};

export default NetworkOutputNode;
