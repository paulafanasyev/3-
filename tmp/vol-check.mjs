// Одна чистая прогоновая съёмка: London + Little Boy, только объёмный гриб.
// Цель — измерить u_sunI/u_exposure (были NaN) и убедиться, что объёмный проход
// рисует пиксели: кадр с enabled=true и кадр с enabled=false в тот же момент.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4210);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* стартует */ }
    await sleep(500);
  }
  throw new Error(`server did not start: ${serverOutput.slice(-800)}`);
}

const PROBE = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
  const u = blast ? blast.uniforms : {};
  const num = (v) => (typeof v === 'number' ? v : null);
  const cam = window.__kupol.viewer.camera;
  const carto = window.__kupol.viewer.scene.globe.ellipsoid.cartesianToCartographic(cam.positionWC);
  return {
    stage: blast ? blast.name : null,
    sunI: String(u.u_sunI),
    exposure: String(u.u_exposure),
    age: num(u.u_age),
    boundR: num(u.u_boundR),
    flash: num(u.u_flash),
    show: blast ? !!blast.show : null,
    head: [num(u.u_head?.y), num(u.u_head?.w)],
    camH: Math.round(carto.height),
    pitch: Math.round(cam.pitch * 57.29578),
    range: Math.round(cam.positionCartographic ? cam.positionCartographic.height : 0),
    real: Math.round((performance.now() - (window.__t0 || performance.now())) / 10) / 100,
  };
};

// Яркость центра экрана: если объёмный проход рисует, включение/выключение
// обязано сдвинуть среднюю luminance.
const LUMA = () => {
  const canvas = window.__kupol.viewer.scene.canvas;
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const x0 = Math.round(c.width * 0.35), y0 = Math.round(c.height * 0.15);
  const w = Math.round(c.width * 0.3), h = Math.round(c.height * 0.5);
  const d = ctx.getImageData(x0, y0, w, h).data;
  let sum = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    sum += l;
    if (l > 200) bright += 1;
  }
  return { mean: Math.round(sum / (d.length / 4)), hot: Math.round(bright / (d.length / 4) * 1000) / 10 };
};

let browser;
try {
  await waitForServer();
  console.log('server up');
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileE',
    headless: 'new',
    protocolTimeout: 900000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 220)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 160)); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  console.log('game ready');
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.7; });

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', 'little-boy');
  await page.click('#k-nrange-city-query');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#k-nrange-city-query', 'London', { delay: 30 });
  await page.waitForFunction(() => {
    const select = document.querySelector('#k-nrange-city-results');
    return select && [...select.options].some((o) => o.textContent.startsWith('London ·'));
  }, { timeout: 30000 });
  const value = await page.$eval('#k-nrange-city-results', (select) => (
    [...select.options].find((o) => o.textContent.startsWith('London ·')).value
  ));
  await page.select('#k-nrange-city-results', value);
  await sleep(6000);

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  const status = await page.$eval('[data-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  console.log('status:', status);
  await page.evaluate(() => { window.__t0 = performance.now(); });
  await page.click('[data-close]');

  const frames = [[1, 'a'], [6, 'b'], [20, 'c'], [45, 'd'], [90, 'e'], [130, 'f']];
  for (const [sec, name] of frames) {
    await page.waitForFunction((t) => (performance.now() - (window.__t0 || 0)) / 1000 >= t,
      { timeout: 240000, polling: 200 }, sec).catch(() => {});
    const probe = await page.evaluate(PROBE);
    const lumaOn = await page.evaluate(LUMA);
    await page.screenshot({ path: `${outDir}/v9_lb_${name}.png` });
    let lumaOff = null;
    if (name === 'd') {
      await page.evaluate(() => {
        const col = window.__kupol.viewer.scene.postProcessStages;
        const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
        const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
        if (blast) { blast.enabled = false; window.__blast = blast; }
      });
      await sleep(1500);
      lumaOff = await page.evaluate(LUMA);
      await page.screenshot({ path: `${outDir}/v9_lb_${name}_voloff.png` });
      await page.evaluate(() => { if (window.__blast) window.__blast.enabled = true; });
    }
    console.log(`v9_lb_${name}@${sec}s`, JSON.stringify(probe), 'lumaOn', JSON.stringify(lumaOn), 'lumaOff', JSON.stringify(lumaOff));
  }

  console.log(`errors: ${errs.length ? JSON.stringify(errs.slice(-8)) : 'none'}`);
  console.log('V9 DONE');
} catch (error) {
  console.error('V9 FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
