// Проверка того, чем собираемся чинить осколки: если метры считать сами через
// проекцию камеры, спрайт обязан стать ровно такого размера, какого просим.
// Заодно мерим, совпадает ли «проекционный» px/м с реально нарисованным.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import sharp from 'sharp';

const URL = process.env.URL || 'http://127.0.0.1:4237/kupol';
const OUT = process.env.OUT || 'D:/mt5/tmp-nuclear/shots/point-probe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/chrome-probe',
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 180000 });
await page.click('.k-start .k-nations button[data-id]');
await page.waitForFunction(() => window.__kupol?.viewer, { timeout: 180000 });

// Один и тот же кадр, но спрайт задан «в метрах» по-нашему: pixelSize считается
// от дистанции через worldToWindowCoordinates.
const setup = (meters, range) => page.evaluate(([m, rng]) => {
  const Cesium = window.Cesium;
  const v = window.__kupol.viewer;
  v.useDefaultRenderLoop = false;
  if (!window.__probeDs) {
    window.__probeDs = new Cesium.CustomDataSource('kupol-probe');
    v.dataSources.add(window.__probeDs);
  }
  const ds = window.__probeDs;
  ds.entities.removeAll();
  const at = Cesium.Cartesian3.fromDegrees(-0.12, 51.516, 500);
  if (window.__probeLock) v.scene.preRender.removeEventListener(window.__probeLock);
  window.__probeLock = () => v.camera.lookAt(at, new Cesium.HeadingPitchRange(0, 0, rng));
  v.scene.preRender.addEventListener(window.__probeLock);
  window.__probeLock();

  // px/м по вертикали экрана: проекция точки и точки на 100 м выше по up камеры.
  const pxPerMeter = () => {
    const cam = v.camera;
    const a = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, at);
    const up = Cesium.Cartesian3.multiplyByScalar(cam.upWC, 100, new Cesium.Cartesian3());
    const b = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, Cesium.Cartesian3.add(at, up, new Cesium.Cartesian3()));
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / 100;
  };
  window.__probePpm = pxPerMeter;

  ds.entities.add({
    position: at,
    point: {
      pixelSize: new Cesium.CallbackProperty(() => Math.max(0, m * pxPerMeter()), false),
      sizeInMeters: false,
      color: Cesium.Color.MAGENTA,
      outlineWidth: 0,
    },
  });
  for (let i = 0; i < 10; i += 1) v.render();
  const ppm = pxPerMeter();
  return {
    meters: m,
    range: rng,
    ppm: Math.round(ppm * 1000) / 1000,
    askedPx: Math.round(m * ppm * 10) / 10,
    fovyDeg: Math.round((v.camera.frustum.fovy ?? 0) * 57.29578 * 1000) / 1000,
    frustum: v.camera.frustum.constructor.name,
    distKm: Math.round(Cesium.Cartesian3.distance(v.camera.positionWC, at) / 100) / 10,
  };
}, [meters, range]);

const measure = async (file) => {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const C = info.channels;
  let minX = W, maxX = -1, minY = info.height, maxY = -1, n = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * C;
      if (data[i] > 150 && data[i + 2] > 150 && data[i + 1] < 110) {
        n += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= minX ? { px: n, w: maxX - minX + 1, h: maxY - minY + 1 } : { px: 0, w: 0, h: 0 };
};

for (const [meters, range] of [[30, 8300], [300, 8300], [30, 1500], [12, 900]]) {
  const where = await setup(meters, range);
  const file = `${OUT}/emu_m${meters}_d${Math.round(range / 100)}.png`;
  await page.screenshot({ path: file });
  const m = await measure(file);
  console.log(
    `${meters} м с ${where.distKm} км: проекция ${where.ppm} px/м ⇒ просили ${where.askedPx} px `
    + `(фрустум ${where.frustum}, fovy ${where.fovyDeg}°) → нарисовалось ${m.w}×${m.h} (${m.px} px) → ${file}`,
  );
}
await browser.close();
