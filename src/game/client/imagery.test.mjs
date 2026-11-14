import assert from 'node:assert/strict';
import test from 'node:test';
import { addFallbackImagery, dropOnTileErrors, TILE_ERROR_LIMIT, SOURCE_TOAST } from './imagery.js';

function fakeEvent() { const fns = []; return { fns, addEventListener: (f) => { fns.push(f); return () => fns.splice(fns.indexOf(f), 1); }, fire: () => [...fns].forEach((f) => f()) }; }
function fakeCesium({ natural = true, ion = 'ok', esri = true, osm = true } = {}) {
  const made = [];
  const C = {
    buildModuleUrl: (p) => `/cesium/${p}`,
    TileMapServiceImageryProvider: { fromUrl: async (url) => { if (!natural) throw new Error('404'); const p = { kind: 'natural', url, errorEvent: fakeEvent() }; made.push(p); return p; } },
    IonImageryProvider: { fromAssetId: (id) => (ion === 'ok' ? Promise.resolve({ kind: 'ion', id, errorEvent: fakeEvent() }) : ion === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('401'))) },
    UrlTemplateImageryProvider: function Esri(o) { if (!esri) throw new Error('esri'); this.kind = 'esri'; this.url = o.url; this.errorEvent = fakeEvent(); },
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

test('без ключей: снизу встроенный Natural Earth, сверху реальный спутник ArcGIS', async () => {
  const { C } = fakeCesium(); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'esri');
  assert.deepEqual(kinds(v), ['natural', 'esri']);
  assert.equal(v.layers[0].provider.url, '/cesium/Assets/Textures/NaturalEarthII');
  assert.match(v.layers[1].provider.url, /World_Imagery/);
});

test('ArcGIS недоступен — тогда ионный снимок, несмотря на разрешение', async () => {
  const { C } = fakeCesium({ esri: false }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'ion');
  assert.deepEqual(kinds(v), ['natural', 'ion']);
});

test('ion завис без сети — не ждём вечно', async () => {
  const { C } = fakeCesium({ ion: 'hang', esri: false }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v, { timeoutMs: 20 }), 'osm');
});

test('токен ion не работает — кладём фото-спутник ArcGIS без ключа', async () => {
  const { C } = fakeCesium({ ion: 'fail' }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'esri');
  assert.deepEqual(kinds(v), ['natural', 'esri']);
});

test('ни ArcGIS, ни ion — остаётся векторный OpenStreetMap', async () => {
  const { C } = fakeCesium({ ion: 'fail', esri: false }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'osm');
  assert.deepEqual(kinds(v), ['natural', 'osm']);
});

test('без интернета — только встроенный снимок', async () => {
  const { C } = fakeCesium(); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v, { online: false }), 'offline');
  assert.deepEqual(kinds(v), ['natural']);
});

test('верхний слой с ошибками тайлов снимается, Natural Earth остаётся', async () => {
  const { C } = fakeCesium(); const v = fakeViewer();
  const changes = [];
  await addFallbackImagery(C, v, { onChange: (s) => changes.push(s) });
  const top = v.layers[1].provider;
  for (let i = 0; i < TILE_ERROR_LIMIT + 3; i += 1) top.errorEvent.fire();
  assert.deepEqual(kinds(v), ['natural']);
  assert.deepEqual(changes, ['offline']);
  assert.equal(top.errorEvent.fns.length, 0, 'слушатель снят вместе со слоем');
});

test('ion ответил после таймаута — брошенный провайдер освобождается', async () => {
  const { withTimeout } = await import('./imagery.js');
  let destroyed = false; let resolve;
  const late = new Promise((r) => { resolve = r; });
  await assert.rejects(withTimeout(late, 10, 'ion timeout'), /ion timeout/);
  resolve({ destroy: () => { destroyed = true; } });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(destroyed);
});

test('даже без встроенного снимка глобус не падает', async () => {
  const { C } = fakeCesium({ natural: false, ion: 'fail', esri: false, osm: false }); const v = fakeViewer();
  assert.equal(await addFallbackImagery(C, v), 'none');
  for (const s of ['ion', 'esri', 'osm', 'offline', 'none']) assert.ok(SOURCE_TOAST[s]);
});

test('dropOnTileErrors терпит единичные ошибки', () => {
  const v = fakeViewer(); const p = { kind: 'x', errorEvent: fakeEvent() }; const l = v.imageryLayers.addImageryProvider(p);
  dropOnTileErrors(v, l, p);
  for (let i = 0; i < TILE_ERROR_LIMIT - 1; i += 1) p.errorEvent.fire();
  assert.equal(v.layers.length, 1);
});
