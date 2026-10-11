// ИИ наций. Пользуется теми же командами, что и игрок (applyCommand), и тем же
// rng, поэтому полностью детерминирован. Характер берётся из data/nations.js.
import { nextRandom } from './rng.js';
import { UNITS } from './data/units.js';
import { TECHS } from './data/techs.js';
import { BUILDINGS } from './data/buildings.js';

import { isWater } from './data/terrain.js';
import { cellsWithin, hopDistance } from './map.js';
import { haversineKm } from './geo.js';
import {
  availableTechs, techCost, itemBlocker, cellYield, canEnter, attackOdds, atWar, relation,
  treatyBetween, militaryPower, majorIds, isNeutralId, unitsAt, pairKey,
} from './rules.js';
import { applyCommand, citySiteBlocker, buyPrice } from './commands.js';
import { canJoinPact, defenseLevel, SHIELD_TARGET, SHIELD_CAP, PATH_LOCK, INTERCEPTOR_CAP, INTERCEPTOR_POWER } from './finale.js';

const INTERCEPTORS_NEEDED = Math.ceil(INTERCEPTOR_CAP / INTERCEPTOR_POWER);
import { treatyInfluenceCost } from './diplomacy.js';
import { attitude, traits, aggressionOf, memoryOf } from './leaders.js';
import { techLearnable } from './events.js';
import { evaluateDemand, demandBlocker } from './negotiation.js';
import { OPS, opBlocker, opChances, hasCasusBelli } from './intrigue.js';
import { warheads, interceptChance } from './nuclear.js';

const FOCUS_TECHS = {
  defense: ['bronze', 'iron', 'steel', 'agriculture', 'massProduction'],
  economy: ['agriculture', 'wheel', 'seafaring', 'electricity', 'massProduction', 'networks'],
  diplomacy: ['writing', 'agriculture', 'radio', 'networks', 'computers'],
  science: ['writing', 'steam', 'computers', 'rocketry', 'satellites', 'deepRadar'],
};
const ALWAYS = ['seafaring', 'satellites', 'deepRadar', 'heavyLift', 'kinetic', 'shield'];
const BUILD_ORDER = {
  defense: ['walls', 'granary', 'barracks', 'mine', 'library', 'port', 'factory', 'university', 'airfield', 'research', 'datacenter', 'observatory'],
  economy: ['granary', 'mine', 'port', 'library', 'factory', 'datacenter', 'university', 'walls', 'research', 'airfield', 'observatory'],
  diplomacy: ['granary', 'library', 'port', 'mine', 'university', 'datacenter', 'factory', 'walls', 'research', 'observatory'],
  science: ['library', 'granary', 'mine', 'university', 'port', 'research', 'factory', 'datacenter', 'observatory', 'walls'],
};

const sorted = (obj) => Object.keys(obj).sort().map((k) => obj[k]);
const isMilitary = (u) => UNITS[u.type].str > 0;

function memory(nation) {
  nation.aiMemory ??= { lastOffer: -99, campaign: null };
  return nation.aiMemory;
}

// ---------- исследования ----------
function chooseResearch(state, id) {
  const n = state.nations[id];
  if (n.research) return;
  const options = availableTechs(state, id);
  if (!options.length) return;
  const focus = FOCUS_TECHS[n.ai.focus] ?? [];
  const urgent = state.finale.detectedTurn ? ['heavyLift', 'kinetic', 'shield', 'satellites'] : [];
  // случайность тянем по разу на технологию до сортировки: компаратор должен быть чистым
  options.sort();
  const scores = new Map(options.map((t) => [t, techCost(state, id, t) * (focus.includes(t) ? 0.6 : 1) * (ALWAYS.includes(t) ? 0.7 : 1) * (urgent.includes(t) ? 0.2 : 1) * (t === 'fission' ? 1.4 - aggressionOf(state, id) : 1) * (0.9 + nextRandom(state) * 0.2)]));
  options.sort((a, b) => scores.get(a) - scores.get(b) || a.localeCompare(b));
  applyCommand(state, id, { kind: 'research', tech: options[0] });
}

// ---------- места для городов ----------
function siteScore(state, map, id, cell) {
  let s = 0;
  for (const c of cellsWithin(map, cell, 1)) {
    const y = cellYield(state, map, c, id);
    s += y.food * 1.3 + y.prod + y.gold * 0.5;
    if (state.resourceAt[c]) s += 1.5;
  }
  if (map.coast[cell]) s += 1.5;
  return s;
}

function findSite(state, map, id, settler, reserved, ctx = {}) {
  const reach = cellsWithin(map, settler.cell, 14, (c) => canEnter(state, map, settler, c));
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < reach.length; i += 1) {
    const cell = reach[i];
    if (isWater(map.terrain[cell]) || reserved.has(cell)) continue;
    if (citySiteBlocker(state, map, id, cell)) continue;
    let score = siteScore(state, map, id, cell) - i * 0.02;
    if (ctx.wantSouth && Math.abs(map.cells[cell].lat) <= 35) score += 6; // место под будущий космодром
    if (score > bestScore) { bestScore = score; best = cell; }
  }
  return bestScore >= 8 ? best : null;
}

// ---------- производство ----------
function bestUnit(state, map, city, domain = 'land') {
  const options = Object.entries(UNITS)
    .filter(([uid, u]) => u.domain === domain && u.str > 0 && !itemBlocker(state, map, city, { kind: 'unit', id: uid }))
    .sort((a, b) => b[1].str - a[1].str || a[0].localeCompare(b[0]));
  return options[0]?.[0] ?? null;
}

function chooseProduction(state, map, id, city, ctx) {
  // бессрочные пункты (вклад в «Купол», проекты) пересматриваем каждый ход
  if (city.queue.length && (city.queue[0].kind === 'dome' || city.queue[0].kind === 'project')) city.queue = [];
  if (city.queue.length) return;
  const n = state.nations[id];
  const produce = (item) => applyCommand(state, id, { kind: 'produce', cityId: city.id, item }, map).ok;
  const f = state.finale;
  if (f.detectedTurn && n.finale.path === 'pact') {
    // космодромов немного, перехватчиков — до потолка пакта; всё остальное производство идёт в щит
    if (city.buildings.includes('spaceport')) {
      if (!f.tracking && ctx.pactSatellites < 3 && produce({ kind: 'unit', id: 'satellite' })) { ctx.pactSatellites += 1; return; }
      if (ctx.pactInterceptors < INTERCEPTORS_NEEDED && produce({ kind: 'unit', id: 'interceptor' })) { ctx.pactInterceptors += 1; return; }
    } else if (ctx.spaceports < ctx.spaceportTarget && produce({ kind: 'building', id: 'spaceport' })) { ctx.spaceports += 1; return; }
    if (!f.tracking && !ctx.observatory && produce({ kind: 'building', id: 'observatory' })) { ctx.observatory = true; return; }
    if (produce({ kind: 'dome' })) return;
  }
  if (f.detectedTurn && n.finale.path === 'ark' && city.capital && produce({ kind: 'building', id: 'ark' })) return;
  const garrison = unitsAt(state, city.cell).some((uid) => state.units[uid].owner === id && isMilitary(state.units[uid]));
  if (!garrison && !ctx.garrisonQueued.has(city.id)) {
    const u = bestUnit(state, map, city);
    if (u && produce({ kind: 'unit', id: u })) { ctx.garrisonQueued.add(city.id); return; }
  }
  if (ctx.settlerSlots > 0 && ctx.cities < ctx.cityTarget && (city.pop >= 2 || ctx.cities === 1) && produce({ kind: 'unit', id: 'settler' })) {
    ctx.settlerSlots -= 1;
    return;
  }
  if (ctx.military < ctx.militaryTarget) {
    const sea = map.coast[city.cell] && nextRandom(state) < 0.15 ? bestUnit(state, map, city, 'sea') : null;
    const air = nextRandom(state) < 0.2 ? bestUnit(state, map, city, 'air') : null;
    const u = sea ?? air ?? bestUnit(state, map, city);
    if (u && produce({ kind: 'unit', id: u })) { ctx.military += 1; return; }
  }
  // ядерный арсенал: шахта в столице и пара ракет, больше у агрессивных и у тех, по кому уже били
  if (ctx.nukeTarget > ctx.warheads && city.capital && n.finale.path !== 'pact') {
    if (!city.buildings.includes('silo')) { if (produce({ kind: 'building', id: 'silo' })) return; }
    else if (produce({ kind: 'unit', id: 'icbm' })) { ctx.warheads += 1; return; }
  }
  if (map.coast[city.cell] && ctx.ships < ctx.shipTarget) {
    const ship = bestUnit(state, map, city, 'sea');
    if (ship && produce({ kind: 'unit', id: ship })) { ctx.ships += 1; return; }
  }
  if (n.era >= 3 && Math.abs(map.cells[city.cell].lat) <= 35 && !ctx.hasSpaceport && produce({ kind: 'building', id: 'spaceport' })) { ctx.hasSpaceport = true; return; }
  if (n.era >= 3 && city.buildings.includes('spaceport') && nextRandom(state) < 0.3 && produce({ kind: 'unit', id: 'satellite' })) return;
  for (const b of BUILD_ORDER[n.ai.focus] ?? BUILD_ORDER.economy) {
    if (BUILDINGS[b] && produce({ kind: 'building', id: b })) return;
  }
  if (ctx.military < ctx.militaryTarget * 1.5) {
    const u = bestUnit(state, map, city);
    if (u && produce({ kind: 'unit', id: u })) { ctx.military += 1; return; }
  }
  produce({ kind: 'project', id: n.ai.focus === 'economy' ? 'gold' : 'science' });
}

// ---------- юниты ----------
function nearestEnemyCity(state, map, id, unit, enemies) {
  let best = null;
  let bestD = Infinity;
  for (const c of sorted(state.cities)) {
    if (!enemies.has(c.owner)) continue;
    const d = haversineKm(map.cells[unit.cell], map.cells[c.cell]);
    if (d < bestD && d < 2600) { bestD = d; best = c; }
  }
  return best;
}

/** Флот: в войну бьёт врага в радиусе 6 клеток, в мире разведывает неизвестные воды. */
function moveShip(state, map, id, unit, enemies) {
  const near = cellsWithin(map, unit.cell, 6, (c) => canEnter(state, map, unit, c) || Boolean(state.cityAt[c]));
  if (enemies.size) {
    const target = near.find((c) => c !== unit.cell && (
      (state.unitsByCell[c] ?? []).some((uid) => enemies.has(state.units[uid].owner))
      || (state.cityAt[c] && enemies.has(state.cities[state.cityAt[c]].owner))));
    if (target !== undefined && attackOdds(state, map, unit, target) >= 0.5) {
      applyCommand(state, id, { kind: 'move', unitId: unit.id, to: target }, map);
      return;
    }
  }
  const seen = state.explored[id];
  if (unit.goal !== null && unit.goal !== undefined && !seen[unit.goal]) {
    applyCommand(state, id, { kind: 'move', unitId: unit.id, to: unit.goal }, map);
    return;
  }
  const far = cellsWithin(map, unit.cell, 14, (c) => canEnter(state, map, unit, c));
  const options = far.filter((c) => !seen[c]);
  if (!options.length) { if (!unit.fortified) applyCommand(state, id, { kind: 'fortify', unitId: unit.id }, map); return; }
  const goal = options[Math.floor(nextRandom(state) * Math.min(options.length, 20))];
  applyCommand(state, id, { kind: 'move', unitId: unit.id, to: goal }, map);
}

function moveUnits(state, map, id, ctx) {
  const reserved = new Set(sorted(state.units).filter((u) => u.owner === id && u.type === 'settler' && u.goal !== null).map((u) => u.goal));
  const enemies = new Set([...majorIds(state), ...Object.keys(state.neutrals)].filter((x) => x !== id && atWar(state, id, x)));
  const mem = memory(state.nations[id]);
  if (mem.campaign && enemies.size === 0) mem.campaign = null;
  const cities = sorted(state.cities).filter((c) => c.owner === id);
  for (const unit of sorted(state.units)) {
    if (!state.units[unit.id] || unit.owner !== id || unit.moves <= 0) continue;
    const def = UNITS[unit.type];
    if (def.domain === 'space') continue;
    if (unit.type === 'settler') {
      if (!citySiteBlocker(state, map, id, unit.cell) && siteScore(state, map, id, unit.cell) >= 8 && (unit.goal === null || unit.goal === unit.cell)) {
        applyCommand(state, id, { kind: 'found', unitId: unit.id }, map);
        continue;
      }
      if (unit.goal === null || citySiteBlocker(state, map, id, unit.goal)) {
        reserved.delete(unit.goal);
        const site = findSite(state, map, id, unit, reserved, ctx);
        if (site === null) {
          if (!citySiteBlocker(state, map, id, unit.cell)) applyCommand(state, id, { kind: 'found', unitId: unit.id }, map);
          else if ((unit.idle = (unit.idle ?? 0) + 1) > 8) applyCommand(state, id, { kind: 'disband', unitId: unit.id }, map);
          continue;
        }
        reserved.add(site);
        if (site === unit.cell) { applyCommand(state, id, { kind: 'found', unitId: unit.id }, map); continue; }
        applyCommand(state, id, { kind: 'move', unitId: unit.id, to: site }, map);
      } else {
        applyCommand(state, id, { kind: 'move', unitId: unit.id, to: unit.goal }, map);
      }
      if (state.units[unit.id] && unit.cell === unit.goal) applyCommand(state, id, { kind: 'found', unitId: unit.id }, map);
      continue;
    }
    if (!isMilitary(unit)) continue;
    const inCity = state.cityAt[unit.cell] && state.cities[state.cityAt[unit.cell]].owner === id;
    const garrisonHere = inCity ? unitsAt(state, unit.cell).filter((uid) => state.units[uid].owner === id && isMilitary(state.units[uid])) : [];
    const isLastGarrison = inCity && garrisonHere.length === 1;
    if (def.domain === 'sea') { moveShip(state, map, id, unit, enemies); continue; }
    if (enemies.size && !isLastGarrison) {
      const target = nearestEnemyCity(state, map, id, unit, enemies);
      if (target) {
        if (hopDistance(map, unit.cell, target.cell, 1) === 1) {
          if (attackOdds(state, map, unit, target.cell) >= 0.45 || unit.hp > 90) applyCommand(state, id, { kind: 'move', unitId: unit.id, to: target.cell }, map);
          else applyCommand(state, id, { kind: 'fortify', unitId: unit.id }, map);
        } else {
          applyCommand(state, id, { kind: 'move', unitId: unit.id, to: target.cell }, map);
        }
        continue;
      }
    }
    if (inCity && garrisonHere.length <= 2) { if (!unit.fortified) applyCommand(state, id, { kind: 'fortify', unitId: unit.id }, map); continue; }
    const empty = cities.find((c) => !unitsAt(state, c.cell).some((uid) => state.units[uid].owner === id && isMilitary(state.units[uid])));
    if (empty && def.domain === 'land') applyCommand(state, id, { kind: 'move', unitId: unit.id, to: empty.cell }, map);
    else if (!unit.fortified) applyCommand(state, id, { kind: 'fortify', unitId: unit.id }, map);
  }
  ctx.reserved = reserved;
}

// ---------- дипломатия ----------
function diplomacy(state, map, id) {
  const n = state.nations[id];
  const P = n.ai;
  const mem = memory(n);
  const f = state.finale;
  for (const other of n.met) {
    const o = state.nations[other];
    if (!o.alive) continue;
    const rel = attitude(state, id, other);
    if (atWar(state, id, other)) {
      const turns = state.turn - (state.warSince[pairKey(id, other)] ?? state.turn);
      const losing = militaryPower(state, id) < militaryPower(state, other);
      considerNuke(state, map, id, other);
      if ((turns >= 8 && (losing || rel > -40)) || f.detectedTurn) {
        if (!o.human || state.turn - mem.lastOffer >= 5) {
          const r = applyCommand(state, id, { kind: 'proposePeace', target: other }, map);
          if (r.queued) mem.lastOffer = state.turn;
        }
      }
      continue;
    }
    const wants = [];
    // после свежей обиды (война, раскрытый заговор, разрыв договора) новые договоры не предлагаем
    const sore = memoryOf(state, id, other).log.some((e) => e.kind === 'grievance' && e.amount >= 10 && state.turn - e.turn < 20);
    if (rel >= -10 && !treatyBetween(state, id, other, 'trade')) wants.push('trade');
    if (rel >= 10 && !treatyBetween(state, id, other, 'nap')) wants.push('nap');
    if (rel >= 25 && !treatyBetween(state, id, other, 'research')) wants.push('research');
    if (rel >= 50 && !treatyBetween(state, id, other, 'alliance')) wants.push('alliance');
    if (sore) wants.length = 0;
    for (const type of wants) {
      if (n.influence < treatyInfluenceCost(state, id, type)) break;
      if (o.human && state.turn - mem.lastOffer < 6) break;
      const r = applyCommand(state, id, { kind: 'propose', target: other, treaty: type }, map);
      if (r.queued) { mem.lastOffer = state.turn; break; }
    }
    const strong = militaryPower(state, id) > militaryPower(state, other) * 1.4 + 10;
    const justified = hasCasusBelli(state, id, other);
    if (!f.detectedTurn && (rel < -45 || justified) && strong && (justified || !treatyBetween(state, id, other, 'nap'))
      && nextRandom(state) < aggressionOf(state, id) * (justified ? 0.2 : 0.15) * (warheads(state, other) > warheads(state, id) ? 0.3 : 1)) {
      applyCommand(state, id, { kind: 'declareWar', target: other }, map);
      continue;
    }
    if (tradeTechs(state, map, id, other, mem)) continue;
    if (!f.detectedTurn) maybeDemand(state, map, id, other, mem);
  }
  followThroughThreats(state, map, id);
  plot(state, map, id);
  // нейтральные соседи: подарки и мирное присоединение
  const neighbors = new Set();
  for (let cell = 0; cell < map.size; cell += 1) {
    if (state.owner[cell] !== id) continue;
    for (const nb of map.neighbors[cell]) { const o = state.owner[nb]; if (o && isNeutralId(o) && state.neutrals[o].alive) neighbors.add(o); }
  }
  for (const pid of [...neighbors].sort()) {
    if (atWar(state, id, pid)) continue;
    if (relation(state, id, pid) >= 60) { applyCommand(state, id, { kind: 'annex', target: pid }, map); continue; }
    if (n.gold > 200 && nextRandom(state) < 0.3) applyCommand(state, id, { kind: 'gift', target: pid, gold: 40 }, map);
  }
  // космическая эпоха: торговля с нейтралами, у которых есть редкоземельные металлы
  if (n.era >= 3) {
    const sellers = [...new Set(state.resourceCells.rare.map((c) => state.owner[c]).filter((o) => o && isNeutralId(o) && state.neutrals[o].alive))].sort();
    for (const pid of sellers) {
      if (atWar(state, id, pid) || treatyBetween(state, id, pid, 'trade')) continue;
      if (!Object.values(state.cities).some((c) => c.owner === pid && state.explored[id][c.cell])) continue;
      if (relation(state, id, pid) < 10) { if (n.gold > 60) applyCommand(state, id, { kind: 'gift', target: pid, gold: 40 }, map); }
      else applyCommand(state, id, { kind: 'propose', target: pid, treaty: 'trade' }, map);
      break;
    }
  }
  // завоевательный поход на нейтралов у агрессивных
  const mem2 = memory(n);
  if (!mem2.campaign && !f.detectedTurn && neighbors.size && nextRandom(state) < P.aggression * 0.04) {
    const target = [...neighbors].sort()[0];
    if (!atWar(state, id, target) && relation(state, id, target) < 30) {
      applyCommand(state, id, { kind: 'declareWar', target }, map);
      mem2.campaign = target;
    }
  }
}

// ---------- торг, ультиматумы, интриги ----------
/** Обмен технологиями один на один, когда у обеих сторон есть, чем поделиться. */
function tradeTechs(state, map, id, other, mem) {
  const n = state.nations[id];
  const o = state.nations[other];
  if (state.turn % 12 !== (id.length * 3 + other.length) % 12) return false; // редко: обмен знаниями — событие
  if (attitude(state, id, other) < 15) return false;
  if (o.human && state.turn - mem.lastOffer < 6) return false;
  const mine = n.techs.filter((t) => !o.techs.includes(t) && TECHS[t].era < 3 && techLearnable(o, t)).sort((a, b) => techCost(state, other, a) - techCost(state, other, b) || a.localeCompare(b));
  const theirs = o.techs.filter((t) => !n.techs.includes(t) && techLearnable(n, t)).sort((a, b) => techCost(state, id, b) - techCost(state, id, a) || a.localeCompare(b));
  if (!mine.length || !theirs.length) return false;
  const deal = { give: { techs: [mine[0]] }, take: { techs: [theirs[0]] } };
  const r = applyCommand(state, id, { kind: 'negotiate', target: other, deal }, map);
  if (r.queued) mem.lastOffer = state.turn;
  if (!r.ok && r.error === 'COUNTER' && r.counter.give.gold <= n.gold * 0.5 && !r.counter.give.techs.some((t) => t !== mine[0])) {
    applyCommand(state, id, { kind: 'negotiate', target: other, deal: r.counter }, map);
  }
  return r.ok;
}

/** Ультиматум слабому соседу: золото или технология под угрозой войны. */
function maybeDemand(state, map, id, other, mem) {
  const n = state.nations[id];
  const o = state.nations[other];
  const t = traits(state, id);
  if (attitude(state, id, other) > 10) return;
  if (militaryPower(state, id) < militaryPower(state, other) * 2 + 20) return;
  if (nextRandom(state) >= aggressionOf(state, id) * 0.04 * (0.5 + t.pride)) return;
  if (demandBlocker(state, id, other)) return;
  if (o.human && state.turn - mem.lastOffer < 8) return;
  const tech = o.techs.find((x) => techLearnable(n, x));
  const take = o.gold >= 60 ? { gold: Math.min(200, Math.floor(o.gold * 0.5)) } : tech ? { techs: [tech] } : null;
  if (!take) return;
  if (!o.human && !evaluateDemand(state, other, id, take).accept && t.caution > 0.6) return; // осторожный не блефует
  const r = applyCommand(state, id, { kind: 'demand', target: other, take }, map);
  if (r.queued) mem.lastOffer = state.turn;
}

/** После отказа гордый или честный лидер исполняет угрозу; хитрый иногда блефует. */
function followThroughThreats(state, map, id) {
  const t = traits(state, id);
  for (const th of state.pendingThreats ?? []) {
    if (th.from !== id || atWar(state, id, th.to) || state.turn - th.turn < 1) continue;
    const ratio = (militaryPower(state, id) + 1) / (militaryPower(state, th.to) + 1);
    if (ratio >= 1.5 && nextRandom(state) < 0.25 + t.pride * 0.35 + t.honor * 0.25) {
      applyCommand(state, id, { kind: 'declareWar', target: th.to }, map);
    }
  }
}

/** Тайные операции против главного соперника. */
function plot(state, map, id) {
  const n = state.nations[id];
  const t = traits(state, id);
  if (nextRandom(state) >= t.cunning * 0.04) return;
  // против союзников и научных партнёров не шпионим; против пакта о ненападении — только очень хитрый
  const rivals = n.met.filter((x) => state.nations[x].alive
    && !treatyBetween(state, id, x, 'alliance') && !treatyBetween(state, id, x, 'research')
    && (t.cunning > 0.7 || !treatyBetween(state, id, x, 'nap'))).sort((a, b) => {
    const score = (x) => state.nations[x].techs.length * 10 + state.nations[x].finale.contribution / 100 - attitude(state, id, x);
    return score(b) - score(a) || a.localeCompare(b);
  });
  const target = rivals[0];
  if (!target) return;
  const tgt = state.nations[target];
  const f = state.finale;
  const options = [];
  if (tgt.techs.some((x) => !n.techs.includes(x))) options.push(['stealTech', null]);
  if (f.detectedTurn && tgt.finale.path === 'pact' && n.finale.path === 'pact' && t.honor < 0.6) options.push(['sabotage', null]);
  if (!f.detectedTurn) options.push(['sabotage', null]);
  options.push(['smear', null]);
  // подстрекательство: нейтральный народ на границе соперника
  const borderPeople = Object.values(state.neutrals).filter((p) => p.alive && (p.relations[target] ?? 0) > -60
    && Object.values(state.cities).some((c) => c.owner === p.id && state.explored[id][c.cell])).map((p) => p.id).sort();
  if (borderPeople.length && f.detectedTurn === null) options.push(['incite', borderPeople[0]]);
  const third = rivals.find((x) => x !== target);
  if (third && t.cunning > 0.6) options.push(['falseFlag', third]);
  const usable = options.filter(([op, extra]) => !opBlocker(state, id, op, target, extra) && opChances(state, id, target, op).exposure < 0.5 + t.cunning * 0.2);
  if (!usable.length) return;
  const [op, extra] = usable[Math.floor(nextRandom(state) * usable.length)];
  applyCommand(state, id, { kind: 'spy', op, target, third: extra }, map);
}

// ---------- ядерное оружие ----------
/**
 * Решение о пуске. Возмездие бьёт почти наверняка; первый удар — только у агрессивного
 * лидера, который проигрывает войну всерьёз, и не по противнику с сильной ПРО.
 */
function considerNuke(state, map, id, other) {
  const mine = sorted(state.units).filter((u) => u.owner === id && u.type === 'icbm');
  if (!mine.length) return;
  const strikes = state.nuclear?.strikes ?? [];
  const revenge = strikes.some((x) => x.from === other && x.to === id && state.turn - x.turn <= 3); // мстят и за сбитую ракету
  const turns = state.turn - (state.warSince[pairKey(id, other)] ?? state.turn);
  // проигрывает: армия в полтора раза слабее и за последние 15 ходов противник отнял город
  const desperate = militaryPower(state, id) * 1.5 < militaryPower(state, other) && turns >= 6
    && memoryOf(state, id, other).log.some((e) => e.reason === 'cityLost' && state.turn - e.turn <= 15);
  const aggr = aggressionOf(state, id);
  const firstStrike = desperate && aggr > 0.4 && interceptChance(state, other) < 0.3 && nextRandom(state) < 0.4 * aggr;
  if (!revenge && !firstStrike) return;
  const target = Object.values(state.cities)
    .filter((c) => c.owner === other && state.explored[id][c.cell])
    .sort((a, b) => b.pop - a.pop || a.id.localeCompare(b.id))[0];
  if (!target) return;
  applyCommand(state, id, { kind: 'nuke', unitId: mine[0].id, to: target.cell }, map);
}

// ---------- финал ----------
function finaleDecisions(state, map, id) {
  const n = state.nations[id];
  const f = state.finale;
  if (!f.detectedTurn) return;
  if (!n.finale.path) {
    const others = majorIds(state).filter((x) => x !== id && state.nations[x].alive);
    const avg = others.length ? others.reduce((s, x) => s + relation(state, id, x), 0) / others.length : 0;
    // перед лицом гибели личные обиды весят меньше обычного
    // у кого есть космодромы, тот понимает, что без него «Купол» не взлетит
    const spacePower = Object.values(state.cities).some((c) => c.owner === id && c.buildings.includes('spaceport')) ? 0.15 : 0;
    const score = n.ai.coop + avg / 400 + (n.reputation - 50) / 400 + traits(state, id).honor * 0.1 + spacePower;
    applyCommand(state, id, { kind: 'choosePath', path: score >= 0.45 && canJoinPact(state) ? 'pact' : 'ark' }, map);
  }
  if (n.finale.path !== 'pact') return;
  // участник «Купола» сдаёт боеголовки в щит: это и вклад, и знак доверия
  for (const u of sorted(state.units)) if (u.owner === id && u.type === 'icbm') applyCommand(state, id, { kind: 'dismantle', unitId: u.id }, map);
  const projected = projectedDefense(state, id);
  const t = traits(state, id);
  const capital = Object.values(state.cities).some((c) => c.owner === id && c.capital);
  // за пару ходов до закрытия пакта эгоист с шансом на Ковчег бросает обречённый «Купол»
  if (state.turn === f.detectedTurn + PATH_LOCK - 1 && projected < 0.4 && capital
    && n.techs.includes('heavyLift') && (n.ai.coop < 0.5 || t.pride > 0.75)) {
    applyCommand(state, id, { kind: 'choosePath', path: 'ark' }, map);
    return;
  }
  // вкладываемся, пока щит не обеспечивает спасение с запасом; золото оставляем на перехватчики
  if (projected >= 1.1) return;
  const reserve = 60 + 5 * Object.values(state.cities).filter((c) => c.owner === id).length;
  if (n.gold > reserve + 20) applyCommand(state, id, { kind: 'contribute', gold: Math.floor((n.gold - reserve) * 0.6) }, map);
  if (!n.research && n.sciencePool > 50) applyCommand(state, id, { kind: 'contribute', science: Math.floor(n.sciencePool * 0.8) }, map);
}

/** Оценка защиты к ходу удара: текущий темп прироста щита, перехватчики как есть. */
function projectedDefense(state, id) {
  const f = state.finale;
  const mem = memory(state.nations[id]);
  if (!mem.shieldMark || mem.shieldMark.since !== f.detectedTurn) mem.shieldMark = { since: f.detectedTurn, turn: state.turn, shield: f.shield };
  const elapsed = Math.max(1, state.turn - mem.shieldMark.turn);
  const rate = Math.max(0, (f.shield - mem.shieldMark.shield) / elapsed);
  const shield = f.shield + rate * Math.max(0, f.impactTurn - state.turn);
  const level = defenseLevel(state);
  return level.tracking * (level.intercept + Math.min(SHIELD_CAP, (shield / SHIELD_TARGET) * SHIELD_CAP));
}

export function runAi(state, map, id) {
  const n = state.nations[id];
  if (!n?.alive || n.human) return;
  chooseResearch(state, id);
  finaleDecisions(state, map, id);
  diplomacy(state, map, id);
  const cities = sorted(state.cities).filter((c) => c.owner === id);
  const units = sorted(state.units).filter((u) => u.owner === id);
  const settlers = units.filter((u) => u.type === 'settler').length + cities.filter((c) => c.queue[0]?.id === 'settler').length;
  const atWarAny = [...majorIds(state), ...Object.keys(state.neutrals)].some((x) => x !== id && atWar(state, id, x));
  const members = majorIds(state).filter((x) => state.nations[x].finale.path === 'pact');
  const ctx = {
    cities: cities.length,
    cityTarget: Math.min(16, 6 + 2 * n.era),
    settlerSlots: Math.max(0, 1 + Math.floor(cities.length / 4) - settlers),
    military: units.filter(isMilitary).length,
    militaryTarget: Math.ceil(cities.length * (atWarAny ? 2.2 : 1.3)) + 1,
    garrisonQueued: new Set(),
    ships: units.filter((u) => UNITS[u.type].domain === 'sea').length + cities.filter((c) => c.queue[0] && UNITS[c.queue[0].id]?.domain === 'sea').length,
    shipTarget: Math.ceil(cities.filter((c) => map.coast[c.cell]).length / 4) + (atWarAny ? 1 : 0),
    spaceports: cities.filter((c) => c.buildings.includes('spaceport') || c.queue[0]?.id === 'spaceport').length,
    spaceportTarget: 2 + Math.floor(cities.length / 5),
    pactInterceptors: Object.values(state.units).filter((u) => u.type === 'interceptor' && members.includes(u.owner)).length
      + Object.values(state.cities).filter((c) => members.includes(c.owner) && c.queue[0]?.id === 'interceptor').length,
    hasSpaceport: cities.some((c) => c.buildings.includes('spaceport') || c.queue[0]?.id === 'spaceport'),
    pactSatellites: Object.values(state.units).filter((u) => u.type === 'satellite' && members.includes(u.owner)).length,
    observatory: Object.values(state.cities).some((c) => members.includes(c.owner) && (c.buildings.includes('observatory') || c.queue[0]?.id === 'observatory')),
  };
  ctx.warheads = warheads(state, id) + cities.filter((c) => c.queue[0]?.id === 'icbm').length;
  const nuked = (state.nuclear?.strikes ?? []).some((x) => x.to === id);
  const rivalNukes = n.met.some((o) => state.nations[o].alive && warheads(state, o) > 0 && (atWar(state, id, o) || relation(state, id, o) < -30));
  const aggr = aggressionOf(state, id);
  ctx.nukeTarget = !n.techs.includes('fission') || state.finale.detectedTurn ? 0
    : (aggr >= 0.45 ? 2 : 0) + (aggr >= 0.6 ? 1 : 0) + (nuked || rivalNukes ? 1 : 0);
  ctx.wantSouth = n.era >= 1 && !cities.some((c) => Math.abs(map.cells[c.cell].lat) <= 35);
  for (const city of cities) chooseProduction(state, map, id, city, ctx);
  // лишнее золото тратим на ускорение строительства (оставляем запас)
  const reserve = 60 + cities.length * 5;
  const buyOrder = [...cities].sort((a, b) => buyPrice(state, map, a) - buyPrice(state, map, b) || a.id.localeCompare(b.id));
  for (const city of buyOrder) {
    const price = buyPrice(state, map, city);
    if (Number.isFinite(price) && price > 0 && n.gold - price >= reserve) applyCommand(state, id, { kind: 'buy', cityId: city.id }, map);
  }
  moveUnits(state, map, id, ctx);
  orbitalScouting(state, map, id);
}

/** Спутники на войне фотографируют крупнейший город противника: так находят цели. */
function orbitalScouting(state, map, id) {
  const enemies = state.nations[id].met.filter((o) => state.nations[o].alive && atWar(state, id, o)).sort();
  if (!enemies.length) return;
  const targets = Object.values(state.cities).filter((c) => enemies.includes(c.owner))
    .sort((a, b) => Number(Boolean(state.explored[id][a.cell])) - Number(Boolean(state.explored[id][b.cell])) || b.pop - a.pop || a.id.localeCompare(b.id));
  let i = 0;
  for (const u of sorted(state.units)) {
    if (u.owner !== id || u.type !== 'satellite' || (u.reconReady ?? 0) > state.turn || i >= targets.length) continue;
    applyCommand(state, id, { kind: 'recon', unitId: u.id, to: targets[i].cell }, map);
    i += 1;
  }
}
