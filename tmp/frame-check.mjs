// Замер кадрирования испытания: попадает ли весь гриб (земля -> купол) в кадр,
// который игра ставит по кнопке «Запустить испытание». Точки гриба берём из
// живых uniform'ов объёмного прохода и переносим в экранные координаты камерой.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4203);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITY = { lon: -0.119, lat: 51.502 };

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

// Один снимок: поза камеры + где на экране ключевые точки гриба.
const MEASURE = (city) => {
  const v = window.__kupol.viewer;
  const C = v.camera;
  const C3 = C.positionWC.constructor;
  const scene = v.scene;
  const col = scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
  const u = blast ? blast.uniforms : null;

  // Локальный ENU над точкой подрыва: восток/север/верх — чистой математикой,
  // статика Transforms в игре недоступна.
  const origin = C3.fromDegrees(city.lon, city.lat, 0);
  const rad = Math.PI / 180;
  const la = city.lat * rad; const lo = city.lon * rad;
  const up = new C3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const east = new C3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new C3(
    -Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la),
  );
  const local = (e, uu, nn) => {
    const p = C3.multiplyByScalar(up, uu, new C3());
    C3.add(p, C3.multiplyByScalar(east, e, new C3()), p);
    return C3.add(p, C3.multiplyByScalar(north, nn, new C3()), p);
  };
  // Проекция в окно — ручной пинхол по базису камеры: SceneTransforms в рантайме
  // игры недоступен (модуль со статиками), а базис камеры и фрустум — доступны.
  const camPos = C.positionWC;
  const tanY = Math.tan(((C.frustum.fovy ?? 1.047) + 1e-6) / 2);
  const aspect = C.frustum.aspectRatio || 16 / 9;
  const tanX = tanY * aspect;
  const cw = scene.canvas.width; const ch = scene.canvas.height;
  const win = (p) => {
    const w = C3.add(origin, p, new C3());
    const rel = C3.subtract(w, camPos, new C3());
    const depth = C3.dot(rel, C.directionWC);
    if (depth <= 1) return null;
    const nx = C3.dot(rel, C.rightWC) / depth / tanX;
    const ny = C3.dot(rel, C.upWC) / depth / tanY;
    return { x: Math.round((nx + 1) * 0.5 * cw), y: Math.round((1 - ny) * 0.5 * ch) };
  };
  const carto = C.positionCartographic;
  const out = {
    cam: {
      h: Math.round(carto.height),
      pitch: Math.round(C.pitch * 57.2958),
      rangeKm: u ? Math.round(C3.distance(C.positionWC, origin) / 100) / 10 : null,
    },
    canvas: { w: scene.canvas.width, h: scene.canvas.height },
    pts: {},
  };
  if (!u) { out.noStage = true; return out; }
  const boundR = u.u_boundR;
  const top = u.u_bound.y + boundR;
  const pts = {
    ground: local(0, 0, 0),
    stemMid: local(0, u.u_stem.y * 0.5, 0),
    stemTop: local(0, u.u_stem.y, 0),
    headCenter: local(0, u.u_head.y, 0),
    capLeft: local(-u.u_head.w, u.u_head.y, 0),
    capRight: local(u.u_head.w, u.u_head.y, 0),
    cloudTop: local(0, top, 0),
    boundBottom: local(0, u.u_bound.y - boundR, 0),
    boundTop: local(0, u.u_bound.y + boundR, 0),
  };
  out.raw = {
    age: Math.round(u.u_age * 10) / 10,
    head: [Math.round(u.u_head.y), Math.round(u.u_head.w)],
    stem: [Math.round(u.u_stem.x), Math.round(u.u_stem.y), Math.round(u.u_stem.z), Math.round(u.u_stem.w * 100) / 100],
    bound: [Math.round(u.u_bound.y), Math.round(boundR)],
    steps: Math.round(u.u_steps),
    rayTan: [Math.round(u.u_rayTan.x * 1000) / 1000, Math.round(u.u_rayTan.y * 1000) / 1000],
  };
  for (const [k, p] of Object.entries(pts)) {
    const s = win(p);
    out.pts[k] = s ? { x: s.x, y: s.y, inFrame: s.x >= 0 && s.x <= cw && s.y >= 0 && s.y <= ch } : 'behind';
  }
  return out;
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofile7',
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
  console.log('game ready');

  const bomb = process.env.BOMB || 'little-boy';
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', bomb);
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
  await page.select('#k-nrange-city-results', value);
  await sleep(9000);
  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');

  for (const sec of [4, 12, 25]) {
    await sleep(sec === 4 ? 4000 : (sec - (sec === 12 ? 4 : 12)) * 1000);
    const m = await page.evaluate(MEASURE, CITY);
    console.log(`M${sec}s`, JSON.stringify(m));
    await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/frame_${bomb}_${sec}s.png` });
    const after = await page.evaluate(MEASURE, CITY);
    console.log(`  pose after shot`, JSON.stringify(after.cam), JSON.stringify(after.raw));
  }
  console.log('FRAME CHECK DONE');
} catch (e) {
  console.error('FRAME CHECK FAIL:', e.stack || e);
  if (serverOutput) console.error(serverOutput.slice(-800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
