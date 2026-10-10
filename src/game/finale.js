// Финал «Немезида» (DESIGN.md §10): обнаружение, пакт «Купол» или Ковчег, итог.
import { nextRandom } from './rng.js';
import { pushEvent, nameOf } from './events.js';
import { changeReputation } from './diplomacy.js';
import { hasTech, majorIds } from './rules.js';
import { cellsWithin } from './map.js';
import { isWater } from './data/terrain.js';

export const DETECTION_FORCED_TURN = 200;
export const IMPACT_DELAY = 25;
export const PATH_LOCK = 15; // вступить в пакт можно до 15-го хода отсчёта
export const SATELLITES_FOR_TRACKING = 3;
export const SHIELD_TARGET = 47000;
export const RARE_POINTS_PER_TILE = 3; // вес редкоземельных ×3 (§10.3)
export const INTERCEPTOR_POWER = 0.045;
export const INTERCEPTOR_CAP = 0.5;
export const SHIELD_CAP = 0.7;
export const GOLD_RATE = 0.18; // золото переводится в щит хуже, чем производство

export function maybeDetect(state, map) {
  const f = state.finale;
  if (f.detectedTurn) return false;
  const finder = majorIds(state).find((id) => state.nations[id].alive && hasTech(state, id, 'deepRadar'));
  if (!finder && state.turn < DETECTION_FORCED_TURN) return false;
  f.detectedTurn = state.turn;
  f.impactTurn = state.turn + IMPACT_DELAY;
  f.detectedBy = finder ?? null;
  // точка удара: суша на территории одной из наций (драма), детерминированно от сида
  const owned = [];
  for (let cell = 0; cell < map.size; cell += 1) if (state.owner[cell] && !state.owner[cell].startsWith('p') && !isWater(map.terrain[cell])) owned.push(cell);
  f.impactCell = owned.length ? owned[Math.floor(nextRandom(state) * owned.length)] : 0;
  f.uncertaintyKm = 3000;
  pushEvent(state, 'asteroid', { turns: IMPACT_DELAY });
  return true;
}

export function canJoinPact(state) {
  const f = state.finale;
  return Boolean(f.detectedTurn) && state.turn <= f.detectedTurn + PATH_LOCK;
}

/** Выбор пути нацией. Выйти из пакта можно всегда, вступить — только до PATH_LOCK. */
export function choosePath(state, nationId, path) {
  const f = state.finale;
  const n = state.nations[nationId];
  if (!f.detectedTurn) return { ok: false, error: 'NO_FINALE' };
  if (path !== 'pact' && path !== 'ark') return { ok: false, error: 'BAD_PATH' };
  if (n.finale.path === path) return { ok: true };
  if (path === 'pact') {
    if (!canJoinPact(state)) return { ok: false, error: 'PATH_LOCKED' };
    n.finale.path = 'pact';
    n.finale.joinedAt = state.turn;
    pushEvent(state, 'pactJoined', { nation: n.name });
    return { ok: true };
  }
  if (n.finale.path === 'pact') {
    n.finale.leftAt = state.turn;
    if (state.turn > f.detectedTurn + PATH_LOCK) {
      n.finale.betrayed = true;
      changeReputation(state, nationId, -50);
    }
    pushEvent(state, 'pactLeft', { nation: n.name });
  } else {
    pushEvent(state, 'arkChosen', { nation: n.name });
  }
  n.finale.path = 'ark';
  return { ok: true };
}

export function contribute(state, nationId, { gold = 0, science = 0 } = {}) {
  const n = state.nations[nationId];
  if (!state.finale.detectedTurn) return { ok: false, error: 'NO_FINALE' };
  if (n.finale.path !== 'pact') return { ok: false, error: 'NOT_IN_PACT' };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  gold = Math.max(0, Math.floor(num(gold)));
  science = Math.max(0, Math.floor(num(science)));
  if (gold > n.gold) return { ok: false, error: 'NOT_ENOUGH_GOLD' };
  if (science > n.sciencePool) return { ok: false, error: 'NOT_ENOUGH_SCIENCE' };
  n.gold -= gold;
  n.sciencePool -= science;
  if (gold) addShield(state, nationId, gold * GOLD_RATE, 'gold');
  if (science) addShield(state, nationId, science, 'science');
  return { ok: true };
}

export function addShield(state, nationId, points, source = 'production') {
  state.finale.shield += points;
  addContribution(state, nationId, points, source);
}

/** Учёт вклада по источникам: для итогового экрана и баланса. */
export function addContribution(state, nationId, points, source) {
  const f = state.nations[nationId].finale;
  f.contribution += points;
  f.sources ??= {};
  f.sources[source] = (f.sources[source] ?? 0) + points;
}

export function pactMembers(state) {
  return majorIds(state).filter((id) => state.nations[id].alive && state.nations[id].finale.path === 'pact');
}

/** Ежеходовые эффекты финала: редкоземельные, слежение, сужение эллипса. */
export function finaleTick(state) {
  const f = state.finale;
  if (!f.detectedTurn || f.result) return;
  const members = pactMembers(state);
  for (const id of members) {
    const tiles = state.resourceCells.rare.filter((c) => state.owner[c] === id).length;
    if (tiles) addShield(state, id, tiles * RARE_POINTS_PER_TILE, 'rare');
  }
  const sats = Object.values(state.units).filter((u) => u.type === 'satellite' && members.includes(u.owner)).length;
  const observatory = Object.values(state.cities).some((c) => members.includes(c.owner) && c.buildings.includes('observatory'));
  if (!f.tracking && sats >= SATELLITES_FOR_TRACKING && observatory) {
    f.tracking = true;
    pushEvent(state, 'tracking');
  }
  f.uncertaintyKm = Math.max(150, f.uncertaintyKm - (f.tracking ? 250 : 80));
}

export const UNTRACKED_FACTOR = 0.84;

/** Доля населения, которую теряют города в зоне падения обломков: от 50% при защите 0,5 до 5% у самого порога спасения. */
export function partialLoss(defense) {
  return Math.max(0.05, Math.min(0.5, (1 - defense)));
}

export function defenseLevel(state) {
  const f = state.finale;
  const members = pactMembers(state);
  const interceptors = Object.values(state.units).filter((u) => u.type === 'interceptor' && members.includes(u.owner)).length;
  // без точной орбиты оборона слабее, но спасение остаётся возможным: 0,84 × (0,5 + 0,7) ≈ 1,01
  const tracking = f.tracking ? 1.2 : UNTRACKED_FACTOR;
  const intercept = Math.min(INTERCEPTOR_CAP, interceptors * INTERCEPTOR_POWER);
  const shield = Math.min(SHIELD_CAP, (f.shield / SHIELD_TARGET) * SHIELD_CAP);
  return { defense: tracking * (intercept + shield), tracking, intercept, shield, interceptors };
}

export function outcomeFor(defense) {
  if (defense >= 1) return 'saved';
  if (defense >= 0.5) return 'partial';
  return 'fail';
}

/** Удар: считается в ход impactTurn. Возвращает результат партии или null. */
export function resolveImpact(state, map) {
  const f = state.finale;
  if (!f.detectedTurn || f.result || state.turn < f.impactTurn) return null;
  const level = defenseLevel(state);
  const outcome = outcomeFor(level.defense);
  const members = pactMembers(state);
  const contributions = Object.fromEntries(majorIds(state).map((id) => [id, Math.round(state.nations[id].finale.contribution)]));
  let winner = null;
  if (outcome !== 'fail' && members.length) {
    winner = [...members].sort((a, b) => contributions[b] - contributions[a] || a.localeCompare(b))[0];
  }
  if (outcome === 'partial' || outcome === 'fail') {
    const radius = outcome === 'partial' ? 2 : 6;
    for (const cell of cellsWithin(map, f.impactCell, radius)) {
      const id = state.cityAt[cell];
      if (!id) continue;
      const city = state.cities[id];
      const owner = state.nations[city.owner];
      const saved = owner?.finale.path === 'ark' && Object.values(state.cities).some((c) => c.owner === city.owner && c.buildings.includes('ark'));
      city.pop = Math.max(1, Math.floor(city.pop * (outcome === 'partial' ? 1 - partialLoss(level.defense) : saved ? 0.6 : 0.1)));
    }
  }
  const player = state.player;
  const p = state.nations[player];
  let ending = outcome;
  if (outcome === 'fail') {
    const hasArk = p.finale.path === 'ark' && Object.values(state.cities).some((c) => c.owner === player && c.buildings.includes('ark'));
    if (p.finale.betrayed) ending = 'betrayal';
    else if (hasArk) ending = 'lastRefuge';
    else ending = 'silence';
  }
  f.result = { outcome, defense: Math.round(level.defense * 100), winner, contributions, interceptors: level.interceptors, tracking: f.tracking };
  pushEvent(state, 'impact', { outcome });
  return { outcome, winner, ending, defense: f.result.defense, contributions, winnerName: winner ? nameOf(state, winner) : null };
}
