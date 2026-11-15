// Кто рисует кружок со «?» в небе и что именно даёт 404. Кадр с этим знаком
// остаётся и при выключенном объёмном проходе, и при выключенных sun/moon,
// значит это не растер, а DOM или неотрендеренная картинка.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4251);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'ignore', 'ignore'],
});

const browser = await puppeteer.launch({
  userDataDir: process.env.PPDIR || `D:/mt5/tmp-nuclear/pprofile-${process.pid}`,
  headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const bad = [];
try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* стартует */ }
    await sleep(500);
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => bad.push(`FAIL ${r.url()} ${r.failure()?.errorText}`));

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await sleep(15000);

  const scan = () => page.evaluate(() => {
    const broken = [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => ({ src: i.currentSrc || i.src, cls: i.className, alt: i.alt }));
    const hit = (x, y) => {
      const e = document.elementFromPoint(x, y);
      const chain = [];
      let n = e;
      for (let k = 0; k < 4 && n; k += 1, n = n.parentElement) {
        const r = n.getBoundingClientRect();
        chain.push({
          tag: n.tagName, id: n.id, cls: String(n.className).slice(0, 60),
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: (n.textContent || '').trim().slice(0, 40),
          bg: getComputedStyle(n).backgroundImage.slice(0, 90),
        });
      }
      return chain;
    };
    // все видимые элементы, чей текст ровно «?» — кандидат на кружок
    const qmarks = [...document.querySelectorAll('*')]
      .filter((n) => (n.textContent || '').trim() === '?' && n.children.length === 0)
      .map((n) => {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        return { tag: n.tagName, id: n.id, cls: String(n.className).slice(0, 60),
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          radius: cs.borderRadius, bg: cs.backgroundImage.slice(0, 90), disp: cs.display, vis: cs.visibility };
      });
    return { broken, qmarks, centre: hit(581, 94), canvasBox: (() => {
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), c.width, c.height];
    })() };
  });
  console.log('СКАН', JSON.stringify(await scan(), null, 1));
  console.log('404', JSON.stringify([...new Set(bad)], null, 1));
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('404', JSON.stringify([...new Set(bad)]));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
