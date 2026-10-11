import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRegistry, createSessionConnection } from './sessions.js';
import { addUnit } from './state.js';
import { loadMap } from './map.js';

const map = loadMap();

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closeCode: null,
    send(text) { this.sent.push(JSON.parse(text)); },
    close(code) { this.closeCode = code; this.readyState = 3; },
  };
}
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    timers: {
      setTimeout(fn) { const id = next++; pending.set(id, fn); return id; },
      clearTimeout(id) { pending.delete(id); },
    },
    fireAll() { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    get size() { return pending.size; },
  };
}
function setup() {
  const clock = fakeTimers();
  const registry = createSessionRegistry({ now: () => 1000, ttlMs: 100, max: 3, timers: clock.timers, makeToken: (() => { let i = 0; return () => `token-${++i}`; })() });
  return { registry, clock };
}
function newConnection(registry) {
  const ws = socket();
  const connection = createSessionConnection({ socket: ws, registry });
  connection.message(Buffer.from(JSON.stringify({ type: 'game:new', seed: 17, setup: { player: 'borea' } })));
  return { ws, connection, token: connection.token };
}

test('resume rebinds a live game and sends token, resumed ack and full state', () => {
  const { registry } = setup();
  const first = newConnection(registry);
  assert.equal(first.ws.sent[0].type, 'game:session');
  first.connection.close();
  const secondWs = socket();
  const second = createSessionConnection({ socket: secondWs, registry });
  second.message(Buffer.from(JSON.stringify({ type: 'game:resume', token: first.token })));
  assert.deepEqual(secondWs.sent.slice(0, 2).map((m) => m.type), ['game:session', 'game:resumed']);
  assert.equal(secondWs.sent[1].ok, true);
  assert.equal(secondWs.sent.at(-1).type, 'game:state');
  assert.ok(secondWs.sent.at(-1).state.events.length >= 1, 'resume is a full snapshot, not a delta');
});

test('unknown token is rejected without creating a session', () => {
  const { registry } = setup();
  const ws = socket();
  const connection = createSessionConnection({ socket: ws, registry });
  connection.message(Buffer.from(JSON.stringify({ type: 'game:resume', token: 'missing' })));
  assert.deepEqual(ws.sent, [{ type: 'game:resumed', ok: false }]);
  assert.equal(registry.size, 0);
});

test('detached sessions expire after TTL and oldest detached sessions are evicted', () => {
  const { registry, clock } = setup();
  const first = newConnection(registry); first.connection.close();
  clock.fireAll();
  assert.equal(registry.size, 0);
  const a = newConnection(registry); a.connection.close();
  const b = newConnection(registry); b.connection.close();
  const c = newConnection(registry); c.connection.close();
  // max is three in setup, so all three detached sessions remain until expiry.
  assert.equal(registry.size, 3);
  const smallClock = fakeTimers();
  const limited = createSessionRegistry({ max: 1, ttlMs: 100, timers: smallClock.timers, now: () => 1000, makeToken: (() => { let i = 0; return () => `evict-${++i}`; })() });
  const old = newConnection(limited); old.connection.close();
  const current = newConnection(limited);
  assert.equal(limited.size, 1, 'oldest detached record is evicted while active remains');
  assert.equal(limited.get(old.token), null, 'oldest detached record is evicted');
  current.connection.close();
});

test('battle clock is stopped while detached and resumes on rebind', () => {
  const clock = fakeTimers();
  let interval = null; let cleared = 0;
  const timers = {
    setInterval(fn) { interval = fn; return 1; },
    clearInterval() { interval = null; cleared += 1; },
    setTimeout: clock.timers.setTimeout,
    clearTimeout: clock.timers.clearTimeout,
  };
  const registry = createSessionRegistry({ timers, now: () => 1000, makeToken: () => 'battle-token' });
  const firstWs = socket();
  const firstConnection = createSessionConnection({ socket: firstWs, registry, sessionOptions: { timers } });
  firstConnection.message(Buffer.from(JSON.stringify({ type: 'game:new', seed: 17, setup: { player: 'borea' } })));
  const first = { ws: firstWs, connection: firstConnection, token: firstConnection.token };
  const state = first.connection.session.game;
  let a = null; let d = null;
  for (let c = 0; c < state.owner.length && d === null; c += 1) {
    if (state.cityAt[c] || state.owner[c] || state.unitsByCell[c]?.length) continue;
    for (const n of map.neighbors[c]) if (!state.cityAt[n] && !state.owner[n] && !state.unitsByCell[n]?.length && map.terrain[n] === 'P' && map.terrain[c] === 'P') { a = c; d = n; break; }
  }
  state.wars.push('auris|borea');
  const attacker = addUnit(state, 'borea', 'tank', a); attacker.moves = 3;
  addUnit(state, 'auris', 'warrior', d);
  first.connection.message(Buffer.from(JSON.stringify({ type: 'game:command', command: { kind: 'battle', unitId: attacker.id, to: d } })));
  assert.ok(interval, 'battle interval started');
  const before = state.battle.tick;
  first.connection.close();
  assert.equal(interval, null);
  assert.ok(cleared > 0);
  const secondWs = socket();
  const second = createSessionConnection({ socket: secondWs, registry });
  second.message(Buffer.from(JSON.stringify({ type: 'game:resume', token: first.token })));
  assert.ok(interval, 'battle interval restarted after resume');
  interval(); interval();
  assert.ok(state.battle.tick > before, 'battle advances after resume');
  second.close();
});
