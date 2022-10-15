onmessage = (e) => {

  const targetSampleCount = e.data.targetSampleCount;
  const outputIndex = e.data.outputIndex;
  const originalValues = e.data.originalValues;

  const downsampledValues = getDownsampledArray( originalValues, targetSampleCount );

  postMessage({
    outputIndex,
    downsampledValues
  }, [downsampledValues.buffer] );
}

function getDownsampledArray( originalValues, targetSampleCount ) {

  const samplesInSection = Math.floor( originalValues.length / targetSampleCount );

  const downsampled = new Float32Array( targetSampleCount );
  let downsampledIndex = 0;
  originalValues.reduce(function(previousValue, currentValue, currentIndex, array) {
    if( currentIndex % samplesInSection ) {
      return previousValue + currentValue;
    } else {
      const averageInSection = previousValue / samplesInSection;
      downsampled[downsampledIndex] = averageInSection;
      downsampledIndex++;
      return currentValue;
    }
  });
  return downsampled;
}
