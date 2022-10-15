import neatjs from 'neatjs';

// check if the member offspring has the function createOffspringAsexual
// - if not, create a new neatjs instance from the offspring data
export function getParentInstanceFromMember( member ) {
  let parent;
  if( member.offspring.createOffspringAsexual ) {
    parent = member.offspring;
  } else {
    parent = new neatjs.neatGenome( `${Math.random()}`,
      member.offspring.nodes,
      member.offspring.connections,
      member.offspring.inputNodeCount,
      member.offspring.outputNodeCount
    );
  }
  return parent;
}
