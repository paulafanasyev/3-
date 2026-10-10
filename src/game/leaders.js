// Лидеры: память об обидах и услугах, отношение к другим нациям и реплики.
// Реплики выбираются детерминированным хешем, а не rng, чтобы разговоры
// не сдвигали случайность партии.
import { LEADERS, customLeader } from './data/leaders.js';
import { LEADER_LINES } from './i18n/ru.js';
import { relation, isNeutralId } from './rules.js';

export const MOODS = Object.freeze([
  { min: -Infinity, id: 'hostile', name: 'враждебность' },
  { min: -40, id: 'cold', name: 'холодность' },
  { min: -10, id: 'neutral', name: 'сдержанность' },
  { min: 15, id: 'warm', name: 'дружелюбие' },
  { min: 45, id: 'friend', name: 'близкий союзник' },
]);

const key = (judge, other) => `${judge}>${other}`;

/** Насколько верят угрозам нации `id`: падает за каждый раскрытый блеф. */
export function credibility(state, id) {
  const n = state.nations[id];
  return Math.max(0.2, 1 - 0.25 * (n?.bluffsCalled ?? 0));
}

export function makeLeader(nationId, custom = null) {
  if (custom) return customLeader(custom.leaderName || `Глава ${custom.name}`);
  return structuredClone(LEADERS[nationId]);
}

export function traits(state, id) {
  return state.nations[id]?.leader?.traits ?? customLeader().traits;
}

/** Воинственность лидера: характер нации плюс гордость, минус осторожность. */
export function aggressionOf(state, id) {
  const n = state.nations[id];
  const t = traits(state, id);
  return Math.max(0, Math.min(1, (n.ai?.aggression ?? 0.4) + (t.pride - 0.5) * 0.3 - (t.caution - 0.5) * 0.3));
}

function entry(state, judge, other) {
  state.memory ??= {};
  return (state.memory[key(judge, other)] ??= { grievance: 0, favor: 0, log: [] });
}

/** Запомнить обиду или услугу. `kind`: 'grievance' | 'favor'. */
export function remember(state, judge, other, kind, amount, reason) {
  if (!state.nations[judge] || !state.nations[other] || judge === other) return;
  const e = entry(state, judge, other);
  e[kind] = Math.min(200, e[kind] + amount);
  e.log.push({ turn: state.turn, kind, amount: Math.round(amount), reason });
  if (e.log.length > 12) e.log.shift();
}

export function memoryOf(state, judge, other) {
  return state.memory?.[key(judge, other)] ?? { grievance: 0, favor: 0, log: [] };
}

/** Отношение лидера: общие отношения наций плюс личная память. */
export function attitude(state, judge, other) {
  const base = relation(state, judge, other);
  if (isNeutralId(judge) || isNeutralId(other) || !state.nations[judge]) return base;
  const m = memoryOf(state, judge, other);
  const t = traits(state, judge);
  // репутация собеседника: честный лидер смотрит на неё внимательнее
  const rep = ((state.nations[other]?.reputation ?? 50) - 50) * (0.25 + 0.25 * t.honor);
  return base + rep + m.favor * 0.4 - m.grievance * (0.4 + 0.4 * t.memory);
}

export function moodOf(value) {
  let mood = MOODS[0];
  for (const m of MOODS) if (value >= m.min) mood = m;
  return mood;
}

/** Обиды забываются со скоростью, обратной злопамятности; услуги — быстрее. */
export function memoryTick(state) {
  for (const [k, e] of Object.entries(state.memory ?? {})) {
    const judge = k.split('>')[0];
    const t = traits(state, judge);
    e.grievance *= 1 - 0.03 * (1 - t.memory);
    e.favor *= 0.98;
    if (e.grievance < 0.5) e.grievance = 0;
    if (e.favor < 0.5) e.favor = 0;
  }
}

function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Какие черты сильнее звучат в каждой ситуации (тон выбирается по взвешенной черте). */
export const SITUATION_WEIGHTS = Object.freeze({
  greet: {},
  acceptDeal: { greed: 1.3, honor: 1.1 },
  rejectDeal: { pride: 1.2, greed: 1.1 },
  counter: { greed: 1.4, cunning: 1.2 },
  demandMade: { pride: 1.3, cunning: 1.1 },
  demandAccept: { caution: 1.5, cunning: 1.1 },
  demandRefuse: { pride: 1.4, honor: 1.2 },
  plotExposed: { honor: 1.3, pride: 1.2 },
});

/** Ведущая черта лидера для выбора тона реплики в ситуации `situation`. */
export function dominantTone(t, situation = 'greet') {
  const w = SITUATION_WEIGHTS[situation] ?? {};
  const k = (name) => t[name] * (w[name] ?? 1);
  const options = [['pride', k('pride')], ['greed', k('greed')], ['honor', k('honor')], ['cunning', k('cunning')], ['caution', k('caution')]];
  options.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return options[0][0];
}

/** Реплика лидера `speaker` для ситуации; `params` подставляются в текст. */
export function say(state, speaker, situation, params = {}) {
  const n = state.nations[speaker];
  if (!n?.leader) return null;
  const lines = LEADER_LINES[situation];
  if (!lines) return null;
  const tone = dominantTone(n.leader.traits, situation);
  const pool = lines[tone] ?? lines.any;
  const text = pool[hash(speaker, situation, state.turn, params.target ?? '') % pool.length];
  return {
    speaker,
    leader: n.leader.name,
    portrait: n.leader.portrait,
    situation,
    text: text.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? ''),
  };
}
