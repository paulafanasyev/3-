// Замер: продвигается ли camera.flyTo* в игре. Перелёты Cesium идут по времени
// часов сцены; если viewer.clock не тикает, tween стоит на месте и кадр
// испытания никогда не приезжает — тогда «шар вместо гриба» объясняется позой
// камеры, а не шейдером.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4202);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const h = await fetch(`${base}/api/health`);
      if (h.ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* стартует */ }
    await sleep(500);
  }
  throw new Error(`server did not start: ${serverOutput.slice(-800)}`);
}

// Cartesian3 берём из живого объекта: глобала Cesium в игре нет.
const HELPERS = `
  window.__h = { v: window.__kupol.viewer, C3: window.__kupol.viewer.camera.positionWC.constructor };
`;
const POSE = () => {
  const v = window.__kupol.viewer;
  const c = v.camera;
  const cr = c.positionCartographic;
  return {
    h: Math.round(cr.height),
    pitch: Math.round(c.pitch * 57.2958),
    lon: +(cr.longitude * 57.2958).toFixed(4),
    lat: +(cr.latitude * 57.2958).toFixed(4),
    clockSec: +v.clock.currentTime.secondsOfDay.toFixed(2),
    animate: v.clock.shouldAnimate,
    tweenKeys: Object.keys(c).filter((k) => /tween|flight/i.test(k))
      .map((k) => `${k}=${c[k] === null ? 'null' : typeof c[k] === 'number' ? Math.round(c[k] * 100) / 100 : !!c[k]}`),
  };
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofile6',
    headless: 'new', protocolTimeout: 900000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 560 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.5; });
  await page.evaluate(HELPERS);
  console.log('game ready');

  const t0 = await page.evaluate(() => window.__kupol.viewer.clock.currentTime.secondsOfDay);
  await sleep(2000);
  const t1 = await page.evaluate(() => window.__kupol.viewer.clock.currentTime.secondsOfDay);
  console.log('CLOCK delta over 2 s real =', (t1 - t0).toFixed(3), 's');

  await page.evaluate(() => {
    const { v, C3 } = window.__h;
    // Тот же кадр, что ставит полигон перед испытанием, но через flyTo:
    // механизм tween тот же, а BoundingSphere собирать не надо.
    v.camera.flyTo({
      destination: C3.fromDegrees(-0.1276, 51.48, 3400),
      orientation: { heading: 0, pitch: -0.192, roll: 0 },
      duration: 2.2,
    });
  });
  let prev = 0;
  for (const ms of [500, 1500, 3000, 6000]) {
    await sleep(ms - prev); prev = ms;
    console.log(`  pose@+${ms}ms`, JSON.stringify(await page.evaluate(POSE)));
  }

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', 'little-boy');
  await page.click('#k-nrange-city-query');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#k-nrange-city-query', 'London', { delay: 30 });
  await page.waitForFunction((name) => {
    const s = document.querySelector('#k-nrange-city-results');
    return s && [...s.options].some((o) => o.textContent.startsWith(`${name} ·`));
  }, { timeout: 30000 }, 'London');
  const value = await page.$eval('#k-nrange-city-results',
    (s, name) => [...s.options].find((o) => o.textContent.startsWith(`${name} ·`)).value, 'London');
  console.log('  pose before city select', JSON.stringify(await page.evaluate(POSE)));
  await page.select('#k-nrange-city-results', value);
  prev = 0;
  for (const ms of [1000, 2500, 5000, 9000]) {
    await sleep(ms - prev); prev = ms;
    console.log(`  pose@+${ms}ms after city`, JSON.stringify(await page.evaluate(POSE)));
  }
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/cam_after_city.png' });
  console.log('CAM CHECK DONE');
} catch (e) {
  console.error('CAM CHECK FAIL:', e.stack || e);
  if (serverOutput) console.error(serverOutput.slice(-800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
