import Network from '../as-neat/network';
import neatjs from 'neatjs';

export async function getGenomeFromGenomeString( genomeString ) {
  const genomePartiallyStringified = JSON.parse(genomeString);

  const asNEATPatch = await Network.createFromJSON(
    genomePartiallyStringified.asNEATPatch
  );
  const neatOffspring = genomePartiallyStringified.waveNetwork.offspring;
  genomePartiallyStringified.waveNetwork.offspring = new neatjs.neatGenome(
    `${Math.random()}`,
    neatOffspring.nodes,
    neatOffspring.connections,
    neatOffspring.inputNodeCount,
    neatOffspring.outputNodeCount
  );
  const waveNetwork = genomePartiallyStringified.waveNetwork;
  return { waveNetwork, asNEATPatch };
}
