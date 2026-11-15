import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5216, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type().toUpperCase()} ${m.text().slice(0, 220)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await sleep(25000);
console.log('ready:', await page.evaluate(() => window.ready === true));
console.log('hud:', await page.evaluate(() => (document.getElementById('hud')?.innerText || '').slice(0, 200)));
console.log('imagery:', await page.evaluate(() => document.getElementById('hud')?.dataset?.imagery ?? null));
console.log('layers:', await page.evaluate(() => window.__viewer?.imageryLayers?.length ?? -1));
console.log('errs:', JSON.stringify(errs.slice(0, 12), null, 1));
await browser.close(); vite.kill('SIGTERM');
