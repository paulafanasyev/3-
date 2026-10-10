// Дипломатия: отношения, договоры, репутация, оценка предложений ИИ (§9).
import { TREATY_NAMES } from './i18n/ru.js';
import { DOCTRINES } from './data/nations.js';
import { pushEvent, nameOf } from './events.js';
import { pairKey, atWar, treatyBetween, relation, militaryPower, isNeutralId } from './rules.js';
import { attitude, remember } from './leaders.js';

export const TREATY_RULES = Object.freeze({
  nap: { minRelation: 0, duration: 20, influence: 5, breakReputation: 30 },
  trade: { minRelation: -20, duration: null, influence: 5, breakReputation: 10 },
  research: { minRelation: 20, duration: 30, influence: 10, breakReputation: 10 },
  alliance: { minRelation: 40, duration: null, influence: 15, breakReputation: 40 },
});
export const TRUCE_TURNS = 10;
export const PEACE_MIN_WAR_TURNS = 5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function changeRelation(state, a, b, delta) {
  if (isNeutralId(b)) { const p = state.neutrals[b]; p.relations[a] = clamp((p.relations[a] ?? 0) + delta, -100, 100); return; }
  if (isNeutralId(a)) { changeRelation(state, b, a, delta); return; }
  const key = pairKey(a, b);
  state.relations[key] = clamp((state.relations[key] ?? 0) + delta, -100, 100);
}

export function changeReputation(state, id, delta) {
  const n = state.nations[id];
  n.reputation = clamp(n.reputation + delta, 0, 100);
}

export function treatyInfluenceCost(state, nationId, type) {
  const discount = DOCTRINES[state.nations[nationId].doctrine].treatyDiscount ?? 0;
  return Math.round(TREATY_RULES[type].influence * (1 - discount));
}

/**
 * Оценка предложения договора нацией `judge` от `from`. Детерминированная:
 * отношения, репутация, характер и баланс сил. Возвращает { accept, score }.
 */
export function evaluateTreaty(state, judge, from, type) {
  const rule = TREATY_RULES[type];
  const j = state.nations[judge];
  const f = state.nations[from];
  if (atWar(state, judge, from)) return { accept: false, score: -Infinity };
  const rel = attitude(state, judge, from);
  let score = rel + (f.reputation - 50) * 0.5;
  const coop = j.ai?.coop ?? 0.6;
  score += (coop - 0.5) * 30;
  if (type === 'alliance') {
    // союз выгоден, когда у обоих есть общий враг или партнёр сильнее
    const commonEnemy = Object.keys(state.nations).some((x) => x !== judge && x !== from && atWar(state, judge, x) && atWar(state, from, x));
    if (commonEnemy) score += 20;
    const ratio = (militaryPower(state, from) + 1) / (militaryPower(state, judge) + 1);
    if (ratio < 0.4) score -= 15; // слабый союзник — обуза
  }
  if (type === 'research' && f.techs.length + 4 < j.techs.length) score -= 40; // невыгодно делиться с отстающим
  // черты лидера: честный ценит репутацию партнёра, осторожный не любит союзы
  const t = j.leader?.traits;
  if (t) {
    score += (t.honor - 0.5) * (f.reputation - 50) * 0.4;
    if (type === 'alliance') score -= (t.caution - 0.5) * 30;
    if (type === 'trade') score += (t.greed - 0.5) * 20;
  }
  return { accept: score >= rule.minRelation, score };
}

export function addTreaty(state, a, b, type) {
  const rule = TREATY_RULES[type];
  state.treaties.push({ type, a, b, since: state.turn, until: rule.duration ? state.turn + rule.duration : null });
  state.treaties.sort((x, y) => (x.type + x.a + x.b).localeCompare(y.type + y.a + y.b));
  changeRelation(state, a, b, 5);
  pushEvent(state, 'treaty', { a: nameOf(state, a), b: nameOf(state, b), treaty: TREATY_NAMES[type] });
}

export function removeTreaty(state, a, b, type, { broken = false, by = a } = {}) {
  const t = treatyBetween(state, a, b, type);
  if (!t) return false;
  state.treaties = state.treaties.filter((x) => x !== t);
  if (broken) {
    remember(state, by === a ? b : a, by, 'grievance', TREATY_RULES[type].breakReputation, 'treatyBroken');
    changeReputation(state, by, -TREATY_RULES[type].breakReputation);
    changeRelation(state, a, b, type === 'alliance' ? -80 : -30);
    pushEvent(state, 'treatyBroken', { a: nameOf(state, by), b: nameOf(state, by === a ? b : a), treaty: TREATY_NAMES[type] });
  }
  return true;
}

export function declareWar(state, aggressor, target) {
  const key = pairKey(aggressor, target);
  if (state.wars.includes(key)) return { ok: false, error: 'ALREADY_AT_WAR' };
  if (!isNeutralId(target) && (state.truces[key] ?? 0) > state.turn) return { ok: false, error: 'TRUCE' };
  if (!isNeutralId(target)) {
    // повод к войне (раскрытый заговор жертвы) снимает штрафы с объявившего
    const justified = (state.casusBelli?.[`${aggressor}>${target}`] ?? 0) >= state.turn;
    for (const type of ['nap', 'alliance', 'research', 'trade']) {
      if (treatyBetween(state, aggressor, target, type)) removeTreaty(state, aggressor, target, type, { broken: !justified && (type === 'nap' || type === 'alliance'), by: aggressor });
    }
    changeRelation(state, aggressor, target, -60);
    remember(state, target, aggressor, 'grievance', justified ? 20 : 50, 'war');
    for (const other of Object.keys(state.nations)) {
      if (other === aggressor || other === target || justified) continue;
      changeRelation(state, other, aggressor, treatyBetween(state, other, target, 'alliance') ? -30 : -10);
    }
  } else {
    if (treatyBetween(state, aggressor, target, 'trade')) removeTreaty(state, aggressor, target, 'trade');
    changeRelation(state, aggressor, target, -60);
    changeReputation(state, aggressor, -5);
  }
  state.wars.push(key);
  state.wars.sort();
  state.warSince[key] = state.turn;
  pushEvent(state, 'war', { a: nameOf(state, aggressor), b: nameOf(state, target) });
  return { ok: true };
}

export function makePeace(state, a, b) {
  const key = pairKey(a, b);
  state.wars = state.wars.filter((k) => k !== key);
  delete state.warSince[key];
  state.truces[key] = state.turn + TRUCE_TURNS;
  changeRelation(state, a, b, 15);
  pushEvent(state, 'peace', { a: nameOf(state, a), b: nameOf(state, b) });
}

/** Готова ли нация `judge` заключить мир с `from`. */
export function evaluatePeace(state, judge, from) {
  const key = pairKey(judge, from);
  const turns = state.turn - (state.warSince[key] ?? state.turn);
  if (turns < PEACE_MIN_WAR_TURNS) return false;
  if (isNeutralId(judge)) return true;
  const mine = militaryPower(state, judge) + 1;
  const theirs = militaryPower(state, from) + 1;
  return mine < theirs * 1.2 || relation(state, judge, from) > -50 || turns > 25;
}

/** Ежеходовой дрейф отношений и истечение договоров. */
export function diplomacyTick(state, map) {
  const ids = Object.keys(state.nations).filter((id) => state.nations[id].alive);
  // общие границы немного раздражают
  const borders = new Set();
  for (let cell = 0; cell < map.size; cell += 1) {
    const o = state.owner[cell];
    if (!o || isNeutralId(o)) continue;
    for (const n of map.neighbors[cell]) {
      const p = state.owner[n];
      if (p && p !== o && !isNeutralId(p)) borders.add(pairKey(o, p));
    }
  }
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const a = ids[i]; const b = ids[j];
    const key = pairKey(a, b);
    let delta = -(state.relations[key] ?? 0) * 0.01;
    if (borders.has(key)) delta -= 0.3;
    if (atWar(state, a, b)) delta -= 1;
    if (treatyBetween(state, a, b, 'trade')) delta += 0.5;
    if (treatyBetween(state, a, b, 'research')) delta += 0.5;
    if (treatyBetween(state, a, b, 'alliance')) delta += 1;
    if (state.nations[a].finale.path === 'pact' && state.nations[b].finale.path === 'pact') delta += 1;
    changeRelation(state, a, b, delta);
  }
  for (const id of ids) {
    const n = state.nations[id];
    n.reputation += (70 - n.reputation) * 0.01;
  }
  for (const p of Object.values(state.neutrals)) {
    for (const id of ids) {
      const v = p.relations[id] ?? 0;
      p.relations[id] = clamp(v - v * 0.02 + (atWar(state, p.id, id) ? -2 : 0), -100, 100);
    }
  }
  // истечение срочных договоров
  const expired = state.treaties.filter((t) => t.until !== null && t.until <= state.turn);
  for (const t of expired) removeTreaty(state, t.a, t.b, t.type);
  // устаревшие предложения
  state.offers = state.offers.filter((o) => o.turn >= state.turn - 3);
}
