/**
 * Audio Graph Compiler
 *
 * Converts array-based audio graph definitions (from forked virtual-audio-graph)
 * to function-based definitions (for upstream virtual-audio-graph v1.6+)
 *
 * This allows genome-generated graphs to continue using array syntax while
 * being compatible with the latest virtual-audio-graph that supports AudioWorklets.
 */

import * as vagNamespace from 'virtual-audio-graph';

// Handle CJS/ESM interop
// The package exports both named exports (createNode, gain, etc.) and a default export (factory function).
// In Node.js ESM importing a CJS module, vagNamespace.default is the factory function.
// In Browser ESM, it depends on the bundler but typically vagNamespace.default is also the factory.

let createVirtualAudioGraph;

// Priority order:
// 1. Try vagNamespace.default (most common in both Node and Browser ESM)
// 2. Try vagNamespace itself if it's a function (direct function export)
// 3. Try vagNamespace.default.default (double-wrapped CJS)
if (typeof vagNamespace.default === 'function') {
  createVirtualAudioGraph = vagNamespace.default;
} else if (typeof vagNamespace === 'function') {
  createVirtualAudioGraph = vagNamespace;
} else if (vagNamespace.default && typeof vagNamespace.default.default === 'function') {
  createVirtualAudioGraph = vagNamespace.default.default;
} else {
  // Debug logging for troubleshooting
  console.error('virtual-audio-graph import structure:', {
    typeOfNamespace: typeof vagNamespace,
    typeOfDefault: typeof vagNamespace.default,
    hasDefaultDefault: !!(vagNamespace.default && vagNamespace.default.default),
    keys: Object.keys(vagNamespace),
    defaultKeys: vagNamespace.default ? Object.keys(vagNamespace.default) : []
  });
  throw new Error('Failed to import createVirtualAudioGraph from virtual-audio-graph. Check console for details.');
}

// Determine where the node factories are located
let vagNodes;
if (typeof vagNamespace.createNode === 'function') {
  // ESM: Named exports available on namespace
  vagNodes = vagNamespace;
} else if (createVirtualAudioGraph && typeof createVirtualAudioGraph.createNode === 'function') {
  // CJS: Properties attached to the default export function
  vagNodes = createVirtualAudioGraph;
} else {
  // Fallback
  vagNodes = vagNamespace;
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

    // Check custom nodes first (for wavetable, additive, feedbackDelay, etc.)
    const nodeFactory = customNodes[nodeType] || vagNodes[nodeType];

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
