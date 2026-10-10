// Политическая карта «Купола» поверх настоящей Земли. Детерминированно строится
// из строки местности (map.json) и постоянного сида мира: провинции, нейтральные
// народы, их города, названия, природные объекты и стартовые зоны. Считается один
// раз при загрузке карты (~0,3 с) и дальше только читается.
//
// Реальные государства, границы и города здесь не используются. Стоп-лист реальных
// названий нужен только для того, чтобы НЕ совпасть с ними.
import { buildGrid, nearestCell } from './grid.js';
import { haversineKm } from './geo.js';
import { createNamer, createRealNameGuard } from './names.js';
import { nextRandom, seedToInt } from './rng.js';
import { isWater } from './data/terrain.js';
import { START_ZONES, isNorthAmerica } from './data/regions.js';

export const WORLD_SEED = 'kupol-world-1';

// ---------- кратчайшие пути по ячейкам ----------
function dijkstraAssign(seeds, neighbors, allowed, cost) {
  const owner = new Int32Array(neighbors.length).fill(-1);
  const dist = new Float64Array(neighbors.length).fill(Infinity);
  // простая двоичная куча
  const heap = [];
  const push = (d, cell, who) => {
    heap.push([d, cell, who]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  seeds.forEach((cell, who) => push(0, cell, who));
  while (heap.length) {
    const [d, cell, who] = pop();
    if (d >= dist[cell]) continue;
    dist[cell] = d;
    owner[cell] = who;
    for (const n of neighbors[cell]) {
      if (!allowed(n) || dist[n] <= d) continue;
      push(d + cost(cell, n), n, who);
    }
  }
  return owner;
}

function components(cells, neighbors) {
  const set = new Set(cells);
  const comp = new Map();
  let id = 0;
  for (const start of cells) {
    if (comp.has(start)) continue;
    const stack = [start];
    comp.set(start, id);
    while (stack.length) {
      const c = stack.pop();
      for (const n of neighbors[c]) if (set.has(n) && !comp.has(n)) { comp.set(n, id); stack.push(n); }
    }
    id += 1;
  }
  return { comp, count: id };
}

function farthestPointSeeds(candidates, count, cells, rngState, existing = []) {
  const seeds = [...existing];
  const minDist = new Map(candidates.map((c) => [c, Infinity]));
  const update = (s) => { for (const c of candidates) minDist.set(c, Math.min(minDist.get(c), haversineKm(cells[c], cells[s]))); };
  seeds.forEach(update);
  if (!seeds.length && candidates.length) {
    const first = candidates[Math.floor(nextRandom(rngState) * candidates.length)];
    seeds.push(first);
    update(first);
  }
  while (seeds.length < count) {
    let best = -1;
    let bestD = -1;
    for (const c of candidates) {
      const d = minDist.get(c) * (0.85 + nextRandom(rngState) * 0.3);
      if (d > bestD) { bestD = d; best = c; }
    }
    if (best < 0 || bestD <= 0) break;
    seeds.push(best);
    update(best);
  }
  return seeds;
}

/**
 * @param {string} terrainString  код местности на ячейку (см. data/terrain.js)
 * @param {{ grid?: object, stopList?: string[], provinceTarget?: number, peopleTarget?: number }} options
 */
export function buildWorld(terrainString, { grid = buildGrid(5), stopList = [], provinceTarget = 500, peopleTarget = 40 } = {}) {
  const { cells, neighbors } = grid;
  const terrain = terrainString.split('');
  const rngState = { rng: seedToInt(WORLD_SEED) };
  const landCells = [];
  for (let i = 0; i < cells.length; i += 1) if (!isWater(terrain[i])) landCells.push(i);
  const habitable = landCells.filter((c) => terrain[c] !== 'I');

  // 2. Провинции: семена расставлены равномерно, на каждом острове хотя бы одно.
  const { comp, count: compCount } = components(habitable, neighbors);
  const byComp = Array.from({ length: compCount }, () => []);
  for (const c of habitable) byComp[comp.get(c)].push(c);
  const islandSeeds = byComp.map((list) => list[Math.floor(list.length / 2)]);
  const seeds = farthestPointSeeds(habitable, Math.max(provinceTarget, islandSeeds.length), cells, rngState, islandSeeds);
  const habitableSet = new Set(habitable);
  const provinceOf = dijkstraAssign(seeds, neighbors, (c) => habitableSet.has(c), (a, b) => {
    let c = 1;
    if (terrain[a] !== terrain[b]) c += 0.8; // естественный рубеж: смена ландшафта
    if ((terrain[a] === 'M') !== (terrain[b] === 'M')) c += 1.5; // хребет
    const coastA = neighbors[a].some((x) => isWater(terrain[x]));
    const coastB = neighbors[b].some((x) => isWater(terrain[x]));
    if (coastA !== coastB) c += 0.2;
    return c;
  });

  const provinces = seeds.map((seed, id) => ({ id, seed, cells: [] }));
  for (const c of habitable) if (provinceOf[c] >= 0) provinces[provinceOf[c]].cells.push(c);
  const liveProvinces = provinces.filter((p) => p.cells.length > 0);
  // перенумеровываем, чтобы не было пустых
  const remap = new Map(liveProvinces.map((p, i) => [p.id, i]));
  const province = new Int32Array(cells.length).fill(-1);
  for (const c of habitable) province[c] = remap.get(provinceOf[c]);
  const provs = liveProvinces.map((p, i) => {
    const center = p.cells.reduce((best, c) => (haversineKm(cells[c], cells[p.seed]) < haversineKm(cells[best], cells[p.seed]) ? c : best), p.cells[0]);
    const counts = {};
    for (const c of p.cells) counts[terrain[c]] = (counts[terrain[c]] ?? 0) + 1;
    return { id: i, cells: p.cells, center, na: isNorthAmerica(cells[center]), touchesNA: p.cells.some((c) => isNorthAmerica(cells[c])), counts };
  });
  // соседство провинций
  const provNeighbors = provs.map(() => new Set());
  for (const c of habitable) for (const n of neighbors[c]) {
    if (province[n] >= 0 && province[n] !== province[c]) provNeighbors[province[c]].add(province[n]);
  }

  // 3. Нейтральные народы за пределами Северной Америки.
  const overseas = provs.filter((p) => !p.na && !p.touchesNA && p.cells.length >= 2);
  const peopleSeedsProv = farthestPointSeeds(overseas.map((p) => p.id), peopleTarget, provs.map((p) => cells[p.center]), rngState);
  const peopleOf = new Int32Array(provs.length).fill(-1);
  const sizes = new Array(peopleSeedsProv.length).fill(0);
  const MAX_PROVINCES = 9;
  const frontier = peopleSeedsProv.map((p, who) => { peopleOf[p] = who; sizes[who] = 1; return [p]; });
  let grew = true;
  while (grew) {
    grew = false;
    for (let who = 0; who < frontier.length; who += 1) {
      if (sizes[who] >= MAX_PROVINCES) continue;
      const next = [];
      for (const p of frontier[who]) for (const q of provNeighbors[p]) {
        if (peopleOf[q] < 0 && !provs[q].na && !provs[q].touchesNA && sizes[who] < MAX_PROVINCES && nextRandom(rngState) < 0.7) {
          peopleOf[q] = who; sizes[who] += 1; next.push(q); grew = true;
        }
      }
      frontier[who] = next.length ? next : frontier[who].filter((p) => [...provNeighbors[p]].some((q) => peopleOf[q] < 0 && !provs[q].na));
    }
  }

  const cultureFor = (provList) => {
    const counts = {};
    let lat = 0;
    for (const p of provList) { for (const [k, v] of Object.entries(p.counts)) counts[k] = (counts[k] ?? 0) + v; lat += cells[p.center].lat; }
    lat /= provList.length;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const share = (k) => (counts[k] ?? 0) / total;
    if (Math.abs(lat) > 52 || share('T') > 0.3) return 'northern';
    if (share('D') > 0.4) return Math.abs(lat) < 32 ? 'desert' : 'steppe';
    if (share('M') > 0.25) return 'highland';
    if (total <= 6) return 'island';
    if (Math.abs(lat) > 38 && share('P') > 0.5) return 'steppe';
    return 'coastal';
  };

  // стоп-список нужен только чтобы НЕ совпасть с реальными названиями
  const namer = createNamer(rngState, { tooReal: createRealNameGuard(stopList) });
  const PEOPLE_COLORS = ['#8a7f6a', '#6f8a7a', '#7a6f8a', '#8a6f6f', '#6f7f8a', '#8a866f', '#7d8a6f', '#6f8a86'];
  const peoples = peopleSeedsProv.map((seedProv, id) => {
    const list = provs.filter((p) => peopleOf[p.id] === id);
    const culture = cultureFor(list);
    return { id, name: namer.region(culture), culture, color: PEOPLE_COLORS[id % PEOPLE_COLORS.length], provinces: list.map((p) => p.id), capital: -1 };
  });

  // 4. Названия провинций.
  const zoneCulture = (p) => {
    if (peopleOf[p.id] >= 0) return peoples[peopleOf[p.id]].culture;
    return cultureFor([p]);
  };
  const provinceOut = provs.map((p) => ({
    id: p.id,
    name: namer.region(zoneCulture(p)),
    center: p.center,
    size: p.cells.length,
    na: p.na,
    people: peopleOf[p.id] >= 0 ? peopleOf[p.id] : null,
  }));

  // 5. Города нейтральных народов: лучшее место в провинции.
  const cellScore = (c) => {
    if (isWater(terrain[c]) || terrain[c] === 'I') return -Infinity;
    const yieldOf = (x) => ({ P: 3, F: 3, D: 1, T: 1, M: 2, S: 1.5, O: 1, I: 0 }[terrain[x]]);
    let s = yieldOf(c) * 1.5;
    for (const n of neighbors[c]) s += yieldOf(n);
    if (neighbors[c].some((x) => isWater(terrain[x]))) s += 2.5; // бухта
    if (terrain[c] === 'M') s -= 3;
    return s;
  };
  const cities = [];
  const taken = new Set();
  for (const people of peoples) {
    const sites = [];
    for (const pid of people.provinces) {
      const options = provs[pid].cells.filter((c) => !taken.has(c) && !neighbors[c].some((n) => taken.has(n)));
      if (!options.length) continue;
      const best = options.reduce((a, b) => (cellScore(b) > cellScore(a) ? b : a));
      if (cellScore(best) < 9) continue;
      sites.push(best);
      taken.add(best);
    }
    sites.sort((a, b) => cellScore(b) - cellScore(a));
    sites.forEach((cell, k) => {
      const index = cities.length;
      cities.push({ cell, name: namer.city(people.culture), people: people.id, capital: k === 0 });
      if (k === 0) people.capital = index;
    });
  }

  // 6. Природные объекты: горные хребты и океаны получают выдуманные имена.
  const mountainCells = landCells.filter((c) => terrain[c] === 'M');
  const mcomp = components(mountainCells, neighbors);
  const ranges = Array.from({ length: mcomp.count }, () => []);
  for (const c of mountainCells) ranges[mcomp.comp.get(c)].push(c);
  const features = ranges
    .filter((list) => list.length >= 4)
    .map((list) => ({ kind: 'mountains', name: `Хребет ${namer.city('highland')}`, cell: list[Math.floor(list.length / 2)], size: list.length }));
  const OCEANS = [
    { lat: 30, lon: -40 }, { lat: -25, lon: -15 }, { lat: 20, lon: -150 }, { lat: -30, lon: -120 },
    { lat: -20, lon: 75 }, { lat: 82, lon: 0 }, { lat: -62, lon: 60 },
  ];
  for (const o of OCEANS) features.push({ kind: 'ocean', name: `Океан ${namer.city('coastal')}`, cell: nearestCell(grid, o) });

  // 7. Стартовые зоны в Северной Америке.
  const startZones = START_ZONES.map((zone) => {
    const candidates = landCells.filter((c) => isNorthAmerica(cells[c]) && province[c] >= 0
      && ['P', 'F'].includes(terrain[c]) && haversineKm(cells[c], zone.anchor) <= 700);
    if (!candidates.length) throw new Error(`Нет места для стартовой зоны ${zone.id}`);
    const cell = candidates.reduce((a, b) => (cellScore(b) - haversineKm(cells[b], zone.anchor) / 300 > cellScore(a) - haversineKm(cells[a], zone.anchor) / 300 ? b : a));
    return { id: zone.id, name: zone.name, cell, province: province[cell] };
  });

  return {
    province: Array.from(province),
    provinces: provinceOut,
    peoples: peoples.map(({ id, name, culture, color, capital }) => ({ id, name, culture, color, capital })),
    cities,
    features,
    startZones,
  };
}
