// Живые снимки испытания на городе: тот же путь, что у игрока (полигон ->
// город -> «Запустить испытание»), но кадры в осмысленные моменты и замер
// uniforms объёмного гриба прямо из сцены.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4198);
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
  // PostProcessStageCollection — не массив: индекс доступа через get(i), итератора нет.
  const col = window.__kupol.viewer.scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
  const cam = window.__kupol.viewer.camera;
  const carto = window.__kupol.viewer.scene.globe.ellipsoid.cartesianToCartographic(cam.positionWC);
  const v = (u, i) => (typeof u === 'number' ? Math.round(u)
    : (u && u[i] !== undefined ? Math.round(u[i]) : null));
  const out = {
    stage: blast ? blast.name : null,
    enabled: blast ? !!blast.enabled : null,
    stages: stages.map((s) => `${s.name}:${s.enabled ? 1 : 0}`),
    age: v(blast?.uniforms?.u_age),
    boundR: v(blast?.uniforms?.u_boundR),
    head: [v(blast?.uniforms?.u_head?.y), v(blast?.uniforms?.u_head?.w)],
    stem: [v(blast?.uniforms?.u_stem?.w), v(blast?.uniforms?.u_stem?.y)],
    fb: [v(blast?.uniforms?.u_fb?.w), v(blast?.uniforms?.u_fb?.z)],
    skirt: [v(blast?.uniforms?.u_skirt?.x), v(blast?.uniforms?.u_skirt?.y), Number(blast?.uniforms?.u_skirt?.z ?? 0).toFixed(2), Number(blast?.uniforms?.u_skirtFront ?? 0)],
    shock: [v(blast?.uniforms?.u_shock?.x), Number(blast?.uniforms?.u_shock?.z ?? 0).toFixed(2), Number(blast?.uniforms?.u_shock2?.w ?? 0).toFixed(2)],
    rings: [0, 1, 2, 3].map((i) => {
      const u = blast?.uniforms?.[`u_ring${i}`];
      if (!u || !(u.w > 0)) return '-';
      return `${Math.round(u.y)}@${Math.round(u.x)}x${Math.round(u.w * 100) / 100}`;
    }).join(' '),
    ice: (() => {
      const a = blast?.uniforms?.u_ice;
      const b = blast?.uniforms?.u_ice2;
      const s = (u) => (u && u.w > 0 ? `${Math.round(u.y)}@${Math.round(u.x)}x${Math.round(u.w * 100) / 100}` : '-');
      return `${s(a)}|${s(b)}`;
    })(),
    dome: (() => {
      const u = blast?.uniforms?.u_dome;
      return u && u.y > 0 ? `r${Math.round(u.x)} h${Math.round(u.y)} c${Math.round(u.z * 100) / 100}` : '-';
    })(),
    camHeight: Math.round(carto.height),
    real: Math.round((performance.now() - (window.__t0 || performance.now())) / 100) / 10,
    lon: +(carto.longitude * 180 / Math.PI).toFixed(3),
    lat: +(carto.latitude * 180 / Math.PI).toFixed(3),
  };
  return out;
};

let browser;
try {
  await waitForServer();
  console.log('server up');
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofile',
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
  // Софтварный рендер дорог: половинный внутренний буфер даёт те же формы в 4 раза
  // быстрее, и кадры перестают разъезжаться по времени показа.
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.6; });

  // Кадры в реальных секундах от запуска: у каждой бомбы своё сжатие времени
  // (rate) и своё окно показа (life), поэтому момент кольца/шапки/купола
  // переводится из модельных секунд в настоящие отдельно для каждого заряда.
  const scenarios = [
    { bomb: 'little-boy', city: 'London', tag: 'g7_london_littleboy', frames: [[2700, 'a'], [13500, 'b'], [36000, 'c'], [81000, 'd'], [135000, 'e']] },
    { bomb: 'castle-bravo', city: 'London', tag: 'g7_london_bravo', frames: [[2600, 'a'], [5600, 'b'], [15000, 'c'], [26000, 'd'], [38000, 'e']] },
    { bomb: 'tsar', city: 'London', tag: 'g7_london_tsar', frames: [[5000, 'a'], [15000, 'b'], [40000, 'c'], [70000, 'd'], [77000, 'e']] },
  ];

  for (const s of scenarios) {
    await page.click('.k-nrange-trigger');
    await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
    await page.select('#k-nrange-bomb', s.bomb);
    await page.click('#k-nrange-city-query');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#k-nrange-city-query', s.city, { delay: 30 });
    await page.waitForFunction((name) => {
      const select = document.querySelector('#k-nrange-city-results');
      return select && [...select.options].some((o) => o.textContent.startsWith(`${name} ·`));
    }, { timeout: 30000 }, s.city);
    const value = await page.$eval('#k-nrange-city-results', (select, name) => {
      const option = [...select.options].find((o) => o.textContent.startsWith(`${name} ·`));
      return option.value;
    }, s.city);
    await page.select('#k-nrange-city-results', value);
    await sleep(6000); // перелёт камеры + приход тайлов

    await page.click('[data-test]');
    try {
      await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 300000 });
    } catch (e) {
      const stuck = await page.$eval('[data-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
      console.log(`[${s.tag}] СТАТУС НЕ СМЕНИЛСЯ: ${stuck}`);
      throw e;
    }
    const status = await page.$eval('[data-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    console.log(`[${s.tag}] ${status}`);
    // Отсчёт кадров — от страницы, а не от Node: снимок под SwiftShader сам
    // стоит несколько секунд, и по node-ным таймерам кадры разъезжались.
    await page.evaluate(() => { window.__t0 = performance.now(); });
    // Панель закрываем: холст испытания обязан быть чистым, без полигона справа.
    await page.click('[data-close]');

    for (const [ms, name] of s.frames) {
      await page.waitForFunction((t) => (performance.now() - (window.__t0 || 0)) / 1000 >= t,
        { timeout: 240000, polling: 200 }, ms / 1000).catch(() => {});
      let probe = null;
      try { probe = await page.evaluate(PROBE); } catch (e) { probe = { err: String(e.message).slice(0, 120) }; }
      await page.screenshot({ path: `${outDir}/${s.tag}_${name}.png` });
      console.log(`  ${s.tag}_${name}@${ms / 1000}s`, JSON.stringify(probe));
    }

    await page.click('.k-nrange-trigger');
    await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
    await page.click('[data-reset]');
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('очищены'), { timeout: 60000 }).catch(() => {});
    await page.click('[data-close]');
  }

  console.log(`errors: ${errs.length ? JSON.stringify(errs.slice(-8)) : 'none'}`);
  console.log('GAME SHOTS V2 DONE');
} catch (error) {
  console.error('GAME SHOTS V2 FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
