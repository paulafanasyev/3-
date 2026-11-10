import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.NUCLEAR_BROWSER_PORT || 4188);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
let browser;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        const gamePage = await fetch(`${base}/kupol`);
        if (gamePage.ok) return;
      }
    } catch { /* preview server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite preview did not start. ${serverOutput}`);
}

try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const audioResponses = new Set();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`));
  page.on('response', (response) => {
    if (response.url().includes('/audio/nuclear/')) {
      audioResponses.add(`${response.url().split('/').pop()}:${response.status()}`);
    }
  });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForSelector('.k-nrange-trigger', { timeout: 60000 });
  } catch {
    const diagnostic = await page.evaluate(() => ({
      body: document.body?.innerText.slice(0, 2500),
      kupolRoot: document.querySelector('#kupol-root')?.innerHTML.slice(0, 1600) ?? null,
      nuclearNodes: [...document.querySelectorAll('[class*=nrange]')].map((node) => node.className),
    }));
    throw new Error(`Nuclear range button did not appear. diagnostic=${JSON.stringify(diagnostic)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors.slice(-12))} failedRequests=${JSON.stringify(failedRequests.slice(-12))}`);
  }
  assert(true, 'game booted and Nuclear Test Range tab is present');

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])');
  await page.type('#k-nrange-city-query', 'Hanoi');
  await page.waitForFunction(() => {
    const select = document.querySelector('#k-nrange-city-results');
    return select && select.options.length > 0;
  }, { timeout: 15000 });
  const hanoiValue = await page.$eval('#k-nrange-city-results', (select) => {
    const option = [...select.options].find((item) => item.textContent.startsWith('Hanoi ·'));
    return option?.value ?? null;
  });
  assert(hanoiValue !== null, 'offline city catalogue finds Hanoi');
  await page.select('#k-nrange-city-results', hanoiValue);
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Выбран город: Hanoi'));
  assert(true, 'selecting Hanoi updates the selected target and triggers camera navigation');

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 45000 });
  const status = await page.$eval('[data-status]', (element) => element.textContent);
  assert(status.includes('объектов: 190'), 'strike renders the city-damage proxy set');
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert([...audioResponses].some((item) => item.startsWith('trinity-front.ogg:200')), 'front sound sample is requested successfully');
  assert([...audioResponses].some((item) => item.startsWith('trinity-tail.ogg:200')), 'delayed tail sound sample is requested successfully');
  await (await import('node:fs/promises')).mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/nuclear-range-smoke.png', fullPage: false });
  assert(true, 'browser screenshot captured during the active test effects');

  await page.click('[data-reset]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('очищены'));
  assert(true, 'reset action completes and reports cleared effects');

  assert(pageErrors.length === 0, `browser runtime has no uncaught page errors (${pageErrors.length})`);
  console.log('NUCLEAR BROWSER SMOKE PASS');
} catch (error) {
  console.error(`NUCLEAR BROWSER SMOKE FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
