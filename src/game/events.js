// События партии и общие помощники без зависимостей от остальной логики.
// Вынесено отдельно, чтобы модули правил не импортировали state.js (нет циклов).
import { formatEvent } from './i18n/ru.js';
import { TECHS, ERAS, TECHS_TO_ADVANCE } from './data/techs.js';

export const EVENT_LIMIT = 400;

export function pushEvent(state, key, params = {}, audience = 'all', extra = {}) {
  state.eventSeq += 1;
  state.events.push({ seq: state.eventSeq, turn: state.turn, key, text: formatEvent(key, params), audience, ...extra });
  state.stats ??= {};
  state.stats[key] = (state.stats[key] ?? 0) + 1; // счётчики для итогового экрана и баланса
  if (state.events.length > EVENT_LIMIT) state.events.splice(0, state.events.length - EVENT_LIMIT);
}

export const isNeutral = (id) => typeof id === 'string' && id.startsWith('p');

export const nameOf = (state, id) => (isNeutral(id) ? state.neutrals[id]?.name : state.nations[id]?.name) ?? String(id);

/** Есть ли собственный (не унаследованный) ключ: защита от '__proto__', 'toString' и т. п. */
export const own = (obj, key) => typeof key === 'string' && obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key);

/** Может ли нация освоить технологию: своя эпоха и все предпосылки известны. */
export function techLearnable(nation, tech) {
  if (!own(TECHS, tech) || nation.techs.includes(tech)) return false;
  const t = TECHS[tech];
  return t.era <= nation.era && t.req.every((r) => nation.techs.includes(r));
}

/** Единственный способ дать нации технологию (исследование, сделка, кража). */
export function grantTech(state, nation, tech) {
  if (nation.techs.includes(tech)) return false;
  nation.techs.push(tech);
  if (nation.research === tech) nation.research = null;
  while (nation.era < ERAS.length - 1 && nation.techs.filter((t) => TECHS[t].era === nation.era).length >= TECHS_TO_ADVANCE) {
    nation.era += 1;
    pushEvent(state, 'eraReached', { nation: nation.name, era: ERAS[nation.era].name });
  }
  return true;
}
