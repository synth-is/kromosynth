import neatjs from 'neatjs';
import cppnjs from 'cppnjs';
import {
  setActivationFunctions, setActivationFunctionsDefaultProbabilities
} from './activation-functions.js';

import {
  CONNECTION_PROPORTION,
  WEIGHT_RANGE,
  INPUTS,  // number of inputs to the neural network
  OUTPUTS, // TODO: let the number of outputs from the NN be configurable in UI ?
  SEED_COUNT, // number of individuals in seed behind initial population
} from './evolution-constants.js';

let instance = null;
/**
 * Initializes and evolves populations of CPPN-NEAT networks.
 */
class Evolver {

  constructor() {

    setActivationFunctions( cppnjs );
    setActivationFunctionsDefaultProbabilities( cppnjs );

    this.iecGenerator = this._instantiateIECGenerator();

    /*
      Singleton class inspired by:
      http://amanvirk.me/singleton-classes-in-es6/ via http://stackoverflow.com/questions/26205565/converting-singleton-js-objects-to-use-es6-classes#comment48784773_26227662
      Why: To be working with the same instance of iecGenerator,
      with the same set of population seeds.
     */
    if( ! instance ) {
      instance = this;
    }
    return instance;
  }

  getInitialCPPN_NEATgenome() {
    return this.iecGenerator.createNextGenome( [] );
  }

  getNextCPPN_NEATgenome( parents ) {
    return this.iecGenerator.createNextGenome( parents );
  }

  /**
   * Create a first population
   * @return {Array} Individuals in the first population
   */
  createFirstPopulation( populationSize ) {
    const firstPopulation = [];
    for( let i=0; i < populationSize; i++ ) {

      // individuals in the first population have no actual parents;
      // instead they are mutations of some random seed genome:
      let onePopulationMember = this.getInitialCPPN_NEATgenome();

      firstPopulation.push( onePopulationMember );
    }

    /*
      TODO: let'decrease the mutation count after creating the first population,
      - then propbagly instantiate new iecGenerator,
        with new iecOptions, from the same initialPopulationSeeds ?
    iecOptions.initialMutationCount = 1;
    iecOptions.postMutationCount = 1;
    */

    return firstPopulation;
  }

  /**
   * Evolve a new generation from the given parents
   * @see logic at https://github.com/OptimusLime/neatjs/blob/a21f079eee294a4a43563368720b9ab5ae1ba60f/evolution/iec.js#L73
   * @param  {Array} parents Parents selected to be responsible for the next generation.
   * @return {Array}         Individuals in the newly evolved population.
   */
  evolveNextGeneration( parents, populationSize ) {

    const newPopulation = [];
    for( let i=0; i < populationSize; i++ ) {

      var onePopulationMember = this.getNextCPPN_NEATgenome( parents );

      newPopulation.push( onePopulationMember );
    }
    return newPopulation;
  }



  /**
   * create initial seed genomes for coming population(s members)
   * @return {Array} Seed genomes
   */
  _getInitialPopulationSeeds() {
    const initialPopulationSeeds = [];
    for( let i=0; i < SEED_COUNT; i++ ) {
      //clear out genome IDs and innovation IDs
      // -> not sure why / if this is needed?
      neatjs.neatGenome.Help.resetGenomeID();
      // NeatGenome.Help.resetInnovationID();

      var neatGenome = neatjs.neatGenome.Help.CreateGenomeByInnovation(
                INPUTS,
                OUTPUTS,
                {
                  connectionProportion: CONNECTION_PROPORTION,
                  connectionWeightRange: WEIGHT_RANGE
                }
      );
      initialPopulationSeeds.push( neatGenome );
    }
    return initialPopulationSeeds;
  }

  /**
   * Interactive Evolution Computation (IEC) setup
   * @return {Object} Instance of a neatjs GenericIEC
   *                           https://github.com/OptimusLime/neatjs/blob/master/evolution/iec.js
   */
  _instantiateIECGenerator() {

    const np = new neatjs.neatParameters();
    // defaults taken from
    // https://github.com/OptimusLime/win-gen/blob/d11e6df5e7b8948f292c999ad5e6c24ab0198e23/old/plugins/NEAT/neatPlugin.js#L63
    // https://github.com/OptimusLime/win-neat/blob/209f00f726457bcb7cd63ccc1ec3b33dec8bbb66/lib/win-neat.js#L20
    np.pMutateAddConnection = .13;
    np.pMutateAddNode = .13;
    np.pMutateDeleteSimpleNeuron = .00;
    np.pMutateDeleteConnection = .00;
    np.pMutateConnectionWeights = .72;
    np.pMutateChangeActivations = .02;

    np.pNodeMutateActivationRate = 0.2;
    np.connectionWeightRange = 3.0;
    np.disallowRecurrence = true;

    // IEC options taken from
    // https://github.com/OptimusLime/win-Picbreeder/blob/33366ef1d8bfd13c936313d2fdb2afed66c31309/html/pbHome.html#L95
    // https://github.com/OptimusLime/win-Picbreeder/blob/33366ef1d8bfd13c936313d2fdb2afed66c31309/html/pbIEC.html#L87
    const iecOptions = {
      initialMutationCount : 5,
      postMutationCount : 5  // AKA mutationsOnCreation
    };

    const initialPopulationSeeds = this._getInitialPopulationSeeds();

    return new neatjs.iec(
      np,
      initialPopulationSeeds,
      iecOptions
    );
  }
}


export default Evolver;
