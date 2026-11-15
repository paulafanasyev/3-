// Честный A/B «молочного завала» в ИГРЕ. Прежний замер был неверен: stage.enabled=false
// НЕ убирает пост-проход из пайплайна (Scene.js: usePostProcess загорается, пока в
// коллекции есть хотя бы один объект), поэтому «off» всё равно гнал шейдер. Здесь
// проход РЕАЛЬНО снимается из коллекции и возвращается, а два базовых кадра подряд
// отделают дрейф сцены (тайлы/LOD) от эффекта пайплайна.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4219);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
const TAG = process.env.SHOT_TAG || 'wash';

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (c) => { log += c.toString(); });
server.stderr.on('data', (c) => { log += c.toString(); });

const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
  }
  return false;
};

let browser;
const errs = [];
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) break;
    } catch { /* стартует */ }
    await sleep(500);
  }
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileWash',
    headless: 'new', protocolTimeout: 900000,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 220)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 160)); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  await page.evaluate(() => {
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live',
      '.k-hint', '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
  });
  await page.evaluate(() => { window.__kupol.viewer.resolutionScale = 0.5; });

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', 'little-boy');
  await page.click('#k-nrange-city-query');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#k-nrange-city-query', 'London', { delay: 30 });
  await page.waitForFunction(() => {
    const sel = document.querySelector('#k-nrange-city-results');
    return sel && [...sel.options].some((o) => o.textContent.startsWith('London ·'));
  }, { timeout: 30000 });
  const value = await page.$eval('#k-nrange-city-results', (sel) => (
    [...sel.options].find((o) => o.textContent.startsWith('London ·')).value));
  await page.select('#k-nrange-city-results', value);
  await sleep(25000);

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');
  await page.waitForFunction(FIND, { timeout: 120000, polling: 500 });
  await page.waitForFunction(() => {
    const u = window.__blast.uniforms;
    return window.__blast.show && u.u_boundR > 0 && u.u_age > 60;
  }, { timeout: 420000, polling: 500 });
  console.log('stage found, cloud live');

  const shot = async (name) => {
    const a = await page.screenshot();
    await sleep(4000);
    const b = await page.screenshot();
    writeFileSync(`${outDir}/${TAG}_${name}.png`, b);
    const same = md5(a) === md5(b);
    console.log(`${TAG}_${name} md5=${md5(b)} stable=${same}`);
    return same;
  };

  const st1 = await shot('base1');
  const st2 = await shot('base2');
  console.log('scene stable between baselines:', st1, st2);

  await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    col.remove(window.__blast);
  });
  await shot('removed');

  await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    col.add(window.__blast);
  });
  await shot('added');

  const meta = await page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    return { count: col.length, age: Math.round(window.__blast.uniforms.u_age),
      boundR: Math.round(window.__blast.uniforms.u_boundR), life: window.__blast.uniforms.u_life };
  });
  console.log('meta', JSON.stringify(meta));
  console.log('errors:', JSON.stringify(errs.slice(0, 6)));
  console.log('WASH DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors:', JSON.stringify(errs.slice(0, 6)));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
