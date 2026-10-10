// Загрузка готовой карты мира (data/game/map.json) и производные структуры.
// Карта читается один раз на процесс и дальше только используется.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGrid } from './grid.js';
import { isWater } from './data/terrain.js';
import { buildWorld } from './worldgen.js';

const DEFAULT_PATH = fileURLToPath(new URL('../../data/game/map.json', import.meta.url));
export const STOP_LIST_PATH = fileURLToPath(new URL('../../data/game/real-names-stoplist.json', import.meta.url));
let stopList = null;

/** Стоп-список реальных названий (только для того, чтобы их избегать). */
export function loadStopList() {
  stopList ??= JSON.parse(readFileSync(STOP_LIST_PATH, 'utf8'));
  return stopList;
}
let cached = null;

export function prepareMap(input) {
  const source = { ...input, terrain: Array.isArray(input.terrain) ? input.terrain.join('') : input.terrain };
  const grid = buildGrid(source.gridLevel);
  if (source.terrain.length !== grid.cells.length) throw new Error('map.json не соответствует сетке');
  const raw = { ...source, ...buildWorld(source.terrain, { grid, stopList: loadStopList() }) };
  const terrain = raw.terrain;
  const coast = new Uint8Array(grid.cells.length);
  for (let i = 0; i < grid.cells.length; i += 1) {
    if (!isWater(terrain[i]) && grid.neighbors[i].some((n) => isWater(terrain[n]))) coast[i] = 1;
  }
  const naCells = new Set();
  raw.province.forEach((p, cell) => { if (p >= 0 && raw.provinces[p].na) naCells.add(cell); });
  return {
    raw,
    cells: grid.cells,
    neighbors: grid.neighbors,
    terrain,
    coast,
    province: raw.province,
    provinces: raw.provinces,
    peoples: raw.peoples,
    cities: raw.cities,
    startZones: raw.startZones,
    features: raw.features,
    naCells,
    size: grid.cells.length,
  };
}

export function loadMap(path = DEFAULT_PATH) {
  if (cached && cached.path === path) return cached.map;
  const map = prepareMap(JSON.parse(readFileSync(path, 'utf8')));
  cached = { path, map };
  return map;
}

/** Ячейки на расстоянии ≤ radius шагов (включая саму ячейку), в порядке BFS. */
export function cellsWithin(map, start, radius, allowed = () => true) {
  const seen = new Map([[start, 0]]);
  const order = [start];
  for (let i = 0; i < order.length; i += 1) {
    const c = order[i];
    const d = seen.get(c);
    if (d >= radius) continue;
    for (const n of map.neighbors[c]) {
      if (seen.has(n) || !allowed(n)) continue;
      seen.set(n, d + 1);
      order.push(n);
    }
  }
  return order;
}

/** Число шагов между ячейками по сетке (BFS, с ограничением глубины). */
export function hopDistance(map, a, b, limit = 64) {
  if (a === b) return 0;
  const seen = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= limit; d += 1) {
    const next = [];
    for (const c of frontier) for (const n of map.neighbors[c]) {
      if (n === b) return d;
      if (!seen.has(n)) { seen.add(n); next.push(n); }
    }
    frontier = next;
  }
  return Infinity;
}
