// Сниматель с зафиксированной наводкой. Прежний скрипт наводил камеру
// setView'ом и ждал 2,5 с, а на этом железе кадр стоит ~5 с: за ожидание игра
// успевала увести камеру своей анимацией (замер 15.11: pitch -20,8° → -0,4°),
// и на снимок ложился ЧУЖОЙ кадр — облако оставалось за нижней кромкой. Здесь
// наводка вшита в preRender раньше слушателя взрыва, цикл отрисовки игры
// выключен, а кадр рисуется синхронно прямо перед снимком.
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const base = `http://127.0.0.1:${port}`;
const PROFILE = process.env.PROFILE || 'rds37';
const KT = Number(process.env.KT || 1600);
const CITY = process.env.CITY || 'London';
const AGES = (process.env.AGES || '20,60,110').split(',').map(Number);
const DAMAGE = process.env.DAMAGE === '1';
const OUT = process.env.OUT || `D:/mt5/tmp-nuclear/shots/aim-${PROFILE}`;
const AB = process.env.AB || '';
// NOENT=1 — снять кадр вообще без сущностей: остаётся только то, что рисует
// объёмный проход и подложка. Так проверяют, чей именно пунктир лежит на земле.
const NOENT = process.env.NOENT === '1';
// PICK=1 — после первого снимка спросить scene.pick в точках дефекта и напечатать,
// какая именно сущность легла в эти пиксели.
const PICK = process.env.PICK === '1';
const GATE = process.env.GATE || '';
let gateDone = false;
let pickDone = false;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITIES = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
const [LAT, LON] = CITIES[CITY] ?? CITIES.London;

const data = JSON.parse(await import('node:fs/promises')
  .then(({ readFile }) => readFile(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8')));
const bomb = data.bombs.find((b) => b.id === PROFILE);
if (!bomb) throw new Error(`профиля ${PROFILE} нет в каталоге`);
const zones = zonesForBomb(bomb, KT);
const shapeAt = (s) => blastShapeAt(bomb, zones, KT, s);
// Рамка по ВЕРХУ облака, а не по центру шляпы и не по bound.y: bound.y — это
// половина живой высоты (nuclearVolumetrics.js:485 `y: liveTop * 0.5`), а
// cloudTop из справочника (20 км у РДС-37) анимация за tFull не доезжает, и с
// таким запасом глаз отъезжал вдвое: гриб занимал четверть кадра, а кольца по
// 40–70 м выходили меньше пикселя (замер 15.11, кадры rds37_s71/s104).
// ZOOM и AIMK — множители рамки: 2.3/0.5 дают весь гриб, 0.5/0.35 — крупный
// план на кольцо или линзу, иначе их глаз не может оценить вообще.
// Рамка = габарит снимаемой детали, а не доля высоты облака. Множители
// ZOOM/AIMK давали шляпу за кромкой кадра (cu-rings 15.11: y=-61..-151 при
// экране 540 px) и заводили глаз ВНУТРЬ ограничивающей сферы марша — кадр
// превращался в кашу. Теперь: центр детали в центр кадра, дистанция
// ZOOM·Rfit (при 2,4 сфера гарантированно снаружи, половинный угол веера 30°),
// глаз на EYEK·Rfit выше центра — деталь с землёй в одном кадре.
const ZOOM = Number(process.env.ZOOM || 2.4);
const EYEK = Number(process.env.EYEK || 0.3);
const FIT = process.env.FIT || 'cloud';
const t0 = shapeAt(0).timing;
const fitBox = (st) => {
  const live = (st.rings ?? []).filter((q) => q[3] > 0.01);
  if (FIT === 'rings' && live.length) {
    return { y0: Math.min(...live.map((q) => q[0] - q[2] - q[1] * 0.2)),
      y1: Math.max(...live.map((q) => q[0] + q[2] + q[1] * 0.2)),
      r: Math.max(...live.map((q) => q[1] + q[2])) };
  }
  if (FIT === 'ice2' && st.ice2 && st.ice2[3] > 0.01) {
    return { y0: st.ice2[0] - st.ice2[2], y1: st.ice2[0] + st.ice2[2], r: st.ice2[1] + st.ice2[2] };
  }
  if (FIT === 'ice' && st.ice && st.ice[3] > 0.01) {
    return { y0: st.ice[0] - st.ice[2], y1: st.ice[0] + st.ice[2], r: st.ice[1] + st.ice[2] };
  }
  if (FIT === 'head' && st.head && st.head.r > 0) {
    return { y0: st.head.y - st.head.halfH, y1: st.head.y + st.head.halfH, r: st.head.r };
  }
  if (FIT === 'dome' && st.dome && st.dome[1] > 0) {
    return { y0: 0, y1: st.dome[1], r: st.dome[0] };
  }
  return { y0: 0, y1: Math.max(st.bound.y * 2, (st.head?.y ?? 0) + (st.head?.r ?? 0)),
    r: Math.max(st.bound.r, st.head?.r ?? 0) };
};
const frame = (age) => {
  const st = shapeAt(Math.min(Math.max(age, 0), t0.tFull));
  const b = fitBox(st);
  const c = (b.y0 + b.y1) / 2;
  const rf = Math.max(60, Math.hypot(b.r, (b.y1 - b.y0) * 0.5));
  return { fit: FIT, y0: Math.round(b.y0), y1: Math.round(b.y1), r: Math.round(b.r),
    aimY: Math.round(c), dist: Math.round(rf * ZOOM),
    eyeAlt: Math.round(Math.max(120, c + rf * EYEK)), rfit: Math.round(rf) };
};
const rate = Math.min(8, Math.max(t0.tFull / 150, (t0.tHead1 ?? 0) / 3, 1));
const life = Math.min(200, Math.max(40, t0.tFull / rate));
console.log(`${PROFILE} @ ${KT} кт, ${CITY}: облако ${t0.cloudTop.toFixed(0)} м, tFull ${t0.tFull.toFixed(0)} с; окно показа ${life.toFixed(0)} реальных с при rate=${rate.toFixed(2)}; рамка ${AGES.map((a) => `${a}с→${JSON.stringify(frame(a))}`).join(' ')}`);

const browser = await puppeteer.launch({
  userDataDir: `D:/mt5/tmp-nuclear/chrome-aim-${PROFILE}`,
  headless: 'new', protocolTimeout: 1800000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
const frames = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 140)); });
  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForFunction(() => window.__kupol?.viewer, { timeout: 120000 });

  await page.evaluate((lat, lon) => {
    const Cesium = window.Cesium;
    const v = window.__kupol.viewer;
    // Рамка пересчитывается на каждый кадр: гриб за tFull вырастает в разы, а
    // кольца и линзы живут на своей высоте. Один фиксированный глаз либо глотает
    // деталь, либо теряет облако.
    window.__geo = { lat, lon };
    window.__aim = (aimY, dist, eyeAlt) => {
      const enu = Cesium.Matrix4.inverseTransformation(
        Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat, aimY)), new Cesium.Matrix4());
      const eye = Cesium.Cartesian3.fromDegrees(
        lon + dist / (111_320 * Math.cos(lat * Math.PI / 180)) * Math.SQRT1_2,
        lat + dist / 111_320 * Math.SQRT1_2, eyeAlt);
      const p = Cesium.Matrix4.multiplyByPoint(enu, eye, new Cesium.Cartesian3());
      const o = {
        heading: Math.atan2(-p.x, -p.y),
        pitch: Math.atan2(-p.z, Math.hypot(p.x, p.y)),
        roll: 0,
      };
      window.__eye = eye;
      window.__o = o;
      // Наводка вшивается в preRender ДО слушателя взрыва: слушатель по своему
      // состоянию камеры решает, включать ли марш, и обязан видеть уже
      // наведённую камеру.
      v.camera.cancelFlight();
      v.camera.setView({ destination: eye, orientation: o });
      return { pitch: Math.round(o.pitch * 572957795) / 572957795, heading: Math.round(o.heading * 572957795) / 572957795 };
    };
    window.__lock = () => {
      if (!window.__eye) return;
      v.camera.cancelFlight();
      v.camera.setView({ destination: window.__eye, orientation: window.__o });
    };
    v.scene.preRender.addEventListener(window.__lock);
    v.useDefaultRenderLoop = false;
    window.__blastStage = () => {
      const col = v.scene.postProcessStages;
      for (let i = 0; i < col.length; i += 1) { const s = col.get(i); if (s && String(s.name).indexOf('kupol-blast') === 0) return s; }
      return null;
    };
  }, LAT, LON);
  const f0 = frame(Math.min(AGES[0], t0.tFull));
  const aim0 = await page.evaluate(([aimY, dist, eyeAlt]) => window.__aim(aimY, dist, eyeAlt), [f0.aimY, f0.dist, f0.eyeAlt]);
  console.log(`шаг: наводка зафиксирована (цель ${f0.aimY} м, глаз ${f0.dist} м на ${f0.eyeAlt} м, pitch ${aim0.pitch.toFixed(1)}°), цикл отрисовки игры выключен`);

  // Тайлы подложки приходят асинхронно, а один синхронный render их не ждёт.
  // Хуже: кадр с объёмным маршем стоит 8–12 с, поэтому цикл ожидания делал
  // 6–7 кадров и рассылал 6–7 запросов — земля оставалась белой (baseColor
  // глобуса), и «карта не спутниковая» было обвинением в адрес съёмки. На
  // время ожидания марш глушим через stage.enabled (замер #31: show у
  // пост-процесса ничего не выключает): кадр падает до долей секунды.
  // Разогрев стоит ДО запуска показа: layers.js снимает объёмный проход
  // wall-clock таймером showMs (у наших профилей 41 реальная с), виртуальные
  // часы его не видят, и 50–70 с ожидания тайлов съедали показ целиком
  // (rings5/dome4: «стадия удалена, кадра нет» ещё до первого кадра).
  const settle = async (maxMs = 40000) => {
    const t0 = Date.now();
    const was = await page.evaluate(() => {
      const col = window.__kupol.viewer.scene.postProcessStages;
      for (let i = 0; i < col.length; i += 1) {
        const s = col.get(i);
        if (s && String(s.name).indexOf('kupol-blast') === 0) { const on = s.enabled; s.enabled = false; return on; }
      }
      return null;
    });
    let done = false;
    while (!done && Date.now() - t0 < maxMs) {
      done = await page.evaluate(() => {
        const v = window.__kupol.viewer;
        v.render();
        return v.scene.globe.tilesLoaded === true;
      });
      if (!done) await sleep(120);
    }
    if (was !== null) await page.evaluate((on) => {
      const col = window.__kupol.viewer.scene.postProcessStages;
      for (let i = 0; i < col.length; i += 1) {
        const s = col.get(i);
        if (s && String(s.name).indexOf('kupol-blast') === 0) { s.enabled = on; return; }
      }
    }, was);
    return { done, ms: Date.now() - t0 };
  };
  const warm = await settle(90000);
  console.log(`подложка разогрета до запуска: ${warm.done ? 'дождалась' : 'не дождалась'} за ${warm.ms} мс`);

  // Wall-clock таймер показа растягиваем: полоса 15–60 с — это только showMs
  // (игровые таймеры короче, guard settleFrames = 120 с длиннее полосы).
  await page.evaluate(() => {
    const realST = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => realST(fn, ms >= 15000 && ms <= 60000 ? ms * 100 : ms, ...args);
  });

  // Удар запускаем БЕЗ ожидания промиса и КАДРИМ страницу во время ожидания.
  // Причина зависания 15.11 (London@300 кт, 0 кадров, «callFunctionOn timed
  // out») — не цена примитивов, а тупик самой съёмки: этот стенд выключает
  // цикл отрисовки игры, а снос стоит на двух вещах, которым нужны кадры —
  // sampleHeightMostDetailed (рельеф читается внутри globe.update, то есть
  // внутри render) и settleFrames (ждёт scene.postRender). Замер: 25 с тишины
  // при нулевом приросте CPU = поток не считает, а ждёт. Значит опрос обязан
  // рисовать по кадру за итерацию.
  await page.evaluate((lat, lon, kt, profile, city, damage) => {
    document.getElementById('kupol-root')?.style.setProperty('display', 'none');
    window.__shotErr = null;
    window.__shotDone = false;
    window.__kupol.layers.playNuclearTest({ lat, lon }, kt / 1000, { profileId: profile, cityName: city, damage })
      .then(() => { window.__shotDone = true; })
      .catch((e) => { window.__shotErr = String(e?.message ?? e); window.__shotDone = true; });
  }, LAT, LON, KT, PROFILE, CITY, DAMAGE);

  const probe = () => {
    const v = window.__kupol.viewer;
    // requestRender обязателен: renderGovernor игры переводит сцену в
    // requestRenderMode, и тогда scene.render() проходит мимо shouldRender,
    // то есть не поднимает postRender — settleFrames ждал бы своего guard-а.
    v.scene.requestRender();
    v.render();
    let dmg = -1;
    for (let i = 0; i < v.dataSources.length; i += 1) {
      const s = v.dataSources.get(i);
      if (String(s.name) === 'nuclear-city-damage') dmg = s.entities.values.length;
    }
    return { dmg, blast: !!window.__blastStage(), err: window.__shotErr, done: !!window.__shotDone };
  };
  const waitStart = Date.now();
  let last = null;
  let painted = 0;
  let stalled = 0;
  while (Date.now() - waitStart < 3600000) {
    let p = null;
    const tFrame = Date.now();
    try {
      p = await page.evaluate(probe);
      painted += 1;
    } catch {
      // Кадр встал дольше protocolTimeout: состояние не потерянно, ждём дальше.
      stalled += 1;
      console.log(`шаг: +${((Date.now() - waitStart) / 1000).toFixed(0)} с — кадр не ответил (срывов ${stalled})`);
      continue;
    }
    const ms = Date.now() - tFrame;
    if (ms > 5000 || p.dmg !== last?.dmg) {
      console.log(`шаг: +${((Date.now() - waitStart) / 1000).toFixed(0)} с кадр ${ms} мс — снесено ${p.dmg}, марш ${p.blast ? 'есть' : 'нет'}`);
    }
    last = p;
    if (p.err) throw new Error(`удар не дошёл до марша: ${p.err}`);
    if (p.blast) break;
  }
  if (!last?.blast) throw new Error('марш так и не появился (час ожидания)');
  console.log(`шаг: объёмный проход появился через ${((Date.now() - waitStart) / 1000).toFixed(0)} с и ${painted} кадров после запуска`);

  // Виртуальные часы. Модуль берёт возраст как (performance.now() − старт), а
  // кадр на этой машине стоит 3–4 с: при rate=7,33 окна колец (s=2..14 для
  // РДС-37) длят меньше двух реальных секунд и съедаются сборкой примитивов —
  // замер cu-rings: первый кадр 25 реальных с = возраст 88,5 с, колец уже нет.
  // Подмена часов даёт кадр ровно с тем возрастом, под который посчитана рамка.
  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    // Морозим сразу: десятки кадров разогрева подложки ниже на настоящих часах
    // перелистнули бы показ за пределы окон деталей, как в strike33.
    window.__vclock = true;
    window.__vnow = real();
    performance.now = () => (window.__vclock ? window.__vnow : real());
    window.__setAge = (a, rate) => {
      const s = window.__blastStage();
      if (!s) return null;
      const cur = s.uniforms.u_age;
      if (!window.__vclock) { window.__vclock = true; window.__vnow = real(); }
      window.__vnow += ((a - cur) / rate) * 1000;
      return cur;
    };
  });

  if (NOENT) {    await page.evaluate(() => {
      const v = window.__kupol.viewer;
      v.entities.show = false;
      for (let i = 0; i < v.dataSources.length; i += 1) v.dataSources.get(i).show = false;
    });
    console.log('шаг: все коллекции сущностей скрыты (NOENT)');
  }
  // Бисекция по виду графики: гасим ТОЛЬКО эллипсы или ТОЛЬКО точки, на уровне
  // самих graphics — так видно, чей пунктир лежит на земле, когда перепись
  // говорит «show=false», а пиксели спорят.
  if (process.env.HIDE === 'ellipse' || process.env.HIDE === 'point') {
    const kind = process.env.HIDE;
    const n = await page.evaluate(([k]) => {
      const v = window.__kupol.viewer;
      let count = 0;
      const walk = (coll) => {
        for (const e of coll.values) {
          if (!e[k]) continue;
          e[k].show = new window.Cesium.ConstantProperty(false);
          count += 1;
        }
      };
      for (let i = 0; i < v.dataSources.length; i += 1) walk(v.dataSources.get(i).entities);
      walk(v.entities);
      return count;
    }, [kind]);
    console.log(`шаг: ${kind} выключен на graphics (${n} шт.)`);
  }
  const startedAt = Date.now();
  for (const target of AGES) {
    const before = await page.evaluate(([a, rate]) => window.__setAge(a, rate), [target, rate]);
    if (before === null) { console.log(`показ окончен на ${((Date.now() - startedAt) / 1000).toFixed(0)} реальных с — стадия удалена, кадра нет`); break; }
    const f = frame(target);
    // Наводимся ДО ожидания тайлов: settle грузит снимок под текущей камерой,
    // а кадр берётся под новой — если менять порядок, земля не успевает.
    await page.evaluate(([aimY, dist, eyeAlt]) => window.__aim(aimY, dist, eyeAlt), [f.aimY, f.dist, f.eyeAlt]);
    const tiles = await settle();
    const info = await page.evaluate(([f]) => {
      const Cesium = window.Cesium;
      const v = window.__kupol.viewer;
      const s = window.__blastStage();
      window.__aim(f.aimY, f.dist, f.eyeAlt);
      v.render();
      const u = s.uniforms;
      const r1 = (x) => Math.round(Number(x) * 10) / 10;
      const scr = v.scene.cartesianToCanvasCoordinates(
        Cesium.Cartesian3.fromDegrees(window.__geo.lon, window.__geo.lat, u.u_head.y), new Cesium.Cartesian2());
      // Габарит детали в пикселях: «onScreen=true» ничего не значит, пока не
      // видно, что верх и низ снимаемого предмета лежат внутри кадра.
      const px = (h) => {
        const q = v.scene.cartesianToCanvasCoordinates(
          Cesium.Cartesian3.fromDegrees(window.__geo.lon, window.__geo.lat, h), new Cesium.Cartesian2());
        return q ? Math.round(q.y) : null;
      };
      const box = [px(f.y0), px(f.y1)];
      // Сколько пикселей даёт самая живая деталь: глаз не скажет «колец нет»,
      // если они в 0,4 px — сначала надо увидеть, что они вообще могли бы.
      const pxm = v.canvas.clientHeight / (2 * Math.tan((v.camera.frustum.fovy ?? Cesium.Math.toRadians(60)) / 2));
      const feats = [
        ['ring0', u.u_ring0], ['ring1', u.u_ring1], ['ring2', u.u_ring2], ['ring3', u.u_ring3],
        ['ice', u.u_ice], ['ice2', u.u_ice2],
      ].map(([name, q]) => {
        if (!(q.w > 0.01)) return null;
        const d = Cesium.Cartesian3.distance(v.camera.positionWC,
          Cesium.Cartesian3.fromDegrees(window.__geo.lon, window.__geo.lat, q.x));
        // Шейдер у колец берёт полутолщину с потолком max(th, y*0.012)
        // (nuclearVolumetrics.js:1136), поэтому и оценка в пикселях должна с ним.
        const th = Math.max(q.z, q.x * 0.012);
        return { name, op: r1(q.w), km: Math.round(d / 100) / 10, px: Math.round(2 * th * pxm / d * 10) / 10 };
      }).filter(Boolean);
      return {
        age: r1(u.u_age), enabled: s.enabled, step: r1(u.u_stepScale),
        tex: r1(s._textureScale ?? 1), boundY: Math.round(u.u_bound.y),
        headY: Math.round(u.u_head.y), headR: Math.round(u.u_head.w),
        live: feats,
        dome: [u.u_dome.x, u.u_dome.y, u.u_dome.z, u.u_dome.w].map(r1),
        ice: [u.u_ice.x, u.u_ice.y, u.u_ice.z, u.u_ice.w].map(r1),
        ice2: [u.u_ice2.x, u.u_ice2.y, u.u_ice2.z, u.u_ice2.w].map(r1),
        ring3: [u.u_ring3.x, u.u_ring3.y, u.u_ring3.z, u.u_ring3.w].map(r1),
        headOnScreen: scr ? { x: Math.round(scr.x), y: Math.round(scr.y) } : null,
        boxPx: box, screen: [v.canvas.clientWidth, v.canvas.clientHeight],
        pitch: r1(v.camera.pitch * 57.2958),
      };
    }, [f]);
    const file0 = `${OUT}/${PROFILE}_s${String(target).replace('.', '_')}`;
    // A/B по временной униформе u_ab: один загруз страницы, один возраст,
    // несколько значений рычага. Разные загрузки дали бы разные тайлы и разный
    // разогрев кэша, и сравнивать было бы нечего.
    const variants = AB ? AB.split(';').map((s) => s.split(':').map(Number)) : [null];
    const files = [];
    for (const ab of variants) {
      const file = `${file0}${ab ? `_ab${ab[0]}x${ab[1]}` : ''}.png`;
      if (ab) {
        await page.evaluate(([x, y]) => {
          const s = window.__blastStage();
          s.uniforms.u_ab = new window.Cesium.Cartesian2(x, y);
          window.__kupol.viewer.render();
        }, ab);
      }
      // GATE=remove|show|const|color — какой механизм реально гасит эллипс в
      // этой сборке Cesium: CallbackProperty на show графики, как оказалось, не
      // гасит, и надо замером выбрать тот, который гасит.
      if (GATE && !gateDone) {
        gateDone = true;
        const n = await page.evaluate((mech) => {
          const v = window.__kupol.viewer;
          const Cesium = window.Cesium;
          const colls = [v.entities];
          for (let i = 0; i < v.dataSources.length; i += 1) colls.push(v.dataSources.get(i).entities);
          const ell = [];
          for (const c of colls) for (const e of c.values) if (e.ellipse) ell.push(e);
          if (mech === 'remove') for (const c of colls) for (const e of ell) c.remove(e);
          else if (mech === 'show') for (const e of ell) e.show = false;
          else if (mech === 'const') for (const e of ell) e.ellipse.show = new Cesium.ConstantProperty(false);
          else if (mech === 'color') {
            for (const e of ell) {
              e.ellipse.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
              if (e.ellipse.outline) e.ellipse.outlineColor = new Cesium.ConstantProperty(Cesium.Color.TRANSPARENT);
            }
          }
          v.render();
          return ell.length;
        }, GATE);
        console.log(`шаг: GATE=${GATE} — эллипсов ${n}`);
      }
      await page.screenshot({ path: file });
      if (PICK && !pickDone) {
        pickDone = true;
        const hits = await page.evaluate(() => {
          const v = window.__kupol.viewer;
          const Cesium = window.Cesium;
          const t = v.clock.currentTime;
          const val = (p) => (p && typeof p.getValue === 'function' ? p.getValue(t) : p);
          const out = [];
          for (const [x, y] of [[480, 392], [480, 420], [430, 392], [480, 150], [480, 185], [480, 265], [480, 300]]) {
            const r = v.scene.pick(new Cesium.Cartesian2(x, y));
            const e = r?.id;
            let s = `${x},${y} → ${e ? (e.name || 'сущность') : r ? `примитив ${String(r.primitive?.constructor?.name)}` : 'ничего'}`;
            if (e?.ellipse) {
              s += ` ellipse major=${(Number(val(e.ellipse.semiMajorAxis)) / 1000).toFixed(1)} км outline=${val(e.ellipse.outline)} show=${val(e.show)} материал=${JSON.stringify(val(e.ellipse.material)?.color?.getValue ? null : val(e.ellipse.material)?.alpha ?? null)}`;
            }
            if (e?.point) s += ` point ${Number(val(e.point.pixelSize)).toFixed(1)} px`;
            if (e?.model) s += ' model';
            out.push(s);
          }
          // Перепись ВСЕХ графических сущностей по видам: эллипсов может и не
          // быть, а серый диск с рваным краем обязан чем-то рисоваться.
          const kinds = {};
          const near = [];
          const push = (coll, dsName, dsShow) => {
            for (const e of coll.values) {
              for (const k of ['ellipse', 'polygon', 'rectangle', 'box', 'model', 'point', 'polyline', 'label', 'billboard']) {
                if (!e[k]) continue;
                kinds[k] = (kinds[k] || 0) + 1;
                const p = val(e.position);
                const c = p ? Cesium.Cartographic.fromCartesian(p) : null;
                if (c && Math.abs(Cesium.Math.toDegrees(c.latitude) - window.__geo.lat) < 0.4
                  && Math.abs(Cesium.Math.toDegrees(c.longitude) - window.__geo.lon) < 0.4
                  && near.length < 14) {
                  near.push(`${k}/${dsName}/${e.name || e.id || '?'} show=${val(e.show)} ds=${dsShow}`);
                }
              }
            }
          };
          for (let i = 0; i < v.dataSources.length; i += 1) {
            const ds = v.dataSources.get(i);
            push(ds.entities, ds.name || `ds${i}`, ds.show);
          }
          push(v.entities, 'viewer', v.entities.show);
          out.push(`ВИДЫ: ${JSON.stringify(kinds)}`);
          out.push(`У ЦЕЛИ: ${near.join(' , ')}`);
          const il = [];
          for (let i = 0; i < v.scene.imageryLayers.length; i += 1) {
            const l = v.scene.imageryLayers.get(i);
            il.push(`${l.imageryProvider?.constructor?.name} show=${l.show} α=${Math.round(l.alpha * 100) / 100}`);
          }
          out.push(`СЛОИ: ${il.join(' | ')} SSE=${v.scene.globe.maximumScreenSpaceError} загрузка=${v.scene.globe.tilesLoaded}`);
          // ГЕЙТ: читаем show самой графики (не сущности) — именно он должен
          // лгать знакам, пока марш рисует.
          const gate = [];
          const dump = (coll) => {
            for (const e of coll.values) {
              if (!e.ellipse) continue;
              const m = val(e.ellipse.material);
              const mc = m?.color?.getValue ? val(m.color) : m;
              const cg = val(e.position);
              const cgeo = cg ? Cesium.Cartographic.fromCartesian(cg) : null;
              gate.push(`${(e.name || e.id || '?').slice(0, 8)} show=${val(e.ellipse.show)} r=${(Number(val(e.ellipse.semiMajorAxis)) / 1000).toFixed(2)}км выс=${Math.round(Number(val(e.ellipse.height)) * 10) / 10} контур=${val(e.ellipse.outline)} цв=${mc?.toCssColorString?.() ?? "?"} шир=${cgeo ? Cesium.Math.toDegrees(cgeo.latitude).toFixed(3) : "?"}`);
            }
          };
          for (let i = 0; i < v.dataSources.length; i += 1) dump(v.dataSources.get(i).entities);
          dump(v.entities);
          out.push(`ГЕЙТ: ${gate.join(' , ')} | марш=${window.__blastStage?.()?.enabled}`);
          return out;
        });
        console.log(`ПИК ${target} с: ${hits.join(' || ')}`);
      }
      files.push(file);
    }
    const file = files[0];
    const want = shapeAt(info.age);
    const ok = Math.abs(info.boundY - Math.round(want.bound.y)) < Math.max(50, want.bound.y * 0.02);
    frames.push({ info, file, ok, frame: f });
    const [bx0, bx1] = info.boxPx;
    const fits = bx0 !== null && bx1 !== null
      && Math.min(bx0, bx1) >= -20 && Math.max(bx0, bx1) <= info.screen[1] + 20;
    console.log(`возраст ${info.age} с (${((Date.now() - startedAt) / 1000).toFixed(0)} реальных): тайлы ${tiles.done ? 'е' : 'НЕТ'}/${tiles.ms}мс enabled=${info.enabled} step=${info.step} tex=${info.tex} boundY=${info.boundY} head=${info.headY}+${info.headR} dome=${info.dome} ice2=${info.ice2} ring3=${info.ring3} рамка=${JSON.stringify(f)} живое=${info.live.map((x) => `${x.name}@${x.km}км op${x.op} ${x.px}px`).join(' ')||'ничего'} габарит ${bx0}..${bx1} px из ${info.screen[1]} → ${fits ? 'В КАДРЕ' : 'ВЫЛЕТЕЛ'} шляпа=${JSON.stringify(info.headOnScreen)} pitch=${info.pitch} модель=${ok ? 'сходится' : 'РАСХОЖДЕНИЕ'} → ${file}`);
  }
} catch (e) {
  console.log(`FATAL ${e.message}`);
} finally {
  console.log(`errors ${JSON.stringify(errs.slice(0, 6))}`);
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ PROFILE, KT, CITY, AGES, frames, errs }, null, 1));
  await browser.close();
}
