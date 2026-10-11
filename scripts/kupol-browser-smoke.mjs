#!/usr/bin/env node
// Дымовая проверка «Купола» в настоящем браузере: поднимает dev-сервер (scripts/kupol-dev.mjs)
// без ключа Google, открывает /kupol в headless Chrome с отрезанной внешней сетью и ждёт,
// пока встанет запасной глобус Natural Earth. Без зависимостей: Chrome DevTools Protocol
// через встроенный WebSocket Node.
//   node scripts/kupol-browser-smoke.mjs [--shot out.png] [--online]
// Код выхода 1 — если игра не запустилась или глобус не загрузился.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE_TOAST = 'Офлайн-глобус';

/** Путь к Chrome/Chromium или null. */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    return execSync('command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser', { shell: '/bin/sh' })
      .toString().trim().split('\n')[0] || null;
  } catch { return null; }
}

/** Dev-сервер «Купола» без ключа Google. Возвращает { url, stop, log }. */
export async function startDevServer({ timeoutMs = 60000 } = {}) {
  const env = { ...process.env, GOOGLE_MAPS_API_KEY: '' };
  delete env.NODE_TEST_CONTEXT; // иначе вложенный процесс считает себя частью node --test
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts/kupol-dev.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const add = (d) => { log += d.toString().replace(/\x1b\[[0-9;]*m/g, ''); };
  proc.stdout.on('data', add); proc.stderr.on('data', add);
  const t0 = Date.now();
  while (!/Local:\s+\S+/.test(log)) {
    if (proc.exitCode !== null) throw new Error(`dev-сервер упал:\n${log.slice(-2000)}`);
    if (Date.now() - t0 > timeoutMs) { proc.kill('SIGKILL'); throw new Error(`dev-сервер не поднялся:\n${log.slice(-2000)}`); }
    await sleep(250);
  }
  const url = log.match(/Local:\s+(\S+)/)[1].replace(/\/$/, '');
  return { url, stop: () => proc.kill('SIGKILL'), get log() { return log; } };
}

async function cdp(port) {
  let version = null;
  for (let i = 0; i < 100 && !version; i += 1) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); }
  }
  if (!version) throw new Error('Chrome не открыл порт отладки');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP: нет соединения')); });
  let id = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else handlers.forEach((h) => h(m));
  };
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  return { send, on: (h) => handlers.push(h), close: () => ws.close() };
}

/**
 * Открыть страницу и дождаться глобуса. offline: внешняя сеть отрезана мёртвым прокси
 * (локальный сервер доступен). Возвращает отчёт; ok — всё в порядке.
 */
export async function smokeKupol({ url, chrome = findChrome(), offline = true, timeoutMs = 45000, shot = null } = {}) {
  if (!chrome) throw new Error('не найден Chrome/Chromium (можно указать CHROME_PATH)');
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', `--user-data-dir=/tmp/kupol-smoke-chrome-${port}`];
  if (offline) args.push('--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  const report = { offline, url, exceptions: [], consoleErrors: [], natural: { ok: 0, fail: 0 }, toasts: [], canvas: false, bootError: null, waitedMs: 0 };
  try {
    const s = await cdp(port);
    s.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') report.exceptions.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 500));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
      if (m.method === 'Network.responseReceived' && /NaturalEarthII\/\d/.test(m.params.response.url)) report.natural[m.params.response.status < 400 ? 'ok' : 'fail'] += 1;
    });
    await s.send('Runtime.enable'); await s.send('Network.enable'); await s.send('Page.enable');
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__kupolToasts=[];new MutationObserver(()=>{const t=document.querySelector('.k-toast');const a=window.__kupolToasts;if(t&&t.textContent&&a[a.length-1]!==t.textContent)a.push(t.textContent);}).observe(document,{subtree:true,childList:true,characterData:true});" });
    await s.send('Page.navigate', { url: `${url}/kupol` });
    const t0 = Date.now();
    const expectToast = offline ? OFFLINE_TOAST : '';
    for (;;) {
      await sleep(1000);
      const r = await s.send('Runtime.evaluate', { returnByValue: true, expression: "JSON.stringify({toasts: window.__kupolToasts || [], canvas: !!document.querySelector('.cesium-widget canvas'), body: document.body ? document.body.innerText.slice(0, 400) : ''})" });
      const v = JSON.parse(r.result?.result?.value ?? '{}');
      report.toasts = v.toasts ?? []; report.canvas = !!v.canvas; report.waitedMs = Date.now() - t0;
      const boot = /ошибка запуска[^\n]*/.exec(v.body ?? '');
      if (boot) { report.bootError = boot[0]; break; }
      const toastOk = report.toasts.some((x) => x.includes(expectToast));
      if (report.canvas && toastOk && report.natural.ok > 0) break;
      if (report.waitedMs > timeoutMs) break;
    }
    if (shot) {
      const png = await s.send('Page.captureScreenshot', { format: 'png' });
      if (png.result?.data) writeFileSync(shot, Buffer.from(png.result.data, 'base64'));
    }
    s.close();
  } finally { proc.kill('SIGKILL'); }
  report.problems = [];
  if (report.bootError) report.problems.push(`игра не запустилась: ${report.bootError}`);
  if (report.exceptions.length) report.problems.push(`исключения на странице: ${report.exceptions[0]}`);
  if (!report.canvas) report.problems.push('нет холста Cesium');
  if (report.natural.ok === 0) report.problems.push('не загрузился ни один тайл Natural Earth');
  if (offline && !report.toasts.some((x) => x.includes(OFFLINE_TOAST))) report.problems.push('нет подсказки об офлайн-глобусе');
  report.ok = report.problems.length === 0;
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const shotAt = process.argv.indexOf('--shot');
  const server = await startDevServer();
  try {
    const report = await smokeKupol({ url: server.url, offline: !process.argv.includes('--online'), shot: shotAt > 0 ? process.argv[shotAt + 1] : null });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally { server.stop(); }
}
