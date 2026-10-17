// Loads the floor plan modules in plain Node. The package is "type": "commonjs", so Node would read
// the .ts files as CommonJS; strip the types ourselves and import the result as an ES module.
// These modules have no runtime imports (type-only imports are erased), so a data: URL works.
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';

export async function loadTs(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source);
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

const mod = await loadTs('../src/components/floorLayout.ts');
export const choreo = await loadTs('../src/components/handoffChoreo.ts');
export const demo = await loadTs('../src/components/demoTour.ts');
export const replay = await loadTs('../src/components/replayPlayer.ts');
export const recording = await loadTs('../src/components/canvasRecording.ts');

export default mod;
