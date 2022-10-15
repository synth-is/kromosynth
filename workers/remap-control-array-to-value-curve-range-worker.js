import { remapNumberToRange } from '../util/range';

onmessage = (e) => {

  const valueCurve = new Float32Array( e.data.gainControlArray.map( oneGainValue => {
    return remapNumberToRange( oneGainValue, -1, 1, 0, 1 );
  }) );

  postMessage({
    valueCurve
  }, [valueCurve.buffer] );
}
