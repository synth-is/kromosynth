import defaultExport from 'virtual-audio-graph';
import * as allExports from 'virtual-audio-graph';

console.log('Default export type:', typeof defaultExport);
console.log('Default export:', defaultExport);
console.log('\nAll named exports:', Object.keys(allExports).sort());
console.log('\nIs default a function?', typeof defaultExport === 'function');

if (typeof defaultExport === 'function') {
  console.log('\nTrying to call default export...');
  try {
    const result = defaultExport({ audioContext: null });
    console.log('Success! Result:', result);
  } catch (e) {
    console.error('Error calling:', e.message);
  }
}
