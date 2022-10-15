export function randomFromInterval( from, to ) {
  return Math.floor(Math.random()*(to-from+1)+from);
}

export function halfChance() {
  return ( Math.random() < 0.5 ? 0 : 1 );
}
