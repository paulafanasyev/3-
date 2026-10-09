import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSession } from './session.js';

function harness() {
  const sent = [];
  const clock = { value: 1_000_000 };
  const timers = { fn: null };
  const session = createGameSession({
    send: (message) => sent.push(message),
    now: () => clock.value,
    setIntervalFn: (fn) => {
      timers.fn = fn;
      return 1;
    },
    clearIntervalFn: () => {
      timers.fn = null;
    },
  });
  return { sent, clock, timers, session };
}

test('game:new starts a game and sends a fogged snapshot for the player', () => {
  const { sent, session, timers } = harness();
  assert.equal(session.handle({ type: 'game:new', seed: 7 }), true);
  const message = sent.at(-1);
  assert.equal(message.type, 'game:state');
  assert.equal(message.state.defcon, 5);
  assert.equal(message.state.side, 'blue');
  assert.ok(message.state.units.every((u) => u.side === 'blue' || u.type === 'warning_satellite'));
  assert.equal(typeof timers.fn, 'function');
  session.dispose();
  assert.equal(timers.fn, null);
});

test('commands are validated and answered with the request id', () => {
  const { sent, session } = harness();
  session.handle({ type: 'game:command', requestId: 'r0', command: { kind: 'launch' } });
  assert.deepEqual(sent.at(-1), { type: 'game:command:result', requestId: 'r0', ok: false, error: 'NO_GAME' });
  session.handle({ type: 'game:new', seed: 7 });
  const silo = sent.at(-1).state.units.find((u) => u.type === 'icbm_silo');
  session.handle({ type: 'game:command', requestId: 'r1', command: { kind: 'launch', unitId: silo.id, lat: 0, lon: 0 } });
  assert.deepEqual(sent.at(-1), { type: 'game:command:result', requestId: 'r1', ok: false, error: 'DEFCON_TOO_HIGH' });
  session.dispose();
});

test('ticks advance game time and only stream new events', () => {
  const { sent, session, clock, timers } = harness();
  session.handle({ type: 'game:new', seed: 7 });
  assert.ok(sent.at(-1).state.events.length >= 1);
  clock.value += 1000;
  timers.fn();
  const state = sent.at(-1).state;
  assert.equal(state.time, 1);
  assert.equal(state.events.length, 0);
  session.dispose();
});

test('civilian points from the live layer are sanitized and capped', () => {
  const { sent, session } = harness();
  session.handle({ type: 'game:civilians', points: [[10, 20], [100, 0], { lat: 1, lon: 2 }, null] });
  assert.deepEqual(sent.at(-1), { type: 'game:civilians:ok', count: 2 });
  assert.equal(session.handle({ type: 'game:unknown' }), false);
});
