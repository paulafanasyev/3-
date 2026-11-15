import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5214, base = `http://127.0.0.1:${port}`;
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

const bomb = process.argv[2] || 'castle_bravo';
const secs = Number(process.argv[3] || 12);
const dump = await page.evaluate(async (b, ss) => {
  await window.resetVolumes?.();
  await window.runTest(b, 'London', 'wide');
  const t0 = performance.now();
  await new Promise((x) => setTimeout(x, ss * 1000));
  const s = window.__viewer.scene;
  let st = null;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const cand = s.postProcessStages.get(i);
    if (String(cand.name).startsWith('kupol-blast')) st = cand;
  }
  if (!st) return { error: 'no stage' };
  const u = st.uniforms;
  const v4 = (n) => u[n] ? [+u[n].x.toFixed(2), +u[n].y.toFixed(2), +u[n].z.toFixed(2), +u[n].w.toFixed(4)] : null;
  const v3 = (n) => u[n] ? [+u[n].x.toFixed(2), +u[n].y.toFixed(2), +u[n].z.toFixed(2)] : null;
  return {
    wall: +((performance.now() - t0) / 1000).toFixed(1),
    age: u.u_age, steps: u.u_steps, boundR: u.u_boundR, exposure: u.u_exposure, sunI: u.u_sunI,
    life: u.u_life, flash: u.u_flash, seed: u.u_seed, churn: u.u_churn, windH: u.u_windH,
    head: v4('u_head'), headShape: v4('u_headShape'), headDetail: v4('u_headDetail'),
    headHeat: v4('u_headHeat'), headColA: v4('u_headColA'), headColB: v4('u_headColB'), lobes: u.u_lobes,
    stem: v4('u_stem'), stemShape: v4('u_stemShape'), stemCol: v4('u_stemCol'),
    stemWobble: u.u_stemWobble, stemTwist: u.u_stemTwist, stemTopFlare: u.u_stemTopFlare,
    fb: v4('u_fb'), fbLook: v4('u_fbLook'), fbShape: v4('u_fbShape'), fbTint: v4('u_fbTint'), fbCut: u.u_fbCut,
    skirt: v4('u_skirt'), skirtCol: v4('u_skirtCol'), skirtFront: u.u_skirtFront,
    wind: v3('u_wind'), groundCol: v3('u_groundCol'), shock: v4('u_shock'),
  };
}, bomb, secs);
console.log(JSON.stringify(dump, null, 1));
console.log('page errors:', JSON.stringify(errs.slice(-4)));
await browser.close(); vite.kill('SIGTERM');
