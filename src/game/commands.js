// Команды: единственный способ изменить партию. Игрок и ИИ пользуются одними
// и теми же командами. applyCommand валидирует ввод и возвращает { ok, error? }.
import { nextRandom } from './rng.js';
import { createNamer, createRealNameGuard } from './names.js';
import { UNITS, VETERAN_MAX } from './data/units.js';
import { isWater } from './data/terrain.js';
import { TREATY_NAMES } from './i18n/ru.js';
import { loadMap, cellsWithin, loadStopList } from './map.js';
import { addCity, removeUnit, placeUnit, pushEvent, nameOf } from './state.js';
import { own } from './events.js';
import {
  availableTechs, itemBlocker, itemCost, canEnter, moveCost, findPath, blockedFor, attackOdds, isEmbarked, defenderStrength,
  atWar, treatyBetween, relation, isNeutralId, unitsAt, OCCUPATION_TURNS, unitStrength,
} from './rules.js';
import { TERRAIN } from './data/terrain.js';
import {
  declareWar, makePeace, evaluatePeace, evaluateTreaty, addTreaty, removeTreaty,
  treatyInfluenceCost, changeRelation, changeReputation, TREATY_RULES,
} from './diplomacy.js';
import { choosePath, contribute } from './finale.js';
import {
  normalizeDeal, dealBlocker, evaluateDeal, counterOffer, executeDeal, makeDemand, normalizeSide, sideBlocker, isEmptySide, demandBlocker,
} from './negotiation.js';
import { runOperation } from './intrigue.js';
import { launchNuke, dismantle, orbitalRecon } from './nuclear.js';
import { startBattle, stepBattle, orderRegiment, finishBattle, battleView, isTacticalType } from './tactical.js';
import { say, remember } from './leaders.js';

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

export const MIN_CITY_DISTANCE = 3; // шагов между городами
export const ANNEX_RELATION = 60;
/** Цена присоединения растёт с размером народа и с размером собственной державы. */
export const annexCost = (cities, ownCities = 0) => Math.round((50 + 40 * cities) * (1 + ownCities / 12));
/** Присоединённые города несколько ходов встраиваются в державу (как оккупация, но короче). */
export const INTEGRATION_TURNS = 5;

// ---------- города ----------
export function citySiteBlocker(state, map, nationId, cell) {
  const code = map.terrain[cell];
  if (isWater(code) || code === 'I') return 'BAD_CITY_SITE';
  if (state.owner[cell] && state.owner[cell] !== nationId) return 'BAD_CITY_SITE';
  for (const c of cellsWithin(map, cell, MIN_CITY_DISTANCE - 1)) {
    if (state.cityAt[c]) return 'TOO_CLOSE_TO_CITY';
  }
  return null;
}

const NATION_CULTURE = { borea: 'northern', cartel: 'coastal', meridian: 'highland', auris: 'desert' };

let realGuard = null;

function newCityName(state, nation) {
  const forbidden = new Set(Object.values(state.cities).map((c) => c.name.toLowerCase()));
  realGuard ??= createRealNameGuard(loadStopList());
  const namer = createNamer(state, { forbidden, tooReal: realGuard });
  return namer.city(NATION_CULTURE[nation.id] ?? 'coastal');
}

function foundCity(state, map, nationId, unit) {
  if (unit.type !== 'settler') return fail('NOT_SETTLER');
  const blocker = citySiteBlocker(state, map, nationId, unit.cell);
  if (blocker) return fail(blocker);
  const nation = state.nations[nationId];
  const capital = !Object.values(state.cities).some((c) => c.owner === nationId);
  const city = addCity(state, map, nationId, unit.cell, newCityName(state, nation), { capital });
  if (capital) {
    nation.capital = city.id;
    nation.originalCapital ??= city.id; // для победы завоеванием: первая столица не меняется
  }
  removeUnit(state, unit.id);
  pushEvent(state, 'cityFounded', { nation: nation.name, city: city.name });
  return ok({ cityId: city.id });
}

// ---------- бой ----------
export function resolveAttack(state, map, attacker, cell) {
  const odds = attackOdds(state, map, attacker, cell);
  const roll = nextRandom(state);
  const cityId = state.cityAt[cell];
  const city = cityId ? state.cities[cityId] : null;
  const defenderOwner = city && city.owner !== attacker.owner ? city.owner
    : state.units[unitsAt(state, cell).find((id) => state.units[id].owner !== attacker.owner)]?.owner;
  const attackerName = `${UNITS[attacker.type].name} (${nameOf(state, attacker.owner)})`;
  const defenderName = city ? city.name : nameOf(state, defenderOwner);
  const audience = [attacker.owner, defenderOwner].filter((x) => x && !isNeutralId(x));
  // кто стоял в обороне: для анимации боя в клиенте
  const front = unitsAt(state, cell).map((id) => state.units[id]).filter((u) => u.owner !== attacker.owner)
    .sort((a, b) => defenderStrength(state, map, b) - defenderStrength(state, map, a) || a.id.localeCompare(b.id))[0];
  const combat = {
    from: attacker.cell, to: cell, attacker: attacker.type, attackerOwner: attacker.owner, attackerId: attacker.id,
    defender: front?.type ?? null, defenderOwner: defenderOwner ?? null, city: city?.name ?? null,
    odds: Math.round(odds * 100), hpBefore: attacker.hp, cityHpBefore: city?.hp ?? null,
  };
  attacker.moves = 0;
  attacker.fortified = false;
  if (roll < odds) {
    attacker.hp = Math.max(5, attacker.hp - Math.round(10 + 50 * (1 - odds)));
    attacker.vet = Math.min(VETERAN_MAX, (attacker.vet ?? 0) + 1);
    if (city) {
      city.hp = Math.max(0, city.hp - Math.round(35 + 30 * odds));
      // гарнизон погибает вместе с обороной
      for (const id of [...unitsAt(state, cell)]) if (state.units[id].owner === city.owner && UNITS[state.units[id].type].str > 0) { removeUnit(state, id); break; }
      if (city.hp === 0 && UNITS[attacker.type].domain === 'land') captureCity(state, map, attacker, city);
    } else {
      // гибнет только сильнейший защитник; остальные получают урон. Клетку занимают, лишь когда она пуста
      const defenders = unitsAt(state, cell).map((id) => state.units[id]).filter((u) => u.owner !== attacker.owner)
        .sort((a, b) => defenderStrength(state, map, b) - defenderStrength(state, map, a) || a.id.localeCompare(b.id));
      if (defenders.length) removeUnit(state, defenders[0].id);
      for (const u of defenders.slice(1)) u.hp = Math.max(10, u.hp - 20);
      const left = unitsAt(state, cell).some((id) => state.units[id].owner !== attacker.owner);
      if (!left && UNITS[attacker.type].domain !== 'air' && canEnter(state, map, attacker, cell)) placeUnit(state, attacker, cell);
    }
    combat.won = true;
    combat.attackerHp = attacker.hp;
    combat.cityHp = city ? city.hp : null;
    combat.captured = Boolean(city && city.owner === attacker.owner);
    combat.killed = front ? !state.units[front.id] : false;
    pushEvent(state, 'battleWon', { attacker: attackerName, defender: defenderName }, audience, { combat });
    return { won: true, odds, combat };
  }
  if (UNITS[attacker.type].domain === 'air' || attacker.hp <= 40) removeUnit(state, attacker.id);
  else attacker.hp = Math.max(5, attacker.hp - 45);
  combat.won = false;
  combat.attackerHp = state.units[attacker.id] ? attacker.hp : 0;
  combat.cityHp = city ? city.hp : null;
  combat.killed = false;
  pushEvent(state, 'battleLost', { attacker: attackerName, defender: defenderName }, audience, { combat });
  return { won: false, odds, combat };
}

export function captureCity(state, map, attacker, city) {
  const previous = city.owner;
  for (const id of [...unitsAt(state, city.cell)]) if (state.units[id].owner === previous) removeUnit(state, id);
  city.owner = attacker.owner;
  city.hp = 40;
  city.queue = [];
  city.pop = Math.max(1, city.pop - 1);
  // столицей город остаётся только у своей нации: вернувший исходную столицу снова правит из неё
  const wasCapital = city.capital;
  const winner = state.nations[attacker.owner];
  city.capital = Boolean(winner && winner.originalCapital === city.id);
  if (city.capital) { for (const c of Object.values(state.cities)) if (c.owner === attacker.owner && c !== city) c.capital = false; winner.capital = city.id; }
  city.occupiedUntil = city.capital ? 0 : state.turn + OCCUPATION_TURNS;
  if (wasCapital && !isNeutralId(previous) && state.nations[previous]) {
    // столица переезжает в крупнейший оставшийся город
    const next = Object.values(state.cities).filter((c) => c.owner === previous).sort((a, b) => b.pop - a.pop || a.id.localeCompare(b.id))[0];
    state.nations[previous].capital = next ? next.id : null;
    if (next) next.capital = true;
  }
  for (const cell of cellsWithin(map, city.cell, 2)) {
    if (state.owner[cell] === previous) state.owner[cell] = attacker.owner;
  }
  placeUnit(state, attacker, city.cell);
  pushEvent(state, 'cityCaptured', { nation: nameOf(state, attacker.owner), city: city.name });
  if (!isNeutralId(previous)) remember(state, previous, attacker.owner, 'grievance', 15, 'cityLost');
  if (isNeutralId(previous) && !Object.values(state.cities).some((c) => c.owner === previous)) state.neutrals[previous].alive = false;
  if (!isNeutralId(previous)) {
    const n = state.nations[previous];
    if (!Object.values(state.cities).some((c) => c.owner === previous) && !Object.values(state.units).some((u) => u.owner === previous && u.type === 'settler')) {
      n.alive = false;
      for (const u of Object.values(state.units)) if (u.owner === previous) removeUnit(state, u.id);
      pushEvent(state, 'eliminated', { nation: n.name });
    }
  }
}

/** Прогноз атаки соседней клетки: силы сторон, модификаторы и шанс. Ничего не меняет. */
export function combatPreview(state, map, unit, to) {
  if (typeof to !== 'number' || !Number.isSafeInteger(to) || to < 0 || to >= map.size) return fail('NO_TARGET');
  if (!map.neighbors[unit.cell].includes(to)) return fail('NO_TARGET');
  const enemy = enemyOwnerAt(state, unit, to);
  if (!enemy) return fail('NO_TARGET');
  if (UNITS[unit.type].str === 0) return fail('NO_TARGET');
  const cityId = state.cityAt[to];
  const city = cityId && state.cities[cityId].owner !== unit.owner ? state.cities[cityId] : null;
  const defenders = unitsAt(state, to).map((id) => state.units[id]).filter((u) => u.owner !== unit.owner)
    .sort((a, b) => defenderStrength(state, map, b) - defenderStrength(state, map, a) || a.id.localeCompare(b.id));
  const odds = attackOdds(state, map, unit, to);
  const attack = unitStrength(state, unit);
  const defense = odds > 0 && odds < 1 ? attack * (1 - odds) / odds : 0;
  const mods = [];
  if (unit.vet) mods.push({ side: 'a', text: `ветеран ×${(1 + 0.1 * unit.vet).toFixed(1)}` });
  if (unit.hp < 100) mods.push({ side: 'a', text: `ранен: ${unit.hp}%` });
  const terrain = TERRAIN[map.terrain[to]];
  if (terrain.defense !== 1) mods.push({ side: 'd', text: `местность ×${terrain.defense}` });
  if (city?.buildings.includes('walls')) mods.push({ side: 'd', text: 'стены +50%' });
  if (city) mods.push({ side: 'd', text: `город, прочность ${city.hp}%` });
  if (defenders[0]?.fortified) mods.push({ side: 'd', text: 'укрепился +25%' });
  if (defenders.length > 1) mods.push({ side: 'd', text: `поддержка стека: ${defenders.length - 1}` });
  if (isEmbarked(map, unit)) return fail('EMBARKED');
  return ok({
    preview: {
      tactical: Boolean(state.nations[unit.owner]?.human && isTacticalType(unit.type)),
      odds: Math.round(odds * 100), attack: Math.round(attack * 10) / 10, defense: Math.round(defense * 10) / 10,
      attacker: unit.type, defender: defenders[0]?.type ?? null, defenderOwner: enemy, city: city?.name ?? null,
      atWar: atWar(state, unit.owner, enemy), mods,
    },
  });
}

// ---------- движение ----------
/** Двигает юнит к цели, пока есть очки хода. Атакует, если следующая клетка вражеская. */
export function advanceUnit(state, map, unit) {
  if (unit.goal === null || unit.goal === undefined) return { moved: 0 };
  let moved = 0;
  let guard = 0;
  while (unit.moves > 0 && unit.cell !== unit.goal && guard < 40) {
    guard += 1;
    const path = findPath(state, map, unit, unit.goal, { allowEnemyAt: unit.goal });
    if (!path || !path.length) { unit.goal = null; return { moved, error: 'NO_PATH' }; }
    const step = path[0];
    if (blockedFor(state, unit, step)) {
      const enemy = enemyOwnerAt(state, unit, step);
      if (!enemy) { unit.goal = null; return { moved, error: 'CELL_OCCUPIED' }; }
      if (UNITS[unit.type].str === 0) { unit.goal = null; return { moved, error: 'CELL_OCCUPIED' }; }
      if (isEmbarked(map, unit)) { unit.goal = null; return { moved, error: 'EMBARKED' }; }
      if (!atWar(state, unit.owner, enemy)) {
        if (isNeutralId(enemy)) declareWar(state, unit.owner, enemy);
        else { unit.goal = null; return { moved, error: 'NOT_AT_WAR' }; }
      }
      const result = resolveAttack(state, map, unit, step);
      if (state.units[unit.id]) unit.goal = null;
      return { moved, attacked: true, ...result };
    }
    const cost = moveCost(map, step, unit, unit.cell);
    unit.moves = cost >= unit.moves ? 0 : unit.moves - cost; // как в Civ: последнее очко всегда позволяет шаг
    placeUnit(state, unit, step);
    unit.fortified = false;
    moved += 1;
  }
  if (unit.cell === unit.goal) unit.goal = null;
  return { moved };
}

function enemyOwnerAt(state, unit, cell) {
  const cityId = state.cityAt[cell];
  if (cityId && state.cities[cityId].owner !== unit.owner) return state.cities[cityId].owner;
  const other = unitsAt(state, cell).map((id) => state.units[id]).find((u) => u.owner !== unit.owner);
  return other?.owner ?? null;
}

/** Покупка за золото: оставшиеся очки производства ×2, космос ×3. */
export function buyPrice(state, map, city) {
  const item = city.queue[0];
  if (!item || item.kind === 'dome' || item.kind === 'project') return Infinity;
  const left = Math.max(0, itemCost(state, map, city, item) - city.prod);
  const space = item.kind === 'unit' && UNITS[item.id].domain === 'space';
  return Math.ceil(left * (space ? 3 : 2));
}

// ---------- главный обработчик ----------
const isMajor = (state, id) => own(state.nations, id);
const isPeople = (state, id) => own(state.neutrals, id);

/**
 * Применяет команду. Никогда не бросает исключений на плохой ввод: любой
 * непредусмотренный сбой превращается в BAD_COMMAND, а состояние не портится
 * (все проверки идут до изменений).
 */
export function applyCommand(state, nationId, command, map = loadMap()) {
  try {
    if (state.status !== 'running') return fail('GAME_OVER');
    if (!isMajor(state, nationId) || !state.nations[nationId].alive) return fail('UNKNOWN_NATION');
    if (command === null || typeof command !== 'object' || Array.isArray(command) || typeof command.kind !== 'string') return fail('BAD_COMMAND');
    return dispatch(state, nationId, command, map);
  } catch (error) {
    if (process.env.KUPOL_DEBUG) console.error(error);
    return fail('BAD_COMMAND');
  }
}

function dispatch(state, nationId, command, map) {
  const nation = state.nations[nationId];
  const unit = own(state.units, command.unitId) ? state.units[command.unitId] : null;
  const city = own(state.cities, command.cityId) ? state.cities[command.cityId] : null;
  const needUnit = () => (unit && unit.owner === nationId ? null : fail('NOT_YOUR_UNIT'));
  const needCity = () => (city && city.owner === nationId ? null : fail('NOT_YOUR_CITY'));
  const target = typeof command.target === 'string' ? command.target : null;
  const knownTarget = isMajor(state, target) || isPeople(state, target);

  // во время тактического боя партия стоит: доступны только приказы на поле
  if (state.battle && !command.kind.startsWith('battle')) return fail('BATTLE_ACTIVE');
  switch (command.kind) {
    case 'battle': {
      // атака с ручным управлением боем (как в Shogun: Total War); ИИ и автобой идут через move
      const e = needUnit(); if (e) return e;
      if (!nation.human) return fail('BAD_COMMAND');
      if (!isTacticalType(unit.type) || UNITS[unit.type].str === 0 || unit.moves <= 0) return fail('NO_TARGET');
      const to = command.to;
      if (typeof to !== 'number' || !Number.isSafeInteger(to) || to < 0 || to >= map.size || !map.neighbors[unit.cell].includes(to)) return fail('NO_TARGET');
      const enemy = enemyOwnerAt(state, unit, to);
      if (!enemy) return fail('NO_TARGET');
      if (!atWar(state, nationId, enemy)) {
        if (!isNeutralId(enemy)) return fail('NOT_AT_WAR');
        declareWar(state, nationId, enemy);
      }
      return ok({ battle: battleView(startBattle(state, map, unit, to)) });
    }
    case 'battleOrder': {
      if (!state.battle) return fail('NO_BATTLE');
      const orders = Array.isArray(command.orders) ? command.orders.slice(0, 40) : [command];
      for (const o of orders) { const err = orderRegiment(state.battle, state.battle.human, o); if (err) return fail(err); }
      return ok({ battle: battleView(state.battle) });
    }
    case 'battleAdvance': {
      if (!state.battle) return fail('NO_BATTLE');
      const ticks = Number.isInteger(command.ticks) ? Math.max(1, Math.min(20, command.ticks)) : 1;
      if (command.auto === true) state.battle.auto = true;
      stepBattle(state.battle, state.battle.auto ? 100000 : ticks);
      const view = battleView(state.battle);
      const combat = state.battle.result ? finishBattle(state, map, captureCity) : null;
      return ok({ battle: view, finished: Boolean(combat), combat });
    }
    case 'battleRetreat': {
      if (!state.battle) return fail('NO_BATTLE');
      // отступление: полки игрока уходят с поля, бой проигран, но выжившие спасены
      for (const r of state.battle.regiments) if (r.side === state.battle.human && r.men > 0) r.state = 'fled';
      state.battle.result = { winner: state.battle.human === 'a' ? 'd' : 'a', retreat: true };
      const view = battleView(state.battle);
      return ok({ battle: view, finished: true, combat: finishBattle(state, map, captureCity) });
    }
    case 'research': {
      if (!availableTechs(state, nationId).includes(command.tech)) return fail('TECH_UNAVAILABLE');
      nation.research = command.tech;
      return ok();
    }
    case 'produce': {
      const e = needCity(); if (e) return e;
      const item = command.item;
      if (item === null || typeof item !== 'object' || !['unit', 'building', 'dome', 'project'].includes(item.kind)) return fail('ITEM_UNAVAILABLE');
      if (item.kind !== 'dome' && typeof item.id !== 'string') return fail('ITEM_UNAVAILABLE');
      if (city.queue.length >= 8 && command.append) return fail('QUEUE_FULL');
      // одну и ту же постройку дважды в очередь не ставим
      if (command.append && item.kind === 'building' && city.queue.some((q) => q.kind === 'building' && q.id === item.id)) return fail('ITEM_UNAVAILABLE');
      const blocker = itemBlocker(state, map, city, item);
      if (blocker) return fail(blocker);
      if (command.append) city.queue.push({ kind: item.kind, id: item.id ?? null });
      else city.queue = [{ kind: item.kind, id: item.id ?? null }];
      return ok();
    }
    case 'buy': {
      const e = needCity(); if (e) return e;
      const item = city.queue[0];
      if (!item || item.kind === 'dome' || item.kind === 'project') return fail('ITEM_UNAVAILABLE');
      const price = buyPrice(state, map, city);
      if (nation.gold < price) return fail('NOT_ENOUGH_GOLD');
      nation.gold -= price;
      city.prod = itemCost(state, map, city, item);
      return ok({ price });
    }
    case 'move': {
      const e = needUnit(); if (e) return e;
      const to = command.to;
      if (typeof to !== 'number' || !Number.isSafeInteger(to) || to < 0 || to >= map.size) return fail('NO_PATH');
      if (UNITS[unit.type].domain === 'space') return fail('NO_PATH');
      if (!canEnter(state, map, unit, to)) return fail('NO_PATH');
      unit.goal = to;
      const result = advanceUnit(state, map, unit);
      if (result.error && !result.moved && !result.attacked) return fail(result.error);
      return ok({ moved: result.moved, attacked: Boolean(result.attacked), won: result.won ?? null });
    }
    case 'found': {
      const e = needUnit(); if (e) return e;
      return foundCity(state, map, nationId, unit);
    }
    case 'fortify': {
      const e = needUnit(); if (e) return e;
      unit.fortified = true; unit.goal = null; unit.moves = 0;
      return ok();
    }
    case 'disband': {
      const e = needUnit(); if (e) return e;
      removeUnit(state, unit.id);
      return ok();
    }
    case 'declareWar': {
      if (!knownTarget || target === nationId) return fail('UNKNOWN_NATION');
      if (isMajor(state, target) && !nation.met.includes(target)) return fail('NOT_MET');
      return declareWar(state, nationId, target);
    }
    case 'proposePeace': {
      if (!knownTarget) return fail('UNKNOWN_NATION');
      if (!atWar(state, nationId, target)) return fail('NOT_AT_WAR');
      if (isNeutralId(target) || !state.nations[target].human) {
        if (!evaluatePeace(state, target, nationId)) return fail('REJECTED');
        makePeace(state, nationId, target);
        return ok();
      }
      return queueOffer(state, nationId, target, 'peace');
    }
    case 'propose': {
      const type = command.treaty;
      if (!own(TREATY_RULES, type)) return fail('BAD_COMMAND');
      if (isPeople(state, target)) return proposeToNeutral(state, map, nation, target, type);
      if (!isMajor(state, target) || target === nationId) return fail('UNKNOWN_NATION');
      if (!nation.met.includes(target)) return fail('NOT_MET');
      if (treatyBetween(state, nationId, target, type)) return fail('TREATY_EXISTS');
      if (atWar(state, nationId, target)) return fail('ALREADY_AT_WAR');
      const cost = treatyInfluenceCost(state, nationId, type);
      if (nation.influence < cost) return fail('NOT_ENOUGH_INFLUENCE');
      if (state.nations[target].human) {
        const q = queueOffer(state, nationId, target, type);
        if (q.queued && !q.duplicate) nation.influence -= cost; // влияние списывается при отправке
        return q;
      }
      if (!evaluateTreaty(state, target, nationId, type).accept) return fail('REJECTED');
      nation.influence -= cost;
      addTreaty(state, nationId, target, type);
      return ok();
    }
    case 'cancelTreaty': {
      const type = command.treaty;
      if (!knownTarget || !own(TREATY_RULES, type) || !treatyBetween(state, nationId, target, type)) return fail('NO_TREATY');
      removeTreaty(state, nationId, target, type, { broken: true, by: nationId });
      return ok();
    }
    case 'respond': {
      const offer = state.offers.find((o) => o.id === command.offerId && o.to === nationId);
      if (!offer) return fail('BAD_OFFER');
      const consume = () => { state.offers = state.offers.filter((o) => o !== offer); };
      const accept = command.accept === true;
      // предложение снимается только после успешного ответа: при ошибке его можно принять позже
      if (offer.type === 'demand') {
        if (!accept) {
          consume();
          state.pendingThreats.push({ from: offer.from, to: nationId, turn: state.turn });
          changeRelation(state, nationId, offer.from, -15);
          return ok();
        }
        const blocker = executeDeal(state, map, nationId, offer.from, { give: offer.deal.take, take: normalizeSide({}) });
        if (blocker) return fail(blocker);
        consume();
        remember(state, nationId, offer.from, 'grievance', 35, 'extortion');
        return ok();
      }
      if (!accept) { consume(); changeRelation(state, nationId, offer.from, -3); return ok(); }
      if (offer.type === 'deal') {
        const blocker = executeDeal(state, map, offer.from, nationId, offer.deal);
        if (blocker) return fail(blocker);
        consume();
        return ok();
      }
      if (offer.type === 'peace') {
        if (!atWar(state, nationId, offer.from)) { consume(); return fail('BAD_OFFER'); }
        makePeace(state, nationId, offer.from);
        consume();
        return ok();
      }
      if (treatyBetween(state, nationId, offer.from, offer.type) || atWar(state, nationId, offer.from)) { consume(); return fail('BAD_OFFER'); }
      // устаревшее предложение: если отношения упали ниже порога, договор не заключается
      if (relation(state, offer.from, nationId) < TREATY_RULES[offer.type].minRelation - 10) { consume(); return fail('RELATION_TOO_LOW'); }
      addTreaty(state, offer.from, nationId, offer.type);
      consume();
      return ok();
    }
    case 'gift': {
      const gold = typeof command.gold === 'number' && Number.isFinite(command.gold) ? Math.floor(command.gold) : 0;
      if (!knownTarget || target === nationId) return fail('UNKNOWN_NATION');
      if (gold <= 0 || gold > nation.gold) return fail('NOT_ENOUGH_GOLD');
      nation.gold -= gold;
      if (isMajor(state, target)) { state.nations[target].gold += gold; remember(state, target, nationId, 'favor', Math.min(30, gold / 5), 'gift'); }
      changeRelation(state, nationId, target, Math.min(isNeutralId(target) ? 8 : 20, gold / (isNeutralId(target) ? 8 : 5)));
      return ok();
    }
    case 'annex': {
      const people = isPeople(state, target) ? state.neutrals[target] : null;
      if (!people || !people.alive) return fail('UNKNOWN_NATION');
      if (relation(state, nationId, target) < ANNEX_RELATION) return fail('RELATION_TOO_LOW');
      const cities = Object.values(state.cities).filter((c) => c.owner === target);
      const cost = annexCost(cities.length, Object.values(state.cities).filter((c) => c.owner === nationId).length);
      if (nation.influence < cost) return fail('NOT_ENOUGH_INFLUENCE');
      nation.influence -= cost;
      for (const c of cities) { c.owner = nationId; c.capital = false; c.occupiedUntil = state.turn + INTEGRATION_TURNS; }
      for (let cell = 0; cell < map.size; cell += 1) if (state.owner[cell] === target) state.owner[cell] = nationId;
      people.alive = false;
      pushEvent(state, 'annexed', { nation: nation.name, people: people.name });
      return ok();
    }
    case 'negotiate': {
      if (!isMajor(state, target) || target === nationId) return fail('UNKNOWN_NATION');
      if (!nation.met.includes(target)) return fail('NOT_MET');
      const deal = normalizeDeal(command.deal);
      const blocker = dealBlocker(state, nationId, target, deal);
      if (blocker) return fail(blocker);
      if (state.nations[target].human) return queueOffer(state, nationId, target, 'deal', deal);
      const verdict = evaluateDeal(state, target, nationId, deal);
      if (verdict.accept) {
        const failed = executeDeal(state, map, nationId, target, deal);
        if (failed) return fail(failed);
        return ok({ reply: say(state, target, 'acceptDeal', { target: nation.name }) });
      }
      const counter = counterOffer(state, target, nationId, deal, verdict.score);
      if (counter) return { ok: false, error: 'COUNTER', counter, reply: say(state, target, 'counter', { target: nation.name }) };
      return { ok: false, error: 'REJECTED', reply: say(state, target, 'rejectDeal', { target: nation.name }) };
    }
    case 'demand': {
      if (!isMajor(state, target) || target === nationId) return fail('UNKNOWN_NATION');
      if (!nation.met.includes(target)) return fail('NOT_MET');
      if (atWar(state, nationId, target)) return fail('ALREADY_AT_WAR');
      const demandBlocked = demandBlocker(state, nationId, target);
      if (demandBlocked) return fail(demandBlocked);
      const take = normalizeSide(command.take);
      take.treaties = []; take.peace = false; take.joinWar = null;
      if (isEmptySide(take)) return fail('EMPTY_DEAL');
      const blocker = sideBlocker(state, target, nationId, take);
      if (blocker) return fail(blocker);
      if (state.nations[target].human) {
        state.lastDemand[`${nationId}>${target}`] = state.turn;
        nation.demandLog = (nation.demandLog ?? []).filter((t) => state.turn - t < 30);
        changeReputation(state, nationId, -5 * (1 + nation.demandLog.length));
        nation.demandLog.push(state.turn);
        return queueOffer(state, nationId, target, 'demand', { give: normalizeSide({}), take });
      }
      const result = makeDemand(state, map, nationId, target, take);
      return { ok: true, ...result };
    }
    case 'spy': {
      if (!isMajor(state, target)) return fail('UNKNOWN_NATION');
      const third = typeof command.third === 'string' ? command.third : null;
      return runOperation(state, map, nationId, command.op, target, third);
    }
    case 'odds': {
      // прогноз боя без изменений партии: как окно шансов в Civilization
      const e = needUnit(); if (e) return e;
      return combatPreview(state, map, unit, command.to);
    }
    case 'nuke': {
      const e = needUnit(); if (e) return e;
      return launchNuke(state, map, nationId, unit, command.to);
    }
    case 'dismantle': {
      const e = needUnit(); if (e) return e;
      return dismantle(state, nationId, unit);
    }
    case 'recon': {
      const e = needUnit(); if (e) return e;
      return orbitalRecon(state, map, nationId, unit, command.to);
    }
    case 'choosePath':
      return choosePath(state, nationId, command.path);
    case 'contribute':
      return contribute(state, nationId, command);
    default:
      return fail('BAD_COMMAND');
  }
}

export const NEUTRAL_TRADE_RELATION = 10;

/** Нейтральный народ соглашается только на торговлю: так можно получить его ресурсы. */
function proposeToNeutral(state, map, nation, target, type) {
  const people = state.neutrals[target];
  if (!people?.alive) return fail('UNKNOWN_NATION');
  if (type !== 'trade') return fail('REJECTED');
  const known = Object.values(state.cities).some((c) => c.owner === target && state.explored[nation.id][c.cell]);
  if (!known) return fail('NOT_MET');
  if (treatyBetween(state, nation.id, target, 'trade')) return fail('TREATY_EXISTS');
  if (atWar(state, nation.id, target)) return fail('ALREADY_AT_WAR');
  if (relation(state, nation.id, target) < NEUTRAL_TRADE_RELATION) return fail('RELATION_TOO_LOW');
  const cost = treatyInfluenceCost(state, nation.id, 'trade');
  if (nation.influence < cost) return fail('NOT_ENOUGH_INFLUENCE');
  nation.influence -= cost;
  addTreaty(state, nation.id, target, 'trade');
  return ok();
}

const OFFER_TITLES = { peace: 'мир', deal: 'сделку', demand: 'ультиматум' };

function queueOffer(state, from, to, type, deal = null) {
  if (state.offers.some((o) => o.from === from && o.to === to && o.type === type)) return ok({ queued: true, duplicate: true });
  const id = `o${state.turn}-${from}-${type}`;
  const situation = type === 'demand' ? 'demandMade' : 'greet';
  state.offers.push({ id, from, to, type, turn: state.turn, deal, reply: say(state, from, situation, { target: nameOf(state, to) }) });
  pushEvent(state, 'offer', { from: nameOf(state, from), treaty: OFFER_TITLES[type] ?? TREATY_NAMES[type] }, [to]);
  return ok({ queued: true });
}
