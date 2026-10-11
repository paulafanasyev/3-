// Разово в CI: приёмка дипломатии в настоящем Chrome. Сценарий «diplo» (только в рабочей копии CI):
// игрок знаком со всеми нациями, видит два нейтральных народа, у него есть золото и влияние.
// Проверяет вёрстку панели и нажимает каждое действие: договор, подарок, сделка, ультиматум, разведка,
// расторжение, война, мир, подарок и присоединение народа. Отчёт — в ветку ci/diplo-check.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findChrome, startDevServer } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-diplo.done';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCEN = 'src/game/scenarios.js';
const DIPLO = `
export function diploScenario(game) {
  const me = game.player; const n = game.nations[me];
  n.gold = 400; n.influence = 150;
  for (const id of Object.keys(game.nations).sort()) {
    if (id === me) continue;
    if (!n.met.includes(id)) n.met.push(id);
    if (!game.nations[id].met.includes(me)) game.nations[id].met.push(me);
  }
  const ids = Object.keys(game.neutrals).sort().slice(0, 2);
  for (let c = 0; c < game.owner.length; c += 1) if (ids.includes(game.owner[c])) game.explored[me][c] = 1;
  if (ids[0]) game.neutrals[ids[0]].relations[me] = 75;
  return true;
}
`;

const LAYOUT = String.raw`(() => {
  const vw = innerWidth, vh = innerHeight; const out = [];
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const panel = document.querySelector('.k-right'); const pr = panel.getBoundingClientRect();
  if (pr.right > vw + 1 || pr.bottom > vh + 1 || pr.left < -1) out.push('панель за краем экрана');
  const live = document.querySelector('.k-live'); if (live && vis(live)) { const l = live.getBoundingClientRect(); if (l.top < pr.bottom - 2 && l.left < pr.right) out.push('панель живых слоёв наезжает на дипломатию'); }
  for (const el of panel.querySelectorAll('*')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.right > pr.right + 2 || r.left < pr.left - 2) out.push('выходит за ширину панели: ' + (el.innerText || el.tagName).trim().slice(0, 40));
    if (!el.children.length && (el.innerText || '').trim() && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') out.push('обрезан текст: ' + el.innerText.trim().slice(0, 40));
  }
  const latin = new Set(); const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) for (const m of n.textContent.matchAll(/[A-Za-z]{3,}/g)) latin.add(m[0]);
  for (const b of panel.querySelectorAll('button')) for (const m of (b.title || '').matchAll(/undefined|NaN|null|[A-Za-z]{4,}/g)) latin.add('title:' + m[0]);
  return JSON.stringify({ vw, vh, panel: { h: Math.round(pr.height), scroll: panel.scrollHeight }, problems: [...new Set(out)].slice(0, 30), latin: [...latin] });
})()`;

const CARDS = String.raw`JSON.stringify([...document.querySelectorAll('.k-right .k-lc')].map((c) => ({
  name: c.querySelector('.k-nm')?.innerText, sub: c.querySelector('.k-ld')?.innerText, mood: c.querySelector('.k-mood')?.innerText,
  buttons: [...c.querySelectorAll('button')].map((b) => ({ t: b.innerText.trim(), act: b.dataset.act, target: b.dataset.target, treaty: b.dataset.treaty, op: b.dataset.op, disabled: b.disabled, title: b.title })) })))`;

const STATE = String.raw`(() => { const s = window.__kupol.state; const me = s.nations.find((n) => n.id === s.nationId);
  return JSON.stringify({ gold: me.gold, influence: me.influence, treaties: s.treaties.map((t) => t.type + ':' + t.a + '-' + t.b), wars: s.wars, offers: s.offers.length,
    toasts: (window.__kupolToasts || []).slice(-2), chron: document.querySelector('.k-chron div')?.innerText ?? null }); })()`;

async function openChrome(chrome) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1280,720', `--user-data-dir=/tmp/kupol-diplo-${port}`, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'], { stdio: 'ignore' });
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

test('CI: приёмка дипломатии', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 600000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-diplo-out'; mkdirSync(out, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA, layout: {}, steps: [] };
  const original = readFileSync(`${root}/${SCEN}`, 'utf8');
  const shot = async (b, name) => { const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); if (r.result?.data) writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.result.data, 'base64')); };
  let server = null; let b = null;
  try {
    writeFileSync(`${root}/${SCEN}`, original.replace('export const SCENARIOS = Object.freeze({ battle: battleScenario });', `${DIPLO}\nexport const SCENARIOS = Object.freeze({ battle: battleScenario, diplo: diploScenario });`));
    server = await startDevServer({ scenario: 'diplo' });
    b = await openChrome(findChrome());
    await b.send('Page.navigate', { url: `${server.url}/kupol` });
    if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации');
    await b.ev("document.querySelector('.k-start button[data-id]').click(); true");
    if (!await b.waitFor("!!window.__kupol?.state", 30000)) throw new Error('партия не началась');
    await sleep(8000);
    report.cards = JSON.parse(await b.ev(CARDS));
    for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080], [1024, 768]]) { await b.size(w, h); report.layout[`${w}x${h}`] = JSON.parse(await b.ev(LAYOUT)); await shot(b, `diplo-${w}x${h}`); }
    await b.size(1280, 720);
    const major = report.cards.find((c) => c.buttons.some((x) => x.act === 'propose'))?.buttons.find((x) => x.act === 'propose')?.target;
    const neutral = report.cards.find((c) => c.buttons.some((x) => x.act === 'annex'))?.buttons.find((x) => x.act === 'annex')?.target;
    report.targets = { major, neutral };
    const click = async (label, selector, amount = null) => {
      const before = JSON.parse(await b.ev(STATE));
      const found = await b.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'нет кнопки'; if (el.disabled) return 'выключена: ' + el.title;
        ${amount !== null ? `const i = el.closest('.k-action')?.querySelector('input[data-value]'); if (i) i.value = '${amount}';` : ''} el.scrollIntoView({ block: 'center' }); el.click(); return 'нажата'; })()`);
      await sleep(1500);
      const after = JSON.parse(await b.ev(STATE));
      report.steps.push({ label, found, before: { gold: before.gold, influence: before.influence, treaties: before.treaties.length, wars: before.wars.length },
        after: { gold: after.gold, influence: after.influence, treaties: after.treaties, wars: after.wars, offers: after.offers }, toasts: after.toasts, chron: after.chron });
    };
    const T = (x) => `.k-right button[data-target="${x}"]`;
    if (major) {
      await click('договор: торговля', `${T(major)}[data-act="propose"][data-treaty="trade"]`);
      await click('договор: ненападение', `${T(major)}[data-act="propose"][data-treaty="nap"]`);
      await click('подарок 25', `${T(major)}[data-act="gift"]`, 25);
      await click('сделка 20 золота', `${T(major)}[data-act="negotiate"]`, 20);
      await click('ультиматум 10 золота', `${T(major)}[data-act="demand"]`, 10);
      await click('разведка: очернение', `${T(major)}[data-act="spy"][data-op="smear"]`);
      await click('расторгнуть первый договор', `${T(major)}[data-act="cancelTreaty"]`);
      await click('объявить войну', `${T(major)}[data-act="war"]`);
      await click('предложить мир', `${T(major)}[data-act="peace"]`);
    }
    if (neutral) {
      await click('народ: подарок 30', `${T(neutral)}[data-act="gift"]`, 30);
      await click('народ: присоединить', `${T(neutral)}[data-act="annex"]`);
    }
    await shot(b, 'diplo-after');
    report.cardsAfter = JSON.parse(await b.ev(CARDS)).map((c) => ({ name: c.name, mood: c.mood, buttons: c.buttons.map((x) => `${x.t}${x.disabled ? ' [выкл: ' + x.title + ']' : ''}`) }));
    report.dialogs = b.dialogs; report.errors = b.errors;
  } catch (e) {
    report.fatal = String(e?.stack ?? e).slice(0, 2000);
  } finally {
    b?.close(); server?.stop();
    writeFileSync(`${root}/${SCEN}`, original);
  }
  writeFileSync(`${out}/summary.json`, JSON.stringify(report));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/diplo-check && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: приёмка дипломатии"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/diplo-check`, { cwd: out, stdio: 'inherit' });
});
