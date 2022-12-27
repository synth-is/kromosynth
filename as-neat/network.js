
import Utils from './utils.js';
import NoteOscillatorNode from './nodes/noteOscillatorNode.js';
import OscillatorNode from './nodes/oscillatorNode.js';
import NetworkOutputNode from './nodes/networkOutputNode.js';
import NoteNetworkOutputNode from './nodes/noteNetworkOutputNode.js';
import AudioBufferSourceNode from './nodes/audioBufferSourceNode.js';
import WavetableNode from './nodes/wavetableNode.js';
import OutNode from './nodes/outNode.js';
import GainNode from './nodes/gainNode.js';
import Connection from './connection.js';
import asNEAT from './asNEAT.js';
import _ from "lodash-es";

var nodeTypes = asNEAT.nodeTypes,
    log = Utils.log,
    name = "Network";

asNEAT.globalOutNode = new OutNode();

var Network = function(parameters) {
  Utils.extend(this, this.defaultParameters, parameters);

  // {objectsChanged [], changeDescription string}
  this.lastMutation = null;

  // add a gain node and random choice between addAudioBufferSource or addOscillator
  if (this.nodes.length===0) {
    const initialGain = new GainNode({gain:1});

    this.nodes.push(initialGain);

    // let's add the oscillator or wavesorce node first, so it will connect to the gain node
    // - otherwise it might connect directly to outNode
    // (which might not be bad, but might also be good to have this innitial funnel)
    if( Utils.randomChance(0.5) ) {
      this.addOscillator();
    } else {
      this.addAudioBufferSource();
      this.addOscillator("NetworkOutputNode", true);
    }
    this.nodes.push(asNEAT.globalOutNode);
    this.connections.push(new Connection({
      sourceNode: this.nodes[0], // initialGain
      targetNode: this.nodes[this.nodes.length-1], // globalOutNode
      weight: 0.5
    }));

    // let's keep inline the history of the basic initialization, before the synth.is additions above:
    // // Create a basic onscillator without any offset to start
    // var osc = NoteOscillatorNode.random();
    // osc.noteOffset = 0;
    // this.nodes.push(asNEAT.globalOutNode);
    // this.nodes.push(osc);
  }
  if (this.connections.length===0) {
    this.connections.push(new Connection({
      sourceNode: this.nodes[1],
      targetNode: this.nodes[0],
      weight: 0.5
    }));
  }

  // Only generate a new id if one isn't given in the parameters
  if (parameters && typeof parameters.id !== 'undefined')
    this.id = parameters.id;
  else
    this.id = Utils.createHash();
};

Network.prototype.name = name;
Network.prototype.defaultParameters = {
  nodes: [],
  connections: [],

  // The generation of this network (incremented in Population)
  generation: 0,

  connectionMutationInterpolationType: Utils.InterpolationType.EXPONENTIAL,
  connectionMutationRate: [0.05, 0.8],

  nodeMutationInterpolationType: Utils.InterpolationType.EXPONENTIAL,
  nodeMutationRate: [0.05, 0.8],

  // percentage of addOscillatorMutations will
  // generate a node for fm, as opposed to strict audio output
  addOscillatorFMMutationRate: 0.5,

  // Percentage of addConnectionMutation will generate a connection
  // for fm, as opposed to a strict audio connection
  addConnectionFMMutationRate: 0.5,

  evolutionHistory: []
};
/*
  Creates a deep clone of this network
 */
Network.prototype.clone = function() {

  // Clone each node
  var clonedNodes = [];
  _.forEach(this.nodes, function(node) {
    clonedNodes.push(node.clone());
  });

  // Clone each connection
  var clonedConnections = [];
  _.forEach(this.connections, function(connection) {
    var clonedsourceNode = _.find(clonedNodes, {id: connection.sourceNode.id});
    var clonedtargetNode = _.find(clonedNodes, {id: connection.targetNode.id});
    clonedConnections.push(connection.clone(clonedsourceNode, clonedtargetNode));
  });

  return new Network({
    nodes: clonedNodes,
    connections: clonedConnections,
    generation: this.generation,
    connectionMutationInterpolationType: this.connectionMutationInterpolationType,
    connectionMutationRate: _.clone(this.connectionMutationRate),
    nodeMutationInterpolationType: this.nodeMutationInterpolationType,
    nodeMutationRate: _.clone(this.nodeMutationRate),
    evolutionHistory: _.clone(this.evolutionHistory)
  });
};
/**
  Creates a child network from this and the passed in otherNetwork
*/
Network.prototype.crossWith = function(otherNetwork) {
  var tNodes = this.nodes,
      oNodes = otherNetwork.nodes,
      tConnections = this.connections,
      oConnections = otherNetwork.connections,
      nodes = [], connections = [],
      newNetwork, tIndexes;

  function addNode(node, i) {
    var newNode = node.clone();
    if (typeof i === 'undefined') {
      nodes.push(newNode);
      tIndexes[node.id]=nodes.length-1;
    }
    else
      nodes[i] = newNode;
  }
  function addConnection(connection, i) {
    var source = _.find(nodes, {id: connection.sourceNode.id}),
        target = _.find(nodes, {id: connection.targetNode.id}),
        newConn = connection.clone(source, target);
    if (typeof i === 'undefined') {
      connections.push(newConn);
      tIndexes[connection.id]=connections.length-1;
    }
    else
      connections[i] = newConn;
  }

  // Add all of tElements first, then loop through and add
  // any oElements not in tElements or 50/50 chance.
  // This destroys 'creation order' of the nodes/connections
  // but doesn't matter
  function addElements(tElements, oElements, addHandler) {
    tIndexes = {};
    _.forEach(tElements, function(element) {
      addHandler(element);
    });
    _.forEach(oElements, function(element) {
      var i = tIndexes[element.id];
      // not found, then just push it in
      if (typeof i === "undefined")
        addHandler(element);
      // otherwise, 50/50 of using oNode
      else if (Utils.randomBool())
        addHandler(element, i);
    });
  }

  addElements(tNodes, oNodes, addNode);
  addElements(tConnections, oConnections, addConnection);

  newNetwork = new Network({
    nodes: nodes,
    connections: connections,
    generation: Math.max(this.generation, otherNetwork.generation),
    evolutionHistory: this.evolutionHistory.concat(otherNetwork.evolutionHistory)
  });
  newNetwork.lastMutation = {
    // TODO: Highlight changed objects? maybe add in blue for first parent, red for other?
    objectsChanged: [],
    changeDescription: "Crossed instruments "+this.id+" & "+otherNetwork.id
  };
  updateObjectsInMutation(newNetwork.lastMutation);
  newNetwork.addToEvolutionHistory(EvolutionTypes.CROSSOVER);

  return newNetwork;
};

/**
  @param afterPrepHandler (optional) Called after all the nodes are refreshed and connected
    but before they are played.
*/
// Network.prototype.play = function(afterPrepHandler, delayTime) {
//   var context = asNEAT.context;
//   playPrep.call(this, afterPrepHandler);
//
//   // play the oscillators
//   _.forEach(this.nodes, function(node) {
//     if (node.play)
//       node.play(context, delayTime);
//   });
//
//   return this;
// };

/**
  Plays the network until the return handler is called
  @param afterPrepHandler (optional) Called after all the nodes are refreshed and connected
    but before they are played.
  @return function stop
**/
// Network.prototype.playHold = function(afterPrepHandler) {
//   var context = asNEAT.context;
//   playPrep.call(this, afterPrepHandler);
//
//   var stopHandlers = [];
//
//   // play the oscillators
//   _.forEach(this.nodes, function(node) {
//     if (node.playHold)
//       stopHandlers.push(node.playHold(context));
//   });
//
//   return function stop() {
//     _.forEach(stopHandlers, function(handler) {
//       handler();
//     });
//   };
// };

/**
  @param callback function(AudioBuffer)
  @param afterPrepHandler (optional) Called after all the nodes are refreshed and connected
    but before they are played.
*/
// Network.prototype.offlinePlay = function(callback, afterPrepHandler) {
//   var contextPair = asNEAT.createOfflineContextAndGain();
//   playPrep.call(this, afterPrepHandler, contextPair, "offlineRefresh", "offlineConnect");
//   // play the offline oscillators
//   _.forEach(this.nodes, function(node) {
//     if (node.offlinePlay)
//       node.offlinePlay(contextPair.context);
//   });
//
//   contextPair.context.oncomplete = function(e) {
//     if (typeof callback === "function")
//       callback(e.renderedBuffer);
//   };
//   // TODO: Change to promise once implemented in browsers
//   contextPair.context.startRendering();
// };

/**
  @param afterPrepHandler Called after all the nodes are refreshed and connected
    but before they are played.
  @param contextPair {context, globalGain}
  @param refreshHandlerName string
  @param connectHandlerName string
*/
// function playPrep(afterPrepHandler, contextPair, refreshHandlerName, connectHandlerName) {
//   contextPair = contextPair || {
//     context: asNEAT.context,
//     globalGain: asNEAT.globalGain
//   };
//   refreshHandlerName = refreshHandlerName || "refresh";
//   connectHandlerName = connectHandlerName || "connect";
//
//   // refresh all the nodes since each can only play
//   // once (note: changing in the current webAudio draft)
//   _.forEach(this.nodes, function(node) {
//     node[refreshHandlerName](contextPair);
//   });
//
//   // setup all the connections
//   _.forEach(this.connections, function(connection) {
//     connection[connectHandlerName](contextPair);
//   });
//
//   if (typeof afterPrepHandler === "function")
//     afterPrepHandler(contextPair);
// }

/**
 * The various types of mutations listed in evolutionHistory
 * @type {{SPLIT_MUTATION: string, ADD_OSCILLATOR: string, ADD_CONNECTION: string, MUTATE_CONNECTION_WEIGHTS: string, MUTATE_NODE_PARAMETERS: string, CROSSOVER: string, BRANCH: string}}
 */
var EvolutionTypes = {
    SPLIT_MUTATION: 'sm',
    ADD_OSCILLATOR: 'ao',
    ADD_AUDIO_BUFFER_SOURCE: 'aabs',
    ADD_CONNECTION: 'ac',
    MUTATE_CONNECTION_WEIGHTS: 'mcw',
    MUTATE_NODE_PARAMETERS: 'mnp',
    CROSSOVER: 'co',
    BRANCH: 'b'
};
Network.EvolutionTypes = EvolutionTypes;

/**
 * Helper method for adding to the Network's evolutionHistory
 * @param evolutionType
 */
Network.prototype.addToEvolutionHistory = function(evolutionType) {
    this.evolutionHistory.push(evolutionType);
};

/**
  Randomly mutates the network based on weighted probabilities.
  @note Each one updates lastMutation
  @param params See defaults
*/
Network.prototype.mutate = function(params) {
  if (typeof params === 'undefined') params = {};
  _.defaults(params, {
    // {Number} [0.0, 1.0]
    mutationDistance: 0.5,

    // Chances must add up to 1.0
    splitMutationChance: 0.2,
    addOscillatorChance: 0.1,
    addAudioBufferSourceChance: 0.1,
    addConnectionChance: 0.2,
    mutateConnectionWeightsChance: 0.2, // 0.25,
    mutateNodeParametersChance: 0.2, // 0.25
  });

  var mutations = [
    {weight: params.splitMutationChance, element: this.splitMutation},
    {weight: params.addOscillatorChance, element: this.addOscillator},
    {weight: params.addAudioBufferSourceChance, element: this.addAudioBufferSource},
    {weight: params.addConnectionChance, element: this.addConnection},
    {weight: params.mutateConnectionWeightsChance, element: this.mutateConnectionWeights},
    {weight: params.mutateNodeParametersChance, element: this.mutateNodeParameters}
  ];

  var numMutations;
  if (params.mutationDistance < 0.5) numMutations = 1;
  else if (params.mutationDistance < 0.8) numMutations = 2;
  else numMutations = 3;

  // Clear old changed objects
  _.forEach(this.nodes, function(node) {
    node.hasChanged = false;
  });
  _.forEach(this.connections, function(connection) {
    connection.hasChanged = false;
  });

  // Keep track of lastMutation
  var lastMutation;
  for (var i = 0; i < numMutations; ++i) {
    // TODO: Check current generation for similar structural mutation
    // and copy connection id/ids (innovation number)
    var mutation = Utils.weightedSelection(mutations);
    mutation.call(this, params);
    if (lastMutation) {
      lastMutation.objectsChanged = lastMutation.objectsChanged.concat(
        this.lastMutation.objectsChanged);
      lastMutation.changeDescription +=', '+this.lastMutation.changeDescription;
    }
    else
      lastMutation = this.lastMutation;
  }

  this.lastMutation = lastMutation;
  updateObjectsInMutation(this.lastMutation);

  return this;
};

// Update newly changed objects
function updateObjectsInMutation(lastMutation) {
  if (lastMutation == null)
    throw "no last mutation from mutate";

  _.forEach(lastMutation.objectsChanged, function(objects) {
    objects.hasChanged = true;
  });
}

/*
  Randomly select a connection to split in two
*/
Network.prototype.splitMutation = async function() {
  // Randomly select a connection
  var connections = this.getEnabledConnections(),
      connsLen = connections.length,
      randomI = Utils.randomIndexIn(0, connsLen),
      conn = connections[randomI],
      targetNode = conn.targetNode,
      typesLen = nodeTypes.length,
      typesI = Utils.randomIndexIn(0, typesLen),
      selectedType = nodeTypes[typesI],
      newNode, inConnection, outConnection, targetParameter,
      targetParameterNodeName;

  let NodeModule = await import('./nodes/'+selectedType+'.js');
  let Node = NodeModule["default"];


  // TODO: do we need this check? - it is, after all, a *split* mutation
  if( "buffer" === conn.targetParameter
      // || "OutNode" === conn.targetNode.name
      || "AudioBufferSourceNode" === conn.targetNode.name
      // can't connect twice to a buffer parameter (results in _Overload resolution failed_ error)
      || "NetworkOutputNode"===conn.sourceNode.name || "NoteNetworkOutputNode"===conn.sourceNode.name
    ) {
    // - try again:
    this.splitMutation(); // TODO: could this result in endless recursion?
  } else {

    // "The new connection leading into the new node receives a weight of 1,
    // and the new connection leading out receives the same weight as the old
    // connection." ~ Stanley
    newNode = Node.random();

    if( "NetworkOutputNode"===newNode.name || "NoteNetworkOutputNode"===newNode.name
      ||
      ( // TODO: same as in getPossibleNewConnections
        ("WavetableNode"===newNode.name || "AudioBufferSourceNode"===newNode.name)
          &&
          "NetworkOutputNode"!==conn.sourceNode.name && "NoteNetworkOutputNode"!==conn.sourceNode.name
      )
    ) {
      // can't connect to a *NetworkOutputNode, try again
      this.splitMutation(); // TODO: could this result in endless recursion?
    } else {

      inConnection = new Connection({
        sourceNode: conn.sourceNode,
        targetNode: newNode,
        weight: 1.0
      });

      outConnection = new Connection({
        sourceNode: newNode,
        targetNode: targetNode,
        targetParameter: conn.targetParameter,
        targetParameterNodeName: conn.targetParameterNodeName,
        weight: conn.weight,
        mutationDelta: _.cloneDeep(targetNode.mutationDelta),
        randomMutationRange: _.cloneDeep(targetNode.randomMutationRange)
      });

      conn.disable();
      this.nodes.push(newNode);
      this.connections.push(inConnection);
      this.connections.push(outConnection);

      log('splitting conn '+conn.toString()+' with '+newNode.toString());

      //{objectsChanged [], changeDescription string}
      this.lastMutation = {
        objectsChanged: [
          newNode,
          inConnection,
          outConnection
        ],

        changeDescription: "Split Connection"
      };

      this.addToEvolutionHistory(EvolutionTypes.SPLIT_MUTATION);
      return this;

    }

  }
};

/*
  Adds a single oscillator or networkOutput and connects it to a random input
  in one of the current nodes
 */
Network.prototype.addOscillator = function( force, forceNodeConnection ) {
  var oscillator, possibleTargets, target, connection;
  var self = this; // TODO: this became necessary after running with Node.js (in browsers was fine  ¯\_(ツ)_/¯ )

  // Add FM Oscillator or audio oscillator
  if (
    Utils.randomChance(this.addOscillatorFMMutationRate)
    && !forceNodeConnection
  ) {
    if( Utils.randomChance(0.5) ) {
      oscillator = NetworkOutputNode.random();
    } else {
      oscillator = OscillatorNode.random();
    }

    // Pick random node that's connectable to connect to
    possibleTargets = _.filter(this.nodes, function(node) {
      let connExists = _.find(self.connections, function(conn) { // TODO: reusable function with getPossibleNewConnections or just WET?
        return
          (conn.sourceNode === oscillator && conn.targetNode === node)
          ||
          (conn.sourceNode === node && conn.targetNode === oscillator);
      });
      return !connExists
             && "WavetableNode" !== node.name && "AudioBufferSourceNode" !== node.name
             && "NetworkOutputNode" !== node.name && "NoteNetworkOutputNode" !== node.name
             && node.connectableParameters
             && node.connectableParameters.length > 0;
    });
    target = Utils.randomElementIn(possibleTargets);
    var targetParameter = Utils.randomElementIn(target.connectableParameters),
        randomRange = targetParameter.randomRange;
    connection = new Connection({
      sourceNode: oscillator,
      targetNode: target,
      targetParameter: targetParameter.name,
      targetParameterNodeName: targetParameter.nodeName,
      weight: Utils.randomIn(randomRange.min, randomRange.max),
      mutationDelta: _.cloneDeep(targetParameter.deltaRange),
      randomMutationRange: _.cloneDeep(targetParameter.randomRange)
    });

    log('adding fm oscillator('+targetParameter.name+') '+oscillator.toString());
  }
  else {
    let isPeriodicOscillator;
    if( Utils.randomChance(0.5) || "NetworkOutputNode"===force ) {
      oscillator = NoteNetworkOutputNode.random();
      isPeriodicOscillator = false;
    } else {
      oscillator = NoteOscillatorNode.random();
      isPeriodicOscillator = true;
    }
    // Pick a random non oscillator node
    possibleTargets = _.filter(this.nodes, function(node) {
      let connExists = _.find(self.connections, function(conn) { // TODO: reusable function with getPossibleNewConnections or just WET?
        return
          (conn.sourceNode === oscillator && conn.targetNode === node)
          ||
          (conn.sourceNode === node && conn.targetNode === oscillator);
      });
      if( isPeriodicOscillator ) {
        return !connExists
               && node.name !== "OscillatorNode"
               && node.name !== "NoteOscillatorNode"
               && node.name !== "WavetableNode" && node.name !== "AudioBufferSourceNode"
               && node.name !== "NetworkOutputNode" && node.name !== "NoteNetworkOutputNode"
               // && node.name !== "OutNode"
         ;
      } else {
        return !connExists
               &&
               (node.name === "WavetableNode"
               || node.name === "AudioBufferSourceNode")
        ;
        // TODO: then we need to target a buffer parameter
        // and make sure mixWave is connected, as in addConnection
      }
    });
    target = Utils.randomElementIn(possibleTargets);

    if( target ) {

      connection = new Connection({
        sourceNode: oscillator,
        targetNode: target,
        weight: Utils.randomIn(0.1, 1.0)
      });

      if( "WavetableNode"===target.name || "AudioBufferSourceNode"===target.name ) {
        connection["targetParameter"] = "buffer";
      }
      if( "WavetableNode"===target.name
        && ! this.hasConnectionTargettingMixWaveParameterOfNode(target)
      ) {
        this.addWavetableMixWaveConnection( target );
      }

      log('adding audio oscillator '+oscillator.toString());
    }
  }

  if( oscillator && connection ) {
    this.nodes.push(oscillator);
    this.connections.push(connection);

    //{objectsChanged [], changeDescription string}
    this.lastMutation = {
      objectsChanged: [
        oscillator,
        connection
      ],
      changeDescription: "Added Oscillator (*NetworkOutputNode or *OscillatorNode)"
    };

    this.addToEvolutionHistory(EvolutionTypes.ADD_OSCILLATOR);
  } else {
    // let's try again
    // TODO: might result in infinite recursion
    this.addOscillator();
  }

  return this;
};

/*
  Adds a single audio buffer source or wavetable node and connects it to a random input
  in one of the current nodes
 */
Network.prototype.addAudioBufferSource = function() {
  // TODO: audioBufferSourceNode or Wavetable, half chance
  let audioBufferSource, connection, possibleTargets, target;

  var self = this; // TODO: this became necessary after running with Node.js (in browsers was fine  ¯\_(ツ)_/¯ )

  if( Utils.randomChance(0.5) ) {
    audioBufferSource = AudioBufferSourceNode.random();
  } else {
    audioBufferSource = WavetableNode.random();
  }
  if (Utils.randomChance(this.addOscillatorFMMutationRate)) {
    // Pick random node that's connectable to connect to
    // TODO: same as in addOscillator

    possibleTargets = _.filter(this.nodes, function(node) {
      let connExists = _.find(self.connections, function(conn) { // TODO: reusable function with getPossibleNewConnections or just WET?
        return
          (conn.sourceNode === audioBufferSource && conn.targetNode === node)
          ||
          (conn.sourceNode === node && conn.targetNode === audioBufferSource);
      });
      return !connExists
            && "WavetableNode" !== node.name && "AudioBufferSourceNode" !== node.name
            && "NetworkOutputNode" !== node.name && "NoteNetworkOutputNode" !== node.name
            && node.connectableParameters
            && node.connectableParameters.length > 0;
    });
    target = Utils.randomElementIn(possibleTargets);
    var targetParameter = Utils.randomElementIn(target.connectableParameters),
        randomRange = targetParameter.randomRange;
    connection = new Connection({
      sourceNode: audioBufferSource,
      targetNode: target,
      targetParameter: targetParameter.name,
      targetParameterNodeName: targetParameter.nodeName,
      weight: Utils.randomIn(randomRange.min, randomRange.max),
      mutationDelta: _.cloneDeep(targetParameter.deltaRange),
      randomMutationRange: _.cloneDeep(targetParameter.randomRange)
    });

    log('adding fm audioBufferSource('+targetParameter.name+') '+audioBufferSource.toString());
  } else {
    // Pick a random non oscillator node
    // TODO: similar to addOscillator

    possibleTargets = _.filter(this.nodes, function(node) {
      let connExists = _.find(self.connections, function(conn) { // TODO: reusable function with getPossibleNewConnections or just WET?
        return
          (conn.sourceNode === audioBufferSource && conn.targetNode === node)
          ||
          (conn.sourceNode === node && conn.targetNode === audioBufferSource);
      });
      return !connExists
            && node.name !== "OscillatorNode"
            && node.name !== "NoteOscillatorNode"
            && node.name !== "WavetableNode" && node.name !== "AudioBufferSourceNode"
            && node.name !== "NetworkOutputNode" && node.name !== "NoteNetworkOutputNode"
            // && node.name !== "OutNode"
       ;
    });
    target = Utils.randomElementIn(possibleTargets);
    connection = new Connection({
      sourceNode: audioBufferSource,
      targetNode: target,
      weight: Utils.randomIn(0.1, 1.0)
    });
  }
  this.nodes.push(audioBufferSource);
  this.connections.push(connection);

  this.lastMutation = {
    objectsChanged: [
      audioBufferSource,
      connection
    ],
    changeDescription: "Added Audio Buffer Source (AudioBufferSourceNode or WavetableNode)"
  };
  this.addToEvolutionHistory(EvolutionTypes.ADD_AUDIO_BUFFER_SOURCE);
  return this;
};

Network.prototype.addWavetableMixWaveConnection = function(targetNode) {
  // const wavetableMixWaveSourceNode = newConnection.sourceNode.clone(); // assume the source node is a *NetworkOutputNode
  const wavetableMixWaveSourceNode = NetworkOutputNode.random();
  this.nodes.push( wavetableMixWaveSourceNode );
  wavetableMixWaveSourceNode.type = NetworkOutputNode.TYPES[
    Utils.randomIndexIn(0,NetworkOutputNode.TYPES.length-3) // -3 as the noise types occupy the last three slots
  ];
  const targetParameter = targetNode.connectableParameters[0]; // assume we know mixWave is the first element
// console.log("connections.push from addConnection method, waveTableMixWave");
  this.connections.push(new Connection({
    sourceNode: wavetableMixWaveSourceNode,
    targetNode: targetNode,
    targetParameter: targetParameter.name,
    // targetParameterNodeName: targetParameter.nodeName,
    weight: Utils.randomIn(targetParameter.randomRange.min, targetParameter.randomRange.max),
    mutationDelta: _.cloneDeep(targetParameter.deltaRange),
    mutationDeltaAllowableRange: _.cloneDeep(targetParameter.mutationDeltaAllowableRange),
    randomMutationRange: _.cloneDeep(targetParameter.randomRange),
    // TODO: hmm, what was this?:
    // // for synth.is:
    // targetParameterRange: [
    //   Utils.randomIn(targetParameter.deltaRange.min[0], targetParameter.deltaRange.min[1]),
    //   Utils.randomIn(targetParameter.deltaRange.max[0], targetParameter.deltaRange.max[1])
    // ]
  }));
};

Network.prototype.addConnection = function() {
  var usingFM = Utils.randomChance(this.addConnectionFMMutationRate);
  var possibleConns = this.getPossibleNewConnections(usingFM);
  if (possibleConns.length===0) {
    log('no possible Connections');
    this.lastMutation = {
      objectsChanged: [],
      changeDescription: "No Mutation (No "+(usingFM ? "FM ":"")+"connections to add)"
    };
    return this;
  }

  var newConnection = Utils.randomElementIn(possibleConns);

  // if connection is to a WavetableNode, and it's not to the 'mix' parameter
  // and there is no 'mix' parameter connection present, then force the addition
  // of such a connection from a NetworkOutputNode with a random non-noise TYPE.
  this.connections.push(newConnection);
  if( "WavetableNode" === newConnection.targetNode.name &&
    ! this.hasConnectionTargettingMixWaveParameterOfNode(newConnection.targetNode)
  ) {
    this.addWavetableMixWaveConnection( newConnection.targetNode );
  }

  log('new connection: '+newConnection.toString());

  //{objectsChanged [], changeDescription string}
  this.lastMutation = {
    objectsChanged: [
      newConnection
    ],
    changeDescription: "Added Connection"
  };

  this.addToEvolutionHistory(EvolutionTypes.ADD_CONNECTION);
  return this;
};

Network.prototype.hasConnectionTargettingMixWaveParameterOfNode = function( targetNode ) {
  let hasConnectionToMixWaveParameter = false;
  for( const oneConnection of this.connections ) {
    if( targetNode === oneConnection.targetNode &&
      'mixWave' === oneConnection.targetParameter
    ) {
      hasConnectionToMixWaveParameter = true;
      break;
    }
  }
  return hasConnectionToMixWaveParameter;
}

Network.prototype.getPossibleNewConnections = function(usingFM) {
  // TODO: Just build the potential connections when new nodes are added/removed?
  //       perfomance hit when adding new nodes, but don't have to O(n^2) for adding a new connection.
  //       Would have to regenerate on copy though

  // TODO: allow multiple connections to different parameters between same nodes for FM synthesis?
  var self = this,
      connections = [];

  // Loop through all non output nodes
  _.forEach(this.nodes, function(sourceNode) {
    if (sourceNode.name==="OutNode")
      return;
    // Create possible connection if it (or its inverse)
    // doesn't exist already
    _.forEach(self.nodes, function(targetNode) {

      // if( targetNode.name==="OutNode" ) { // TODO: bthj: too restrictive?
      //   return;
      // }

      if (usingFM &&
          (!targetNode.connectableParameters ||
           targetNode.connectableParameters.length === 0))
        return;
      if (!usingFM &&
          (targetNode.name==="OscillatorNode" ||
           targetNode.name==="NoteOscillatorNode"))
        return;
      if (sourceNode===targetNode)
        return;

      if( "NetworkOutputNode"===targetNode.name || "NoteNetworkOutputNode"===targetNode.name ) {
        // console.log("---CANNOT target *NetworkOutputNode");
        return;
      }

      if( !usingFM && ("NetworkOutputNode"===sourceNode.name || "NoteNetworkOutputNode"===sourceNode.name) ) {
        // console.log("---*NetworkOutputNode can only target audio parameters; not nodes directly");
        return;
      }

      var connExists = _.find(self.connections, function(conn) {
        return (conn.sourceNode === sourceNode &&
                conn.targetNode === targetNode) ||
               (conn.sourceNode === targetNode &&
                conn.targetNode === sourceNode);
      });

      if (connExists)
        return;

      // if sourceNode is networkOutputNode,
      // - then possible to connect to convolverNode buffer
      // TODO: limit to NetworkOutputNode.TYPES for *noise ?
      if( usingFM &&
          targetNode.name==="ConvolverNode" &&
          sourceNode.name!=="NetworkOutputNode"
      ) { return; }

      // if targetNode is WavetableNode or AudioBufferSourceNode,
      // then sourceNode can only be NetworkOutputNode or NoteNetworkOutputNode
      if( ("WavetableNode"===targetNode.name || "AudioBufferSourceNode"===targetNode.name)
        &&
        "NetworkOutputNode"!==sourceNode.name && "NoteNetworkOutputNode"!==sourceNode.name
        // TODO: restrict to NoteNetworkOutputNode ?
      ) {
        return;
      }

      if (usingFM) {
        var targetParameter = Utils.randomElementIn(targetNode.connectableParameters),
            randomRange = targetParameter.randomRange;

        // is a nother connection targetting the same parameter on the same node
        // - and is the sourceNode of that connection or the currently found sourceNode a *NetworkOutputNode ?
        // then return (continue)
        const isTargetParameterOccupiedByNetworkOutput = _.find(self.connections, function(conn) {
          return targetNode.id === conn.targetNode.id
          && conn.targetParameter && targetParameter.name === conn.targetParameter.name
          && (
            "NetworkOutputNode"===sourceNode.name || "NoteNetworkOutputNode"===sourceNode.name
            || "NetworkOutputNode"===conn.sourceNode.name || "NoteNetworkOutputNode"===conn.sourceNode.name
          );
        });
        if( isTargetParameterOccupiedByNetworkOutput ) {
          return;
        }
        connections.push(new Connection({
          sourceNode: sourceNode,
          targetNode: targetNode,
          targetParameter: targetParameter.name,
          targetParameterNodeName: targetParameter.nodeName,
          weight: randomRange ? Utils.randomIn(randomRange.min, randomRange.max) : 1,
          mutationDelta: _.cloneDeep(targetParameter.deltaRange),
          mutationDeltaAllowableRange: _.cloneDeep(targetParameter.mutationDeltaAllowableRange),
          randomMutationRange: _.cloneDeep(targetParameter.randomRange)
        }));
      }
      else {
        // console.log("adding connection from sourceNode ", sourceNode, " to targetNode ", targetNode);
        const connectionParams = {
          sourceNode: sourceNode,
          targetNode: targetNode,
          // less than one to decrease risk of harsh feedback
          weight: 0.5
        };
        // though not using FM, if target is bufferSource, connect to targetParameter 'buffer'
        if( "AudioBufferSourceNode"===targetNode.name ) {
          connectionParams['targetParameter'] = "buffer";
          // console.log("---connection to AudioBufferSourceNode buffer");
        } else if( "WavetableNode"===targetNode.name ) {
          if( Utils.randomChance(0.5) ) {
            connectionParams['targetParameter'] = "buffer";
            // console.log("---connection to WavetableNode buffer");
          } else {
            connectionParams['targetParameter'] = "mix";
            // console.log("---connection to WavetableNode mix");
          }
        }
        connections.push(new Connection( connectionParams ));
      }
    });
  });

  return connections;
};

/*
  For each connection, mutate based on the given probability
  @param params
*/
Network.prototype.mutateConnectionWeights = function(params) {
  if (typeof params === 'undefined') params = {};
  _.defaults(params, {
    //{bool} (default: true) Makes at least one connection mutate
    forceMutation: true,
    // {Number} [0.0, 1.0]
    mutationDistance: 0.5
  });

  var rate = Utils.interpolate(this.connectionMutationInterpolationType,
                               this.connectionMutationRate,
                               params.mutationDistance);
  var objectsChanged = [],
      anyMutations = false;
  _.forEach(this.connections, function(conn) {
    if (Utils.random() <= rate) {
      objectsChanged.push(conn.mutate(params.mutationDistance));
      anyMutations = true;
    }
  });

  // If no connections were mutated and forcing a mutation
  // mutate a random one
  if (!anyMutations && params.forceMutation) {
    log('forcing weight mutation');
    var conn = Utils.randomElementIn(this.connections);
    objectsChanged.push(conn.mutate(params.mutationDistance));
  }

  //{objectsChanged [], changeDescription string}
  this.lastMutation = {
    objectsChanged: objectsChanged,
    changeDescription: "Mutated connection gain"
  };

  this.addToEvolutionHistory(EvolutionTypes.MUTATE_CONNECTION_WEIGHTS);
  return this;
};

Network.prototype.mutateNodeParameters = function(params) {
  if (typeof params === 'undefined') params = {};
  _.defaults(params, {
    //{bool} (default: true) Makes at least one connection mutate
    forceMutation: true,
    // {Number} [0.0, 1.0]
    mutationDistance: 0.5
  });

  var rate = Utils.interpolate(
    this.nodeMutationInterpolationType,
    this.nodeMutationRate,
    params.mutationDistance);

  var anyMutations = false,
      objectsChanged = [];
  _.forEach(this.nodes, function(node) {
    if (Utils.random() <= rate) {
      objectsChanged.push(node.mutate({
        mutationDistance: params.mutationDistance
      }));
      anyMutations = true;
    }
  });

  // If no nodes were mutated and forcing a mutation
  // mutate a random one
  if (!anyMutations && params.forceMutation) {
    log('forcing node mutation');
    var node = Utils.randomElementIn(this.nodes);
    objectsChanged.push(node.mutate({
      mutationDistance: params.mutationDistance
    }));
  }
  //{objectsChanged [], changeDescription string}
  this.lastMutation = {
    objectsChanged: objectsChanged,
    changeDescription: "Mutated Node Parameters"
  };

  this.addToEvolutionHistory(EvolutionTypes.MUTATE_NODE_PARAMETERS);
  return this;
};

Network.prototype.getEnabledConnections = function() {
  return _.filter(this.connections, 'enabled');
};

Network.prototype.getNoteOscillatorNodes = function() {
  return _.filter(this.nodes, {name: 'NoteOscillatorNode'});
};
Network.prototype.getOscillatorNodes = function() {
  return _.filter(this.nodes, {name: 'OscillatorNode'});
};

/**
 Gets the non noteOscillator and oscillator nodes
*/
Network.prototype.getOscillatorAndNoteOscillatorNodes = function() {
  return _.filter(this.nodes, function(node) {
    return node.name === 'OscillatorNode' ||
           node.name === 'NoteOscillatorNode';
  });
};

Network.prototype.toString = function() {
  var str = this.id+' gen('+this.generation+')<br>';
  str+="Nodes:<br>";
  _.forEach(this.nodes, function(ele) {
    str+=ele.toString()+"<br>";
  });

  str += "<br>Connections:<br>";
  _.forEach(this.connections, function(ele) {
    str+=ele.toString()+"<br>";
  });

  return str;
};

Network.prototype.toJSON = function() {
  var json = {
    id: this.id,
    generation: this.generation,
    evolutionHistory: this.evolutionHistory,
    nodes: [],
    connections: []
  };
  // console.log("--- this.nodes:",this.nodes);
  // console.log("--- this.connections:",this.connections);
  _.forEach(this.nodes, function(node) {
    json.nodes.push(node.toJSON());
  });
  _.forEach(this.connections, function(connection) {
    json.connections.push(connection.toJSON());
  });
  return JSON.stringify(json);
};
Network.createFromJSON = async function(json) {
  var obj = typeof json === 'object' ? json : JSON.parse(json),
      createdNodes = [],
      createdConnections = [];
  for( const json of obj.nodes ) {
    var nodeParams = typeof json === 'string' ? JSON.parse(json) : json;
    var type = Utils.lowerCaseFirstLetter(nodeParams.name);

    let NodeModule = await import('./nodes/'+type+'.js');
    let Node = NodeModule['default'];
    let createdNode = new Node(nodeParams);
    createdNodes.push(createdNode);
  }
  createdNodes.push(asNEAT.globalOutNode);
  for( const json of obj.connections ) {
    var connectionParams = typeof json === 'string' ? JSON.parse(json) : json,
        sourceNodeId = connectionParams.sourceNode,
        targetNodeId = connectionParams.targetNode === 'output' ? 0 : connectionParams.targetNode,
        sourceNode, targetNode, createdConnection;
    sourceNode = _.find(createdNodes, {id: sourceNodeId});
    targetNode = _.find(createdNodes, {id: targetNodeId});

    connectionParams.sourceNode = sourceNode;
    connectionParams.targetNode = targetNode;

    createdConnection = new Connection(connectionParams);
    createdConnections.push(createdConnection);
  }

  obj.nodes = createdNodes;
  obj.connections = createdConnections;
  return new Network(obj);
};

export default Network;
