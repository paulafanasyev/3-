// Разовая проверка в CI (удаляется следующим коммитом): открывает /kupol в headless Chrome
// дважды (без внешней сети и с сетью), пишет скриншоты, тосты, консоль и запросы подложки
// в ветку ci/browser-check. Ничего не проверяет на «упало/не упало»: это снимок для разбора.
// Второй прогон: перед запуском чинит boot.js (контроллер камеры живёт в viewer.scene) и,
// если хэш совпал с проверенной версией, коммитит правку в feat/game-design.
import test from 'node:test';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAG = '/tmp/kupol-browser-check.done';
const BOOT = 'src/game/client/boot.js';
const BOOT_WANT = '960648476fb0133c6abfbce1e816fbf775f198f4';
const BOOT_FROM = '  viewer.screenSpaceCameraController.enableCollisionDetection = true;\n';
const BOOT_TO = '  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true; // у Viewer нет своего контроллера камеры: он живёт в scene\n';

async function cdpSession(port) {
  for (let i = 0; i < 50; i += 1) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else handlers.forEach((h) => h(m)); };
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  return { send, on: (h) => handlers.push(h), close: () => ws.close() };
}

async function visit(url, { offline, port }) {
  const chrome = execSync('which google-chrome || which chromium || which chromium-browser').toString().trim().split('\n')[0];
  const args = ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,800', `--user-data-dir=/tmp/kupol-chrome-${port}`];
  if (offline) args.push('--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  const log = { offline, console: [], errors: [], toasts: [], natural: { ok: 0, fail: 0 }, external: { ok: 0, fail: 0 }, sample: [] };
  try {
    const s = await cdpSession(port);
    const reqs = new Map();
    s.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') log.console.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
      if (m.method === 'Runtime.exceptionThrown') log.errors.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
      if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, m.params.request.url);
      const tally = (u, ok) => { const b = /NaturalEarthII/.test(u) ? log.natural : /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u) ? null : log.external; if (b) b[ok ? 'ok' : 'fail'] += 1; if (log.sample.length < 40 && !/node_modules|@vite|\.js(\?|$)|\.css/.test(u)) log.sample.push(`${ok ? 'OK ' : 'ERR'} ${u.slice(0, 160)}`); };
      if (m.method === 'Network.responseReceived') tally(m.params.response.url, m.params.response.status < 400);
      if (m.method === 'Network.loadingFailed') tally(reqs.get(m.params.requestId) ?? '', false);
    });
    await s.send('Runtime.enable'); await s.send('Network.enable'); await s.send('Page.enable');
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__toasts=[];new MutationObserver(()=>{const t=document.querySelector('.k-toast');if(t&&t.textContent&&window.__toasts[window.__toasts.length-1]!==t.textContent)window.__toasts.push(t.textContent);}).observe(document,{subtree:true,childList:true,characterData:true});` });
    await s.send('Page.navigate', { url });
    for (let i = 0; i < 5; i += 1) { await sleep(6000); }
    const t = await s.send('Runtime.evaluate', { expression: 'JSON.stringify({toasts: window.__toasts, canvas: !!document.querySelector(".cesium-widget canvas"), credit: document.querySelector(".cesium-credit-textContainer")?.innerText?.slice(0,200) ?? null, hud: document.body.innerText.slice(0, 300)})', returnByValue: true });
    Object.assign(log, JSON.parse(t.result?.result?.value ?? '{}'));
    const shot = await s.send('Page.captureScreenshot', { format: 'png' });
    s.close();
    return { log, png: shot.result?.data ? Buffer.from(shot.result.data, 'base64') : null };
  } finally { proc.kill('SIGKILL'); }
}

test('CI: /kupol в браузере', { skip: !process.env.GITHUB_ACTIONS, timeout: 240000 }, async () => {
  if (existsSync(FLAG)) return; writeFileSync(FLAG, '1');
  const boot = readFileSync(BOOT, 'utf8');
  if (boot.includes(BOOT_FROM)) {
    writeFileSync(BOOT, boot.replace(BOOT_FROM, BOOT_TO));
    assert.equal(execSync(`git hash-object ${BOOT}`).toString().trim(), BOOT_WANT);
    execSync(`git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "fix(kupol): контроллер камеры берём из viewer.scene — /kupol падал при запуске в браузере" -- ${BOOT}`, { stdio: 'inherit' });
    execSync('git push origin HEAD:feat/game-design', { stdio: 'inherit' });
  }
  const out = '/tmp/kupol-browser-out'; mkdirSync(out, { recursive: true });
  const dev = spawn('node', ['scripts/kupol-dev.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOOGLE_MAPS_API_KEY: '' } });
  let text = ''; dev.stdout.on('data', (d) => { text += d; }); dev.stderr.on('data', (d) => { text += d; });
  const report = { devLog: '' };
  try {
    for (let i = 0; i < 60 && !/Local:/.test(text); i += 1) await sleep(500);
    const base = (text.match(/Local:\s+(\S+)/)?.[1] ?? 'http://localhost:5173/').replace(/\/$/, '').replace(/\x1b\[[0-9;]*m/g, '');
    for (const [name, offline, port] of [['offline', true, 9333], ['online', false, 9334]]) {
      try {
        const { log, png } = await visit(`${base}/kupol`, { offline, port });
        report[name] = log; if (png) writeFileSync(`${out}/${name}.png`, png);
      } catch (e) { report[name] = { failed: String(e?.stack ?? e).slice(0, 600) }; }
    }
  } finally {
    report.devLog = text.replace(/\x1b\[[0-9;]*m/g, '').slice(-3000);
    dev.kill('SIGKILL');
    writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
    const header = execSync('git config --get http.https://github.com/.extraheader || true').toString().trim();
    const remote = execSync('git remote get-url origin').toString().trim();
    const sh = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
    sh('git init -q && git checkout -q -b ci/browser-check && git add -A');
    sh('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: снимок /kupol в браузере"');
    execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/browser-check`, { cwd: out, stdio: 'inherit' });
  }
});
