// Захват объёмного взрыва в ИГРЕ с ВИРТУАЛЬНЫМ ЧАСЫ.
// u_age = (performance.now() - startedAt) * rate, а rate = 4: за то время,
// пока headless-браузер доживает до стадии, модель уходит на 400+ сек и шляпа
// остаётся за кадром. Поэтому performance.now() обёрнут в управляемые часы:
// возраст ставим руками, кадр ждём по postRender, а не по wall-секундам.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4235);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.env.SHOT_TAG || 'pv4';
const AGES = JSON.parse(process.env.AGES || '[40,120,240,400]');
const DBG_AT = JSON.parse(process.env.DBG_AT || '[240]');

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Стадия найдена — часы ЗАМИРАЮТ в тот же кадр, иначе ageReal убегает в
// позднюю фазу, пока мы измеряем rate.
const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) {
      window.__blast = s;
      if (window.__clk && window.__clk.hold === null) {
        window.__clk.hold = performance.now();
        window.__base = { n: window.__clk.hold, s: s.uniforms.u_age };
      }
      return true;
    }
  }
  return false;
};

const DUMP = () => {
  const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
  const v4 = (u) => [r3(u.x), r3(u.y), r3(u.z), r3(u.w)];
  const v3 = (u) => [r3(u.x), r3(u.y), r3(u.z)];
  const u = window.__blast.uniforms;
  return {
    age: r3(u.u_age), life: r3(u.u_life), steps: u.u_steps, boundR: r3(u.u_boundR),
    exposure: r3(u.u_exposure), dbg: u.u_dbg, flash: r3(u.u_flash),
    head: v4(u.u_head), headShape: v4(u.u_headShape), headDetail: v4(u.u_headDetail),
    headHeat: v4(u.u_headHeat), lobes: r3(u.u_lobes),
    stem: v4(u.u_stem), stemShape: v4(u.u_stemShape), topFlare: r3(u.u_stemTopFlare),
    skirt: v4(u.u_skirt), fb: v4(u.u_fb), fbLook: v4(u.u_fbLook),
    ring0: v4(u.u_ring0), ice: v4(u.u_ice), dome: v4(u.u_dome),
    wind: v3(u.u_wind), windH: r3(u.u_windH), churn: r3(u.u_churn),
    bound: v3(u.u_bound), boundV: r3(u.u_boundR), cam: v3(u.u_cam),
    rayTan: [r3(u.u_rayTan.x), r3(u.u_rayTan.y)], sunI: r3(u.u_sunI),
  };
};

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofilePv',
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
  await sleep(20000); // тайлы и кадр ДО запуска: часы ещё идут вместе со временем

  // Управляемые часы: virtual = real + off, а hold замораживает virtual.
  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    window.__clk = { real, off: 0, hold: null };
    window.__frames = 0;
    performance.now = () => (window.__clk.hold !== null ? window.__clk.hold : real() + window.__clk.off);
    const v = window.__kupol.viewer;
    v.scene.postRender.addEventListener(() => { window.__frames += 1; });
  });
  await page.click('[data-test]');
  await page.waitForFunction(FIND, { timeout: 420000, polling: 400 });

  // rate мерим по двум отсчётам: наклон u_age по нашим часам не зависит от того,
  // в какой момент layers.js поймал startedAt. На время измерения часы отпускаем
  // ровно на два хода — позже возраст всё равно ставим руками.
  await page.evaluate(() => {
    window.__clk.off = window.__clk.hold - window.__clk.real();
    window.__clk.hold = null;
  });
  const m1 = await page.evaluate(() => ({ n: performance.now(), s: window.__blast.uniforms.u_age }));
  await sleep(1500);
  const m2 = await page.evaluate(() => ({ n: performance.now(), s: window.__blast.uniforms.u_age }));
  const rate = (m2.s - m1.s) / ((m2.n - m1.n) / 1000);
  console.log('rate измерен', rate.toFixed(3), '| u_age', m2.s.toFixed(1), '| возраст при находке',
    (await page.evaluate(() => window.__base.s)).toFixed(1));

  await page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint',
      '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin', '.k-nrange-panel', '.k-nrange-trigger']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
    window.__kupol.viewer.resolutionScale = 0.75;
  });

  const shoot = async (a, dbgSuffix = '') => {
    if (a < m2.s) { console.log(`ПРОПУСК a=${a}: часы уже на ${m2.s.toFixed(1)}, назад не отмотать`); return; }
    // Замораживаем часы на возрасте a: ageReal = a / rate.
    await page.evaluate(({ r, target, baseN, baseS }) => {
      window.__clk.hold = baseN + ((target - baseS) / r) * 1000;
    }, { r: rate, target: a, baseN: m2.n, baseS: m2.s });
    const held = await page.evaluate(() => window.__clk.hold);
    await page.waitForFunction(({ n }) => {
      const u = window.__blast && window.__blast.uniforms;
      return !!u && Math.abs(u.u_age - n) < 1.0;
    }, { timeout: 60000, polling: 200 }, { n: a });
    const f0 = await page.evaluate(() => window.__frames);
    await page.waitForFunction((f) => window.__frames >= f + 4, { timeout: 120000, polling: 250 }, f0);
    const name = `${TAG}_a${a}${dbgSuffix}`;
    writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
    const d = await page.evaluate(DUMP);
    console.log(name, 'hold=', Math.round(held), JSON.stringify(d));
    // часы снова идут, но сдвигаются так, чтобы время не шло назад
    await page.evaluate((h) => { window.__clk.off = h - window.__clk.real(); window.__clk.hold = null; }, held);
  };

  for (const a of AGES) {
    await shoot(a);
    if (DBG_AT.includes(a)) {
      for (const d of [1, 2, 3, 4]) {
        await page.evaluate((dbg) => { window.__blast.uniforms.u_dbg = dbg; }, d);
        const f0 = await page.evaluate(() => window.__frames);
        await page.waitForFunction((f) => window.__frames >= f + 3, { timeout: 120000, polling: 250 }, f0);
        await shoot(a, `_dbg${d}`);
      }
      await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
    }
  }
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('PV DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
