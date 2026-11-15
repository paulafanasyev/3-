// Живая проверка зума и кинотеатра полигона: колесо на реальной скорости
// скролла, кнопки «+/−», упор в пределы, прятки интерфейса и полёт сквозь
// испытание. Снимки — в D:/mt5/tmp-nuclear.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const base = process.env.CAMERA_BASE || `http://127.0.0.1:${Number(process.env.CAMERA_PORT || 4203)}`;
const port = new URL(base).port || '80';
let serverOutput = '';
let server = null;
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
function check(condition, message, detail = '') {
  checks.push({ ok: Boolean(condition), message, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${message}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* сервер ещё стартует */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`превью не поднялось: ${serverOutput.slice(0, 400)}`);
}

const state = (page) => page.evaluate(() => {
  const v = window.__kupol.viewer;
  const c = v.scene.screenSpaceCameraController;
  return {
    height: v.camera.positionCartographic.height,
    range: window.__kupol.zoom.range(),
    min: c.minimumZoomDistance,
    max: c.maximumZoomDistance,
    // список событий зума живёт на внутреннем перечислении движений: длина тут
    // ничего не доказывает — [undefined, undefined] пройдёт по длине и через
    // кадр вешает рендер. Значит смотрим значения и убеждаемся, что колесо (16)
    // на месте: мы его перехватываем раньше Cesium, а не вычёркиваем из списка
    zoomTypes: c.zoomEventTypes.join(','),
    zoomTypesClean: c.zoomEventTypes.every((n) => Number.isInteger(n)),
    // Cesium пишет панель «An error occurred while rendering» прямо в виджет
    renderDead: Boolean(document.querySelector('.cesium-widget-errorPanel')),
  };
});

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${outDir}/chrome-camera`,
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });
  await page.waitForSelector('.k-nrange-trigger', { timeout: 60000 });
  await page.waitForSelector('.k-zoom button[data-act="zoomIn"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));

  const first = await state(page);
  // замерено живьём: дефолт Cesium — 1,3,4 (внутренний перечислитель движений,
  // где 3 = колесо). Публичный ScreenSpaceEventType.WHEEL — это 16, и подставить
  // его сюда значит получить undefined в списке и вставший рендер
  check(!first.renderDead && first.zoomTypesClean && first.zoomTypes.split(',').includes('3')
    && first.zoomTypes === '1,3,4' && first.min === 1 && first.max === 4.5e7,
    'колесо перехвачено до Cesium, его список не тронут, пределы стоят',
    JSON.stringify({ min: first.min, max: first.max, zoomTypes: first.zoomTypes, renderDead: first.renderDead }));

  // 1. Колесо на скорости живого скролла: ровно то, что раньше давало ноль.
  const wheel = (deltaY, times, gapMs) => page.evaluate(async ({ d, n, gap }) => {
    const canvas = document.querySelector('#kupol-globe canvas');
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < n; i += 1) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: d, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        bubbles: true, cancelable: true,
      }));
      await new Promise((r) => setTimeout(r, gap));
    }
  }, { d: deltaY, n: times, gap: gapMs });

  const beforeFast = await state(page);
  await wheel(-100, 10, 40);
  const afterFast = await state(page);
  const perNotch = Math.pow(beforeFast.range / afterFast.range, 0.1);
  check(perNotch > 1.2 && perNotch < 1.7, 'десять щелчков подряд реально жмут зум',
    `${Math.round(beforeFast.range / 1000)} км → ${Math.round(afterFast.range / 1000)} км, за щелчок ×${perNotch.toFixed(3)}`);

  // 2. Пол до упора: метр над крышей.
  await wheel(-100, 60, 25);
  const floor = await state(page);
  check(floor.range < 50, 'зум вниз до предела — камера у земли', `${Math.round(floor.range * 100) / 100} м, высота ${Math.round(floor.height * 100) / 100} м`);
  await page.screenshot({ path: `${outDir}/camera-01-rooftop.png` });

  // 3. Потолок до упора: весь диск.
  await wheel(100, 80, 25);
  const ceil = await state(page);
  check(ceil.range >= 4.4e7, 'зум вверх до предела — весь Земной диск', `${Math.round(ceil.range / 1000)} км`);
  await page.screenshot({ path: `${outDir}/camera-02-whole-earth.png` });

  // 4. Кнопки: тот же шаг, что колесо, и в обе стороны.
  const clickZoom = (act, times) => page.evaluate(async ({ a, n }) => {
    const b = document.querySelector(`.k-zoom button[data-act="${a}"]`);
    for (let i = 0; i < n; i += 1) { b.click(); await new Promise((r) => setTimeout(r, 120)); }
  }, { a: act, n: times });
  await wheel(-100, 20, 25);
  const beforeBtn = await state(page);
  await clickZoom('zoomIn', 3);
  const afterIn = await state(page);
  const buttonRatio = beforeBtn.range / afterIn.range;
  check(Math.abs(buttonRatio - 1.8 ** 3) / 1.8 ** 3 < 0.05, 'кнопка «+» жмёт ровно по три шага',
    `×${buttonRatio.toFixed(2)}, ожидалось ×${(1.8 ** 3).toFixed(2)}`);
  await clickZoom('zoomOut', 3);
  const afterOut = await state(page);
  check(afterOut.range > afterIn.range * 4.5, 'кнопка «−» возвращает назад', `${Math.round(afterIn.range)} м → ${Math.round(afterOut.range)} м`);

  // 5. Кинотеатр: меню партии исчезает с полигоном и возвращается без него.
  const vis = () => page.evaluate(() => {
    const of = (s) => getComputedStyle(document.querySelector(s)).visibility;
    return { top: of('.k-top'), left: of('.k-left'), right: of('.k-right'), chron: of('.k-chron'), end: of('.k-end'), zoom: of('.k-zoom'), panel: document.querySelector('.k-nrange-panel').hidden };
  });
  const plain = await vis();
  check(plain.top === 'visible' && plain.left === 'visible' && plain.zoom === 'visible', 'вне полигона меню видно', JSON.stringify(plain));
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  await new Promise((r) => setTimeout(r, 600));
  const cinema = await vis();
  check(['top', 'left', 'right', 'chron', 'end'].every((k) => cinema[k] === 'hidden') && cinema.zoom === 'visible',
    'полигон спрятал меню партии и оставил масштаб', JSON.stringify(cinema));
  await page.screenshot({ path: `${outDir}/camera-03-cinema.png` });
  // именно здесь в прошлый раз умер рендер: кадр кинотеатра и есть та проверка,
  // которую глаз видит раньше лога
  const cinemaState = await state(page);
  check(!cinemaState.renderDead, 'пока полигон открыт, рендер жив', `zoomTypes ${cinemaState.zoomTypes}`);

  // 6. Испытание чужим городом + полёт камеры прямо во время гриба.
  await page.type('#k-nrange-city-query', 'Tokyo');
  await page.waitForFunction(() => [...document.querySelectorAll('#k-nrange-city-results option')].some((o) => o.textContent.startsWith('Tokyo ·')), { timeout: 20000 });
  await page.select('#k-nrange-city-results', await page.$eval('#k-nrange-city-results', (s) => [...s.options].find((o) => o.textContent.startsWith('Tokyo ·')).value));
  await new Promise((r) => setTimeout(r, 3000));
  const beforeTest = await page.evaluate(() => window.__kupol.viewer.camera.positionWC.y);
  await page.click('[data-test]');
  await new Promise((r) => setTimeout(r, 6000));
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 2500));
  const flown = await page.evaluate(() => window.__kupol.viewer.camera.positionWC.y);
  await page.keyboard.up('KeyW');
  check(Math.abs(flown - beforeTest) > 1000, 'W летит сквозь испытание, авто-кадр не держит',
    `сдвиг ${Math.round(Math.abs(flown - beforeTest))} м`);
  await page.screenshot({ path: `${outDir}/camera-04-blast-flight.png` });

  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 180000 });
  check(true, 'испытание дошло до конца под спрятанным меню');

  // 7. Закрытие полигона возвращает интерфейс.
  await page.click('.k-nrange-panel [data-close]');
  await new Promise((r) => setTimeout(r, 600));
  const restored = await vis();
  check(restored.top === 'visible' && restored.panel === true, 'закрыл полигон — меню партии вернулось', JSON.stringify(restored));

  const afterBlast = await state(page);
  check(!afterBlast.renderDead, 'после полёта сквозь гриб рендер жив', `range ${Math.round(afterBlast.range)} м`);

  check(pageErrors.length === 0, `нет непойманных ошибок страницы (${pageErrors.length})`, pageErrors.slice(0, 3).join(' | '));
  console.log(`ИТОГ: ${checks.filter((c) => c.ok).length}/${checks.length}`);
} catch (error) {
  console.error(`CAMERA CHECK FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput.slice(0, 800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
