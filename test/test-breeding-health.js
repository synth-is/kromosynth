#!/usr/bin/env node
/**
 * Breeding Health Test
 * 
 * This test verifies that our recent fixes for CPPN-patch synchronization
 * and buffer connections are working correctly.
 * 
 * What we're testing:
 * 1. Fresh genomes (generation 0) should render without warnings
 * 2. Mutated genomes should not produce orphaned wavetable/additive nodes
 * 3. Crossover offspring should have proper CPPN connectivity
 * 4. The "No value curves for wavetable" warning should not appear
 * 5. The "Cleaned up X dangling connections" message should be minimal (ideally 0)
 * 
 * Run with: node test-breeding-health.js
 */

import {
  getNewAudioSynthesisGenome,
  getNewAudioSynthesisGenomeByMutation,
  getAudioBufferFromGenomeAndMeta
} from '../index.js';
import NodeWebAudioAPI from 'node-web-audio-api';
const { AudioContext, OfflineAudioContext } = NodeWebAudioAPI;

// Test configuration
const CONFIG = {
  SAMPLE_RATE: 48000,
  DURATION: 0.5,
  NUM_GENERATIONS: 10,           // Number of mutation generations
  NUM_GENOMES_PER_GEN: 3,        // Number of genomes to test per generation
  NUM_CROSSOVERS: 5,             // Number of crossover tests
  PROBABILITY_MUTATE_CPPN: 0.8,
  PROBABILITY_MUTATE_PATCH: 0.5, // Higher to encourage wavetable/additive mutations
};

// Minimal evoParams needed for crossover (requires audioGraph.defaultParameters)
const DEFAULT_EVO_PARAMS = {
  audioGraph: {
    defaultParameters: {}
  }
};

// Capture console warnings
const capturedWarnings = [];
const capturedCleanups = [];
const originalLog = console.log;
const originalWarn = console.warn;

function captureConsole() {
  capturedWarnings.length = 0;
  capturedCleanups.length = 0;
  
  console.log = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('No value curves for wavetable')) {
      capturedWarnings.push(msg);
    }
    if (msg.includes('Cleaned up') && msg.includes('dangling')) {
      capturedCleanups.push(msg);
    }
    originalLog.apply(console, args);
  };
  
  console.warn = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('output index') || msg.includes('exceeds')) {
      capturedWarnings.push(msg);
    }
    originalWarn.apply(console, args);
  };
}

function restoreConsole() {
  console.log = originalLog;
  console.warn = originalWarn;
}

let audioCtx;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: CONFIG.SAMPLE_RATE });
  }
  return audioCtx;
}

function getOfflineContext(duration) {
  return new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(CONFIG.SAMPLE_RATE * duration),
    sampleRate: CONFIG.SAMPLE_RATE
  });
}

async function renderGenome(genome) {
  const genomeAndMeta = {
    genome,
    duration: CONFIG.DURATION,
    noteDelta: 0,
    velocity: 0.5,
    reverse: false,
    useOvertoneInharmonicityFactors: true
  };

  const buffer = await getAudioBufferFromGenomeAndMeta(
    genomeAndMeta,
    CONFIG.DURATION,
    0,    // noteDelta
    0.5,  // velocity
    false, // reverse
    false, // asDataArray
    getOfflineContext(CONFIG.DURATION),
    getAudioContext(),
    true,  // useOvertoneInharmonicityFactors
    false, // useGPU
    false, // antiAliasing
    false  // frequencyUpdatesApplyToAllPatchNetworkOutputs
  );

  return buffer;
}

function analyzeBuffer(buffer) {
  if (!buffer) return { valid: false, reason: 'null buffer' };
  
  const samples = buffer.getChannelData(0);
  let validSamples = 0, zeros = 0, nans = 0, infs = 0, peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (isNaN(s)) {
      nans++;
    } else if (!isFinite(s)) {
      infs++;
    } else if (s === 0) {
      zeros++;
    } else {
      validSamples++;
      peak = Math.max(peak, Math.abs(s));
    }
  }

  return {
    valid: nans === 0 && infs === 0,
    totalSamples: samples.length,
    validSamples,
    zeros,
    nans,
    infs,
    peak,
    hasAudio: validSamples > samples.length * 0.01 // At least 1% non-zero
  };
}

function countNodeTypes(asNEATPatch) {
  const counts = {
    wavetable: 0,
    additive: 0,
    networkOutputNodes: 0
  };
  
  if (!asNEATPatch || !asNEATPatch.nodes) return counts;
  
  asNEATPatch.nodes.forEach(node => {
    if (node.name === 'WavetableNode') counts.wavetable++;
    if (node.name === 'AdditiveSynthesisNode') counts.additive++;
    if (['NetworkOutputNode', 'NoteNetworkOutputNode', 
         'PartialNetworkOutputNode', 'PartialEnvelopeNetworkOutputNode'].includes(node.name)) {
      counts.networkOutputNodes++;
    }
  });
  
  return counts;
}

// ============================================================================
// TEST CASES
// ============================================================================

async function testFreshGenome() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Fresh Genome (Generation 0)');
  console.log('='.repeat(60));
  
  captureConsole();
  
  const genome = getNewAudioSynthesisGenome(
    `test-${Date.now()}`,
    0,
    undefined,
    undefined,
    false  // oneCPPNPerFrequency
  );
  
  console.log('Created fresh genome, now rendering...');
  const buffer = await renderGenome(genome);
  const analysis = analyzeBuffer(buffer);
  const nodeCounts = countNodeTypes(genome.asNEATPatch);
  
  restoreConsole();
  
  console.log('\nResults:');
  console.log(`  Node counts: wavetable=${nodeCounts.wavetable}, additive=${nodeCounts.additive}, networkOutputs=${nodeCounts.networkOutputNodes}`);
  console.log(`  Audio analysis: valid=${analysis.valid}, peak=${analysis.peak.toFixed(4)}, hasAudio=${analysis.hasAudio}`);
  console.log(`  Warnings captured: ${capturedWarnings.length}`);
  console.log(`  Cleanup operations: ${capturedCleanups.length}`);
  
  const passed = analysis.valid && capturedWarnings.length === 0;
  console.log(`\n${passed ? '✅' : '❌'} TEST 1: ${passed ? 'PASSED' : 'FAILED'}`);
  
  if (capturedWarnings.length > 0) {
    console.log('  Warnings:');
    capturedWarnings.forEach(w => console.log(`    - ${w}`));
  }
  
  return { passed, warnings: [...capturedWarnings], cleanups: [...capturedCleanups] };
}

async function testMutationLineage() {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST 2: Mutation Lineage (${CONFIG.NUM_GENERATIONS} generations)`);
  console.log('='.repeat(60));
  
  const evolutionRunId = `test-mutation-${Date.now()}`;
  let currentGenome = getNewAudioSynthesisGenome(
    evolutionRunId, 0, undefined, undefined, false
  );
  
  const results = {
    totalMutations: 0,
    failedMutations: 0,
    totalWarnings: 0,
    totalCleanups: 0,
    generations: []
  };
  
  for (let gen = 1; gen <= CONFIG.NUM_GENERATIONS; gen++) {
    captureConsole();
    
    console.log(`\n--- Generation ${gen} ---`);
    
    const mutatedGenome = await getNewAudioSynthesisGenomeByMutation(
      [currentGenome],
      evolutionRunId,
      gen,
      undefined,
      'test-mutation',
      getAudioContext(),
      CONFIG.PROBABILITY_MUTATE_CPPN,
      CONFIG.PROBABILITY_MUTATE_PATCH,
      {},  // asNEATMutationParams
      undefined,  // evoParams
      OfflineAudioContext,
      0.5  // patchFitnessTestDuration
    );
    
    results.totalMutations++;
    
    if (!mutatedGenome) {
      console.log('  ⚠️ Mutation failed (returned undefined)');
      results.failedMutations++;
      restoreConsole();
      continue;
    }
    
    const nodeCounts = countNodeTypes(mutatedGenome.asNEATPatch);
    console.log(`  Nodes: wavetable=${nodeCounts.wavetable}, additive=${nodeCounts.additive}, networkOutputs=${nodeCounts.networkOutputNodes}`);
    
    // Render to check for warnings
    try {
      const buffer = await renderGenome(mutatedGenome);
      const analysis = analyzeBuffer(buffer);
      console.log(`  Audio: valid=${analysis.valid}, peak=${analysis.peak.toFixed(4)}`);
    } catch (err) {
      console.log(`  ❌ Render error: ${err.message}`);
    }
    
    const genWarnings = [...capturedWarnings];
    const genCleanups = [...capturedCleanups];
    
    results.totalWarnings += genWarnings.length;
    results.totalCleanups += genCleanups.length;
    results.generations.push({
      gen,
      warnings: genWarnings.length,
      cleanups: genCleanups.length,
      nodeCounts
    });
    
    if (genWarnings.length > 0) {
      console.log(`  ⚠️ Warnings: ${genWarnings.length}`);
    }
    if (genCleanups.length > 0) {
      console.log(`  🧹 Cleanups: ${genCleanups.length}`);
    }
    
    restoreConsole();
    currentGenome = mutatedGenome;
  }
  
  const passed = results.totalWarnings === 0 && results.failedMutations < CONFIG.NUM_GENERATIONS * 0.5;
  
  console.log('\n--- Summary ---');
  console.log(`  Total mutations: ${results.totalMutations}`);
  console.log(`  Failed mutations: ${results.failedMutations}`);
  console.log(`  Total warnings: ${results.totalWarnings}`);
  console.log(`  Total cleanups: ${results.totalCleanups}`);
  console.log(`\n${passed ? '✅' : '❌'} TEST 2: ${passed ? 'PASSED' : 'FAILED'}`);
  
  return { passed, ...results };
}

async function testCrossover() {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST 3: Crossover (${CONFIG.NUM_CROSSOVERS} tests)`);
  console.log('='.repeat(60));
  
  const evolutionRunId = `test-crossover-${Date.now()}`;
  
  // Create two parent lineages
  let parent1 = getNewAudioSynthesisGenome(evolutionRunId, 0, 0, undefined, false);
  let parent2 = getNewAudioSynthesisGenome(evolutionRunId, 0, 1, undefined, false);
  
  // Mutate each a few times to diversify
  for (let i = 0; i < 3; i++) {
    const p1Mutated = await getNewAudioSynthesisGenomeByMutation(
      [parent1], evolutionRunId, i + 1, 0, 'test',
      getAudioContext(), 0.8, 0.5, {}, DEFAULT_EVO_PARAMS, OfflineAudioContext, 0.5
    );
    if (p1Mutated) parent1 = p1Mutated;
    
    const p2Mutated = await getNewAudioSynthesisGenomeByMutation(
      [parent2], evolutionRunId, i + 1, 1, 'test',
      getAudioContext(), 0.8, 0.5, {}, DEFAULT_EVO_PARAMS, OfflineAudioContext, 0.5
    );
    if (p2Mutated) parent2 = p2Mutated;
  }
  
  const results = {
    totalCrossovers: 0,
    failedCrossovers: 0,
    totalWarnings: 0,
    totalCleanups: 0
  };
  
  for (let i = 0; i < CONFIG.NUM_CROSSOVERS; i++) {
    captureConsole();
    
    console.log(`\n--- Crossover ${i + 1} ---`);
    
    // Crossover: pass both parents
    const offspring = await getNewAudioSynthesisGenomeByMutation(
      [parent1, parent2],  // Both parents for crossover
      evolutionRunId,
      10 + i,
      undefined,
      'test-crossover',
      getAudioContext(),
      0.5,  // probabilityMutatingWaveNetwork
      0.5,  // probabilityMutatingPatch
      {},
      DEFAULT_EVO_PARAMS,  // Need evoParams for crossover (audioGraph.defaultParameters)
      OfflineAudioContext,
      0.5
    );
    
    results.totalCrossovers++;
    
    if (!offspring) {
      console.log('  ⚠️ Crossover failed (returned undefined)');
      results.failedCrossovers++;
      restoreConsole();
      continue;
    }
    
    const nodeCounts = countNodeTypes(offspring.asNEATPatch);
    console.log(`  Offspring nodes: wavetable=${nodeCounts.wavetable}, additive=${nodeCounts.additive}, networkOutputs=${nodeCounts.networkOutputNodes}`);
    
    // Render to check for warnings
    try {
      const buffer = await renderGenome(offspring);
      const analysis = analyzeBuffer(buffer);
      console.log(`  Audio: valid=${analysis.valid}, peak=${analysis.peak.toFixed(4)}`);
    } catch (err) {
      console.log(`  ❌ Render error: ${err.message}`);
    }
    
    results.totalWarnings += capturedWarnings.length;
    results.totalCleanups += capturedCleanups.length;
    
    if (capturedWarnings.length > 0) {
      console.log(`  ⚠️ Warnings: ${capturedWarnings.length}`);
    }
    if (capturedCleanups.length > 0) {
      console.log(`  🧹 Cleanups: ${capturedCleanups.length}`);
    }
    
    restoreConsole();
  }
  
  const passed = results.totalWarnings === 0 && results.failedCrossovers < CONFIG.NUM_CROSSOVERS * 0.5;
  
  console.log('\n--- Summary ---');
  console.log(`  Total crossovers: ${results.totalCrossovers}`);
  console.log(`  Failed crossovers: ${results.failedCrossovers}`);
  console.log(`  Total warnings: ${results.totalWarnings}`);
  console.log(`  Total cleanups: ${results.totalCleanups}`);
  console.log(`\n${passed ? '✅' : '❌'} TEST 3: ${passed ? 'PASSED' : 'FAILED'}`);
  
  return { passed, ...results };
}

async function testAggressiveMutation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Aggressive Mutation (high patch mutation rate)');
  console.log('='.repeat(60));
  
  const evolutionRunId = `test-aggressive-${Date.now()}`;
  let currentGenome = getNewAudioSynthesisGenome(
    evolutionRunId, 0, undefined, undefined, false
  );
  
  const results = {
    totalMutations: 0,
    wavetablesCreated: 0,
    additivesCreated: 0,
    totalWarnings: 0,
    totalCleanups: 0
  };
  
  // High mutation rate to encourage wavetable/additive creation
  for (let i = 0; i < 20; i++) {
    captureConsole();
    
    const mutatedGenome = await getNewAudioSynthesisGenomeByMutation(
      [currentGenome],
      evolutionRunId,
      i + 1,
      undefined,
      'test-aggressive',
      getAudioContext(),
      0.9,   // High CPPN mutation
      0.9,   // High patch mutation
      {},
      undefined,
      OfflineAudioContext,
      0.5
    );
    
    results.totalMutations++;
    
    if (mutatedGenome) {
      const nodeCounts = countNodeTypes(mutatedGenome.asNEATPatch);
      results.wavetablesCreated += nodeCounts.wavetable;
      results.additivesCreated += nodeCounts.additive;
      
      // Render
      try {
        await renderGenome(mutatedGenome);
      } catch (err) {
        // Ignore render errors, we're focused on warnings
      }
      
      results.totalWarnings += capturedWarnings.length;
      results.totalCleanups += capturedCleanups.length;
      
      currentGenome = mutatedGenome;
    }
    
    restoreConsole();
  }
  
  const passed = results.totalWarnings === 0;
  
  console.log('\n--- Summary ---');
  console.log(`  Total mutations: ${results.totalMutations}`);
  console.log(`  Wavetables created (cumulative): ${results.wavetablesCreated}`);
  console.log(`  Additives created (cumulative): ${results.additivesCreated}`);
  console.log(`  Total warnings: ${results.totalWarnings}`);
  console.log(`  Total cleanups: ${results.totalCleanups}`);
  console.log(`\n${passed ? '✅' : '❌'} TEST 4: ${passed ? 'PASSED' : 'FAILED'}`);
  
  return { passed, ...results };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║             BREEDING HEALTH TEST SUITE                       ║');
  console.log('║  Verifies CPPN-patch sync and buffer connection fixes        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nConfiguration:`);
  console.log(`  Sample rate: ${CONFIG.SAMPLE_RATE}`);
  console.log(`  Duration: ${CONFIG.DURATION}s`);
  console.log(`  Mutation generations: ${CONFIG.NUM_GENERATIONS}`);
  console.log(`  Crossover tests: ${CONFIG.NUM_CROSSOVERS}`);
  
  const allResults = {};
  
  try {
    allResults.freshGenome = await testFreshGenome();
    allResults.mutationLineage = await testMutationLineage();
    allResults.crossover = await testCrossover();
    allResults.aggressiveMutation = await testAggressiveMutation();
  } catch (err) {
    console.error('\n❌ Test suite error:', err);
    process.exit(1);
  }
  
  // Final summary
  console.log('\n' + '═'.repeat(60));
  console.log('FINAL RESULTS');
  console.log('═'.repeat(60));
  
  const tests = [
    { name: 'Fresh Genome', result: allResults.freshGenome },
    { name: 'Mutation Lineage', result: allResults.mutationLineage },
    { name: 'Crossover', result: allResults.crossover },
    { name: 'Aggressive Mutation', result: allResults.aggressiveMutation }
  ];
  
  let allPassed = true;
  tests.forEach(({ name, result }) => {
    const status = result.passed ? '✅' : '❌';
    console.log(`  ${status} ${name}`);
    if (!result.passed) allPassed = false;
  });
  
  const totalWarnings = Object.values(allResults).reduce((sum, r) => 
    sum + (r.warnings?.length || r.totalWarnings || 0), 0);
  const totalCleanups = Object.values(allResults).reduce((sum, r) => 
    sum + (r.cleanups?.length || r.totalCleanups || 0), 0);
  
  console.log(`\nTotal warnings across all tests: ${totalWarnings}`);
  console.log(`Total cleanup operations across all tests: ${totalCleanups}`);
  
  if (allPassed) {
    console.log('\n✅ ALL TESTS PASSED - Breeding health is good!');
    console.log('   New genomes should not produce orphaned wavetable/additive nodes.');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED - Review the warnings above.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
