// Одна партия на одно WebSocket-соединение. Основа из PR #2 (src/nuclear/session.js),
// но вместо таймера тиков — пошаговый цикл: клиент шлёт game:endTurn.
import { createGame, snapshot } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { loadMap } from './map.js';
import { errorText } from './i18n/ru.js';
import { TICK, battleView } from './tactical.js';

/** Сервер сам ведёт часы тактического боя и шлёт кадры: клиент не опрашивает, приказ виден сразу. */
export const BATTLE_FRAME_MS = 100;
const BATTLE_SPEEDS = [0, 1, 2, 4];

/** onNewGame(game, map) — необязательная подготовка свежей партии до первого снимка (сценарии dev-сервера). */
export function createGameSession({ send, now = () => Date.now(), map = loadMap(), timers = { setInterval, clearInterval }, onNewGame = null, onGameNew = null } = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required');
  let game = null;
  let lastEventSeq = 0;
  let attached = true;
  let sendTarget = send;

  // ---------- часы боя ----------
  const clock = { timer: null, accMs: 0, speed: 1 };
  const quietSend = () => {};
  function sendNow(payload) { sendTarget(payload); }
  function stopClock() { if (clock.timer) timers.clearInterval(clock.timer); clock.timer = null; }
  function startClock() {
    if (!attached || clock.timer) return;
    clock.timer = timers.setInterval(battleFrame, BATTLE_FRAME_MS);
  }
  function battleFrame() {
    if (!game?.battle) { stopClock(); return; }
    // Время боя не зависит от wall-clock: каждый кадр добавляет ровно speed × 100 ms.
    // Храним миллисекунды до следующего тика, чтобы половинные тики скорости ×1
    // не накапливали ошибки плавающей арифметики.
    clock.accMs += clock.speed * BATTLE_FRAME_MS;
    const tickMs = TICK * 1000;
    const ticks = Math.floor(clock.accMs / tickMs);
    if (ticks <= 0) return;
    clock.accMs -= ticks * tickMs;
    pushFrame(applyCommand(game, game.player, { kind: 'battleAdvance', ticks }, map));
  }
  function pushFrame(result) {
    sendNow({ type: 'game:battle', ...result, speed: clock.speed });
    if (result.finished) { stopClock(); broadcast(); }
  }

  function broadcast() {
    const state = snapshot(game, game.player, { sinceSeq: lastEventSeq, map });
    if (state.events.length) lastEventSeq = state.events[state.events.length - 1].seq;
    sendNow({ type: 'game:state', state });
  }

  /** Читает requestId, не доверяя объекту: геттер или Proxy не должны уронить обработчик. */
  function requestIdOf(message) {
    try {
      if (message === null || typeof message !== 'object') return null;
      const id = message.requestId;
      if (typeof id === 'string') return id.slice(0, 64);
      return typeof id === 'number' && Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }

  /** Обработчик сообщения. Исключения не выходят наружу: клиент получает game:error. */
  function handle(message) {
    try {
      return route(message);
    } catch (error) {
      if (process.env.KUPOL_DEBUG) console.error(error);
      sendNow({ type: 'game:error', requestId: requestIdOf(message), error: 'INTERNAL', message: errorText('INTERNAL') });
      return true;
    }
  }

  // ограничения на ввод: размер сообщения и частота команд с одного соединения
  const MAX_MESSAGE_BYTES = 16_384; // байты UTF-8, а не символы: кириллица весит вдвое больше
  const MAX_COMMANDS_PER_SECOND = 40;
  let windowStart = 0;
  let windowCount = 0;

  function tooLarge(message) {
    try { return Buffer.byteLength(JSON.stringify(message), 'utf8') > MAX_MESSAGE_BYTES; } catch { return true; }
  }

  function route(message) {
    if (message === null || typeof message !== 'object') return false;
    if (tooLarge(message)) {
      sendNow({ type: 'game:error', requestId: null, error: 'TOO_LARGE', message: errorText('TOO_LARGE') });
      return true;
    }
    const t = now();
    if (t - windowStart >= 1000) { windowStart = t; windowCount = 0; }
    windowCount += 1;
    if (windowCount > MAX_COMMANDS_PER_SECOND) {
      sendNow({ type: 'game:error', requestId: requestIdOf(message), error: 'RATE_LIMIT', message: errorText('RATE_LIMIT') });
      return true;
    }
    switch (message.type) {
      case 'game:new': {
        stopClock();
        clock.accMs = 0;
        clock.speed = 1;
        const seed = Number.isInteger(message.seed) ? message.seed : now() % 2147483647;
        try {
          game = createGame({ seed, setup: message.setup ?? {}, map });
        } catch (error) {
          sendNow({ type: 'game:error', error: 'BAD_SETUP', message: errorText('BAD_SETUP') });
          return true;
        }
        lastEventSeq = 0;
        if (onNewGame) onNewGame(game, map);
        if (onGameNew) onGameNew(game);
        broadcast();
        return true;
      }
      case 'game:command': {
        const requestId = requestIdOf(message);
        const result = game ? applyCommand(game, game.player, message.command, map) : { ok: false, error: 'NO_GAME' };
        sendNow({ type: 'game:command:result', requestId, ...result, ...(result.ok ? {} : { message: errorText(result.error) }) });
        // прогноз и тики тактического боя партию на карте не меняют: снимок шлём только по итогу боя
        const kind = message.command?.kind;
        const quiet = kind === 'odds' || ((kind === 'battleOrder' || kind === 'battleAdvance' || kind === 'battle') && !result.finished);
        if (game && result.ok && !quiet) broadcast();
        if (result.ok && kind === 'battle') { clock.accMs = 0; clock.speed = 1; startClock(); }
        if (result.finished) stopClock();
        return true;
      }
      case 'game:endTurn': {
        const requestId = requestIdOf(message);
        if (!game) {
          sendNow({ type: 'game:command:result', requestId, ok: false, error: 'NO_GAME', message: errorText('NO_GAME') });
          return true;
        }
        if (game.status !== 'running') {
          sendNow({ type: 'game:command:result', requestId, ok: false, error: 'GAME_OVER', message: errorText('GAME_OVER') });
          return true;
        }
        if (game.battle) {
          sendNow({ type: 'game:command:result', requestId, ok: false, error: 'BATTLE_ACTIVE', message: errorText('BATTLE_ACTIVE') });
          return true;
        }
        endTurn(game, map);
        sendNow({ type: 'game:command:result', requestId, ok: true, turn: game.turn });
        broadcast();
        return true;
      }
      case 'game:battleSpeed': {
        // 0 — пауза, 1/2/4 — скорость; кадр шлётся сразу, чтобы интерфейс не ждал следующего тика
        const requestId = requestIdOf(message);
        const speed = BATTLE_SPEEDS.includes(message.speed) ? message.speed : 1;
        if (!game?.battle) { sendNow({ type: 'game:command:result', requestId, ok: false, error: 'NO_BATTLE', message: errorText('NO_BATTLE') }); return true; }
        clock.speed = speed;
        sendNow({ type: 'game:command:result', requestId, ok: true, speed });
        return true;
      }
      case 'game:stop': {
        stopClock();
        game = null;
        sendNow({ type: 'game:stopped' });
        return true;
      }
      default:
        return false;
    }
  }

  return {
    handle,
    setSend(next) { if (typeof next !== 'function') throw new TypeError('send is required'); sendTarget = next; },
    detach() { attached = false; stopClock(); },
    resume() { attached = true; if (game?.battle) startClock(); },
    sendResume() {
      if (!game) return;
      lastEventSeq = 0;
      broadcast();
      // новое окно боя строится с нуля: рельеф нужен и после первого тика
      if (game.battle) sendNow({ type: 'game:battle', battle: battleView(game.battle, { terrain: true }), speed: clock.speed });
    },
    dispose() { attached = false; stopClock(); game = null; sendTarget = quietSend; },
    get game() { return game; },
    get map() { return map; },
  };
}
