import test from 'node:test';
import assert from 'node:assert/strict';
import { createReconnectClient } from './reconnect.js';

class FakeSocket {
  static instances = [];
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.handlers = {}; FakeSocket.instances.push(this); }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  send(text) { this.sent.push(text); }
  emit(name, data) { for (const fn of this.handlers[name] ?? []) fn(data); }
  open() { this.readyState = 1; this.emit('open', {}); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.emit('close', {}); }
}
function clock() {
  const jobs = new Map(); let id = 0; let elapsed = 0;
  return { timers: { setTimeout(fn, ms) { const key = ++id; jobs.set(key, { fn, at: elapsed + ms }); return key; }, clearTimeout(key) { jobs.delete(key); } },
    run(ms) { elapsed += ms; for (const [key, job] of [...jobs]) if (job.at <= elapsed) { jobs.delete(key); job.fn(); } } };
}
function store(token = null) { const data = new Map(token ? [['kupol.session', token]] : []); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }; }

test('не отправляет очередь до game:resumed и хранит session token', () => {
  FakeSocket.instances = []; const events = []; const c = createReconnectClient({ url: 'ws://x', WebSocketCtor: FakeSocket, storage: store('old'), timers: clock().timers, onMessage: (m) => events.push(m) });
  const s = FakeSocket.instances[0]; s.open();
  assert.deepEqual(JSON.parse(s.sent[0]), { type: 'game:resume', token: 'old' });
  c.send({ type: 'game:command', requestId: 'r1' }); assert.equal(s.sent.length, 1);
  s.message({ type: 'game:resumed', ok: true }); assert.deepEqual(JSON.parse(s.sent[1]), { type: 'game:command', requestId: 'r1' });
  s.message({ type: 'game:session', token: 'new' }); assert.equal(events.at(-1).token, 'new'); assert.equal(c.connected, true);
});

test('отбрасывает старый token и уведомляет о неудачном resume', () => {
  FakeSocket.instances = []; const failed = []; const st = store('gone'); createReconnectClient({ url: 'ws://x', WebSocketCtor: FakeSocket, storage: st, onResumeFailed: () => failed.push(true) });
  const s = FakeSocket.instances[0]; s.open(); s.message({ type: 'game:resumed', ok: false }); assert.equal(st.getItem('kupol.session'), null); assert.equal(failed.length, 1);
});

test('после close планирует переподключение с backoff', () => {
  FakeSocket.instances = []; const c = clock(); const statuses = []; createReconnectClient({ url: 'ws://x', WebSocketCtor: FakeSocket, timers: c.timers, onStatus: (s) => statuses.push(s) });
  const first = FakeSocket.instances[0]; first.open(); first.close(); assert.ok(statuses.includes('offline')); c.run(999); assert.equal(FakeSocket.instances.length, 1); c.run(1); assert.equal(FakeSocket.instances.length, 2); assert.ok(statuses.includes('connecting'));
});
