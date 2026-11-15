// Замер скорости игры. Первая версия меряла «база → рычаг → рычаг → рычаг» и
// оказалась непригодной: стоимость кадра ползла вверх от прогона к прогону
// (12,9 → 633 → 1237 мс CPU на кадр) при выключенных рычагах, т.е. счёт
// снимал накопленный кэш тайлов и давление памяти, а не настройку. Поэтому
// схема стала парной: для каждого рычага база, рычаг и снова база-контроль в
// одной и той же остывшей сцене. Если контроль ушёл от первой базы сильнее,
// чем сам рычаг, — рычаг неразличим на этом железе и в отчёт не попадает.
//
// Растеризатор здесь — SwiftShader (процессор): из headless-браузера MX130 не
// виден, см. scripts/gpu-probe.mjs. Абсолютные FPS не те, что видит игрок.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const outDir = process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear';
const base = process.env.FPS_BASE || `http://127.0.0.1:${Number(process.env.FPS_PORT || 4205)}`;
const port = new URL(base).port || '80';
const WINDOW_MS = Number(process.env.FPS_WINDOW || 6000);
const HEIGHT = Number(process.env.FPS_HEIGHT || 1.2e6);
let serverOutput = '';
let server = null;
const alreadyUp = await fetch(`${base}/kupol`).then((r) => r.ok).catch(() => false);
if (!alreadyUp) {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: port, HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => { serverOutput += c.toString(); });
  server.stderr.on('data', (c) => { serverOutput += c.toString(); });
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${base}/kupol`)).ok) return;
    } catch { /* сервер ещё стартует */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`превью не поднялось: ${serverOutput.slice(0, 400)}`);
}

// Рычаги живут в странице. Обратный ход берётся из значения, снятого при
// установке, а не из догадки о дефолте: предположить дефолт — значит оставить
// в следующем прогоне чужую настройку.
const installLevers = (page) => page.evaluate(() => {
  const v = window.__kupol.viewer;
  const s = v.scene;
  const home = {
    msaa: s.msaaSamples,
    atmo: s.skyAtmosphere.show,
    sse: s.globe.maximumScreenSpaceError,
    res: v.resolutionScale,
    fog: s.fog.enabled,
    ground: s.globe.showGroundAtmosphere,
    cache: s.globe.tileCacheSize,
  };
  window.__fps = {
    on: [],
    home,
    // Что реально стоит в сцене после переключения: запись в переменную ещё не
    // доказательство, что дёрнулся рычаг.
    dump() {
      const node = document.querySelector('.k-zoom button') || document.querySelector('.glass') || document.body;
      return {
        msaa: s.msaaSamples, atmo: s.skyAtmosphere.show, sse: s.globe.maximumScreenSpaceError,
        res: v.resolutionScale, fog: s.fog.enabled, ground: s.globe.showGroundAtmosphere,
        cache: s.globe.tileCacheSize, tfr: v.targetFrameRate,
        blur: getComputedStyle(node).backdropFilter,
      };
    },
    // Состав сцены: по нему видно накопление между прогонами. Беру только то,
    // что в API Cesium точно есть, иначе лог показал бы null вместо числа.
    mix() {
      return {
        prims: s.primitives.length,
        ents: v.entities.values.length,
        stages: (s.postProcessStages.stages || []).length,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    },
    levers: {
      msaa1: [() => { s.msaaSamples = 1; }, () => { s.msaaSamples = home.msaa; }],
      noatmo: [() => { s.skyAtmosphere.show = false; }, () => { s.skyAtmosphere.show = home.atmo; }],
      sse3: [() => { s.globe.maximumScreenSpaceError = 3; }, () => { s.globe.maximumScreenSpaceError = home.sse; }],
      sse4: [() => { s.globe.maximumScreenSpaceError = 4; }, () => { s.globe.maximumScreenSpaceError = home.sse; }],
      res075: [() => { v.resolutionScale = 0.75; }, () => { v.resolutionScale = home.res; }],
      res060: [() => { v.resolutionScale = 0.6; }, () => { v.resolutionScale = home.res; }],
      noblur: [() => {
        const style = document.createElement('style');
        style.id = 'fps-noblur';
        style.textContent = '.glass,.k-zoom button{backdrop-filter:none!important}';
        document.documentElement.appendChild(style);
      }, () => { document.getElementById('fps-noblur')?.remove(); }],
      nofog: [() => { s.fog.enabled = false; s.globe.showGroundAtmosphere = false; },
        () => { s.fog.enabled = home.fog; s.globe.showGroundAtmosphere = home.ground; }],
      cache200: [() => { s.globe.tileCacheSize = 200; }, () => { s.globe.tileCacheSize = home.cache; }],
      tfr30: [() => { v.targetFrameRate = 30; }, () => { v.targetFrameRate = home.tfr; }],
    },
    set(ids) {
      const want = new Set(ids);
      for (const id of this.on) if (!want.has(id)) this.levers[id][1]();
      this.on = this.on.filter((id) => want.has(id));
      for (const id of ids) if (!this.on.includes(id)) { this.levers[id][0](); this.on.push(id); }
      return this.on.slice();
    },
  };
  return Object.keys(window.__fps.levers);
});

const LABELS = {
  msaa1: 'MSAA 4 → 1',
  noatmo: 'атмосфера неба выкл',
  sse3: 'screenSpaceError → 3',
  sse4: 'screenSpaceError → 4',
  res075: 'resolutionScale → 0.75',
  res060: 'resolutionScale → 0.6',
  noblur: 'blur панелей HUD выкл',
  nofog: 'туман и дымка выкл',
  cache200: 'тайл-кэш → 200',
  tfr30: 'targetFrameRate → 30',
};

// Окно измерения: cadence requestAnimationFrame (что видит игрок) плюс сколько
// раз Cesium реально нарисовал кадр и сколько процессора ушло на рисование.
const measure = (page, ms = WINDOW_MS) => page.evaluate(async (windowMs) => {
  const scene = window.__kupol.viewer.scene;
  let renders = 0;
  let cpu = 0;
  let openedAt = 0;
  const onPre = () => { openedAt = performance.now(); };
  const onPost = () => { renders += 1; cpu += performance.now() - openedAt; };
  scene.preRender.addEventListener(onPre);
  scene.postRender.addEventListener(onPost);
  const frames = [];
  const start = performance.now();
  let last = start;
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (now - start >= windowMs) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  scene.preRender.removeEventListener(onPre);
  scene.postRender.removeEventListener(onPost);
  frames.shift();
  const sorted = frames.slice().sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return {
    fps: Math.round((1000 / mean) * 10) / 10,
    p50ms: Math.round(pct(0.5) * 10) / 10,
    p95ms: Math.round(pct(0.95) * 10) / 10,
    renders,
    cpuMs: Math.round((cpu / Math.max(1, renders)) * 10) / 10,
  };
}, ms);

// Одна и та же точка обзора на весь прогон: смена высоты сама по себе стоит
// дороже любого рычага, поэтому её в замере быть не должно.
const settle = (page, ms) => page.evaluate(async (h, waitMs) => {
  const v = window.__kupol.viewer;
  const c = v.camera.positionCartographic;
  v.camera.setView({ destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h) });
  const until = performance.now() + waitMs;
  // Ждём, пока глобус доедет тайлы: иначе первый прогон меряет загрузку.
  while (performance.now() < until) {
    if (v.scene.globe.tilesLoaded) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { tilesLoaded: v.scene.globe.tilesLoaded };
}, HEIGHT, ms ?? 45000);

const pct = (a, b) => `${((b.fps / a.fps - 1) * 100 >= 0 ? '+' : '')}${((b.fps / a.fps - 1) * 100).toFixed(0)}%`;
const line = (label, m) => `${String(label).padEnd(26)} fps ${String(m.fps).padStart(5)} · p50 ${String(m.p50ms).padStart(7)} мс · p95 ${String(m.p95ms).padStart(7)} мс · кадров ${String(m.renders).padStart(4)} · CPU/кадр ${String(m.cpuMs).padStart(7)} мс`;

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `${outDir}/chrome-fps`,
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 60000 });
  const ids = await installLevers(page);
  console.log(`растеризатор: ${await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'нет webgl2';
  })}`);
  console.log(`окно ${WINDOW_MS} мс на прогон, вьюпорт 1440x900, высота камеры ${HEIGHT / 1000} км`);
  console.log(`дом по умолчанию: ${JSON.stringify(await page.evaluate(() => window.__fps.home))}`);

  console.log('\n== остываю ==');
  console.log(`тайлы: ${JSON.stringify(await settle(page))}`);
  console.log(`состав сцены: ${JSON.stringify(await page.evaluate(() => window.__fps.mix()))}`);

  const base0 = await measure(page);
  console.log(line('база', base0));

  console.log('\n== парные прогоны: база → рычаг → база-контроль ==');
  const verdict = [];
  for (const id of ids) {
    const read = await page.evaluate((list) => {
      window.__fps.set(list);
      return window.__fps.dump();
    }, [id]);
    const m = await measure(page);
    await page.evaluate(() => window.__fps.set([]));
    const control = await measure(page);
    const drift = Math.abs(control.fps / base0.fps - 1);
    const effect = Math.abs(m.fps / base0.fps - 1);
    verdict.push({ id, effect, drift, trustworthy: effect > 2 * drift, p50: [base0.p50ms, m.p50ms, control.p50ms] });
    console.log(line(LABELS[id], m));
    console.log(line('  ↳ база-контроль', control));
    console.log(`  → ${LABELS[id]}: кадр ${pct(base0, m)}, контроль ${pct(base0, control)} (${drift * 100 > 1 ? ' дрейф' : ' дрейф '}${(drift * 100).toFixed(0)}%) · сдвинулся ли: ${JSON.stringify(read)}${effect > 2 * drift ? '' : ' · РАЗЛИЧИТЬ НЕЛЬЗЯ'}`);
    console.log(`  состав сцены: ${JSON.stringify(await page.evaluate(() => window.__fps.mix()))}`);
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log('\n== итог по надёжным рычагам ==');
  const good = verdict.filter((v) => v.trustworthy && v.effect > 0.03);
  for (const v of good.sort((a, b) => b.effect - a.effect)) {
    console.log(`${LABELS[v.id]}: ${v.p50[0]} → ${v.p50[1]} мс на кадр (контроль ${v.p50[2]} мс)`);
  }
  if (!good.length) console.log('ни один рычаг не отделился от дрейфа замерщика');
  console.log(`неразличимы: ${verdict.filter((v) => !v.trustworthy).map((v) => LABELS[v.id]).join(', ') || 'нет'}`);
} catch (error) {
  console.error(`FPS FAIL: ${error.stack || error}`);
  if (serverOutput) console.error(serverOutput.slice(0, 800));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
