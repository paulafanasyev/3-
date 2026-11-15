// Изоляция «молочного завала»: чем именно меняется весь кадр — нашим шейдером
// или самим пост-процессным проходом Cesium?
//   on       — как в игре
//   identity — stage.enabled=true, stage.show=true, но u_boundR принудительно 0,
//              поэтому main() выходит ранним return и пишет texture(colorTexture)
//              без единой правки
//   off      — stage.enabled=false (прохода нет вообще)
// Если identity == off, а on отличается -> виноват наш шейдер.
// Если identity != off -> виноват конвейер (цветовое пространство/тонмаппинг).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4215);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
const VW = Number(process.env.VW || 640);
const VH = Number(process.env.VH || 360);
const RS = Number(process.env.RES_SCALE || 0.5);
const TAG = process.env.SHOT_TAG || 'ps';

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
    } catch { /* стартует */ }
    await sleep(500);
  }
  throw new Error(`server did not start: ${serverOutput.slice(-800)}`);
}

// Поиск стадии + счётчик кадров одним eval-скриптом.
const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
  }
  return false;
};

let browser;
try {
  await waitForServer();
  console.log(`server up ${VW}x${VH}@${RS}`);
  browser = await puppeteer.launch({
    userDataDir: `D:/mt5/tmp-nuclear/pprofile${TAG}`,
    headless: 'new',
    protocolTimeout: 900000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH });
  const errs = [];
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
  await page.evaluate((rs) => { window.__kupol.viewer.resolutionScale = rs; }, RS);
  console.log('game ready');

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
    const select = document.querySelector('#k-nrange-city-results');
    return select && [...select.options].some((o) => o.textContent.startsWith('London ·'));
  }, { timeout: 30000 });
  const value = await page.$eval('#k-nrange-city-results', (select) => (
    [...select.options].find((o) => o.textContent.startsWith('London ·')).value
  ));
  await page.select('#k-nrange-city-results', value);
  await sleep(25000);

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');
  await page.waitForFunction(FIND, { timeout: 120000, polling: 500 });
  console.log('stage found');

  // Ждём хотя бы одного кадра с реальным облаком на экране.
  await page.waitForFunction(() => {
    const u = window.__blast.uniforms;
    return window.__blast.show && u.u_boundR > 0 && u.u_age > 30;
  }, { timeout: 420000, polling: 500 });
  await sleep(6000);
  const meta = await page.evaluate(() => {
    const u = window.__blast.uniforms;
    return { age: Math.round(u.u_age), boundR: Math.round(u.u_boundR), steps: u.u_steps,
      life: u.u_life, exp: u.u_exposure, sunI: u.u_sunI, flash: u.u_flash,
      show: window.__blast.show, enabled: window.__blast.enabled };
  });
  console.log('meta', JSON.stringify(meta));

  const shot = async (name) => {
    // Два кадра подряд: второй уже прогрет, артефактов подгрузки тайлов нет.
    const a = await page.screenshot();
    await sleep(4000);
    const b = await page.screenshot();
    writeFileSync(`${outDir}/${TAG}_${name}.png`, b);
    console.log(`${TAG}_${name} md5=${md5(b)} firstFrameSame=${md5(a) === md5(b)}`);
  };

  await shot('on');

  // identity: шейдер обязан выйти по u_boundR<=0 и вернуть цвет сцены как есть.
  await page.evaluate(() => {
    const scene = window.__kupol.viewer.scene;
    if (window.__pin) scene.preRender.removeEventListener(window.__pin);
    window.__pin = () => {
      window.__blast.uniforms.u_boundR = 0;
      window.__blast.show = true;
    };
    scene.preRender.addEventListener(window.__pin);
  });
  await shot('identity');

  // off: прохода нет совсем.
  await page.evaluate(() => {
    const scene = window.__kupol.viewer.scene;
    if (window.__pin) { scene.preRender.removeEventListener(window.__pin); window.__pin = null; }
    window.__blast.enabled = false;
  });
  await shot('off');

  // И контрольное возвращение.
  await page.evaluate(() => { window.__blast.enabled = true; });
  await shot('on2');

  console.log('errors:', JSON.stringify(errs.slice(0, 6)));
  console.log('PS TEST DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors:', JSON.stringify(errs.slice(0, 6)));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
