/**
 * CPPN Wrapper Gain Nodes
 *
 * Creates intermediate gain nodes that connect AudioWorklet CPPN outputs
 * to the virtual-audio-graph DSP processing chain.
 *
 * ARCHITECTURE:
 * ───────────────────────────────────────────────────────────────────
 *
 * AudioWorklet (cppnOutputNode)
 *   Channel 0 → [Gain Node 0] → Virtual-audio-graph uses as signal
 *   Channel 1 → [Gain Node 1] → Virtual-audio-graph uses as signal
 *   ...
 *   Channel N → [Gain Node N] → Virtual-audio-graph uses as signal
 *
 * This allows virtual-audio-graph to consume live CPPN outputs
 * without needing to modify its internal implementation.
 */

/**
 * Create wrapper gain nodes for CPPN outputs
 *
 * Uses a ChannelSplitter to separate the AudioWorklet's multi-channel output
 * into individual mono signals, then wraps each in a gain node.
 *
 * @param {AudioWorkletNode} cppnOutputNode - Node with multi-channel CPPN outputs
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {number} numberOfOutputs - Number of CPPN outputs to wrap
 * @returns {Map<number, GainNode>} - Map of outputIndex → GainNode
 */
export function createCPPNWrapperNodes(cppnOutputNode, audioContext, numberOfOutputs) {
  const wrapperNodes = new Map();

  // Create a ChannelSplitter to split the multi-channel output
  const splitter = audioContext.createChannelSplitter(numberOfOutputs);

  // Connect AudioWorklet to splitter
  cppnOutputNode.connect(splitter);

  // Create a gain node for each split channel
  for (let outputIndex = 0; outputIndex < numberOfOutputs; outputIndex++) {
    // Create a gain node for this CPPN output
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // Unity gain (pass-through)

    // Connect the splitter's output channel to this gain node
    splitter.connect(gainNode, outputIndex, 0);

    // Store the wrapper node
    wrapperNodes.set(outputIndex, gainNode);
  }

  console.log(`Created ${numberOfOutputs} CPPN wrapper gain nodes (via ChannelSplitter)`);

  return wrapperNodes;
}

/**
 * Get the wrapper node or buffer for a specific CPPN output
 *
 * In streaming mode: Returns the wrapper GainNode
 * In batch mode: Returns the pre-rendered buffer/curve
 *
 * @param {number} outputIndex - CPPN output index
 * @param {Map<number, GainNode>} wrapperNodes - Wrapper nodes (streaming mode)
 * @param {Map} memberOutputs - Pre-rendered outputs (batch mode)
 * @param {string} mode - 'streaming' or 'batch'
 * @returns {GainNode|Float32Array} - Either a GainNode or buffer data
 */
export function getCPPNOutputSource(outputIndex, wrapperNodes, memberOutputs, mode) {
  if (mode === 'streaming' && wrapperNodes) {
    // Streaming mode: return the wrapper GainNode
    const wrapperNode = wrapperNodes.get(outputIndex);
    if (!wrapperNode) {
      throw new Error(`No wrapper node found for CPPN output ${outputIndex}`);
    }
    return wrapperNode;
  } else {
    // Batch mode: return the pre-rendered buffer/curve
    // This maintains backward compatibility with existing code
    return memberOutputs; // Let the calling code extract what it needs
  }
}

/**
 * Connect CPPN output to a target node parameter
 *
 * Handles both streaming (connect GainNode) and batch (setValueCurveAtTime) modes
 *
 * @param {Object} targetParam - Target AudioParam or node
 * @param {number} outputIndex - CPPN output index
 * @param {Map<number, GainNode>} wrapperNodes - Wrapper nodes (streaming mode)
 * @param {Float32Array} curveData - Pre-rendered curve (batch mode)
 * @param {string} mode - 'streaming' or 'batch'
 * @param {number} startTime - Start time for setValueCurveAtTime
 * @param {number} duration - Duration for setValueCurveAtTime
 */
export function connectCPPNToParam(
  targetParam,
  outputIndex,
  wrapperNodes,
  curveData,
  mode,
  startTime,
  duration
) {
  if (mode === 'streaming' && wrapperNodes) {
    // Streaming mode: connect wrapper GainNode to parameter
    const wrapperNode = wrapperNodes.get(outputIndex);
    if (!wrapperNode) {
      throw new Error(`No wrapper node found for CPPN output ${outputIndex}`);
    }

    // Connect the GainNode output to the target parameter
    wrapperNode.connect(targetParam);

    return { type: 'connected', node: wrapperNode };

  } else if (curveData) {
    // Batch mode: use setValueCurveAtTime
    // Note: This is typically called by virtual-audio-graph with the curve
    return ['setValueCurveAtTime', curveData, startTime, duration];

  } else {
    throw new Error('Missing curve data for batch mode or wrapper nodes for streaming mode');
  }
}

/**
 * Cleanup wrapper nodes when done
 *
 * @param {Map<number, GainNode>} wrapperNodes - Wrapper nodes to disconnect and cleanup
 */
export function cleanupWrapperNodes(wrapperNodes) {
  if (!wrapperNodes) return;

  for (const [outputIndex, gainNode] of wrapperNodes.entries()) {
    try {
      gainNode.disconnect();
    } catch (e) {
      // Already disconnected, ignore
    }
  }

  wrapperNodes.clear();
  console.log('CPPN wrapper nodes cleaned up');
}

export default {
  createCPPNWrapperNodes,
  getCPPNOutputSource,
  connectCPPNToParam,
  cleanupWrapperNodes
};
