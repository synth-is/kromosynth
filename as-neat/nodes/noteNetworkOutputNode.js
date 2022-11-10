import Utils from '../utils.js';
import Node from './node.js';
import NetworkOutputNode from './networkOutputNode.js';
import _ from "lodash-es";

let name = "NoteNetworkOutputNode";
/**
  An NetworkOutputNode that clamps its frequency to an
  equal tempered scale
*/
var NoteNetworkOutputNode = function(parameters) {
  Node.call(this, parameters);
  if (typeof this.type === 'string') {
    this.type = NetworkOutputNode.TYPES.indexFor(this.type);
  }
};

NoteNetworkOutputNode.prototype = Object.create(Node.prototype);
NoteNetworkOutputNode.prototype.name = name;
NoteNetworkOutputNode.prototype.defaultParameters = {
  name: name,

  type: 0,

  // TODO: for now, let's store frequency, though this node originally
  // uses stepFromRootNote, which might anyways be too limiting,
  // e.g. when it comes to microtonality.
  frequency: 440,

  // Offset from root (currently A4=440) to play
  // @note This parameter isn't evolved but is useful when
  // playing a set note from either an onscreen or MIDI keyboard
  stepFromRootNote: 0,

  // offset from note determined by root_stepFromRootNote
  noteOffset: 0,

  // ADSR model
  attackDuration: 0.2,
  decayDuration: 0.4,
  releaseDuration: 0.2,

  // For single playback
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
      name: 'noteOffset',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [1, 4], max: [5, 15]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: -20, max: 20},
      randomMutationRange: {min: -20, max: 20},
      discreteMutation: true
    },{
      name: 'attackDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'decayDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'releaseDuration',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      allowDeltaInverse: true,
      mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
      randomMutationRange: {min: 0.01, max: 1.0}
    },{
      name: 'attackVolume',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
      mutationDeltaAllowableRange: {min: 0.5, max: 1.5},
      allowDeltaInverse: true,
      randomMutationRange: {min: 0.5, max: 1.5}
    }
  ],
  connectableParameters: [
    // {
    //   name: "detune",
    //   nodeName: "oscNode",
    //   deltaRange: {min: [10, 200], max: [300, 1100]},
    //   mutationDeltaAllowableRange: {min: -1200, max: 1200},
    //   randomRange: {min: -1200, max: 1200}
    // },
    // {
    //   name: "playbackRate",
    //   nodeName: "oscNode",
    //   deltaRange: {min: [0, 4], max: [6, 12]},
    //   mutationDeltaAllowableRange: {min: 0, max: 12},
    //   randomRange: {min: 0, max: 12}
    // }
    // {
    //   name: "frequency",
    //   nodeName: "oscNode",
    //   deltaRange: {min: [10, 200], max: [300, 700]},
    //   mutationDeltaAllowableRange: {min: -2000, max: 2000},
    //   randomRange: {min: -2000, max: 2000}
    // }
  ]
};

NoteNetworkOutputNode.prototype.clone = function() {
  return new NoteNetworkOutputNode({
    id: this.id,
    type: this.type,
    noteOffset: this.noteOffset,
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume,
    mutatableParameters: _.cloneDeep(this.mutatableParameters)
  });
};

NoteNetworkOutputNode.prototype.refresh = function(contextPair) {
  refresh.call(this, contextPair);
};
NoteNetworkOutputNode.prototype.offlineRefresh = function(contextPair) {
  refresh.call(this, contextPair, "offline");
};

function refresh(contextPair, prefix) {
  var oscillator = contextPair.context.createOscillator();
  oscillator.type = NetworkOutputNode.TYPES[this.type];
  oscillator.frequency.value = Utils.frequencyOfStepsFromRootNote(
      this.stepFromRootNote + this.noteOffset);
  var gainNode = contextPair.context.createGain();
  oscillator.connect(gainNode);

  var oscName = prefix ? (prefix + 'OscNode') : 'oscNode';
  var nodeName = prefix ? (prefix + 'Node') : 'node';
  this[oscName] = oscillator;
  this[nodeName] = gainNode;
}

NoteNetworkOutputNode.prototype.play = function(context, delayTime) {
  var gainNode = this.node,
      oscNode = this.oscNode;
  play.call(this, context, gainNode, oscNode, delayTime);
};

NoteNetworkOutputNode.prototype.offlinePlay = function(context) {
  var gainNode = this.offlineNode,
      oscNode = this.offlineOscNode;
  play.call(this, context, gainNode, oscNode);
};

function play(context, gainNode, oscNode, delayTime) {
  var self = this,
      waitTime = this.attackDuration + this.decayDuration + this.sustainDuration,
      attackVolume = this.attackVolume,
      attackDuration = this.attackDuration,
      sustainVolume = this.sustainVolume,
      decayDuration = this.decayDuration,
      releaseDuration = this.releaseDuration;
  if (typeof delayTime === 'undefined') delayTime = 0;
  NetworkOutputNode.setupEnvelope(context, gainNode, oscNode,
    attackVolume, attackDuration, sustainVolume, decayDuration, delayTime);

  var timeToRelease = context.currentTime + waitTime;
  NetworkOutputNode.setupRelease(context, timeToRelease, gainNode, oscNode,
    releaseDuration, delayTime);
}

/**
  Plays a note until the return handler is called
  @return function stop
**/
NoteNetworkOutputNode.prototype.playHold = function(context) {
  var self = this,
      waitTime = this.attackDuration + this.decayDuration + this.sustainDuration,
      gainNode = this.node,
      oscNode = this.oscNode,
      attackVolume = this.attackVolume,
      attackDuration = this.attackDuration,
      sustainVolume = this.sustainVolume,
      decayDuration = this.decayDuration,
      releaseDuration = this.releaseDuration;
  NetworkOutputNode.setupEnvelope(context, gainNode, oscNode,
    attackVolume, attackDuration, sustainVolume, decayDuration);
  return function stop() {
    var timeToRelease = context.currentTime;
    NetworkOutputNode.setupRelease(context, timeToRelease, gainNode, oscNode, releaseDuration);
  };
};

NoteNetworkOutputNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    type: NetworkOutputNode.TYPES.nameFor(this.type),
    noteOffset: this.noteOffset,
    frequency: this.frequency,
    //note: Utils.noteForFrequency(
    //        Utils.frequencyOfStepsFromRootNote(
    //          this.noteOffset)),
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume
  };
};

NoteNetworkOutputNode.prototype.toString = function() {
  return this.id+": NoteNetworkOutputNode("+this.type+","+this.noteOffset+
    ", ADSR: "+this.attackDuration.toFixed(2)+" ("+this.attackVolume.toFixed(2)+"), "+
             this.decayDuration.toFixed(2)+", "+
             this.sustainDuration.toFixed(2)+" ("+this.sustainVolume.toFixed(2)+"), "+
             this.releaseDuration.toFixed(2)+")";
};

NoteNetworkOutputNode.random = function() {
  var typeI = Utils.randomIndexIn(0,NetworkOutputNode.TYPES.length),
      noteOffset = Utils.randomIndexIn(-20, 20),
      attackDuration = Utils.randomIn(0.01, 1.0),
      decayDuration = Utils.randomIn(0.01, 1.0),
      releaseDuration = Utils.randomIn(0.01, 1.0),
      sustainDuration = Utils.randomIn(0.1, 1.0),
      attackVolume = Utils.randomIn(0.5, 1.5);

  // noteOffset - # of steps from the root note (default A4=440hz) on a tempered scale.
  // Q - 1, with a nominal range of 0.0001 to 1000.
  // gain - 0, with a nominal range of -40 to 40.

  return new NoteNetworkOutputNode({
    type: NetworkOutputNode.TYPES[typeI],
    noteOffset: noteOffset,
    attackDuration: attackDuration,
    decayDuration: decayDuration,
    releaseDuration: releaseDuration,
    sustainDuration: sustainDuration,
    attackVolume: attackVolume
  });
};

export default NoteNetworkOutputNode;
