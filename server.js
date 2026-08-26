import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'nuclear-gods-eye',
    websocket: wss.clients.size,
    timestamp: new Date().toISOString(),
  });
});

const dist = path.join(__dirname, 'dist');
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'runtime:ready', version: 1 }));

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON' }));
      return;
    }

    if (!message || typeof message.type !== 'string') {
      socket.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE' }));
      return;
    }

    // Stage 1 only verifies transport. Gameplay state is added in later stages.
    socket.send(JSON.stringify({ type: 'runtime:ack', messageType: message.type }));
  });
});

server.listen(port, host, () => {
  console.log(`[nuclear-gods-eye] listening on http://${host}:${port}`);
  console.log('[nuclear-gods-eye] websocket endpoint: /ws');
});
