// Общие правила: доходы ячеек и городов, доступность, бой, видимость, пути.
// Чистые функции над состоянием; ничего не мутируют.
import { TERRAIN, COAST_FOOD_BONUS, isWater, STRATEGIC } from './data/terrain.js';
import { TECHS, ERAS, CATCH_UP_DISCOUNT } from './data/techs.js';
import { UNITS, VETERAN_STEP } from './data/units.js';
import { BUILDINGS, launchDiscount } from './data/buildings.js';
import { DOCTRINES } from './data/nations.js';
import { cellsWithin } from './map.js';
import { own } from './events.js';

export const MAJOR = 'major';

/** Бессрочные проекты города: перевод производства в науку или золото. */
export const PROJECTS = Object.freeze({
  science: { name: 'Научный проект', rate: 0.5 },
  gold: { name: 'Торговый проект', rate: 0.7 },
});
export const isNeutralId = (id) => typeof id === 'string' && id.startsWith('p');

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------- нации и технологии ----------
export function majorIds(state) {
  return Object.keys(state.nations);
}

export function hasTech(state, nationId, tech) {
  return state.nations[nationId]?.techs.includes(tech) ?? false;
}

export function techCost(state, nationId, tech) {
  const t = TECHS[tech];
  const known = majorIds(state).filter((id) => id !== nationId && state.nations[id].alive && hasTech(state, id, tech)).length;
  return Math.round(ERAS[t.era].cost * Math.max(0.5, 1 - CATCH_UP_DISCOUNT * known));
}

export function availableTechs(state, nationId) {
  const n = state.nations[nationId];
  return Object.entries(TECHS)
    .filter(([id, t]) => !n.techs.includes(id) && t.era <= n.era && t.req.every((r) => n.techs.includes(r)))
    .map(([id]) => id);
}

export function hasResource(state, nationId, resource) {
  const n = state.nations[nationId];
  if (!n || STRATEGIC[resource].era > n.era) return false;
  const owns = (id) => state.resourceCells[resource].some((cell) => state.owner[cell] === id);
  if (owns(nationId)) return true;
  // торговый договор открывает доступ к ресурсам партнёра (§9)
  return state.treaties.some((t) => t.type === 'trade' && (t.a === nationId || t.b === nationId) && owns(t.a === nationId ? t.b : t.a));
}

// ---------- доходы ----------
export function cellYield(state, map, cell, ownerId) {
  // радиоактивные осадки: клетка ничего не даёт, пока не очистится
  if ((state.fallout?.[cell] ?? 0) > state.turn) return { food: 0, prod: 0, gold: 0 };
  const code = map.terrain[cell];
  const t = TERRAIN[code];
  let food = t.food;
  let prod = t.prod;
  let gold = t.gold;
  if (map.coast[cell]) food += COAST_FOOD_BONUS;
  const res = state.resourceAt[cell];
  if (res && ownerId && !isNeutralId(ownerId) && STRATEGIC[res].era <= (state.nations[ownerId]?.era ?? 0)) {
    if (res === 'silicon') gold += 1; else prod += 1;
  }
  const doctrine = state.nations[ownerId]?.doctrine;
  if (doctrine === 'resilience' && code === 'T') food += DOCTRINES.resilience.tundraFood;
  return { food, prod, gold };
}

export function cityRadius(city) {
  return city.pop >= 5 ? 2 : 1;
}

export function workedCells(state, map, city) {
  const options = cellsWithin(map, city.cell, cityRadius(city))
    .filter((c) => c !== city.cell && state.owner[c] === city.owner);
  const score = (c) => {
    const y = cellYield(state, map, c, city.owner);
    return y.food * 1.2 + y.prod + y.gold * 0.6;
  };
  options.sort((a, b) => score(b) - score(a) || a - b);
  return options.slice(0, city.pop);
}

export function cityYield(state, map, city) {
  const centre = cellYield(state, map, city.cell, city.owner);
  let food = Math.max(3, centre.food);
  let prod = Math.max(1, centre.prod);
  let gold = centre.gold + 1;
  for (const c of workedCells(state, map, city)) {
    const y = cellYield(state, map, c, city.owner);
    food += y.food; prod += y.prod; gold += y.gold;
  }
  let science = city.pop * 0.5 + 1;
  let prodPct = 0;
  let sciencePct = 0;
  for (const b of city.buildings) {
    const def = BUILDINGS[b];
    food += def.food ?? 0;
    prod += def.prod ?? 0;
    gold += def.gold ?? 0;
    science += def.science ?? 0;
    prodPct += def.prodPct ?? 0;
    sciencePct += def.sciencePct ?? 0;
  }
  const nation = state.nations[city.owner];
  if (nation) {
    const d = DOCTRINES[nation.doctrine];
    sciencePct += d.sciencePct ?? 0;
    if (d.goldPct) gold *= 1 + d.goldPct;
    if (state.treaties.some((t) => t.type === 'research' && (t.a === city.owner || t.b === city.owner))) sciencePct += 0.1;
  }
  gold += city.pop * 0.4;
  const mult = (isOccupied(state, city) ? OCCUPATION_YIELD : 1) * (1 - empirePenalty(state, city.owner));
  return {
    food: food * nuclearWinter(state),
    prod: prod * (1 + prodPct) * mult,
    gold: gold * mult,
    science: science * (1 + sciencePct) * mult,
    upkeep: city.pop * 2,
  };
}

/** Захваченный город: столько ходов оккупации, доход ×OCCUPATION_YIELD, рост стоит. */
export const OCCUPATION_TURNS = 8;
export const OCCUPATION_YIELD = 0.5;
/** Размер державы: первые EMPIRE_FREE_CITIES городов бесплатно, дальше −2,8% к доходу за город, не больше −45%. */
export const EMPIRE_FREE_CITIES = 12;
export const EMPIRE_PENALTY_PER_CITY = 0.028;
export const EMPIRE_PENALTY_CAP = 0.45;

/** Ядерная зима (см. nuclear.js): −5% еды за удар за последние 30 ходов, не ниже −30%. */
export function nuclearWinter(state) {
  const strikes = state.nuclear?.strikes;
  if (!strikes?.length) return 1;
  const recent = strikes.filter((x) => !x.intercepted && state.turn - x.turn < 30).length;
  return Math.max(0.7, 1 - 0.05 * recent);
}

export const isOccupied = (state, city) => (city.occupiedUntil ?? 0) > state.turn;

export function empirePenalty(state, owner) {
  if (!own(state.nations, owner)) return 0;
  let n = 0;
  for (const c of Object.values(state.cities)) if (c.owner === owner) n += 1;
  return Math.min(EMPIRE_PENALTY_CAP, Math.max(0, n - EMPIRE_FREE_CITIES) * EMPIRE_PENALTY_PER_CITY);
}

export const growthThreshold = (pop) => 10 + 5 * pop;

// ---------- производство ----------
export function itemCost(state, map, city, item) {
  if (item.kind === 'dome' || item.kind === 'project') return Infinity; // бессрочные: вклад в «Купол», проекты
  const nation = state.nations[city.owner];
  if (item.kind === 'unit') {
    let cost = UNITS[item.id].cost;
    if (item.id === 'settler' && nation?.doctrine === 'expansion') cost *= 0.75;
    if (UNITS[item.id].needs === 'spaceport') {
      // скидки не складываются: берётся лучшая из широтной и доктринальной (баланс, см. DESIGN §6.2)
      const doctrineDiscount = DOCTRINES[nation?.doctrine]?.spaceDiscount ?? 0;
      cost *= 1 - Math.max(launchDiscount(map.cells[city.cell].lat), doctrineDiscount);
    }
    return Math.round(cost);
  }
  return BUILDINGS[item.id].cost;
}

/** Причина, по которой предмет нельзя строить, или null. */
export function itemBlocker(state, map, city, item) {
  const nationId = city.owner;
  if (item.kind === 'project') return own(PROJECTS, item.id) ? null : 'ITEM_UNAVAILABLE';
  if (item.kind === 'dome') {
    if (!state.finale.detectedTurn) return 'NO_FINALE';
    if (state.nations[nationId].finale.path !== 'pact') return 'NOT_IN_PACT';
    // сегменты щита выводят на орбиту тяжёлые носители; «Планетарный щит» усиливает их (turn.js)
    if (!hasTech(state, nationId, 'heavyLift')) return 'TECH_UNAVAILABLE';
    return null;
  }
  if (item.kind === 'unit') {
    if (!own(UNITS, item.id)) return 'ITEM_UNAVAILABLE';
    const u = UNITS[item.id];
    if (u.tech && !hasTech(state, nationId, u.tech)) return 'TECH_UNAVAILABLE';
    if (u.resource && !hasResource(state, nationId, u.resource)) return 'NEED_RESOURCE';
    if (u.needs && !city.buildings.includes(u.needs)) return u.needs === 'silo' ? 'NEED_SILO' : 'NEED_SPACEPORT';
    if (u.domain === 'sea' && !map.coast[city.cell]) return 'ITEM_UNAVAILABLE';
    return null;
  }
  if (item.kind === 'building') {
    if (!own(BUILDINGS, item.id)) return 'ITEM_UNAVAILABLE';
    const b = BUILDINGS[item.id];
    if (city.buildings.includes(item.id)) return 'ITEM_UNAVAILABLE';
    if (b.tech && !hasTech(state, nationId, b.tech)) return 'TECH_UNAVAILABLE';
    if (b.coastal && !map.coast[city.cell]) return 'ITEM_UNAVAILABLE';
    if (b.maxLat !== undefined && Math.abs(map.cells[city.cell].lat) > b.maxLat) return 'ITEM_UNAVAILABLE';
    if (b.finale === 'ark' && (state.nations[nationId].finale.path !== 'ark' || !city.capital)) return 'ITEM_UNAVAILABLE';
    if (b.tech === undefined && b.era > state.nations[nationId].era) return 'TECH_UNAVAILABLE';
    return null;
  }
  return 'ITEM_UNAVAILABLE';
}

// ---------- юниты и движение ----------
export function unitsAt(state, cell) {
  return state.unitsByCell[cell] ?? [];
}

export function canEnter(state, map, unit, cell) {
  const def = UNITS[unit.type];
  const water = isWater(map.terrain[cell]);
  if (def.domain === 'space') return false;
  if (def.domain === 'air') return true;
  if (def.domain === 'sea') {
    if (water) return true;
    const city = state.cityAt[cell];
    return Boolean(city && state.cities[city].owner === unit.owner);
  }
  // высадка на воду (как в Civ V/VI): шельф с Мореходства, открытый океан с Парового двигателя
  if (water) {
    if (!hasTech(state, unit.owner, 'seafaring')) return false;
    if (map.terrain[cell] === 'O' && !hasTech(state, unit.owner, 'steam')) return false;
    if (def.civilian && unit.type !== 'settler') return false;
    return true;
  }
  return true;
}

/** Стоимость клетки для юнита, который сейчас в `from`. Посадка и высадка съедают весь ход. */
export const EMBARK_COST = 99;

export function moveCost(map, cell, unit, from = unit.cell) {
  const def = UNITS[unit.type];
  if (def.domain !== 'land') return 1;
  const toWater = isWater(map.terrain[cell]);
  const fromWater = isWater(map.terrain[from]);
  if (toWater !== fromWater) return EMBARK_COST;
  if (toWater) return 2; // на воде сухопутный юнит идёт медленно
  return TERRAIN[map.terrain[cell]].move;
}

export const isEmbarked = (map, unit) => UNITS[unit.type].domain === 'land' && isWater(map.terrain[unit.cell]);

/** Минимальная двоичная куча по [приоритет, ячейка]; равенство решает индекс ячейки. */
export class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  static less(x, y) { return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!MinHeap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && MinHeap.less(a[l], a[m])) m = l;
        if (r < a.length && MinHeap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Кратчайший путь (по стоимости хода) для юнита. Возвращает массив ячеек без старта. */
export function findPath(state, map, unit, target, { maxNodes = 3000, allowEnemyAt = null } = {}) {
  if (unit.cell === target) return [];
  const embarkPathCost = Math.max(2, UNITS[unit.type].moves ?? 2) + 1; // посадка съедает целый ход
  const dist = new Map([[unit.cell, 0]]);
  const prev = new Map();
  const open = new MinHeap();
  open.push([0, unit.cell]);
  let visited = 0;
  while (open.size && visited < maxNodes) {
    const [d, cell] = open.pop();
    if (d > dist.get(cell)) continue;
    visited += 1;
    if (cell === target) break;
    for (const n of map.neighbors[cell]) {
      if (!canEnter(state, map, unit, n)) continue;
      if (n !== target && n !== allowEnemyAt && blockedFor(state, unit, n)) continue;
      const step = moveCost(map, n, unit, cell);
      const nd = d + (step === EMBARK_COST ? embarkPathCost : Math.min(4, step));
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, cell);
        open.push([nd, n]);
      }
    }
  }
  if (!prev.has(target)) return null;
  const path = [];
  for (let c = target; c !== unit.cell; c = prev.get(c)) path.push(c);
  return path.reverse();
}

/** Клетка занята чужими юнитами или чужим городом. */
export function blockedFor(state, unit, cell) {
  if (unitsAt(state, cell).some((id) => state.units[id].owner !== unit.owner)) return true;
  const city = state.cityAt[cell];
  return Boolean(city && state.cities[city].owner !== unit.owner);
}

// ---------- бой ----------
export function unitStrength(state, unit) {
  const def = UNITS[unit.type];
  const vet = 1 + VETERAN_STEP * (unit.vet ?? 0);
  const hp = Math.max(0.3, unit.hp / 100);
  return def.str * vet * hp;
}

export function worldEra(state) {
  return Math.max(0, ...majorIds(state).map((id) => state.nations[id].era));
}

export function cityDefense(state, map, city) {
  let base = 6 + city.pop * 2;
  if (isNeutralId(city.owner)) base += Math.min(3, Math.floor(state.turn / 50)) * 9;
  else base += state.nations[city.owner].era * 6;
  let mult = 1 + (city.buildings.includes('walls') ? BUILDINGS.walls.defense : 0);
  if (state.nations[city.owner]?.doctrine === 'resilience') mult += DOCTRINES.resilience.cityDefense;
  // гарнизон считается как стек в поле: сильнейший + 25% остальных
  const g = unitsAt(state, city.cell).map((id) => state.units[id])
    .filter((u) => u.owner === city.owner && UNITS[u.type].str > 0)
    .map((u) => unitStrength(state, u)).sort((x, y) => y - x);
  const garrison = g.length ? g[0] + 0.25 * g.slice(1).reduce((s, v) => s + v, 0) : 0;
  return (base + garrison) * mult * Math.max(0.35, city.hp / 100) * TERRAIN[map.terrain[city.cell]].defense;
}

export function defenderStrength(state, map, unit) {
  const def = UNITS[unit.type];
  if (def.str === 0) return 0.5;
  let s = unitStrength(state, unit) * TERRAIN[map.terrain[unit.cell]].defense;
  if (unit.fortified) s *= 1.25;
  if (def.domain === 'land' && isWater(map.terrain[unit.cell])) s *= 0.5;
  return s;
}

/** Шанс победы атакующего юнита по клетке (город или юнит). */
export function attackOdds(state, map, attacker, cell) {
  const a = unitStrength(state, attacker);
  if (a <= 0) return 0;
  const cityId = state.cityAt[cell];
  let d;
  if (cityId && state.cities[cityId].owner !== attacker.owner) d = cityDefense(state, map, state.cities[cityId]);
  else {
    const defenders = unitsAt(state, cell).map((id) => state.units[id]).filter((u) => u.owner !== attacker.owner);
    if (!defenders.length) return 1;
    // поддержка стека с убывающей отдачей: сильнейший + 0,25 от остальных
    const strengths = defenders.map((u) => defenderStrength(state, map, u)).sort((x, y) => y - x);
    d = strengths[0] + 0.25 * strengths.slice(1).reduce((s, v) => s + v, 0);
  }
  return a / (a + d);
}

// ---------- видимость ----------
export function visionSources(state, nationId) {
  const sources = [];
  for (const c of Object.values(state.cities)) if (c.owner === nationId) sources.push([c.cell, 2]);
  for (const u of Object.values(state.units)) if (u.owner === nationId && UNITS[u.type].domain !== 'space') sources.push([u.cell, UNITS[u.type].sight ?? (UNITS[u.type].domain === 'air' ? 3 : 2)]);
  return sources;
}

export function visibleCells(state, map, nationId) {
  const allies = [nationId, ...state.treaties.filter((t) => t.type === 'alliance' && (t.a === nationId || t.b === nationId)).map((t) => (t.a === nationId ? t.b : t.a))];
  const set = new Set();
  for (const id of allies) for (const [cell, r] of visionSources(state, id)) for (const c of cellsWithin(map, cell, r)) set.add(c);
  // орбитальная разведка спутником (только своя, союзникам не передаётся)
  for (const z of state.recon?.[nationId] ?? []) if (z.until > state.turn) for (const c of cellsWithin(map, z.cell, 3)) set.add(c);
  return set;
}

// ---------- прочее ----------
export function relation(state, a, b) {
  if (isNeutralId(b)) return state.neutrals[b].relations[a] ?? 0;
  if (isNeutralId(a)) return state.neutrals[a].relations[b] ?? 0;
  return state.relations[pairKey(a, b)] ?? 0;
}

export function atWar(state, a, b) {
  return state.wars.includes(pairKey(a, b));
}

export function treatyBetween(state, a, b, type) {
  return state.treaties.find((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

export function militaryPower(state, nationId) {
  return Object.values(state.units).filter((u) => u.owner === nationId).reduce((s, u) => s + unitStrength(state, u), 0);
}
