// Разово в CI: галерея скриншотов «Купола» в настоящем Chrome, 1920×1080.
// Сценарии только в рабочей копии CI: «show» (знакомство со всеми, открытая карта, танк у врага) и «over» (финал).
// Скриншоты, обзорный лист и README с подписями пушатся в ветку ci/screenshots. Файл удаляется следующим коммитом.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findChrome, startDevServer } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-shots.done';
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
const SHOTS = [
  ['01-start', 'Выбор нации и сложности'],
  ['02-capital', 'Начало партии: столица, панель города и дипломатии'],
  ['03-world', 'Вся Земля: выдуманные страны поверх настоящего рельефа'],
  ['04-tech', 'Дерево технологий по эпохам'],
  ['05-diplomacy', 'Дипломатия: договоры, сделки, разведка, нейтральные народы'],
  ['06-battle', 'Тактический бой в 3D'],
  ['07-battle-result', 'Итог боя'],
  ['08-turn2', 'Второй ход: хроника событий'],
  ['09-help', 'Справка по игре'],
  ['10-finale', 'Финал: «Земля спасена»'],
];

async function openChrome(chrome) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1920,1080', `--user-data-dir=/tmp/kupol-shots-${port}`, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'], { stdio: 'ignore' });
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

test('CI: галерея скриншотов', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 900000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-shots-out'; mkdirSync(out, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA, shots: {}, notes: [], errors: [] };
  const original = readFileSync(`${root}/${SCEN}`, 'utf8');
  const shot = async (b, name) => {
    await b.ev("document.querySelectorAll('.k-toast').forEach((t) => { t.style.opacity = '0'; }); true");
    const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    if (r.result?.data) { writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.result.data, 'base64')); report.shots[name] = { bytes: Buffer.from(r.result.data, 'base64').length }; }
  };
  let server = null; let b = null;
  try {
    writeFileSync(`${root}/${SCEN}`, original.replace('export const SCENARIOS = Object.freeze({ battle: battleScenario });', `${EXTRA}\nexport const SCENARIOS = Object.freeze({ battle: battleScenario, show: showScenario, over: overScenario });`));
    server = await startDevServer({ scenario: 'show' });
    b = await openChrome(findChrome());
    await b.size(1920, 1080);
    await b.send('Page.navigate', { url: `${server.url}/kupol` });
    if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации');
    await sleep(6000); await shot(b, '01-start');
    await b.ev("document.querySelector('.k-start button[data-id]').click(); true");
    if (!await b.waitFor("!!window.__kupol?.state", 30000)) throw new Error('партия не началась');
    await sleep(12000); await shot(b, '02-capital');
    await b.ev("(() => { const c = window.__kupol.viewer.camera; c.zoomOut(Math.max(1.4e7 - c.positionCartographic.height, 0)); return true; })()");
    await sleep(9000); await shot(b, '03-world');
    await b.ev("(() => { const c = window.__kupol.viewer.camera; c.zoomIn(Math.max(c.positionCartographic.height - 6e6, 0)); return true; })()");
    await sleep(5000);
    await b.ev("(() => { document.querySelectorAll('.k-tech details').forEach((d) => { d.open = true; }); document.querySelector('.k-tech')?.scrollIntoView({ block: 'start' }); return true; })()");
    await sleep(1200); await shot(b, '04-tech');
    await b.ev("(() => { document.querySelectorAll('.k-tech details').forEach((d, i) => { d.open = i === 0; }); const r = document.querySelector('.k-right'); if (r) r.scrollTop = 0; return true; })()");
    await sleep(1200); await shot(b, '05-diplomacy');
    // бой: перебираем видимых врагов, пока не откроется поле
    const st = JSON.parse(await b.ev("JSON.stringify({ tanks: window.__kupol.state.units.filter((u) => u.owner === window.__kupol.state.nationId && u.type === 'tank').map((u) => u.id), enemies: [...new Set(window.__kupol.state.units.filter((u) => u.owner !== window.__kupol.state.nationId).map((u) => u.cell))] })"));
    let opened = false;
    for (const cell of st.enemies) {
      await b.ev(`window.__kbDone = undefined; window.__kupol.tactical(${JSON.stringify(st.tanks[0])}, ${cell}).then((r) => { window.__kbDone = r ? 'ok' : 'null'; }, () => { window.__kbDone = 'error'; }); window.__kupol.battleSpeed(0).catch(() => {}); true`);
      opened = await b.waitFor("document.querySelector('.kb-root') ? true : (window.__kbDone !== undefined ? 'no' : null)", 8000) === true;
      if (opened) break;
    }
    if (opened) {
      await sleep(3500);
      await b.ev("window.__kupol.battleSpeed(1).catch(() => {}); true");
      await sleep(1600);
      await b.ev("window.__kupol.battleSpeed(0).catch(() => {}); true");
      await sleep(1500); await shot(b, '06-battle');
      await b.ev("document.querySelector('.kb-root [data-auto]')?.click(); window.__kupol.battleSpeed(1).catch(() => {}); true");
      const res = await b.waitFor("(() => { const el = document.querySelector('.kb-result'); return el && el.style.display === 'flex' ? el.innerText.slice(0, 200) : null; })()", 60000);
      report.battleResult = res;
      await sleep(1200); await shot(b, '07-battle-result');
      await b.ev("document.querySelector('.kb-root [data-close]')?.click(); true");
      await b.waitFor("!document.querySelector('.kb-root')", 10000);
    } else report.notes.push('бой не открылся');
    await b.ev('window.__kupol.endTurn(); true');
    await b.waitFor('(window.__kupol.state?.turn ?? 0) > 1', 30000);
    await sleep(5000); await shot(b, '08-turn2');
    await b.ev("document.querySelector('.k-help')?.click(); true");
    await sleep(1200); await shot(b, '09-help');
    report.errors.push(...b.errors);
    b.close(); server.stop(); b = null; server = null;
    server = await startDevServer({ scenario: 'over' });
    b = await openChrome(findChrome());
    await b.size(1920, 1080);
    await b.send('Page.navigate', { url: `${server.url}/kupol` });
    if (!await b.waitFor("!!document.querySelector('.k-start button[data-id]')", 60000)) throw new Error('нет экрана выбора нации (over)');
    await b.ev("document.querySelector('.k-start button[data-id]').click(); true");
    await b.waitFor("(() => { const el = document.querySelector('.k-gameover'); return el && getComputedStyle(el).display !== 'none' ? true : null; })()", 40000);
    await sleep(7000); await shot(b, '10-finale');
    report.errors.push(...b.errors);
  } catch (e) {
    report.fatal = String(e?.stack ?? e).slice(0, 2000);
  } finally {
    b?.close(); server?.stop();
    writeFileSync(`${root}/${SCEN}`, original);
  }
  // проверка «не пустой ли кадр» и обзорный лист через sharp
  try {
    const sharp = (await import('sharp')).default;
    const tiles = [];
    for (const [name] of SHOTS) {
      const f = `${out}/${name}.jpg`;
      if (!existsSync(f)) continue;
      const s = await sharp(f).stats();
      report.shots[name].mean = Math.round(s.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3);
      report.shots[name].stdev = Math.round(s.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3);
      tiles.push({ input: await sharp(f).resize(640, 360).toBuffer(), name });
    }
    const cols = 2; const rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * 640 + (cols + 1) * 16, height: rows * 360 + (rows + 1) * 16, channels: 3, background: '#0b1020' } })
      .composite(tiles.map((t, i) => ({ input: t.input, left: 16 + (i % cols) * 656, top: 16 + Math.floor(i / cols) * 376 })))
      .jpeg({ quality: 85 }).toFile(`${out}/00-overview.jpg`);
  } catch (e) { report.notes.push(`sharp: ${String(e?.message ?? e).slice(0, 300)}`); }
  const readme = ['# «Купол» — скриншоты игры', '', 'Снято автоматически в Chrome, 1920×1080, без интернета (встроенный глобус).', '', '![Обзор](00-overview.jpg)', '',
    ...SHOTS.filter(([n]) => existsSync(`${out}/${n}.jpg`)).flatMap(([n, cap]) => [`## ${cap}`, '', `![${cap}](${n}.jpg)`, ''])].join('\n');
  writeFileSync(`${out}/README.md`, readme);
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/screenshots && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: скриншоты «Купола»"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/screenshots`, { cwd: out, stdio: 'inherit' });
});
