export function remapNumberToRange( inputNumber, fromMin, fromMax, toMin, toMax ) {
  return (inputNumber - fromMin) / (fromMax - fromMin) * (toMax - toMin) + toMin;
}

export function isAudible( frequency ) {
  return 20 <= frequency && frequency <=20000;
}

export function lerp( from, to, fraction ) {
  return from + fraction * ( to - from );
}

///// notes

function getMidiNoteNumberRangeForOctave( octave ) {
  switch (octave) {
    // case 0:
    //   return { noteNumberFrom: 0, noteNumberTo: 11};
    case 0:
      return { noteNumberFrom: 12, noteNumberTo: 23};
    case 1:
      return { noteNumberFrom: 24, noteNumberTo: 35};
    case 2:
      return { noteNumberFrom: 36, noteNumberTo: 47};
    case 3:
      return { noteNumberFrom: 48, noteNumberTo: 59};
    case 4:
      return { noteNumberFrom: 60, noteNumberTo: 71};
    case 5:
      return { noteNumberFrom: 72, noteNumberTo: 83};
    case 6:
      return { noteNumberFrom: 84, noteNumberTo: 95};
    case 7:
      return { noteNumberFrom: 96, noteNumberTo: 107};
    case 8:
      return { noteNumberFrom: 108, noteNumberTo: 119};
    case 9:
      return { noteNumberFrom: 120, noteNumberTo: 127};
    default:
      return { noteNumberFrom: 60, noteNumberTo: 71};
  }
}

function getNoteMarks( noteNumberFrom, noteNumberTo ) {
  console.log("---noteNumberFrom:",noteNumberFrom, ", noteNumberTo:",noteNumberTo);
  const marks = {};
  const tuning = 440; // a is 440 hz...
  for( let midi = noteNumberFrom; midi <= noteNumberTo; ++midi ) {
    const frequency =
      Math.pow(2, (midi - 69) / 12) * tuning; // https://github.com/danigb/midi-freq
    const octaveNumber = Math.floor((midi)/12)-1;
    switch (midi%12) {
      case 0:
        marks[frequency] = "C"+octaveNumber; break;
      case 1:
        marks[frequency] = "C#"+octaveNumber; break;
      case 2:
        marks[frequency] = "D"+octaveNumber; break;
      case 3:
        marks[frequency] = "D#"+octaveNumber; break;
      case 4:
        marks[frequency] = "E"+octaveNumber; break;
      case 5:
        marks[frequency] = "F"+octaveNumber; break;
      case 6:
        marks[frequency] = "F#"+octaveNumber; break;
      case 7:
        marks[frequency] = "G"+octaveNumber; break;
      case 8:
        marks[frequency] = "G#"+octaveNumber; break;
      case 9:
        marks[frequency] = "A"+octaveNumber; break;
      case 10:
        marks[frequency] = "A#"+octaveNumber; break;
      case 11:
        marks[frequency] = "B"+octaveNumber; break;
      default:
        marks[frequency] = "";
    }
  }
  return marks;
}

export function getNoteMarksAndMidiNumbersArray(noteNumberFrom, noteNumberTo) {
  const noteMarksAndMidiNumbers = [];
  for( let midi = noteNumberFrom; midi <= noteNumberTo; ++midi ) {
    const octaveNumber = Math.floor((midi)/12)-1;
    switch (midi%12) {
      case 0:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "C"+octaveNumber}); break;
      case 1:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "C#"+octaveNumber}); break;
      case 2:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "D"+octaveNumber}); break;
      case 3:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "D#"+octaveNumber}); break;
      case 4:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "E"+octaveNumber}); break;
      case 5:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "F"+octaveNumber}); break;
      case 6:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "F#"+octaveNumber}); break;
      case 7:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "G"+octaveNumber}); break;
      case 8:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "G#"+octaveNumber}); break;
      case 9:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "A"+octaveNumber}); break;
      case 10:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "A#"+octaveNumber}); break;
      case 11:
        noteMarksAndMidiNumbers.push({midiNoteNr: midi, noteMark: "B"+octaveNumber}); break;
    }
  }
  return noteMarksAndMidiNumbers;
}

export function getOctaveMidiNumberRanges() {
  return {
    0: [12,23],
    1: [24,35],
    2: [36,47],
    3: [48,59],
    4: [60,71],
    5: [72,83],
    6: [84,95],
    7: [96,107],
    8: [108,119],
    9: [120,127]
  };
}

// from https://newt.phys.unsw.edu.au/music/note/ - via https://newt.phys.unsw.edu.au/jw/notes.html
export function frequencyToNote(input) {
  var A4 = 440.0;
  var A4_INDEX = 57;

  var notes = [
    "C0","C#0","D0","D#0","E0","F0","F#0","G0","G#0","A0","A#0","B0",
    "C1","C#1","D1","D#1","E1","F1","F#1","G1","G#1","A1","A#1","B1",
    "C2","C#2","D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","B2",
    "C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3",
    "C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4",
    "C5","C#5","D5","D#5","E5","F5","F#5","G5","G#5","A5","A#5","B5",
    "C6","C#6","D6","D#6","E6","F6","F#6","G6","G#6","A6","A#6","B6",
    "C7","C#7","D7","D#7","E7","F7","F#7","G7","G#7","A7","A#7","B7",
    "C8","C#8","D8","D#8","E8","F8","F#8","G8","G#8","A8","A#8","B8",
    "C9","C#9","D9","D#9","E9","F9","F#9","G9","G#9","A9","A#9","B9" ];

  var MINUS = 0;
  var PLUS = 1;

  var frequency;
  var r = Math.pow(2.0, 1.0/12.0);
  var cent = Math.pow(2.0, 1.0/1200.0);
  var r_index = 0;
  var cent_index = 0;
  var side;

  frequency = A4;

  if(input >= frequency) {
    while(input >= r*frequency) {
      frequency = r*frequency;
      r_index++;
    }
    while(input > cent*frequency) {
      frequency = cent*frequency;
      cent_index++;
    }
    if((cent*frequency - input) < (input - frequency))
      cent_index++;
    if(cent_index > 50) {
      r_index++;
      cent_index = 100 - cent_index;
      if(cent_index != 0)
        side = MINUS;
      else
        side = PLUS;
    }
    else
      side = PLUS;
  }

  else {
    while(input <= frequency/r) {
      frequency = frequency/r;
      r_index--;
    }
    while(input < frequency/cent) {
      frequency = frequency/cent;
      cent_index++;
    }
    if((input - frequency/cent) < (frequency - input))
      cent_index++;
    if(cent_index >= 50) {
      r_index--;
      cent_index = 100 - cent_index;
      side = PLUS;
    }
    else {
      if(cent_index != 0)
        side = MINUS;
      else
        side = PLUS;
    }
  }

  var result = notes[A4_INDEX + r_index];
  // if(side == PLUS)
  //   result = result + " plus ";
  // else
  //   result = result + " minus ";
  // result = result + cent_index + " cents";
  return result;
}


export function getNoteMarksForOctave( octave ) {
  const {noteNumberFrom, noteNumberTo} =
    getMidiNoteNumberRangeForOctave( parseInt(octave) );
  const noteMarks = getNoteMarks( noteNumberFrom, noteNumberTo );
  return noteMarks;
}

// TODO: questionably the right location:
export const numWorkers = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
