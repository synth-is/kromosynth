#!/usr/bin/env node
/**
 * Find genomes in database containing wavetable or additive nodes
 *
 * Usage:
 *   node util/find-dsp-node-genomes.js <db-path>
 *
 * Example:
 *   node util/find-dsp-node-genomes.js /Volumes/T7/evoruns/.../genomes.sqlite
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { promisify } from 'util';
import { patchFromAsNEATnetwork } from './audio-graph-asNEAT-bridge.js';

const gunzip = promisify(zlib.gunzip);

const DB_PATH = process.argv[2] || '/Volumes/T7/evoruns/supervised_and_unsupervised_singleMapBDs/01JF0WEW4BTQSWWKGFR72JQ7J6_evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_AE_retrainIncr50_zScoreNSynthTrain_noveltySel/genomes.sqlite';

/**
 * Check if genome contains nodes of a specific type in audioGraph
 */
function hasNodeType(patch, nodeType) {
  if (!patch || !patch.audioGraph) return false;

  return Object.values(patch.audioGraph).some(nodeData => {
    const type = nodeData[0]?.toLowerCase() || '';
    return type === nodeType.toLowerCase();
  });
}

/**
 * Get node type statistics from audioGraph
 */
function getNodeTypeStats(patch) {
  const stats = {
    wavetable: 0,
    additive: 0,
    oscillator: 0,
    bufferSource: 0,
    gain: 0,
    filter: 0,
    delay: 0,
    other: 0
  };

  if (!patch || !patch.audioGraph) return stats;

  for (const nodeData of Object.values(patch.audioGraph)) {
    const nodeType = nodeData[0]?.toLowerCase() || '';

    if (nodeType.includes('wavetable')) {
      stats.wavetable++;
    } else if (nodeType.includes('additive')) {
      stats.additive++;
    } else if (nodeType.includes('oscillator')) {
      stats.oscillator++;
    } else if (nodeType.includes('buffersource')) {
      stats.bufferSource++;
    } else if (nodeType.includes('gain')) {
      stats.gain++;
    } else if (nodeType.includes('filter') || nodeType.includes('biquad')) {
      stats.filter++;
    } else if (nodeType.includes('delay')) {
      stats.delay++;
    } else {
      stats.other++;
    }
  }

  return stats;
}

async function findDSPNodeGenomes() {
  console.log('Searching for genomes with wavetable and additive nodes...');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH, { readonly: true });

  // Get total count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM genomes').get().count;
  console.log(`Total genomes: ${totalCount}\n`);

  // Find genomes with wavetable or additive nodes
  const results = {
    wavetable: [],
    additive: [],
    both: [],
    neither: 0
  };

  const stmt = db.prepare('SELECT id, data FROM genomes LIMIT 1000');

  let processed = 0;
  for (const row of stmt.iterate()) {
    processed++;

    if (processed % 100 === 0) {
      process.stdout.write(`\rProcessed: ${processed}/${Math.min(1000, totalCount)}...`);
    }

    try {
      const jsonData = await gunzip(row.data);
      const genomeData = JSON.parse(jsonData);
      const genome = genomeData.genome || genomeData;

      let asNEATPatch = genome.asNEATPatch;
      if (typeof asNEATPatch === 'string') {
        asNEATPatch = JSON.parse(asNEATPatch);
      }

      // Convert to audio patch to see audioGraph structure
      const asNEATNetworkJSONString = JSON.stringify(asNEATPatch);
      const patch = patchFromAsNEATnetwork(asNEATNetworkJSONString);

      const hasWavetable = hasNodeType(patch, 'wavetable');
      const hasAdditive = hasNodeType(patch, 'additive');

      if (hasWavetable && hasAdditive) {
        results.both.push({
          id: row.id,
          stats: getNodeTypeStats(patch)
        });
      } else if (hasWavetable) {
        results.wavetable.push({
          id: row.id,
          stats: getNodeTypeStats(patch)
        });
      } else if (hasAdditive) {
        results.additive.push({
          id: row.id,
          stats: getNodeTypeStats(patch)
        });
      } else {
        results.neither++;
      }

    } catch (err) {
      // Skip malformed genomes
    }
  }

  console.log('\n');
  db.close();

  // Print results
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log();

  console.log(`Genomes with BOTH wavetable and additive: ${results.both.length}`);
  if (results.both.length > 0) {
    console.log('Examples:');
    results.both.slice(0, 5).forEach(g => {
      console.log(`  ${g.id} - W:${g.stats.wavetable} A:${g.stats.additive} B:${g.stats.bufferSource} G:${g.stats.gain}`);
    });
    console.log();
  }

  console.log(`Genomes with ONLY wavetable: ${results.wavetable.length}`);
  if (results.wavetable.length > 0) {
    console.log('Examples:');
    results.wavetable.slice(0, 5).forEach(g => {
      console.log(`  ${g.id} - W:${g.stats.wavetable} A:${g.stats.additive} B:${g.stats.bufferSource} G:${g.stats.gain}`);
    });
    console.log();
  }

  console.log(`Genomes with ONLY additive: ${results.additive.length}`);
  if (results.additive.length > 0) {
    console.log('Examples:');
    results.additive.slice(0, 5).forEach(g => {
      console.log(`  ${g.id} - W:${g.stats.wavetable} A:${g.stats.additive} B:${g.stats.bufferSource} G:${g.stats.gain}`);
    });
    console.log();
  }

  console.log(`Genomes with neither: ${results.neither}`);
  console.log();

  // Recommendations
  console.log('='.repeat(80));
  console.log('RECOMMENDED TEST GENOMES');
  console.log('='.repeat(80));
  console.log();

  if (results.wavetable.length > 0) {
    const wavetableExample = results.wavetable[0];
    console.log(`Wavetable test: ${wavetableExample.id}`);
    console.log(`  Nodes: W:${wavetableExample.stats.wavetable} A:${wavetableExample.stats.additive} O:${wavetableExample.stats.oscillator}`);
  }

  if (results.additive.length > 0) {
    const additiveExample = results.additive[0];
    console.log(`Additive test:  ${additiveExample.id}`);
    console.log(`  Nodes: W:${additiveExample.stats.wavetable} A:${additiveExample.stats.additive} O:${additiveExample.stats.oscillator}`);
  }

  if (results.both.length > 0) {
    const bothExample = results.both[0];
    console.log(`Combined test:  ${bothExample.id}`);
    console.log(`  Nodes: W:${bothExample.stats.wavetable} A:${bothExample.stats.additive} O:${bothExample.stats.oscillator}`);
  }

  console.log();
}

findDSPNodeGenomes().catch(err => {
  console.error('Search failed:', err);
  process.exit(1);
});
