import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

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
 
async function captureGlobe(page) {
  const rect = await page.$eval('#kupol-globe canvas', (canvas) => {
    const box = canvas.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  if (rect.width < 100 || rect.height < 100) throw new Error(`Cesium canvas is too small: ${JSON.stringify(rect)}`);
  return page.screenshot({
    clip: {
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    },
  });
}

async function changedPixelCount(before, after) {
  const options = { width: 320, height: 240, fit: 'fill' };
  const a = await sharp(before).resize(options).removeAlpha().raw().toBuffer();
  const b = await sharp(after).resize(options).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) changed += 1;
  }
  return changed;
}

async function assertMobileLayout(page, width, height) {
  await page.setViewport({ width, height });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const report = await page.evaluate(() => {
    const selectors = ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-zoom', '.k-nrange-trigger'];
    const elements = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const visible = elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      outside: visible.map((element) => {
        const r = element.getBoundingClientRect();
        return { selector: element.className?.baseVal ?? element.className ?? element.tagName, left: r.left, right: r.right };
      }).filter((r) => r.left < -1 || r.right > innerWidth + 1),
    };
  });
  assert(report.documentWidth <= width + 1, `no page-wide horizontal overflow at ${width}x${height}`);
  assert(report.outside.length === 0, `visible HUD elements stay inside ${width}x${height}: ${JSON.stringify(report.outside)}`);
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
  await page.evaluateOnNewDocument(() => {
    const NativeAudio = window.Audio;
    Object.defineProperty(window, '__KUPOL_AUDIO_EVENTS__', { value: [], configurable: true });
    function TrackedAudio(source) {
      const audio = new NativeAudio(source);
      const nativePlay = audio.play.bind(audio);
      audio.play = (...args) => {
        const event = { src: audio.src, fulfilled: false, error: null };
        window.__KUPOL_AUDIO_EVENTS__.push(event);
        const result = nativePlay(...args);
        if (result && typeof result.then === 'function') {
          result.then(() => { event.fulfilled = true; }, (error) => { event.error = String(error?.message || error); });
        } else {
          event.fulfilled = true;
        }
        return result;
      };
      return audio;
    }
    TrackedAudio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(TrackedAudio, NativeAudio);
    window.Audio = TrackedAudio;
  });
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

  // Стартовый оверлей перекрывает интерфейс — сначала выбираем державу.
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 30000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 30000 });
  assert(true, 'starting a party clears the overlay and keeps the range tab mounted');

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
  await page.waitForFunction(() => {
    const probe = window.__KUPOL_QA__?.snapshot();
    return probe?.target?.name === 'Hanoi' && probe?.camera?.aimDot > 0.97
      && probe?.camera?.height > 0 && probe.camera.height < 1_000_000;
  }, { timeout: 20000 });
  const cameraProbe = await page.evaluate(() => window.__KUPOL_QA__.snapshot());
  assert(cameraProbe.camera.aimDot > 0.97, `Cesium camera actually aims at Hanoi (dot=${cameraProbe.camera.aimDot.toFixed(4)})`);
  assert(cameraProbe.camera.height > 0 && cameraProbe.camera.height < 1_000_000, 'camera reached city-scale altitude rather than remaining at the global start view');
  const beforeBlast = await captureGlobe(page);

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 45000 });
  const status = await page.$eval('[data-status]', (element) => element.textContent);
  assert(/Снесено застройки: [1-9]/.test(status), 'strike reports the levelled built-up area');
  assert(/строений в сцене: [1-9]/.test(status), 'strike renders the city-damage proxy set');
  assert(/полное разрушение/.test(status), 'status reports real per-zone overpressure distances');
  await page.waitForFunction(() => {
    const probe = window.__KUPOL_QA__?.snapshot();
    return probe?.lastTestResult?.ok === true && probe.damageEntities > 0 && probe.nuclearLive === true;
  }, { timeout: 15000 });
  const liveProbe = await page.evaluate(() => window.__KUPOL_QA__.snapshot());
  assert(liveProbe.damageEntities > 0, `Cesium damage data source contains ${liveProbe.damageEntities} generated entities`);
  assert(liveProbe.nuclearLive === true, 'volumetric nuclear effect is live in the Cesium scene');
  await new Promise((resolve) => setTimeout(resolve, 2300));
  const afterBlast = await captureGlobe(page);
  const changedPixels = await changedPixelCount(beforeBlast, afterBlast);
  assert(changedPixels >= 80, `rendered globe pixels changed during the nuclear effect (${changedPixels} changed samples)`);
  await page.waitForFunction(() => {
    const events = window.__KUPOL_AUDIO_EVENTS__ || [];
    return events.some((event) => event.src.endsWith('/trinity-front.ogg') && event.fulfilled)
      && events.some((event) => event.src.endsWith('/trinity-tail.ogg') && event.fulfilled);
  }, { timeout: 15000 });
  // Media requests may be served as 206 Partial Content when the browser uses
  // byte ranges. Both 200 and 206 are successful HTTP responses for this asset.
  assert([...audioResponses].some((item) => /^trinity-front\.ogg:(200|206)$/.test(item)), 'front sound sample is requested successfully (HTTP 200 or 206)');
  assert([...audioResponses].some((item) => /^trinity-tail\.ogg:(200|206)$/.test(item)), 'delayed tail sound sample is requested successfully (HTTP 200 or 206)');
  assert(await page.evaluate(() => (window.__KUPOL_AUDIO_EVENTS__ || []).some((event) => event.src.endsWith('/trinity-front.ogg') && event.fulfilled)), 'front audio playback promise resolves');
  assert(await page.evaluate(() => (window.__KUPOL_AUDIO_EVENTS__ || []).some((event) => event.src.endsWith('/trinity-tail.ogg') && event.fulfilled)), 'tail audio playback promise resolves');

  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/nuclear-range-smoke.png', fullPage: true });

  await page.click('[data-reset]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('очищены'));
  assert(true, 'reset action completes and reports cleared effects');
  await page.click('.k-nrange-close');

  await assertMobileLayout(page, 390, 844);
  await assertMobileLayout(page, 360, 740);
  await assertMobileLayout(page, 768, 1024);

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
