
import _ from 'lodash';

var Utils = {};

Utils.IS_DEBUG = false;

Utils.log = function(msg) {
  if (!Utils.IS_DEBUG) return;

  console.log(msg);
  if (typeof $ !== "undefined")
    $('.log').prepend('<div>'+msg+'</div>');
};

Utils.error = function(msg) {
  throw msg;
};

Utils.upperCaseFirstLetter = function(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
};
Utils.lowerCaseFirstLetter = function(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
};

Utils.random = function() {
  return Math.random();
};

/*
  @params (min, max) or ({min, max})
*/
Utils.randomIn = function(min, max) {
  if (_.isObject(min)) {
    max = min.max;
    min = min.min;
  }
  return Math.random()*(max-min) + min;
};

/*
  @params (min, max) or ({min, max})
  @param min
  @param max up to but not including (aka, an array's length for finding
             an index)
 */
Utils.randomIndexIn = function(min, max) {
  if (_.isObject(min)) {
    max = min.max;
    min = min.min;
  }
  return Math.floor(Utils.randomIn(min, max));
};

/*
  @param chance {number} [0,1]
  @return If a random number was generated less than the chance
*/
Utils.randomChance = function(chance) {
  return Utils.random() <= chance;
};

Utils.randomBool = function() {
  return !!Math.round(Math.random());
};

/**
  @param xs {array} [x1, x2,...]
  @param notX An element in xs to not select
  @return A random element in xs, undefined if xs is empty
*/
Utils.randomElementIn = function(xs, notX) {
  if (xs.length===0) return;
  if (notX)
    return Utils.randomElementIn(_.reject(xs, notX));

  var index = Utils.randomIndexIn(0, xs.length);
  return xs[index];
};

/**
 * Clamps the given number to the min or max
 * @param x
 * @param min
 * @param max
 * @return A number in [min, max]
 **/
Utils.clamp = function(x, min, max) {
  if (x > max)
    return max;
  if (x < min)
    return min;
  return x;
};

//+ Jonas Raoni Soares Silva
//@ http://jsfromhell.com/array/shuffle [rev. #1]
Utils.shuffle = function(v) {
  for(var j, x, i = v.length;
    i;
    j = parseInt(Math.random() * i),
      x = v[--i],
      v[i] = v[j],
      v[j] = x);
  return v;
};

/*
  @param xs [{weight, element},...] with sum(weights)===1.0
*/
Utils.weightedSelection = function(xs) {
  var r = Math.random(),
      sum = 0, element;

  var totalSum = _.reduce(xs, function(sum, x) {
    return sum+x.weight;
  }, 0);
  if (totalSum !== 1.0)
    throw "xs' weights don't add up to 1.0";

  _.forEach(xs, function(x) {
    sum+=x.weight;
    if (r <= sum && x.weight !== 0) {
      element = x.element;
      return false;
    }
  });
  return element;
};

/**
 * Calcuates the linear eqn from x:[0, 1], with given ys
 * @param {number} y0
 * @param {number} y1
 * @return {a, b} For y=ax+b
 */
Utils.solveLinearEqn = function(y0, y1) {
  return {
    a: y1-y0,
    b: y0
  };
};

/**
 * Calcuates the exponential eqn from x:[0, 1], with given ys
 * @param {number} y0
 * @param {number} y1
 * @return {c, a} For y=c*e^(a*x)
 */
Utils.solveExponentialEqn = function(y0, y1) {
  return {
    c: y0,
    a: Math.log(y1 / y0)
  };
};

Utils.InterpolationType = {
  LINEAR: 'linear',
  EXPONENTIAL: 'exponential'
};

Utils.interpolate = function(interpolationType, ys, x) {
  var coefs, y;
  if (interpolationType === Utils.InterpolationType.LINEAR) {
    coefs = Utils.solveLinearEqn(ys[0], ys[1]);
    y = coefs.a*x + coefs.b;
  }
  else if (interpolationType === Utils.InterpolationType.EXPONENTIAL) {
    coefs = Utils.solveExponentialEqn(ys[0], ys[1]);
    y = coefs.c * Math.exp(coefs.a*x);
  }
  else
    throw "InterpolationType not supported";

  return y;
};

/*
  Mutates a specific field based on the given params
  @param params See defaults
  @return {mutatedParameter, changeDescription}
 */
Utils.mutateParameter = function(params) {

  if (typeof params === 'undefined') params = {};
  params = _.defaults({}, params, {
    // {obj} Object to mutate
    obj: null,
    // {string} Which parameter on the obj to mutate
    parameter: 'param',

    // How y0, y1 will be interpolated
    mutationDeltaInterpolationType: Utils.InterpolationType.LINEAR,

    // Chance of mutating only by an amount in mutation delta
    // (ie. weight+=mutationDelta), otherwise (weight=mutationRange)
    mutationDeltaChance: 0.8,

    // What amount of interpolation should be used [0.0, 1.0]
    mutationDistance: 0.5,

    // how little or much the parameter will change if mutating by delta
    // [].length===2 the interpolation min max
    mutationDelta: {min: [0.05, 0.5], max: [0.2, 0.8]},
    allowDeltaInverse: true,

    // Optional range to clamp a mutated parameter to.
    // ex: if {min: 0.0, max: 1.0}, than the parameter will never mutate below min
    // or above max
    mutationDeltaAllowableRange: null,

    // note: the inverse is also possible (ex (-max, -min]) when
    // allowRandomInverse is true
    randomMutationRange: {min: 0.1, max: 1.5},

    allowRandomInverse: false,

    // true if only integers are allowed (ie for an index), otherwise
    // uses floating point
    discreteMutation: false,

    mutateDelta: mutateDelta,
    mutateRandom: mutateRandom
  });

  Utils.log('mutating('+params.parameter+') '+params.obj);

  // Only change the weight by a given delta
  if (Utils.randomChance(params.mutationDeltaChance))
    return params.mutateDelta(params);
  // Use a new random weight in range
  else
    return params.mutateRandom(params);
};
// this===params
function mutateDelta(params) {
  var delta;

  if (_.isNumber(params.mutationDelta.min) ||
      typeof params.mutationDelta.min.y0 !== 'undefined')
  {
    throw "Old mutationDelta with min/max as number or {y0,y1} no longer supported";
  }

  delta = {
    min: Utils.interpolate(params.mutationDeltaInterpolationType,
                           params.mutationDelta.min,
                           params.mutationDistance),
    max: Utils.interpolate(params.mutationDeltaInterpolationType,
                           params.mutationDelta.max,
                           params.mutationDistance)
  };

  if (params.discreteMutation)
    delta = Utils.randomIndexIn(delta);
  else
    delta = Utils.randomIn(delta);

  // 50% chance of negative
  if (params.allowDeltaInverse && Utils.randomBool())
    delta*=-1;

  Utils.log('mutating('+params.parameter+') by delta '+delta.toFixed(3)+' to '+(params.obj[params.parameter]+delta));
  params.obj[params.parameter]+=delta;

  if (params.mutationDeltaAllowableRange) {
    var val = params.obj[params.parameter]; // TODO: this isn't used (bthj)
    params.obj[params.parameter] = Utils.clamp(
      params.obj[params.parameter],
      params.mutationDeltaAllowableRange.min,
      params.mutationDeltaAllowableRange.max
    );
  }

  return {
    mutatedParameter: params.parameter,
    changeDescription: "by delta "+delta.toFixed(3)
  };
}
function mutateRandom(params) {
  var newParam, range;

  range = params.randomMutationRange;
  if (params.discreteMutation)
    newParam = Utils.randomIndexIn(range);
  else
    newParam = Utils.randomIn(range);

  // 50% chance of negative
  if (params.allowRandomInverse && Utils.randomBool())
    newParam*=-1;

  Utils.log('mutating('+params.parameter+') with new param '+newParam);
  params.obj[params.parameter] = newParam;
  return {
    mutatedParameter: params.parameter,
    changeDescription: "to "+newParam
  };
}


/*
  Generates a reversible unique number from two numbers
*/
Utils.cantorPair = function(x, y) {
  return ((x+y)*(x+y+1)) / 2 + y;
};
Utils.reverseCantorPair = function(z) {
  var t = Math.floor((-1 + Math.sqrt(1+8*z))/2);
  var x = t*(t+3)/2 - z;
  var y = z - t*(t+1)/2;
  return {x:x, y:y};
};

/**
  extend function that clones the default parameters
  @param arguments
*/
Utils.extend = function(self, defaultParameters, parameters) {
  // deep clone the defaultParameters so [] and {} aren't referenced by
  // multiple objects
  _.assign(self, _.cloneDeep(defaultParameters), parameters);
};

Utils.roundTo2Places = function(num) {
  return +(Math.round(num + "e+2")  + "e-2");
};

var TWELTH_ROOT = Math.pow(2,1/12);
var A4 = 440;
var DISTANCE_FROM_A = {
  c:-9, d:-7, e:-5, f:-4, g:-2, a:0, b:2
};
/**
  Gets the frequency based on an equal tempered scale
  with A4 = 440
  @param note (ex: 'c4', 'c4#', 'C4b')
*/
Utils.frequencyForNote = function(note) {
  var steps = Utils.stepsFromRootNote(note);
  return Utils.frequencyOfStepsFromRootNote(steps);
};

Utils.stepsFromRootNote = function(note) {
  note = note.toLowerCase().split('');
  var letter = note[0],
      octave = parseInt(note[1], 10),
      modifier = note[2],
      steps = DISTANCE_FROM_A[letter];
  if (modifier==='#')
    ++steps;
  else if (modifier==='b')
    --steps;

  steps+= 12 * (octave-4);
  return steps;
};

Utils.noteForFrequency = function() {
  // TODO: reverse frequencyForNote
  // TODO: Tests for frequencyForNote(noteForFrequency(x))===x
};

Utils.frequencyOfStepsFromRootNote = function(steps) {
  return A4 * Math.pow(TWELTH_ROOT, steps);
};

var HashLength = 6;
var HashCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
Utils.createHash = function(len, chars) {
  if (typeof len === "undefined") len = HashLength;
  if (typeof chars === "undefined") chars = HashCharacters;

  var i = 0, hash=[];
  for (; i<len; ++i) {
    hash.push(chars.charAt(
      Math.floor(Math.random() * chars.length)));
  }
  return hash.join("");
};

export default Utils;
