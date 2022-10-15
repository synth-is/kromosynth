// from: https://github.com/benji6/virtual-audio-graph/blob/master/src/data.js
export const audioParamProperties = [
  'attack',
  'delayTime',
  'detune',
  'frequency',
  'gain',
  'knee',
  'pan',
  'playbackRate',
  'ratio',
  'reduction',
  'release',
  'threshold',
  'Q',
];

export const audioGraphNodes = {
  'bufferSource': {
    'audioParams': {
      'buffer': null,
      'detune': {'range':[-1200, 1200]},
      'playbackRate': {'range':[0, 12]}
    },
  },
  'biquadFilter': {
    'audioParams': {
      'frequency': {'range':[0, 20000]},
      'detune': {'range':[-1200, 1200]},
      'Q': {'range':[0.0001, 1000]},
      'gain': {'range':[-40, 40]}
    },
    'choiceParams': {
      'type': [
        'lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'
      ]
    }
  },
  'convolver': {
    'audioParams': {
      'buffer':null
    },
    'choiceParams': { 'normalize': ["true", "false"] }
  },
  'delay': {
    'audioParams': {
      'delayTime': {'range':[0, 5.0]}
    }
  },
  'dynamicsCompressor': {
    'audioParams': {
      'threshold': {'range':[-100, 0]},
      'knee': {'range':[0, 40]},
      'ratio': {'range':[1, 20]},
      'attack': {'range':[0.0, 1.0]},
      'release': {'range':[0.0, 1.0]},
      'reduction': {'range':[-20, 0]} // TODO: possibly not useable as an audio param
    }
  },
  'gain': {
    'audioParams': {
      'gain': {'range':[0, 10]}
    }
  },
  'waveShaper': {
    'audioParams': {
      'curve':null
    }
  },
  'wavetable': {
    'audioParams': {
      'mix': null,
      'buffer': null
    }
  },
  'feedbackDelay': {
    'audioParams': {
      'delayTime':  {'range':[0.0, 5.0]},
      'feedbackRatio':  {'range':[0.0, 1.0]},
    }
  },
  'oscillator': {
    'audioParams': {
      'frequency': {'range':[0, 20000]},
      'detune': {'range':[-1200, 1200]},
      'noteOffset': null // attribute from asNEAT; if converting back to asNEAT, we'd create an NoteOscillatorNode if this property is present
    },
    'choiceParams': {
      'type': [
        'sine', 'square', 'sawtooth', 'triangle'
      ]
    }
  },
  'channelMerger': {
    'audioParams': {}
  }
}
