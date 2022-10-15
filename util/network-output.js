/**
 * Given an object with index and frequency attributes,
 * returns a string value based on the value of those attributes,
 * usable as a key, such as 1_880
 * @param  {[type]} output Object with index and frequency attributes
 * @return {[type]}        String to be used as a key.
 */
function getMemberOutputsKey( output ) {
  return `${output.index}_${output.frequency}`;
}

export {
  getMemberOutputsKey
}
