// Разово в CI: визуальная приёмка новых экранов «Купола» в настоящем Chrome (без интернета и ключей).
// Экраны: выбор нации и сложности, HUD, дерево технологий, справка, дипломатия, конец партии — на 4 размерах окна.
// Автоматические проверки вёрстки + скриншоты; отчёт пушится в ветку ci/visual-check. Файл удаляется следующим коммитом.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findChrome, startDevServer } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-visual.done';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = [[1280, 720], [1366, 768], [1920, 1080], [1024, 768]];

// Сценарий «over» только в рабочей копии CI: партия сразу окончена спасением Земли (для экрана конца).
const SCEN = 'src/game/scenarios.js';
const OVER = `
export function overScenario(game) {
  game.status = 'over';
  game.result = { ending: 'saved', outcome: 'saved', winner: game.player, defense: 100,
    contributions: Object.fromEntries(Object.keys(game.nations).sort().map((id, i) => [id, 140 - i * 30])) };
  return true;
}
`;

const AUDIT = String.raw`(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const name = (el) => (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase());
  const root = document.getElementById('kupol-root') || document.body;
  const issues = [];
  const panels = [...root.children].filter(vis).filter((el) => !el.matches('.k-toast'));
  for (const el of panels) { const r = el.getBoundingClientRect(); if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) issues.push({ kind: 'panel-offscreen', el: name(el), rect: rect(el) }); }
  for (const el of panels) { const cs = getComputedStyle(el); if (el.scrollHeight > el.clientHeight + 4 && !/auto|scroll/.test(cs.overflowY)) issues.push({ kind: 'panel-cut', el: name(el), scrollH: el.scrollHeight, clientH: el.clientHeight }); }
  const overlays = ['k-help-overlay', 'k-gameover', 'k-reconnect', 'k-combat', 'k-offer'];
  const solid = panels.filter((el) => !overlays.some((c) => el.classList.contains(c)));
  for (let i = 0; i < solid.length; i += 1) for (let j = i + 1; j < solid.length; j += 1) {
    const a = solid[i].getBoundingClientRect(); const b = solid[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) issues.push({ kind: 'overlap', a: name(solid[i]), b: name(solid[j]), area: Math.round(w * h) });
  }
  for (const b of root.querySelectorAll('button, select')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) { issues.push({ kind: 'control-offscreen', text: (b.innerText || b.value || '').slice(0, 40), rect: rect(b) }); continue; }
    const scroller = b.closest('.k-left, .k-right, .k-help-box, .k-chron');
    if (scroller) { const s = scroller.getBoundingClientRect(); if (cy < s.top || cy > s.bottom) continue; }
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !b.contains(hit) && !hit.contains(b)) issues.push({ kind: 'control-covered', text: (b.innerText || '').slice(0, 40), by: name(hit) });
  }
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el) || el.children.length) continue;
    const t = (el.innerText || '').trim(); if (!t) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') issues.push({ kind: 'text-clipped', el: name(el), text: t.slice(0, 40) });
    const fs = parseFloat(cs.fontSize); if (fs < 10) issues.push({ kind: 'tiny-font', el: name(el), px: fs, text: t.slice(0, 30) });
    const pr = el.parentElement?.getBoundingClientRect(); const r = el.getBoundingClientRect();
    if (pr && pr.width > 0 && (r.right > pr.right + 3 || r.left < pr.left - 3) && cs.position !== 'absolute') issues.push({ kind: 'text-outside-parent', el: name(el), text: t.slice(0, 40) });
  }
  const latin = new Set(); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { if (!n.parentElement || !vis(n.parentElement)) continue; for (const m of n.textContent.matchAll(/[A-Za-z]{3,}/g)) latin.add(m[0]); }
  const seen = new Set(); const uniq = issues.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
  const counts = {}; for (const x of uniq) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
  return JSON.stringify({ vw, vh, panels: panels.map((el) => ({ el: name(el), rect: rect(el) })), counts, issues: uniq.slice(0, 60), latin: [...latin].slice(0, 60) });
})()`;

async function openChrome(chrome) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1280,720', `--user-data-dir=/tmp/kupol-visual-${port}`, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'], { stdio: 'ignore' });
  let version = null;
  for (let i = 0; i < 100 && !version; i += 1) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP')); });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); };
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const waitFor = async (expression, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expression); if (v) return v; await sleep(300); } return null; };
  const size = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(1200); };
  return { send, ev, waitFor, size, errors, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}

test('CI: визуальная приёмка экранов', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 600000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-visual-out'; mkdirSync(out, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA, screens: {}, texts: {}, errors: [] };
  const original = readFileSync(`${root}/${SCEN}`, 'utf8');
  const chrome = findChrome();
  const shot = async (b, name) => { const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); if (r.result?.data) writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.result.data, 'base64')); };
  const audit = async (b, name, doShot = true) => { report.screens[name] = JSON.parse((await b.ev(AUDIT)) ?? '{}'); if (doShot) await shot(b, name); };
  try {
    writeFileSync(`${root}/${SCEN}`, original.replace('export const SCENARIOS = Object.freeze({ battle: battleScenario });', `${OVER}\nexport const SCENARIOS = Object.freeze({ battle: battleScenario, over: overScenario });`));
    // --- партия с боем: HUD, технологии, справка, дипломатия ---
    let server = await startDevServer({ scenario: 'battle' });
    let b = await openChrome(chrome);
    try {
      await b.send('Page.navigate', { url: `${server.url}/kupol` });
      if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации');
      await sleep(1500);
      await audit(b, 'start-1280');
      await b.size(1024, 768); await audit(b, 'start-1024'); await b.size(1280, 720);
      report.texts.start = await b.ev("document.querySelector('.k-start')?.innerText.slice(0, 600)");
      await b.ev("(() => { const s = document.querySelector('.k-start [data-difficulty]'); if (s) { s.value = 'hard'; s.dispatchEvent(new Event('change')); } document.querySelector('.k-start button[data-id]').click(); return true; })()");
      if (!await b.waitFor("!!window.__kupol?.state", 30000)) throw new Error('партия не началась');
      await sleep(9000);
      for (const [w, h] of VIEWPORTS) { await b.size(w, h); await audit(b, `hud-${w}x${h}`); }
      await b.size(1280, 720);
      report.texts.top = await b.ev("document.querySelector('.k-top')?.innerText");
      report.texts.left = await b.ev("document.querySelector('.k-left')?.innerText.slice(0, 1500)");
      report.texts.right = await b.ev("document.querySelector('.k-right')?.innerText.slice(0, 1500)");
      report.texts.diplomacyButtons = JSON.parse(await b.ev("JSON.stringify([...document.querySelectorAll('.k-right button')].map((x) => ({ t: x.innerText.trim(), disabled: x.disabled, title: x.title })))"));
      await b.ev("document.querySelectorAll('.k-tech details').forEach((d) => { d.open = true; }); true");
      await sleep(500); await audit(b, 'tech-open-1280');
      report.texts.tech = await b.ev("document.querySelector('.k-tech')?.innerText.slice(0, 1500)");
      await b.ev("document.querySelector('.k-help')?.click(); true");
      await sleep(800); await audit(b, 'help-1280');
      report.texts.help = await b.ev("document.querySelector('.k-help-overlay')?.innerText.slice(0, 2500)");
      await b.size(1024, 768); await audit(b, 'help-1024'); await b.size(1280, 720);
      await b.ev("document.querySelector('.k-help-close')?.click(); true");
      await sleep(500);
      report.helpClosed = await b.ev("getComputedStyle(document.querySelector('.k-help-overlay')).display === 'none'");
      await b.ev("window.__kupol.endTurn(); true");
      await b.waitFor("(window.__kupol.state?.turn ?? 0) > 1", 30000); await sleep(2500);
      await audit(b, 'hud-turn2-1280');
      report.errors.push(...b.errors.map((e) => `battle: ${e}`));
    } finally { b.close(); server.stop(); }
    // --- конец партии ---
    server = await startDevServer({ scenario: 'over' });
    b = await openChrome(chrome);
    try {
      await b.send('Page.navigate', { url: `${server.url}/kupol` });
      if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации (over)');
      await b.ev("document.querySelector('.k-start button[data-id]').click(); true");
      report.gameoverShown = await b.waitFor("(() => { const el = document.querySelector('.k-gameover'); return el && getComputedStyle(el).display !== 'none' ? true : null; })()", 40000);
      await sleep(4000);
      await audit(b, 'gameover-1280');
      await b.size(1024, 768); await audit(b, 'gameover-1024');
      await b.size(1920, 1080); await audit(b, 'gameover-1920'); await b.size(1280, 720);
      report.texts.gameover = await b.ev("document.querySelector('.k-gameover')?.innerText.slice(0, 1200)");
      report.endTurnDisabled = await b.ev("document.querySelector('.k-end')?.disabled ?? null");
      report.errors.push(...b.errors.map((e) => `over: ${e}`));
    } finally { b.close(); server.stop(); }
  } catch (e) {
    report.fatal = String(e?.stack ?? e).slice(0, 2000);
  } finally {
    writeFileSync(`${root}/${SCEN}`, original);
  }
  report.summary = Object.fromEntries(Object.entries(report.screens).map(([k, v]) => [k, v.counts ?? {}]));
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/visual-check && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: визуальная приёмка экранов"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/visual-check`, { cwd: out, stdio: 'inherit' });
});
