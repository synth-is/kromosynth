export const addInputFunctionsToGPU = ( gpu ) => {
  gpu.addFunction( getBias, {name: 'getBias'} );
  gpu.addFunction( getInputSignalMain, {name: 'getInputSignalMain'} );
  gpu.addFunction( getInputSignalExtra, {name: 'getInputSignalExtra'} );
  gpu.addFunction( spike, {name: 'spike'} );
  gpu.addFunction( stepActivation, {name: 'stepActivation'} );
}

function getBias() {
 return 1.0;
}
function getInputSignalMain() {
 const sampleNumber = this.thread.x;
 const _totalSampleCount = this.constants.totalSampleCount;
 const rangeFraction = sampleNumber / (_totalSampleCount-1);
 return ((rangeFraction * 2) - 1); //* this.constants.velocity; // this.lerp( -1, 1, rangeFraction );
 // return (-1*this.constants.velocity) + rangeFraction * ( 1 - (-1*this.constants.velocity) )
}
function getInputSignalExtra( mainInputSignal ) {
 let extraInput = 0.0;
 if( this.constants.variationOnPeriods === 1 ) {
   extraInput = Math.sin( this.constants.inputPeriods * mainInputSignal );
 } else {
   extraInput = Math.sin( this.constants.inputPeriods * Math.abs(mainInputSignal) );
   for(var t=0;t<0;t++){ break; } // https://github.com/gpujs/gpu.js/issues/152#issue-244924706
 }
 return extraInput * this.constants.velocity;
}
function spike( inputSignal ) {
 let result = 0.0;
 if(Math.floor(inputSignal)%2 == 0) {
   result = 1.0 - 2.0 * (inputSignal-Math.floor(inputSignal));
 } else {
   result = -1.0 + 2.0 * (inputSignal-Math.floor(inputSignal));
   for(var t=0;t<0;t++){ break; } // https://github.com/gpujs/gpu.js/issues/152
 }
 return result;
}
function stepActivation( inputSignal ) {
 if( inputSignal <= 0.0 ) {
   return -1.0;
 } else {
   for(var t=0;t<0;t++){ break; } // https://github.com/gpujs/gpu.js/issues/152
   return 1.0;
 }
 // return "(((" + stringToEnclose + ') <= 0.0) ? 0.0 : 1.0)';
}
