// v10: тот же London + Little Boy, но с двумя поправками к самому стенду.
// 1) Дешёвый буфер (640x360 @0.5): прошлый кадр после запуска рендерился ~8 минут,
//    и окно показа гриба (150 с) закрывалось до первого кадра.
// 2) Разогнанные часы страницы (K=0.25): ageReal и life считаются от
//    performance.now, поэтому 1 реальных секунд = 0.25 «игровых» — окно показа
//    растягивается на 600 с и в него попадает много отрисованных кадров.
//    Физика и uniforms не меняются: меняется только скорость настенных часов.
// 3) Сэмплер живёт в rAF страницы и пишет каждый ОТРИСОВАННЫЙ кадр: видно и
//    сколько кадров реально было, и что в них лежало в u_sunI/u_exposure.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4211);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);

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

const SAMPLER = (K) => {
  const real = performance.now.bind(performance);
  const t0 = real();
  performance.now = () => t0 + (real() - t0) * K;
  const viewer = window.__kupol.viewer;
  window.__frames = [];
  window.__tBlast = performance.now();
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
      Math.round(performance.now() - window.__tBlast), n,
      u ? Math.round(u.u_age * 10) / 10 : -1,
      u ? String(u.u_sunI) : '-', u ? String(u.u_exposure) : '-',
      u ? Math.round(u.u_boundR) : -1, u ? u.u_steps : -1,
      blast ? (blast.show ? 1 : 0) : 0, blast ? (blast.enabled ? 1 : 0) : 0,
      Math.round(cam.positionCartographic.height),
    ]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return K;
};

let browser;
try {
  await waitForServer();
  console.log('server up');
  browser = await puppeteer.launch({
    userDataDir: 'D:/mt5/tmp-nuclear/pprofileF',
    headless: 'new',
    protocolTimeout: 900000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 220)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 160)); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 120000 });
  console.log('game ready');
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
    const select = document.querySelector('#k-nrange-city-results');
    return select && [...select.options].some((o) => o.textContent.startsWith('London ·'));
  }, { timeout: 30000 });
  const value = await page.$eval('#k-nrange-city-results', (select) => (
    [...select.options].find((o) => o.textContent.startsWith('London ·')).value
  ));
  await page.select('#k-nrange-city-results', value);
  await page.waitForFunction(() => {
    const s = window.__kupol.viewer.scene;
    return s.globe.tilesLoaded === true || s.globe._surface === undefined;
  }, { timeout: 120000, polling: 1000 }).catch(() => console.log('tiles wait timed out'));
  await sleep(8000);

  await page.evaluate(SAMPLER, 0.25);
  console.log('sampler installed, clock x0.25');

  await page.click('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'),
    { timeout: 300000 });
  const status = await page.$eval('[data-status]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  console.log('status:', status);
  await page.click('[data-close]');

  // u_age — модельные секунды (s = ageReal * rate, rate=4 у «Малыша»).
  // tFull=600, life=150 игровых секунд = 600 реальных.
  const marks = [[60, 'a'], [170, 'b'], [300, 'c'], [440, 'd'], [580, 'e']];
  for (const [age, name] of marks) {
    await page.waitForFunction((t) => {
      const f = window.__frames;
      return f.length && f[f.length - 1][2] >= t;
    }, { timeout: 420000, polling: 500 }, age).catch((e) => console.log(`  mark ${name}: ${String(e.message).slice(0, 60)}`));
    const info = await page.evaluate(() => window.__frames[window.__frames.length - 1]);
    const on = await page.screenshot();
    writeFileSync(`${outDir}/v10_lb_${name}.png`, on);
    let offHash = null;
    if (name === 'c') {
      await page.evaluate(() => {
        const col = window.__kupol.viewer.scene.postProcessStages;
        for (let i = 0; i < col.length; i += 1) {
          const s = col.get(i);
          if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; s.enabled = false; return; }
        }
      });
      await sleep(2500);
      const off = await page.screenshot();
      offHash = md5(off);
      writeFileSync(`${outDir}/v10_lb_${name}_voloff.png`, off);
      await page.evaluate(() => { if (window.__blast) window.__blast.enabled = true; });
    }
    console.log(`v10_lb_${name} age=${age} lastFrame=[el,n,age,sunI,exp,bR,steps,show,en,h]=${JSON.stringify(info)} md5=${md5(on)}${offHash ? ` voloff=${offHash} SAME=${offHash === md5(on)}` : ''}`);
  }

  // Порядок полей кадра: 0 elapsed, 1 col.length, 2 age (-1 без стейджа), 3 sunI,
  // 4 exposure, 5 boundR, 6 steps, 7 show, 8 enabled, 9 camHeight.
  const summary = await page.evaluate(() => {
    const f = window.__frames;
    const ages = f.map((x) => x[2]);
    const bad = f.filter((x) => x[3] === 'NaN' || x[4] === 'NaN' || x[3] === 'undefined' || x[4] === 'undefined').length;
    const withStage = f.filter((x) => x[2] >= 0).length;
    const shown = f.filter((x) => x[2] >= 0 && x[7] === 1 && x[8] === 1).length;
    return {
      frames: f.length, withStage, shown, nanFrames: bad,
      ageMin: Math.min(...ages), ageMax: Math.max(...ages),
      first: f[0], mid: f[Math.floor(f.length / 2)], last: f[f.length - 1],
      distinctSunI: [...new Set(f.map((x) => x[3]))].slice(0, 6),
      distinctExp: [...new Set(f.map((x) => x[4]))].slice(0, 6),
      boundRs: [...new Set(f.map((x) => x[5]))].slice(0, 8),
    };
  });
  console.log('SUMMARY', JSON.stringify(summary, null, 1));
  writeFileSync('D:/mt5/tmp-nuclear/v10-frames.json', JSON.stringify(await page.evaluate(() => window.__frames)));
  console.log(`errors: ${errs.length ? JSON.stringify(errs.slice(-6)) : 'none'}`);
  console.log('V10 DONE');
} catch (error) {
  console.error('V10 FAIL:', error.stack || error);
  if (serverOutput) console.error(serverOutput.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
