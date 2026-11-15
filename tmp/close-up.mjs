// Диагностика «шар без ножки»: крупный план облака + полный дамп униформ.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = 4201;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (c) => { out += c; });
server.stderr.on('data', (c) => { out += c; });
for (let i = 0; i < 120; i += 1) {
  try { if ((await fetch(`${base}/kupol`)).ok) break; } catch { /* стартует */ }
  await sleep(500);
}

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofile4',
  headless: 'new',
  protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 620 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e.message).slice(0, 200)}`));
await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
await page.click('.k-start .k-nations button[data-id]');
await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.7; });

await page.click('.k-nrange-trigger');
await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
await page.select('#k-nrange-bomb', 'little-boy');
await page.click('#k-nrange-city-query');
await page.keyboard.down('Control');
await page.keyboard.press('KeyA');
await page.keyboard.up('Control');
await page.keyboard.press('Backspace');
await page.type('#k-nrange-city-query', 'London', { delay: 30 });
await page.waitForFunction(() => {
  const select = document.querySelector('#k-nrange-city-results');
  return select && [...select.options].some((o) => o.textContent.startsWith('London ·'));
}, { timeout: 30000 });
const value = await page.$eval('#k-nrange-city-results', (select) => [...select.options].find((o) => o.textContent.startsWith('London ·')).value);
await page.select('#k-nrange-city-results', value);
await sleep(6000);
await page.click('[data-test]');
await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 300000 });
await page.click('[data-close]');
await sleep(12000);

const NAMES = ('u_age u_steps u_life u_seed u_boundR u_bound u_head u_headShape u_headDetail '
  + 'u_headHeat u_headColA u_headColB u_stem u_stemShape u_stemCol u_stemWobble u_stemTwist '
  + 'u_stemTopFlare u_skirt u_skirtCol u_skirtFront u_fb u_fbShape u_fbLook u_fbTint u_wind u_windH '
  + 'u_churn u_groundCol u_ring0 u_ring1 u_ring2 u_ring3 u_ice u_ice2 u_dome u_domeCol u_cam u_rayTan').split(' ');
const DUMP = (names) => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  const stages = Array.from({ length: col.length }, (_, i) => col.get(i));
  const blast = stages.find((s) => String(s.name).startsWith('kupol-blast'));
  const u = blast?.uniforms || {};
  const fmt = (v) => (typeof v === 'number'
    ? (Math.abs(v) < 1e6 ? Math.round(v * 100) / 100 : v)
    : v && typeof v === 'object' && 'x' in v
      ? [v.x, v.y, v.z, v.w].map((n) => Math.round((n || 0) * 100) / 100) : String(v));
  const table = {};
  for (const k of names) table[k] = fmt(u[k]);
  return table;
};
const table = await page.evaluate(DUMP, NAMES);
console.log('UNIFORMS', JSON.stringify(table, null, 0));
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/close_littleboy_early.png' });

// крупный план: едем вдоль взгляда к грибу — без конструкторов Cesium
for (let i = 0; i < 3; i += 1) {
  await page.evaluate(() => { window.__kupol.viewer.camera.zoomIn(3000); });
  await sleep(2500);
}
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/close_littleboy.png' });
const near = await page.evaluate(DUMP, NAMES);
console.log('UNIFORMS_NEAR', JSON.stringify(near));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
await browser.close();
server.kill('SIGTERM');
console.log('CLOSEUP DONE');
