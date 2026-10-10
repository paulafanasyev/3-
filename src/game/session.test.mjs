import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSession } from './session.js';

function harness() {
  const sent = [];
  const session = createGameSession({ send: (m) => sent.push(m), now: () => 1_000_000 });
  return { sent, session };
}

test('game:new создаёт партию и шлёт снимок для игрока', () => {
  const { sent, session } = harness();
  assert.equal(session.handle({ type: 'game:new', seed: 7, setup: { player: 'meridian' } }), true);
  const m = sent.at(-1);
  assert.equal(m.type, 'game:state');
  assert.equal(m.state.nationId, 'meridian');
  assert.equal(m.state.turn, 1);
  assert.ok(m.state.units.every((u) => u.owner === 'meridian' || m.state.visible.includes(u.cell)));
  assert.ok(m.state.events.length >= 1);
});

test('команды валидируются и отвечают с requestId и русским текстом ошибки', () => {
  const { sent, session } = harness();
  session.handle({ type: 'game:command', requestId: 'r0', command: { kind: 'research', tech: 'writing' } });
  assert.deepEqual(sent.at(-1), { type: 'game:command:result', requestId: 'r0', ok: false, error: 'NO_GAME', message: 'Партия не начата' });
  session.handle({ type: 'game:new', seed: 7 });
  session.handle({ type: 'game:command', requestId: 'r1', command: { kind: 'research', tech: 'rocketry' } });
  assert.equal(sent.at(-1).error, 'TECH_UNAVAILABLE');
  session.handle({ type: 'game:command', requestId: 'r2', command: { kind: 'research', tech: 'writing' } });
  const result = sent.find((m) => m.requestId === 'r2');
  assert.equal(result.ok, true);
  assert.equal(sent.at(-1).type, 'game:state', 'после успешной команды приходит новый снимок');
});

test('game:endTurn продвигает ход и шлёт только новые события', () => {
  const { sent, session } = harness();
  session.handle({ type: 'game:new', seed: 7 });
  const first = sent.at(-1).state.events.map((e) => e.seq);
  session.handle({ type: 'game:endTurn' });
  const state = sent.at(-1).state;
  assert.equal(state.turn, 2);
  assert.ok(state.events.every((e) => !first.includes(e.seq)));
});

test('плохие настройки, остановка и неизвестные сообщения', () => {
  const { sent, session } = harness();
  session.handle({ type: 'game:new', seed: 1, setup: { custom: { name: 'X' } } });
  assert.equal(sent.at(-1).type, 'game:error');
  session.handle({ type: 'game:new', seed: 1 });
  session.handle({ type: 'game:stop' });
  assert.deepEqual(sent.at(-1), { type: 'game:stopped' });
  assert.equal(session.game, null);
  assert.equal(session.handle({ type: 'game:unknown' }), false);
});
