// Прогон лаборатории на ТЕКУЩЕМ коде: те же ракурсы, что дали lab_mature.png 10.11.
// Цель — отделить регрессию в шейдере от кадрирования игры.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5243, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vite = null;
const up = async () => { try { return (await fetch(`${base}/vol-lab.html`)).ok; } catch { return false; } };
if (!(await up())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stderr.on('data', (d) => console.log('[vite]', String(d).slice(0, 300)));
  for (let i = 0; i < 160; i += 1) { if (await up()) break; await sleep(500); }
}
const browser = await puppeteer.launch({
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: 'D:/mt5/tmp-nuclear/pprofile5',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 560 });
const errs = [];
page.on('pageerror', (e) => { errs.push(`PAGEERROR ${e.message}`); console.log('PAGEERROR', e.message.slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { errs.push(`CONSOLE ${m.text().slice(0, 300)}`); console.log('CONSOLE', m.text().slice(0, 300)); } });
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch((e) => console.log('GOTO', e.message));
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 2000 });
await page.evaluate(() => { window.__viewer.scene.resolutionScale = 0.55; });

const NAMES = ('u_age u_steps u_life u_seed u_boundR u_bound u_head u_headShape u_headDetail u_headHeat '
  + 'u_headColA u_headColB u_lobes u_stem u_stemShape u_stemCol u_stemWobble u_stemTwist u_stemTopFlare '
  + 'u_skirt u_skirtCol u_skirtFront u_fb u_fbShape u_fbLook u_fbTint u_fbCut u_wind u_windH u_churn '
  + 'u_groundCol u_ring0 u_ring1 u_ring2 u_ring3 u_ice u_ice2 u_dome u_domeCol u_cam u_rayDir u_rayTan u_sunI u_exposure').split(' ');
const DUMP = (names) => {
  const col = window.__viewer.scene.postProcessStages;
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

const shots = [
  ['now_bravo_mature', { bomb: 'castle_bravo', fraction: 0.62, southM: 120000, camAltM: 14000, lookUpM: 10000, iso: '2026-06-21T19:15:00Z' }],
  ['now_bravo_rise', { bomb: 'castle_bravo', fraction: 0.35, southM: 90000, camAltM: 8000, lookUpM: 5000, iso: '2026-06-21T19:15:00Z' }],
  ['now_lb_mature', { bomb: 'little_boy', fraction: 0.62, southM: 22000, camAltM: 4000, lookUpM: 4200, iso: '2026-06-21T19:15:00Z' }],
  ['now_lb_far', { bomb: 'little_boy', fraction: 0.62, southM: 60000, camAltM: 12000, lookUpM: 4200, iso: '2026-06-21T19:15:00Z' }],
];
for (const [name, cfg] of shots) {
  const info = await page.evaluate((c) => window.lab(c), cfg);
  await sleep(6000);
  const table = await page.evaluate(DUMP, NAMES);
  await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/${name}.png` });
  console.log(name, JSON.stringify({ age: info.age, boundR: info.boundR, head: info.head, stem: info.stem, cam: info.cam, rayTan: info.rayTan, errors: info.errors }));
  console.log('  TABLE', JSON.stringify(table));
}
console.log('errors:', JSON.stringify(errs.slice(-3)));
await browser.close();
vite?.kill('SIGTERM');
