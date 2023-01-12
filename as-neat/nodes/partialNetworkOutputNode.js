
import Utils from '../utils.js';
import Node from './node.js';
import _ from "lodash-es";

// Pretty much a copy of networkOutputNode; main change in frequency mutation range and non-noise type array

let name = "PartialNetworkOutputNode";

var PartialNetworkOutputNode = function(parameters) {
  Node.call(this, parameters);
  if (typeof this.type === 'string') {
    this.type = PartialNetworkOutputNode.TYPES.indexFor(this.type);
  }
};

PartialNetworkOutputNode.prototype = Object.create(Node.prototype);
PartialNetworkOutputNode.prototype.name = name;

PartialNetworkOutputNode.prototype.defaultParameters = {
  type: 0,
  frequency: 440,

  // partial 2 (first non-fundamental), represents a whole integer division of length L by L/2, etc.
  // inharmonicityFactor affects the frequency as a multiple of the fundamental frequency added or subtracted form the fundamental,
  // so for a fundamental frequency of 440, the harmonic partial 2 is 880, with a factor of 0.1 distorting it as:
  // 880 + ((880 / 2) * 0.1) = 924
  // and for partial 3 (second non-fundamental, 3 * 440 = 1320, factor of 0.1 distorts as:
  // 1320 + ((1320 / 3) * 0.1) = 1320 + (440 * 0.1) = 1364
  inharmonicityFactor: 0,

  partialNumber: 1,

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
      randomMutationRange: {min: 0, max: 18},
      allowRandomInverse: false,
      discreteMutation: true
    },{
      name: 'inharmonicityFactor',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.LINEAR,
      mutationDelta: {min: [0.01, 0.1], max: [0.1, 0.2]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: -1, max: 1},
      randomMutationRange: {min: -1, max: 1},
      discreteMutation: false
    // },{
    //   name: 'attackDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   allowDeltaInverse: true,
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'decayDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   allowDeltaInverse: true,
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'releaseDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   allowDeltaInverse: true,
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'attackVolume',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   allowDeltaInverse: true,
    //   randomMutationRange: {min: 0.5, max: 1.5}
    }
  ],
  connectableParameters: [
  ] // detune and playbackRate will be connectable on the corresponding AudioBufferSourceNode
};

PartialNetworkOutputNode.prototype.clone = function() {
  return new PartialNetworkOutputNode({
    id: this.id,
    type: this.type,
    frequency: this.frequency,
    inharmonicityFactor: this.inharmonicityFactor,
    partialNumber: this.partialNumber,
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
PartialNetworkOutputNode.prototype.refresh = function(contextPair) {
  // NOOP
};

PartialNetworkOutputNode.prototype.offlineRefresh = function(contextPair) {
  // NOOP
};

PartialNetworkOutputNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    type: PartialNetworkOutputNode.TYPES.nameFor(this.type),
    frequency: this.frequency,
    inharmonicityFactor: this.inharmonicityFactor,
    partialNumber: this.partialNumber,
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume
  };
};

PartialNetworkOutputNode.prototype.toString = function() {
  return this.id+": PartialNetworkOutputNode(t:"+this.type+", f:"+this.frequency.toFixed(2)+
    ", ADSR: "+this.attackDuration.toFixed(2)+" ("+this.attackVolume.toFixed(2)+"), "+
             this.decayDuration.toFixed(2)+", "+
             this.sustainDuration.toFixed(2)+" ("+this.sustainVolume.toFixed(2)+"), "+
             this.releaseDuration.toFixed(2)+")";
};


PartialNetworkOutputNode.TYPES = [
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
];
PartialNetworkOutputNode.TYPES.nameFor = function(type) {
  if (typeof type ==="string") return type;
  return PartialNetworkOutputNode.TYPES[type];
};
PartialNetworkOutputNode.TYPES.indexFor = function(type) {
  return _.indexOf(PartialNetworkOutputNode.TYPES, type);
};
PartialNetworkOutputNode.random = function( overtoneNr ) {
  var typeI = Utils.randomIndexIn(0, PartialNetworkOutputNode.TYPES.length),
      freq = 440, // not so random! - inharmonicityFactor will possibly affect any fundamental frequency in network-rendering
      inharmonicityFactor = 0,
      partialNumber = overtoneNr || 1,
      attackDuration = Utils.randomIn(0.01, 1.0),
      decayDuration = Utils.randomIn(0.01, 1.0),
      releaseDuration = Utils.randomIn(0.01, 1.0),
      sustainDuration = Utils.randomIn(0.1, 1.0),
      attackVolume = Utils.randomIn(0.5, 1.5);

  // From w3 spec
  // frequency - 350Hz, with a nominal range of 10 to the Nyquist frequency (half the sample-rate).
  // Q - 1, with a nominal range of 0.0001 to 1000.
  // gain - 0, with a nominal range of -40 to 40.

  return new PartialNetworkOutputNode({
    type: PartialNetworkOutputNode.TYPES[typeI],
    frequency: freq,
    inharmonicityFactor,
    partialNumber,
    attackDuration: attackDuration,
    decayDuration: decayDuration,
    releaseDuration: releaseDuration,
    sustainDuration: sustainDuration,
    attackVolume: attackVolume
  });
};

// All params passed in in case the calling oscillator has changed its parameters before releasing the osc
PartialNetworkOutputNode.setupEnvelope = function(
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
PartialNetworkOutputNode.setupRelease = function(
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

export default PartialNetworkOutputNode;
