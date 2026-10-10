import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMap, loadStopList, cellsWithin } from './map.js';
import { haversineKm } from './geo.js';
import { isWater } from './data/terrain.js';
import { isNorthAmerica } from './data/regions.js';
import { createRealNameGuard, normalizeName } from './names.js';

const map = loadMap();

test('map.json соответствует сетке и содержит все разделы', () => {
  assert.equal(map.terrain.length, map.size);
  assert.equal(map.province.length, map.size);
  assert.ok(map.provinces.length >= 400 && map.provinces.length <= 600);
  assert.ok(map.peoples.length >= 30);
  assert.ok(map.cities.length >= 200);
  assert.equal(map.startZones.length, 4);
});

test('провинции лежат на суше и связны', () => {
  const cellsOf = new Map();
  map.province.forEach((p, cell) => {
    if (p < 0) return;
    assert.ok(!isWater(map.terrain[cell]), `провинция ${p} на воде`);
    if (!cellsOf.has(p)) cellsOf.set(p, []);
    cellsOf.get(p).push(cell);
  });
  for (const [p, cells] of cellsOf) {
    const set = new Set(cells);
    const reach = cellsWithin(map, cells[0], 1000, (c) => set.has(c));
    assert.equal(reach.length, cells.length, `провинция ${p} несвязна`);
  }
});

test('стартовые зоны в Северной Америке, на суше и не ближе 1500 км друг к другу', () => {
  for (const z of map.startZones) {
    assert.ok(isNorthAmerica(map.cells[z.cell]), z.id);
    assert.ok(!isWater(map.terrain[z.cell]), z.id);
    assert.ok(map.naCells.has(z.cell), z.id);
  }
  for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) {
    const d = haversineKm(map.cells[map.startZones[i].cell], map.cells[map.startZones[j].cell]);
    assert.ok(d >= 1500, `${map.startZones[i].id}–${map.startZones[j].id}: ${Math.round(d)} км`);
  }
});

test('нейтральные народы и их города только за пределами Северной Америки', () => {
  for (const c of map.cities) assert.ok(!map.naCells.has(c.cell));
  for (const p of map.provinces) if (p.people !== null) assert.equal(p.na, false);
});

test('ни одно название не совпадает с реальной страной или крупным городом', () => {
  const tooReal = createRealNameGuard(loadStopList());
  const exact = new Set(loadStopList().map(normalizeName));
  const names = [
    ...map.provinces.map((p) => p.name), ...map.peoples.map((p) => p.name),
    ...map.cities.map((c) => c.name), ...map.features.map((f) => f.name.split(' ').at(-1)),
  ];
  assert.equal(new Set(names.map(normalizeName)).size, names.length, 'имена должны быть уникальны');
  for (const n of names) {
    assert.ok(!exact.has(normalizeName(n)), `реальное название: ${n}`);
    assert.ok(!tooReal(n), `слишком похоже на реальное: ${n}`);
  }
});

test('сборщик карты и генератор мира не читают реальные границы государств и списки городов', () => {
  const source = ['../../scripts/build-game-map.mjs', './worldgen.js'].map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')).join('\n');
  for (const forbidden of ['admin_0', 'admin-0', 'populated_places', 'countries']) {
    assert.ok(!source.includes(forbidden), `в сборщике упоминается ${forbidden}`);
  }
});

test('ни одна клетка провинций нейтральных народов не лежит в Северной Америке', () => {
  map.province.forEach((p, cell) => {
    if (p < 0 || map.provinces[p].people === null) return;
    assert.ok(!isNorthAmerica(map.cells[cell]), `клетка ${cell} провинции ${p}`);
  });
});
