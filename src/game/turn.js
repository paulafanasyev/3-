// Конец хода: ИИ, экономика, рост, производство, наука, движение, дипломатия,
// финал и проверка победы. Порядок обхода фиксирован, поэтому результат
// детерминирован.
import { UNITS } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { TECHS } from './data/techs.js';
import { grantTech } from './events.js';
import { DOCTRINES } from './data/nations.js';
import { loadMap } from './map.js';
import { addUnit, pushEvent, updateExplored, claimAround } from './state.js';
import {
  cityYield, growthThreshold, itemCost, itemBlocker, techCost, isNeutralId, visibleCells, majorIds, PROJECTS,
} from './rules.js';
import { advanceUnit } from './commands.js';
import { diplomacyTick } from './diplomacy.js';
import { memoryTick } from './leaders.js';
import { threatTick } from './negotiation.js';
import { maybeDetect, finaleTick, resolveImpact, addShield, addContribution } from './finale.js';
import { runAi } from './ai.js';
import { isWater } from './data/terrain.js';

export const MAX_TURNS = 230;
export const SHIELD_TECH_BONUS = 0.5; // «Планетарный щит» даёт +50% к вкладу производства в щит
export const UNIT_UPKEEP_FREE_PER_CITY = 2;

const sortedValues = (obj) => Object.keys(obj).sort().map((k) => obj[k]);

function citiesOf(state, owner) {
  return sortedValues(state.cities).filter((c) => c.owner === owner);
}

function spawnCell(state, map, city, unitType) {
  const domain = UNITS[unitType].domain;
  const options = [city.cell, ...map.neighbors[city.cell]];
  for (const cell of options) {
    const water = isWater(map.terrain[cell]);
    if (domain === 'sea' && !water && cell !== city.cell) continue;
    if (domain === 'land' && water) continue;
    const occupants = (state.unitsByCell[cell] ?? []).map((id) => state.units[id]);
    if (occupants.some((u) => u.owner !== city.owner)) continue;
    const civilian = UNITS[unitType].civilian;
    if (occupants.filter((u) => Boolean(UNITS[u.type].civilian) === Boolean(civilian)).length === 0 || domain === 'space') return cell;
  }
  return null;
}

function processCity(state, map, city, nation, totals) {
  const y = cityYield(state, map, city);
  totals.gold += y.gold;
  totals.science += y.science;
  totals.influence += 1;
  // рост
  city.food += y.food - y.upkeep;
  if (city.food >= growthThreshold(city.pop)) {
    city.food -= growthThreshold(city.pop);
    city.pop = Math.min(20, city.pop + 1);
    if (city.pop === 5) claimAround(state, map, city.cell, city.owner, 2);
    else claimAround(state, map, city.cell, city.owner, city.pop >= 5 ? 2 : 1);
  } else if (city.food < 0) {
    if (city.pop > 1) city.pop -= 1;
    city.food = 0;
  }
  city.hp = Math.min(100, city.hp + 10);
  // производство
  const item = city.queue[0];
  if (!item) return;
  if (itemBlocker(state, map, city, item)) { city.queue.shift(); return; }
  if (item.kind === 'dome') {
    const shieldTech = nation.techs.includes('shield') ? SHIELD_TECH_BONUS : 0;
    addShield(state, city.owner, y.prod * (1 + (DOCTRINES[nation.doctrine].domeBonus ?? 0) + shieldTech));
    return;
  }
  if (item.kind === 'project') {
    if (item.id === 'science') totals.science += y.prod * PROJECTS.science.rate;
    else totals.gold += y.prod * PROJECTS.gold.rate;
    return;
  }
  city.prod += y.prod;
  const cost = itemCost(state, map, city, item);
  if (city.prod < cost) return;
  if (item.kind === 'unit') {
    const cell = spawnCell(state, map, city, item.id);
    if (cell === null) return; // ждём, пока освободится место
    const unit = addUnit(state, city.owner, item.id, cell);
    if (city.buildings.includes('barracks') && UNITS[item.id].str > 0) unit.vet = 1;
    if (state.finale.detectedTurn && nation.finale.path === 'pact' && (item.id === 'interceptor' || item.id === 'satellite')) {
      addContribution(state, city.owner, (UNITS[item.id].cost + cost) / 2, 'launches'); // середина между базовой и фактической ценой: экватор помогает, но не решает всё
    }
    if (item.id === 'settler' && city.pop > 1) city.pop -= 1;
  } else {
    city.buildings.push(item.id);
    pushEvent(state, 'built', { city: city.name, item: BUILDINGS[item.id].name }, [city.owner]);
  }
  city.prod -= cost;
  city.queue.shift();
}

function processNation(state, map, nation) {
  const totals = { gold: 0, science: 0, influence: 0 };
  for (const city of citiesOf(state, nation.id)) processCity(state, map, city, nation, totals);
  const doctrine = DOCTRINES[nation.doctrine];
  totals.influence += doctrine.influence ?? 0;
  // торговля: +1 золото за город партнёра (до 6)
  for (const t of state.treaties) {
    if (t.type !== 'trade' || (t.a !== nation.id && t.b !== nation.id)) continue;
    const partner = t.a === nation.id ? t.b : t.a;
    totals.gold += Math.min(6 + (doctrine.tradeRoutes ?? 0), citiesOf(state, partner).length);
  }
  const units = Object.values(state.units).filter((u) => u.owner === nation.id && UNITS[u.type].domain !== 'space').length;
  const upkeep = Math.max(0, units - citiesOf(state, nation.id).length * UNIT_UPKEEP_FREE_PER_CITY);
  nation.gold = Math.max(0, nation.gold + totals.gold - upkeep);
  nation.influence += totals.influence;
  nation.sciencePool += totals.science;
  if (nation.research) {
    const cost = techCost(state, nation.id, nation.research);
    if (nation.sciencePool >= cost) {
      nation.sciencePool -= cost;
      const tech = nation.research;
      pushEvent(state, 'techLearned', { nation: nation.name, tech: TECHS[tech].name }, nation.human ? [nation.id] : 'all');
      grantTech(state, nation, tech);
    }
  }
}

function refreshUnits(state, map) {
  for (const unit of sortedValues(state.units)) {
    const def = UNITS[unit.type];
    unit.moves = def.moves;
    const home = state.owner[unit.cell] === unit.owner;
    unit.hp = Math.min(100, unit.hp + (home ? 20 : 10));
  }
  for (const unit of sortedValues(state.units)) {
    if (state.units[unit.id] && unit.goal !== null && unit.goal !== undefined) advanceUnit(state, map, unit);
  }
}

function updateContacts(state, map) {
  const ids = majorIds(state).filter((id) => state.nations[id].alive);
  for (const id of ids) {
    const seen = visibleCells(state, map, id);
    for (const other of ids) {
      if (other === id || state.nations[id].met.includes(other)) continue;
      let contact = false;
      for (const cell of seen) {
        if (state.owner[cell] === other || (state.unitsByCell[cell] ?? []).some((u) => state.units[u].owner === other)) { contact = true; break; }
      }
      if (contact) {
        state.nations[id].met.push(other);
        state.nations[id].met.sort();
        if (!state.nations[other].met.includes(id)) { state.nations[other].met.push(id); state.nations[other].met.sort(); }
        pushEvent(state, 'met', { a: state.nations[id].name, b: state.nations[other].name }, [id, other]);
      }
    }
  }
}

function checkVictory(state) {
  if (state.status !== 'running') return;
  const ids = majorIds(state);
  const player = state.nations[state.player];
  if (!player.alive) {
    state.status = 'over';
    state.result = { ending: 'defeat', winner: null };
    return;
  }
  // досрочная победа: все исходные столицы в руках одной нации
  for (const id of ids) {
    const n = state.nations[id];
    if (!n.alive) continue;
    const rivals = ids.filter((x) => x !== id);
    const allTaken = rivals.every((x) => {
      // считаются исходные столицы: новая столица из уцелевшего поселенца цель не меняет
      const capId = state.nations[x].originalCapital;
      return !state.nations[x].alive || (capId && state.cities[capId]?.owner === id);
    });
    if (allTaken && rivals.some((x) => state.nations[x].originalCapital)) {
      state.status = 'over';
      state.result = { ending: id === state.player ? 'conquest' : 'defeat', winner: id };
      pushEvent(state, 'conquest', { nation: n.name });
      return;
    }
  }
}

export function endTurn(state, map = loadMap()) {
  if (state.status !== 'running') return state;
  for (const id of majorIds(state)) {
    const n = state.nations[id];
    if (n.alive && !n.human) runAi(state, map, id);
  }
  for (const id of majorIds(state)) {
    const n = state.nations[id];
    if (n.alive) processNation(state, map, n);
  }
  // нейтральные города растут медленно и восстанавливаются
  for (const city of sortedValues(state.cities)) {
    if (!isNeutralId(city.owner)) continue;
    city.hp = Math.min(100, city.hp + 15);
    if (state.turn % 30 === 0 && city.pop < 8) city.pop += 1;
  }
  refreshUnits(state, map);
  updateContacts(state, map);
  diplomacyTick(state, map);
  memoryTick(state);
  threatTick(state);
  maybeDetect(state, map);
  finaleTick(state);
  updateExplored(state, map);
  const impact = resolveImpact(state, map);
  if (impact) {
    state.status = 'over';
    state.result = { ending: impact.ending, outcome: impact.outcome, winner: impact.winner, defense: impact.defense, contributions: impact.contributions };
    return state;
  }
  checkVictory(state);
  state.turn += 1;
  if (state.status === 'running' && state.turn > MAX_TURNS) {
    state.status = 'over';
    state.result = { ending: 'silence', winner: null };
  }
  return state;
}
