import express from 'express';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT || 4173);
// Safe default: loopback only. Public binding must be explicit (HOST=0.0.0.0).
const host = process.env.HOST || '127.0.0.1';
const dist = path.join(__dirname, 'dist');
const indexHtml = path.join(dist, 'index.html');

const WS_PATH = '/ws';
const WS_MAX_PAYLOAD = 64 * 1024;
const WS_HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_TYPE_LENGTH = 64;
const apiProxiesEnabled = process.env.GEV_API_PROXIES !== '0';
const allowedOrigins = new Set(
  (process.env.GEV_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!fs.existsSync(indexHtml)) {
  console.error('[nuclear-gods-eye] dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

let vite = null;

// No global body parser on purpose: the API proxies below read the raw request
// stream themselves, and a parser mounted earlier would consume it.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'nuclear-gods-eye',
    apiProxies: Boolean(vite),
    websocket: wss.clients.size,
    timestamp: new Date().toISOString(),
  });
});

// The backend API proxies (OpenAI Realtime, AIS, FIRMS, TomTom, OpenSky, ...)
// live as Vite plugins in vite.config.js. Reuse them in production by loading
// that config in middleware mode and routing only /api/* into it. Static files
// are still served from dist/ below; no dev transforms reach the browser.
if (apiProxiesEnabled) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    root: __dirname,
    configFile: path.join(__dirname, 'vite.config.js'),
    mode: process.env.GEV_MODE || undefined,
    appType: 'custom',
    clearScreen: false,
    server: { middlewareMode: true, hmr: false, watch: null, host, port },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        // Plugins that hook server.httpServer (upgrade/listening) get the real
        // production HTTP server instead of null in middleware mode.
        name: 'gev-production-http-server',
        enforce: 'pre',
        configureServer(viteServer) {
          viteServer.httpServer = server;
        },
      },
    ],
  });

  app.use('/api', (req, res, next) => {
    // Express strips the mount path; the plugins are mounted on full /api/... paths.
    req.url = req.originalUrl;
    vite.middlewares(req, res, next);
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND' });
});

app.use(express.static(dist, { index: false }));

// Express 5 (path-to-regexp v8) rejects a bare '*'. '/{*splat}' also matches '/'.
app.get('/{*splat}', (req, res) => {
  // Missing assets must 404 instead of silently returning HTML.
  if (path.extname(req.path)) {
    res.status(404).end();
    return;
  }
  res.sendFile(indexHtml);
});

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  if (allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return;
  }
  if (pathname !== WS_PATH) return; // other upgrade handlers (API proxies) own it

  if (!originAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('error', (error) => {
    console.warn('[nuclear-gods-eye] websocket error:', error.message);
  });

  send(socket, { type: 'runtime:ready', version: 1 });

  socket.on('message', (raw, isBinary) => {
    if (isBinary) {
      send(socket, { type: 'error', code: 'BINARY_NOT_SUPPORTED' });
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: 'error', code: 'INVALID_JSON' });
      return;
    }

    if (
      !message
      || typeof message.type !== 'string'
      || message.type.length === 0
      || message.type.length > MAX_MESSAGE_TYPE_LENGTH
    ) {
      send(socket, { type: 'error', code: 'INVALID_MESSAGE' });
      return;
    }

    // Stage 1 only verifies transport. Gameplay state is added in later stages.
    send(socket, { type: 'runtime:ack', messageType: message.type });
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, WS_HEARTBEAT_MS);
heartbeat.unref();

server.on('error', (error) => {
  console.error('[nuclear-gods-eye] server error:', error.message);
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[nuclear-gods-eye] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  Promise.resolve(vite?.close())
    .catch(() => {})
    .finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port, host, () => {
  console.log(`[nuclear-gods-eye] listening on http://${host}:${port}`);
  console.log(`[nuclear-gods-eye] websocket endpoint: ${WS_PATH}`);
  console.log(`[nuclear-gods-eye] API proxies: ${vite ? 'enabled' : 'disabled'}`);
});
