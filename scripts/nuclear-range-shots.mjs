import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.NUCLEAR_BROWSER_PORT || 4188);
const base = `http://127.0.0.1:${port}`;
const work = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const outDir = `${work}/shots`;
const chromeProfile = `${work}/chrome-game`;
rmSync(chromeProfile, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(chromeProfile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error(`server did not start: ${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  console.log('server up');
  browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 900000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    userDataDir: chromeProfile,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 60000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 30000 });
  console.log('polygon open');

  const scenarios = [
    { bomb: 'little-boy', city: 'London', tag: 'game_london_littleboy' },
    { bomb: 'castle-bravo', city: 'London', tag: 'game_london_castlebravo' },
    { bomb: 'tsar', city: 'London', tag: 'game_london_tsar' },
    { bomb: 'tsar', city: 'New York', tag: 'game_newyork_tsar' },
  ];

  for (const s of scenarios) {
    await page.select('#k-nrange-bomb', s.bomb);
    await page.click('#k-nrange-city-query');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#k-nrange-city-query', s.city, { delay: 30 });
    await page.waitForFunction((name) => {
      const select = document.querySelector('#k-nrange-city-results');
      return select && [...select.options].some((o) => o.textContent.startsWith(`${name} ·`));
    }, { timeout: 20000 }, s.city);
    const value = await page.$eval('#k-nrange-city-results', (select, name) => {
      const option = [...select.options].find((o) => o.textContent.startsWith(`${name} ·`));
      return option.value;
    }, s.city);
    await page.select('#k-nrange-city-results', value);
    await page.waitForFunction((name) => document.querySelector('[data-status]')?.textContent.includes(`Выбран город: ${name}`), { timeout: 20000 }, s.city);
    await sleep(4000); // let the camera flight land and tiles arrive

    await page.click('[data-test]');
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 60000 });
    const status = await page.$eval('[data-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    console.log(`[${s.tag}] ${status}`);
    await sleep(2000);
    await page.screenshot({ path: `${outDir}/${s.tag}_t2.png` });
    await sleep(6000);
    await page.screenshot({ path: `${outDir}/${s.tag}_t8.png` });

    await page.click('[data-reset]');
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('очищены'), { timeout: 30000 });
    console.log(`  SHOTS ${s.tag}_t2.png ${s.tag}_t8.png`);
  }

  console.log(`page errors: ${errs.length ? JSON.stringify(errs.slice(-6)) : 'none'}`);
  console.log('GAME NUCLEAR SHOTS DONE');
} catch (error) {
  console.error('GAME SHOTS FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
