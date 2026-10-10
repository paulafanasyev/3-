// Переговоры: сделки из нескольких пунктов, встречные предложения, требования
// с угрозой войны и блеф. Сделка всегда описана с точки зрения предлагающего:
//   give — что он отдаёт, take — что просит взамен.
// Пункты: gold (число), techs (id технологий), cities (id городов),
//         treaties ('nap'|'trade'|'research'|'alliance'), peace (true),
//         joinWar (id нации, против которой вместе воевать).
import { TECHS } from './data/techs.js';
import { pushEvent, nameOf, own, techLearnable, grantTech } from './events.js';
import { isWater } from './data/terrain.js';
import { cellsWithin } from './map.js';
import {
  atWar, treatyBetween, militaryPower, techCost, majorIds, pairKey,
} from './rules.js';
import {
  addTreaty, makePeace, declareWar, changeRelation, changeReputation, TREATY_RULES, PEACE_MIN_WAR_TURNS,
} from './diplomacy.js';
import { attitude, traits, remember, say, credibility } from './leaders.js';

export { credibility };

export const DEMAND_REPUTATION = 5;
export const BLUFF_WINDOW = 3;
export const DEMAND_COOLDOWN = 10; // ходов между ультиматумами одной и той же нации


export function normalizeSide(raw) {
  const side = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    gold: Math.min(1e6, Math.max(0, Math.floor(typeof side.gold === 'number' && Number.isFinite(side.gold) ? side.gold : 0))),
    techs: Array.isArray(side.techs) ? [...new Set(side.techs.filter((t) => typeof t === 'string'))].slice(0, 6).sort() : [],
    cities: Array.isArray(side.cities) ? [...new Set(side.cities.filter((c) => typeof c === 'string'))].slice(0, 4).sort() : [],
    treaties: Array.isArray(side.treaties) ? [...new Set(side.treaties.filter((t) => own(TREATY_RULES, t)))].sort() : [],
    peace: side.peace === true,
    joinWar: typeof side.joinWar === 'string' ? side.joinWar : null,
  };
}

export function normalizeDeal(raw) {
  const deal = raw !== null && typeof raw === 'object' ? raw : {};
  const give = normalizeSide(deal.give);
  const take = normalizeSide(deal.take);
  // договоры и мир взаимны: храним их в give
  give.treaties = [...new Set([...give.treaties, ...take.treaties])].sort();
  give.peace = give.peace || take.peace;
  take.treaties = [];
  take.peace = false;
  return { give, take };
}

export const isEmptySide = (s) => !s.gold && !s.techs.length && !s.cities.length && !s.treaties.length && !s.peace && !s.joinWar;

/** Может ли `owner` отдать пункты стороны `side` нации `to`. Возвращает код ошибки или null. */
export function sideBlocker(state, owner, to, side) {
  const o = state.nations[owner];
  if (side.gold > o.gold) return 'NOT_ENOUGH_GOLD';
  for (const t of side.techs) {
    if (!own(TECHS, t) || !o.techs.includes(t)) return 'TECH_UNAVAILABLE';
    // получатель должен быть готов к технологии: своя эпоха и все предпосылки
    if (!techLearnable(state.nations[to], t)) return 'TECH_NOT_READY';
  }
  for (const id of side.cities) {
    const c = own(state.cities, id) ? state.cities[id] : null;
    if (!c || c.owner !== owner) return 'NOT_YOUR_CITY';
    if (c.capital || c.id === o.originalCapital) return 'CAPITAL_NOT_FOR_SALE';
  }
  if (side.joinWar) {
    const enemy = side.joinWar;
    if (!own(state.nations, enemy) || enemy === owner || enemy === to || !state.nations[enemy].alive) return 'UNKNOWN_NATION';
    if (!o.met.includes(enemy)) return 'NOT_MET';
    if (atWar(state, owner, enemy)) return 'ALREADY_AT_WAR';
    if ((state.truces[pairKey(owner, enemy)] ?? 0) > state.turn) return 'TRUCE';
    if (treatyBetween(state, owner, enemy, 'alliance')) return 'TREATY_EXISTS';
  }
  return null;
}

export function dealBlocker(state, from, to, deal) {
  if (isEmptySide(deal.give) && isEmptySide(deal.take)) return 'EMPTY_DEAL';
  for (const t of deal.give.treaties) if (treatyBetween(state, from, to, t)) return 'TREATY_EXISTS';
  const war = atWar(state, from, to);
  if (deal.give.peace && !war) return 'NOT_AT_WAR';
  if (war && !deal.give.peace) return 'ALREADY_AT_WAR';
  // договор нельзя купить у того, кто к вам слишком плохо относится (порог из TREATY_RULES)
  for (const t of deal.give.treaties) {
    if (attitude(state, to, from) < TREATY_RULES[t].minRelation - 10) return 'RELATION_TOO_LOW';
    if (attitude(state, from, to) < TREATY_RULES[t].minRelation - 10 && !state.nations[from].human) return 'RELATION_TOO_LOW';
  }
  return sideBlocker(state, from, to, deal.give) ?? sideBlocker(state, to, from, deal.take);
}

// ---------- оценка ----------
function techValue(state, nationId, tech) {
  return techCost(state, nationId, tech) * 0.5;
}

export const TRUST_CAP = 20;

function cityValue(state, id) {
  const c = state.cities[id];
  return 60 + c.pop * 35 + c.buildings.length * 25;
}

/**
 * Ценность стороны сделки для `judge`. `receiving` — получает ли judge эти пункты.
 * Деньги ценятся по жадности, технологии по стоимости, города дорого.
 */
function sideValue(state, judge, other, side, receiving) {
  const t = traits(state, judge);
  let v = side.gold * (0.4 + t.greed * 0.6);
  for (const tech of side.techs) {
    const cost = techValue(state, receiving ? judge : other, tech);
    // отдавать технологию сопернику больнее, космические секреты — вдвойне
    v += receiving ? cost : cost * (1.1 + t.pride * 0.4) * (TECHS[tech].era === 3 ? 2 : 1);
  }
  for (const id of side.cities) v += cityValue(state, id) * (receiving ? 1 : 1.6 + t.pride);
  if (side.joinWar) {
    const enemyAttitude = attitude(state, judge, side.joinWar);
    const value = Math.max(-200, -enemyAttitude * 3) - 60 * t.caution;
    v += receiving ? value : -value; // «вступи в войну» для того, кто вступает, — затраты
  }
  return v;
}

function mutualValue(state, judge, other, deal) {
  const t = traits(state, judge);
  const att = attitude(state, judge, other);
  let v = 0;
  for (const type of deal.give.treaties) {
    const need = TREATY_RULES[type].minRelation;
    v += (att - need) * 2 + (type === 'trade' ? 20 * t.greed : 0) + (type === 'alliance' ? -30 * t.caution : 0);
  }
  if (deal.give.peace) {
    const turns = state.turn - (state.warSince[pairKey(judge, other)] ?? state.turn);
    if (turns < PEACE_MIN_WAR_TURNS) v -= 300;
    const ratio = (militaryPower(state, judge) + 1) / (militaryPower(state, other) + 1);
    v += (1.2 - ratio) * 120 + turns * 3 - t.pride * 40;
  }
  return v;
}

/**
 * Оценка сделки нацией `judge`, которой её предлагает `from`.
 * Возвращает { score, accept }. score > 0 — сделка выгодна judge.
 */
export function evaluateDeal(state, judge, from, deal) {
  const gets = sideValue(state, judge, from, deal.give, true);
  const pays = sideValue(state, judge, from, deal.take, false);
  const att = attitude(state, judge, from);
  const rep = state.nations[from].reputation;
  // доверие помогает сойтись в цене, но не заменяет оплату: максимум TRUST_CAP
  const trust = Math.min(TRUST_CAP, (rep - 50) * 0.8 + att * 0.6);
  const mutual = mutualValue(state, judge, from, deal);
  let score = gets - pays + mutual + trust;
  // технологии и города даром не отдают: взамен должно быть что-то ценное
  if ((deal.take.techs.length || deal.take.cities.length) && gets + Math.max(0, mutual) < pays * 0.5) {
    score = Math.min(score, -Math.max(1, pays * 0.5 - gets - Math.max(0, mutual)));
  }
  return { score, accept: score >= 0 };
}

/** Встречное предложение: чего не хватает, просим золотом или технологией. */
export function counterOffer(state, judge, from, deal, score) {
  if (score >= 0) return null;
  const t = traits(state, judge);
  const missing = -score;
  const rate = 0.4 + t.greed * 0.6;
  const counter = structuredClone(deal);
  const goldNeeded = Math.ceil(missing / rate);
  const fromGold = state.nations[from].gold - counter.give.gold;
  if (goldNeeded <= fromGold) {
    counter.give.gold += goldNeeded;
    return counter;
  }
  const techs = state.nations[from].techs
    .filter((x) => !state.nations[judge].techs.includes(x) && !counter.give.techs.includes(x) && techLearnable(state.nations[judge], x))
    .sort((a, b) => techValue(state, judge, b) - techValue(state, judge, a) || a.localeCompare(b));
  let covered = Math.max(0, fromGold) * rate;
  for (const tech of techs) {
    counter.give.techs.push(tech);
    covered += techValue(state, judge, tech);
    if (covered >= missing) {
      counter.give.gold += Math.max(0, fromGold);
      counter.give.techs.sort();
      return counter;
    }
  }
  return null; // торговаться не о чем
}

// ---------- исполнение ----------
function transferSide(state, map, from, to, side) {
  state.nations[from].gold -= side.gold;
  state.nations[to].gold += side.gold;
  for (const tech of side.techs) grantTech(state, state.nations[to], tech);
  for (const id of side.cities) {
    const c = state.cities[id];
    c.owner = to;
    c.queue = [];
    for (const cell of cellsWithin(map, c.cell, 2)) if (state.owner[cell] === from) state.owner[cell] = to;
    evacuate(state, map, from, c.cell);
  }
}

/** Юниты прежнего владельца покидают переданный город: армию в подарок не провезти. */
function evacuate(state, map, owner, cell) {
  const units = (state.unitsByCell[cell] ?? []).map((id) => state.units[id]).filter((u) => u.owner === owner);
  if (!units.length) return;
  const candidates = cellsWithin(map, cell, 6).filter((c) => !isWater(map.terrain[c]) && !state.cityAt[c]
    && !(state.unitsByCell[c] ?? []).some((id) => state.units[id].owner !== owner));
  const home = candidates.filter((c) => state.owner[c] === owner);
  for (const u of units) {
    const target = home[0] ?? candidates[0];
    if (target === undefined) { removeUnitRaw(state, u); continue; }
    moveUnitRaw(state, u, target);
    u.goal = null;
    u.moves = 0;
  }
}

function removeUnitRaw(state, unit) {
  state.unitsByCell[unit.cell] = (state.unitsByCell[unit.cell] ?? []).filter((x) => x !== unit.id);
  if (!state.unitsByCell[unit.cell].length) delete state.unitsByCell[unit.cell];
  delete state.units[unit.id];
}

function moveUnitRaw(state, unit, cell) {
  state.unitsByCell[unit.cell] = (state.unitsByCell[unit.cell] ?? []).filter((x) => x !== unit.id);
  if (!state.unitsByCell[unit.cell].length) delete state.unitsByCell[unit.cell];
  unit.cell = cell;
  (state.unitsByCell[cell] ??= []).push(unit.id);
  state.unitsByCell[cell].sort();
}

export function executeDeal(state, map, from, to, deal) {
  // предпроверка перед любыми изменениями: сделка исполняется целиком или никак
  const blocker = dealBlocker(state, from, to, deal);
  if (blocker) return blocker;
  if (deal.give.peace) makePeace(state, from, to);
  transferSide(state, map, from, to, deal.give);
  transferSide(state, map, to, from, deal.take);
  for (const type of deal.give.treaties) addTreaty(state, from, to, type);
  if (deal.give.joinWar && !atWar(state, from, deal.give.joinWar)) declareWar(state, from, deal.give.joinWar);
  if (deal.take.joinWar && !atWar(state, to, deal.take.joinWar)) declareWar(state, to, deal.take.joinWar);
  remember(state, to, from, 'favor', 8, 'deal');
  remember(state, from, to, 'favor', 8, 'deal');
  pushEvent(state, 'dealDone', { a: nameOf(state, from), b: nameOf(state, to) });
  return null;
}

// ---------- требования и блеф ----------

/**
 * Готов ли `judge` уступить требованию `from` под угрозой войны.
 * Сила угрозы = соотношение армий × доверие к угрозам; сопротивление = гордость,
 * обиды и союзники.
 */
export function evaluateDemand(state, judge, from, rawTake) {
  const take = normalizeSide(rawTake);
  const t = traits(state, judge);
  const ratio = (militaryPower(state, from) + 1) / (militaryPower(state, judge) + 1);
  const allies = majorIds(state).filter((x) => x !== judge && x !== from && treatyBetween(state, judge, x, 'alliance'));
  const alliedPower = allies.reduce((s, x) => s + militaryPower(state, x), 0);
  const effective = (militaryPower(state, from) + 1) / (militaryPower(state, judge) + alliedPower * 0.6 + 1);
  const threat = effective * credibility(state, from) * (0.6 + t.caution * 0.8);
  const cost = sideValue(state, judge, from, take, false) / 250;
  const resistance = 1 + t.pride * 0.8 + cost;
  return { accept: threat > resistance, threat, resistance, ratio };
}

/** Можно ли сейчас выдвинуть ультиматум. */
export function demandBlocker(state, from, to) {
  if (treatyBetween(state, from, to, 'nap') || treatyBetween(state, from, to, 'alliance')) return 'HAS_TREATY';
  const last = state.lastDemand?.[`${from}>${to}`];
  if (last !== undefined && state.turn - last < DEMAND_COOLDOWN) return 'DEMAND_COOLDOWN';
  return null;
}

export function makeDemand(state, map, from, to, rawTake) {
  const take = normalizeSide(rawTake);
  state.lastDemand ??= {};
  state.lastDemand[`${from}>${to}`] = state.turn;
  // каждый следующий ультиматум за последние 30 ходов стоит дороже
  const n = state.nations[from];
  n.demandLog = (n.demandLog ?? []).filter((t) => state.turn - t < 30);
  changeReputation(state, from, -DEMAND_REPUTATION * (1 + n.demandLog.length));
  n.demandLog.push(state.turn);
  const verdict = evaluateDemand(state, to, from, take);
  if (verdict.accept) {
    transferSide(state, map, to, from, take);
    remember(state, to, from, 'grievance', 35, 'extortion');
    changeRelation(state, from, to, -20);
    pushEvent(state, 'demandAccepted', { a: nameOf(state, to), b: nameOf(state, from) });
    return { accepted: true, reply: say(state, to, 'demandAccept', { target: nameOf(state, from) }) };
  }
  remember(state, from, to, 'grievance', 10, 'refused');
  changeRelation(state, from, to, -25);
  state.pendingThreats ??= [];
  state.pendingThreats.push({ from, to, turn: state.turn });
  pushEvent(state, 'demandRefused', { a: nameOf(state, to), b: nameOf(state, from) });
  return { accepted: false, reply: say(state, to, 'demandRefuse', { target: nameOf(state, from) }) };
}

/** Угроза, за которой не последовала война в течение BLUFF_WINDOW ходов, — раскрытый блеф. */
export function threatTick(state) {
  if (!state.pendingThreats?.length) return;
  const keep = [];
  for (const th of state.pendingThreats) {
    if (atWar(state, th.from, th.to)) continue; // угроза исполнена
    if (state.turn - th.turn >= BLUFF_WINDOW) {
      const n = state.nations[th.from];
      n.bluffsCalled = (n.bluffsCalled ?? 0) + 1;
      pushEvent(state, 'bluffCalled', { nation: n.name });
    } else keep.push(th);
  }
  state.pendingThreats = keep;
}
