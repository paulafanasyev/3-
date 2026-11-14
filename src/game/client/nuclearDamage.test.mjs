import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import profiles from '../data/source-bomb-profiles.json' with { type: 'json' };
import { zonesForBomb } from './nuclearBlastModel.js';
import { createNuclearDamageLayer } from './nuclearDamage.js';

const bomb = (id) => profiles.bombs.find((item) => item.id === id);
const positionOf = (entity) => {
  const value = entity.position;
  return typeof value?.getValue === 'function' ? value.getValue(Cesium.JulianDate.now()) : value;
};
const distanceFromMeters = (at, entity) => {
  const here = Cesium.Cartographic.fromCartesian(positionOf(entity));
  const north = (here.latitude - Cesium.Math.toRadians(at.lat)) * 111_320;
  const east = (here.longitude - Cesium.Math.toRadians(at.lon))
    * 111_320 * Math.cos(Cesium.Math.toRadians(at.lat));
  return Math.hypot(north, east);
};

function stubViewer() {
  return {
    dataSources: new Cesium.DataSourceCollection(),
    scene: { sampleHeightMostDetailed: async () => [{ height: 20 }], globe: { getHeight: () => 20 } },
  };
}

test('fabricated rubble stops at the collapse front and never dots the window zone', async () => {
  const viewer = stubViewer();
  const layer = createNuclearDamageLayer(viewer);
  const at = { lon: -0.127, lat: 51.507 };
  const tsar = bomb('tsar');
  const result = await layer.apply(at, 50, 'London', tsar);
  const source = viewer.dataSources.get(0);
  const boxes = source.entities.values.filter((entity) => entity.box);
  assert.ok(boxes.length > 500, `expected a levelled city, got ${boxes.length} proxies`);

  // 50 Mt breaks windows at ~43 km; nothing there is demolished, so no proxy may
  // be fabricated beyond the collapse front (the heavy-damage radius).
  const R = zonesForBomb(tsar, 50_000).radiiM;
  const furthest = Math.max(...boxes.map((entity) => distanceFromMeters(at, entity)));
  assert.ok(furthest <= R.heavy * 1.05, `rubble found at ${Math.round(furthest)} m, past the ${Math.round(R.heavy)} m collapse front`);
  assert.ok(result.levelledAreaKm2 > 1400 && result.levelledAreaKm2 < 1450, `levelled area ${result.levelledAreaKm2}`);
  // Some core proxies sit inside the fireball and are never drawn at all.
  assert.ok(boxes.length <= result.buildingCount && boxes.length > result.buildingCount * 0.85);
  layer.destroy();
});

test('levelled area follows the model, including burst coupling', async () => {
  const viewer = stubViewer();
  const layer = createNuclearDamageLayer(viewer);
  const at = { lon: -0.127, lat: 51.507 };
  const areas = {};
  for (const [id, yieldMt] of [['little_boy', 0.015], ['castle_bravo', 15], ['tsar', 50]]) {
    const result = await layer.apply(at, yieldMt, 'London', bomb(id));
    const R = zonesForBomb(bomb(id), yieldMt * 1000).radiiM;
    const collapse = Math.max(R.heavy, R.fireball * 1.25, 120);
    areas[id] = result.levelledAreaKm2;
    assert.ok(Math.abs(result.levelledAreaKm2 - Math.PI * collapse ** 2 / 1e6) < 0.01, `${id} area drifted from its own collapse front`);
    layer.reset();
  }
  assert.ok(areas.little_boy < areas.castle_bravo / 50, `15 kt levelled ${areas.little_boy} km² vs 15 Mt ${areas.castle_bravo} km²`);
  // 50 Mt is 3.3x the yield of Castle Bravo, so pure cube-root scaling would give
  // 2.23x the area. Bravo is a surface burst, which couples worse than Tsar's
  // high-air burst, so the measured ratio must sit below that.
  const ratio = areas.tsar / areas.castle_bravo;
  assert.ok(ratio > 1.4 && ratio < 2.23, `15 Mt -> 50 Mt area ratio was ${ratio}`);
  layer.destroy();
});

test('reset cancels city damage that is still waiting for terrain sampling', async () => {
  let resolveHeight;
  const pendingHeight = new Promise((resolve) => { resolveHeight = resolve; });
  const viewer = {
    dataSources: new Cesium.DataSourceCollection(),
    scene: {
      sampleHeightMostDetailed: async () => {
        await pendingHeight;
        return [{ height: 12 }];
      },
      globe: { getHeight: () => 12 },
    },
  };
  const layer = createNuclearDamageLayer(viewer);
  const resultPromise = layer.apply({ lon: 37.617, lat: 55.755 }, 1.6, 'Москва');

  layer.reset();
  resolveHeight();
  const result = await resultPromise;

  assert.equal(result, null);
  assert.equal(viewer.dataSources.get(0).entities.values.length, 0);
  layer.destroy();
});
