// Карта отказов прямо в игре: u_dbg=6 красит пиксели по причине, по которой
// марш не запустился (маджента = ограничитель выключен, оранжевый = луч мимо
// шара, красный = отсечён глубиной, зелёный = марш реально прошёл). Заодно
// замеряем, куда камера смотрит В МОМЕНТ снимка: игра уводит её своей
// анимацией, и «облака нет» неотличимо от «облако за кадром».
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const base = `http://127.0.0.1:${port}`;
const PROFILE = process.env.PROFILE || 'rds37';
const KT = Number(process.env.KT || 1600);
const AGE = Number(process.env.AGE || 90);
const DBG = Number(process.env.DBG || 6);
const OUT = process.env.OUT || `D:/mt5/tmp-nuclear/shots/dbg-${PROFILE}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [LAT, LON] = [51.502, -0.119];

const data = JSON.parse(await import('node:fs/promises')
  .then(({ readFile }) => readFile(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8')));
const bomb = data.bombs.find((b) => b.id === PROFILE);
const zones = zonesForBomb(bomb, KT);
const shapeAt = (s) => blastShapeAt(bomb, zones, KT, s);
const st = shapeAt(AGE);
const boundY = st.bound.y;
const dist = Math.max(2000, boundY) * 2.4;
console.log(`${PROFILE} @ ${KT} кт, возраст ${AGE}: boundY=${boundY.toFixed(0)} head=${JSON.stringify(st.head)} камера ${Math.round(dist / 1000)} км, высота ${Math.round(dist * 0.75 / 1000)} км`);

const browser = await puppeteer.launch({
  userDataDir: `D:/mt5/tmp-nuclear/chrome-dbg-${PROFILE}`,
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

  await page.evaluate(async (lat, lon, kt, profile, dist, aimY) => {
    const Cesium = window.Cesium;
    document.getElementById('kupol-root')?.style.setProperty('display', 'none');
    window.__kupol.layers.playNuclearTest({ lat, lon }, kt / 1000, { profileId: profile, cityName: 'London', damage: false });
    window.__geo = { lat, lon, aimY };
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
      return { heading: v.camera.heading * 57.2958, pitch: v.camera.pitch * 57.2958 };
    };
    window.__shot = (dbg) => {
      const Cesium = window.Cesium;
      const v = window.__kupol.viewer;
      const col = v.scene.postProcessStages;
      let stage = null;
      for (let i = 0; i < col.length; i += 1) { const s = col.get(i); if (s && String(s.name).indexOf('kupol-blast') === 0) stage = s; }
      if (!stage) return { err: 'нет стадии' };
      const aim = window.__aim();
      stage.enabled = true;
      stage.uniforms.u_dbg = dbg;
      v.render();
      const u = stage.uniforms;
      const headWorld = Cesium.Cartesian3.fromDegrees(window.__geo.lon, window.__geo.lat, window.__geo.aimY + u.u_head.y);
      const scr = v.scene.cartesianToCanvasCoordinates(headWorld, new Cesium.Cartesian2());
      const cam = v.camera.positionCartographic;
      return {
        age: Math.round(u.u_age * 10) / 10, enabled: stage.enabled, dbg: u.u_dbg,
        step: Math.round(u.u_stepScale * 10) / 10, tex: Math.round((stage._textureScale ?? 1) * 100) / 100,
        boundR: Math.round(u.u_boundR), boundY: Math.round(u.u_bound.y), headY: Math.round(u.u_head.y),
        headR: Math.round(u.u_head.w), headDensityOn: u.u_head.w > 0,
        aim, cam: { lonR: Math.round(cam.longitude * 572957795) / 572957795, latR: Math.round(cam.latitude * 572957795) / 572957795, h: Math.round(cam.height / 100) / 10 },
        headOnScreen: scr ? { x: Math.round(scr.x), y: Math.round(scr.y) } : null,
      };
    };
    return true;
  }, LAT, LON, KT, PROFILE, dist, boundY * 0.5);

  for (let i = 0; i < 400; i += 1) {
    const a = await page.evaluate(() => {
      const col = window.__kupol.viewer.scene.postProcessStages;
      for (let i = 0; i < col.length; i += 1) { const s = col.get(i); if (s && String(s.name).indexOf('kupol-blast') === 0) return s.uniforms.u_age; }
      return -1;
    });
    if (a >= AGE) break;
    await sleep(1500);
  }

  const info = await page.evaluate((dbg) => window.__shot(dbg), DBG);
  console.log(JSON.stringify(info));
  await page.screenshot({ path: `${OUT}/${PROFILE}_dbg${DBG}.png` });
  const after = await page.evaluate(() => {
    const v = window.__kupol.viewer, c = v.camera.positionCartographic;
    return { h: Math.round(c.height / 100) / 10, pitch: Math.round(v.camera.pitch * 572957795) / 572957795 };
  });
  console.log(`камера после снимка: ${JSON.stringify(after)}`);
} catch (e) {
  console.log(`FATAL ${e.message}`);
} finally {
  console.log(`errors ${JSON.stringify(errs.slice(0, 6))}`);
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ PROFILE, KT, AGE, DBG, errs }, null, 1));
  await browser.close();
}
