#!/usr/bin/env node
/**
 * Inspect the structure of a specific genome
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';

const gunzip = promisify(zlib.gunzip);

const GENOME_ID = '01JF2N9RZ07V06EJ4DJ9ZGCM2D';
const DB_PATH = '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';

async function inspectGenome() {
  console.log(`Inspecting genome: ${GENOME_ID}\n`);

  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT data FROM genomes WHERE id = ?').get(GENOME_ID);

  if (!row) {
    console.error('Genome not found!');
    process.exit(1);
  }

  const jsonData = await gunzip(row.data);
  const genomeData = JSON.parse(jsonData);
  const genome = genomeData.genome || genomeData;

  let asNEATPatch = genome.asNEATPatch;
  if (typeof asNEATPatch === 'string') {
    asNEATPatch = JSON.parse(asNEATPatch);
  }

  console.log('='.repeat(80));
  console.log('GENOME STRUCTURE');
  console.log('='.repeat(80));
  console.log();

  console.log('Top-level keys:', Object.keys(genome));
  console.log();

  console.log('asNEATPatch keys:', Object.keys(asNEATPatch));
  console.log();

  if (asNEATPatch.nodes) {
    console.log(`Total nodes: ${asNEATPatch.nodes.length}`);
    console.log();

    console.log('Node types:');
    const nodeTypes = {};
    asNEATPatch.nodes.forEach(node => {
      const name = node.name || 'unknown';
      nodeTypes[name] = (nodeTypes[name] || 0) + 1;
    });

    for (const [name, count] of Object.entries(nodeTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: ${count}`);
    }
    console.log();
  }

  // Convert to audio patch to see the graph structure
  console.log('='.repeat(80));
  console.log('AUDIO PATCH STRUCTURE');
  console.log('='.repeat(80));
  console.log();

  const asNEATNetworkJSONString = JSON.stringify(asNEATPatch);
  const synthIsPatch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

  console.log('Patch keys:', Object.keys(synthIsPatch));
  console.log();

  if (synthIsPatch.networkOutputs) {
    console.log(`Network outputs: ${synthIsPatch.networkOutputs.length}`);

    // Show first few outputs
    console.log('\nFirst 3 network outputs:');
    synthIsPatch.networkOutputs.slice(0, 3).forEach((output, i) => {
      console.log(`\n  Output ${i}:`);
      console.log(`    networkOutput: ${output.networkOutput}`);
      console.log(`    frequency: ${output.frequency}`);
      if (output.audioGraphNodes) {
        console.log(`    audioGraphNodes:`, Object.keys(output.audioGraphNodes));

        // Show first audio graph node connections
        const firstNodeKey = Object.keys(output.audioGraphNodes)[0];
        if (firstNodeKey) {
          console.log(`      ${firstNodeKey}:`, output.audioGraphNodes[firstNodeKey]);
        }
      }
    });
  }

  if (synthIsPatch.audioGraph) {
    console.log('\n\naudioGraph keys:', Object.keys(synthIsPatch.audioGraph));
    console.log(`Total graph nodes: ${Object.keys(synthIsPatch.audioGraph).length}`);

    // Check for wavetable/additive nodes
    console.log('\nNode types in audioGraph:');
    const graphNodeTypes = {};
    for (const [nodeKey, nodeData] of Object.entries(synthIsPatch.audioGraph)) {
      const nodeType = nodeData[0]; // First element is node type
      graphNodeTypes[nodeType] = (graphNodeTypes[nodeType] || 0) + 1;
    }

    for (const [type, count] of Object.entries(graphNodeTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Show wavetable node details
    console.log('\nWavetable node details:');
    for (const [nodeKey, nodeData] of Object.entries(synthIsPatch.audioGraph)) {
      if (nodeData[0] === 'wavetable') {
        console.log(`  ${nodeKey}:`, JSON.stringify(nodeData, null, 2));
      }
    }
  }

  db.close();
}

inspectGenome().catch(err => {
  console.error('Inspection failed:', err);
  console.error(err.stack);
  process.exit(1);
});
