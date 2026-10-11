// Разово в CI: проверка настоящего Kupol.exe из пре-релиза rc.2 под Wine (Windows-слой на Linux).
// Скачивает архив релиза (сверка SHA-256), запускает Kupol.exe, играет через WebSocket и в Chrome.
// Никогда не роняет CI: отчёт и скриншот — в ветку ci/wine-check.
import test from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findChrome } from '../../scripts/kupol-browser-smoke.mjs';

const FLAG = '/tmp/kupol-wine2.done';
const ZIP_URL = 'https://github.com/paulafanasyev/3-/releases/download/kupol-v1.0.0-rc.2-win/Kupol-win64.zip';
const ZIP_SHA = '9fe12ffe95fc343cd61acbd38fb29073b143fdd010b521afd7dcc1dfc29f93fd';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('CI: Kupol.exe под Wine', { skip: !process.env.GITHUB_ACTIONS || existsSync(FLAG), timeout: 1500000 }, async () => {
  writeFileSync(FLAG, '1');
  const root = execSync('git rev-parse --show-toplevel').toString().trim();
  const out = '/tmp/kupol-wine-out'; mkdirSync(out, { recursive: true });
  const work = '/tmp/kupol-wine'; mkdirSync(work, { recursive: true });
  const report = { at: new Date().toISOString(), commit: process.env.GITHUB_SHA, ok: false, steps: [] };
  const step = (s) => { report.steps.push(s); };
  let exe = null; let chrome = null;
  try {
    const zip = Buffer.from(await (await fetch(ZIP_URL)).arrayBuffer());
    const sha = createHash('sha256').update(zip).digest('hex');
    step(`архив релиза: ${zip.length} байт, sha совпал: ${sha === ZIP_SHA}`);
    if (sha !== ZIP_SHA) throw new Error('sha архива не совпал');
    writeFileSync(`${work}/k.zip`, zip);
    execSync(`cd ${work} && unzip -q -o k.zip`);
    step(`файлы: ${execSync(`ls ${work}/Kupol`).toString().trim().split('\n').join(', ')}`);
    const t0 = Date.now();
    execSync('sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wine64 >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wine >/dev/null 2>&1', { stdio: 'inherit', timeout: 600000 });
    const wine = ['wine64', 'wine'].map((w) => { try { return execSync(`command -v ${w}`).toString().trim(); } catch { return null; } }).find(Boolean);
    if (!wine) throw new Error('Wine не установился');
    step(`Wine: ${execSync(`${wine} --version`).toString().trim()} (установка ${Math.round((Date.now() - t0) / 1000)} с)`);
    const env = { ...process.env, WINEPREFIX: `${process.env.HOME}/.kupol-wineprefix`, WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=', KUPOL_NO_BROWSER: '1', PORT: '4791', DISPLAY: '' };
    try { execSync(`${wine} wineboot --init`, { env, stdio: 'ignore', timeout: 180000 }); } catch (e) { step(`wineboot: ${String(e.message).slice(0, 120)}`); }
    // вывод в файл, а не в канал: Wine отдаёт Node канал stdio, который тот не может открыть (EBADF)
    let log = '';
    const logFile = `${work}/exe.log`;
    exe = spawn('sh', ['-c', `exec "${wine}" "${work}/Kupol/Kupol.exe" > "${logFile}" 2>&1 < /dev/null`], { env, cwd: `${work}/Kupol`, stdio: 'ignore' });
    const t1 = Date.now();
    while (!log.includes('Игра открыта') && Date.now() - t1 < 180000) {
      if (exe.exitCode !== null) break;
      await sleep(500);
      try { log = readFileSync(logFile, 'utf8'); } catch {}
    }
    try { log = readFileSync(logFile, 'utf8'); } catch {}
    report.exeLog = log.slice(-2500);
    const url = log.match(/http:\/\/127\.0\.0\.1:(\d+)\/kupol/)?.[0];
    if (!url) throw new Error('Kupol.exe не написал адрес игры');
    step(`Kupol.exe запустился за ${Math.round((Date.now() - t1) / 1000)} с: ${url}`);
    const page = await fetch(url); const html = await page.text();
    step(`страница /kupol: ${page.status}, html: ${/<html/i.test(html)}`);
    const turn = await new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace('http', 'ws').replace('/kupol', '/ws'));
      const timer = setTimeout(() => { ws.close(); reject(new Error('нет game:state')); }, 30000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'game:new', setup: { player: 'borea' } }));
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'game:state') { clearTimeout(timer); ws.close(); resolve(m.state?.turn ?? true); } };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('ошибка WebSocket')); };
    });
    step(`WebSocket: новая партия, ход ${turn}`);
    // Chrome против сервера из exe: выбор нации, партия, конец хода
    const port = 9600 + Math.floor(Math.random() * 300);
    chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--window-size=1920,1080', `--user-data-dir=/tmp/kupol-wine-chrome-${port}`, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'], { stdio: 'ignore' });
    let ver = null; for (let i = 0; i < 100 && !ver; i += 1) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP')); });
    let id = 0; const pending = new Map(); const errors = [];
    const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const waitFor = async (expression, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await ev(expression); if (v) return v; await sleep(300); } return null; };
    await send('Page.navigate', { url });
    const start = await waitFor("!!document.querySelector('.k-start button[data-id]')", 90000);
    step(`Chrome: экран выбора нации ${start ? 'есть' : 'НЕ появился'}`);
    if (start) {
      await ev("document.querySelector('.k-start button[data-id]').click(); true");
      const t = await waitFor('window.__kupol?.state?.turn ?? null', 60000);
      step(`Chrome: партия началась, ход ${t}`);
      await sleep(8000);
      report.canvas = await ev("!!document.querySelector('#kupol-globe canvas')");
      const png = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      if (png.result?.data) writeFileSync(`${out}/exe-game.jpg`, Buffer.from(png.result.data, 'base64'));
      await ev('window.__kupol.endTurn(); true');
      const t2 = await waitFor('(window.__kupol?.state?.turn ?? 0) > 1 ? window.__kupol.state.turn : null', 60000);
      step(`Chrome: конец хода → ход ${t2}`);
      report.ok = Boolean(t && t2 && report.canvas);
    }
    report.pageErrors = errors.slice(0, 10);
    try { ws.close(); } catch {}
  } catch (e) {
    report.error = String(e?.message ?? e).slice(0, 1500);
  } finally {
    chrome?.kill('SIGKILL');
    exe?.kill('SIGKILL');
    try { execSync('wineserver -k || true', { stdio: 'ignore', env: { ...process.env, WINEPREFIX: `${process.env.HOME}/.kupol-wineprefix` } }); } catch {}
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const header = execSync('git config --get http.https://github.com/.extraheader || true', { cwd: root }).toString().trim();
  const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
  const o = (c) => execSync(c, { cwd: out, stdio: 'inherit' });
  o('git init -q && git checkout -q -b ci/wine-check && git add -A');
  o('git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "CI: Kupol.exe под Wine"');
  execSync(`git ${header ? `-c http.https://github.com/.extraheader="${header}"` : ''} push -f ${remote} ci/wine-check`, { cwd: out, stdio: 'inherit' });
});
