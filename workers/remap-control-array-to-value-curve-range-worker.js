// import { expose, Transfer } from "threads/worker";
import { remapNumberToRange } from '../util/range.js';

export function remapControlArrayToValueCurveRange(gainControlArrayBuffer) {
  const gainControlArray = new Float32Array( gainControlArrayBuffer );
  const valueCurve = new Float32Array( gainControlArray.map( oneGainValue => {
    return remapNumberToRange( oneGainValue, -1, 1, 0, 1 );
  }) );
  // return Transfer(valueCurve.buffer);
  // return valueCurve.buffer;
  return valueCurve
}

// expose(remapControlArrayToValueCurveRange);



// const onmessage = (e) => {

//   const valueCurve = new Float32Array( e.data.gainControlArray.map( oneGainValue => {
//     return remapNumberToRange( oneGainValue, -1, 1, 0, 1 );
//   }) );

//   postMessage({
//     valueCurve
//   }, [valueCurve.buffer] );
// }

// export default onmessage;
