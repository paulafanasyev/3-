// Runtime smoke test for the production server (Stage 1 acceptance).
// Requires a prior `npm run build`. Usage: npm run smoke
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = process.env.SMOKE_PORT || '4199';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT, HOST: '127.0.0.1' },
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
pass(`/api/health ok (apiProxies=${health.apiProxies})`);

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
pass('/ws: runtime:ready -> INVALID_JSON handled -> runtime:ack');

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

child.kill('SIGTERM');
for (let i = 0; i < 20 && exitCode === null; i += 1) await sleep(250);
console.log('SMOKE PASS');
process.exit(0);
