// A/B-диагностика объёмного прохода в ИГРЕ.
// Вопрос один: почему шляпа не рисуется, когда ножка рисуется.
// Проверяем три независимых подозреваемых одним запуском:
//   1) окклюзия по глубине (sceneT из depth-текстуры) — патчем шейдер;
//   2) сфера-ограничитель (u_boundR) — увеличиваем вдвое;
//   3) снос ветром (u_wind) — обнуляем.
// Плюс карта sceneT (u_dbg=5) и каналы альфы/оптических толщин.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4236);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.env.SHOT_TAG || 'ab';
const AGE = Number(process.env.AGE || 400);

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const FIND = () => {
  const col = window.__kupol.viewer.scene.postProcessStages;
  for (let i = 0; i < col.length; i += 1) {
    const s = col.get(i);
    if (s && String(s.name).indexOf('kupol-blast') === 0) {
      window.__blast = s;
      if (window.__clk && window.__clk.hold === null) window.__clk.hold = performance.now();
      return true;
    }
  }
  return false;
};

const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
const DUMP = () => {
  const u = window.__blast.uniforms;
  const v4 = (x) => [r3(x.x), r3(x.y), r3(x.z), r3(x.w)];
  const v3 = (x) => [r3(x.x), r3(x.y), r3(x.z)];
  const cv = window.__kupol.viewer.camera.positionCartographic;
  return {
    age: r3(u.u_age), life: r3(u.u_life), steps: u.u_steps, boundR: r3(u.u_boundR),
    bound: v3(u.u_bound), exposure: r3(u.u_exposure), sunI: r3(u.u_sunI), dbg: u.u_dbg,
    head: v4(u.u_head), headShape: v4(u.u_headShape), headDetail: v4(u.u_headDetail),
    headHeat: v4(u.u_headHeat), stem: v4(u.u_stem), skirt: v4(u.u_skirt),
    fb: v4(u.u_fb), fbLook: v4(u.u_fbLook), wind: v3(u.u_wind), windH: r3(u.u_windH),
    rayTan: [r3(u.u_rayTan.x), r3(u.u_rayTan.y)], cam: v3(u.u_cam),
    camGeo: [r3(cv.height), r3(cv.latitude), r3(cv.longitude)],
    pitchDeg: r3((cv ? window.__kupol.viewer.camera.pitch : 0) * 57.2958),
    rollDeg: r3(window.__kupol.viewer.camera.roll * 57.2958),
    headingDeg: r3(window.__kupol.viewer.camera.heading * 57.2958),
  };
};

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofileAb',
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
  await sleep(20000);

  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    window.__clk = { real, off: 0, hold: null };
    window.__frames = 0;
    performance.now = () => (window.__clk.hold !== null ? window.__clk.hold : real() + window.__clk.off);
    window.__kupol.viewer.scene.postRender.addEventListener(() => { window.__frames += 1; });
  });
  await page.click('[data-test]');
  await page.waitForFunction(FIND, { timeout: 420000, polling: 400 });

  // Панель и HUD прячем ПОСЛЕ запуска: [data-test] живёт внутри панели, и
  // display:none на панели лишает нас самой кнопки.
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint',
      '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin', '.k-nrange-panel', '.k-nrange-trigger']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
    window.__kupol.viewer.resolutionScale = 0.75;
  });

  // age линеен по нашим часам: два УСТОЯВШИХСЯ отсчёта дают rate без гонок
  // с частотой кадров (в прошлый раз наклон мерился по запаздывающему униформу).
  const waitFrames = async (k) => {
    const f0 = await page.evaluate(() => window.__frames);
    // k ОБЯЗАТЕЛЬНО аргументом: тело waitForFunction сериализуется в страницу,
    // замыкания Node там не существует — иначе «k is not defined».
    await page.waitForFunction(({ f, n }) => window.__frames >= f + n,
      { timeout: 240000, polling: 250 }, { f: f0, n: k });
  };
  await page.evaluate(() => { window.__clk.hold = window.__clk.real() + 30000; });
  await waitFrames(3);
  const s1 = await page.evaluate(() => ({ n: window.__clk.hold, s: window.__blast.uniforms.u_age }));
  await page.evaluate(() => { window.__clk.hold += 20000; });
  await waitFrames(3);
  const s2 = await page.evaluate(() => ({ n: window.__clk.hold, s: window.__blast.uniforms.u_age }));
  const rate = (s2.s - s1.s) / ((s2.n - s1.n) / 1000);
  console.log('rate', rate.toFixed(4), '| s1', s1.s.toFixed(2), '| s2', s2.s.toFixed(2));

  const setAge = async (a) => {
    await page.evaluate(({ r, target, baseN, baseS }) => {
      window.__clk.hold = baseN + ((target - baseS) / r) * 1000;
    }, { r: rate, target: a, baseN: s1.n, baseS: s1.s });
    await waitFrames(4);
    const got = await page.evaluate(() => window.__blast.uniforms.u_age);
    if (Math.abs(got - a) > 2) console.log('!! возраст не встал:', got.toFixed(2), 'ждали', a);
    return got;
  };

  const shot = async (name) => {
    await waitFrames(2);
    writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
    console.log(name, JSON.stringify(await page.evaluate(DUMP)));
  };

  // Патчи шейдера: точечные, проверяем что подстановка реально сработала.
  const patch = await page.evaluate(() => {
    const raw = window.__blast.fragmentShader;
    const src = typeof raw === 'string' ? raw : String(raw && raw.shaderText);
    const anchor = 'float sceneT = length(posEC.xyz);';
    return {
      kind: typeof raw,
      hasAnchor: src.indexOf(anchor) >= 0,
      len: src.length,
      depthMap: src.replace(anchor, `${anchor}
  if (u_dbg > 4.5) { out_FragColor = vec4(vec3(clamp(log(max(sceneT, 1.0) / 200000.0) * 0.5 + 0.5, 0.0, 1.0)), 1.0); return; }`),
      noOccl: src.replace(anchor, 'float sceneT = 1.0e18;'),
    };
  });
  console.log('patch', JSON.stringify({ kind: patch.kind, hasAnchor: patch.hasAnchor, len: patch.len }));

  await setAge(AGE);
  await shot(`${TAG}_base`);

  if (patch.hasAnchor) {
    await page.evaluate((s) => { window.__blast.fragmentShader = s; }, patch.depthMap);
    await sleep(5000);
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 5; });
    await shot(`${TAG}_depthmap`);
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });

    await page.evaluate((s) => { window.__blast.fragmentShader = s; }, patch.noOccl);
    await sleep(5000);
    await shot(`${TAG}_nooccl`);

    await page.evaluate((s) => { window.__blast.fragmentShader = s; }, patch.depthMap);
    await sleep(5000);
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 2; });
    await shot(`${TAG}_tau`);
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 1; });
    await shot(`${TAG}_alpha`);
    await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
    await page.evaluate((s) => { window.__blast.fragmentShader = s; }, patch.noOccl);
    await sleep(5000);
  }

  // Ветер и ограничитель — на «голом» шейдере без окклюзии, чтобы не смешивать.
  const savedWind = await page.evaluate(() => {
    const u = window.__blast.uniforms.u_wind;
    window.__ab = { x: u.x, z: u.z, r: window.__blast.uniforms.u_boundR };
    u.x = 0; u.z = 0;
  });
  await shot(`${TAG}_nowind`);
  await page.evaluate(() => {
    const u = window.__blast.uniforms;
    u.u_wind.x = window.__ab.x; u.u_wind.z = window.__ab.z;
    u.u_boundR = window.__ab.r * 2.5;
  });
  await shot(`${TAG}_bigbound`);

  // Где шляпа должна быть на экране — арифметикой самого шейдера, без Cesium:
  // ro = u_cam, базис луча переносим в локальные оси через u_ax0..u_ax2.
  const proj = await page.evaluate(() => {
    const u = window.__blast.uniforms;
    const ax = [u.u_ax0, u.u_ax1, u.u_ax2];
    const toLocal = (v) => [v.x * ax[0].x + v.y * ax[0].y + v.z * ax[0].z,
      v.x * ax[1].x + v.y * ax[1].y + v.z * ax[1].z,
      v.x * ax[2].x + v.y * ax[2].y + v.z * ax[2].z];
    const f = toLocal(u.u_rayDir);
    const rr = toLocal(u.u_rayRight);
    const up = toLocal(u.u_rayUp);
    const W = window.__kupol.viewer.canvas.clientWidth;
    const H = window.__kupol.viewer.canvas.clientHeight;
    const at = (lx, ly, lz) => {
      const oc = [lx - u.u_cam.x, ly - u.u_cam.y, lz - u.u_cam.z];
      const dot = (b) => oc[0] * b[0] + oc[1] * b[1] + oc[2] * b[2];
      const z = dot(f);
      if (z <= 1) return { behind: true };
      const nx = dot(rr) / z / u.u_rayTan.x;
      const ny = dot(up) / z / u.u_rayTan.y;
      return { x: Math.round((nx + 1) * 0.5 * W), y: Math.round((1 - (ny + 1) * 0.5) * H), z: Math.round(z) };
    };
    const hy = Math.min(1.5, Math.max(u.u_head.y, u.u_fb.y) / Math.max(u.u_windH, 1));
    const dx = u.u_wind.x * u.u_age * hy;
    const dz = u.u_wind.z * u.u_age * hy;
    return {
      canvas: [W, H],
      headDrift: at(dx, u.u_head.y, dz),
      head: at(0, u.u_head.y, 0),
      stemTop: at(0, u.u_stem.y, 0),
      ground: at(0, 0, 0),
      camLocal: [Math.round(u.u_cam.x), Math.round(u.u_cam.y), Math.round(u.u_cam.z)],
      drift: [Math.round(dx), Math.round(dz)],
    };
  });
  console.log('proj', JSON.stringify(proj));

  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('AB DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
