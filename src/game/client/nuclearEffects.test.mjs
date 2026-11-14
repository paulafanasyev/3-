import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createNuclearVisuals } from './nuclearEffects.js';
import { zonesForBomb, shockRadiusM } from './nuclearBlastModel.js';

const sample = (property, time) => (
  typeof property?.getValue === 'function' ? property.getValue(time) : property
);
const collect = (args) => {
  const added = [];
  const entities = { add: (definition) => { added.push(definition); return definition; } };
  createNuclearVisuals(entities, { lon: -0.127, lat: 51.507 }, ...args);
  return added;
};

// Cesium builds an ellipse outline from two independent property reads, so a
// wall-clock driven axis can overtake its partner and throw, which stops the
// whole scene. The invariant has to hold in either read order.
test('nuclear effect ellipses never report a minor axis above the major one', async () => {
  const added = collect([performance.now(), false, 1.2]);
  const ellipses = added.filter((item) => item.ellipse).map((item) => item.ellipse);
  assert.ok(ellipses.length >= 3, `expected dust sheet, front line and Wilson ring, got ${ellipses.length}`);

  const time = Cesium.JulianDate.now();
  for (let frame = 0; frame < 40; frame += 1) {
    for (const ellipse of ellipses) {
      const minorFirst = sample(ellipse.semiMinorAxis, time);
      const major = sample(ellipse.semiMajorAxis, time);
      const minorLast = sample(ellipse.semiMinorAxis, time);
      for (const minor of [minorFirst, minorLast]) {
        assert.ok(Number.isFinite(major) && Number.isFinite(minor), `non-finite axes ${major}/${minor}`);
        assert.ok(major >= minor, `semiMajorAxis ${major} < semiMinorAxis ${minor}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

test('the ground front runs at the documented shock speed, not an eased curve', () => {
  const trinity = { yield_kt: 21, burst_type: 'NUCLEAR_SURFACE', burst_height_m: 0 };
  const added = collect([performance.now() - 3000, false, 1, zonesForBomb(trinity, 21)]);
  const dust = added.find((item) => item.ellipse?.material?.color instanceof Cesium.CallbackProperty);
  assert.ok(dust, 'no dust sheet entity');
  const major = sample(dust.ellipse.semiMajorAxis, Cesium.JulianDate.now());
  // Три секунды — это ~1,3 км для 21 кт; easing-кривая старой версии дала бы
  // десятки километров и кольцо убегало бы вперёд звука.
  const expected = Math.max(200, shockRadiusM(21, 3, true));
  assert.ok(Math.abs(major - expected) < expected * 0.25 + 300, `фронт ${major} вместо ${expected}`);
  assert.ok(major < 5_000, `фронт за 3 c уехал на ${major} м`);
});

test('an intercepted warhead keeps a single short-lived ring and no cloud', () => {
  const added = collect([performance.now(), true, 1]);
  assert.equal(added.length, 1);
  assert.ok(added[0].ellipse);
  assert.equal(added[0].ellipsoid, undefined);
});
