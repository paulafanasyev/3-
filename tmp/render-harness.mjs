import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { createNuclearDamageLayer } from '../src/game/client/nuclearDamage.js';

const profiles = JSON.parse(readFileSync('src/game/data/source-bomb-profiles.json', 'utf8'));
const bombFor = (id) => profiles.bombs.find((b) => b.id === id);

function makeViewer() {
  let source = null;
  return {
    getSource: () => source,
    dataSources: { add(s) { source = s; }, remove() { source = null; } },
    scene: {
      sampleHeightMostDetailed: async () => [{ height: 30 }],
      globe: { getHeight: () => 30 },
    },
  };
}

function evalProp(value, time, bag) {
  if (value && typeof value.getValue === 'function') {
    value.getValue(time);
    bag.count += 1;
    if (value.color && typeof value.color.getValue === 'function') { value.color.getValue(time); bag.count += 1; }
  }
}

// Evaluate the time-dependent properties on the known Cesium graphics so the
// animation closures (collapse height, scorch alpha, fire flicker, smoke rise)
// are actually executed.
function exercise(entity) {
  const time = Cesium.JulianDate.now();
  const bag = { count: 0 };
  evalProp(entity.position, time, bag);
  for (const graphic of [entity.box, entity.ellipse, entity.ellipsoid, entity.point]) {
    if (!graphic) continue;
    for (const key of Object.keys(graphic)) {
      const value = graphic[key];
      if (value && typeof value === 'object' && typeof value.getValue === 'function') value.getValue(time), bag.count += 1;
      else if (value && typeof value === 'object') evalProp(value, time, bag);
    }
  }
  return bag.count;
}

const cases = [
  { id: 'tsar', yieldMt: 50 },
  { id: 'trinity', yieldMt: 0.021 },
  { id: 'mk82', yieldMt: 0.0000001 },
  { id: 'sedan', yieldMt: 0.104 },
  { id: 'baker', yieldMt: 0.023 },
  { id: null, yieldMt: 1.6 },
];

let failures = 0;
for (const c of cases) {
  const bomb = c.id ? bombFor(c.id) : null;
  const viewer = makeViewer();
  const layer = createNuclearDamageLayer(viewer);
  const result = await layer.apply({ lon: -0.127, lat: 51.5 }, c.yieldMt, 'London', bomb);
  if (!result) { console.log(`FAIL ${c.id ?? 'fallback'}: apply returned null`); failures += 1; continue; }

  let totalEvals = 0;
  for (const entity of viewer.getSource().entities.values) {
    try { totalEvals += exercise(entity); }
    catch (err) { console.log(`FAIL ${c.id ?? 'fallback'}: ${err.message}`); failures += 1; break; }
  }
  console.log(
    `${c.id ?? 'fallback'}: bld=${result.buildingCount}, ` +
    `fb=${result.fireballKm.toFixed(3)}km, severe=${result.severeKm.toFixed(2)}km, ` +
    `heavy=${result.heavyKm.toFixed(2)}km, light=${result.lightKm.toFixed(2)}km, ` +
    `crater=${result.craterDiameterM}m, cloud=${result.cloudTopKm}km, ` +
    `entities=${viewer.getSource().entities.values.length}, propsEvaluated=${totalEvals}`,
  );
  layer.destroy();
}

console.log(failures === 0 ? '\nAll render-path cases executed without throwing.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
