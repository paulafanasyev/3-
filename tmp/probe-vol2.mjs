import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5233, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 300)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 180000 });
await page.evaluate(async () => { await window.runTest('castle_bravo', 'London', 'wide'); });

// Зрелый гриб, только объём + спутник: сущности и слой разрушений спрятаны.
await page.evaluate((fraction) => {
  const v = window.__viewer;
  let stage = null;
  for (let i = 0; i < v.scene.postProcessStages.length; i += 1) {
    const c = v.scene.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  window.__stage = stage;
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const ageNow = stage.uniforms.u_age / rate;
  const target = realNow() + (life * fraction - ageNow) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
  v.entities.show = false;
  v.dataSources.get(0).show = false;
}, 0.62);
await sleep(4000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/vol2_wide.png' });

const dump = async (label) => {
  const s = await page.evaluate(() => {
    const u = window.__stage.uniforms;
    return { age: +u.u_age.toFixed(1), boundR: Math.round(u.u_boundR), steps: u.u_steps,
      headR: Math.round(u.u_head.w), headY: Math.round(u.u_head.y), stemR: Math.round(u.u_stem.z),
      skirtR: Math.round(u.u_skirt.x), fbR: Math.round(u.u_fb.w), exp: +u.u_exposure.toFixed(3), sunI: +u.u_sunI.toFixed(3) };
  });
  console.log(label, JSON.stringify(s));
};
await dump('STATE_WIDE');

// Косой вид с небольшой высоты: гриб обязан встать в кадр целиком.
await page.evaluate(() => {
  const C = window.__Cesium, v = window.__viewer;
  v.camera.setView({
    destination: C.Cartesian3.fromDegrees(-0.13, 51.5074 - 0.72, 7000),
    orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(6), roll: 0 },
  });
});
await sleep(4000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/vol2_oblique.png' });

// Точка 1: ранняя фаза — огненный шар у земли.
await page.evaluate(() => {
  const C = window.__Cesium, v = window.__viewer;
  v.camera.setView({
    destination: C.Cartesian3.fromDegrees(-0.13, 51.5074 - 0.55, 4500),
    orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(4), roll: 0 },
  });
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const target = realNow() + (life * 0.12 - window.__stage.uniforms.u_age / rate) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
});
await sleep(4000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/vol2_early.png' });
await dump('STATE_EARLY');

// Точка 4: середина подъёма, ближе — проверить валы на шляпе и ножку.
await page.evaluate(() => {
  const C = window.__Cesium, v = window.__viewer;
  v.camera.setView({
    destination: C.Cartesian3.fromDegrees(-0.13, 51.5074 - 0.36, 12000),
    orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(14), roll: 0 },
  });
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const target = realNow() + (life * 0.45 - window.__stage.uniforms.u_age / rate) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
});
await sleep(5000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/vol2_mid.png' });
await dump('STATE_MID');

console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
