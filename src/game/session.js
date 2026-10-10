// Одна партия на одно WebSocket-соединение. Основа из PR #2 (src/nuclear/session.js),
// но вместо таймера тиков — пошаговый цикл: клиент шлёт game:endTurn.
import { createGame, snapshot } from './state.js';
import { applyCommand } from './commands.js';
import { endTurn } from './turn.js';
import { loadMap } from './map.js';
import { errorText } from './i18n/ru.js';

export function createGameSession({ send, now = () => Date.now(), map = loadMap() } = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required');
  let game = null;
  let lastEventSeq = 0;

  function broadcast() {
    const state = snapshot(game, game.player, { sinceSeq: lastEventSeq, map });
    if (state.events.length) lastEventSeq = state.events[state.events.length - 1].seq;
    send({ type: 'game:state', state });
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
      send({ type: 'game:error', requestId: requestIdOf(message), error: 'INTERNAL', message: errorText('INTERNAL') });
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
      send({ type: 'game:error', requestId: null, error: 'TOO_LARGE', message: errorText('TOO_LARGE') });
      return true;
    }
    const t = now();
    if (t - windowStart >= 1000) { windowStart = t; windowCount = 0; }
    windowCount += 1;
    if (windowCount > MAX_COMMANDS_PER_SECOND) {
      send({ type: 'game:error', requestId: requestIdOf(message), error: 'RATE_LIMIT', message: errorText('RATE_LIMIT') });
      return true;
    }
    switch (message.type) {
      case 'game:new': {
        const seed = Number.isInteger(message.seed) ? message.seed : now() % 2147483647;
        try {
          game = createGame({ seed, setup: message.setup ?? {}, map });
        } catch (error) {
          send({ type: 'game:error', error: 'BAD_SETUP', message: errorText('BAD_SETUP') });
          return true;
        }
        lastEventSeq = 0;
        broadcast();
        return true;
      }
      case 'game:command': {
        const requestId = requestIdOf(message);
        const result = game ? applyCommand(game, game.player, message.command, map) : { ok: false, error: 'NO_GAME' };
        send({ type: 'game:command:result', requestId, ...result, ...(result.ok ? {} : { message: errorText(result.error) }) });
        if (game && result.ok && message.command?.kind !== 'odds') broadcast(); // прогноз боя партию не меняет
        return true;
      }
      case 'game:endTurn': {
        const requestId = requestIdOf(message);
        if (!game) {
          send({ type: 'game:command:result', requestId, ok: false, error: 'NO_GAME', message: errorText('NO_GAME') });
          return true;
        }
        if (game.status !== 'running') {
          send({ type: 'game:command:result', requestId, ok: false, error: 'GAME_OVER', message: errorText('GAME_OVER') });
          return true;
        }
        endTurn(game, map);
        send({ type: 'game:command:result', requestId, ok: true, turn: game.turn });
        broadcast();
        return true;
      }
      case 'game:stop': {
        game = null;
        send({ type: 'game:stopped' });
        return true;
      }
      default:
        return false;
    }
  }

  return {
    handle,
    dispose() { game = null; },
    get game() { return game; },
  };
}
