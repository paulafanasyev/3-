import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5215, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 200)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 120000 });

await page.evaluate(async () => {
  await window.runTest('castle_bravo', 'London', 'wide');
  window.__viewer.entities.show = false;   // слой сущностей гасит сам Cesium, каждый кадр
});
let prev = 0;
for (const t of [2, 5, 9, 14, 20]) {
  await sleep((t - prev) * 1000);
  prev = t;
  await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/volonly_${String(t).padStart(2, '0')}s.png` });
  const u = await page.evaluate(() => {
    const s = window.__viewer.scene;
    let st = null;
    for (let i = 0; i < s.postProcessStages.length; i += 1) {
      const c = s.postProcessStages.get(i);
      if (String(c.name).startsWith('kupol-blast')) st = c;
    }
    if (!st) return { gone: true };
    const q = st.uniforms;
    return { age: +q.u_age.toFixed(1), show: st.show, boundR: Math.round(q.u_boundR),
      headR: Math.round(q.u_head.w), headY: Math.round(q.u_head.y), stemR: Math.round(q.u_stem.z),
      fbR: Math.round(q.u_fb.w), exp: +q.u_exposure.toFixed(3), steps: q.u_steps };
  });
  console.log(`t=${t}s`, JSON.stringify(u));
}
console.log('page errors:', JSON.stringify(errs.slice(-4)));
await browser.close(); vite.kill('SIGTERM');
