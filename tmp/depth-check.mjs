// Замер глубины в пост-проходе игры: если depthTexture пустой, марш обрывается
// на tExit=min(exit, sceneT) и объём не рисует вообще (ровно то, что дал A/B).
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4205);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITY = { lon: -0.119, lat: 51.502 };

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

const PROBE = () => {
  const v = window.__kupol.viewer;
  const s = v.scene;
  const col = s.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((x) => String(x.name).startsWith('kupol-blast'));
  const u = blast?.uniforms || {};
  const num = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : `NaN/${x}`) : `type=${typeof x}`);
  const vec = (x) => (x && typeof x === 'object' && 'x' in x
    ? [x.x, x.y, x.z, x.w].map((n) => (Number.isFinite(n) ? Math.round(n * 1e3) / 1e3 : `NaN`)) : `type=${typeof x}`);
  return {
    scalars: {
      age: num(u.u_age), boundR: num(u.u_boundR), steps: num(u.u_steps), life: num(u.u_life),
      sunI: num(u.u_sunI), exposure: num(u.u_exposure), flash: num(u.u_flash),
      seed: num(u.u_seed), lobes: num(u.u_lobes), windH: num(u.u_windH), fbCut: num(u.u_fbCut),
    },
    vecs: {
      ax0: vec(u.u_ax0), ax1: vec(u.u_ax1), ax2: vec(u.u_ax2),
      cam: vec(u.u_cam), rayDir: vec(u.u_rayDir), rayUp: vec(u.u_rayUp), rayRight: vec(u.u_rayRight),
      rayTan: vec(u.u_rayTan), bound: vec(u.u_bound), head: vec(u.u_head), stem: vec(u.u_stem),
      headShape: vec(u.u_headShape), headHeat: vec(u.u_headHeat), fb: vec(u.u_fb), fbLook: vec(u.u_fbLook),
      shock: vec(u.u_shock), shock3: vec(u.u_shock3),
    },
    show: blast ? { show: blast.show, en: blast.enabled } : null,
    scene: {
      msaa: s.msaaSamples, hdr: s.highDynamicRange, resScale: v.resolutionScale,
      rrm: s.requestRenderMode, fxaa: col.fxaa?.enabled, bloom: col.bloom?.enabled,
      depthTestTerrain: s.globe.depthTestAgainstTerrain, globeShow: s.globe.show,
      canvas: [s.canvas.width, s.canvas.height],
      far: s.camera.frustum.far, near: s.camera.frustum.near,
      camH: Math.round(s.camera.positionCartographic.height),
      pitch: Math.round(s.camera.pitch * 57.2958),
    },
    imagery: Array.from({ length: s.imageryLayers.length }, (_, i) => {
      const L = s.imageryLayers.get(i);
      const p = L?.imageryProvider;
      return {
        i, show: L?.show, ready: p?.ready, type: p?.constructor?.name,
        url: String(p?.url ?? p?._resource?.url ?? '').slice(0, 110),
        credit: String(p?.credit ?? '').slice(0, 60),
      };
    }),
  };
};

const SHOT = (path) => {
  const v = window.__kupol.viewer;
  const s = v.scene;
  const col = s.postProcessStages;
  const StageCtor = col.length ? col.get(0).constructor : null;
  if (!StageCtor) return { error: 'no stage ctor' };
  const dbg = new StageCtor({
    name: 'kupol-depth-debug',
    fragmentShader: `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
void main() {
  float d = czm_readDepth(depthTexture, v_textureCoordinates);
  float lin = czm_inverseDepth(d, 0.1, 1000000000.0);
  out_FragColor = vec4(d, step(0.999, d) * 0.5 + step(d, 0.001) * 0.25, clamp(lin / 30000.0, 0.0, 1.0), 1.0);
}
`,
  });
  col.add(dbg);
  return { added: String(dbg.name), farIsWhite: true, path };
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofile9',
    headless: 'new', protocolTimeout: 900000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 560 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.5; });
  console.log('game ready');

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', process.env.BOMB || 'little-boy');
  await page.click('#k-nrange-city-query');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#k-nrange-city-query', 'London', { delay: 30 });
  await page.waitForFunction((name) => {
    const sel = document.querySelector('#k-nrange-city-results');
    return sel && [...sel.options].some((o) => o.textContent.startsWith(`${name} ·`));
  }, { timeout: 30000 }, 'London');
  const value = await page.$eval('#k-nrange-city-results',
    (sel, name) => [...sel.options].find((o) => o.textContent.startsWith(`${name} ·`)).value, 'London');
  await page.select('#k-nrange-city-results', value);
  await sleep(9000);
  console.log('PROBE-before-test', JSON.stringify(await page.evaluate(PROBE)));
  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');
  await sleep(8000);

  console.log('PROBE', JSON.stringify(await page.evaluate(PROBE)));
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dep_base.png' });

  // Картинка глубины пост-прохода: белый = far (1.0), чёрный = 0.
  await page.evaluate(SHOT, 'dep_depth.png');
  await sleep(1500);
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dep_depth.png' });
  await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
    const dbg = stages.find((x) => String(x.name) === 'kupol-depth-debug');
    if (dbg) col.remove(dbg);
    return stages.map((x) => String(x.name));
  }).then((r) => console.log('stages after remove', JSON.stringify(r)));

  // Гипотеза 1: MSAA ломает depth-резолв.
  await page.evaluate(() => { window.__kupol.viewer.scene.msaaSamples = 1; });
  await sleep(4000);
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dep_msaa1.png' });
  console.log('PROBE-msaa1', JSON.stringify((await page.evaluate(PROBE)).scene));

  // Гипотеза 2: глубина рельефа режет марш.
  await page.evaluate(() => { window.__kupol.viewer.scene.globe.show = false; });
  await sleep(4000);
  await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dep_noglobe.png' });
  await page.evaluate(() => { window.__kupol.viewer.scene.globe.show = true; });
  console.log('DEPTH CHECK DONE');
} catch (e) {
  console.error('DEPTH FAIL:', e.stack || e);
  if (serverOutput) console.error(serverOutput.slice(-800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
