// Только один вопрос: что лежит в depth-текстуре пост-прохода игры при MSAA 4
// и при MSAA 1. Без взрыва и без города — кадр любой сцены.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4208);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/${name}.png` });

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

const ADD = () => {
  const v = window.__kupol.viewer;
  const col = v.scene.postProcessStages;
  const anyStage = (col._defaultStages || []).find(Boolean) || (col.length ? col.get(0) : null);
  const Ctor = anyStage ? anyStage.constructor : null;
  if (!Ctor) return { error: `no stage ctor (len=${col.length}, defs=${(col._defaultStages || []).length})` };
  col.add(new Ctor({
    name: 'kupol-depth-debug',
    fragmentShader: `
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
void main() {
  float d = czm_readDepth(depthTexture, v_textureCoordinates);
  // R — сама глубина, G — «дальняя плоскость» (1.0), B — «ноль» (пусто).
  out_FragColor = vec4(d, step(0.999, d), step(d, 0.001), 1.0);
}
`,
  }));
  return { n: col.length, enableLighting: v.scene.enableLighting, msaa: v.scene.msaaSamples };
};

const REMOVE = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = col.length - 1; i >= 0; i -= 1) {
    if (String(col.get(i).name) === 'kupol-depth-debug') col.remove(col.get(i));
  }
  return col.length;
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileC',
    headless: 'new', protocolTimeout: 1800000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => {
    window.__kupol.viewer.resolutionScale = 0.5;
    window.__errs = [];
    window.__kupol.viewer.scene.renderError.addEventListener(() => { window.__errs.push('renderError'); });
  });
  // Над Лондоном, вниз под углом — та же геометрия лучей, что и на показе.
  await page.evaluate(async () => {
    const Cesium = window.__kupol.Cesium || window.Cesium;
    const v = window.__kupol.viewer;
    const C3 = v.camera.positionWC.constructor;
    v.camera.setView({
      destination: C3.fromDegrees(-0.119, 51.502, 9000),
      orientation: { heading: 0, pitch: Cesium ? Cesium.Math.toRadians(-11) : -0.192, roll: 0 },
    });
  }).catch(async (e) => {
    console.log('setView fallback', String(e).slice(0, 120));
    await page.evaluate(() => {
      const v = window.__kupol.viewer;
      const C3 = v.camera.positionWC.constructor;
      v.camera.setView({
        destination: C3.fromDegrees(-0.119, 51.502, 9000),
        orientation: { heading: 0, pitch: -0.192, roll: 0 },
      });
    });
  });
  await sleep(6000);
  console.log('ADD', JSON.stringify(await page.evaluate(ADD)));
  await sleep(4000);
  await shot(page, 'dp_msaa4');
  await page.evaluate(() => { window.__kupol.viewer.scene.msaaSamples = 1; });
  await sleep(4000);
  await shot(page, 'dp_msaa1');
  console.log('REMOVE', await page.evaluate(REMOVE));
  console.log('ERRS', JSON.stringify(await page.evaluate(() => window.__errs)));
  console.log('DONE');
} catch (e) {
  console.error('DP FAIL:', String(e.stack || e).slice(0, 700));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
