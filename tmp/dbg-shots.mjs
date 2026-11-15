// Что марш действительно находит в объёме — снимаем каналы диагностики u_dbg.
// Две камеры: близкая (как ставит игру frameCloud) и дальняя (лабораторная).
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.PORT || 5254);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import('node:fs');

let vite = null;
const up = async () => { try { return (await fetch(`${base}/vol-lab.html`)).ok; } catch { return false; } };
if (!(await up())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 160; i += 1) { if (await up()) break; await sleep(500); }
}
const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofileDbg',
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.VW || 800), height: Number(process.env.VH || 450) });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', String(m.text()).slice(0, 200)); });
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 1000 });

const MODES = [0, 1, 2, 3, 4];
const CAMS = [
  // близкая: геометрия game/nuclear-range.js frameCloud для «Малыша»
  ['near', { southM: 13900, camAltM: 7700, lookUpM: 4950 }],
  ['far', { southM: 42000, camAltM: 12000, lookUpM: 6000 }],
];

for (const [camName, cam] of CAMS) {
  const info = await page.evaluate((c) => window.lab({
    bomb: 'little_boy', city: 'London', fraction: 0.55, iso: '2026-06-21T19:15:00Z', ...c,
  }), cam);
  console.log(`lab ${camName}`, JSON.stringify(info));
  for (const m of MODES) {
    await page.evaluate((mode) => { window.__stage.uniforms.u_dbg = mode; }, m);
    await sleep(7000);
    const buf = await page.screenshot();
    fs.writeFileSync(`D:/mt5/tmp-nuclear/shots/dbg_${camName}_m${m}.png`, buf);
    const stats = await page.evaluate(() => {
      const u = window.__stage.uniforms;
      return { age: Math.round(u.u_age), boundR: Math.round(u.u_boundR), steps: u.u_steps,
        head: [Math.round(u.u_head.y), Math.round(u.u_head.w), Math.round(u.u_headShape.x)],
        stem: [Math.round(u.u_stem.x), Math.round(u.u_stem.y), Math.round(u.u_stem.z), u.u_stem.w],
        skirt: [Math.round(u.u_skirt.x), Math.round(u.u_skirt.y), u.u_skirt.z],
        fb: [Math.round(u.u_fb.w), u.u_fbShape.z], exp: u.u_exposure, life: u.u_life,
        show: window.__stage.show, cam: [Math.round(u.u_cam.x), Math.round(u.u_cam.y), Math.round(u.u_cam.z)],
        tan: [+u.u_rayTan.x.toFixed(3), +u.u_rayTan.y.toFixed(3)] };
    });
    console.log(`dbg_${camName}_m${m}`, JSON.stringify(stats));
  }
}
console.log('DBG DONE');
await browser.close();
vite?.kill('SIGTERM');
