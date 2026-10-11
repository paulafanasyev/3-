// Разово в CI: пересъёмка тактического боя «Купола» (1920×1080) с диагностикой: что лежит поверх окна боя.
// Отчёт и кадры — в ветку ci/battle-shots. Файл удаляется следующим коммитом.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findChrome, startDevServer } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-battleshot.done';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCEN = 'src/game/scenarios.js';
const EXTRA = `
export function showScenario(game, map) {
  const me = game.player; const n = game.nations[me];
  n.gold = 420; n.influence = 160;
  for (const id of Object.keys(game.nations).sort()) {
    if (id === me) continue;
    if (!n.met.includes(id)) n.met.push(id);
    if (!game.nations[id].met.includes(me)) game.nations[id].met.push(me);
  }
  for (let c = 0; c < game.owner.length; c += 1) game.explored[me][c] = 1;
  return battleScenario(game, map);
}
export function overScenario(game) {
  game.status = 'over';
  game.result = { ending: 'saved', outcome: 'saved', winner: game.player, defense: 100,
    contributions: Object.fromEntries(Object.keys(game.nations).sort().map((id, i) => [id, 140 - i * 30])) };
  return true;
}
`;
const DIAG = String.raw`(() => {
  const root = document.querySelector('.kb-root');
  const chain = (el) => { const out = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); out.push((e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').join('.') : e.tagName.toLowerCase()) + '[z=' + cs.zIndex + ',pos=' + cs.position + ']'); } return out.slice(0, 6); };
  const pts = [[960, 540], [200, 200], [1700, 300], [960, 1000]].map(([x, y]) => ({ x, y, top: chain(document.elementFromPoint(x, y)) }));
  const cs = root ? getComputedStyle(root) : null;
  const scene = root?.querySelector('.kb-scene canvas');
  return JSON.stringify({ root: !!root, inBody: root?.parentElement === document.body, display: cs?.display, visibility: cs?.visibility, opacity: cs?.opacity, z: cs?.zIndex, pos: cs?.position,
    rect: root ? root.getBoundingClientRect().toJSON() : null, canvas: scene ? { w: scene.width, h: scene.height, rect: scene.getBoundingClientRect().toJSON() } : null,
    cards: root?.querySelectorAll('.kb-cards > *').length ?? 0, time: root?.querySelector('.kb-time')?.textContent ?? null, pts,
    bodyChildren: [...document.body.children].map((e) => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').join('.') : e.tagName.toLowerCase()) + '[z=' + getComputedStyle(e).zIndex + ',pos=' + getComputedStyle(e).position + ']').slice(0, 20) });
})()`;

async function openChrome(chrome) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1920,1080', `--user-data-dir=/tmp/kupol-bshot-${port}`, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'], { stdio: 'ignore' });
  let version = null;
  for (let i = 0; i < 100 && !version; i += 1) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP')); });
  let id = 0; const pending = new Map(); const errors = []; const dialogs = [];
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: true }); }
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__kupolToasts=[];new MutationObserver(()=>{const t=document.querySelector('.k-toast');const a=window.__kupolToasts;if(t&&t.textContent&&a[a.length-1]!==t.textContent)a.push(t.textContent);}).observe(document,{subtree:true,childList:true,characterData:true});" });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const waitFor = async (expression, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expression); if (v) return v; await sleep(300); } return null; };
  const size = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(1200); };
  return { send, ev, waitFor, size, errors, dialogs, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}

test('CI: пересъёмка боя', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 900000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-bshot-out'; mkdirSync(out, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA, shots: {}, diag: {}, notes: [], errors: [] };
  const original = readFileSync(`${root}/${SCEN}`, 'utf8');
  const shot = async (b, name, params = {}) => {
    const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, ...params });
    if (r.result?.data) { const buf = Buffer.from(r.result.data, 'base64'); writeFileSync(`${out}/${name}.jpg`, buf); report.shots[name] = { bytes: buf.length }; }
    else report.notes.push(`${name}: ${JSON.stringify(r.error ?? r).slice(0, 200)}`);
  };
  let server = null; let b = null;
  try {
    writeFileSync(`${root}/${SCEN}`, original.replace('export const SCENARIOS = Object.freeze({ battle: battleScenario });', `${EXTRA}\nexport const SCENARIOS = Object.freeze({ battle: battleScenario, show: showScenario });`));
    server = await startDevServer({ scenario: 'show' });
    b = await openChrome(findChrome());
    await b.size(1920, 1080);
    await b.send('Page.navigate', { url: `${server.url}/kupol` });
    if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации');
    await b.ev("document.querySelector('.k-start button[data-id]').click(); true");
    if (!await b.waitFor("!!window.__kupol?.state", 30000)) throw new Error('партия не началась');
    await sleep(10000);
    const st = JSON.parse(await b.ev("JSON.stringify({ tanks: window.__kupol.state.units.filter((u) => u.owner === window.__kupol.state.nationId && u.type === 'tank').map((u) => u.id), enemies: [...new Set(window.__kupol.state.units.filter((u) => u.owner !== window.__kupol.state.nationId).map((u) => u.cell))] })"));
    let opened = false;
    for (const cell of st.enemies) {
      await b.ev(`window.__kbDone = undefined; window.__kupol.tactical(${JSON.stringify(st.tanks[0])}, ${cell}).then((r) => { window.__kbDone = r ? 'ok' : 'null'; }, () => { window.__kbDone = 'error'; }); window.__kupol.battleSpeed(0).catch(() => {}); true`);
      opened = await b.waitFor("document.querySelector('.kb-root') ? true : (window.__kbDone !== undefined ? 'no' : null)", 8000) === true;
      if (opened) break;
    }
    if (!opened) throw new Error('бой не открылся');
    await b.ev("document.querySelector('.kb-root [data-pause]')?.click(); window.__kupol.battleSpeed(0).catch(() => {}); true");
    await sleep(4000);
    report.diag.paused = JSON.parse(await b.ev(DIAG));
    await shot(b, 'b1-paused');
    await shot(b, 'b1-paused-surface', { fromSurface: true, captureBeyondViewport: false });
    await b.ev("window.__kupol.battleSpeed(1).catch(() => {}); true");
    await sleep(1500);
    await b.ev("window.__kupol.battleSpeed(0).catch(() => {}); true");
    await sleep(2500);
    report.diag.mid = JSON.parse(await b.ev(DIAG));
    await shot(b, 'b2-mid');
    await b.ev("(() => { const r = document.querySelector('.kb-root'); if (r) { r.style.zIndex = '2147483000'; document.body.appendChild(r); } return true; })()");
    await sleep(1500);
    report.diag.forced = JSON.parse(await b.ev(DIAG));
    await shot(b, 'b3-forced-top');
    await b.ev("document.querySelector('.kb-root [data-auto]')?.click(); window.__kupol.battleSpeed(1).catch(() => {}); true");
    report.result = await b.waitFor("(() => { const el = document.querySelector('.kb-result'); return el && el.style.display === 'flex' ? el.innerText.slice(0, 200) : null; })()", 60000);
    await sleep(1200);
    await shot(b, 'b4-result');
    report.errors.push(...b.errors);
  } catch (e) {
    report.fatal = String(e?.stack ?? e).slice(0, 2000);
  } finally {
    b?.close(); server?.stop();
    writeFileSync(`${root}/${SCEN}`, original);
  }
  try {
    const sharp = (await import('sharp')).default;
    for (const name of Object.keys(report.shots)) {
      const s = await sharp(`${out}/${name}.jpg`).stats();
      report.shots[name].mean = Math.round(s.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3);
      report.shots[name].stdev = Math.round(s.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3);
    }
  } catch (e) { report.notes.push(`sharp: ${String(e?.message ?? e).slice(0, 300)}`); }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/battle-shots && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: пересъёмка боя"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/battle-shots`, { cwd: out, stdio: 'inherit' });
});
