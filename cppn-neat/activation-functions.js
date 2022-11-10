export const waveActivationFunction = {
  // sin: "sin",
  triangle: "triangle",
  sawtooth: "sawtooth",
  StepFunction: "StepFunction",
  Sine: "Sine",
  Sine2: "Sine2",

  cos: "cos",
  arctan: "arctan",
  spike: "spike",

  BipolarSigmoid: "BipolarSigmoid",
  PlainSigmoid: "PlainSigmoid",
  Gaussian: "Gaussian",
  Linear: "Linear",
  NullFn: "NullFn"
};

/**
 * Adjust activation functions inside of CPPNs
 * @param cppnjs  A reference to the cppnjs module
 */
export function setActivationFunctions( cppnjs ) {

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=1.0+-+2.0+*+(x-Math.floor(x))&function2=-1.0+%2B+2.0+*+(x-Math.floor(x))&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=290&gheight=130
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.spike] ) {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
        waveActivationFunction.spike,
        {
          functionID: waveActivationFunction.spike,
          functionString: "if(floor(x) is even) 1 - 2*(x-floor(x)) else -1 + 2*(x-floor(x))",
          functionDescription: "Basically a pointy version of sin or cos.",
          functionCalculate: function(inputSignal)
          {
              // console.log("-----inputSignal:",inputSignal);
              if(Math.floor(inputSignal)%2 == 0) return 1.0 - 2.0 * (inputSignal-Math.floor(inputSignal));
              else return -1.0 + 2.0 * (inputSignal-Math.floor(inputSignal));
              // spike(inputSignal);
          },
          functionEnclose: function(stringToEnclose)
          {
              // return "(function(){ if(Math.floor("+stringToEnclose+")%2 == 0) return 1.0 - 2.0 * ("+stringToEnclose+"-Math.floor("+stringToEnclose+"));"
              // +"else return -1.0 + 2.0 * ("+stringToEnclose+"-Math.floor("+stringToEnclose+")); })()";
              return "spike("+stringToEnclose+")"; // defined in a network-activation global
          }
      }
    );
  }

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=(2+*+1+%2F+3.141592653589793)+*+asin(sin(2+*+(3.141592653589793+%2F+(2*3.141592653589793))+*+x))&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.triangle] ) {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
        waveActivationFunction.triangle,
        {
          functionID: waveActivationFunction.triangle,
          functionString: "(2 * amplitudeConstant / Math.PI) * Math.Asin(Math.Sin(2 * (Math.PI / periodConstant) * Convert.ToDouble(variableX)))",
          functionDescription: "Triangle wave.", //  - based on https://stackoverflow.com/a/19374586/169858
          functionCalculate: function(inputSignal)
          {
              const amplitude = 1;
              const period = 2 * Math.PI;
              return (2 * 1 / Math.PI) * Math.asin(Math.sin(2 * (Math.PI / period) * inputSignal));
              // return ((2*amplitude) / Math.PI) * Math.asin( Math.sin( ((2*Math.PI)/period) * inputSignal ) );
              // return 2 * Math.abs( 2 * ( (inputSignal/period) - Math.floor( (inputSignal/period) + .5 ) ) ) - 1;
          },
          functionEnclose: function(stringToEnclose)
          {
              return "(2 * 1 / Math.PI) * Math.asin(Math.sin(2 * (Math.PI / (2*Math.PI)) * "+stringToEnclose+"));";
          }
      }
    );
  }

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=2+*+(+(x%2F(2*3.141592653589793))+-+floor(+.5+%2B+(x%2F(2*3.141592653589793))+)+)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.sawtooth] ) {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
        waveActivationFunction.sawtooth,
        {
          functionID: waveActivationFunction.sawtooth,
          functionString: "2 * ( (inputSignal/period) - Math.floor( .5 + (inputSignal/period) ) )",
          functionDescription: "Sawtooth wave", //  - https://en.wikipedia.org/wiki/Sawtooth_wave
          functionCalculate: function(inputSignal)
          {
              const period = 2 * Math.PI;
              const amplitude = 1;
              return 2 * ( (inputSignal/period) - Math.floor( .5 + (inputSignal/period) ) )
              // return -((2*amplitude)/Math.PI) * Math.atan( 1/Math.tan( (inputSignal*Math.PI) / period ) )
          },
          functionEnclose: function(stringToEnclose)
          {
              return "2 * ( ("+stringToEnclose+"/(2 * Math.PI)) - Math.floor( .5 + ("+stringToEnclose+"/(2 * Math.PI)) ) )";
          }
      }
    );
  }

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=sin(x)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  // TODO: waveActivationFunction.sin isn't declared
  // - instead Sine2 and Sine are referenced
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.sin] )  {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
        waveActivationFunction.sin,
        {
          functionID: waveActivationFunction.sin,
          functionString: "sin(inputSignal)",
          functionDescription: "sin function with normal period",
          functionCalculate: function(inputSignal)
          {
              return Math.sin(inputSignal);
          },
          functionEnclose: function(stringToEnclose)
          {
              return "(Math.sin(" + stringToEnclose + "))";
          }
        }
      );
  }

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=cos(x)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.cos] ) {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
      waveActivationFunction.cos,
      {
          functionID: waveActivationFunction.cos,
          functionString: "Cos(inputSignal)",
          functionDescription: "Cos function with normal period",
          functionCalculate: function(inputSignal)
          {
              return Math.cos(inputSignal);
          },
          functionEnclose: function(stringToEnclose)
          {
              return "(Math.cos(" + stringToEnclose + "))";
          }
        }
      );
  }

  // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=arctan(x)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  if( ! cppnjs.cppnActivationFunctions[waveActivationFunction.arctan] ) {
    cppnjs.cppnActivationFunctions.AddActivationFunction(
      waveActivationFunction.arctan,
      {
          functionID: waveActivationFunction.arctan,
          functionString: "atan(inputSignal)",
          functionDescription:"Arc Tan with normal period",
          functionCalculate: function(inputSignal)
          {
              return Math.atan(inputSignal);
          },
          functionEnclose: function(stringToEnclose)
          {
              return "(Math.atan(" + stringToEnclose + "))";
          }
        }
      );
  }

  // override function included with cppnjs
  cppnjs.cppnActivationFunctions.AddActivationFunction(
      "StepFunction",
      {
          functionID:    'StepFunction',
          functionString: "x<=0 ? 0.0 : 1.0",
          functionDescription: "Step / Square function [xrange -5.0,5.0][yrange, 0.0,1.0]",
          functionCalculate: function(inputSignal)
          {
              if(inputSignal<=0.0)
                  return -1.0;
              else
                  return 1.0;
          },
          functionEnclose: function(stringToEnclose)
          {
              // return "(((" + stringToEnclose + ') <= 0.0) ? 0.0 : 1.0)';
              return "stepActivation("+stringToEnclose+")"; // defined in a network-activation global
          }
  });

}

export function setActivationFunctionsDefaultProbabilities( cppnjs ) {
  //makes these the only activation functions being generated by wave genotypes -- all equal probabilibty for now
  var probs = {};
  // probs[waveActivationFunction.sin] = .25;


  probs[waveActivationFunction.triangle] = .25;
  probs[waveActivationFunction.sawtooth] = .25;
  probs[waveActivationFunction.StepFunction] = .25;
  probs[waveActivationFunction.Sine] = .25;
  probs[waveActivationFunction.Sine2] = .25; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=sin(2*x)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1.1&yGrid=1&gwidth=290&gheight=130

  probs[waveActivationFunction.cos] = 0;
  probs[waveActivationFunction.arctan] = 0;
  probs[waveActivationFunction.spike] = 0;

  probs[waveActivationFunction.BipolarSigmoid] = 0; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=(2.0+%2F+(1.0+%2B+exp(-4.9+*+x)))+-+1.0&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  probs[waveActivationFunction.PlainSigmoid] = 0; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=1.0%2F(1.0%2B(exp(-x)))&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  probs[waveActivationFunction.Gaussian] = 0; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=2+*+exp(-(x*2.5)%5E2)+-+1&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  probs[waveActivationFunction.Linear] = 0; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=abs(x)&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250
  probs[waveActivationFunction.NullFn] = 0; // https://www.intmath.com/functions-and-graphs/graphs-using-svg.php?function1=0&function2=&xMin=-5&xMax=5&xGrid=2&yMin=-1&yMax=1&yGrid=1&gwidth=450&gheight=250

  cppnjs.cppnActivationFactory.setProbabilities(probs);
}
