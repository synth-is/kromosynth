import { expose, Transfer } from "threads/worker";

expose(function gainValuesPerAudioWave(audioWaveCount, controlWave ) {
    const oneWaveFraction = 2 / audioWaveCount; // 2 as -1 to 1 spans two integers
    const oneWaveMiddleFraction = oneWaveFraction / 2;
    const waveSpectrumSpans = getSpectrumSpansForAudioWaves(
        audioWaveCount, oneWaveFraction, oneWaveMiddleFraction );
    const gainValues = new Map();
    const controlWaveArray = new Float32Array(controlWave);
    [...Array(audioWaveCount).keys()].forEach( audioWaveNr => {
      gainValues.set( audioWaveNr, new Float32Array(controlWaveArray.length) );
    });
    controlWaveArray.forEach( (oneSample, sampleIndex) => {
      for( let [waveNr, spectrum] of waveSpectrumSpans.entries() ) {
        if( spectrum.start < oneSample && oneSample < spectrum.end ) {
          let gain = 1 - Math.abs(spectrum.middle - oneSample) / oneWaveFraction;
          gainValues.get( waveNr )[sampleIndex] = gain;
        } else {
          gainValues.get( waveNr )[sampleIndex] = 0;
        }
      }
    });
    const arrayBuffersToTransfer = [...gainValues.values()].map( gains => gains.buffer );
    // TODO: optimize:  Node.js / threads.js doesn't seem to support transferring an array of arraybuffers
    // - as has been possible with web workers - might want to return a concatenated array buffer
    //  and split it up on the receiving end?
    // return Transfer( arrayBuffersToTransfer );
    return arrayBuffersToTransfer;
  });

// const onmessage = (e) => {
//
//   const oneWaveFraction = 2 / e.data.audioWaveCount; // 2 as -1 to 1 spans two integers
//   const oneWaveMiddleFraction = oneWaveFraction / 2;
//   const waveSpectrumSpans = getSpectrumSpansForAudioWaves(
//       e.data.audioWaveCount, oneWaveFraction, oneWaveMiddleFraction );
//   const gainValues = new Map();
//   [...Array(e.data.audioWaveCount).keys()].forEach( audioWaveNr => {
//     gainValues.set( audioWaveNr, new Float32Array(e.data.controlWave.length) );
//   });
//   e.data.controlWave.forEach( (oneSample, sampleIndex) => {
//     for( let [waveNr, spectrum] of waveSpectrumSpans.entries() ) {
//       if( spectrum.start < oneSample && oneSample < spectrum.end ) {
//         let gain = 1 - Math.abs(spectrum.middle - oneSample) / oneWaveFraction;
//         gainValues.get( waveNr )[sampleIndex] = gain;
//       } else {
//         gainValues.get( waveNr )[sampleIndex] = 0;
//       }
//     }
//   });
//   postMessage({
//     gainValues
//   }, [...gainValues.values()].map( gains => gains.buffer ) );
// }

function getSpectrumSpansForAudioWaves( audioWaveCount, oneWaveFraction, oneWaveMiddleFraction ) {
  const waveSpectrumSpans = new Map();
  for( let i=0; i < audioWaveCount; i++ ) {
    let spectrumStart = i * oneWaveFraction - 1 // -1 as we're working with the range -1 to 1
    let spectrumStartFading =
      spectrumStart - ( i ? oneWaveMiddleFraction : 0 ); // to start fading in the adjacent span
    let spectrumMiddle = spectrumStart + oneWaveMiddleFraction;
    let spectrumEnd = spectrumStart + oneWaveFraction
    let spectrumEndFading =
      spectrumEnd + ( (i+1) < audioWaveCount ? oneWaveMiddleFraction : 0 ); // to fade into the adjacent span
    waveSpectrumSpans.set( i, {
      start: spectrumStartFading,
      middle: spectrumMiddle,
      end: spectrumEndFading
    });
  }
  // console.log(`oneWaveFraction: ${oneWaveFraction}, oneWaveMiddleFraction: ${oneWaveMiddleFraction}`);
  // console.log("waveSpectrumSpans");console.log(waveSpectrumSpans);
  return waveSpectrumSpans;
}

// export default onmessage;
