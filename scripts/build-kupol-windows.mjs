#!/usr/bin/env node
// Сборка «Купола» для Windows: Kupol.exe (Node single executable application) + ресурсы игры
// в архиве Kupol-win64.zip. Игроку не нужен ни Node, ни интернет: распаковал, запустил Kupol.exe,
// игра открылась в браузере по адресу http://127.0.0.1:<порт>/kupol.
//
//   node scripts/build-kupol-windows.mjs            сборка в output/windows
//   node scripts/build-kupol-windows.mjs --smoke    плюс проверка того же запускателя под Linux
//
// Нужны: зависимости проекта (npm ci), интернет (node.exe с nodejs.org и postject через npx),
// утилита zip. Сборку можно делать на Linux: blob без снимка и кэша кода переносим между ОС.
import { execSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const POSTJECT = 'postject@1.0.0-alpha.6';

// Запускатель внутри Kupol.exe. Внутри SEA require() видит только встроенные модули,
// поэтому файлы игры грузятся через createRequire, а ESM-сервер — через start.cjs.
export const LAUNCHER = String.raw`'use strict';
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { createRequire } = require('node:module');
const { exec } = require('node:child_process');

const fs = require('node:fs');
const os = require('node:os');
const util = require('node:util');

const root = process.env.KUPOL_ROOT || path.dirname(process.execPath);
const app = path.join(root, 'resources', 'app');
const start = path.join(app, 'start.cjs');

// Вывод, который не роняет игру: если окна консоли нет или канал вывода сломан (EBADF),
// пишем только в kupol.log рядом с Kupol.exe (или во временную папку, если туда нельзя).
const logFile = (() => {
  for (const dir of [root, os.tmpdir()]) {
    try { const f = path.join(dir, 'kupol.log'); fs.writeFileSync(f, ''); return f; } catch { /* следующая папка */ }
  }
  return null;
})();
function emit(stream, text) {
  try { process[stream].write(text + '\n'); } catch { /* консоли нет — остаётся файл */ }
  if (logFile) { try { fs.appendFileSync(logFile, text + '\n'); } catch { /* диск недоступен */ } }
}
const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : (a && a.stack) || util.inspect(a))).join(' ');
// служебные английские строки сервера игроку не нужны, но в журнал попадают
const quiet = (args) => typeof args[0] === 'string' && args[0].startsWith('[nuclear-gods-eye]');
console.log = console.info = (...args) => { if (quiet(args)) { if (logFile) { try { fs.appendFileSync(logFile, fmt(args) + '\n'); } catch {} } return; } emit('stdout', fmt(args)); };
console.warn = console.error = (...args) => emit('stderr', fmt(args));
for (const s of ['stdout', 'stderr']) { try { process[s].on('error', () => {}); } catch { /* потока нет */ } }
process.on('uncaughtException', (error) => { console.error('Ошибка «Купола»: ' + ((error && error.stack) || error)); });

function pickPort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(preferred === 0 ? 0 : pickPort(0)));
    probe.listen(preferred, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

function alive(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
  });
}

function openBrowser(url) {
  if (process.env.KUPOL_NO_BROWSER) return;
  if (process.platform === 'win32') exec('start "" "' + url + '"');
  else if (process.platform === 'darwin') exec('open "' + url + '"');
  else exec('xdg-open "' + url + '"');
}

(async () => {
  console.log('«Купол» запускается…');
  const port = await pickPort(Number(process.env.PORT) || 4173);
  Object.assign(process.env, { PORT: String(port), HOST: '127.0.0.1', GEV_API_PROXIES: '0', NODE_ENV: 'production' });
  const url = 'http://127.0.0.1:' + port + '/kupol';
  await createRequire(start)(start)();
  let ready = false;
  for (let i = 0; i < 150 && !ready; i += 1) {
    ready = await alive(url);
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('сервер игры не ответил за 30 секунд');
  console.log('');
  console.log('Игра открыта в браузере: ' + url);
  console.log('Если браузер не открылся, скопируйте этот адрес в адресную строку.');
  console.log('Чтобы выйти из игры, закройте это окно.');
  openBrowser(url);
})().catch((error) => {
  console.error('');
  console.error('Не удалось запустить «Купол»: ' + (error && error.message ? error.message : error));
  if (logFile) console.error('Подробности записаны в файл: ' + logFile);
  console.error('Окно закроется через 60 секунд.');
  setTimeout(() => process.exit(1), 60000);
});
`;

export const START = `'use strict';
// Загружается из Kupol.exe: подключает сервер игры (ESM) с диска.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
module.exports = () => import(pathToFileURL(path.join(__dirname, 'kupol-server.mjs')).href);
`;

const README = [
  '«Купол» для Windows',
  '',
  '1. Распакуйте архив целиком в любую папку (не запускайте игру прямо из архива).',
  '2. Запустите Kupol.exe. Откроется чёрное окно сервера, а игра откроется в браузере.',
  '3. Если Windows покажет «Система Windows защитила ваш компьютер», нажмите «Подробнее»',
  '   и «Выполнить в любом случае»: файл не подписан сертификатом, это ожидаемо.',
  '4. Чтобы выйти, закройте чёрное окно. Партия живёт, пока открыто окно сервера.',
  '5. Если что-то пошло не так, рядом с Kupol.exe появится файл kupol.log — пришлите его разработчику.',
  '',
  'Интернет не нужен: глобус работает на встроенном снимке Земли.',
  'Игра слушает только этот компьютер (127.0.0.1), снаружи к ней подключиться нельзя.',
  'Список авторов и лицензий ресурсов: CREDITS.md.',
  '',
].join('\r\n');

const sh = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

async function bundleServer(appDir) {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [join(root, 'server.js')],
    outfile: join(appDir, 'kupol-server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['vite', 'bufferutil', 'utf-8-validate'],
    // ws — CommonJS: внутри ESM-бандла ему нужен настоящий require для встроенных модулей.
    banner: { js: "import { createRequire as __kupolCreateRequire } from 'node:module'; const require = __kupolCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  });
}

/** Собирает папку игры: resources/app (сервер, страница) и data/game (карта). */
export async function stageApp(stage, { distFrom = null } = {}) {
  rmSync(stage, { recursive: true, force: true });
  const app = join(stage, 'resources', 'app');
  mkdirSync(app, { recursive: true });
  if (distFrom) cpSync(distFrom, join(app, 'dist'), { recursive: true });
  else {
    // Портреты и модели юнитов генерируются (в git их нет); готовые не трогаем.
    if (!existsSync(join(root, 'public', 'game', 'leaders'))) sh('node scripts/game-portraits.mjs');
    if (!existsSync(join(root, 'public', 'game', 'units', 'forge'))) sh('node scripts/game-units.mjs');
    sh(`npx vite build --outDir "${join(app, 'dist')}" --emptyOutDir`);
    const { checkGameBuild } = await import(pathToFileURL(join(root, 'scripts', 'check-game-build.mjs')).href);
    const check = checkGameBuild(join(app, 'dist'));
    if (!check.ok) throw new Error(`сборка страницы неполная: ${check.errors.join('; ')}`);
  }
  await bundleServer(app);
  writeFileSync(join(app, 'start.cjs'), START);
  // map.js ищет карту по пути ../../data/game относительно бандла сервера.
  mkdirSync(join(stage, 'data', 'game'), { recursive: true });
  for (const f of ['map.json', 'real-names-stoplist.json']) copyFileSync(join(root, 'data', 'game', f), join(stage, 'data', 'game', f));
  writeFileSync(join(stage, 'Как запустить.txt'), `\uFEFF${README}`);
  if (existsSync(join(root, 'CREDITS.md'))) copyFileSync(join(root, 'CREDITS.md'), join(stage, 'CREDITS.md'));
  return app;
}

function seaBlob(work) {
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'sea-main.cjs'), LAUNCHER);
  writeFileSync(join(work, 'sea-config.json'), JSON.stringify({
    main: 'sea-main.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
  }));
  sh(`"${process.execPath}" --experimental-sea-config sea-config.json`, work);
  return join(work, 'sea-prep.blob');
}

function inject(binary, blob) {
  sh(`npx --yes ${POSTJECT} "${binary}" NODE_SEA_BLOB "${blob}" --sentinel-fuse ${FUSE} --overwrite`);
}

async function windowsNode(work) {
  const v = process.version;
  const url = `https://nodejs.org/dist/${v}/node-${v}-win-x64.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`не скачался ${url}: ${res.status}`);
  const zip = join(work, 'node-win.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  sh(`unzip -q -j -o "${zip}" "node-${v}-win-x64/node.exe" -d "${work}"`);
  return join(work, 'node.exe');
}

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Запускает собранный бинарник (Linux-версию того же запускателя) и играет первый ход по WebSocket. */
export async function smoke(binary, { timeoutMs = 60000 } = {}) {
  const port = await freePort();
  const child = spawn(binary, [], { env: { ...process.env, PORT: String(port), KUPOL_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    const t0 = Date.now();
    while (!log.includes('Игра открыта') && Date.now() - t0 < timeoutMs) {
      if (child.exitCode !== null) throw new Error(`запускатель завершился: ${log}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:(\d+)\/kupol/)?.[0];
    if (!url) throw new Error(`нет строки «Игра открыта»: ${log}`);
    const page = await fetch(url);
    const html = await page.text();
    if (page.status !== 200 || !/<html/i.test(html)) throw new Error(`/kupol ответил ${page.status}`);
    const wsUrl = url.replace('http', 'ws').replace('/kupol', '/ws');
    const turn = await new Promise((resolveTurn, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error('нет game:state за 20 с')); }, 20000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'game:new', setup: { player: 'borea' } }));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'game:state') { clearTimeout(timer); ws.close(); resolveTurn(m.state?.turn ?? m.snapshot?.turn ?? m.turn ?? true); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('ошибка WebSocket')); };
    });
    return { ok: true, url, turn, log };
  } finally {
    child.kill('SIGKILL');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const out = resolve(process.env.KUPOL_WIN_OUT || join(root, 'output', 'windows'));
  const stage = join(out, 'Kupol');
  const work = join(out, '.work');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const report = { node: process.version, at: new Date().toISOString() };
  await stageApp(stage);
  const blob = seaBlob(work);
  if (args.has('--smoke')) {
    const linux = join(stage, 'kupol-linux-smoke');
    copyFileSync(process.execPath, linux);
    chmodSync(linux, 0o755);
    inject(linux, blob);
    report.smoke = await smoke(linux);
    rmSync(linux, { force: true });
    rmSync(join(stage, 'kupol.log'), { force: true }); // журнал Linux-проверки в архив не нужен
    console.log(`[kupol-win] Linux-проверка запускателя: ${report.smoke.url}, ход ${report.smoke.turn}`);
  }
  const exe = join(stage, 'Kupol.exe');
  copyFileSync(await windowsNode(work), exe);
  inject(exe, blob);
  const head = readFileSync(exe).subarray(0, 2).toString('latin1');
  if (head !== 'MZ') throw new Error('Kupol.exe не похож на программу Windows');
  report.exeBytes = statSync(exe).size;
  rmSync(work, { recursive: true, force: true });
  sh('zip -q -r -9 Kupol-win64.zip Kupol', out);
  report.zipBytes = statSync(join(out, 'Kupol-win64.zip')).size;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[kupol-win] готово: ${join(out, 'Kupol-win64.zip')} (${Math.round(report.zipBytes / 1048576)} МБ)`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error('[kupol-win] ошибка:', error?.stack ?? error); process.exit(1); });
}
export { main };
