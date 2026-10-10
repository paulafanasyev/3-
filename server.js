// Production server for Nuclear God's Eye.
// Uses only node:http plus packages already pinned in package-lock.json
// (ws, vite), so `npm ci && npm run build && npm start` works as-is.
// NOTE: install with plain `npm ci` (not --omit=dev): ws and vite are needed at runtime.
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGameSession } from './src/game/session.js';

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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.pbf': 'application/x-protobuf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

if (!fs.existsSync(indexHtml)) {
  console.error('[nuclear-gods-eye] dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[nuclear-gods-eye] request failed:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'INTERNAL_ERROR' });
    } else {
      res.destroy();
    }
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

// The backend API proxies (OpenAI Realtime, AIS, FIRMS, TomTom, OpenSky, ...)
// live as Vite plugins in vite.config.js. Reuse them in production by loading
// that config in middleware mode and routing only /api/* into it. The browser
// only ever receives the built files from dist/.
let vite = null;
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
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendStatus(res, status, headers = {}) {
  res.writeHead(status, { 'Content-Length': 0, ...headers });
  res.end();
}

async function sendFile(req, res, filePath, stat, cacheControl) {
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    res.on('close', resolve);
    stream.pipe(res);
  });
}

async function statFile(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    sendStatus(res, 400);
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'nuclear-gods-eye',
      apiProxies: Boolean(vite),
      websocket: wss.clients.size,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const notFound = () => sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    if (!vite) {
      notFound();
      return;
    }
    vite.middlewares(req, res, (error) => {
      if (error) {
        console.error('[nuclear-gods-eye] api proxy error:', error);
        if (!res.headersSent) sendJson(res, 502, { ok: false, error: 'PROXY_ERROR' });
        return;
      }
      notFound();
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendStatus(res, 405, { Allow: 'GET, HEAD' });
    return;
  }

  // Static files from dist/, with a path traversal guard.
  const filePath = path.join(dist, path.normalize(pathname));
  if (filePath !== dist && !filePath.startsWith(dist + path.sep)) {
    sendStatus(res, 403);
    return;
  }
  const stat = await statFile(filePath);
  if (stat) {
    const hashed = pathname.startsWith('/assets/');
    await sendFile(req, res, filePath, stat, hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    return;
  }

  // Missing assets must 404 instead of silently returning HTML.
  if (path.extname(pathname)) {
    sendStatus(res, 404);
    return;
  }

  // SPA fallback.
  const indexStat = await statFile(indexHtml);
  await sendFile(req, res, indexHtml, indexStat, 'no-cache');
}

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

  // «Купол»: одна партия на соединение, вся логика на сервере (src/game/session.js).
  const game = createGameSession({ send: (payload) => send(socket, payload) });
  socket.on('close', () => game.dispose());

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

    if (message.type.startsWith('game:')) {
      if (!game.handle(message)) send(socket, { type: 'error', code: 'UNKNOWN_GAME_MESSAGE' });
      return;
    }

    // Остальные сообщения пока только подтверждают транспорт.
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
  console.log(`[nuclear-gods-eye] open in browser: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`[nuclear-gods-eye] websocket endpoint: ${WS_PATH}`);
  console.log(`[nuclear-gods-eye] API proxies: ${vite ? 'enabled' : 'disabled'}`);
});
