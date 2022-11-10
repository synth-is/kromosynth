import {GPU} from 'gpu.js';
import { addInputFunctionsToGPU } from '../util/gpu-functions.js';

const onmessage = (e) => {
  const activationStringForOneOutput = e.data.activationStringForOneOutput;
  const sampleCount = e.data.sampleCount;
  const inputPeriods = e.data.inputPeriods;
  const variationOnPeriods = e.data.variationOnPeriods;
  const velocity = e.data.velocity;

  const gpu = new GPU();
  addInputFunctionsToGPU( gpu );

  // TODO: look into combining kernels: https://github.com/gpujs/gpu.js/#combining-kernels

  const oneOutputKernel = gpu.createKernel(
    new Function(activationStringForOneOutput), {
    constants: {
      totalSampleCount: sampleCount,
      inputPeriods: inputPeriods,
      variationOnPeriods: variationOnPeriods ? 1 : 0,
      velocity
    },
    output: [sampleCount]
  } );

  const outputResult = oneOutputKernel();

  postMessage(
    {outputResult}, [outputResult.buffer]
  );
}

export default onmessage;
