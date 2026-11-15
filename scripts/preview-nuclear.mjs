import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.NUCLEAR_PREVIEW_PORT || 4190);
const base = `http://127.0.0.1:${port}`;
// Keep Chrome's profile and screenshots OUTSIDE the served repo root: Vite's
// file watcher trips EBUSY on Chrome's locked Cookies file and kills the server.
const work = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const outDir = `${work}/preview`;
const chromeProfile = `${work}/chrome-profile`;
rmSync(chromeProfile, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(chromeProfile, { recursive: true });

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  let lastErr = 'no attempt';
  for (let i = 0; i < 160; i += 1) {
    try {
      const h = await fetch(`${base}/api/health`);
      if (h.ok) {
        const gamePage = await fetch(`${base}/kupol`);
        if (gamePage.ok) return;
        lastErr = `kupol ${gamePage.status}`;
      } else lastErr = `health ${h.status}`;
    } catch (e) { lastErr = e.message; }
    await sleep(500);
  }
  throw new Error(`server did not become ready. lastErr=${lastErr}; ${serverOutput}`);
}

async function pickCity(page, needle) {
  const input = await page.$('#k-nrange-city-query');
  await input.click({ clickCount: 3 });
  await input.evaluate((el) => { el.value = ''; });
  await page.type('#k-nrange-city-query', needle);
  await page.waitForFunction(() => {
    const s = document.querySelector('#k-nrange-city-results');
    return s && s.options.length > 0;
  }, { timeout: 20000 });
  const val = await page.$eval('#k-nrange-city-results', (select, n) => {
    const opt = [...select.options].find((o) => o.textContent.toLowerCase().startsWith(n.toLowerCase()));
    return opt?.value ?? select.options[0]?.value ?? null;
  }, needle);
  await page.select('#k-nrange-city-results', val);
  await page.waitForFunction((n) => document.querySelector('[data-status]')?.textContent.toLowerCase().includes(n.toLowerCase()), needle, { timeout: 20000 });
  await sleep(3200); // let the camera fly-to settle
}

async function shoot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  console.log(`SHOT ${path}`);
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: chromeProfile,
    args: [
      '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const failed = [];
  const consoleErrors = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`CONSOLE ${m.text()}`); });
  await page.goto(`${base}/kupol`, { waitUntil: 'networkidle2', timeout: 90000 }).catch((e) => console.log('goto note:', e.message));
  // Dismiss the КУПОЛ start overlay by choosing a faction, which begins the match
  // and mounts the in-game nuclear test-range trigger.
  try {
    await page.waitForSelector('.k-start .k-nations button', { timeout: 30000 });
    await page.click('.k-start .k-nations button');
    console.log('start overlay: faction chosen, match begun');
    await sleep(1500);
  } catch (e) { console.log('no start overlay (already in game?):', e.message); }
  try {
    await page.waitForSelector('.k-nrange-trigger', { timeout: 90000 });
  } catch (e) {
    await shoot(page, '_debug_no_trigger');
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      hasKupol: !!document.querySelector('#kupol-root'),
      bodyHead: document.body?.innerText?.slice(0, 800),
    }));
    console.log('NO TRIGGER. info=', JSON.stringify(info), '\nerrors=', JSON.stringify(consoleErrors.slice(-15)));
    throw e;
  }
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  console.log('nuclear range panel open');

  const scenarios = [
    { city: 'London', bomb: 'little-boy', tag: 'london_littleboy' },
    { city: 'London', bomb: 'castle-bravo', tag: 'london_castlebravo' },
    { city: 'London', bomb: 'tsar', tag: 'london_tsar' },
  ];

  for (const s of scenarios) {
    await page.select('#k-nrange-bomb', s.bomb);
    await sleep(300);
    await pickCity(page, s.city);
    await page.click('[data-test]');
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 60000 });
    const status = await page.$eval('[data-status]', (e) => e.textContent);
    console.log(`\n[${s.bomb}] ${status}\n`);
    await shoot(page, `${s.tag}_t2`);   // ~early, mushroom rising
    await sleep(3500);
    await shoot(page, `${s.tag}_t6`);   // mid, buildings collapsing
    await page.click('[data-reset]');
    await sleep(1200);
  }

  console.log(`\ntiles/network failed requests: ${failed.length} (0 = imagery loaded; many = offline globe)`);
  console.log('PREVIEW DONE');
} catch (error) {
  console.error('PREVIEW FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
