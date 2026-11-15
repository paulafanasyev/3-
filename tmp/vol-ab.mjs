// А/Б-замер одного и того же кадра: объёмный проход включён и выключен.
// Если пиксели не различаются — облако не рисуется вовсе, и винить надо
// геометрию марша, а не наводку камеры. Прежние кадры rds37 и удара партии
// не показали облака при «enabled=true», и на глаз не отличить, что именно
// молчит.
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const base = `http://127.0.0.1:${port}`;
const PROFILE = process.env.PROFILE || 'rds37';
const KT = Number(process.env.KT || 1600);
const AGE = Number(process.env.AGE || 90);
const OUT = process.env.OUT || `D:/mt5/tmp-nuclear/shots/ab-${PROFILE}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITIES = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
const [LAT, LON] = CITIES.London;

const bomb = JSON.parse(await import('node:fs/promises')
  .then(({ readFile }) => readFile(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8')))
  .bombs.find((b) => b.id === PROFILE);
const zones = zonesForBomb(bomb, KT);
const shapeAt = (s) => blastShapeAt(bomb, zones, KT, s);
const boundY = shapeAt(AGE).bound.y;
console.log(`${PROFILE} @ ${KT} кт, возраст ${AGE} с: boundY=${boundY.toFixed(0)} м`);

const browser = await puppeteer.launch({
  userDataDir: `D:/mt5/tmp-nuclear/chrome-ab-${PROFILE}`,
  headless: 'new', protocolTimeout: 1800000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 140)); });
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForFunction(() => window.__kupol?.layers?.playNuclearTest, { timeout: 120000 });

  const dist = Math.max(2000, boundY) * 2.4;
  await page.evaluate(async (lat, lon, kt, profile, dist, aimY) => {
    const Cesium = window.Cesium;
    document.getElementById('kupol-root')?.style.setProperty('display', 'none');
    window.__kupol.layers.playNuclearTest({ lat, lon }, kt / 1000, { profileId: profile, cityName: 'London', damage: false });
    const origin = Cesium.Cartesian3.fromDegrees(lon, lat, aimY);
    const enu = Cesium.Matrix4.inverseTransformation(
      Cesium.Transforms.eastNorthUpToFixedFrame(origin), new Cesium.Matrix4());
    window.__cam = { lon: lon + dist / (111_320 * Math.cos(lat * Math.PI / 180)), lat: lat + dist / 111_320, alt: dist * 0.75 };
    window.__aim = () => {
      const eye = Cesium.Cartesian3.fromDegrees(window.__cam.lon, window.__cam.lat, window.__cam.alt);
      const p = Cesium.Matrix4.multiplyByPoint(enu, eye, new Cesium.Cartesian3());
      const v = window.__kupol.viewer;
      v.camera.cancelFlight();
      v.camera.setView({ destination: eye, orientation: {
        heading: Math.atan2(-p.x, -p.y), pitch: Math.atan2(-p.z, Math.hypot(p.x, p.y)), roll: 0 } });
    };
    window.__aim();
    return true;
  }, LAT, LON, KT, PROFILE, dist, boundY * 0.5);

  await page.waitForFunction(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = 0; i < col.length; i += 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
    }
    return false;
  }, { timeout: 900000, polling: 1000 });

  for (let i = 0; i < 400; i += 1) {
    const a = await page.evaluate(() => window.__blast.uniforms.u_age);
    if (a >= AGE) break;
    await sleep(1500);
  }

  const info = await page.evaluate(() => {
    const Cesium = window.Cesium;
    const v = window.__kupol.viewer;
    const u = window.__blast.uniforms;
    const v4 = (x) => [x.x, x.y, x.z, x.w].map((n) => Math.round(Number(n) * 10) / 10);
    const v3 = (x) => [x.x, x.y, x.z].map((n) => Math.round(Number(n) * 100) / 100);
    const scr = v.scene.cartesianToCanvasCoordinates(u.u_center ? u.u_center : Cesium.Cartesian3.ZERO);
    return {
      age: Math.round(u.u_age * 10) / 10, enabled: window.__blast.enabled,
      step: Math.round(u.u_stepScale * 10) / 10, tex: Math.round((window.__blast._textureScale ?? 1) * 100) / 100,
      bound: v3(u.u_bound), boundR: Math.round(u.u_boundR), head: v4(u.u_head), stem: v4(u.u_stem),
      skirt: v4(u.u_skirt), shock: v4(u.u_shock), flash: Math.round(u.u_flash * 1000) / 1000,
      life: Math.round(u.u_life * 1000) / 1000, sunI: Math.round(u.u_sunI * 100) / 100,
      ax0: v3(u.u_ax0), cam: v3(u.u_cam), seed: u.u_seed,
      camPos: (() => { const c = v.camera.positionCartographic; return {
        lon: Math.round(c.longitude * 572957795) / 572957795 * 1, lat: c.latitude, height: Math.round(c.height),
        heading: Math.round(v.camera.heading * 57.2958 * 10) / 10, pitch: Math.round(v.camera.pitch * 57.2958 * 10) / 10 }; })(),
      centerOnScreen: scr ? { x: Math.round(scr.x), y: Math.round(scr.y) } : null,
      stages: (() => { const out = []; const col = v.scene.postProcessStages;
        for (let i = 0; i < col.length; i += 1) { const s = col.get(i); out.push(`${s.name}:${s.enabled ? 1 : 0}`); } return out; })(),
    };
  });
  console.log(JSON.stringify(info, null, 1));

  await page.evaluate(() => window.__aim());
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/on.png` });
  await page.evaluate(() => { window.__blast.enabled = false; });
  await sleep(4000);
  await page.screenshot({ path: `${OUT}/off.png` });
  await page.evaluate(() => { window.__blast.enabled = true; });
  console.log(`кадры: ${OUT}/on.png ${OUT}/off.png`);
} catch (e) {
  console.log(`FATAL ${e.message}`);
} finally {
  console.log(`errors ${JSON.stringify(errs.slice(0, 6))}`);
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ PROFILE, KT, AGE, errs }, null, 1));
  await browser.close();
}
