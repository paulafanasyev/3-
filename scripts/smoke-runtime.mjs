// Runtime smoke test for the production server (Stage 1 acceptance).
// Requires a prior `npm run build`. Usage: npm run smoke
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = process.env.SMOKE_PORT || '4199';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT, HOST: '127.0.0.1', GEV_MAX_WS_CLIENTS: '2' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let exitCode = null;
child.on('exit', (code) => {
  exitCode = code;
});

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  child.kill('SIGTERM');
  process.exit(1);
}

function pass(message) {
  console.log(`ok - ${message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exitCode !== null) fail(`server exited early with code ${exitCode}`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  fail('server did not become healthy within 60s');
}

const health = await waitForHealth();
if (health.ok !== true) fail(`/api/health returned ${JSON.stringify(health)}`);
if (health.maxWebSocketClients !== 2) fail(`configured websocket limit missing from health: ${JSON.stringify(health)}`);
pass(`/api/health ok (apiProxies=${health.apiProxies}, max websocket clients=${health.maxWebSocketClients})`);

for (const route of ['/', '/some/deep/route']) {
  const res = await fetch(`${BASE}${route}`);
  const body = await res.text();
  if (res.status !== 200 || !/<html/i.test(body)) fail(`${route} did not serve dist/index.html (status ${res.status})`);
  pass(`${route} serves index.html`);
}

{
  const res = await fetch(`${BASE}/assets/__missing__.js`);
  await res.text();
  if (res.status !== 404) fail(`missing asset returned ${res.status}, expected 404`);
  pass('missing asset returns 404');
}

{
  const res = await fetch(`${BASE}/api/__missing__`);
  await res.text();
  if (res.status !== 404) fail(`unknown /api route returned ${res.status}, expected 404`);
  pass('unknown /api route returns 404');
}

{
  const res = await fetch(`${BASE}/kupol`);
  const body = await res.text();
  const entryMatch = body.match(/<script[^>]+src=[\"']([^\"']+\.js)[\"']/i);
  if (res.status !== 200 || !/<html/i.test(body) || !entryMatch) {
    fail(`/kupol did not serve game entry HTML (status ${res.status})`);
  }
  // код игры грузится лениво (import() в src/main.js), поэтому проверяем, что входной бандл отдаётся
  const entryRes = await fetch(new URL(entryMatch[1], BASE));
  await entryRes.text();
  if (!entryRes.ok) fail(`/kupol entry bundle is not served (status ${entryRes.status})`);
  pass('/kupol serves game entry HTML and its bundle');
}

let sessionToken = null;
await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS_URL);
  const seen = [];
  const timer = setTimeout(() => reject(new Error(`websocket timeout, saw ${JSON.stringify(seen)}`)), 10_000);
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    seen.push(message);
    if (message.type === 'runtime:ready') {
      ws.send('{not json');
    } else if (message.type === 'error' && message.code === 'INVALID_JSON') {
      ws.send(JSON.stringify({ type: 'smoke:ping' }));
    } else if (message.type === 'runtime:ack' && message.messageType === 'smoke:ping') {
      ws.send(JSON.stringify({ type: 'game:new', setup: { player: 'borea' } }));
    } else if (message.type === 'game:session') {
      sessionToken = message.token;
    } else if (message.type === 'game:state') {
      if (message.state?.turn !== 1) {
        clearTimeout(timer);
        reject(new Error(`game state turn was ${message.state?.turn}, expected 1`));
        return;
      }
      clearTimeout(timer);
      ws.close();
      resolve();
    }
  });
  ws.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
}).catch((error) => fail(error.message));
pass('/ws: runtime checks and game:new -> game:state turn 1');

// Обрыв связи: новая вкладка/сокет возвращается в ту же партию по токену.
if (typeof sessionToken !== 'string' || sessionToken.length < 16) fail('game:new did not send game:session token');
await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS_URL);
  let resumed = false;
  const timer = setTimeout(() => reject(new Error('resume timeout')), 10_000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'game:resume', token: sessionToken })));
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'game:resumed') {
      if (!message.ok) { clearTimeout(timer); reject(new Error('resume rejected a live session')); return; }
      resumed = true;
    } else if (message.type === 'game:state' && resumed) {
      clearTimeout(timer);
      ws.close();
      if (message.state?.turn !== 1) reject(new Error(`resumed state turn was ${message.state?.turn}`));
      else resolve();
    }
  });
  ws.on('error', (error) => { clearTimeout(timer); reject(error); });
}).catch((error) => fail(error.message));
pass('/ws: game:resume returns the same game after reconnect');

{
  const res = await fetch(`${BASE}/api/health`);
  await res.text();
  if (!res.ok || exitCode !== null) fail('server did not survive invalid websocket JSON');
  pass('server alive after invalid JSON');
}

await new Promise((resolve) => {
  const ws = new WebSocket(WS_URL, { origin: 'https://evil.example' });
  ws.on('open', () => {
    ws.terminate();
    fail('websocket accepted a foreign Origin');
  });
  ws.on('unexpected-response', (req, res) => {
    req.destroy();
    if (res.statusCode !== 403) fail(`foreign Origin got ${res.statusCode}, expected 403`);
    resolve();
  });
  ws.on('error', () => resolve());
});
pass('/ws rejects foreign Origin');

// The service refuses the third concurrent socket at the handshake boundary.
// The test server is intentionally configured with a limit of two above.
await sleep(150);
async function openIdleSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error('idle websocket did not become ready')), 10_000);
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'runtime:ready') {
        clearTimeout(timer);
        resolve(ws);
      }
    });
    ws.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
const heldSockets = await Promise.all([openIdleSocket(), openIdleSocket()]);
await new Promise((resolve, reject) => {
  let settled = false;
  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    ws.terminate();
    reject(new Error('connection-cap handshake did not resolve'));
  }, 10_000);
  ws.on('open', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    ws.terminate();
    reject(new Error('server accepted a third socket above GEV_MAX_WS_CLIENTS=2'));
  });
  ws.on('unexpected-response', (request, response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const status = response.statusCode;
    response.resume();
    if (status !== 503) reject(new Error(`third socket got HTTP ${status}, expected 503`));
    else resolve();
  });
  ws.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(error);
  });
});
pass('/ws rejects connections above the configured concurrent-client limit');
await Promise.all(heldSockets.map((ws) => new Promise((resolve) => {
  if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
  ws.once('close', resolve);
  ws.close();
})));

child.kill('SIGTERM');
for (let i = 0; i < 20 && exitCode === null; i += 1) await sleep(250);
console.log('SMOKE PASS');
process.exit(0);
