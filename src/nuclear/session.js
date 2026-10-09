// One game per WebSocket connection. The player is 'blue', the AI is 'red'.
// Hybrid mode: the browser streams positions of live GEV traffic (aircraft,
// ships) via game:civilians; strikes near them cost the attacker points.
import { runAi } from './ai.js';
import { applyCommand, createGame, snapshot, tick } from './game.js';
import { haversineKm, isValidPoint } from './geo.js';

export const SESSION_TICK_MS = 250;
export const MAX_CIVILIAN_POINTS = 3000;
const PLAYER_SIDE = 'blue';
const AI_SIDE = 'red';

const clampSpeed = (value) => (Number.isFinite(value) ? Math.min(8, Math.max(0.25, value)) : 1);

function toPoint(raw) {
  if (Array.isArray(raw)) return { lat: Number(raw[0]), lon: Number(raw[1]) };
  return { lat: Number(raw?.lat), lon: Number(raw?.lon) };
}

export function createGameSession({
  send,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  tickMs = SESSION_TICK_MS,
} = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required');
  let game = null;
  let timer = null;
  let lastAt = 0;
  let speed = 1;
  let lastEventSeq = 0;
  let civilians = [];

  const civilianSampler = (center, radiusKm) => {
    let count = 0;
    for (const point of civilians) if (haversineKm(point, center) <= radiusKm) count += 1;
    return count;
  };

  function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  function broadcast() {
    const state = snapshot(game, PLAYER_SIDE, { sinceSeq: lastEventSeq });
    if (state.events.length) lastEventSeq = state.events[state.events.length - 1].seq;
    send({ type: 'game:state', state });
  }

  function step() {
    if (!game) return;
    const at = now();
    const dt = Math.max(0, (at - lastAt) / 1000) * speed;
    lastAt = at;
    tick(game, dt, { civilianSampler });
    runAi(game, AI_SIDE);
    broadcast();
    if (game.status !== 'running') stop();
  }

  function handle(message) {
    switch (message?.type) {
      case 'game:new': {
        stop();
        const seed = Number.isInteger(message.seed) ? message.seed : now() % 2147483647;
        game = createGame({ seed });
        speed = clampSpeed(Number(message.speed ?? 1));
        lastEventSeq = 0;
        lastAt = now();
        timer = setIntervalFn(step, tickMs);
        broadcast();
        return true;
      }
      case 'game:command': {
        const requestId = typeof message.requestId === 'string' || Number.isFinite(message.requestId)
          ? message.requestId
          : null;
        const result = game ? applyCommand(game, PLAYER_SIDE, message.command) : { ok: false, error: 'NO_GAME' };
        send({ type: 'game:command:result', requestId, ...result });
        return true;
      }
      case 'game:civilians': {
        const points = Array.isArray(message.points) ? message.points : [];
        civilians = points.slice(0, MAX_CIVILIAN_POINTS).map(toPoint).filter(isValidPoint);
        send({ type: 'game:civilians:ok', count: civilians.length });
        return true;
      }
      case 'game:speed': {
        speed = clampSpeed(Number(message.speed));
        send({ type: 'game:speed:ok', speed });
        return true;
      }
      case 'game:stop': {
        stop();
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
    step,
    dispose: stop,
    get game() {
      return game;
    },
  };
}
