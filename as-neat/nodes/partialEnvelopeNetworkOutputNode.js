import Utils from '../utils.js';
import Node from './node.js';
import PartialNetworkOutputNode from './partialNetworkOutputNode.js';
import _ from "lodash-es";

let name = "PartialEnvelopeNetworkOutputNode";
/**
  An NetworkOutputNode that clamps its frequency to an
  equal tempered scale
*/
var PartialEnvelopeNetworkOutputNode = function(parameters) {
  Node.call(this, parameters);
  if (typeof this.type === 'string') {
    this.type = PartialNetworkOutputNode.TYPES.indexFor(this.type);
  }
};

PartialEnvelopeNetworkOutputNode.prototype = Object.create(Node.prototype);
PartialEnvelopeNetworkOutputNode.prototype.name = name;
PartialEnvelopeNetworkOutputNode.prototype.defaultParameters = {
  name: name,

  type: 0,

  frequency: 1,

  partialNumber: 1,

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
      randomMutationRange: {min: 0, max: 18},
      allowRandomInverse: false,
      discreteMutation: true
    },{
      name: 'frequency',
      mutationDeltaChance: 0.8,
      mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
      mutationDelta: {min: [1, 3], max: [5, 8]},
      mutationDeltaAllowableRange: {min: 1, max: 2000}, // TODO controllable?
      allowDeltaInverse: true,
      randomMutationRange: {min: 1, max: 2000},
      discreteMutation: false
    // },{
    //   name: 'attackDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   allowDeltaInverse: true,
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'decayDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   allowDeltaInverse: true,
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'releaseDuration',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   allowDeltaInverse: true,
    //   mutationDeltaAllowableRange: {min: 0.01, max: 1.0},
    //   randomMutationRange: {min: 0.01, max: 1.0}
    // },{
    //   name: 'attackVolume',
    //   mutationDeltaChance: 0.8,
    //   mutationDeltaInterpolationType: Utils.InterpolationType.EXPONENTIAL,
    //   mutationDelta: {min: [0.01, 0.05], max: [0.1, 0.3]},
    //   mutationDeltaAllowableRange: {min: 0.5, max: 1.5},
    //   allowDeltaInverse: true,
    //   randomMutationRange: {min: 0.5, max: 1.5}
    }
  ],
  connectableParameters: [
  ]
};

PartialEnvelopeNetworkOutputNode.prototype.clone = function() {
  return new PartialEnvelopeNetworkOutputNode({
    id: this.id,
    type: this.type,
    frequency: this.frequency,
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

PartialEnvelopeNetworkOutputNode.prototype.refresh = function(contextPair) {
  // NOOP
};
PartialEnvelopeNetworkOutputNode.prototype.offlineRefresh = function(contextPair) {
  // NOOP
};

PartialEnvelopeNetworkOutputNode.prototype.getParameters = function() {
  return {
    name: name,
    id: this.id,
    type: PartialNetworkOutputNode.TYPES.nameFor(this.type),
    frequency: this.frequency,
    partialNumber: this.partialNumber,
    attackDuration: this.attackDuration,
    decayDuration: this.decayDuration,
    releaseDuration: this.releaseDuration,
    sustainDuration: this.sustainDuration,
    attackVolume: this.attackVolume,
    sustainVolume: this.sustainVolume
  };
};

PartialEnvelopeNetworkOutputNode.prototype.toString = function() {
  return this.id+": PartialEnvelopeNetworkOutputNode("+this.type+","+
    ", ADSR: "+this.attackDuration.toFixed(2)+" ("+this.attackVolume.toFixed(2)+"), "+
             this.decayDuration.toFixed(2)+", "+
             this.sustainDuration.toFixed(2)+" ("+this.sustainVolume.toFixed(2)+"), "+
             this.releaseDuration.toFixed(2)+")";
};

PartialEnvelopeNetworkOutputNode.random = function( overtoneNr ) {
  var typeI = Utils.randomIndexIn(0, PartialNetworkOutputNode.TYPES.length),
      partialNumber = overtoneNr || 1,
      attackDuration = Utils.randomIn(0.01, 1.0),
      decayDuration = Utils.randomIn(0.01, 1.0),
      releaseDuration = Utils.randomIn(0.01, 1.0),
      sustainDuration = Utils.randomIn(0.1, 1.0),
      attackVolume = Utils.randomIn(0.5, 1.5);

  return new PartialEnvelopeNetworkOutputNode({
    type: PartialNetworkOutputNode.TYPES[typeI],
    partialNumber,
    attackDuration: attackDuration,
    decayDuration: decayDuration,
    releaseDuration: releaseDuration,
    sustainDuration: sustainDuration,
    attackVolume: attackVolume
  });
};

export default PartialEnvelopeNetworkOutputNode;
