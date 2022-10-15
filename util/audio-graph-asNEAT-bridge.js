// create asNEAT networks and populations from synth.is patches
// and vice versa,
// synth.is patches from asNEAT networks

import asNeatUtils from '../as-neat/utils';
import { audioGraphNodes as audioGraphNodesSchema } from './audio-graph';
import isString from "lodash/isString";
import isNumber from "lodash/isNumber";
import merge from "lodash/merge";

export const asNEATnetworkFromPatch = async patch => {

  // TODO: return asNEAT network

  const nodes = [];
  const connections = [];
  Object.entries(patch.audioGraph)
  .filter( ([key, val]) => ! key.endsWith("-weight") )
  .forEach( async ([key, [nodeName, nodeConnections, ...nodeProps]]) => {
    console.log("key:", key, ", nodeName:", nodeName, ", nodeConnections:", nodeConnections, ", nodeProps:", nodeProps);

    if( nodeProps[0] ) {
      Object.keys(nodeProps[0]).forEach(key => {
        const nodePropAsFloat = parseFloat(nodeProps[0][key]);
        if( ! isNaN(nodePropAsFloat) ) {
          nodeProps[0][key] = nodePropAsFloat;
        }
      });
    }

    if( key == "0" ) {
      key = getUpdatedKeyNotCollidingWithOutNodeReserved(key);
    }

    const oneAsNEATNode = merge({
      "id": key,
      "name": getASNeatNodeNameFromSynthIsAudioGraph(nodeName, nodeProps["noteOffset"])
      // fyrir "OscillatorNode":
      // "type": "TODO ... network output number",
      //"frequency": "TODO: corresponding network output frequency",
      // ADSR values
    }, ...nodeProps);
    nodes.push( oneAsNEATNode );

    // create connections
    // -> if (nodeConnections/oneNodeConnection) has the suffix "-weight",
    // then that node is part of the connection, acting as a connection weight,
    // and needs to be included in the connection and traversed
    // to find the actual node to connect to.
    if( 'output' === nodeConnections ) {
      const oneAsNEATNode = {
        "id": 0,  // 0 is actually hardcoded in asNEAT OutNode
         "name": "OutNode"
      };
      nodes.push( oneAsNEATNode );
      const oneAsNEATConnection = {
        "id": asNeatUtils.createHash(),
        "sourceNode": key,
        "targetNode": 0,
        // other param default values from asNeat Connection.prototype.defaultParameters
      };
      connections.push( oneAsNEATConnection );
    } else if( Array.isArray(nodeConnections) ) {
      nodeConnections.forEach( async (oneNodeConnection, i) => {
        const oneAsNEATConnection = await getAsNeatNodeConnectionFromSynthisConnection(
          key, oneNodeConnection, nodeProps, patch.audioGraph
        );
        connections.push( oneAsNEATConnection );
      });
    } else {
      const oneAsNEATConnection = await getAsNeatNodeConnectionFromSynthisConnection(
        key, nodeConnections, nodeProps, patch.audioGraph );
      connections.push( oneAsNEATConnection );
    }
  });

  // go through patch.networkOutputs and create asNeat oscillatorNodes
  await patch.networkOutputs.forEach( async (oneNetworkOutput, i) => {

    const { frequency, networkOutput, audioGraphNodes } = oneNetworkOutput;

    for( let audioGraphNodeKey in audioGraphNodes ) {

      // TODO: handle when audioGraphNodeKey endsWith "-weight" ?

      await audioGraphNodes[audioGraphNodeKey].forEach( async (networkOutputToAudioParam, i) => {

        const networkOutputASNeatNodeId = asNeatUtils.createHash();

        let oneAsNEATNode;
        if( networkOutputToAudioParam.paramName === 'buffer' ) {
          oneAsNEATNode = {
            "id": networkOutputASNeatNodeId,
            "name": "NoteNetworkOutputNode",
            frequency,  // - stepFromRootNote + noteOffset vs frequency ?  ...
            type: networkOutput,
          };
        } else {
          oneAsNEATNode = {
            "id": networkOutputASNeatNodeId,
            "name": "NetworkOutputNode",
            frequency,
            type: networkOutput,
          };
        }
        nodes.push( oneAsNEATNode );

        const nodeSpecificConnectionParameters = await getNodeSpecificConnectionParameters(
          audioGraphNodeKey, networkOutputToAudioParam.paramName, patch.audioGraph
        );

        const oneAsNEATConnection = await getAsNeatNodeConnectionFromSynthisConnection(
          networkOutputASNeatNodeId, audioGraphNodeKey,
          {targetParameterRange: networkOutputToAudioParam.range}/*nodeProps*/, patch.audioGraph,
          nodeSpecificConnectionParameters, networkOutputToAudioParam.paramName
        );
        connections.push( oneAsNEATConnection );
      });
    }
  });

  console.log("---nodes:",nodes);
  console.log("---connections:",connections);

  const asNEATnetwork = {
    "id": asNeatUtils.createHash(),
    "generation": 0,
    "evolutionHistory": [],
    nodes,
    connections
  };
  return asNEATnetwork;
};

export const patchFromAsNEATnetwork = asNEATnetwork => {
  asNEATnetwork = JSON.parse(asNEATnetwork);
  const { nodes, connections } = asNEATnetwork;
  const synthIsPatch = { audioGraph: {}, networkOutputs: [] };
  console.log("---patchFromAsNEATnetwork asNEATnetwork.nodes:",asNEATnetwork.nodes);
  asNEATnetwork.nodes
  .map( n => JSON.parse(n) )  // TODO: why is this nested parsing required?
  .filter( n => n.name !== "OutNode")
  .forEach((oneAsNEATNode, i) => {
    if( "NetworkOutputNode" === oneAsNEATNode.name || "NoteNetworkOutputNode" === oneAsNEATNode.name ) {
      // let networkOutput = getNetworkOutputById( oneAsNEATNode.id, synthIsPatch.networkOutputs );
      let networkOutput = getSynthIsNetworkOutputById( oneAsNEATNode.id, synthIsPatch.networkOutputs );
      if( ! networkOutput ) {
        networkOutput = {
          "id": oneAsNEATNode.id,
          "networkOutput": oneAsNEATNode.type,
          "frequency": "NoteNetworkOutputNode" === oneAsNEATNode.name && oneAsNEATNode.noteOffset != 0 ? // let's keep the original frequency (if converted from synth.is patch) if no note offset has been set
            asNeatUtils.frequencyOfStepsFromRootNote(oneAsNEATNode.noteOffset)
            : oneAsNEATNode.frequency,
          "audioGraphNodes": {} // connections
        };
        synthIsPatch.networkOutputs.push( networkOutput );
      }
      // is there a connection with the networkOutput as a sourceNode and no targetParameter ?
      // - then we have to create a bufferSource node in the synthIsPatch.audioGraph
      //   and connect that bufferSource node to the connection target
      // going O(n^2) ...
      /*
      asNEATnetwork.connections.forEach((oneAsNEATConnection, i) => {
        if( oneAsNEATConnection.sourceNode === oneAsNEATNode.id &&
            ! oneAsNEATConnection.targetParameter
        ) {
          synthIsPatch.audioGraph[oneAsNEATNode.id] = [
            'bufferSource',
            [oneAsNEATConnection.targetNode], // connections
            {} // node params, here detune and playbackRate
          ];
        }
      }); // otherwise the networkOutput connects directly to a node param in the audioGraph
      */
    } else {

      const synthIsNodeName = getSynthIsNodeNameFromASNeatNodeName(oneAsNEATNode.name);
      const audioNodeProperties = getAudioNodeProperties(synthIsNodeName, oneAsNEATNode);
      // TODO: if audio node parameter has a network output or another node output connected to it,
      // - remove any conflicting property obtained here?  or perhaps it doesn't have any effect?
      // - see e.g. asNEATnetwork.connections ... networkOutput.audioGraphNodes[oneAsNEATConnection.targetNode].push ... below

      // set frequency for the virtual-audio-graph oscillator if asNEAT NoteOscillatorNode
      if( "NoteOscillatorNode" === oneAsNEATNode.name && oneAsNEATNode.noteOffset ) {
        audioNodeProperties["frequency"] = asNeatUtils.frequencyOfStepsFromRootNote(oneAsNEATNode.noteOffset);
      }

      synthIsPatch.audioGraph[oneAsNEATNode.id] = [
        getSynthIsNodeNameFromASNeatNodeName(oneAsNEATNode.name),
        [], // connections
        audioNodeProperties
      ];
    }
  });
console.log("---patchFromAsNEATnetwork asNEATnetwork.connections:",asNEATnetwork.connections);
  const audioGraphTargetsToSources = {};
  const audioGraphTargetsToNetworkOutputs = {};
  asNEATnetwork.connections
  .map( c => JSON.parse(c) ) // TODO: why is this nested parsing required?
  .forEach((oneAsNEATConnection, i) => {
    if( synthIsPatch.audioGraph[oneAsNEATConnection.sourceNode] ) {
      // connection from a node within the audioGraph to another node within the audioGraph
      if( ! synthIsPatch.audioGraph[oneAsNEATConnection.sourceNode][1] ) {
        // we'll only support an array for the node connections - https://github.com/benji6/virtual-audio-graph/tree/v0.19.9#updating-the-audio-graph
        synthIsPatch.audioGraph[oneAsNEATConnection.sourceNode][1] = [];
      }
      const actualTargetNodeKey = oneAsNEATConnection.targetNode;
      if( isString(actualTargetNodeKey) && ! actualTargetNodeKey.endsWith("-weight") ) {
        const weightNodeKey =
          oneAsNEATConnection.sourceNode + "_" + actualTargetNodeKey
          + (oneAsNEATConnection.targetParameter ? `-${oneAsNEATConnection.targetParameter}` : "")
          + "-weight";
        synthIsPatch.audioGraph[oneAsNEATConnection.sourceNode][1].push( weightNodeKey );
        synthIsPatch.audioGraph[weightNodeKey] = [
          'gain', // weight node
          [oneAsNEATConnection.targetParameter ?
            {key: actualTargetNodeKey, destination: oneAsNEATConnection.targetParameter}
            :
            actualTargetNodeKey
          ],
          {gain: oneAsNEATConnection.weight}
        ];
      } else if( 0 === actualTargetNodeKey) { // the asNEAT specific OutNode ID, so we'll add the virtual-audio-graph specific 'output'
        synthIsPatch.audioGraph[oneAsNEATConnection.sourceNode][1].push( 'output' );
      }
      // sources to targets bookkeeping, to be able to determine need for channel merger nodes
      if( ! audioGraphTargetsToSources[actualTargetNodeKey] ) {
        audioGraphTargetsToSources[actualTargetNodeKey] = [];
      }
      audioGraphTargetsToSources[actualTargetNodeKey].push( oneAsNEATConnection.sourceNode );
    } else {
      // connection from a networkOutput to a node in the audioGraph
      const networkOutput = getSynthIsNetworkOutputById( oneAsNEATConnection.sourceNode, synthIsPatch.networkOutputs );
      if( ! networkOutput.audioGraphNodes[oneAsNEATConnection.targetNode] ) {
        networkOutput.audioGraphNodes[oneAsNEATConnection.targetNode] = [];
      }
      // TODO: intermediary "-weight" gain nodes here, as above for inter-audioGraph connections?
      // - or let the range parameter suffice?
      networkOutput.audioGraphNodes[oneAsNEATConnection.targetNode].push({
        "paramName": oneAsNEATConnection.targetParameter,
        "range": oneAsNEATConnection.targetParameterRange, // [] modified asNEAT mutates this
      });
      // networkOutputs to audioGraph targets bookkeeping, to be able to determine need for merging the networkOutput values
      if( ! audioGraphTargetsToNetworkOutputs[oneAsNEATConnection.targetNode] ) {
        audioGraphTargetsToNetworkOutputs[oneAsNEATConnection.targetNode] = [];
      }
      audioGraphTargetsToNetworkOutputs[oneAsNEATConnection.targetNode].push( oneAsNEATConnection.sourceNode );
    }
  });

  // check if a target node has more than one source
  for( const targetNode in audioGraphTargetsToSources ) {
    if( audioGraphTargetsToSources[targetNode].length > 1 ) {
      console.log(`${targetNode} has more than one source: `, audioGraphTargetsToSources[targetNode]);
      // TODO: place ChannelmergerNode in between
    }
  }

  // check if a target node has more than one networkOutput
  for( const targetNode in audioGraphTargetsToNetworkOutputs ) {
    if( audioGraphTargetsToNetworkOutputs[targetNode].length > 1 ) {
      console.log(`${targetNode} has more than one network output:`, audioGraphTargetsToNetworkOutputs[targetNode]);
      // TODO: merge values of the networkOutputs; should that happen in the 'network-rendering' module?
    }
  }

  // TODO: if multiple network outputs point to the same graph node and parameter
  // add ChannelmergerNode to graph, for fan-in of all the networkOutputs
  // https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API#fan-in_and_fan-out
  // via AudioParam notes at https://developer.mozilla.org/en-US/docs/Web/API/AudioNode/connect#audioparam_example
  // - unless target node is a wave table; it implicitly creates new buffers

  return synthIsPatch;
};

// TODO: see getSynthIsNetworkOutputById
// const getNetworkOutputById = (networkOutputId, networkOutputs) => {
//   for( const oneNetworkOutput of networkOutputs ) {
//     if( networkOutputId === oneNetworkOutput.id ) {
//       return oneNetworkOutput;
//     }
//   }
// }

const getAudioNodeProperties = (synthIsNodeName, asNeatNode) => {
  const synthIsAudioNodeParamNames = [
    ...(audioGraphNodesSchema[synthIsNodeName].audioParams ? Object.keys(audioGraphNodesSchema[synthIsNodeName].audioParams) : []),
    ...(audioGraphNodesSchema[synthIsNodeName].choiceParams ? Object.keys(audioGraphNodesSchema[synthIsNodeName].choiceParams) : []),
  ]; ;
  const audioNodeProperties = {};
  synthIsAudioNodeParamNames.forEach((oneParamName, i) => {
    const asNeatParamValue = asNeatNode[oneParamName];
    if( asNeatParamValue ) {
      audioNodeProperties[oneParamName] = asNeatParamValue;
    }
  });
  return audioNodeProperties;
}

const getSynthIsNetworkOutputById = (networkOutputId, networkOutputs) => {
  let networkOutput;
  for( let oneNetworkOutput of networkOutputs ) {
    if( networkOutputId === oneNetworkOutput.id ) {
      networkOutput = oneNetworkOutput;
      break;
    }
  }
  return networkOutput;
}

// const compileAudioGraph = (audioGraph) => Object.fromEntries(
//   Object.entries(audioGraph)
//     .map(([key, [nodeName, ...nodeArgs]]) => [key, nodes[nodeName](...nodeArgs)])
// )

const getAsNeatNodeConnectionFromSynthisConnection = async (
    sourceKey, target, nodeProps, audioGraph,
    nodeSpecificConnectionParameters, audioNodeParamName
  ) => {
  let oneAsNEATConnection;
  let isConnectionKeyNumber = isNumber(target);
  let isConnectionKeyString = isString(target);
  console.log("---target:",target);
  if( isConnectionKeyNumber || isConnectionKeyString ) {
    if( target == "0" ) {
      target = getUpdatedKeyNotCollidingWithOutNodeReserved(target);
    }
    console.log("---isConnectionKeyString:",isConnectionKeyString);
    let actualTargetNodeKey, weight;
    let targetParameter;
    if( isConnectionKeyString && target.endsWith("-weight") ) {
      // we assume _connection weight nodes_ are always keyed as strings ending with "-weight"
      // - need to find the actual destination node, while keeping the gain value of the
      // _connection weight node_ as weight for the connection:
      weight = audioGraph[target][2].gain;
      const actualTargetEntry = audioGraph[target][1];
      if( isString(actualTargetEntry) || isNumber(actualTargetEntry) ) {
        actualTargetNodeKey = audioGraph[target][1]; // target is a string on _connection weight nodes_
      } else if( Array.isArray(actualTargetEntry) ) {
        // assume there is just one entry withn the array, and that it is a object
        if( isString(actualTargetEntry[0]) || isNumber(actualTargetEntry[0]) ) {
          actualTargetNodeKey = actualTargetEntry[0];
        } else {
          actualTargetNodeKey = actualTargetEntry[0].key;
          targetParameter = actualTargetEntry[0].destination;
        }
      } else {
        actualTargetNodeKey = actualTargetEntry.key;
        targetParameter = actualTargetEntry.destination;
      }
    } else {
      // we are not going through a _connection weight node_ but rather directly to the target node
      weight = 1;
      actualTargetNodeKey = target;
    }
    let targetNode = getAsNeatNodeConnectionTargetNode( actualTargetNodeKey );
    oneAsNEATConnection = {
      "id": asNeatUtils.createHash(),
      "sourceNode": sourceKey,
      targetNode,
      "weight": weight,
      "targetParameterNodeName": "node", // TODO: sometimes e.g. oscNode ...
      ...merge(
        nodeSpecificConnectionParameters,
        ...Array.isArray(nodeProps) ? nodeProps : [nodeProps] // 👍 https://github.com/tc39/ecma262/issues/478#issuecomment-197373487
      )
    };
    if( audioNodeParamName ) {
      oneAsNEATConnection["targetParameter"] = audioNodeParamName;
    } else if( targetParameter ) {
      oneAsNEATConnection["targetParameter"] = targetParameter;
    }
  } else {
    // we have an object with key and destination properties - https://github.com/benji6/virtual-audio-graph/tree/v0.19.9#updating-the-audio-graph
    let targetNode = target.key;
    let targetParameter = target.destination;

    const nodeSpecificConnectionParameters = await getNodeSpecificConnectionParameters(
      targetNode, targetParameter, audioGraph
    );

    if( targetNode == "0" ) {
      targetNode = getUpdatedKeyNotCollidingWithOutNodeReserved(targetNode);
    }

    oneAsNEATConnection = {
      "id": asNeatUtils.createHash(),
      "sourceNode": sourceKey,
      "targetNode": getAsNeatNodeConnectionTargetNode( targetNode ),
      "targetParameterNodeName": "node", // TODO: sometimes e.g. oscNode ...
      "targetParameter": targetParameter,
      ...merge(nodeSpecificConnectionParameters, ...nodeProps)
    };
  }
  return oneAsNEATConnection;
}

const getAsNeatNodeConnectionTargetNode = targetNodeKey => {
  let targetNode;
  if( 0 == targetNodeKey ) {
    // OutNode in asNEAT has ID reserved / hardcoded as 0 (non-string), so let's preserve that
    targetNode = parseInt(targetNodeKey); // when coming from an object with key and destination properties, the node key is a string, which we need to make sure is an integer (0) for asNEAT
  } else {
    targetNode = `${targetNodeKey}`; // forcing string as incoming target declaration may be an integer (from an array), while matching with the corresponding (asNEAT) node may be based on strings
  }
  return targetNode;
}

const getNodeSpecificConnectionParameters = async (
    audioGraphDestinationKey, audioGraphDestinationParam, audioGraph, hasNoteOffsetProperty
  ) => {
  const audioGraphNodeName = audioGraph[audioGraphDestinationKey][0];
  const asNeatNodeType = getASNeatNodeNameFromSynthIsAudioGraph(audioGraphNodeName, hasNoteOffsetProperty);
  let nodeSpecificConnectionParameters;
  if( asNeatNodeType ) {
    const asNeatNodeTypeLowerCaseFirst = asNeatUtils.lowerCaseFirstLetter(asNeatNodeType);
    const asNeatNode = await import('../as-neat/nodes/'+asNeatNodeTypeLowerCaseFirst);
    nodeSpecificConnectionParameters = getConnectionParametersFromAsNeatNode(
      asNeatNode, audioGraphDestinationParam
    );
  } else {
    nodeSpecificConnectionParameters = {};
  }
  return nodeSpecificConnectionParameters;
}

const getConnectionParametersFromAsNeatNode = ( asNeatNode, paramName ) => {
  let connectionParams;
  const nodeName = asNeatNode;
  const connectableParameters = asNeatNode.default.prototype.defaultParameters.connectableParameters;
  if( Array.isArray(connectableParameters) ) {
    for (let oneParam of connectableParameters) {
      if( oneParam.name === paramName ) {
        connectionParams = {
          "mutationDelta": oneParam.deltaRange,
          "randomMutationRange": oneParam.randomRange,
          "mutationDeltaAllowableRange": oneParam.mutationDeltaAllowableRange
        };
      }
    }
  }
  if( ! connectionParams ) {
    connectionParams = {};
  }
  return connectionParams;
}

const getASNeatNodeNameFromSynthIsAudioGraph = ( audioGraphNodeName, hasNoteOffsetProperty ) => {
  switch (audioGraphNodeName) {
    case "biquadFilter":
      return "FilterNode";
    case "convolver":
      return "ConvolverNode";
    case "delay":
      return "DelayNode";
    case "dynamicsCompressor":
      return "CompressorNode";
    case "gain":
      return "GainNode";
    case "waveShaper":
      return "WaveShaperNode";
    case "wavetable":
      return "WavetableNode";
    case "feedbackDelay":
      return "FeedbackDelayNode";
    case "oscillator": {
      if( hasNoteOffsetProperty ) {
        return "NoteOscillatorNode";
      } else {
        return "OscillatorNode";
      }
    }
    case "bufferSource":
      return "AudioBufferSourceNode";
    // case "output":
    //   return "OutNode";
    default:
      return undefined;
  }
}

const getSynthIsNodeNameFromASNeatNodeName = ( asNeatNodeName ) => {
  switch (asNeatNodeName) {
    case "FilterNode":
      return "biquadFilter";
    case "ConvolverNode":
      return "convolver";
    case "DelayNode":
      return "delay";
    case "CompressorNode":
      return "dynamicsCompressor";
    case "GainNode":
      return "gain";
    case "WaveShaperNode":
      return "waveShaper";
    case "WavetableNode":
      return "wavetable";
    case "FeedbackDelayNode":
      return "feedbackDelay";
    case "OscillatorNode":
    case "NoteOscillatorNode":
      return "oscillator";
    case "AudioBufferSourceNode":
      return "bufferSource";
    // case "output":
    //   return "OutNode";
    default:
      return undefined;
  }
}

const getUpdatedKeyNotCollidingWithOutNodeReserved = ( key ) => {
  // OutNode in asNEAT has ID reserved / hardcoded as 0; let's modify this key to avoid a collision
  return key + "-";
}
