// Интриги и заговоры. Тайная операция стоит влияния и золота, может удаться
// или провалиться и отдельно может быть раскрыта. Раскрытие бьёт по репутации,
// оставляет обиду у лидера и даёт жертве повод к войне (casus belli).
import { nextRandom } from './rng.js';
import { TECHS } from './data/techs.js';
import { pushEvent, nameOf, own, techLearnable, grantTech } from './events.js';
import { changeRelation, changeReputation, removeTreaty } from './diplomacy.js';
import { remember, traits, say } from './leaders.js';
import { cityYield, isNeutralId, pairKey, treatyBetween } from './rules.js';

export const OPS = Object.freeze({
  stealTech: { name: 'Кража технологии', influence: 25, gold: 40, base: 0.45, exposure: 0.35 },
  sabotage: { name: 'Саботаж', influence: 20, gold: 30, base: 0.55, exposure: 0.3 },
  incite: { name: 'Подстрекательство народа', influence: 15, gold: 40, base: 0.6, exposure: 0.25 },
  falseFlag: { name: 'Операция под чужим флагом', influence: 35, gold: 50, base: 0.4, exposure: 0.4 },
  smear: { name: 'Кампания очернения', influence: 15, gold: 20, base: 0.6, exposure: 0.3 },
});

export const CASUS_BELLI_TURNS = 15;
export const EXPOSED_REPUTATION = 15;
export const OP_COOLDOWN = 3;
export const SABOTAGE_IMMUNITY = 10; // город после саботажа под усиленной охраной

/** Контрразведка цели: сервер-кластеры, исследовательские центры и хитрость лидера. */
export function counterIntel(state, target) {
  let level = traits(state, target).cunning * 0.15;
  const cities = Object.values(state.cities).filter((c) => c.owner === target);
  const datacenters = cities.filter((c) => c.buildings.includes('datacenter')).length;
  const research = cities.filter((c) => c.buildings.includes('research')).length;
  level += Math.min(0.2, datacenters * 0.04) + Math.min(0.1, research * 0.02);
  return level;
}

export function opChances(state, actor, target, op) {
  const def = OPS[op];
  const skill = traits(state, actor).cunning * 0.2 + (state.nations[actor].era - state.nations[target].era) * 0.05;
  const defense = counterIntel(state, target);
  const success = Math.max(0.05, Math.min(0.9, def.base + skill - defense));
  const exposure = Math.max(0.05, Math.min(0.9, def.exposure + defense - skill * 0.5));
  return { success, exposure };
}

export function hasCasusBelli(state, victim, culprit) {
  return (state.casusBelli?.[`${victim}>${culprit}`] ?? 0) >= state.turn;
}

/** Проверка операции без выполнения: код ошибки или null. */
export function opBlocker(state, actor, op, target, third) {
  const a = state.nations[actor];
  if (!own(OPS, op)) return 'BAD_COMMAND';
  const def = OPS[op];
  if (!own(state.nations, target) || target === actor || !state.nations[target].alive) return 'UNKNOWN_NATION';
  if (!a.met.includes(target)) return 'NOT_MET';
  if (a.influence < def.influence) return 'NOT_ENOUGH_INFLUENCE';
  if (a.gold < def.gold) return 'NOT_ENOUGH_GOLD';
  if ((a.lastOpTurn ?? -99) + OP_COOLDOWN > state.turn) return 'AGENTS_BUSY';
  if (op === 'falseFlag' && (!own(state.nations, third) || third === actor || third === target || !a.met.includes(third))) return 'UNKNOWN_NATION';
  if (op === 'incite') {
    const people = own(state.neutrals, third) ? state.neutrals[third] : null;
    if (!people?.alive) return 'UNKNOWN_NATION';
  }
  if (op === 'stealTech' && !stealable(state, actor, target).length) return 'NOTHING_TO_STEAL';
  if (op === 'sabotage' && !sabotageTarget(state, null, target)) return 'NO_TARGET';
  return null;
}

function stealable(state, actor, target) {
  const a = state.nations[actor];
  return state.nations[target].techs.filter((t) => techLearnable(a, t)).sort();
}

/** Цель саботажа: космодром или самый производительный город, кроме недавно атакованных. */
function sabotageTarget(state, map, target) {
  const cities = Object.values(state.cities)
    .filter((c) => c.owner === target && (c.sabotagedAt ?? -99) + SABOTAGE_IMMUNITY <= state.turn)
    .sort((x, y) => x.id.localeCompare(y.id));
  if (!map) return cities[0] ?? null;
  const port = cities.find((c) => c.buildings.includes('spaceport'));
  if (port) return port;
  return cities.sort((x, y) => cityYield(state, map, y).prod - cityYield(state, map, x).prod || x.id.localeCompare(y.id))[0] ?? null;
}

/**
 * Провести операцию. Возвращает { ok, success, exposed, effect, reply }.
 * `third` — нация для falseFlag или нейтральный народ для incite.
 */
export function runOperation(state, map, actor, op, target, third = null) {
  const blocker = opBlocker(state, actor, op, target, third);
  if (blocker) return { ok: false, error: blocker };
  const a = state.nations[actor];
  const def = OPS[op];
  a.influence -= def.influence;
  a.gold -= def.gold;
  a.lastOpTurn = state.turn;
  const chances = opChances(state, actor, target, op);
  const success = nextRandom(state) < chances.success;
  const exposed = nextRandom(state) < (success ? chances.exposure : Math.min(0.95, chances.exposure + 0.3));
  let effect = null;
  if (success) {
    if (op === 'stealTech') {
      const options = stealable(state, actor, target);
      const tech = options[Math.floor(nextRandom(state) * options.length)];
      grantTech(state, a, tech);
      effect = { tech };
    } else if (op === 'sabotage') {
      const city = sabotageTarget(state, map, target);
      if (city) {
        effect = { city: city.id, lost: Math.round(city.prod) };
        city.prod = 0;
        city.hp = Math.max(20, city.hp - 30);
        city.sabotagedAt = state.turn;
      }
    } else if (op === 'incite') {
      const people = state.neutrals[third];
      people.relations[target] = Math.max(-100, (people.relations[target] ?? 0) - 35);
      people.relations[actor] = Math.min(100, (people.relations[actor] ?? 0) + 10);
      // народ рвёт торговлю с целью: она теряет доступ к его ресурсам
      if (treatyBetween(state, target, third, 'trade') && people.relations[target] < 0) removeTreaty(state, target, third, 'trade');
      effect = { people: third };
    } else if (op === 'falseFlag') {
      changeRelation(state, target, third, -30);
      remember(state, target, third, 'grievance', 30, 'falseFlag');
      effect = { blamed: third };
    } else if (op === 'smear') {
      changeReputation(state, target, -10);
      effect = { reputation: -10 };
    }
  }
  if (exposed) {
    changeReputation(state, actor, -EXPOSED_REPUTATION);
    changeRelation(state, actor, target, -30);
    remember(state, target, actor, 'grievance', 25 + 30 * traits(state, target).honor, 'plot');
    state.casusBelli ??= {};
    state.casusBelli[`${target}>${actor}`] = state.turn + CASUS_BELLI_TURNS;
    if (op === 'falseFlag') {
      // подставленная нация узнаёт правду и тоже злится
      changeRelation(state, target, third, 30);
      remember(state, third, actor, 'grievance', 30, 'framed');
      state.casusBelli[`${third}>${actor}`] = state.turn + CASUS_BELLI_TURNS;
    }
    pushEvent(state, 'plotExposed', { actor: nameOf(state, actor), target: nameOf(state, target), op: def.name });
  } else if (success) {
    pushEvent(state, 'plotHidden', { target: nameOf(state, target), op: def.name }, [target]);
  }
  pushEvent(state, success ? 'plotSuccess' : 'plotFailed', { op: def.name, target: nameOf(state, target) }, [actor]);
  return {
    ok: true,
    success,
    exposed,
    effect,
    reply: exposed ? say(state, target, 'plotExposed', { target: nameOf(state, actor) }) : null,
  };
}

/** Война при наличии повода не стоит репутации и не злит соседей. */
export function justifiedWar(state, aggressor, target) {
  return !isNeutralId(target) && hasCasusBelli(state, aggressor, target);
}

export { pairKey };
