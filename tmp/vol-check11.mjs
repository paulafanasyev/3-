// v11: зрелый гриб без фокуса с часами.
// Уроки v9/v10:
//  • v9 (1280x720@0.7): первый кадр после запуска ~497 реальных секунд — окно
//    показа (life) истекло до него, stage:null во всех probe, все PNG равны.
//  • v10 (320x180, часы x0.25): кадр ~1.4 с, но layers.js:381 гасит объём
//    setTimeout-ом на НАСТЕННЫХ часах, а ageReal считается от performance.now —
//    таймер убил гриб на model age 146 из 600.
//  Значит: дешёвый буфер + НЕ трогать часы (K=1). Окно life=150 реальных секунд
//  вмещает ~50 кадров, и выборка по модельному возрасту становится честной.
// K≠1 включается только для высококачественного кадра — тогда масштабируем и
// setTimeout, чтобы оба часа шли согласованно.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4212);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);

const K = Number(process.env.CLOCK_K || 1);
const VW = Number(process.env.VW || 640);
const VH = Number(process.env.VH || 360);
const RS = Number(process.env.RES_SCALE || 0.5);
const TAG = process.env.SHOT_TAG || 'v11';
const BOMB = process.env.BOMB || 'little-boy';
const PROFILE = process.env.PROFILE || '';
const MARKS = JSON.parse(process.env.MARKS || '[[60,0],[180,0],[330,1],[480,0],[590,0]]');

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

const SAMPLER = (k) => {
  const realNow = performance.now.bind(performance);
  const t0 = realNow();
  if (k !== 1) performance.now = () => t0 + (realNow() - t0) * k;
  const realSetTimeout = window.setTimeout;
  if (k !== 1) window.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms / k, ...rest);
  const viewer = window.__kupol.viewer;
  window.__frames = [];
  const tick = () => {
    const col = viewer.scene.postProcessStages;
    const n = col.length;
    let blast = null;
    for (let i = 0; i < n; i += 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('kupol-blast') === 0) { blast = s; break; }
    }
    const u = blast ? blast.uniforms : null;
    const cam = viewer.camera;
    window.__frames.push([
      Math.round(performance.now() - t0), n,
      u ? Math.round(u.u_age * 10) / 10 : -1,
      u ? String(u.u_sunI) : '-', u ? String(u.u_exposure) : '-',
      u ? Math.round(u.u_boundR) : -1, u ? u.u_steps : -1,
      blast ? (blast.show ? 1 : 0) : 0, blast ? (blast.enabled ? 1 : 0) : 0,
      Math.round(cam.positionCartographic.height),
      u ? Math.round(u.u_head?.w ?? -1) : -1,
      u ? Math.round(u.u_flash * 1000) / 1000 : -1,
    ]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { k, vw: viewer.scene.canvas.width, vh: viewer.scene.canvas.height };
};

let browser;
try {
  await waitForServer();
  console.log(`server up ${VW}x${VH}@${RS} K=${K}`);
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
    // Предпросмотр обязан быть чистым полем: имена панелей взяты из hud.js,
    // а не наугад — иначе снимок зарастает HUD, как в v10.
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live',
      '.k-hint', '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
  });
  console.log('game ready');
  await page.evaluate((rs) => { window.__kupol.viewer.resolutionScale = rs; }, RS);

  await page.click('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 60000 });
  await page.select('#k-nrange-bomb', BOMB);
  if (PROFILE) await page.select('#k-nrange-profile', PROFILE);
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
  // Кадр ставит сам запуск испытания (frameCloud), поэтому ждём только приход
  // тайлов подложки: без них снимок — серая каша, как в v10_lb_a.
  await sleep(20000);

  const setup = await page.evaluate(SAMPLER, K);
  console.log('sampler', JSON.stringify(setup));

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  await page.click('[data-close]');
  console.log('started');

  // 0 — поле A/B: 1 = в этот маркер снять и выключенный проход.
  for (const [age, ab] of MARKS) {
    const name = `age${age}`;
    await page.waitForFunction((t) => {
      const f = window.__frames;
      return f.length && f[f.length - 1][2] >= t;
    }, { timeout: 420000, polling: 400 }, age).catch((e) => console.log(`  ${name}: ${String(e.message).slice(0, 50)}`));
    const info = await page.evaluate(() => window.__frames[window.__frames.length - 1]);
    const on = await page.screenshot();
    writeFileSync(`${outDir}/${TAG}_${name}.png`, on);
    let note = '';
    if (ab) {
      await page.evaluate(() => {
        const col = window.__kupol.viewer.scene.postProcessStages;
        for (let i = 0; i < col.length; i += 1) {
          const s = col.get(i);
          if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; s.enabled = false; return; }
        }
      });
      await sleep(2500);
      const off = await page.screenshot();
      writeFileSync(`${outDir}/${TAG}_${name}_voloff.png`, off);
      await page.evaluate(() => { if (window.__blast) window.__blast.enabled = true; });
      note = ` voloff=${md5(off)} DIFF=${md5(off) !== md5(on)}`;
    }
    console.log(`${TAG}_${name}=[el,n,age,sunI,exp,bR,steps,show,en,h,headW,flash]=${JSON.stringify(info)} md5=${md5(on)}${note}`);
  }

  const summary = await page.evaluate(() => {
    const f = window.__frames;
    const withStage = f.filter((x) => x[2] >= 0);
    const ages = withStage.map((x) => x[2]);
    return {
      frames: f.length,
      withStage: withStage.length,
      shown: withStage.filter((x) => x[7] === 1 && x[8] === 1).length,
      nanFrames: withStage.filter((x) => x[3] === 'NaN' || x[4] === 'NaN' || x[3] === 'undefined').length,
      ageMax: ages.length ? Math.max(...ages) : null,
      realSeconds: f.length ? Math.round((f[f.length - 1][0] - f[0][0]) / 100) / 10 : 0,
      msPerFrame: f.length > 1 ? Math.round((f[f.length - 1][0] - f[0][0]) / (f.length - 1)) : 0,
      headW: withStage.length ? withStage[withStage.length - 1][10] : null,
      sunIs: [...new Set(withStage.map((x) => x[3]))].slice(0, 5),
      exps: [...new Set(withStage.map((x) => x[4]))].slice(0, 5),
      boundRs: [...new Set(withStage.map((x) => x[5]))].slice(-5),
      camH: [...new Set(f.map((x) => x[9]))].slice(-4),
    };
  });
  console.log('SUMMARY', JSON.stringify(summary));
  writeFileSync(`D:/mt5/tmp-nuclear/${TAG}-frames.json`, JSON.stringify(await page.evaluate(() => window.__frames)));
  console.log(`errors: ${errs.length ? JSON.stringify(errs.slice(-4)) : 'none'}`);
  console.log('V11 DONE');
} catch (error) {
  console.error('V11 FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
