// Маркеры в кадр: рисуем крестики там, где по расчёту камеры должны стоять
// земля, ножка, шляпка и купол гриба, и сравниваем с тем, что нарисовал объём.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4204);
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

const MARK = (city) => {
  const v = window.__kupol.viewer;
  const C = v.camera;
  const C3 = C.positionWC.constructor;
  const scene = v.scene;
  const col = scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
  const u = blast ? blast.uniforms : null;
  if (!u) return { noStage: true };

  const origin = C3.fromDegrees(city.lon, city.lat, 0);
  const rad = Math.PI / 180;
  const la = city.lat * rad; const lo = city.lon * rad;
  const up = new C3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const east = new C3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new C3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const local = (e, uu, nn) => {
    const p = C3.multiplyByScalar(up, uu, new C3());
    C3.add(p, C3.multiplyByScalar(east, e, new C3()), p);
    return C3.add(p, C3.multiplyByScalar(north, nn, new C3()), p);
  };
  const tanY = Math.tan(((C.frustum.fovy ?? 1.047) + 1e-6) / 2);
  const aspect = C.frustum.aspectRatio || 16 / 9;
  const tanX = tanY * aspect;
  // Экран в CSS-пикселях: снимок берётся по CSS-размеру холста.
  const rect = scene.canvas.getBoundingClientRect();
  const win = (p) => {
    const w = C3.add(origin, p, new C3());
    const rel = C3.subtract(w, C.positionWC, new C3());
    const depth = C3.dot(rel, C.directionWC);
    if (depth <= 1) return null;
    const nx = C3.dot(rel, C.rightWC) / depth / tanX;
    const ny = C3.dot(rel, C.upWC) / depth / tanY;
    return { x: (1 + nx) * 0.5 * rect.width, y: (1 - ny) * 0.5 * rect.height };
  };

  const marks = {};
  marks.ground = local(0, 0, 0);
  marks.head = local(0, u.u_head.y, 0);
  marks.capL = local(-u.u_head.w, u.u_head.y, 0);
  marks.capR = local(u.u_head.w, u.u_head.y, 0);
  marks.top = local(0, u.u_bound.y + u.u_boundR, 0);
  for (let i = 0; i <= 6; i += 1) {
    marks[`s${i}`] = local(0, (u.u_stem.y * i) / 6, 0);
  }
  const pos = {};
  for (const [k, p] of Object.entries(marks)) {
    const w = win(p);
    pos[k] = w ? { x: Math.round(w.x), y: Math.round(w.y) } : 'behind';
  }

  // Сам маркер — div-перекрестье, чтобы видеть совпадение на снимке.
  let layer = document.getElementById('__marks');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = '__marks';
    layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999';
    document.body.appendChild(layer);
  }
  layer.innerHTML = '';
  for (const [k, p] of Object.entries(pos)) {
    if (!p || p === 'behind') continue;
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${p.x - 11}px;top:${p.y - 1}px;width:22px;height:2px;background:#ff2d55;box-shadow:0 0 3px #000`;
    layer.appendChild(d);
    const e = document.createElement('div');
    e.style.cssText = `position:fixed;left:${p.x - 1}px;top:${p.y - 11}px;width:2px;height:22px;background:#ff2d55;box-shadow:0 0 3px #000`;
    layer.appendChild(e);
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;left:${p.x + 12}px;top:${p.y - 7}px;color:#ffdf3a;font:700 11px monospace;text-shadow:0 1px 2px #000`;
    t.textContent = k;
    layer.appendChild(t);
  }
  const carto = C.positionCartographic;
  return {
    pos,
    cam: { h: Math.round(carto.height), pitch: Math.round(C.pitch * 57.2958), rect: [Math.round(rect.width), Math.round(rect.height)] },
    raw: {
      age: Math.round(u.u_age * 10) / 10,
      head: [Math.round(u.u_head.y), Math.round(u.u_head.w)],
      stem: [Math.round(u.u_stem.x), Math.round(u.u_stem.y), Math.round(u.u_stem.z)],
      bound: [Math.round(u.u_bound.y), Math.round(u.u_boundR)],
      camLocal: [Math.round(u.u_cam.x), Math.round(u.u_cam.y), Math.round(u.u_cam.z)],
      steps: Math.round(u.u_steps),
      rayTan: [Math.round(u.u_rayTan.x * 1e3) / 1e3, Math.round(u.u_rayTan.y * 1e3) / 1e3],
      life: Math.round(u.u_life * 100) / 100,
      sunI: Math.round(u.u_sunI * 100) / 100,
      exposure: Math.round(u.u_exposure * 1000) / 1000,
      flash: Math.round(u.u_flash * 1000) / 1000,
    },
  };
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofile8',
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
  await page.evaluate(() => {
    window.__renderErrors = [];
    window.__kupol.viewer.scene.renderError.addEventListener((s, e) => {
      window.__renderErrors.push(String(e?.message || e).slice(0, 400));
    });
  });
  console.log('game ready');

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', process.env.BOMB || 'little-boy');
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
  await sleep(6000);
  const m = await page.evaluate(MARK, CITY);
  console.log('MARK', JSON.stringify(m));
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/ab_vol_on.png' });
  const m2 = await page.evaluate(MARK, CITY);
  console.log('MARK-after-shot cam', JSON.stringify(m2.cam), 'head', JSON.stringify(m2.pos.head), 'ground', JSON.stringify(m2.pos.ground));

  // A/B: тот же кадр с выключенным объёмным проходом. Если шар остаётся —
  // это примитив сцены (дымы разрушений), а не гриб.
  const ab = await page.evaluate(() => {
    const scene = window.__kupol.viewer.scene;
    const col = scene.postProcessStages;
    const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
    const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
    const before = blast ? { name: blast.name, show: blast.show, enabled: blast.enabled } : null;
    if (blast) blast.show = false;
    return { before, all: stages.map((s) => `${s.name}:show=${s.show}:en=${s.enabled}`), errs: (window.__renderErrors || []).slice(-3) };
  });
  console.log('AB', JSON.stringify(ab));
  await sleep(2000);
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/ab_vol_off.png' });
  console.log('MARK DONE');
} catch (e) {
  console.error('MARK FAIL:', e.stack || e);
  if (serverOutput) console.error(serverOutput.slice(-800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
