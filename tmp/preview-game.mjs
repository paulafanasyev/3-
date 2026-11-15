// Живой предпросмотр ИГРЫ: настоящий кадр из /kupol без UI-оверлеев.
// Заодно два замера, которые просил пользователь:
//   1) какая подложка глобуса реально стоит (спутник или векторная карта);
//   2) летает ли камера клавишами как у источника (WASD + QE + ZX + Shift).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4221);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.env.SHOT_TAG || 'pv';
const VW = Number(process.env.VW || 960);
const VH = Number(process.env.VH || 540);
const RS = Number(process.env.RES_SCALE || 0.6);
const AGES = JSON.parse(process.env.AGES || '[3,10,25,60,120,240]');

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (c) => { log += c.toString(); });
server.stderr.on('data', (c) => { log += c.toString(); });

const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
  }
  return false;
};

// Имена классов в собранном бандле минифицированы, поэтому провайдера опознаём
// по URL и assetId — единственному, что не зависит от бандла.
const PROBE = () => {
  const v = window.__kupol?.viewer;
  if (!v) return null;
  const name = (p) => {
    const u = String(p?.url || p?.tileMapUrl || '');
    if (p?.assetId !== undefined && p?.assetId !== null) return `ion(asset ${p.assetId})`;
    if (u.indexOf('NaturalEarthII') >= 0) return 'natural-earth(встроенный снимок)';
    if (u.indexOf('World_Imagery') >= 0 || u.indexOf('arcgisonline') >= 0) return 'ESRI World Imagery(спутник)';
    if (u.indexOf('openstreetmap') >= 0) return 'OSM(векторная карта)';
    if (u.indexOf('google') >= 0) return 'Google';
    return u.slice(0, 90) || '?';
  };
  const layers = [];
  for (let i = 0; i < v.imageryLayers.length; i += 1) {
    const p = v.imageryLayers.get(i)?.imageryProvider;
    layers.push({ i, src: name(p), maxLevel: p?.maximumLevel ?? null, ready: p?.ready ?? null });
  }
  return { layers, toast: (document.querySelector('.k-toast')?.textContent || '').trim() };
};

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofilePv',
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
const bad = [];
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) break;
    } catch { /* стартует */ }
    await sleep(500);
  }
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 220)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 110)}`); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await sleep(8000);
  // Замер №1: чем реально закрыт глобус (названия классов в бандле скрыты).
  console.log('imagery(start screen)', JSON.stringify(await page.evaluate(PROBE)));

  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await sleep(6000);
  console.log('imagery(in game)', JSON.stringify(await page.evaluate(PROBE)));

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
    const sel = document.querySelector('#k-nrange-city-results');
    return sel && [...sel.options].some((o) => o.textContent.startsWith('London ·'));
  }, { timeout: 30000 });
  const value = await page.$eval('#k-nrange-city-results', (sel) => (
    [...sel.options].find((o) => o.textContent.startsWith('London ·')).value));
  await page.select('#k-nrange-city-results', value);
  await sleep(25000);

  // Панель полигона и её триггер прячем только после запуска испытания:
  // display:none на предке делает кнопку «not clickable» для puppeteer.
  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  console.log('status', (await page.$eval('[data-status]', (el) => el.textContent)).slice(0, 240));
  await page.click('[data-close]');
  await page.waitForFunction(FIND, { timeout: 120000, polling: 500 });

  // Только теперь убираем весь портфельный UI: кадр игры должен быть чистым.
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live',
      '.k-hint', '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin',
      '.k-nrange-panel', '.k-nrange-trigger']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
  });
  await page.evaluate((rs) => { window.__kupol.viewer.resolutionScale = rs; }, RS);

  for (const age of AGES) {
    await page.waitForFunction((a) => {
      const u = window.__blast.uniforms;
      return u.u_age >= a || u.u_life < 0.02;
    }, { timeout: 420000, polling: 400 }, age);
    await sleep(3500);
    const name = `${TAG}_age${age}`;
    writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
    const meta = await page.evaluate(() => {
      const u = window.__blast.uniforms;
      const carto = window.__kupol.viewer.camera.positionCartographic;
      return { age: Math.round(u.u_age), life: +u.u_life.toFixed(2), boundR: Math.round(u.u_boundR),
        steps: u.u_steps, flash: +u.u_flash.toFixed(2), show: window.__blast.show,
        head: [Math.round(u.u_head.y), Math.round(u.u_head.w), Math.round(u.u_headShape.x)],
        stem: [Math.round(u.u_stem.y), Math.round(u.u_stem.z)],
        cam: [Math.round(carto.height / 100) * 100, +carto.latitude.toFixed(3), +carto.longitude.toFixed(3)] };
    });
    console.log(name, JSON.stringify(meta));
  }

  // Замер №2: свободный полёт клавишами (WASD + поворот QE + набор ZX + Shift).
  const flight = await page.evaluate(async () => {
    const v = window.__kupol.viewer;
    const pos = () => { const c = v.camera.positionCartographic; return { h: c.height, la: c.latitude, lo: c.longitude }; };
    const send = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const p0 = pos(); const hd0 = v.camera.heading;
    out.enabled = window.__kupol.flight?.isEnabled?.() ?? null;
    // Сколько тиков реально успевает пройти под SwiftShader: шаг интегрирования
    // в полёте ограничен 0.25 с, поэтому на 2 к/с путь будет в разы короче
    // номинального — это надо отделить от поломки клавиш.
    let ticks = 0;
    const un = v.clock.onTick.addEventListener(() => { ticks += 1; });
    send('keydown', 'w'); send('keydown', 'Shift');
    await wait(2500);
    const p1 = pos();
    un();
    out.ticks = ticks;
    // 1 радиан широты = 6371 км, а не 111,32: раньше мерил по градусной формуле.
    out.fwd = { northKm: +(((p1.la - p0.la) * 6371).toFixed(2)),
      eastKm: +(((p1.lo - p0.lo) * 6371 * Math.cos(p1.la)).toFixed(2)),
      dhM: Math.round(p1.h - p0.h) };
    out.nominalKmPerSec = Math.min(4e6, Math.max(30, p0.h * 0.28)) * 4;
    out.heldApi = Object.keys(window.__kupol.flight || {});
    send('keyup', 'w'); send('keyup', 'Shift');
    await wait(900);
    const p2 = pos();
    out.driftAfterKeyupM = Math.round(Math.hypot((p2.la - p1.la) * 6371000, (p2.lo - p1.lo) * 6371000 * Math.cos(p2.la)));
    send('keydown', 'q');
    await wait(1500);
    out.yawDeg = +(((v.camera.heading - hd0) * 180 / Math.PI).toFixed(1));
    send('keyup', 'q');
    send('keydown', 'x');
    await wait(1500);
    const p3 = pos();
    send('keyup', 'x');
    out.upM = Math.round(p3.h - p2.h);
    send('keydown', 'z');
    await wait(1500);
    out.downM = Math.round(pos().h - p3.h);
    send('keyup', 'z');
    return out;
  });
  console.log('flight', JSON.stringify(flight));
  console.log('badResponses', JSON.stringify([...new Set(bad)].slice(0, 14)));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('PREVIEW DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('badResponses', JSON.stringify([...new Set(bad)].slice(0, 14)));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
