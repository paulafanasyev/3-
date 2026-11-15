// Развёртка объёмного гриба по МОДЕЛЬНОМУ возрасту прямо в игре.
// Прошлый прогон («шляпа не рисуется») оказался артефактом прибора: возраст
// брался настенными часами, а кадры SwiftShader идут секундами. Здесь часы
// заморожены, rate измерен двумя устойчивыми отсчётами, и каждый кадр — ровно
// то, что даёт модель при s = 8, 25, 60, 120, 240, 400.
// Плюс близкая камера: начало лучей восстанавливаем из u_ax0..u_ax2 и u_cam,
// поэтому гриб можно обойти вокруг, не трогая ничего в коде игры.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4239);
const base = `http://127.0.0.1:${port}`;
const outDir = 'D:/mt5/tmp-nuclear/shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AGES = (process.env.AGES || '150,250,350,450').split(',').map(Number);
const CLOSE = (process.env.CLOSE || '450').split(',').map(Number);
const NEAR = Number(process.env.NEAR || 9000);

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

// DUMP сериализуется в страницу: никаких замыканий Node, всё внутри.
const DUMP = () => {
  const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
  const u = window.__blast.uniforms;
  const v4 = (x) => [r3(x.x), r3(x.y), r3(x.z), r3(x.w)];
  const v3 = (x) => [r3(x.x), r3(x.y), r3(x.z)];
  return {
    age: r3(u.u_age), life: r3(u.u_life), stepScale: u.u_stepScale,
    texScale: window.__blast.textureScale, rendered: window.__renderLog?.slice(-4),
    flash: r3(u.u_flash), show: window.__blast.show, boundR: r3(u.u_boundR),
    boundY: r3(u.u_bound.y), exposure: r3(u.u_exposure), sunI: r3(u.u_sunI),
    head: v4(u.u_head), headShape: v4(u.u_headShape), headDetail: v4(u.u_headDetail),
    stem: v4(u.u_stem), skirt: v4(u.u_skirt), fb: v4(u.u_fb),
    dome: v4(u.u_dome), ice: v4(u.u_ice), ice2: v4(u.u_ice2),
    ring0: v4(u.u_ring0), shock: v4(u.u_shock), bound: [r3(u.u_bound.x), r3(u.u_bound.y), r3(u.u_bound.z)],
    wind: v3(u.u_wind), windH: r3(u.u_windH), cam: v3(u.u_cam),
  };
};

// Профиль ОБЯЗАТЕЛЬНО уникальный на прогон: два процесса с одним user-data-dir
// Chrome не поднимает (второй подключается к первому), и прогон молча ждёт
// кадры чужой страницы — «Waiting failed: 300000ms» без единой строки лога.
const PPDIR = process.env.PPDIR || `D:/mt5/tmp-nuclear/pprofile-${process.pid}`;
const browser = await puppeteer.launch({
  userDataDir: PPDIR,
  headless: 'new', protocolTimeout: 1200000,
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
  await page.select('#k-nrange-bomb', process.env.BOMB || 'little-boy');
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
    window.__clk = { real, hold: null };
    window.__frames = 0;
    window.__renderLog = [];
    window.__lastRenderWall = 0;
    performance.now = () => (window.__clk.hold !== null ? window.__clk.hold : real());
    window.__kupol.viewer.scene.postRender.addEventListener(() => {
      window.__frames += 1;
      const wall = Date.now();
      const dt = window.__lastRenderWall ? wall - window.__lastRenderWall : 0;
      window.__lastRenderWall = wall;
      if (window.__blast) window.__renderLog.push([
        Math.round(window.__blast.uniforms.u_age), window.__blast.uniforms.u_stepScale,
        +window.__blast.uniforms.u_flash.toFixed(3), window.__blast.enabled, dt,
      ]);
    });
  });
  // layers.js вешает на setTimeout уборку: showMs = durationSeconds+1 ≈ 151 с
  // НАСТОЯЩЕГО времени, и таймер не знает про наши подменённые часы. Без этой
  // страховки проход исчезал ровно на середине съёмки (в 1-м и 2-м прогоне —
  // n=0 стадий kupol-blast). Долгие таймеры умножаем, короткие не трогаем.
  await page.evaluate(() => {
    const orig = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => orig(fn, ms >= 10000 ? ms * 400 : ms, ...rest);
  });
  await page.click('[data-test]');
  await page.waitForFunction(FIND, { timeout: 420000, polling: 400 });
  await page.evaluate(() => {
    window.__forceSteps = 0;
    window.__forceShow = null;
    // update() игры сам пишет stage.show каждый кадр (onScreen || flash), поэтому
    // обычное присваивание извне затирается до растера: «off» и «on» кадры
    // оказались одним и тем же (changedPct 0 при пустом небе). Слушатель,
    // повешенный ПОСЛЕ игрового, поднимается позже в том же preRender и
    // доживает до растера этого кадра.
    window.__kupol.viewer.scene.preRender.addEventListener(() => {
      if (!window.__blast) return;
      window.__blast.uniforms.u_flash = 0;
      if (window.__forceSteps) window.__blast.uniforms.u_steps = window.__forceSteps;
      if (window.__forceShow !== null) {
        // Cesium исполняет стадию по enabled (execute проверяет только
        // _enabled); show для одиночной стадии — пустая запись.
        window.__blast.enabled = window.__forceShow;
        window.__blast.show = window.__forceShow;
      }
      // Игровая адаптация по замеренной цене сама меняет raster и шаг; в
      // приборе это испортит контроль — раунды меряют один и тот же режим.
      if (window.__pinQuality) {
        window.__blast._textureScale = 1;
        window.__blast.uniforms.u_stepScale = window.__pinStep || 1;
      }
    });
  });
  // PIN_FULL=1 — снимать при заведомо полном качестве: на этой машине
  // стартовый raster берётся из цены прошлого взрыва (0.3–0.75), и без
  // пина кадр был бы размыт не шейдером, а адаптацией.
  if (process.env.PIN_FULL === '1') await page.evaluate(() => { window.__pinQuality = true; });
  // CELESTIAL=moon|sun|both — гасит астрономические спрайты Cesium. Сцена
  // рендерится при выключенном освещении глобуса, и на ближнем кадре в небе
  // висит диск чистого нуля (31 пиксель rgb[0,0,0]), который остаётся даже
  // с полностью выключенным объёмным проходом, то есть не из шейдера.
  if (process.env.CELESTIAL) {
    await page.evaluate((v) => {
      const s = window.__kupol.viewer.scene;
      if (v === 'both' || v === 'moon') { if (s.moon) s.moon.show = false; }
      if (v === 'both' || v === 'sun') { if (s.sun) s.sun.show = false; }
    }, process.env.CELESTIAL);
  }

  await page.evaluate(() => {
    document.activeElement?.blur?.();
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint',
      '.k-first-hint', '.k-toast', '.k-offer', '.k-combat', '.k-fin', '.k-nrange-panel', '.k-nrange-trigger',
      // кнопка справки hud.js:38 — в кадре она выглядит как кружок со «?» в небе
      '.k-help']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
    // Игровые часы ОСТАНАВЛИВАЕМ: возраст гриба живёт на performance.now(), а
    // ход игры — на Cesium-часах. Без остановки прыжок на минуту вперёди
    // прокручивает таймлайн партии, партия дёргает endTurn и убивает проход —
    // униформы замерли, камера уехала, кадр остался пустым (так и было в 1-м
    // прогоне: после 120→400 облако исчезло совсем).
    const clk = window.__kupol.viewer.clock;
    clk.canAnimate = false;
    clk.shouldAnimate = false;
    clk.multiplier = 0;
    window.__kupol.viewer.resolutionScale = 0.75;
  });

  const waitFrames = async (k) => {
    const f0 = await page.evaluate(() => window.__frames);
    await page.waitForFunction(({ f, n }) => window.__frames >= f + n,
      { timeout: 300000, polling: 250 }, { f: f0, n: k });
  };

  await page.evaluate(() => { window.__clk.hold = window.__clk.real() + 30000; });
  await waitFrames(3);
  const s1 = await page.evaluate(() => ({ n: window.__clk.hold, s: window.__blast.uniforms.u_age }));
  await page.evaluate(() => { window.__clk.hold += 20000; });
  await waitFrames(3);
  const s2 = await page.evaluate(() => ({ n: window.__clk.hold, s: window.__blast.uniforms.u_age }));
  const rate = (s2.s - s1.s) / ((s2.n - s1.n) / 1000);
  console.log('rate', rate.toFixed(4), '| s1', s1.s.toFixed(2), '| s2', s2.s.toFixed(2));

  // Прыгаем ТОЛЬКО вперёд и мелкими шагами: назад часы не крутим (партия этого
  // не любит), и крупный шаг ровно на том же месте и убивал проход.
  let curS = s1.s;
  const alive = async () => page.evaluate(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    let n = 0;
    for (let i = 0; i < col.length; i += 1) if (String(col.get(i).name).indexOf('kupol-blast') === 0) n += 1;
    return { n, age: window.__blast.uniforms.u_age };
  });
  const setAge = async (a) => {
    if (a < curS - 5) {
      console.log(`пропуск ${a}: назад не ходим (сейчас ${curS.toFixed(0)})`);
      return curS;
    }
    for (let t = Math.min(a, curS + 60); ; t = Math.min(a, t + 60)) {
      await page.evaluate(({ r, target, baseN, baseS }) => {
        window.__clk.hold = baseN + ((target - baseS) / r) * 1000;
      }, { r: rate, target: t, baseN: s1.n, baseS: s1.s });
      await waitFrames(3);
      if (t >= a) break;
    }
    await waitFrames(2);
    const got = await page.evaluate(() => window.__blast.uniforms.u_age);
    if (Math.abs(got - a) > 3) console.log(`!! возраст ${a} не встал: ${got.toFixed(2)}`, JSON.stringify(await alive()));
    else curS = got;
    return got;
  };

  const shot = async (name) => {
    const t0 = Date.now();
    await waitFrames(2);
    writeFileSync(`${outDir}/${name}.png`, await page.screenshot());
    console.log(name, ((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(await page.evaluate(DUMP)));
  };

  if (process.env.SWEEP !== '0') {
    for (const a of AGES) {
      await setAge(a);
      await shot(`sweep_s${a}`);
    }
  }

  // Близкая камера. Локальные оси шейдера — это восток/верх/север ENU начала
  // лучей, а u_cam — положение камеры в тех же метрах. Значит начало координат
  // восстанавливается одним вычитанием и грибом можно руководить извне.
  // Глобального Cesium в странице нет (сборка ESM), поэтому обходимся
  // конструктором позиции камеры и эллипсоидом вьюера.
  const originGeo = await page.evaluate(() => {
    const u = window.__blast.uniforms;
    const cam = window.__kupol.viewer.camera;
    const C3 = cam.positionWC.constructor;
    const e = u.u_ax0, p = u.u_ax1, n = u.u_ax2;
    const w = cam.positionWC;
    const origin = new C3(
      w.x - (e.x * u.u_cam.x + p.x * u.u_cam.y + n.x * u.u_cam.z),
      w.y - (e.y * u.u_cam.x + p.y * u.u_cam.y + n.y * u.u_cam.z),
      w.z - (e.z * u.u_cam.x + p.z * u.u_cam.y + n.z * u.u_cam.z),
    );
    window.__origin = origin;
    const c = window.__kupol.viewer.scene.globe.ellipsoid.cartesianToCartographic(origin);
    const deg = 57.29577951308232;
    return [Math.round(c.longitude * deg * 1e4) / 1e4, Math.round(c.latitude * deg * 1e4) / 1e4,
      Math.round(c.height)];
  });
  console.log('burst origin (lon,lat,h)', JSON.stringify(originGeo), '| near', NEAR);

  const place = async (a, deg) => {
    await setAge(a);
    await page.evaluate(({ ageDeg }) => {
      const u = window.__blast.uniforms;
      const cam = window.__kupol.viewer.camera;
      const C3 = cam.positionWC.constructor;
      const e = u.u_ax0, p = u.u_ax1, n = u.u_ax2, o = window.__origin;
      const put = (dx, dy, dz) => new C3(
        o.x + e.x * dx + p.x * dy + n.x * dz,
        o.y + e.y * dx + p.y * dy + n.y * dz,
        o.z + e.z * dx + p.z * dy + n.z * dz,
      );
      const rad = ageDeg * Math.PI / 180;
      const dx = Math.cos(rad) * window.__placeNear;
      const dz = Math.sin(rad) * window.__placeNear;
      const dy = Math.max(1200, u.u_head.y * 0.55);
      // Снос шляпы считаем тем же ветром, что и шейдер, — иначе гриб уедет из
      // кадра: на «Малыше» за s=400 это несколько километров.
      const hy = Math.min(1.5, Math.max(u.u_head.y, u.u_fb.y) / Math.max(u.u_windH, 1));
      const tx = u.u_wind.x * u.u_age * hy;
      const tz = u.u_wind.z * u.u_age * hy;
      const ty = u.u_head.y * 0.75;
      const eye = put(dx, dy, dz);
      const dl = { x: tx - dx, y: ty - dy, z: tz - dz };
      const len = Math.hypot(dl.x, dl.y, dl.z);
      cam.cancelFlight();
      cam.setView({
        destination: eye,
        orientation: {
          heading: Math.atan2(dl.x, dl.z),
          pitch: Math.asin(Math.max(-1, Math.min(1, dl.y / len))),
          roll: 0,
        },
      });
    }, { ageDeg: deg });
    await shot(`near_d${deg}_s${a}`);
  };
  await page.evaluate((c) => { window.__placeNear = c.near; }, { near: NEAR });

  // A/B «мяса» шляпки и ножки. Подменять stage.fragmentShader нельзя: свойство
  // объявлено @readonly (только геттер), программа не пересобирается — ровно
  // этим и был пустой прошлый замер. Второй PostProcessStage из old.uniforms
  // тоже не собирается: после первого кадра Cesium заменяет _uniforms объектом
  // с НЕПЕРЕЧИСЛЯЕМЫМИ геттерами, createUniformMap не находит ни одного имени,
  // и рендер падает («e[c.name] is not a function»). Значит сравнение — две
  // сборки одним прибором. Чтобы сборки были сравнимы, seed шума закрепляется
  // извне, а разброс от самого seed измеряется вторым кадром с другим seed.
  const SRC = await page.evaluate(() => {
    const raw = window.__blast.fragmentShader;
    return typeof raw === 'string' ? raw : String(raw && raw.shaderText);
  });
  const ANCHORS = {
    'head.amp060': 'amp = min(amp, H * 0.60);',
    'head.gainKnob': 'float dn = base - ((shapeN - 0.42) * 1.30 * u_headDetail.w + warp * 0.45) * amp;',
    'head.rampKnob': 'float edge = H * 0.05 * u_headRamp;',
    'head.ramp25': 'float dens = smoothstep(edge, -edge * 2.5, dn);',
    'stem.gainKnob': 'float dn = base - ((n - 0.45) * 2.4 * u_headDetail.w + (lf - 0.5) * 0.9) * r * 0.55;',
    'stem.rampKnob': 'float dens = smoothstep(r * 0.07 * u_headRamp, -r * 0.33 * u_headRamp, dn);',
    'head.cell10x': 'float cell = (0.35 * H + 0.08 * R) * max(0.25, u_headHeat.w);',
    'head.ampCell085': 'amp = min(amp, cell * 0.85);',
    'head.fineLod': 'float fine = smoothstep(0.02, 0.09, ang);',
    'head.reusedBump': 'nrm = normalize(nrm + (headBump - 0.5) * 1.4);',
    'head.bumpFields': 'bump = vec3(b1, b2, b3);',
    'head.albedoRelief': 'vec3 cHead = headCol * (0.52 + 0.85 * cauli);',
    'light.sun15': 'vec3 sunC = vec3(1.0, 0.96, 0.9) * max(u_sunI, 0.05) * 1.5;',
    'dbg.sceneTramp': 'float lg = clamp(log(max(sceneT, 1.0)) / log(10.0) / 5.0, 0.0, 1.0);',
    'dbg.bailMap': 'out_FragColor = vec4(step(0.01, alpha), 1.0, step(1.0, tEnter), 1.0);',
  };
  const live = Object.fromEntries(Object.entries(ANCHORS).map(([k, a]) => [k, SRC.indexOf(a) >= 0]));
  console.log('шейдер в странице:', JSON.stringify(live));

  // Живые ручки «мяса»: u_headDetail.w = усиление долек, u_headRamp = множитель
  // полосы сглаживания. Драйвер игры переписывает их каждый кадр (preRender),
  // поэтому переопределение вешается СЛУШАТЕЛЕМ ПОЗЖЕ: preRender поднимается в
  // порядке регистрации, и наш值 доживает до растера этого же кадра.
  const setKnobs = async (gain, ramp) => {
    await page.evaluate(({ g, r }) => {
      if (!window.__knobHook) {
        window.__knobs = { g: 1, r: 1 };
        window.__knobHook = window.__kupol.viewer.scene.preRender.addEventListener(() => {
          const u = window.__blast.uniforms;
          if (!u) return;
          u.u_headDetail.w = window.__knobs.g;
          u.u_headRamp = window.__knobs.r;
        });
      }
      window.__knobs.g = g;
      window.__knobs.r = r;
    }, { g: gain, r: ramp });
    await sleep(3000);
  };

  const setSeed = async (v) => {
    await page.evaluate((x) => { window.__blast.uniforms.u_seed = x; }, v);
    await sleep(4000);
  };

  await page.evaluate(() => {
    const cam = window.__kupol.viewer.camera;
    window.__gameCam = {
      pos: [cam.positionWC.x, cam.positionWC.y, cam.positionWC.z],
      heading: cam.heading, pitch: cam.pitch, roll: cam.roll,
    };
  });
  const restoreGameCam = () => page.evaluate(() => {
    const c = window.__gameCam;
    const cam = window.__kupol.viewer.camera;
    const C3 = cam.positionWC.constructor;
    cam.cancelFlight();
    cam.setView({
      destination: new C3(c.pos[0], c.pos[1], c.pos[2]),
      orientation: { heading: c.heading, pitch: c.pitch, roll: c.roll },
    });
  });

  // Кадр, в котором игра ОСТАНАВЛИВАЕТСЯ. Заморозка часов Cesium, на которой
  // стоит весь прогон, замораживает и flyToBoundingSphere: он идёт по времени
  // сцены. Поэтому «__gameCam» — это поза ДО перелёта (30.9 км), и все выводы
  // о «мелком грибе» были выводом про инструмент, а не про игру. Здесь кладём
  // камеру туда, куда frameCloud довёл бы её сам: та же сфера, тот же pitch,
  // тот же fitRange по живому fovy.
  const frameGame = () => page.evaluate(({ sphereR, centerH }) => {
    const u = window.__blast.uniforms;
    const cam = window.__kupol.viewer.camera;
    const C3 = cam.positionWC.constructor;
    const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2, oc = u.u_cam;
    const w = cam.positionWC;
    const origin = new C3(
      w.x - (e.x * oc.x + up.x * oc.y + n.x * oc.z),
      w.y - (e.y * oc.x + up.y * oc.y + n.y * oc.z),
      w.z - (e.z * oc.x + up.z * oc.y + n.z * oc.z));
    const fovy = cam.frustum.fovy ?? (Math.PI / 3);
    const R = sphereR / Math.tan(fovy * 0.5 * 0.85);
    const pitch = -11 * Math.PI / 180;
    const put = (dx, dy, dz) => new C3(
      origin.x + e.x * dx + up.x * dy + n.x * dz,
      origin.y + e.y * dx + up.y * dy + n.y * dz,
      origin.z + e.z * dx + up.z * dy + n.z * dz);
    cam.cancelFlight();
    cam.setView({
      destination: put(0, centerH + Math.sin(-pitch) * R, -Math.cos(pitch) * R),
      orientation: { heading: 0, pitch, roll: 0 },
    });
    const d = window.__blast.uniforms.u_cam;
    return { R_km: +(R / 1000).toFixed(2), cam: [d.x, d.y, d.z].map((x) => +x.toFixed(0)) };
  }, { sphereR: Number(process.env.FITR || 8635), centerH: Number(process.env.FITC || 5625) });

  // GAMEFRAME=1 — снимать в настоящем игровом кадре; без него остаётся
  // позой-до-перелёта, и это надо помнить при любом сравнении.
  const gameFrame = async () => {
    if (process.env.GAMEFRAME) console.log('КАДР@игровой', JSON.stringify(await frameGame()));
    else await restoreGameCam();
  };

  const tag = process.env.TAG || 'new';
  await setAge(CLOSE[0]);

  // ЗАМЕР КАДРА (#27): во сколько ПИКСЕЛЕЙ лезет гриб при данной дистанции.
  // Считаем аналитически по той же камере: проекция верхушки и основания в
  // экранную высоту пинхол-фрустума. Иначе «приблизить кадр» остаётся словом,
  // а не числом: flyToBoundingSphere кладёт камеру в 32 км, и никто не знает,
  // сколько это на самом деле пикселей гриба.
  if (process.env.FRAMEPROBE) {
    const rows = await page.evaluate(({ ranges, pitches }) => {
      const u = window.__blast.uniforms;
      const cam = window.__kupol.viewer.camera;
      const C3 = cam.positionWC.constructor;
      const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2, oc = u.u_cam;
      const w = cam.positionWC;
      const origin = new C3(
        w.x - (e.x * oc.x + up.x * oc.y + n.x * oc.z),
        w.y - (e.y * oc.x + up.y * oc.y + n.y * oc.z),
        w.z - (e.z * oc.x + up.z * oc.y + n.z * oc.z));
      const addLocal = (de, du, dn) => new C3(
        origin.x + e.x * de + up.x * du + n.x * dn,
        origin.y + e.y * de + up.y * du + n.y * dn,
        origin.z + e.z * de + up.z * du + n.z * dn);
      const topY = u.u_head.y + u.u_headShape.x * 1.1;
      const capR = u.u_head.w;
      const frustum = cam.frustum;
      const tanY = Math.tan(((frustum.fovy ?? 0.6) + 1e-6) / 2);
      const pxH = window.__kupol.viewer.scene.canvas.height;
      const pxW = window.__kupol.viewer.scene.canvas.width;
      const sub = (a, b) => new C3(a.x - b.x, a.y - b.y, a.z - b.z);
      const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
      const screenY = (pt) => {
        const d = sub(pt, cam.positionWC);
        const f = dot(d, cam.directionWC);
        if (!(f > 1)) return null;
        return (0.5 - dot(d, cam.upWC) / f / tanY * 0.5) * pxH;
      };
      const out = [];
      const put = (R, pitchDeg) => {
        const p = -pitchDeg * Math.PI / 180;
        const eye = addLocal(0, Math.sin(p) * R, -Math.cos(p) * R);
        cam.cancelFlight();
        // смотрим ровно на центр шляпы: pitch по направлению к нему
        const toTop = sub(addLocal(0, topY, 0), eye);
        const len = Math.hypot(toTop.x, toTop.y, toTop.z);
        const dir = new C3(toTop.x / len, toTop.y / len, toTop.z / len);
        cam.setView({
          destination: eye,
          orientation: { heading: 0, pitch: Math.asin(dir.y), roll: 0 },
        });
        const yTop = screenY(addLocal(0, topY, 0));
        const yBase = screenY(addLocal(0, 0, 0));
        const yStemTop = screenY(addLocal(0, u.u_stem.y, 0));
        const capPx = Math.round(2 * Math.atan(capR / len) * pxW / (2 * tanY * (pxW / pxH)));
        return {
          R_km: +(R / 1000).toFixed(1), pitch: pitchDeg,
          гриб_пикс: yTop !== null && yBase !== null ? Math.round(yBase - yTop) : null,
          шляпа_пикс: capPx,
          ножка_пикс: yStemTop !== null && yBase !== null ? Math.round(yBase - yStemTop) : null,
          'доля_кадра': yTop !== null && yBase !== null ? +((yBase - yTop) / pxH).toFixed(2) : null,
        };
      };
      for (const pitchDeg of pitches) for (const R of ranges) out.push(put(R, pitchDeg));
      out.push({ заметка: 'канвас', pxW, pxH, fovy: +(frustum.fovy * 57.2958).toFixed(1) });
      return out;
    }, { ranges: [6000, 9000, 12000, 16000, 22000, 32000], pitches: [11, 25, 45] });
    for (const r of rows) console.log('КАДР', JSON.stringify(r));
    console.log('FRAMEPROBE DONE');
  } else {
    await setSeed(4242);
    await gameFrame();
    const GRID = (process.env.GRID || '').split(',').filter(Boolean).map((p) => p.split(':').map(Number));
    if (GRID.length) {
      for (const [g, r] of GRID) {
        await setKnobs(g, r);
        await gameFrame();
        await shot(`lobe_g${g}_r${r}_far`);
      }
      for (const pair of (process.env.NEARGRID || '').split(';').filter(Boolean)) {
        const [ng, nr] = pair.split(':').map(Number);
        await setKnobs(ng, nr);
        await place(CLOSE[0], 180);
        await shot(`lobe_g${ng}_r${nr}_near`);
      }
    } else if (process.env.UNIF_DIFF === '1') {
      // ЧТО РЕАЛЬНО УХОДИТ НА GPU. Cesium при первом же исполнении перекладывает
      // uniforms в stage._actualUniforms, а дальше обновляет их ТОЛЬКО через
      // сеттер stage.uniforms.x = … (getUniformValueGetterAndSetter). Игра
      // держит ссылку на СВОЙ объект и пишет в него напрямую, поэтому для
      // скаляров GPU навсегда остаётся значение первого кадра, а объекты
      // (Cartesian3/4) живые — их растер читает из тех же ссылок.
      const diff = await page.evaluate(() => {
        const st = window.__blast;
        const live = st.uniforms; // геттеры поверх исходного объекта игры
        const actual = st._actualUniforms || {};
        const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
        const rows = [];
        // ПО КЛЮЧАМ actual, а не live: stage.uniforms после первого кадра —
        // объект с НЕПЕРЕЧИСЛЯЕМЫМИ геттерами, Object.keys по нему пуст.
        for (const k of Object.keys(actual)) {
          const a = actual[k];
          if (a === null || a === undefined || typeof a === 'function') continue;
          const b = live[k];
          if (b === null || b === undefined) continue;
          if (typeof a === 'number') {
            if (typeof b !== 'number') continue;
            if (Math.abs(a - b) > Math.max(1e-6, Math.abs(b) * 1e-3)) {
              rows.push({ k, gpu: r3(a), live: r3(b) });
            }
          } else if (a.x !== undefined) {
            const n = a.w === undefined ? 3 : 4;
            let bad = false;
            for (let i = 0; i < n; i += 1) {
              const key = 'xyzw'[i];
              if (Math.abs(a[key] - b[key]) > Math.max(1e-3, Math.abs(b[key]) * 1e-3)) bad = true;
            }
            if (bad) rows.push({ k, gpu: [a.x, a.y, a.z, a.w].slice(0, n).map(r3), live: [b.x, b.y, b.z, b.w].slice(0, n).map(r3) });
          }
        }
        return { nActual: Object.keys(actual).length, mismatch: rows.length, rows };
      });
      console.log('UNIFDIFF', JSON.stringify(diff));
      console.log('UNIFDIFF DONE');
    } else if (process.env.PROBE_MODE === '1') {
      // КОНВЕНЦИЯ КАМЕРЫ. u_dbg=5 на ближней камере: марш запускается только
      // в диске 161 px (silhouette ограничителя) в левом нижнем углу, причём
      // среднее B = tEnter/tExit = 0.89, то есть в метрах шейдера камера в
      // ~17 радиусах от центра, а не внутри. Значит place() смотрит не туда.
      // У Cesium heading/pitch задают направление в базисе x=СЕВЕРА,
      // y=ВОСТОКА, z=ВЕРХ, а place() подставлял (восток, верх, север).
      const geom = () => page.evaluate(() => {
        const u = window.__blast.uniforms;
        const cam = window.__kupol.viewer.camera;
        const d = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        // базис камеры, выраженный в локальных осях шейдера (восток, верх, север)
        const L = (v) => [d(v, u.u_ax0), d(v, u.u_ax1), d(v, u.u_ax2)].map((x) => +x.toFixed(3));
        const fr = cam.frustum;
        const tanY = Math.tan(((fr.fovy ?? 0.6) + 1e-6) / 2);
        const tanX = tanY * (fr.aspectRatio || 16 / 9);
        const pxW = window.__kupol.viewer.scene.canvas.width;
        const pxH = window.__kupol.viewer.scene.canvas.height;
        const scr = (pt) => {
          const v = { x: pt.x - cam.positionWC.x, y: pt.y - cam.positionWC.y, z: pt.z - cam.positionWC.z };
          const f = d(v, cam.directionWC);
          if (!(f > 1)) return null;
          return { x: Math.round((d(v, cam.rightWC) / f / tanX * 0.5 + 0.5) * pxW),
            y: Math.round((0.5 - d(v, cam.upWC) / f / tanY * 0.5) * pxH), depth_km: +(f / 1000).toFixed(1) };
        };
        const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2, oc = u.u_cam;
        const w = cam.positionWC;
        const origin = { x: w.x - (e.x * oc.x + up.x * oc.y + n.x * oc.z),
          y: w.y - (e.y * oc.x + up.y * oc.y + n.y * oc.z),
          z: w.z - (e.z * oc.x + up.z * oc.y + n.z * oc.z) };
        const C3 = w.constructor;
        const put = (de, du, dn) => new C3(origin.x + e.x * de + up.x * du + n.x * dn,
          origin.y + e.y * de + up.y * du + n.y * dn,
          origin.z + e.z * de + up.z * du + n.z * dn);
        const D = Math.hypot(oc.x - u.u_bound.x, oc.y - u.u_bound.y, oc.z - u.u_bound.z);
        return {
          camLocal: [oc.x / 1000, oc.y / 1000, oc.z / 1000].map((x) => +x.toFixed(2)),
          bound: [u.u_bound.x / 1000, u.u_bound.y / 1000, u.u_bound.z / 1000, u.u_boundR / 1000].map((x) => +x.toFixed(2)),
          camToBound_km: +(D / 1000).toFixed(2), inside: D < u.u_boundR,
          DoverR: +(D / u.u_boundR).toFixed(2),
          headLocal: [u.u_head.x / 1000, u.u_head.y / 1000, u.u_head.z / 1000].map((x) => +x.toFixed(2)),
          camDir_localEUP: L(cam.directionWC), camUp_localEUP: L(cam.upWC), camRight_localEUP: L(cam.rightWC),
          heading_deg: +(cam.heading * 57.2958).toFixed(1), pitch_deg: +(cam.pitch * 57.2958).toFixed(1),
          fovy_deg: +(fr.fovy * 57.2958).toFixed(1), aspect: +(fr.aspectRatio || 0).toFixed(3),
          px: [pxW, pxH],
          центр_ограничителя_на_экране: scr(put(0, u.u_bound.y, 0)),
          шляпа_на_экране: scr(put(u.u_head.x, u.u_head.y, u.u_head.z)),
          основание_на_экране: scr(put(0, 0, 0)),
          угловой_радиус_ограничителя_deg: +(Math.asin(Math.min(1, u.u_boundR / D)) * 57.2958).toFixed(1),
        };
      });
      await setSeed(4242);
      await place(CLOSE[0], 180);
      console.log('PROBE как есть', JSON.stringify(await geom()));
      // Починенная ориентация: (east,up,north) -> Cesium (north, east, up).
      const fix = await page.evaluate(() => {
        const u = window.__blast.uniforms;
        const cam = window.__kupol.viewer.camera;
        const C3 = cam.positionWC.constructor;
        const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2, oc = u.u_cam;
        const w = cam.positionWC;
        const origin = new C3(w.x - (e.x * oc.x + up.x * oc.y + n.x * oc.z),
          w.y - (e.y * oc.x + up.y * oc.y + n.y * oc.z),
          w.z - (e.z * oc.x + up.z * oc.y + n.z * oc.z));
        const put = (de, du, dn) => new C3(origin.x + e.x * de + up.x * du + n.x * dn,
          origin.y + e.y * de + up.y * du + n.y * dn,
          origin.z + e.z * de + up.z * du + n.z * dn);
        const rad = Math.PI; // deg=180 как у place()
        const near = window.__placeNear;
        const dx = Math.cos(rad) * near; const dz = Math.sin(rad) * near;
        const dy = Math.max(1200, u.u_head.y * 0.55);
        const hy = Math.min(1.5, Math.max(u.u_head.y, u.u_fb.y) / Math.max(u.u_windH, 1));
        const tx = u.u_wind.x * u.u_age * hy; const tz = u.u_wind.z * u.u_age * hy;
        const ty = u.u_head.y * 0.75;
        const eye = put(dx, dy, dz);
        const dl = { x: tx - dx, y: ty - dy, z: tz - dz };
        const len = Math.hypot(dl.x, dl.y, dl.z);
        cam.cancelFlight();
        cam.setView({ destination: eye, orientation: {
          heading: Math.atan2(dl.y, dl.x), pitch: Math.asin(dl.z / len), roll: 0 } });
        return { heading_deg: +(cam.heading * 57.2958).toFixed(1), pitch_deg: +(cam.pitch * 57.2958).toFixed(1) };
      });
      console.log('PROBE починка', JSON.stringify(fix), JSON.stringify(await geom()));
      await waitFrames(3);
      writeFileSync(`${outDir}/probe_fixed_near.png`, await page.screenshot());
      await page.evaluate(() => { window.__blast.uniforms.u_dbg = 1; });
      await waitFrames(3);
      writeFileSync(`${outDir}/probe_fixed_dbg1.png`, await page.screenshot());
      await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
      console.log('PROBE DONE');
    } else if (process.env.DIFF_MODE === '1') {
      // ГДЕ РИСУЕТСЯ ПРОХОД. Ближний кадр последних прогонов — пустое небо с
      // серым шариком, и вывод «шляпа целая и детальная на 67 шагах» оказался
      // выводом про картинку, в которой облака нет. Прибор: тот же кадр с
      // выключенным и включённым stage, разница покажет Пиксельную область
      // вклада объёмного прохода; плюс геометрия «камера vs ограничитель».
      const geo = () => page.evaluate(() => {
        const u = window.__blast.uniforms;
        const c = u.u_cam; const b = u.u_bound;
        const d = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
        const fr = window.__kupol.viewer.camera.frustum;
        return {
          camToBound_km: +(d / 1000).toFixed(2), boundR_km: +(u.u_boundR / 1000).toFixed(2),
          inside: d < u.u_boundR, fovy_deg: +((fr.fovy ?? 1.047) * 57.2958).toFixed(1),
          capR_km: +(u.u_head.w / 1000).toFixed(2), headY_km: +(u.u_head.y / 1000).toFixed(2),
          camY_km: +(c.y / 1000).toFixed(2), show: window.__blast.show,
        };
      });
      const pair = async (name) => {
        await page.evaluate(() => { window.__forceShow = false; });
        await waitFrames(3);
        writeFileSync(`${outDir}/${name}_off.png`, await page.screenshot());
        await page.evaluate(() => { window.__forceShow = true; });
        console.log('GEO', name, JSON.stringify(await geo()));
        await waitFrames(3);
        writeFileSync(`${outDir}/${name}_on.png`, await page.screenshot());
        console.log(name, JSON.stringify(await page.evaluate(DUMP)));
      };
      await setSeed(4242);
      await pair('diff_far');
      await place(CLOSE[0], 180);
      await pair('diff_near');
      for (const deg of (process.env.ORBIT || '90,270').split(',')) {
        await place(CLOSE[0], Number(deg));
        await pair(`diff_near_d${deg}`);
      }
    } else if (process.env.DBG_MODE === '1') {
      // Что луч ДЕЙСТВИТЕЛЬНО находит в объёме с ближней камеры. u_dbg:
      // 1 = покрытие alpha, 2 = оптические толщины head/stem/skirt, 3 = остаток
      // прозрачности T, 4 = огонь/прочее + где луч зацепил впервые,
      // 5 = (sceneT, tEnter/tExit) для запустившихся пикселей,
      // 6 = КАРТА ОТКАЗОВ: маджента boundR<=0, оранжевый disc<=0 (луч мимо
      // ограничителя), красный отсечён глубиной, зелёный марш прошёл,
      // синий = tEnter>=1 (камера СНАРУЖИ ограничителя).
      // BAIL — тот же тест disc/tEnter, что и в шейдере, но в JS по тем же
      // униформам: если он говорит «disc>0 во всём кадре», а картинка говорит
      // «нет», шейдер получает НЕ те значения, которые читает прибор.
      const bail = () => page.evaluate(() => {
        const u = window.__blast.uniforms;
        const cam = window.__kupol.viewer.camera;
        const fr = cam.frustum;
        const tanY = Math.tan(((fr.fovy ?? 0.6) + 1e-6) / 2);
        const tanX = tanY * (fr.aspectRatio || 16 / 9);
        const e = u.u_ax0, p = u.u_ax1, n = u.u_ax2;
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        const oc = { x: u.u_cam.x - u.u_bound.x, y: u.u_cam.y - u.u_bound.y, z: u.u_cam.z - u.u_bound.z };
        const rays = [];
        for (const [nx, ny] of [[0, 0], [-0.5, -0.5], [0.5, 0.5], [-0.577, -0.667], [0, -0.9]]) {
          const w = { x: cam.directionWC.x + cam.rightWC.x * nx * tanX + cam.upWC.x * ny * tanY,
            y: cam.directionWC.y + cam.rightWC.y * nx * tanX + cam.upWC.y * ny * tanY,
            z: cam.directionWC.z + cam.rightWC.z * nx * tanX + cam.upWC.z * ny * tanY };
          const lw = { x: dot(w, e), y: dot(w, p), z: dot(w, n) };
          const len = Math.hypot(lw.x, lw.y, lw.z);
          const rd = { x: lw.x / len, y: lw.y / len, z: lw.z / len };
          const bq = oc.x * rd.x + oc.y * rd.y + oc.z * rd.z;
          const cq = dot(oc, oc) - u.u_boundR * u.u_boundR;
          const disc = bq * bq - cq;
          const sq = disc > 0 ? Math.sqrt(disc) : 0;
          rays.push({ ndc: [nx, ny], lenW: +len.toFixed(3), disc_Mm2: +(disc / 1e6).toFixed(2),
            tEnter_km: +(Math.max(-bq - sq, 0) / 1000).toFixed(2),
            tExit_km: +((-bq + sq) / 1000).toFixed(2) });
        }
        return { oc_km: +(Math.hypot(oc.x, oc.y, oc.z) / 1000).toFixed(2),
          boundR_km: +(u.u_boundR / 1000).toFixed(2), rays };
      });
      await setSeed(4242);
      await place(CLOSE[0], 180);
      console.log('BAIL', JSON.stringify(await bail()));
      for (const d of (process.env.DBG_LIST || '1,2,3,4,5').split(',').map(Number)) {
        await page.evaluate((x) => { window.__blast.uniforms.u_dbg = x; }, d);
        await waitFrames(3);
        writeFileSync(`${outDir}/dbg${d}_near.png`, await page.screenshot());
        console.log(`dbg${d} снят`);
      }
      await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
      for (const deg of (process.env.ORBIT || '').split(',')) {
        if (!deg) continue;
        await page.evaluate((x) => { window.__blast.uniforms.u_dbg = x; }, 1);
        await place(CLOSE[0], Number(deg));
        writeFileSync(`${outDir}/dbg1_orbit${deg}.png`, await page.screenshot());
      }
      await page.evaluate(() => { window.__blast.uniforms.u_dbg = 0; });
    } else if (process.env.PERF_MODE === '1') {
      // СОСТАВ КАДРА. Прежний порядок «сначала off, потом все perf» был
      // непригоден: первая конфигурация стабильно дороже последующих на 6-7 с
      // (прогрев тайлов и кешей), а это больше любого отдельного блока — из-за
      // этого «off» выходил дороже «on» и весь распад тонул в дрейфе. Теперь
      // режимы чередуются раундами, и по раундам берётся медиана.
      // Управление — только enabled: PostProcessStage.execute проверяет
      // _enabled, show для одиночной стадии не читается вообще.
      const ONE = async (setup, arg) => {
        await page.evaluate(() => { window.__pinQuality = true; });
        await page.evaluate(setup, arg);
        await waitFrames(1);
        await page.evaluate(() => { window.__renderLog.length = 0; });
        await waitFrames(Number(process.env.PERF_FRAMES || 2));
        return page.evaluate(() => {
          const d = (window.__renderLog || []).map((x) => x[4]).filter((x) => x > 0)
            .sort((a, b) => a - b);
          return d.length ? d[(d.length / 2) | 0] : 0;
        });
      };
      // off — стадия выключена; on — целиком; 0.5/1.5/2.5/3.5 — по одному
      // блоку освещения; 4.5 — бюджет шагов 60; 5.5 — свет не считается для
      // сэмплов, дающих меньше 0.2% цвета.
      const SET = (v) => {
        window.__forceShow = v !== 'off';
        window.__blast.uniforms.u_perf = v === 'off' || v === 'on' ? 0 : Number(v);
      };
      const setups = (process.env.PERF_LIST || 'off,on,2.5,3.5,4.5,5.5').split(',');
      const rounds = Number(process.env.PERF_ROUNDS || 2);
      await place(CLOSE[0], 180);
      const acc = new Map(setups.map((v) => [v, []]));
      for (let r = 0; r < rounds; r += 1) {
        for (const v of setups) {
          const ms = await ONE(SET, v);
          acc.get(v).push(ms);
          console.log('PERFRAW', `r${r}`, v, ms);
        }
      }
      const base = acc.get('on');
      const med = (a) => [...a].sort((x, y) => x - y)[(a.length / 2) | 0];
      for (const v of setups) {
        const vals = acc.get(v);
        const ctx = await page.evaluate(() => [
          window.__kupol.viewer.resolutionScale, window.__blast.textureScale,
          window.__blast.uniforms.u_steps, window.__blast.uniforms.u_stepScale,
          window.__blast.enabled,
        ]);
        console.log('PERF', v, JSON.stringify({
          vals, med: med(vals), deltaVsOn: med(vals) - med(base), ctx,
        }));
      }
      // Доказательство, что переключатель вообще меняет картинку: два кадра
      // с включённой и выключенной стадией на одном и том же возрасте.
      await ONE(SET, 'off');
      await shot('perf_enabled_off');
      await ONE(SET, 'on');
      await shot('perf_enabled_on');
    } else {
      const fixed = process.env.FORCE_STEPS !== '0';
      await page.evaluate((n) => { window.__forceSteps = n; }, fixed ? 58 : 0);
      if (process.env.SKIP_FAR !== '1') await shot(`ab2_${tag}_far`);
      await page.evaluate((n) => { window.__forceSteps = n; }, fixed ? 132 : 0);
      await place(CLOSE[0], Number(process.env.NEAR_DEG || 180));
      // SKIP_AB=1: при FORCE_STEPS=0 этот кадр совпадает с обычным ближним, а
      // стоит он столько же, сколько вся остальная съёмка.
      // NEAR_OFF=1 — ближний кадр с выключенным объёмным проходом: остался
      // артефакт — он из сцены, пропал — из шейдера.
      // NEAR_SS=<число> — ближний кадр с другим шагом марша: соль, которая
      // уходит вместе с шагом, это нехватка сэмплов, а не характер шума.
      if (process.env.NEAR_OFF === '1') {
        await page.evaluate(() => { window.__forceShow = false; });
        await shot(`near_off_${tag}`);
        await page.evaluate(() => { window.__forceShow = true; });
      }
      if (process.env.NEAR_SS) {
        await page.evaluate((v) => { window.__pinStep = v; }, Number(process.env.NEAR_SS));
        await shot(`near_ss${process.env.NEAR_SS}_${tag}`);
        await page.evaluate(() => { window.__pinStep = 0; });
      }
      // CELESTIAL_PROBE=1 — кто именно рисует диск в небе. Кадры сняты с
      // полностью выключенным объёмным проходом, так что кандидат только из
      // сцены: sun и moon — астрономические спрайты Cesium, оба show=true
      // по умолчанию._case оставляет включённым названный объект.
      if (process.env.CELESTIAL_PROBE === '1') {
        await page.evaluate(() => { window.__forceShow = false; });
        for (const c of (process.env.PROBE_CASES || 'sun,moon,none').split(',')) {
          await page.evaluate((v) => {
            const s = window.__kupol.viewer.scene;
            if (s.sun) s.sun.show = v === 'sun';
            if (s.moon) s.moon.show = v === 'moon';
          }, c);
          await shot(`celest_${c}_${tag}`);
        }
        await page.evaluate(() => { window.__forceShow = true; });
      }
      if (process.env.SKIP_AB !== '1') await shot(`ab2_${tag}_near`);
      if (process.env.AB_STEPS === '1') {
        await page.evaluate(() => { window.__forceSteps = 132; });
        await shot(`ab2_${tag}_near_132`);
        await page.evaluate(() => { window.__forceSteps = 67; });
        await shot(`ab2_${tag}_near_67`);
      }
      if (process.env.SECOND !== '0') {
        await setSeed(7777);
        await page.evaluate((n) => { window.__forceSteps = n; }, fixed ? 58 : 0);
        await gameFrame();
        await shot(`ab2_${tag}_far_b`);
      }
    }
  }

  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('SWEEP DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
