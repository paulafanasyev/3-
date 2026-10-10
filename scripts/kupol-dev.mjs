#!/usr/bin/env node
// Dev-сервер «Купола»: обычный Vite из vite.config.js (горячая перезагрузка, все /api-прокси
// God's Eye View) плюс WebSocket партии на /ws. Открыть: http://localhost:5173/kupol
// В продакшене то же самое делает server.js (npm run build && npm start).
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { createGameSession } from '../src/game/session.js';

const vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname });
await vite.listen();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

vite.httpServer.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
  if (pathname !== '/ws') return; // HMR-сокет Vite и прокси обрабатываются сами
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (socket) => {
  const send = (payload) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload)); };
  const game = createGameSession({ send });
  socket.on('close', () => game.dispose());
  socket.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { send({ type: 'error', code: 'INVALID_JSON' }); return; }
    if (typeof message?.type === 'string' && message.type.startsWith('game:')) game.handle(message);
  });
});

vite.printUrls();
console.log('[Купол] игра: /kupol, сокет партии: /ws');
