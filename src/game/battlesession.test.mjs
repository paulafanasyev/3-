// Часы тактического боя на сервере: кадры приходят сами, пауза и скорость, итог закрывает часы.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSession, BATTLE_FRAME_MS } from './session.js';
import { addUnit } from './state.js';
import { pairKey } from './rules.js';

function setup() {
  let t = 0; const sent = []; let tick = null;
  const timers = { setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } };
  const session = createGameSession({ send: (m) => sent.push(m), now: () => t, timers });
  session.handle({ type: 'game:new', seed: 7, setup: { player: 'auris' } });
  const s = session.game; const map = session.map;
  let a = null; let d = null;
  for (let c = 0; c < s.owner.length && d === null; c += 1) {
    if (s.cityAt[c] || s.owner[c] || s.unitsByCell[c]?.length) continue;
    for (const n of map.neighbors[c]) if (!s.cityAt[n] && !s.owner[n] && !s.unitsByCell[n]?.length && map.terrain[n] === 'P' && map.terrain[c] === 'P') { a = c; d = n; break; }
  }
  s.wars.push(pairKey('auris', 'borea'));
  const u = addUnit(s, 'auris', 'tank', a); u.moves = 3;
  addUnit(s, 'borea', 'warrior', d);
  session.handle({ type: 'game:command', requestId: 'b', command: { kind: 'battle', unitId: u.id, to: d } });
  return { sent, session, step: (ms) => { t += ms; tick?.(); }, running: () => Boolean(tick) };
}

test('после начала боя сервер сам шлёт кадры, без опроса клиента', () => {
  const { sent, step, running } = setup();
  assert.equal(running(), true);
  const before = sent.length;
  step(BATTLE_FRAME_MS); step(BATTLE_FRAME_MS); step(BATTLE_FRAME_MS);
  const frames = sent.slice(before).filter((m) => m.type === 'game:battle');
  assert.ok(frames.length >= 1);
  assert.ok(frames.at(-1).battle.tick >= 1);
  assert.equal(frames.at(-1).battle.terrain, null); // рельеф шлётся только в начале боя
});

test('пауза останавливает время боя, скорость ×4 ускоряет', () => {
  const { sent, session, step } = setup();
  session.handle({ type: 'game:battleSpeed', speed: 0 });
  const n = sent.length; step(1000);
  assert.equal(sent.slice(n).filter((m) => m.type === 'game:battle').length, 0);
  session.handle({ type: 'game:battleSpeed', speed: 4 });
  step(500);
  const f = sent.filter((m) => m.type === 'game:battle').at(-1);
  assert.ok(f.battle.tick >= 9, `тиков: ${f.battle.tick}`); // 0,5 с × 4 / 0,2 с = 10 тиков
});

test('итог боя останавливает часы и рассылает снимок карты', () => {
  const { sent, step, running } = setup();
  for (let i = 0; i < 2000 && running(); i += 1) step(1000);
  assert.equal(running(), false);
  const fin = sent.find((m) => m.type === 'game:battle' && m.finished);
  assert.ok(fin);
  assert.ok(sent.indexOf(fin) < sent.length - 1 && sent.at(-1).type === 'game:state');
});
