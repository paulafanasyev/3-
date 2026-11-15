// Считается ли pixelSize у point-примитивов в метрах? В кадре rings6 осколки
// (pixelSize 18–60, sizeInMeters: true) выглядят дисками в 50–70 px, хотя
// 60 м с 8,8 км — это ~7 px. Ставим примитив на известную дистанцию и мерим
// диаметр по пикселям: метры или пиксели.
//
// Первый прогон дал противоречие: 60 м с 1,5 км = ровно 60 px, 600 м с 8,3 км
// = больше 220 px (оно упёрлось в окно замера), 60 м с 8,3 км = ноль. Теперь
// размер мерим по всему кадру пурпурным цветом — игровые панели его не дают.
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

const setup = (meters, size, range) => page.evaluate(([m, px, rng]) => {
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
  window.__probeAt = at;
  if (window.__probeLock) v.scene.preRender.removeEventListener(window.__probeLock);
  // Игровой контроллер камеры каждый кадр уводит взгляд туда, где он считает
  // нужным; без блокировки наводка живёт ровно до первого render().
  window.__probeLock = () => v.camera.lookAt(at, new Cesium.HeadingPitchRange(0, 0, rng));
  v.scene.preRender.addEventListener(window.__probeLock);
  window.__probeLock();
  ds.entities.add({
    position: at,
    point: { pixelSize: px, sizeInMeters: m, color: Cesium.Color.MAGENTA, outlineWidth: 0 },
  });
  for (let i = 0; i < 12; i += 1) v.render();
  const scr = v.scene.cartesianToCanvasCoordinates(at, new Cesium.Cartesian2());
  const d = Cesium.Cartesian3.distance(v.camera.positionWC, at);
  const fov = v.camera.frustum.fovy ?? Cesium.Math.toRadians(60);
  const ppM = (v.canvas.clientHeight * 0.5) / (Math.tan(fov * 0.5) * d);
  return {
    x: scr ? Math.round(scr.x) : null,
    y: scr ? Math.round(scr.y) : null,
    distKm: Math.round(d / 100) / 10,
    pxPerMeter: Math.round(ppM * 1000) / 1000,
    expectedMeters: Math.round(px * ppM),
    canvas: `${v.canvas.clientWidth}×${v.canvas.clientHeight}`,
    dpr: window.devicePixelRatio,
  };
}, [meters, size, range]);

// Пурпур: R и B высокие, G низкий. Ищем по всему кадру, поэтому большой спрайт
// не упирается в окно, как упирался в прошлый раз.
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
  return {
    px: n,
    w: maxX >= minX ? maxX - minX + 1 : 0,
    h: maxY >= minY ? maxY - minY + 1 : 0,
    cx: maxX >= minX ? Math.round((minX + maxX) / 2) : null,
  };
};

const VARIANTS = [
  { m: true, size: 300, dist: 8300 },
  { m: true, size: 150, dist: 8300 },
  { m: true, size: 60, dist: 8300 },
  { m: true, size: 300, dist: 1500 },
  { m: false, size: 300, dist: 8300 },
];

for (const vr of VARIANTS) {
  const where = await setup(vr.m, vr.size, vr.dist);
  const file = `${OUT}/mag_${vr.m ? 'm' : 'px'}${vr.size}_d${Math.round(vr.dist / 100)}.png`;
  await page.screenshot({ path: file });
  const m = await measure(file);
  console.log(
    `sizeInMeters=${vr.m} size=${vr.size} d=${vr.dist} (канвас ${where.canvas}, dpr ${where.dpr}): `
    + `проекция ${where.x},${where.y} → центр пятна ${m.cx} | ${where.pxPerMeter} px/м, `
    + `по метрам ждали бы ${where.expectedMeters} px, по пикселям ${vr.size} px `
    + `→ факт габарит ${m.w}×${m.h} (${m.px} px) → ${file}`,
  );
}
await browser.close();
