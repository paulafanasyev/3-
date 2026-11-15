import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.PREVIEW_DEV_PORT || 5199);
const base = `http://127.0.0.1:${port}`;
const bomb = process.argv[2] || 'little_boy';
const city = process.argv[3] || 'London';
const view = process.argv[4] || 'wide';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let viteOut = '';
vite.stdout.on('data', (c) => { viteOut += c.toString(); });
vite.stderr.on('data', (c) => { viteOut += c.toString(); });

async function waitVite() {
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`${base}/preview.html`); if (r.ok) return; } catch { /* up */ }
    await sleep(500);
  }
  throw new Error(`vite dev not ready: ${viteOut}`);
}

let browser;
try {
  await waitVite();
  browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 600000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear'}/chrome-profile2`,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.ready === true', { timeout: 120000 });
  const res = await page.evaluate((b, c, v) => window.runTest(b, c, v), bomb, city, view);
  console.log('runTest ->', JSON.stringify(res));
  await sleep(6000);
  const report = await page.evaluate(() => {
    const Cesium = window.__Cesium;
    const viewer = window.__viewer;
    const now = Cesium.JulianDate.now();
    const value = (prop) => (typeof prop?.getValue === 'function' ? prop.getValue(now) : prop);
    const bad = [];
    const counts = { ellipse: 0, box: 0, ellipsoid: 0, point: 0 };
    const scan = (collection, owner) => {
      const list = collection.values;
      for (const entity of list) {
        if (entity.ellipse) {
          counts.ellipse += 1;
          const major = Number(value(entity.ellipse.semiMajorAxis));
          const minor = Number(value(entity.ellipse.semiMinorAxis));
          if (!(major >= minor) || !Number.isFinite(major) || !Number.isFinite(minor)) {
            bad.push({ owner, id: entity.id, major, minor, height: Number(value(entity.ellipse.height)) });
          }
        }
        if (entity.box) counts.box += 1;
        if (entity.ellipsoid) counts.ellipsoid += 1;
        if (entity.point) counts.point += 1;
      }
    };
    for (let i = 0; i < viewer.dataSources.length; i += 1) {
      const ds = viewer.dataSources.get(i);
      scan(ds.entities, ds.name);
    }
    scan(viewer.entities, 'viewer.entities');
    return {
      counts,
      bad: bad.slice(0, 12),
      renderErrors: (window.__renderErrors || []).slice(0, 3),
      cameraHeight: Math.round(viewer.camera.positionCartographic.height),
    };
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('DEBUG FAIL:', error.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
