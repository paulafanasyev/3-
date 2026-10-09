// Deterministic PRNG (mulberry32). State lives on the game object so a game
// replays identically from its seed.
export function nextRandom(state) {
  state.rng = (state.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
