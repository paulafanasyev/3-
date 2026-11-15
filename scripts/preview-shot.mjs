import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.PREVIEW_DEV_PORT || 5199);
const base = `http://127.0.0.1:${port}`;
const work = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const outDir = `${work}/shots`;
const chromeProfile = `${work}/chrome-profile2`;
rmSync(chromeProfile, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(chromeProfile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let viteOut = '';
vite.stdout.on('data', (c) => { viteOut += c.toString(); });
vite.stderr.on('data', (c) => { viteOut += c.toString(); });

async function waitVite() {
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`${base}/preview.html`); if (r.ok) return; } catch { /* up */ }
    await sleep(500);
  }
  throw new Error(`vite dev not ready: ${viteOut}`);
}

let browser;
try {
  await waitVite();
  console.log('vite dev up');
  browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 900000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: chromeProfile,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`); });
  await page.goto(`${base}/preview.html`, { waitUntil: 'networkidle2', timeout: 120000 }).catch((e) => console.log('goto:', e.message));
  await page.waitForFunction('window.ready === true', { timeout: 120000 });
  console.log('preview page ready');

  const scenarios = [
    { bomb: 'little_boy', city: 'London' },
    { bomb: 'castle_bravo', city: 'London' },
    { bomb: 'tsar', city: 'London' },
  ];

  for (const s of scenarios) {
    for (const view of ['wide', 'close']) {
      const tag = `${s.city.toLowerCase()}_${s.bomb}_${view}`;
      const res = await page.evaluate((b, c, v) => window.runTest(b, c, v), s.bomb, s.city, view);
      if (res?.error) { console.log(`[${tag}] ERROR ${res.error}`); continue; }
      const alt = await page.evaluate(() => Math.round(window.__camAlt?.() ?? -1));
      console.log(`[${tag}] fb=${res.fireballKm.toFixed(2)} severe=${res.severeKm.toFixed(2)} heavy=${res.heavyKm.toFixed(2)} `
        + `light=${res.lightKm.toFixed(2)} crater=${res.craterDiameterM} bld=${res.buildingCount} `
        + `frame=${(res.frameRadiusM / 1000).toFixed(1)}km camAlt=${alt}m`);
      await sleep(3500);
      await page.screenshot({ path: `${outDir}/${tag}_mid.png` });
      await sleep(5500);
      await page.screenshot({ path: `${outDir}/${tag}_done.png` });
      const renderErrors = await page.evaluate(() => (window.__renderErrors || []).splice(0, 3));
      if (renderErrors.length) console.log(`  RENDER ERROR ${tag}: ${renderErrors[0].split('\n').slice(0, 4).join(' | ')}`);
      console.log(`  SHOTS ${tag}_mid.png ${tag}_done.png`);
    }
  }

  console.log(`\npage errors: ${errs.length ? JSON.stringify(errs.slice(-8)) : 'none'}`);
  console.log('PREVIEW SHOTS DONE');
} catch (error) {
  console.error('PREVIEW FAIL:', error.stack || error);
  if (viteOut) console.error(viteOut.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
