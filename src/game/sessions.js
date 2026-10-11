// Общее хранилище возобновляемых партий для dev- и production-серверов.
// Сессия живёт отдельно от WebSocket: закрытие сокета лишь отсоединяет клиента.
import { randomBytes } from 'node:crypto';
import { createGameSession } from './session.js';

const noop = () => {};
const defaultTimers = { setTimeout, clearTimeout };

export function defaultSessionToken() {
  return randomBytes(16).toString('hex');
}

export function createSessionRegistry({
  ttlMs = 10 * 60 * 1000,
  max = 200,
  now = () => Date.now(),
  timers = defaultTimers,
  makeToken = defaultSessionToken,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive');
  if (!Number.isInteger(max) || max <= 0) throw new TypeError('max must be positive');
  const records = new Map();

  function clearExpiry(record) {
    if (record.expiry !== null) timers.clearTimeout(record.expiry);
    record.expiry = null;
  }
  function disposeRecord(record) {
    clearExpiry(record);
    records.delete(record.token);
    record.session.dispose();
  }
  function expire(record) {
    if (records.get(record.token) !== record || record.socket) return;
    disposeRecord(record);
  }
  function scheduleExpiry(record) {
    clearExpiry(record);
    record.detachedAt = now();
    record.expiry = timers.setTimeout(() => expire(record), ttlMs);
  }
  function evictDetached() {
    while (records.size > max) {
      const oldest = [...records.values()]
        .filter((record) => !record.socket)
        .sort((a, b) => (a.detachedAt - b.detachedAt) || (a.order - b.order))[0];
      if (!oldest) break; // active clients are never evicted
      disposeRecord(oldest);
    }
  }
  function tokenFor() {
    let token;
    do token = makeToken(); while (typeof token !== 'string' || !token || records.has(token));
    return token;
  }
  function register({ session, socket = null, send = noop } = {}) {
    if (!session || typeof session.setSend !== 'function' || typeof session.detach !== 'function') throw new TypeError('session is required');
    const token = tokenFor();
    const record = { token, session, socket, send, expiry: null, detachedAt: null, order: records.size + 1 };
    records.set(token, record);
    session.setSend(send);
    if (!socket) {
      session.detach();
      scheduleExpiry(record);
    }
    evictDetached();
    return record;
  }
  function attach(token, { socket = null, send = noop } = {}) {
    const record = records.get(token);
    if (!record) return null;
    if (record.socket && record.socket !== socket && typeof record.socket.close === 'function') {
      try { record.socket.close(4001, 'session resumed elsewhere'); } catch { /* closing is best effort */ }
    }
    clearExpiry(record);
    record.socket = socket;
    record.send = send;
    record.session.setSend(send);
    record.session.resume();
    return record;
  }
  function detach(token, socket = null) {
    const record = records.get(token);
    if (!record || (socket && record.socket !== socket)) return false;
    record.socket = null;
    record.session.detach();
    scheduleExpiry(record);
    return true;
  }
  function remove(token) {
    const record = records.get(token);
    if (!record) return false;
    disposeRecord(record);
    return true;
  }
  return {
    register,
    createSession: register,
    attach,
    detach,
    remove,
    get(token) { return records.get(token) ?? null; },
    get size() { return records.size; },
    dispose() { for (const record of [...records.values()]) disposeRecord(record); },
  };
}

/**
 * Подключает транспорт к общей сессии. Парсинг game-сообщений также общий для
 * dev- и production-сервера; транспортные runtime-сообщения остаются у сервера.
 */
export function createSessionConnection({ socket, registry, sessionOptions = {}, onGameNew = null, onInvalidJson = null, onBinary = null, onUnknown = null } = {}) {
  if (!socket || !registry) throw new TypeError('socket and registry are required');
  const send = (payload) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };
  let record = null;
  let session = createGameSession({
    ...sessionOptions,
    send,
    onGameNew: (game) => {
      if (!record) record = registry.register({ session, socket, send });
      send({ type: 'game:session', token: record.token });
      if (onGameNew) onGameNew(game);
    },
  });

  function handleResume(message) {
    const next = registry.attach(message.token, { socket, send });
    if (!next) {
      send({ type: 'game:resumed', ok: false });
      return true;
    }
    record = next;
    session = next.session;
    send({ type: 'game:session', token: record.token });
    send({ type: 'game:resumed', ok: true });
    session.sendResume();
    return true;
  }
  function message(raw, isBinary = false) {
    if (isBinary) { if (onBinary) onBinary(); return; }
    let parsed;
    try { parsed = JSON.parse(raw.toString()); } catch { if (onInvalidJson) onInvalidJson(); return; }
    if (!parsed || typeof parsed.type !== 'string' || !parsed.type.startsWith('game:')) {
      if (onUnknown) onUnknown(parsed);
      return;
    }
    if (parsed.type === 'game:resume') { handleResume(parsed); return; }
    if (!session.handle(parsed) && onUnknown) onUnknown(parsed);
  }
  function close() {
    if (record) registry.detach(record.token, socket);
    else session.dispose();
  }
  return { message, close, get session() { return session; }, get token() { return record?.token ?? null; } };
}
