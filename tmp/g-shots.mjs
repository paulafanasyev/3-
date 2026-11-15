// Лаборатория с ЧЕСТНОЙ игровой камерой. fovy в игре 36° (u_rayTan.y=0.325),
// поэтому fitRange = radius/tan(18°*0.85) = radius/0.273 — jauh, чем казалось
// при допущении 60°. Кадр frameCloud для «Малыша»: центр cloudTop*0.45,
// радиус hypot(cloudTop*0.55, capRadius*1.5), pitch -11°.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.PORT || 5256);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import('node:fs');
const TAG = process.env.SHOT_TAG || 'g';

let vite = null;
const up = async () => { try { return (await fetch(`${base}/vol-lab.html`)).ok; } catch { return false; } };
if (!(await up())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 160; i += 1) { if (await up()) break; await sleep(500); }
}
const browser = await puppeteer.launch({
  userDataDir: `D:/mt5/tmp-nuclear/pprofile${TAG}`,
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.VW || 960), height: Number(process.env.VH || 540) });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 1000 });

// Камера = frameCloud: range = R/tan(fovy/2*0.85), pitch -11°, цель на cloudTop*0.45.
const FRAMINGS = JSON.parse(process.env.FRAMES || JSON.stringify([
  // [имя, cloudTop(м), capRadius(м)] — как их считает frameCloud по ЗРЕЛОМУ
  // грибу: у LB cloud_top_m 12500, а шапка к 0.75·tFull расходится до 3.4 км.
  ['cloud', 12500, 3400],
]));
const FRACTIONS = JSON.parse(process.env.FRACTIONS || '[0.12,0.3,0.55,0.8]');
const BOMB = process.env.BOMB || 'little_boy';
const MODES = JSON.parse(process.env.MODES || '[0]');

for (const [fname, cloudTop, capR] of FRAMINGS) {
  const R = Math.max(Math.hypot(cloudTop * 0.55, capR * 1.5), 1500);
  const range = R / Math.tan(18 * 0.85 * Math.PI / 180);
  const targetH = cloudTop * 0.45;
  const southM = range * Math.cos(11 * Math.PI / 180);
  const camAltM = targetH + range * Math.sin(11 * Math.PI / 180);
  console.log(`framing ${fname}: R=${Math.round(R)} range=${Math.round(range)} camAlt=${Math.round(camAltM)} lookUp=${Math.round(targetH)}`);
  for (const fraction of FRACTIONS) {
    for (const mode of MODES) {
      const info = await page.evaluate((a) => window.lab({
        bomb: a.bomb, city: 'London', fraction: a.fraction, iso: '2026-06-21T19:15:00Z',
        southM: a.southM, camAltM: a.camAltM, lookUpM: a.lookUpM,
      }), { bomb: BOMB, fraction, southM, camAltM, lookUpM: targetH });
      await page.evaluate((m) => { window.__stage.uniforms.u_dbg = m; }, mode);
      await sleep(20000);
      const name = `${TAG}_${fname}_f${Math.round(fraction * 100)}_m${mode}`;
      const alive = await page.evaluate(() => !!window.__stage);
      if (!alive) {
        console.log(`${name} PAGE DEAD, перезапускаю лабораторию`);
        await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 1000 });
        await page.evaluate((a) => window.lab(a), { bomb: BOMB, fraction, southM, camAltM, lookUpM: targetH });
        await page.evaluate((m) => { window.__stage.uniforms.u_dbg = m; }, mode);
        await sleep(20000);
      }
      fs.writeFileSync(`D:/mt5/tmp-nuclear/shots/${name}.png`, await page.screenshot());
      const u = await page.evaluate(() => {
        const s = window.__stage.uniforms;
        return { age: Math.round(s.u_age), steps: s.u_steps, boundR: Math.round(s.u_boundR),
          head: [Math.round(s.u_head.y), Math.round(s.u_head.w), Math.round(s.u_headShape.x), +s.u_headShape.y.toFixed(2), +s.u_headShape.z.toFixed(3)],
          stem: [Math.round(s.u_stem.y), Math.round(s.u_stem.z), +s.u_stem.w.toFixed(2), +s.u_stemShape.x.toFixed(2)],
          skirt: [Math.round(s.u_skirt.x), Math.round(s.u_skirt.y), +s.u_skirt.z.toFixed(2)],
          fb: Math.round(s.u_fb.w), exp: +s.u_exposure.toFixed(3) };
      });
      console.log(name, JSON.stringify(info.errors), JSON.stringify(u));
    }
  }
}
console.log('G DONE');
await browser.close();
vite?.kill('SIGTERM');
