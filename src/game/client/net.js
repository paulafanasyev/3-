// Соединение с сервером партии. Вся логика на сервере: клиент шлёт команды и
// получает снимок своей нации (туман войны уже применён сервером).
export function connectGame({ onState, onResult, onError, onStatus }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let socket = null;
  let seq = 0;
  const pending = new Map();
  const queue = [];
  const battleListeners = new Set(); // кадры тактического боя, которые сервер шлёт сам

  function open() {
    onStatus?.('connecting');
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      onStatus?.('online');
      while (queue.length) socket.send(queue.shift());
    });
    socket.addEventListener('close', () => {
      onStatus?.('offline');
      for (const [, p] of pending) p.reject(new Error('OFFLINE'));
      pending.clear();
    });
    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'game:state') onState?.(msg.state);
      else if (msg.type === 'game:battle') for (const fn of battleListeners) fn(msg);
      else if (msg.type === 'game:command:result') {
        const p = pending.get(msg.requestId);
        if (p) { pending.delete(msg.requestId); p.resolve(msg); }
        onResult?.(msg);
      } else if (msg.type === 'game:error') {
        const p = pending.get(msg.requestId);
        if (p) { pending.delete(msg.requestId); p.resolve({ ok: false, ...msg }); }
        onError?.(msg);
      }
    });
  }

  function raw(message) {
    const text = JSON.stringify(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(text);
    else queue.push(text);
  }

  function request(message) {
    seq += 1;
    const requestId = `r${seq}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      raw({ ...message, requestId });
    });
  }

  open();
  return {
    newGame: (setup, seed) => raw({ type: 'game:new', setup, ...(Number.isInteger(seed) ? { seed } : {}) }),
    command: (command) => request({ type: 'game:command', command }),
    endTurn: () => request({ type: 'game:endTurn' }),
    /** Скорость боя на сервере: 0 — пауза, 1, 2, 4. */
    battleSpeed: (speed) => request({ type: 'game:battleSpeed', speed }),
    /** Подписка на кадры боя; возвращает отписку. */
    onBattle: (fn) => { battleListeners.add(fn); return () => battleListeners.delete(fn); },
    close: () => socket?.close(),
  };
}
