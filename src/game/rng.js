// Детерминированный ГПСЧ (mulberry32), перенесён из PR #2 (src/nuclear/rng.js).
// Состояние живёт в объекте игры, поэтому партия воспроизводится по сиду.
export function nextRandom(state) {
  state.rng = (state.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Целое в [0, n). */
export function randomInt(state, n) {
  return Math.floor(nextRandom(state) * n);
}

/** Случайный элемент массива (детерминированно). */
export function pick(state, items) {
  return items[randomInt(state, items.length)];
}

/** Перемешивание Фишера–Йетса на месте. */
export function shuffle(state, items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(state, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Нормализует произвольный сид в 32-битное целое. */
export function seedToInt(seed) {
  if (Number.isInteger(seed)) return seed | 0;
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h | 0;
}
