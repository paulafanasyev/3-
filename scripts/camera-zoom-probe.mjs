// Сколько земли проедает колесо и где оно упирается. Разбираем два режима:
// один щелчок с полным успокоением инерции и частые щелчки, как у живого
// скролла, — у Cesium зум идёт через твин, и быстрые события могут его обрывать.
import puppeteer from 'puppeteer';

const base = process.env.CAMERA_PROBE_BASE || 'http://127.0.0.1:4237';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: `${process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear'}/chrome-camera-probe`,
  protocolTimeout: 240000,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.k-nrange-trigger', { timeout: 120000 });
await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 60000 });
await page.click('.k-start .k-nations button[data-id]');
await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });

const height = () => page.evaluate(() => window.__kupol.viewer.camera.positionCartographic.height);
const notch = (delta, gapMs) => page.evaluate(async ({ d, gap }) => {
  const canvas = document.querySelector('#kupol-globe canvas');
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent('wheel', {
    deltaY: d, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
    bubbles: true, cancelable: true,
  }));
  await new Promise((r) => setTimeout(r, gap));
}, { delta, gap: gapMs });

async function measure(label, notches, delta, gapMs) {
  const before = await height();
  for (let i = 0; i < notches; i += 1) await notch(delta, gapMs);
  const after = await height();
  const perNotch = Math.pow(after / before, 1 / notches);
  console.log(`${label}: ${Math.round(before / 1000)} км → ${Math.round(after / 1000)} км, за щелчок ×${perNotch.toFixed(4)}`);
  return perNotch;
}

const setHeight = (m) => page.evaluate((height) => {
  const v = window.__kupol.viewer;
  const c = v.camera.positionCartographic;
  // самого Cesium в window нет (модуль), поэтому Cartographic берём из прототипа
  const target = new c.constructor(c.longitude, c.latitude, height);
  v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian(target) });
}, m);

// Орбита, с которой игрок заходит в игру: 7500 км.
await setHeight(7.5e6);
await new Promise((r) => setTimeout(r, 1500));

console.log('один щелчок к земле, инерция дождалась 2 с:');
await measure('  1 щелчок, пауза 2000 мс', 1, -100, 2000);
await new Promise((r) => setTimeout(r, 2000));
console.log('те же 10 щелчков, но каждые 40 мс (живой скролл):');
await measure('  10 щелчков, пауза 40 мс', 10, -100, 40);
await new Promise((r) => setTimeout(r, 2500));
await setHeight(7.5e6);
await new Promise((r) => setTimeout(r, 1500));
console.log('от Земли:');
await measure('  10 щелчков, пауза 40 мс', 10, 100, 40);
await new Promise((r) => setTimeout(r, 2500));

// Куда реально упираются пределы контроллера, если жать долго.
const limits = await page.evaluate(() => {
  const c = window.__kupol.viewer.scene.screenSpaceCameraController;
  return { min: c.minimumZoomDistance, max: c.maximumZoomDistance, factor: c.zoomFactor, ratio: c.maximumMovementRatio, inertia: c.inertiaZoom };
});
console.log('пределы:', JSON.stringify(limits));
await browser.close();
