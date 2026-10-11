// Сценарий «battle» для дымовой проверки: бой открывается первой же командой.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSession } from './session.js';
import { battleScenario } from './scenarios.js';

for (const player of ['auris', 'borea']) {
  test(`сценарий battle (${player}): рядом враг, бой начинается сразу`, () => {
    const sent = []; let placed = null;
    const timers = { setInterval: () => 1, clearInterval: () => {} };
    const session = createGameSession({ send: (m) => sent.push(m), timers, onNewGame: (g, m) => { placed = battleScenario(g, m); } });
    session.handle({ type: 'game:new', seed: 7, setup: { player } });
    assert.ok(placed, 'пара клеток не найдена');
    const first = sent.find((m) => m.type === 'game:state');
    assert.ok(first.state.units.some((u) => u.id === placed.unitId), 'танк есть в первом снимке');
    assert.ok(first.state.units.some((u) => u.cell === placed.to && u.owner !== first.state.nationId), 'враг виден в первом снимке');
    session.handle({ type: 'game:command', requestId: 'b', command: { kind: 'battle', unitId: placed.unitId, to: placed.to } });
    const r = sent.find((m) => m.requestId === 'b');
    assert.equal(r.ok, true, r.message);
    assert.ok(r.battle, 'сервер вернул поле боя');
  });
}

test('без onNewGame партия как раньше', () => {
  const sent = [];
  const session = createGameSession({ send: (m) => sent.push(m) });
  session.handle({ type: 'game:new', seed: 7, setup: { player: 'auris' } });
  assert.ok(!Object.values(session.game.units).some((u) => u.type === 'tank'));
});
