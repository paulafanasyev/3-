// Состояние партии: создание, индексы, мутации и снимок для нации (туман войны).
import { createHash } from 'node:crypto';
import { loadMap, cellsWithin } from './map.js';
import { nextRandom, seedToInt } from './rng.js';
import { NATIONS, DOCTRINES, CUSTOM_NATION_RULES } from './data/nations.js';
import { STRATEGIC, RARE_IN_NORTH_AMERICA, isWater } from './data/terrain.js';
import { pushEvent, nameOf, own } from './events.js';
import { createRealNameGuard } from './names.js';
import { loadStopList } from './map.js';
import { pairKey, visibleCells, isNeutralId } from './rules.js';
import { makeLeader, attitude, moodOf, memoryOf } from './leaders.js';
import { credibility } from './leaders.js';
import { opChances, OPS, hasCasusBelli } from './intrigue.js';

export const STATE_VERSION = 1;
export const START_GOLD = 30;
export const START_REPUTATION = 70;

// ---------- события ----------
export { pushEvent, nameOf };

// ---------- индексы ----------
export function rebuildIndexes(state) {
  state.unitsByCell = {};
  for (const u of Object.values(state.units)) (state.unitsByCell[u.cell] ??= []).push(u.id);
  for (const list of Object.values(state.unitsByCell)) list.sort();
  state.cityAt = {};
  for (const c of Object.values(state.cities)) state.cityAt[c.cell] = c.id;
}

export function nextId(state, prefix) {
  state.idSeq += 1;
  return `${prefix}${state.idSeq}`;
}

export function addUnit(state, owner, type, cell) {
  const id = nextId(state, 'u');
  const unit = { id, owner, type, cell, hp: 100, moves: 0, vet: 0, fortified: false, goal: null };
  state.units[id] = unit;
  (state.unitsByCell[cell] ??= []).push(id);
  state.unitsByCell[cell].sort();
  return unit;
}

export function removeUnit(state, id) {
  const unit = state.units[id];
  if (!unit) return;
  const list = state.unitsByCell[unit.cell] ?? [];
  state.unitsByCell[unit.cell] = list.filter((x) => x !== id);
  if (!state.unitsByCell[unit.cell].length) delete state.unitsByCell[unit.cell];
  delete state.units[id];
}

export function placeUnit(state, unit, cell) {
  const list = state.unitsByCell[unit.cell] ?? [];
  state.unitsByCell[unit.cell] = list.filter((x) => x !== unit.id);
  if (!state.unitsByCell[unit.cell].length) delete state.unitsByCell[unit.cell];
  unit.cell = cell;
  (state.unitsByCell[cell] ??= []).push(unit.id);
  state.unitsByCell[cell].sort();
}

export function claimAround(state, map, cell, owner, radius) {
  for (const c of cellsWithin(map, cell, radius)) {
    if (state.owner[c] === null && !isWater(map.terrain[c])) state.owner[c] = owner;
  }
  state.owner[cell] = owner;
}

export function addCity(state, map, owner, cell, name, { capital = false, pop = 1 } = {}) {
  const id = nextId(state, 'c');
  const city = { id, owner, cell, name, pop, food: 0, prod: 0, hp: 100, queue: [], buildings: [], capital, founded: state.turn, originalOwner: owner };
  state.cities[id] = city;
  state.cityAt[cell] = id;
  claimAround(state, map, cell, owner, capital && isNeutralId(owner) ? 2 : 1);
  return city;
}

// ---------- создание партии ----------
let realGuard = null;
/** Своя нация и её лидер тоже не могут называться как реальная страна, город или вождь. */
function tooRealName(name) {
  realGuard ??= createRealNameGuard(loadStopList());
  return name.split(/[\s-]+/).some((word) => word.length >= 4 && realGuard(word)) || realGuard(name);
}

function validateCustom(custom) {
  const r = CUSTOM_NATION_RULES;
  if (!custom || typeof custom.name !== 'string') return null;
  const name = custom.name.trim();
  if (name.length < r.nameMin || name.length > r.nameMax || !/^[\p{L}\p{N} '\-]+$/u.test(name)) return null;
  if (tooRealName(name)) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(custom.color ?? '')) return null;
  if (!DOCTRINES[custom.doctrine]) return null;
  const emblem = custom.emblem ?? {};
  if (!r.shields.includes(emblem.shield) || !r.figures.includes(emblem.figure) || !/^#[0-9a-fA-F]{6}$/.test(emblem.field ?? '')) return null;
  const zone = custom.zone ?? 'north';
  if (!NATIONS.some((n) => n.zone === zone)) return null;
  const leaderName = typeof custom.leaderName === 'string' ? custom.leaderName.trim() : '';
  if (leaderName && (leaderName.length > r.nameMax || !/^[\p{L}\p{N} '\-]+$/u.test(leaderName) || tooRealName(leaderName))) return null;
  return { name, color: custom.color.toUpperCase(), doctrine: custom.doctrine, emblem: { ...emblem }, zone, leaderName };
}

function placeResources(state, map) {
  state.resourceAt = {};
  state.resourceCells = Object.fromEntries(Object.keys(STRATEGIC).map((k) => [k, []]));
  const startCells = new Set(map.startZones.flatMap((z) => cellsWithin(map, z.cell, 1)));
  for (let cell = 0; cell < map.size; cell += 1) {
    const code = map.terrain[cell];
    if (code === 'O' || code === 'I' || startCells.has(cell)) continue;
    for (const [res, def] of Object.entries(STRATEGIC)) {
      let p = def.weights[code] ?? 0;
      if (res === 'rare' && map.naCells.has(cell)) p *= RARE_IN_NORTH_AMERICA;
      if (p > 0 && nextRandom(state) < p) {
        state.resourceAt[cell] = res;
        state.resourceCells[res].push(cell);
        break;
      }
    }
  }
  // честный старт: у каждой зоны есть железо в пределах 4 шагов
  for (const zone of map.startZones) {
    const near = cellsWithin(map, zone.cell, 4).filter((c) => !startCells.has(c) && !isWater(map.terrain[c]) && map.terrain[c] !== 'I');
    if (near.some((c) => state.resourceAt[c] === 'iron')) continue;
    const free = near.filter((c) => !state.resourceAt[c]);
    const cell = free[Math.floor(nextRandom(state) * free.length)];
    if (cell !== undefined) { state.resourceAt[cell] = 'iron'; state.resourceCells.iron.push(cell); }
  }
  for (const list of Object.values(state.resourceCells)) list.sort((a, b) => a - b);
}

export function createGame({ seed = 1, setup = {}, map = loadMap() } = {}) {
  const state = {
    version: STATE_VERSION,
    mapVersion: map.raw.version,
    seed: seedToInt(seed),
    rng: seedToInt(seed),
    turn: 1,
    status: 'running',
    result: null,
    idSeq: 0,
    eventSeq: 0,
    events: [],
    nations: {},
    neutrals: {},
    owner: new Array(map.size).fill(null),
    cities: {},
    units: {},
    unitsByCell: {},
    cityAt: {},
    relations: {},
    memory: {},
    casusBelli: {},
    pendingThreats: [],
    lastDemand: {},
    wars: [],
    warSince: {},
    truces: {},
    treaties: [],
    offers: [],
    explored: {},
    finale: { detectedTurn: null, impactTurn: null, impactCell: null, uncertaintyKm: null, shield: 0, tracking: false, result: null },
  };

  const custom = setup.custom ? validateCustom(setup.custom) : null;
  if (setup.custom && !custom) throw new Error('BAD_SETUP');
  if (setup.player !== undefined && !NATIONS.some((n) => n.id === setup.player)) throw new Error('BAD_SETUP');
  const playerZone = custom ? custom.zone : (NATIONS.find((n) => n.id === setup.player)?.zone ?? 'north');

  for (const base of NATIONS) {
    const isPlayerSlot = base.zone === playerZone;
    const def = isPlayerSlot && custom ? { ...base, id: 'player', ...custom } : base;
    state.nations[def.id] = {
      id: def.id,
      name: def.name,
      color: def.color,
      emblem: def.emblem,
      doctrine: def.doctrine,
      zone: def.zone,
      human: isPlayerSlot,
      ai: isPlayerSlot ? null : base.ai,
      alive: true,
      gold: START_GOLD,
      influence: 0,
      sciencePool: 0,
      research: null,
      techs: [],
      era: 0,
      reputation: START_REPUTATION,
      met: [],
      capital: null,
      finale: { path: null, joinedAt: null, leftAt: null, betrayed: false, contribution: 0 },
      leader: makeLeader(base.id, isPlayerSlot && custom ? custom : null),
      bluffsCalled: 0,
      lastOpTurn: -99,
    };
    state.explored[def.id] = new Array(map.size).fill(0);
  }
  state.player = Object.values(state.nations).find((n) => n.human).id;

  const ids = Object.keys(state.nations);
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) state.relations[pairKey(ids[i], ids[j])] = 0;

  placeResources(state, map);

  // нейтральные народы и их города
  for (const people of map.peoples) {
    const id = `p${people.id}`;
    state.neutrals[id] = { id, name: people.name, culture: people.culture, color: people.color, alive: true, relations: Object.fromEntries(ids.map((n) => [n, 0])) };
  }
  for (const site of map.cities) {
    addCity(state, map, `p${site.people}`, site.cell, site.name, { capital: site.capital, pop: site.capital ? 3 : 2 });
  }

  // стартовые юниты наций
  for (const nation of Object.values(state.nations)) {
    const zone = map.startZones.find((z) => z.id === nation.zone);
    const settler = addUnit(state, nation.id, 'settler', zone.cell);
    const next = map.neighbors[zone.cell].find((c) => !isWater(map.terrain[c]) && map.terrain[c] !== 'I') ?? zone.cell;
    addUnit(state, nation.id, 'warrior', next);
    settler.moves = 2;
    pushEvent(state, 'gameStart', { nation: nation.name }, [nation.id]);
  }
  for (const u of Object.values(state.units)) u.moves = 2;
  updateExplored(state, map);
  return state;
}

export function updateExplored(state, map) {
  for (const id of Object.keys(state.nations)) {
    if (!state.nations[id].alive) continue;
    const seen = state.explored[id];
    state.intel ??= {};
    const intel = (state.intel[id] ??= {});
    for (const c of visibleCells(state, map, id)) {
      seen[c] = 1;
      const cityId = state.cityAt[c];
      if (cityId && state.cities[cityId].owner !== id) intel[cityId] = { pop: state.cities[cityId].pop, turn: state.turn };
    }
  }
}

// ---------- снимок для клиента ----------
export function snapshot(state, nationId, { sinceSeq = 0, map = loadMap() } = {}) {
  const me = state.nations[nationId];
  const visible = visibleCells(state, map, nationId);
  const explored = state.explored[nationId];
  const owner = state.owner.map((o, cell) => (explored[cell] ? o : undefined));
  const cities = Object.values(state.cities)
    .filter((c) => c.owner === nationId || explored[c.cell])
    .map((c) => {
      if (c.owner === nationId) return c;
      const base = { id: c.id, owner: c.owner, cell: c.cell, name: c.name, capital: c.capital };
      // текущие данные — только если город сейчас виден; иначе последние известные
      if (visible.has(c.cell)) return { ...base, pop: c.pop, hp: c.hp, seenTurn: state.turn };
      const intel = state.intel?.[nationId]?.[c.id];
      return { ...base, pop: intel?.pop ?? null, hp: null, seenTurn: intel?.turn ?? null };
    });
  const units = Object.values(state.units)
    .filter((u) => u.owner === nationId || visible.has(u.cell))
    .map((u) => (u.owner === nationId ? u : { id: u.id, owner: u.owner, type: u.type, cell: u.cell, hp: u.hp }));
  const resources = {};
  for (const [cell, res] of Object.entries(state.resourceAt)) {
    if (explored[cell] && STRATEGIC[res].era <= me.era) resources[cell] = res;
  }
  const nations = Object.values(state.nations).map((n) => (n.id === nationId
    ? n
    : {
      id: n.id, name: n.name, color: n.color, emblem: n.emblem, doctrine: n.doctrine, alive: n.alive,
      met: me.met.includes(n.id), era: me.met.includes(n.id) ? n.era : null, reputation: me.met.includes(n.id) ? n.reputation : null,
      // выбор пути в финале объявляется всем; вклад виден только знакомым нациям
      finale: state.finale.detectedTurn
        ? { path: n.finale.path, contribution: me.met.includes(n.id) ? Math.round(n.finale.contribution) : null }
        : { path: null, contribution: null },
      leader: n.leader,
      // как этот лидер относится к игроку и что помнит о нём
      attitude: me.met.includes(n.id) ? Math.round(attitude(state, n.id, nationId)) : null,
      mood: me.met.includes(n.id) ? moodOf(attitude(state, n.id, nationId)).name : null,
      remembers: me.met.includes(n.id) ? memoryOf(state, n.id, nationId).log.slice(-5) : [],
      credibility: me.met.includes(n.id) ? Math.round(credibility(state, n.id) * 100) : null,
      intrigue: me.met.includes(n.id) ? Object.fromEntries(Object.keys(OPS).map((op) => {
        const c = opChances(state, nationId, n.id, op);
        return [op, { success: Math.round(c.success * 100), exposure: Math.round(c.exposure * 100) }];
      })) : null,
      casusBelli: me.met.includes(n.id) ? hasCasusBelli(state, nationId, n.id) : false,
    }));
  return structuredClone({
    version: state.version,
    turn: state.turn,
    status: state.status,
    result: state.result,
    nationId,
    nations,
    neutrals: Object.values(state.neutrals).map((p) => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, relation: Math.round(p.relations[nationId] ?? 0) })),
    relations: Object.fromEntries(me.met.map((id) => [id, Math.round(state.relations[pairKey(nationId, id)])])),
    wars: state.wars.filter((k) => k.split('|').includes(nationId)),
    treaties: state.treaties.filter((t) => t.a === nationId || t.b === nationId),
    offers: state.offers.filter((o) => o.to === nationId),
    owner,
    explored: explored.join(''),
    visible: [...visible].sort((a, b) => a - b),
    cities,
    units,
    resources,
    // точная точка удара остаётся на сервере: клиент видит только эллипс неопределённости
    finale: state.finale.detectedTurn ? (({ impactCell, ...rest }) => ({ ...rest, impactArea: impactCell === null ? null : { center: Math.floor(impactCell / 50) * 50, uncertaintyKm: rest.uncertaintyKm } }))(state.finale) : null,
    events: state.events.filter((e) => e.seq > sinceSeq && (e.audience === 'all' || e.audience.includes(nationId))),
  });
}

/** Хеш состояния для проверки детерминизма. */
export function stateHash(state) {
  const { unitsByCell, cityAt, ...rest } = state;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}
