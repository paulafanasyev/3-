import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5241, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vite = null;
const up = async () => { try { return (await fetch(`${base}/vol-lab.html`)).ok; } catch { return false; } };
if (!(await up())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stderr.on('data', (d) => console.log('[vite]', String(d).slice(0, 300)));
  for (let i = 0; i < 120; i += 1) { if (await up()) break; await sleep(500); }
}
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => { errs.push(`PAGEERROR ${e.message}`); console.log('PAGEERROR', e.message.slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { errs.push(`CONSOLE ${m.text().slice(0, 300)}`); console.log('CONSOLE', m.text().slice(0, 300)); } });
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => console.log('GOTO', e.message));
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 2000 });

const shots = [
  ['lab_early', { fraction: 0.12, southM: 60000, camAltM: 4000, lookUpM: 1500, iso: '2026-06-21T19:15:00Z' }],
  ['lab_rise', { fraction: 0.35, southM: 90000, camAltM: 8000, lookUpM: 5000, iso: '2026-06-21T19:15:00Z' }],
  ['lab_mature', { fraction: 0.62, southM: 120000, camAltM: 14000, lookUpM: 10000, iso: '2026-06-21T19:15:00Z' }],
  ['lab_anvil', { fraction: 0.85, southM: 160000, camAltM: 22000, lookUpM: 15000, iso: '2026-06-21T19:15:00Z' }],
];
for (const [name, cfg] of shots) {
  const info = await page.evaluate((c) => window.lab(c), cfg);
  await sleep(4000);
  await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/${name}.png` });
  console.log(name, JSON.stringify(info));
}
console.log('errors:', JSON.stringify(errs.slice(-3)));
await browser.close();
vite?.kill('SIGTERM');
