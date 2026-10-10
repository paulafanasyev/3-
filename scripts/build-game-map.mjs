#!/usr/bin/env node
// Сборка карты местности «Купола». Запускается ОДИН раз, результат коммитится в
// data/game/map.json: тип местности на каждую из 10 242 ячеек, снятый с настоящей
// Земли. Политическая карта (провинции, народы, города) строится поверх неё
// детерминированно в src/game/worldgen.js.
//
// Входные данные (только настоящая Земля, без политических слоёв):
//   --land     GeoJSON суши. Эталон: Natural Earth ne_50m_land (public domain).
//   --imagery  Снимок Земли в равнопромежуточной проекции, 2:1. Эталон:
//              NASA Blue Marble (public domain).
// Скрипт НЕ читает реальные границы государств и списки городов.
//
//   node scripts/build-game-map.mjs --land data/game/sources/ne_50m_land.geojson \
//     --imagery data/game/sources/blue-marble.jpg --out data/game/map.json
import { applyGeoOverrides } from '../src/game/data/geoOverrides.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { buildGrid, GRID_LEVEL } from '../src/game/grid.js';
import { isWater } from '../src/game/data/terrain.js';

export const MAP_VERSION = 2;
const RASTER_W = 4096;
const RASTER_H = 2048;

// ---------- растры ----------
async function rasterizeLand(geojson) {
  const sx = RASTER_W / 360;
  const sy = RASTER_H / 180;
  const ring = (coords) => coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${((lon + 180) * sx).toFixed(1)} ${((90 - lat) * sy).toFixed(1)}`).join('') + 'Z';
  const paths = [];
  for (const feature of geojson.features) {
    const g = feature.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const polygon of polygons) paths.push(polygon.map(ring).join(''));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_W}" height="${RASTER_H}"><rect width="100%" height="100%" fill="#000"/><path fill="#fff" fill-rule="evenodd" d="${paths.join('')}"/></svg>`;
  const { data } = await sharp(Buffer.from(svg), { limitInputPixels: false }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data; // 1 байт на пиксель
}

async function loadImagery(path) {
  const { data, info } = await sharp(path).resize(RASTER_W, RASTER_H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('Ожидается RGB-снимок');
  return data;
}

const px = (lat, lon) => {
  const x = Math.min(RASTER_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * RASTER_W)));
  const y = Math.min(RASTER_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * RASTER_H)));
  return y * RASTER_W + x;
};

// Точки отбора внутри ячейки: центр и кольцо на ~80 км (ячейка ~220 км).
function samplePoints(cell) {
  const points = [cell];
  const dLat = 80 / 111;
  const dLon = dLat / Math.max(0.15, Math.cos((cell.lat * Math.PI) / 180));
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    let lon = cell.lon + Math.cos(a) * dLon;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    points.push({ lat: Math.max(-89.9, Math.min(89.9, cell.lat + Math.sin(a) * dLat)), lon });
  }
  return points;
}

// ---------- классификация местности по цвету снимка ----------
export function classifyLand({ r, g, b, spread, lat }) {
  const bright = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const absLat = Math.abs(lat);
  if (bright > 175 && sat < 0.18) return absLat > 58 ? 'I' : 'M'; // снег: полярный лёд или высокогорье
  if (spread > 34 && bright < 150) return 'M'; // резкий рельеф на снимке
  if (r > g + 6 && bright > 105) return 'D'; // охра, песок, сухая степь
  if (g >= r - 2 && bright < 72) return absLat > 62 ? 'T' : 'F'; // тёмная зелень
  if (absLat > 60) return 'T';
  return 'P';
}

// ---------- основная сборка ----------
export async function buildMap({ land, imagery }) {
  const grid = buildGrid(GRID_LEVEL);
  const { cells, neighbors } = grid;
  const landMask = await rasterizeLand(land);
  const image = await loadImagery(imagery);

  // 1. Суша / вода и тип местности.
  const terrain = new Array(cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    const pts = samplePoints(cells[i]);
    let landHits = 0;
    let r = 0; let g = 0; let b = 0; let n = 0;
    const brights = [];
    for (const p of pts) {
      const idx = px(p.lat, p.lon);
      if (landMask[idx] > 127) {
        landHits += 1;
        const rr = image[idx * 3]; const gg = image[idx * 3 + 1]; const bb = image[idx * 3 + 2];
        r += rr; g += gg; b += bb; n += 1;
        brights.push((rr + gg + bb) / 3);
      }
    }
    if (landHits * 2 <= pts.length) { terrain[i] = 'O'; continue; }
    const mean = brights.reduce((a, x) => a + x, 0) / brights.length;
    const spread = Math.sqrt(brights.reduce((a, x) => a + (x - mean) ** 2, 0) / brights.length);
    terrain[i] = classifyLand({ r: r / n, g: g / n, b: b / n, spread, lat: cells[i].lat });
  }
  for (let i = 0; i < cells.length; i += 1) {
    if (terrain[i] === 'O' && neighbors[i].some((x) => !isWater(terrain[x]))) terrain[i] = 'S';
  }
  // 2. Ручные поправки: Великие озёра и Панамский перешеек (src/game/data/geoOverrides.js).
  applyGeoOverrides(terrain.join(''), grid).split('').forEach((code, i) => { terrain[i] = code; });
  return {
    version: MAP_VERSION,
    gridLevel: GRID_LEVEL,
    sources: {
      land: 'Natural Earth 1:50m land (public domain)',
      imagery: 'Снимок Blue Marble: укажите фактический файл и его лицензию (NASA visibleearth — public domain)',
      overrides: 'Великие озёра и Панамский перешеек: src/game/data/geoOverrides.js',
    },
    // строки по 100 ячеек: файл легко читать и сравнивать в диффах
    terrain: Array.from({ length: Math.ceil(terrain.length / 100) }, (_, i) => terrain.slice(i * 100, i * 100 + 100).join('')),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      land: { type: 'string', default: 'data/game/sources/ne_50m_land.geojson' },
      imagery: { type: 'string', default: 'data/game/sources/blue-marble.jpg' },
      out: { type: 'string', default: 'data/game/map.json' },
    },
  });
  const land = JSON.parse(readFileSync(values.land, 'utf8'));
  const map = await buildMap({ land, imagery: values.imagery });
  writeFileSync(values.out, `${JSON.stringify(map, null, 1)}\n`);
  const all = map.terrain.join('');
  const counts = {};
  for (const ch of all) counts[ch] = (counts[ch] ?? 0) + 1;
  console.log(`map.json: ${all.length} ячеек, местность ${JSON.stringify(counts)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
