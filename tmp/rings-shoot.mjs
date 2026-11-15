// Съёмка колец конденсации и ледяных шапок В НАТУРАЛЬНЫЙ МОМЕНТ.
// age-sweep.mjs подменяет performance.now() и «прыгает» по возрастам — на
// 15 Мт это ловит только конец показа (замер: u_age мёртво на 39.04, rate
// измерился нулём, и setAge на 4 и 20 выдал «назад не ходим»). Здесь часов
// не трогаем: ждём, пока u_age сам пройдёт нужный масштабный возраст, и
// снимаем ровно в этот кадр.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4245);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOMB = process.env.BOMB || 'castle-bravo';
const CITY = process.env.CITY || 'London';
// Масштабные секунды, в которых чистая blastShapeAt даёт nonzero кольца/шапки.
const TARGETS = (process.env.TARGETS || '18,26,70').split(',').map(Number);

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', () => {});

const PPDIR = process.env.PPDIR || `D:/mt5/tmp-nuclear/pprofile-rings-${process.pid}`;
const browser = await puppeteer.launch({
  userDataDir: PPDIR, headless: 'new', protocolTimeout: 1200000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) break; } catch {}
    await sleep(500);
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 140)); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  console.log('шаг: открываю полигон');
  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  console.log('шаг: выбираю заряд', BOMB);
  await page.select('#k-nrange-bomb', BOMB);
  await page.click('#k-nrange-city-query');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#k-nrange-city-query', CITY, { delay: 30 });
  await page.waitForFunction((c) => {
    const sel = document.querySelector('#k-nrange-city-results');
    return sel && [...sel.options].some((o) => o.textContent.startsWith(`${c} ·`));
  }, { timeout: 60000, polling: 300 }, CITY);
  const value = await page.$eval('#k-nrange-city-results', (sel, c) => (
    [...sel.options].find((o) => o.textContent.startsWith(`${c} ·`)).value), CITY);
  await page.select('#k-nrange-city-results', value);
  await sleep(6000);
  console.log('шаг: город выбран, жму пуск');

  const hideUi = () => page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint',
      '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin', '.k-nrange-panel', '.k-nrange-trigger', '.k-help']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
  });

  const state = () => page.evaluate(() => {
    const b = window.__blast;
    if (!b) return null;
    const u = b.uniforms;
    const r3 = (v) => Math.round(Number(v) * 10) / 10;
    return {
      age: r3(u.u_age), ring0: [u.u_ring0.x, u.u_ring0.y, u.u_ring0.z, u.u_ring0.w].map(r3),
      ring1: [u.u_ring1.x, u.u_ring1.y, u.u_ring1.z, u.u_ring1.w].map(r3),
      ice: [r3(u.u_ice.x), r3(u.u_ice.y), r3(u.u_ice.z), r3(u.u_ice.w)],
      dome: [r3(u.u_dome.x), r3(u.u_dome.y), r3(u.u_dome.z), r3(u.u_dome.w)],
      enabled: !!b.enabled, stepScale: r3(u.u_stepScale), texScale: r3(b._textureScale),
    };
  });

  // Кнопку пуска жмём через evaluate: page.click требует «clickable», а панель
  // к этому моменту уже скрыта вместе со всем HUD (кадр должен быть чистым),
  // и Chrome отказывает по невидимости, хотя обработчик на месте.
  const launched = await page.evaluate(() => {
    const b = document.querySelector('[data-test]');
    if (!b) return 'нет кнопки [data-test]';
    b.click();
    return b.textContent.trim().slice(0, 40);
  });
  console.log('пуск:', launched);
  await page.waitForFunction(() => !!window.__blast, { timeout: 420000, polling: 400 });
  await hideUi();
  console.log('blast live, bomb =', BOMB, '| первые часы:', JSON.stringify(await state()));

  for (const target of TARGETS) {
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 420000) {
      st = await state();
      if (!st) { console.log(`мишень ${target}: проход исчез (взрыв закончился)`); break; }
      if (st.age >= target) break;
      await sleep(400);
    }
    if (st && st.age >= target) {
      const name = `nat_${BOMB}_s${target}`;
      writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
      console.log(name, `${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(st));
    } else {
      console.log(`мишень ${target}: не дождались | ${JSON.stringify(st)}`);
    }
  }
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 200));
} finally {
  console.log('errors', JSON.stringify(errs.slice(0, 6)));
  await browser.close();
  server.kill('SIGTERM');
}
