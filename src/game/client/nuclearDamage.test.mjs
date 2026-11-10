import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createNuclearDamageLayer } from './nuclearDamage.js';

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
