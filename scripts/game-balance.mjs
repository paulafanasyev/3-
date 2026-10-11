#!/usr/bin/env node
// Прогон баланса: партии «ИИ против ИИ» (игрок тоже под управлением ИИ).
//   node scripts/game-balance.mjs --games 100
import { parseArgs } from 'node:util';
import { createGame } from '../src/game/state.js';
import { endTurn } from '../src/game/turn.js';
import { loadMap } from '../src/game/map.js';
import { NATIONS } from '../src/game/data/nations.js';

export function autoplay(seed, { maxTurns = 400, player = 'borea' } = {}) {
  const map = loadMap();
  const state = createGame({ seed, setup: { player }, map });
  const human = state.nations[state.player];
  human.human = false;
  human.ai = NATIONS.find((n) => n.id === state.player).ai;
  while (state.status === 'running' && state.turn <= maxTurns) endTurn(state, map);
  return state;
}

function main() {
  const { values } = parseArgs({ options: { games: { type: 'string', default: '20' }, start: { type: 'string', default: '1' } } });
  const games = Number(values.games);
  const stats = { finale: 0, outcomes: {}, winners: {}, endings: {}, detected: [], wars: 0, cities: [], eras: [], ms: [] };
  for (let g = 0; g < games; g += 1) {
    const t0 = Date.now();
    const s = autoplay(Number(values.start) + g);
    stats.ms.push(Date.now() - t0);
    if (s.finale.detectedTurn) { stats.finale += 1; stats.detected.push(s.finale.detectedTurn); }
    const outcome = s.result?.outcome ?? s.result?.ending ?? 'none';
    stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1;
    const w = s.result?.winner ?? 'none';
    stats.winners[w] = (stats.winners[w] ?? 0) + 1;
    stats.cities.push(Object.values(s.cities).filter((c) => !c.owner.startsWith('p')).length);
    stats.eras.push(Object.values(s.nations).map((n) => n.era).join(''));
    if (s.events.some((e) => e.key === 'war')) stats.wars += 1;
    console.log(`#${g + 1} seed=${Number(values.start) + g} turn=${s.turn} result=${JSON.stringify(s.result)} detected=${s.finale.detectedTurn} paths=${Object.values(s.nations).map((n) => `${n.id}:${n.finale.path}`).join(',')} ms=${stats.ms.at(-1)}`);
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  console.log(JSON.stringify({ games, finaleRate: stats.finale / games, outcomes: stats.outcomes, winners: stats.winners, avgDetect: avg(stats.detected), avgMajorCities: avg(stats.cities), gamesWithWar: stats.wars, avgMs: avg(stats.ms) }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
