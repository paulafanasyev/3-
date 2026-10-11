#!/usr/bin/env node
// Dev-сервер «Купола»: обычный Vite из vite.config.js (горячая перезагрузка, все /api-прокси
// God's Eye View) плюс WebSocket партии на /ws. Открыть: http://localhost:5173/kupol
// В продакшене то же самое делает server.js (npm run build && npm start).
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { createSessionRegistry, createSessionConnection } from '../src/game/sessions.js';
import { SCENARIOS } from '../src/game/scenarios.js';

const vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname });
await vite.listen();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
// KUPOL_SCENARIO=battle — готовая ситуация для проверок в браузере (scripts/kupol-browser-smoke.mjs)
const scenario = SCENARIOS[process.env.KUPOL_SCENARIO] ?? null;
const sessions = createSessionRegistry();
if (process.env.KUPOL_SCENARIO && !scenario) console.warn(`[Купол] неизвестный сценарий: ${process.env.KUPOL_SCENARIO}`);

vite.httpServer.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
  if (pathname !== '/ws') return; // HMR-сокет Vite и прокси обрабатываются сами
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (socket) => {
  const send = (payload) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload)); };
  const connection = createSessionConnection({
    socket,
    registry: sessions,
    sessionOptions: { onNewGame: scenario },
    onBinary: () => {},
    onInvalidJson: () => send({ type: 'error', code: 'INVALID_JSON' }),
    onUnknown: (message) => { if (!message?.type?.startsWith('game:')) send({ type: 'error', code: 'UNKNOWN_GAME_MESSAGE' }); },
  });
  socket.on('close', () => connection.close());
  socket.on('message', (raw, isBinary) => connection.message(raw, isBinary));
});

vite.printUrls();
console.log('[Купол] игра: /kupol, сокет партии: /ws');
