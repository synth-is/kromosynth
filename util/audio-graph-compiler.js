/**
 * Audio Graph Compiler
 *
 * Converts array-based audio graph definitions (from forked virtual-audio-graph)
 * to function-based definitions (for upstream virtual-audio-graph v1.6+)
 *
 * This allows genome-generated graphs to continue using array syntax while
 * being compatible with the latest virtual-audio-graph that supports AudioWorklets.
 */

// Import both default and all named exports
import createVirtualAudioGraphImport, * as vagNodes from 'virtual-audio-graph';

// Handle CJS/ESM interop - sometimes default is wrapped
const createVirtualAudioGraph = createVirtualAudioGraphImport?.default || createVirtualAudioGraphImport;

// Detect environment
const IS_BROWSER = typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';

/**
 * Custom channelMerger factory that properly handles numberOfInputs parameter
 *
 * In browsers, the Web Audio API requires numberOfInputs to be set via the constructor,
 * and setting it as a property causes an error. However, node-web-audio-api is more
 * permissive and allows it. This function handles both environments correctly.
 */
function createCustomChannelMerger(output, params = {}) {
  if (IS_BROWSER) {
    // Browser: strip out numberOfInputs to avoid "Cannot set property" error
    const { numberOfInputs, ...safeParams } = params;

    // Log warning if numberOfInputs is non-standard
    if (numberOfInputs && numberOfInputs !== 6) {
      console.warn(`channelMerger numberOfInputs=${numberOfInputs} ignored in browser (using default=6)`);
    }

    // Use the standard channelMerger but without the problematic numberOfInputs parameter
    return vagNodes.channelMerger(output, safeParams);
  } else {
    // Node.js with node-web-audio-api: pass through all params (works fine)
    return vagNodes.channelMerger(output, params);
  }
}

/**
 * Compile an array-based audio graph to function-based format
 *
 * @param {Object} arrayBasedGraph - Graph in format: { key: [nodeType, output, params] }
 * @returns {Object} - Graph in format: { key: nodeFactory(output, params) }
 *
 * @example
 * Input:
 * {
 *   0: ['gain', 'output', {gain: 0.5}],
 *   1: ['oscillator', 0, {frequency: 440}]
 * }
 *
 * Output:
 * {
 *   0: gain('output', {gain: 0.5}),
 *   1: oscillator(0, {frequency: 440})
 * }
 */
export function compileAudioGraph(arrayBasedGraph, customNodes = {}) {
  if (!arrayBasedGraph || typeof arrayBasedGraph !== 'object') {
    throw new Error('compileAudioGraph requires an object');
  }

  const compiledGraph = {};

  for (const [key, nodeDefinition] of Object.entries(arrayBasedGraph)) {
    // Handle both array format and already-compiled function format
    if (typeof nodeDefinition === 'function') {
      // Already compiled - pass through
      compiledGraph[key] = nodeDefinition;
      continue;
    }

    if (!Array.isArray(nodeDefinition)) {
      throw new Error(`Node definition for key "${key}" must be an array or function, got: ${typeof nodeDefinition}`);
    }

    const [nodeType, output, params = {}] = nodeDefinition;

    // Special case: nodeType is a function (custom node that returns a sub-graph)
    if (typeof nodeType === 'function') {
      // Wrap the custom node function to create a proper virtual-audio-graph custom node
      const customNodeFactory = vagNodes.createNode((nodeParams) => {
        // Call the original function to get the sub-graph
        const subGraph = nodeType(nodeParams || params);

        // Compile the sub-graph recursively
        return compileAudioGraph(subGraph, customNodes);
      });

      // Add the custom node to the compiled graph
      compiledGraph[key] = customNodeFactory(output, params);

      continue;
    }

    // Check custom nodes first (for wavetable, additive, feedbackDelay, channelMerger, etc.)
    let nodeFactory = customNodes[nodeType];

    // Use custom channelMerger for browser compatibility
    if (!nodeFactory && nodeType === 'channelMerger') {
      nodeFactory = createCustomChannelMerger;
    } else if (!nodeFactory) {
      nodeFactory = vagNodes[nodeType];
    }

    if (!nodeFactory) {
      console.warn(`Unknown node type "${nodeType}" for key "${key}" - skipping`);
      continue;
    }

    // Compile: [nodeType, output, params] → nodeFactory(output, params)
    compiledGraph[key] = nodeFactory(output, params);
  }

  return compiledGraph;
}

/**
 * Create a wrapper for createVirtualAudioGraph that auto-compiles array-based graphs
 *
 * This provides backward compatibility with existing code that uses .update()
 * with array-based graph definitions.
 *
 * @param {Object} options - Options for createVirtualAudioGraph
 * @param {Object} customNodes - Custom node factories (wavetable, additive, etc.)
 * @returns {Object} - VirtualAudioGraph instance with compilation wrapper
 */
export function createVirtualAudioGraphWithCompiler(options, customNodes = {}) {
  const virtualAudioGraph = createVirtualAudioGraph(options);

  // Wrap the update method to auto-compile array-based graphs
  const originalUpdate = virtualAudioGraph.update.bind(virtualAudioGraph);

  virtualAudioGraph.update = (graph) => {
    // Check if graph contains array-based definitions
    const needsCompilation = Object.values(graph).some(
      node => Array.isArray(node)
    );

    if (needsCompilation) {
      const compiledGraph = compileAudioGraph(graph, customNodes);
      return originalUpdate(compiledGraph);
    } else {
      // Already function-based or empty
      return originalUpdate(graph);
    }
  };

  return virtualAudioGraph;
}

/**
 * Register custom node factory
 *
 * For custom nodes like 'wavetable', 'additive', 'feedbackDelay' that aren't
 * part of standard Web Audio API, this helper creates a factory function
 * compatible with virtual-audio-graph v1.6+
 *
 * @param {Function} customNodeFn - Function that returns a custom node definition
 * @returns {Function} - Factory function compatible with virtual-audio-graph
 *
 * @example
 * const feedbackDelay = createCustomNodeFactory((output, params) => {
 *   return customNode(output, {
 *     // ... custom node implementation
 *   });
 * });
 */
export function createCustomNodeFactory(customNodeFn) {
  return (output, params) => customNodeFn(output, params);
}

/**
 * Helper to detect if a graph is in array-based format
 *
 * @param {Object} graph - Audio graph to check
 * @returns {boolean} - True if graph uses array-based syntax
 */
export function isArrayBasedGraph(graph) {
  if (!graph || typeof graph !== 'object') return false;
  return Object.values(graph).some(node => Array.isArray(node));
}

export default {
  compileAudioGraph,
  createVirtualAudioGraphWithCompiler,
  createCustomNodeFactory,
  isArrayBasedGraph
};
