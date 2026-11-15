// scene.pickPosition читает ровно ту depth-текстуру, что получает пост-проход.
// Сравниваем её с аналитическим пересечением луча и глобуса при MSAA 4 и 1:
// если GPU-глубина расходится с аналитикой, марш облака обрывается на tExit.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4209);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const h = await fetch(`${base}/api/health`);
      if (h.ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* стартует */ }
    await sleep(500);
  }
  throw new Error(`server did not start: ${serverOutput.slice(-800)}`);
}

const MEASURE = (pts) => {
  const v = window.__kupol.viewer;
  const s = v.scene;
  const C3 = v.camera.positionWC.constructor;
  const out = [];
  for (const [fx, fy] of pts) {
    const px = new C3(Math.round(s.canvas.width * fx), Math.round(s.canvas.height * fy));
    let gpu;
    try {
      const p = s.pickPosition(px);
      gpu = p ? Math.round(C3.distance(p, s.camera.positionWC)) : null;
    } catch (e) { gpu = `err:${String(e.message).slice(0, 40)}`; }
    let ana = null;
    try {
      const world = s.camera.pickEllipsoid(px, s.globe.ellipsoid);
      ana = world ? Math.round(C3.distance(world, s.camera.positionWC)) : null;
    } catch (e) { ana = `err:${String(e.message).slice(0, 40)}`; }
    out.push({ at: [fx, fy], gpuPick_m: gpu, ellipsoid_m: ana });
  }
  return {
    msaa: s.msaaSamples,
    depthTextureSupported: Boolean(s.context.depthTexture),
    hasGlobeDepth: Boolean(s._view && s._view.globeDepth),
    hdr: s.highDynamicRange,
    enableLighting: s.enableLighting,
    canvas: [s.canvas.width, s.canvas.height],
    camH: Math.round(s.camera.positionCartographic.height),
    pts: out,
  };
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileD',
    headless: 'new', protocolTimeout: 1800000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.5; });
  await page.evaluate(() => {
    const v = window.__kupol.viewer;
    const C3 = v.camera.positionWC.constructor;
    v.camera.setView({
      destination: C3.fromDegrees(-0.119, 51.422, 9000),
      orientation: { heading: 0, pitch: -0.192, roll: 0 },
    });
  });
  await sleep(15000);
  const PTS = [[0.5, 0.75], [0.5, 0.55], [0.3, 0.85], [0.7, 0.65]];
  console.log('MSAA4', JSON.stringify(await page.evaluate(MEASURE, PTS)));
  await page.evaluate(() => { window.__kupol.viewer.scene.msaaSamples = 1; });
  await sleep(8000);
  console.log('MSAA1', JSON.stringify(await page.evaluate(MEASURE, PTS)));
  console.log('DONE');
} catch (e) {
  console.error('DQ5 FAIL:', String(e.stack || e).slice(0, 700));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
