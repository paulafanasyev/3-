import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.FLIGHT_PORT || 4199);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', () => {});
for (let i = 0; i < 90; i += 1) { try { if ((await fetch(`${base}/kupol`)).ok) break; } catch {} await sleep(500); }

const browser = await puppeteer.launch({ userDataDir: 'D:/mt5/tmp-nuclear/pprofile2', headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 200)));
await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.__kupol && window.__kupol.viewer', { timeout: 240000 });

const snap = () => page.evaluate(() => {
  const cam = window.__kupol.viewer.camera;
  const carto = window.__kupol.viewer.scene.globe.ellipsoid.cartesianToCartographic(cam.positionWC);
  return { lon: +(carto.longitude * 180 / Math.PI).toFixed(4), lat: +(carto.latitude * 180 / Math.PI).toFixed(4),
    height: Math.round(carto.height), heading: +(cam.heading * 180 / Math.PI).toFixed(2),
    pitch: +(cam.pitch * 180 / Math.PI).toFixed(2) };
});

const distKm = (a, b) => {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const m = Math.hypot(dLat * R, dLon * R * Math.cos((a.lat * Math.PI) / 180));
  return +m.toFixed(1);
};

const results = [];
const run = async (label, keys, ms) => {
  const before = await snap();
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
  await sleep(300);
  const after = await snap();
  results.push({ label, before, after, groundKm: distKm(before, after),
    dHeight: after.height - before.height, dHeading: +(after.heading - before.heading).toFixed(2) });
};

await run('W вперёд', ['w'], 3000);
await run('S назад', ['s'], 2000);
await run('A влево', ['a'], 2000);
await run('X вверх', ['x'], 2000);
await run('Z вниз', ['z'], 2000);
await run('Q рыскание', ['q'], 2000);
await run('W+Shift ускорение', ['w', 'Shift'], 2000);

// Клавиша должна отрывать камеру у авто-наводки: запускаем flyTo и тут же жмём W.
const cancel = await page.evaluate(async () => {
  const cam = window.__kupol.viewer.camera;
  let called = 0;
  const orig = cam.cancelFlight.bind(cam);
  cam.cancelFlight = () => { called += 1; return orig(); };
  cam.flyTo({ destination: cam.positionWC, duration: 6 });
  await new Promise((r) => setTimeout(r, 400));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
  cam.cancelFlight = orig;
  return { called, flying: cam._flightTracker?.length ?? 0 };
});

console.log('FLIGHT', JSON.stringify(results, null, 1));
console.log('CANCEL', JSON.stringify(cancel));
console.log('errors:', JSON.stringify(errs.slice(0, 4)));
await browser.close();
server.kill('SIGTERM');
