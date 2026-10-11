/**
 * WebSocket transport for «Купол».  Browser details (location, WebSocket and
 * sessionStorage) are injected so the protocol can be tested without Cesium.
 */
export function createReconnectClient({
  url,
  WebSocketCtor,
  storage = null,
  timers = globalThis,
  onMessage = () => {},
  onStatus = () => {},
  onResumeFailed = () => {},
  onResume = () => {},
}) {
  if (typeof WebSocketCtor !== 'function') throw new TypeError('WebSocketCtor is required');
  const getToken = () => { try { return storage?.getItem('kupol.session') || null; } catch { return null; } };
  const setToken = (token) => { try { if (token) storage?.setItem('kupol.session', token); else storage?.removeItem('kupol.session'); } catch { /* storage may be blocked */ } };
  let socket = null;
  let closed = false;
  let handshake = 'closed';
  let retryTimer = null;
  let retry = 0;
  let status = 'offline';
  const queued = [];

  const emitStatus = (next) => { status = next; onStatus(next); };
  const isOpen = () => socket && (socket.readyState === 1 || socket.readyState === socket.OPEN);
  const flush = () => {
    if (handshake !== 'ready' || !isOpen()) return;
    while (queued.length) socket.send(queued.shift().text);
  };
  const clearRetry = () => { if (retryTimer !== null) timers.clearTimeout(retryTimer); retryTimer = null; };

  function scheduleReconnect() {
    if (closed || retryTimer !== null) return;
    const delay = Math.min(10_000, 1000 * (2 ** Math.min(retry, 3)));
    retry += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (closed) return;
      emitStatus('reconnecting');
      open();
    }, delay);
  }

  function onOpen() {
    retry = 0;
    const token = getToken();
    if (token) {
      handshake = 'resuming';
      socket.send(JSON.stringify({ type: 'game:resume', token }));
      return;
    }
    handshake = 'ready';
    emitStatus('online');
    flush();
  }

  function onClose() {
    if (handshake === 'closed' && closed) return;
    handshake = 'closed';
    socket = null;
    emitStatus('offline');
    scheduleReconnect();
  }

  function onSocketMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'game:session' && typeof msg.token === 'string' && msg.token) {
      setToken(msg.token);
      onMessage(msg);
      return;
    }
    if (msg.type === 'game:resumed') {
      if (msg.ok) {
        handshake = 'ready';
        emitStatus('online');
        onResume(msg);
        flush();
      } else {
        setToken(null);
        handshake = 'ready';
        emitStatus('online');
        onResumeFailed(msg);
        flush();
      }
      return;
    }
    onMessage(msg);
  }

  function open() {
    if (closed) return;
    emitStatus(retry ? 'reconnecting' : 'connecting');
    socket = new WebSocketCtor(url);
    const add = (name, fn) => socket.addEventListener ? socket.addEventListener(name, fn) : (socket[`on${name}`] = fn);
    add('open', onOpen); add('close', onClose); add('message', onSocketMessage);
    add('error', () => {});
  }

  function send(message) {
    const text = JSON.stringify(message);
    if (handshake === 'ready' && isOpen()) socket.send(text);
    else queued.push({ text, requestId: message?.requestId ?? null });
  }
  function cancel(requestId) {
    for (let i = queued.length - 1; i >= 0; i -= 1) if (queued[i].requestId === requestId) queued.splice(i, 1);
  }

  function close() {
    closed = true;
    clearRetry();
    handshake = 'closed';
    socket?.close();
  }

  open();
  return {
    send,
    cancel,
    close,
    get status() { return status; },
    get connected() { return handshake === 'ready' && isOpen(); },
    hasToken: () => Boolean(getToken()),
  };
}
