// Ядерное оружие и орбитальная разведка. Детерминированно (общий rng), только через команды.
// Боеголовка — юнит 'icbm' в городе с ракетной шахтой. Удар — команда 'nuke'.
import { nextRandom } from './rng.js';
import { UNITS } from './data/units.js';
import { cellsWithin } from './map.js';
import { pushEvent, nameOf } from './events.js';
import { atWar, isNeutralId, unitsAt, nuclearWinter } from './rules.js';
import { changeRelation, changeReputation } from './diplomacy.js';
import { remember } from './leaders.js';
import { removeUnit } from './state.js';
import { addShield, pactMembers } from './finale.js';

export const NUKE = Object.freeze({
  radius: 1,
  popFactor: 0.35,
  buildingsLost: 2,
  falloutTurns: 20,
  interceptPerUnit: 0.12,
  interceptCap: 0.6,
  earlyWarning: 0.1, // спутник жертвы засекает старт
  reputation: 40,
  worldRelation: 30,
  worldGrievance: 40,
  victimGrievance: 120,
  casusBelliTurns: 30,
  winterWindow: 30,
  winterPerStrike: 0.05,
  winterFloor: 0.7,
});
export const DISMANTLE_SHIELD = 250; // чуть выгоднее, чем вложить те же 200 производства напрямую
export const RECON = Object.freeze({ radius: 3, turns: 5, cooldown: 5 });

const ensure = (state) => {
  state.nuclear ??= { strikes: [] };
  state.fallout ??= {};
  state.recon ??= {};
  return state.nuclear;
};

/** Множитель еды от ядерной зимы: −5% за каждый удар за последние 30 ходов, не ниже 0,7. */
export const winterFactor = (state) => nuclearWinter(state);

export const inFallout = (state, cell) => (state.fallout?.[cell] ?? 0) > state.turn;

export function warheads(state, nationId) {
  return Object.values(state.units).filter((u) => u.owner === nationId && u.type === 'icbm').length;
}

/** Шанс перехвата: перехватчики жертвы и её союзников-спутников раннего предупреждения. */
export function interceptChance(state, victim) {
  if (isNeutralId(victim)) return 0;
  const mine = Object.values(state.units).filter((u) => u.owner === victim);
  const interceptors = mine.filter((u) => u.type === 'interceptor').length;
  const warning = mine.some((u) => u.type === 'satellite') ? NUKE.earlyWarning : 0;
  return Math.min(NUKE.interceptCap, interceptors * NUKE.interceptPerUnit) + (interceptors ? warning : warning / 2);
}

const validCell = (map, cell) => typeof cell === 'number' && Number.isSafeInteger(cell) && cell >= 0 && cell < map.size;

export function nukeBlocker(state, map, nationId, unit, to) {
  if (!unit || unit.owner !== nationId) return 'NOT_YOUR_UNIT';
  if (unit.type !== 'icbm') return 'NOT_WARHEAD';
  if (!validCell(map, to)) return 'NO_TARGET';
  if (!state.explored[nationId][to]) return 'NOT_EXPLORED';
  const victim = state.owner[to];
  if (!victim || victim === nationId) return 'NO_TARGET';
  if (!atWar(state, nationId, victim)) return 'NOT_AT_WAR';
  return null;
}

/** Ядерный удар. Боеголовка тратится в любом случае. */
export function launchNuke(state, map, nationId, unit, to) {
  const blocker = nukeBlocker(state, map, nationId, unit, to);
  if (blocker) return { ok: false, error: blocker };
  const log = ensure(state);
  const victim = state.owner[to];
  const from = unit.cell;
  removeUnit(state, unit.id);
  const chance = interceptChance(state, victim);
  const intercepted = chance > 0 && nextRandom(state) < chance;
  const target = Object.values(state.cities).find((c) => c.cell === to) ?? null;
  const strike = { turn: state.turn, from: nationId, to: victim, fromCell: from, cell: to, intercepted, city: target?.name ?? null };
  log.strikes.push(strike);
  if (log.strikes.length > 60) log.strikes.shift();
  const extra = { cell: to, fromCell: from, nuclear: true };
  // мир реагирует на сам пуск, даже если ракету сбили
  const attackerName = nameOf(state, nationId);
  const victimName = nameOf(state, victim);
  changeReputation(state, nationId, -(intercepted ? NUKE.reputation / 2 : NUKE.reputation));
  for (const other of Object.keys(state.nations).sort()) {
    if (other === nationId || !state.nations[other].alive) continue;
    if (other === victim) {
      changeRelation(state, other, nationId, -100);
      remember(state, other, nationId, 'grievance', NUKE.victimGrievance, 'nuclear');
    } else {
      changeRelation(state, other, nationId, -NUKE.worldRelation);
      remember(state, other, nationId, 'grievance', NUKE.worldGrievance, 'nuclear');
    }
    state.casusBelli ??= {};
    state.casusBelli[`${other}>${nationId}`] = state.turn + NUKE.casusBelliTurns;
  }
  if (isNeutralId(victim)) for (const p of Object.values(state.neutrals)) p.relations[nationId] = Math.max(-100, (p.relations[nationId] ?? 0) - 40);
  if (intercepted) {
    pushEvent(state, 'nuclearIntercepted', { a: attackerName, b: victimName }, 'all', extra);
    return { ok: true, intercepted: true, chance };
  }
  let killed = 0;
  const hitCities = [];
  for (const cell of cellsWithin(map, to, NUKE.radius)) {
    for (const id of [...unitsAt(state, cell)]) {
      const u = state.units[id];
      if (UNITS[u.type].domain === 'space') continue;
      removeUnit(state, id);
      killed += 1;
    }
    state.fallout[cell] = state.turn + NUKE.falloutTurns;
    const city = Object.values(state.cities).find((c) => c.cell === cell);
    if (city) {
      city.pop = Math.max(1, Math.round(city.pop * NUKE.popFactor));
      city.hp = 0;
      const lost = city.buildings.filter((b) => b !== 'ark').slice(-NUKE.buildingsLost);
      city.buildings = city.buildings.filter((b) => !lost.includes(b));
      city.prod = 0;
      hitCities.push(city.name);
    }
  }
  strike.killed = killed;
  pushEvent(state, target ? 'nuclearStrike' : 'nuclearStrikeField', { a: attackerName, b: victimName, city: target?.name ?? '' }, 'all', extra);
  return { ok: true, intercepted: false, chance, killed, cities: hitCities };
}

/** Разоружение в «Купол»: боеголовка идёт на щит. Только для участников пакта во время финала. */
export function dismantle(state, nationId, unit) {
  if (!unit || unit.owner !== nationId) return { ok: false, error: 'NOT_YOUR_UNIT' };
  if (unit.type !== 'icbm') return { ok: false, error: 'NOT_WARHEAD' };
  if (!state.finale.detectedTurn) return { ok: false, error: 'NO_FINALE' };
  if (!pactMembers(state).includes(nationId)) return { ok: false, error: 'NOT_IN_PACT' };
  removeUnit(state, unit.id);
  addShield(state, nationId, DISMANTLE_SHIELD, 'warheads');
  pushEvent(state, 'warheadDismantled', { nation: nameOf(state, nationId), points: DISMANTLE_SHIELD });
  return { ok: true, points: DISMANTLE_SHIELD };
}

/** Орбитальная разведка спутником: открывает круг радиусом 3 на 5 ходов. */
export function orbitalRecon(state, map, nationId, unit, to) {
  if (!unit || unit.owner !== nationId) return { ok: false, error: 'NOT_YOUR_UNIT' };
  if (unit.type !== 'satellite') return { ok: false, error: 'NOT_SATELLITE' };
  if (!validCell(map, to)) return { ok: false, error: 'NO_TARGET' };
  if ((unit.reconReady ?? 0) > state.turn) return { ok: false, error: 'RECON_COOLDOWN' };
  ensure(state);
  unit.reconReady = state.turn + RECON.cooldown;
  const list = (state.recon[nationId] ??= []).filter((r) => r.until > state.turn);
  list.push({ cell: to, until: state.turn + RECON.turns, by: unit.id });
  state.recon[nationId] = list;
  for (const c of cellsWithin(map, to, RECON.radius)) state.explored[nationId][c] = 1;
  return { ok: true };
}

/** Активные зоны разведки нации. */
export function reconZones(state, nationId) {
  return (state.recon?.[nationId] ?? []).filter((r) => r.until > state.turn);
}

/** Ежеходовая уборка: истёкшие зоны осадков и разведки. */
export function nuclearTick(state) {
  if (state.fallout) for (const k of Object.keys(state.fallout)) if (state.fallout[k] <= state.turn) delete state.fallout[k];
  if (state.recon) for (const id of Object.keys(state.recon)) state.recon[id] = state.recon[id].filter((r) => r.until > state.turn);
}

/** Данные для снимка клиента. */
export function nuclearView(state, nationId) {
  const explored = state.explored[nationId];
  const seismic = state.nations[nationId].techs.includes('fission');
  return {
    warheads: warheads(state, nationId),
    winter: Math.round((1 - winterFactor(state)) * 100),
    fallout: Object.entries(state.fallout ?? {}).filter(([c, until]) => until > state.turn && (explored[c] || state.owner[c] === nationId)).map(([c, until]) => [Number(c), until]).sort((a, b) => a[0] - b[0]),
    recon: reconZones(state, nationId).map(({ cell, until }) => ({ cell, until })),
    // точку взрыва знают свидетели и все, у кого есть «Ядерное деление» (сейсмический мониторинг)
    strikes: (state.nuclear?.strikes ?? []).slice(-12).map((s) => ({ turn: s.turn, from: s.from, to: s.to, cell: explored[s.cell] || seismic || s.from === nationId || s.to === nationId ? s.cell : null, fromCell: explored[s.fromCell] || s.from === nationId ? s.fromCell : null, intercepted: s.intercepted })),
    nuclearPowers: Object.keys(state.nations).filter((id) => state.nations[id].techs.includes('fission') && (state.nations[id].met?.includes(nationId) || id === nationId)).sort(),
  };
}
