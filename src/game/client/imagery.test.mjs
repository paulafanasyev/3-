import assert from 'node:assert/strict';
import test from 'node:test';
import { addFallbackImagery, dropOnTileErrors, TILE_ERROR_LIMIT, SOURCE_TOAST } from './imagery.js';

function fakeEvent() { const fns = []; return { addEventListener: (f) => fns.push(f), fire: () => fns.forEach((f) => f()) }; }
function fakeCesium({ natural = true, ion = 'ok', osm = true } = {}) {
  const made = [];
  const C = {
    buildModuleUrl: (p) => `/cesium/${p}`,
    TileMapServiceImageryProvider: { fromUrl: async (url) => { if (!natural) throw new Error('404'); const p = { kind: 'natural', url, errorEvent: fakeEvent() }; made.push(p); return p; } },
    IonImageryProvider: { fromAssetId: (id) => (ion === 'ok' ? Promise.resolve({ kind: 'ion', id, errorEvent: fakeEvent() }) : ion === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('401'))) },
    OpenStreetMapImageryProvider: function OSM(o) { if (!osm) throw new Error('osm'); this.kind = 'osm'; this.url = o.url; this.errorEvent = fakeEvent(); },
    ImageryLayer: function Layer(p) { this.provider = p; },
  };
  return { C, made };
}
function fakeViewer() {
  const layers = [];
  return { layers, imageryLayers: { add: (l) => layers.push(l), addImageryProvider: (p) => { const l = { provider: p }; layers.push(l); return l; }, remove: (l) => layers.splice(layers.indexOf(l), 1) } };
}
const kinds = (v) => v.layers.map((l) => l.provider.kind);

test('без ключей: снизу встроенный Natural Earth, сверху спутник ion', async () => {
  const { C } = fakeCesium(); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'ion');
  assert.deepEqual(kinds(v), ['natural', 'ion']);
  assert.equal(v.layers[0].provider.url, '/cesium/Assets/Textures/NaturalEarthII');
});

test('токен ion не работает (асинхронная ошибка) — переходим на OSM', async () => {
  const { C } = fakeCesium({ ion: 'fail' }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'osm');
  assert.deepEqual(kinds(v), ['natural', 'osm']);
});

test('ion завис без сети — не ждём вечно', async () => {
  const { C } = fakeCesium({ ion: 'hang' }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v, { timeoutMs: 20 }), 'osm');
});

test('без интернета — только встроенный снимок', async () => {
  const { C } = fakeCesium(); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v, { online: false }), 'offline');
  assert.deepEqual(kinds(v), ['natural']);
});

test('верхний слой с ошибками тайлов снимается, Natural Earth остаётся', async () => {
  const { C } = fakeCesium({ ion: 'fail' }); const v = fakeViewer();
  const changes = [];
  await addFallbackImagery(C, v, { onChange: (s) => changes.push(s) });
  const osm = v.layers[1].provider;
  for (let i = 0; i < TILE_ERROR_LIMIT + 3; i += 1) osm.errorEvent.fire();
  assert.deepEqual(kinds(v), ['natural']);
  assert.deepEqual(changes, ['offline']);
});

test('даже без встроенного снимка глобус не падает', async () => {
  const { C } = fakeCesium({ natural: false, ion: 'fail', osm: false }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'none');
  for (const s of ['ion', 'osm', 'offline', 'none']) assert.ok(SOURCE_TOAST[s]);
});

test('dropOnTileErrors терпит единичные ошибки', () => {
  const v = fakeViewer(); const p = { kind: 'x', errorEvent: fakeEvent() }; const l = v.imageryLayers.addImageryProvider(p);
  dropOnTileErrors(v, l, p);
  for (let i = 0; i < TILE_ERROR_LIMIT - 1; i += 1) p.errorEvent.fire();
  assert.equal(v.layers.length, 1);
});
