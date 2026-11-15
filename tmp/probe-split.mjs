import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5219, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 300)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 180000 });
await page.evaluate(async () => { await window.runTest('castle_bravo', 'London', 'wide'); });

// Замораживаем часы: объёмный гриб живёт десятки секунд, а сравнение слоёв
// требует четырёх кадров одного и того же состояния.
await page.evaluate(() => {
  const realNow = performance.now.bind(performance);
  const t0 = realNow();
  performance.now = () => t0 + (realNow() - t0) / 1000;
});

// Кто рисует «серые диски»: по одному переключателю на кадр.
const NAMES = ['u_head', 'u_headShape', 'u_headColA', 'u_headColB', 'u_headHeat', 'u_headDetail',
  'u_stem', 'u_stemShape', 'u_stemCol', 'u_skirt', 'u_skirtCol', 'u_fb', 'u_fbLook', 'u_fbShape',
  'u_bound', 'u_boundR', 'u_age', 'u_exposure', 'u_steps', 'u_life', 'u_flash', 'u_sunI',
  'u_lobes', 'u_stemWobble', 'u_stemTwist', 'u_stemTopFlare', 'u_churn', 'u_wind', 'u_windH', 'u_shock'];
const dump = async () => page.evaluate((names) => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (!String(c.name).startsWith('kupol-blast')) continue;
    const out = { show: c.show };
    for (const n of names) { const v = c.uniforms[n]; if (v === undefined) continue;
      out[n] = typeof v === 'object' && v !== null ? [+v.x.toFixed(0), +v.y.toFixed(0), +v.z.toFixed(0), v.w === undefined ? null : +v.w.toFixed(3)] : v; }
    return out;
  }
  return { gone: true };
}, NAMES);
const count = async () => page.evaluate(() => {
  const out = { ents: {}, ds: [] };
  for (const kind of ['ellipse', 'point', 'model', 'billboard', 'box', 'sphere', 'polyline', 'rectangle', 'polygon']) {
    out.ents[kind] = window.__viewer.entities.values.filter((e) => e[kind] !== undefined && e[kind] !== null).length;
  }
  for (let i = 0; i < window.__viewer.dataSources.length; i += 1) {
    const d = window.__viewer.dataSources.get(i);
    const per = {};
    for (const kind of ['ellipse', 'point', 'model', 'billboard', 'box', 'sphere', 'polyline', 'rectangle', 'polygon']) {
      per[kind] = d.entities.values.filter((e) => e[kind] !== undefined && e[kind] !== null).length;
    }
    out.ds.push({ name: d.name, total: d.entities.values.length, per });
  }
  return out;
});
console.log('UNIFORMS', JSON.stringify(await dump()));
console.log('GRAPHICS', JSON.stringify(await count()));
const shot = async (name) => { await sleep(1500); return page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/split_${name}.png` }); };
await shot('all_on');
await page.evaluate(() => { const s = window.__viewer.scene; for (let i = 0; i < s.postProcessStages.length; i += 1) { const c = s.postProcessStages.get(i); if (String(c.name).startsWith('kupol-blast')) c.show = false; } });
await shot('stage_off');
await page.evaluate(() => { const s = window.__viewer.scene; for (let i = 0; i < s.postProcessStages.length; i += 1) { const c = s.postProcessStages.get(i); if (String(c.name).startsWith('kupol-blast')) c.show = true; } window.__viewer.dataSources.get(0).show = false; });
await shot('damage_off');
await page.evaluate(() => { window.__viewer.entities.show = false; });
await shot('viewerEnts_off');
console.log('UNIFORMS_AFTER', JSON.stringify(await dump()));
console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
