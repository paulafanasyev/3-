// Почему пик под Лондоном отдаёт клетку из Северной Америки? Замер: ставим
// камеру над Лондоном, рендерим и читаем, где реально оказался глаз, до и после
// паузы. Если setView не держится — виноват контроллер камеры игры.
import puppeteer from 'puppeteer';
const port = Number(process.env.GAME_PORT || 4237);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/chrome-camprobe',
  headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await page.goto(`http://127.0.0.1:${port}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForFunction(() => window.__kupol?.layers, { timeout: 120000 });
  const read = () => page.evaluate(() => {
    const v = window.__kupol.viewer; const C = window.Cesium;
    const c = v.camera.positionCartographic;
    const screen = { x: Math.round(v.canvas.clientWidth / 2), y: Math.round(v.canvas.clientHeight / 2) };
    let cart = v.scene.pickPositionSupported ? v.scene.pickPosition(screen) : undefined;
    if (!C.defined(cart)) cart = v.camera.pickEllipsoid(screen, v.scene.globe.ellipsoid);
    const cg = C.defined(cart) ? C.Cartographic.fromCartesian(cart) : null;
    const hit = window.__kupol.layers.pick(screen);
    return {
      cam: [C.Math.toDegrees(c.latitude).toFixed(2), C.Math.toDegrees(c.longitude).toFixed(2), Math.round(c.height)],
      camHeading: (C.Math.toDegrees(v.camera.heading)).toFixed(1), camPitch: (C.Math.toDegrees(v.camera.pitch)).toFixed(1),
      ground: cg ? [C.Math.toDegrees(cg.latitude).toFixed(2), C.Math.toDegrees(cg.longitude).toFixed(2)] : null,
      hit, canvas: [v.canvas.clientWidth, v.canvas.clientHeight],
      reqRender: v.scene.requestRenderMode,
    };
  });
  console.log('было:', JSON.stringify(await read()));
  const after = await page.evaluate(() => {
    const v = window.__kupol.viewer; const C = window.Cesium;
    v.camera.setView({ destination: C.Cartesian3.fromDegrees(-0.119, 51.502, 1.5e6), orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 } });
    v.render();
    return true;
  });
  await sleep(1200);
  console.log('сразу после setView+render+1.2 с:', JSON.stringify(await read()));
  await sleep(6000);
  console.log('через 7 с:', JSON.stringify(await read()));
  console.log('есть ли __kupol.fly:', await page.evaluate(() => Object.keys(window.__kupol).join(',')));
} catch (e) {
  console.log('FATAL', e.message);
} finally {
  await browser.close();
}
