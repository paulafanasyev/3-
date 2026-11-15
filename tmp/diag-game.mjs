// Диагностика объёмного прохода в ИГРЕ, привязанная к ВОЗРАСТУ МОДЕЛИ.
// u_age идёт в 8 раз быстрее wall-времени (rate = tFull/150), поэтому кадры
// снимаем сразу по появлению стадии, а не после долгого расчёта разрушений.
// Для каждого возраста: обычный кадр + отладочные каналы (alpha, tau, T).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4234);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.env.SHOT_TAG || 'dg';
const AGES = JSON.parse(process.env.AGES || '[60,150,260,400]');
const DBG_AT = JSON.parse(process.env.DBG_AT || '[150]');

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
  }
  return false;
};

const DUMP = () => {
  const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
  const v4 = (u) => [r3(u.x), r3(u.y), r3(u.z), r3(u.w)];
  const u = window.__blast.uniforms;
  return {
    name: String(window.__blast.name), age: r3(u.u_age), life: r3(u.u_life),
    steps: u.u_steps, seed: r3(u.u_seed), boundR: r3(u.u_boundR), exposure: r3(u.u_exposure),
    dbg: u.u_dbg, head: v4(u.u_head), headShape: v4(u.u_headShape),
    headDetail: v4(u.u_headDetail), headHeat: v4(u.u_headHeat), lobes: r3(u.u_lobes),
    stem: v4(u.u_stem), stemShape: v4(u.u_stemShape), stemTopFlare: r3(u.u_stemTopFlare),
    stemWobble: r3(u.u_stemWobble), stemCol: v4(u.u_stemCol),
    skirt: v4(u.u_skirt), fb: v4(u.u_fb), fbLook: v4(u.u_fbLook),
    ring0: v4(u.u_ring0), ring1: v4(u.u_ring1), ice: v4(u.u_ice), dome: v4(u.u_dome),
    wind: v4(u.u_wind), windH: r3(u.u_windH), churn: r3(u.u_churn),
    bound: v4(u.u_bound), cam: v4(u.u_cam), rayTan: [r3(u.u_rayTan.x), r3(u.u_rayTan.y)],
    sunI: r3(u.u_sunI), flash: r3(u.u_flash),
  };
};

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofileDg',
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) break;
    } catch { /* стартует */ }
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
  await sleep(18000); // кадр и тайлы до запуска испытания
  await page.click('[data-test]');
  await page.waitForFunction(FIND, { timeout: 300000, polling: 300 });
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint',
      '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin', '.k-nrange-panel', '.k-nrange-trigger']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
    window.__kupol.viewer.resolutionScale = 0.6;
  });

  for (const a of AGES) {
    await page.waitForFunction((v) => {
      const u = window.__blast && window.__blast.uniforms;
      return !!u && (u.u_age >= v || u.u_life < 0.02);
    }, { timeout: 300000, polling: 250 }, a);
    await sleep(1800);
    const name = `${TAG}_a${a}`;
    writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
    console.log(name, JSON.stringify(await page.evaluate(DUMP)));
    for (const d of DBG_AT.includes(a) ? [1, 2, 3] : []) {
      await page.evaluate((dbg) => { window.__blast.uniforms.u_dbg = dbg; }, d);
      await sleep(1200);
      writeFileSync(`${outDir}/${name}_dbg${d}.png`, await page.screenshot());
      console.log(`${name}_dbg${d}`, 'shot');
    }
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
    if (DBG_AT.includes(a)) console.log(`${name}_restored`, JSON.stringify(await page.evaluate(DUMP)));
  }
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('DG DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
