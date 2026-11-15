// Живая проверка адаптива качества. Считает ли governor кадры настоящего
// браузера, дёргает ли он реальные настройки Cesium и не трогает ли качество,
// пока открыт полигон.
//
// Вьюпорт нарочно мелкий (560x315): на SwiftShader кадр здесь ~0,3-0,8 с, т.е.
// попадает в диапазон «настоящий медленный кадр» и не выбрасывается защитой от
// сна вкладки (MAX_FRAME_MS = 1000). На 1440x900 этот же растер даёт ~3 с на
// кадр — такие выборки модуль считает уснувшей вкладкой и игнорирует, поэтому
// большой вьюпорт ничего не показал бы.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const base = process.env.PERF_BASE || `http://127.0.0.1:${Number(process.env.PERF_PORT || 4209)}`;
const port = new URL(base).port || '80';
let server = null;
let serverOutput = '';
const alreadyUp = await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
if (!alreadyUp) {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: port, HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => { serverOutput += c.toString(); });
  server.stderr.on('data', (c) => { serverOutput += c.toString(); });
}

const checks = [];
const check = (ok, what, detail = '') => {
  checks.push({ ok, what });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const read = (page) => page.evaluate(() => {
  const v = window.__kupol.viewer;
  const s = v.scene;
  const root = document.getElementById('kupol-root');
  return {
    state: window.__kupol.perf.state(),
    msaa: s.msaaSamples,
    scale: v.resolutionScale,
    sse: s.globe.maximumScreenSpaceError,
    sky: s.skyAtmosphere.show,
    fog: s.fog.enabled,
    ground: s.globe.showGroundAtmosphere,
    flat: root.classList.contains('k-perf-flat'),
    blur: getComputedStyle(document.querySelector('.k-zoom button')).backdropFilter,
    cinema: root.classList.contains('k-cinema'),
    dead: Boolean(document.querySelector('.cesium-widget-errorPanel')),
    toast: [...document.querySelectorAll('.k-toast')].map((n) => n.textContent).join(' / '),
  };
});

let browser;
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) break;
    } catch { /* стартует */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${outDir}/chrome-perf`,
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 560, height: 315 });
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });

  check(await page.evaluate(() => typeof window.__kupol.perf?.state === 'function'), 'двигатель качества подключён к игре');

  // Опускаемся к земле: на орбите кадры лёгкие, и проверять было бы нечего.
  await page.evaluate(() => {
    const v = window.__kupol.viewer;
    const c = v.camera.positionCartographic;
    v.camera.setView({ destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 900000) });
  });
  // Окно — 40 кадров, а кадр здесь ~0,5-0,8 с: ждём с запасом, иначе проверка
  // снимала бы тёплый старт вместо решения.
  await new Promise((r) => setTimeout(r, 35000));

  const slow = await read(page);
  console.log(`после 35 с полёта: ${JSON.stringify(slow)}`);
  check(!slow.dead, 'рендер жив после переключений');
  check(slow.state.frames >= 12, 'cadence реального браузера наполняет окно', `кадров в окне ${slow.state.frames}`);
  check(slow.state.fps !== null, 'адаптив видит частоту кадров игрока', `fps ${slow.state.fps}`);
  check(!(slow.state.fps < 30) || slow.state.rung < 3,
    'на медленном кадре ступень опущена', `fps ${slow.state.fps}, ступень ${slow.state.name}`);
  if (slow.state.rung < 3) {
    const expect = { 0: [1, 0.7, 3.5, false, false], 1: [1, 0.85, 2.5, true, true], 2: [2, 1, 2, true, true] }[slow.state.rung];
    check(slow.msaa === expect[0] && slow.scale === expect[1] && slow.sse === expect[2]
      && slow.sky === expect[3] && slow.fog === expect[4],
    `ступень «${slow.state.name}» физически стоит на сцене`, JSON.stringify([slow.msaa, slow.scale, slow.sse, slow.sky, slow.fog]));
    check(slow.flat === (slow.state.rung <= 1) && slow.blur === (slow.state.rung <= 1 ? 'none' : 'blur(14px) saturate(1.2)'),
      'размытие панелей следует за ступенью', `${slow.blur}, класс ${slow.flat}`);
  }

  // Витрина: открытие полигона обязано вернуть полное качество и заморозить
  // адаптив, пока игрок смотрит на гриб.
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  await new Promise((r) => setTimeout(r, 1500));
  const showcase = await read(page);
  console.log(`в полигоне: ${JSON.stringify(showcase)}`);
  check(showcase.cinema && showcase.state.rung === 3 && showcase.msaa === 4 && showcase.scale === 1
    && showcase.sse === 2 && showcase.sky === true && showcase.blur !== 'none',
  'полигон вернул полное качество', `ступень ${showcase.state.name}, blur ${showcase.blur}`);

  // И не трогает его, пока полигон открыт: ждём вдвое дольше нужного окну.
  await new Promise((r) => setTimeout(r, 20000));
  const held = await read(page);
  check(held.state.rung === 3, 'пока полигон открыт, ступень не падает', `fps ${held.state.fps}, ступень ${held.state.name}`);

  await page.click('.k-nrange-panel [data-close]');
  await new Promise((r) => setTimeout(r, 30000));
  const resumed = await read(page);
  console.log(`после полигона: ${JSON.stringify(resumed)}`);
  check(resumed.state.rung < 3, 'закрытый полигон вернул адаптив в работу', `ступень ${resumed.state.name} при fps ${resumed.state.fps}`);
  check(pageErrors.length === 0, `нет непойманных ошибок страницы (${pageErrors.length})`, pageErrors.slice(0, 3).join(' | '));
  console.log(`ИТОГ: ${checks.filter((c) => c.ok).length}/${checks.length}`);
} catch (error) {
  console.error(`PERF CHECK FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput.slice(0, 600));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
