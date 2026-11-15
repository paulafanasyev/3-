// Глубина пост-прохода в игре + проверка sunI/exposure после правки preRender.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4207);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/${name}.png` });
const step = (label) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}`);

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

const SCAL = () => {
  const v = window.__kupol.viewer;
  const col = v.scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((x) => String(x.name).startsWith('kupol-blast'));
  const u = blast?.uniforms || {};
  return {
    stages: stages.map((x) => `${x.name}:show=${x.show}`).join('|'),
    sunI: String(u.u_sunI), exposure: String(u.u_exposure), boundR: String(u.u_boundR),
    age: String(u.u_age), life: String(u.u_life), steps: String(u.u_steps),
    fbCut: String(u.u_fbCut), ax0: u.u_ax0 ? `${u.u_ax0.x},${u.u_ax0.y},${u.u_ax0.z}` : 'none',
    msaa: v.scene.msaaSamples, errs: (window.__kupolErrs || []).slice(-2),
  };
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileB',
    headless: 'new', protocolTimeout: 1800000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 460 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => {
    window.__kupol.viewer.resolutionScale = 0.45;
    window.__kupolErrs = [];
    window.__kupol.viewer.scene.renderError.addEventListener(() => {
      window.__kupolErrs.push('renderError');
    });
  });
  step('game ready');

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
  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');
  await sleep(8000);
  step('show running');
  console.log('SCAL-a', JSON.stringify(await page.evaluate(SCAL)));
  await shot(page, 'dq3_a_msaa4');

  // Тот же кадр без MSAA: если гриб появится — дело в резолве depth-текстуры.
  await page.evaluate(() => { window.__kupol.viewer.scene.msaaSamples = 1; });
  await sleep(5000);
  console.log('SCAL-b', JSON.stringify(await page.evaluate(SCAL)));
  await shot(page, 'dq3_b_msaa1');

  // Картинка depth: белый = far (1.0), чёрный = 0.0.
  await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    const Ctor = col.get(0).constructor;
    col.add(new Ctor({
      name: 'kupol-depth-debug',
      fragmentShader: `
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
void main() {
  float d = czm_readDepth(depthTexture, v_textureCoordinates);
  out_FragColor = vec4(d, step(0.999, d) * 0.85 + step(d, 0.001) * 0.45, 0.0, 1.0);
}
`,
    }));
    return col.length;
  }).then((n) => console.log('stages with debug', n));
  await sleep(4000);
  await shot(page, 'dq3_c_depth');
  const removed = await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = col.length - 1; i >= 0; i -= 1) {
      if (String(col.get(i).name) === 'kupol-depth-debug') col.remove(col.get(i));
    }
    return col.length;
  });
  console.log('stages after remove', removed);
  step('done');
} catch (e) {
  console.error('DQ3 FAIL:', String(e.stack || e).slice(0, 900));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
