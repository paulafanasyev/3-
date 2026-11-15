import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5212, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
let viteOut = ''; vite.stdout.on('data', (c) => { viteOut += c; }); vite.stderr.on('data', (c) => { viteOut += c; });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 120000 });
const out = await page.evaluate(async () => {
  await window.runTest('castle_bravo', 'London', 'wide');
  await new Promise((x) => setTimeout(x, 3500));
  const s = window.__viewer.scene;
  const stages = [];
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const st = s.postProcessStages.get(i);
    const u = st.uniforms || {};
    stages.push({
      name: st.name, show: st.show,
      exposure: u.u_exposure, sunI: u.u_sunI, boundR: u.u_boundR, steps: u.u_steps,
      fbR: u.u_fb?.w, fbLook: [u.u_fbLook?.x, u.u_fbLook?.y, u.u_fbLook?.z, u.u_fbLook?.w],
      headR: u.u_head?.w, headDens: u.u_headShape?.z, age: u.u_age, life: u.u_life, flash: u.u_flash,
    });
  }
  return {
    stages,
    hudVolume: document.getElementById('hud').dataset.volume ?? null,
    hudVisuals: document.getElementById('hud').dataset.visuals ?? null,
    renderErrors: (window.__renderErrors || []).slice(0, 2),
    state: window.__volState(),
  };
});
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
console.log('page errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
