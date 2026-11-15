import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5225, base = `http://127.0.0.1:${port}`;
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

// Заморозка на зрелом грибе + слой сущностей убран: ниже только объём и спутник.
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

const city = await page.evaluate(() => {
  const c = window.__viewer.camera.positionCartographic;
  const C = window.__Cesium;
  return { lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude) };
});
const look = async (name, dLatKm, altM, pitchDeg) => {
  await page.evaluate((a) => {
    const C = window.__Cesium;
    window.__viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(a.lon, a.lat - a.southKm / 111, a.alt),
      orientation: new C.HeadingPitchRoll(0, C.Math.toRadians(a.pitch), 0),
    });
    window.__viewer.scene.requestRender();
  }, { lon: city.lon, lat: city.lat, southKm: dLatKm, alt: altM, pitch: pitchDeg });
  await sleep(4000);
  await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/view_${name}.png` });
  const s = await page.evaluate(() => {
    const q = window.__stage && !window.__stage.isDestroyed() ? window.__stage.uniforms : null;
    if (!q) return { gone: true };
    const sc = window.__viewer.scene;
    let shown = null;
    for (let i = 0; i < sc.postProcessStages.length; i += 1) {
      const c = sc.postProcessStages.get(i);
      if (String(c.name).startsWith('kupol-blast')) shown = c.show;
    }
    return { age: +q.u_age.toFixed(1), boundR: Math.round(q.u_boundR), steps: q.u_steps, show: shown,
      head: [Math.round(q.u_head.y), Math.round(q.u_head.w)], headDens: +q.u_headShape.z.toFixed(3),
      stem: [Math.round(q.u_stem.y), Math.round(q.u_stem.z), +q.u_stem.w.toFixed(2)],
      fb: Math.round(q.u_fb.w), skirt: [Math.round(q.u_skirt.x), +q.u_skirt.z.toFixed(3)],
      exp: +q.u_exposure.toFixed(3), cam: [Math.round(q.u_cam.x), Math.round(q.u_cam.y), Math.round(q.u_cam.z)],
      bound: [Math.round(q.u_bound.x), Math.round(q.u_bound.y), Math.round(q.u_bound.z)] };
  });
  console.log(name, JSON.stringify(s));
};
await look('side_far', 260, 22000, 6);
await look('side_mid', 150, 15000, 2);
await look('from_city', 40, 6000, 8);
console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
