// Соединение с сервером партии. Все команды проходят через game:resume после
// переподключения, поэтому очередь не может обогнать восстановление сессии.
import { createReconnectClient } from './reconnect.js';

export function connectGame({ onState, onResult, onError, onStatus, onResumeFailed, onResume } = {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const storage = typeof sessionStorage === 'undefined' ? null : sessionStorage;
  let seq = 0;
  const pending = new Map();
  const battleListeners = new Set();
  const stateListeners = new Set();
  const statusListeners = new Set();
  const queueIds = new Map();
  let transport;

  const rejectPending = (error) => {
    for (const [id, p] of pending) { p.reject(error); pending.delete(id); }
  };
  transport = createReconnectClient({
    url,
    WebSocketCtor: WebSocket,
    storage,
    onStatus(status) { onStatus?.(status); for (const fn of statusListeners) fn(status); },
    onResumeFailed(msg) { onResumeFailed?.(msg); },
    onResume(msg) { onResume?.(msg); },
    onMessage(msg) {
      if (msg.type === 'game:state') { onState?.(msg.state); for (const fn of stateListeners) fn(msg.state); }
      else if (msg.type === 'game:battle') for (const fn of battleListeners) fn(msg);
      else if (msg.type === 'game:command:result') {
        const p = pending.get(msg.requestId);
        if (p) { pending.delete(msg.requestId); queueIds.delete(msg.requestId); p.resolve(msg); }
        onResult?.(msg);
      } else if (msg.type === 'game:error') {
        const p = pending.get(msg.requestId);
        if (p) { pending.delete(msg.requestId); queueIds.delete(msg.requestId); p.resolve({ ok: false, ...msg }); }
        onError?.(msg);
      }
    },
  });

  // Requests must fail as soon as the socket closes. The transport status is
  // authoritative; this listener also prevents stale queued requests on retry.
  statusListeners.add((status) => {
    if (status === 'offline') {
      rejectPending(new Error('OFFLINE'));
      for (const id of queueIds.keys()) { transport.cancel(id); queueIds.delete(id); }
    }
  });

  function request(message) {
    seq += 1;
    const requestId = `r${seq}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      queueIds.set(requestId, true);
      transport.send({ ...message, requestId });
    });
  }

  return {
    newGame: (setup, seed) => transport.send({ type: 'game:new', setup, ...(Number.isInteger(seed) ? { seed } : {}) }),
    command: (command) => request({ type: 'game:command', command }),
    endTurn: () => request({ type: 'game:endTurn' }),
    battleSpeed: (speed) => request({ type: 'game:battleSpeed', speed }),
    onBattle: (fn) => { battleListeners.add(fn); return () => battleListeners.delete(fn); },
    onState: (fn) => { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    onStatus: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    hasSession: () => transport.hasToken(),
    get status() { return transport.status; },
    close: () => transport.close(),
  };
}
