// Живая проверка #37: удар партии должен нести МОЩНОСТЬ, а не профиль по
// умолчанию. Берём настоящий снимок клиента, добавляем в него запись удара ровно
// той формы, которую отдаёт nuclearView, прогоняем через те же слои (layers.update
// → syncStrikes → animateStrike) и сверяем униформы марша с чистой blastShapeAt
// для двух кандидатов: ivy_king@150 кт (ближайший воздушный замер) и
// rds37@1600 кт (прежний профиль по умолчанию). Совпадение с первым и расхождение
// со вторым = мощность доехала до клиента.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb, nearestAirBurstProfile } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const base = `http://127.0.0.1:${port}`;
const KT = Number(process.env.KT || 150);
// Координаты пяти городов God's Eye View (тот же каталог, что и на полигоне).
const CITIES = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
const TARGET_NAME = process.env.CITY || 'London';
const [TARGET_LAT, TARGET_LON] = CITIES[TARGET_NAME] ?? CITIES.London;
const AGES = (process.env.AGES || '20,45,70').split(',').map(Number);
const PIN = process.env.PIN === '1';
const TILT = Number(process.env.TILT || 0);
// Рамка: множители высоты облака. 2,3/0,5 = гриб ~38% кадра и город внизу;
// 1,8/0,5 = гриб ~260 из 540 px при земле всё ещё в 15° под осью. Оценка
// 15.11: при 2,3 шапка-пилеус у 150 кт выходила 8 px — на глаз не читалась.
const ZOOM = Number(process.env.ZOOM || 2.4);
const AIMK = Number(process.env.AIMK || 0.5);
const EYEK = Number(process.env.EYEK || 0.3);
const outDir = process.env.OUT || 'D:/mt5/tmp-nuclear/shots/strike1';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const data = JSON.parse(readFileSync(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8'));
const bombs = data.bombs;
const pick = nearestAirBurstProfile(bombs, KT);
const byId = (id) => bombs.find((b) => b.id === id);
console.log(`KT=${KT} ближайший воздушный замер: ${pick?.id} (${pick?.yield_kt} кт), профиль по умолчанию: rds37 (1600 кт)`);
const ZONES = zonesForBomb(pick, KT);
const TFULL0 = blastShapeAt(pick, ZONES, KT, 0).timing;
const TFULL = TFULL0.tFull;
// Тот же рычаг скорости, что внутри модуля (nuclearVolumetrics.js:1512): без
// него виртуальные часы сдвигали бы возраст не на те секунды, что мы просим.
const RATE = Math.min(8, Math.max(TFULL0.tFull / 150, (TFULL0.tHead1 ?? 0) / 3, 1));
console.log(`гриб живёт ${TFULL.toFixed(0)} модельных с (у прежнего rds37 — 220 с), вершина облака ${TFULL0.cloudTop.toFixed(0)} м, rate=${RATE.toFixed(2)}`);

/** Что должна дать чистая модель на этом возрасте. */
const expected = (bomb, kt, age) => {
  const st = blastShapeAt(bomb, zonesForBomb(bomb, kt), kt, age);
  const r3 = (v) => Math.round(Number(v) * 10) / 10;
  return {
    boundY: r3(st.bound.y),
    headR: st.head.density > 0.002 ? r3(st.head.r) : 0,
    ice: st.ice.map(r3),
    ice2: st.ice2.map(r3),
    ring0: st.rings[0].map(r3),
    ring3: st.rings[3].map(r3),
  };
};

// Рамка считается по геометрии конкретного возраста, а не задаётся числом.
// Замер strike27 (15.11): глаз в 18 км с целью на земле смотрел на ножку —
// шляпа после потолка диаметра легла ВЫШЕ верхней кромки кадра.
// Верх облака = 2·bound.y: в модели bound.y — половина живой высоты
// (nuclearVolumetrics.js:485 `y: liveTop * 0.5`), поэтому взять его целиком
// значит отодвинуть камеру вдвое и получить гриб в четверть кадра.
// Цель — середина облака, глаз в 2,3 высоты: облако тянется от оси на ±0,5H
// ≈ 12° при вертикальном полуугле 30°, то есть гриб вместе с землёй в кадре.
const frameFor = (age) => {
  const st = blastShapeAt(pick, ZONES, KT, Math.min(age, TFULL));
  const y1 = Math.max(st.bound.y * 2, (st.head?.y ?? 0) + (st.head?.r ?? 0));
  const rf = Math.max(60, Math.hypot(Math.max(st.bound.r, st.head?.r ?? 0), y1 * 0.5));
  const c = Math.round(y1 * AIMK);
  return { fit: 'cloud', y0: 0, y1: Math.round(y1), rfit: Math.round(rf),
    aimY: c, dist: Math.round(rf * ZOOM), eyeAlt: Math.round(Math.max(200, c + rf * EYEK)) };
};
console.log(`рамка: возраст ${AGES.join('/')} → ${AGES.map((a) => JSON.stringify(frameFor(a))).join(' ')}`);

const browser = await puppeteer.launch({
  userDataDir: process.env.PPDIR || 'D:/mt5/tmp-nuclear/chrome-strike',
  headless: 'new', protocolTimeout: 1800000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const errs = [];
const rows = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text()}`.slice(0, 140)); });

  await page.goto(`${base}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForFunction(() => window.__kupol?.state?.nuclear, { timeout: 120000 });
  console.log('шаг: партия идёт, снимок получен');

  // Клетку под Лондоном берём тем же пиком, которым пользуется сама игра, но
  // только ветку «земля»: в kind:'cell' position → geometry.nearest. Прошлые
  // прогоны брали первый попавшийся hit.cell, а под курсором на 1500 км сто
  // стоит собственный город/полк игрока (он в Северной Америке), и его meta.cell
  // уносил камеру на другой континент — замеренный сдвиг был 6052 км.
  // Стартовое «flyToCell(home, 3.5 с» перетягивает камеру каждый кадр, пока
  // твин не кончится: замер показал, что setView над Лондоном съедался полётом
  // к своему городу (كامера ушла на 22°N 98°W → 47°N 99°W). Поэтому сначала
  // cancelFlight, потом setView, и проверяем, что глаз действительно там.
  await page.evaluate(() => {
    window.__setView = (lon, lat, height, pitchDeg) => {
      const v = window.__kupol.viewer; const C = window.Cesium;
      v.camera.cancelFlight();
      v.camera.setView({
        destination: C.Cartesian3.fromDegrees(lon, lat, height),
        orientation: { heading: 0, pitch: C.Math.toRadians(pitchDeg), roll: 0 },
      });
      v.render();
      const c = v.camera.positionCartographic;
      return { lat: C.Math.toDegrees(c.latitude), lon: C.Math.toDegrees(c.longitude), height: c.height };
    };
    window.__groundAt = (dx, dy) => {
      const v = window.__kupol.viewer; const C = window.Cesium;
      const screen = { x: Math.round(v.canvas.clientWidth / 2) + dx, y: Math.round(v.canvas.clientHeight / 2) + dy };
      let cart = v.scene.pickPositionSupported ? v.scene.pickPosition(screen) : undefined;
      if (!C.defined(cart)) cart = v.camera.pickEllipsoid(screen, v.scene.globe.ellipsoid);
      if (!C.defined(cart)) return null;
      const cg = C.Cartographic.fromCartesian(cart);
      return { lat: C.Math.toDegrees(cg.latitude), lon: C.Math.toDegrees(cg.longitude) };
    };
    // Наводка считается по геометрии, а не задаётся числом. Замер strike27
    // (15.11): глаз в 18 км с целью на земле — оптика смотрит на ножку, а шляпа
    // после потолка диаметра легла выше верхней кромки кадра. Цель — середина
    // облака (aimY), глаз в dist на северо-востоке и на высоте 0,75·dist: тогда
    // облако протянуто от оси на ±0,5H ≈ 12° при вертикальном полуугле 30°.
    window.__aimBlast = (aimY, dist, biasDeg, eyeAlt) => {
      const v = window.__kupol.viewer; const C = window.Cesium;
      const { lon, lat } = window.__blastPos;
      const origin = C.Cartesian3.fromDegrees(lon, lat, 0);
      const eye = C.Cartesian3.fromDegrees(
        lon + dist / (111320 * Math.cos((lat * Math.PI) / 180)) * Math.SQRT1_2,
        lat + (dist / 111320) * Math.SQRT1_2,
        eyeAlt ?? dist * 0.75,
      );
      const aim = C.Cartesian3.fromDegrees(lon, lat, aimY);
      const enu = C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(origin), new C.Matrix4());
      const p = C.Matrix4.multiplyByPoint(enu, eye, new C.Cartesian3()); // восток, север, вверх
      const q = C.Matrix4.multiplyByPoint(enu, aim, new C.Cartesian3());
      const horiz = Math.hypot(p.x - q.x, p.y - q.y);
      const heading = Math.atan2(-(p.x - q.x), -(p.y - q.y));
      const pitch = Math.atan2(-(p.z - q.z), horiz) + C.Math.toRadians(biasDeg);
      v.camera.cancelFlight();
      v.camera.setView({ destination: eye, orientation: { heading, pitch, roll: 0 } });
      const c = v.camera.positionCartographic;
      return {
        alt: v.camera.positionCartographic.height,
        headingDeg: Math.round(C.Math.toDegrees(heading) * 10) / 10,
        pitchDeg: Math.round(C.Math.toDegrees(pitch) * 10) / 10,
        distKm: Math.round(C.Cartesian3.distance(eye, origin) / 100) / 10,
        camLat: Math.round(C.Math.toDegrees(c.latitude) * 1000) / 1000,
        camLon: Math.round(C.Math.toDegrees(c.longitude) * 1000) / 1000,
      };
    };
  });

  const picked = await page.evaluate((lat, lon) => {
    const around = [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]];
    for (const [dx, dy] of around) {
      const cam = window.__setView(lon, lat, 1.5e6, -90);
      if (Math.abs(cam.lat - lat) > 0.5 || Math.abs(cam.lon - lon) > 0.5) continue;
      const hit = window.__kupol.layers.pick({
        x: Math.round(window.__kupol.viewer.canvas.clientWidth / 2) + dx,
        y: Math.round(window.__kupol.viewer.canvas.clientHeight / 2) + dy,
      });
      if (hit?.kind !== 'cell' || !Number.isInteger(hit.cell)) continue;
      const g = window.__groundAt(dx, dy);
      if (!g) continue;
      return { cell: hit.cell, dx, dy, lat: g.lat, lon: g.lon };
    }
    return null;
  }, TARGET_LAT, TARGET_LON);
  if (!picked) throw new Error('не удалось получить клетку под целью');
  {
    const R = 6371008.8, rad = Math.PI / 180;
    const hav = (a, b) => {
      const s = Math.sin((b[0] - a[0]) * rad / 2) ** 2
        + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    const off = hav([TARGET_LAT, TARGET_LON], [picked.lat, picked.lon]) / 1000;
    console.log(`шаг: клетка под ${TARGET_NAME} — #${picked.cell}, точка под курсором в ${off.toFixed(1)} км от города (смещение экрана ${picked.dx},${picked.dy} px)`);
  }

  const info = await page.evaluate((cell, name, kt, lat, lon) => {
    const s = window.__kupol.state;
    const me = s.nationId;
    const cities = [...s.cities];
    const home = cities.find((c) => c.owner === me);
    const other = s.nations.find((n) => n.id !== me);
    window.__cnt = () => {
      const v = window.__kupol.viewer;
      const n = (name) => (v.dataSources.getByName(name)[0]?.entities.values ?? []).length;
      return { world: n('kupol'), dmg: n('nuclear-city-damage') };
    };
    window.__ents0 = window.__cnt();
    s.nuclear.strikes.push({
      turn: s.turn, from: me, to: other?.id ?? me, city: name,
      yieldKt: kt, cell, fromCell: home?.cell ?? cell, intercepted: false,
    });
    window.__strikeAt = performance.now();
    window.__kupol.layers.update(s, {});
    // Сущность удара живёт 12 с: точку снимаем сразу, пока эллипс не убран,
    // иначе камера позже её не найдёт и кадр улетит в орбитальный масштаб.
    // В слое «kupol» эллипсов несколько (съёмка спутника, зона падения), и
    // прошлый прогон взял не тот: обратный обход наткнулся на метку города в
    // 6800 км от цели. Берём только эллипсоиды с CallbackProperty-осью — такой
    // растущий фронт рисует именно animateStrike — и из них ближайший к цели.
    const col = window.__kupol.viewer.dataSources.getByName('kupol')[0];
    const Cesium = window.Cesium;
    const now = Cesium.JulianDate.now();
    const R = 6371008.8, rad = Math.PI / 180;
    const hav = (a, b) => {
      const s = Math.sin((b[0] - a[0]) * rad / 2) ** 2
        + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    window.__blastPos = null;
    let bestD = Infinity; let cands = 0;
    for (const e of col?.entities.values ?? []) {
      if (!e.ellipse || !e.position) continue;
      if (!(e.ellipse.semiMajorAxis instanceof Cesium.CallbackProperty)) continue;
      const p = e.position.getValue(now);
      if (!p) continue;
      const c = Cesium.Cartographic.fromCartesian(p);
      const pos = { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
      cands += 1;
      const d = hav([pos.lat, pos.lon], [lat, lon]);
      if (d < bestD) { bestD = d; window.__blastPos = pos; }
    }
    return {
      turn: s.turn, total: cities.length, yieldKt: s.nuclear.strikes.at(-1).yieldKt,
      blastPos: window.__blastPos, cands, distKm: Number.isFinite(bestD) ? bestD / 1000 : null,
    };
  }, picked.cell, TARGET_NAME, KT, TARGET_LAT, TARGET_LON);
  console.log(`шаг: ${info.turn} ход, городов в снимке ${info.total}, запись удара: ${TARGET_NAME}, ${info.yieldKt} кт, клетка ${picked.cell}`);
  if (!info.blastPos) throw new Error('в слое партии не нашлось эллипса удара');
  console.log(`кандидатов-эллипсов ${info.cands}, ближайший в ${info.distKm.toFixed(1)} км от ${TARGET_NAME}`);
  if (info.distKm > 250) throw new Error(`выбранный эллипс в ${info.distKm.toFixed(0)} км от цели — это не удар по ${TARGET_NAME}`);

  // Камера на грибом ставится ДО ожидания объёма: каждый кадр SwiftShader
  // стоит секунды, и после появления гриба эти evaluate съедают полвека его
  // жизни. Точку берём из сущности удара, которую создал тот же animateStrike.
  // Стоим к северо-востоку и смотрим на юго-запад: «съёмочное» солнце у объёма
  // на азимуте ~50°, значит оно за спиной и гриб освещён спереди.
  const cam = await page.evaluate((aimY, dist, tilt, eyeAlt) => {
    document.getElementById('kupol-root')?.style.setProperty('display', 'none');
    const g = window.__aimBlast(aimY, dist, tilt, eyeAlt);
    const { lon, lat } = window.__blastPos;
    return { lon: +lon.toFixed(3), lat: +lat.toFixed(3), ...g };
  }, frameFor(AGES[0]).aimY, frameFor(AGES[0]).dist, TILT, frameFor(AGES[0]).eyeAlt);
  console.log(`камера: грибом ${cam.lon}, ${cam.lat} (цель ${frameFor(AGES[0]).aimY} м, глаз на ${frameFor(AGES[0]).eyeAlt} м), глаз в ${cam.camLon}, ${cam.camLat}, дистанция ${cam.distKm} км, курс ${cam.headingDeg}°, наклон ${cam.pitchDeg}° (снос ${TILT}°)`);

  // Снос и сборка примитивов вешают поток на десятки секунд: ждём появления
  // объёмного прохода, а не фиксированную паузу.
  await page.waitForFunction(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = 0; i < col.length; i += 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
    }
    return false;
  }, { timeout: 900000, polling: 1000 });
  // На программном растере один кадр стоит секунды, а возраст гриба = реальное
  // время × rate (2,23 для 150 кт), поэтому каждый лишний evaluate до съёмки
  // стоит ~10 модельных секунд. Всё, что не нужно для первого кадра (счёт
  // примитивов, время появления), читаем ПОСЛЕ серии.
  // Заодно меряем цену кадра: если объём живёт 40 реальных секунд, а кадр стоит
  // 25, гриб физически не успевает попасть в представленный буфер.
  await page.evaluate(() => {
    window.__frameMs = [];
    let prev = Date.now();
    window.__kupol.viewer.scene.postRender.addEventListener(() => {
      const now = Date.now();
      window.__frameMs.push(now - prev);
      prev = now;
      if (window.__frameMs.length > 400) window.__frameMs.shift();
    });
  });
  const DUMP = () => {
    const u = window.__blast.uniforms;
    const r3 = (v) => Math.round(Number(v) * 10) / 10;
    const v4 = (x) => [x.x, x.y, x.z, x.w].map(r3);
    // Прямое чтение геометрии решения onScreen: без него кадр без гриба
    // объяснялся на глаз (15.11: sync render 1,7 с = кадр без объёма).
    // origin живёт в замыкании модуля, поэтому считаем его сами по координатам
    // удара; высотой сброса пренебрегаем — при 18 км до цели это <10%.
    const v = window.__kupol.viewer;
    const C = window.Cesium;
    const origin = C.Cartesian3.fromDegrees(window.__blastPos.lon, window.__blastPos.lat, 0);
    const dist = C.Cartesian3.distance(v.camera.positionWC, origin);
    const to = C.Cartesian3.normalize(C.Cartesian3.subtract(origin, v.camera.positionWC, new C.Cartesian3()), new C.Cartesian3());
    const angle = Math.acos(Math.max(-1, Math.min(1, C.Cartesian3.dot(to, v.camera.directionWC))));
    const R = Number(u.u_boundR) || Math.hypot(Number(u.u_head.x), Number(u.u_head.y), Number(u.u_head.z));
    const fov = v.camera.frustum.fovy ?? C.Math.toRadians(60);
    const half = fov * (v.camera.frustum.aspectRatio ? 0.5 * Math.max(1, v.camera.frustum.aspectRatio) : 0.8);
    const cover = dist > 1 ? Math.max(0, Math.min(1, R / dist)) : 1;
    const geo = {
      distKm: Math.round(dist / 100) / 10, Rkm: Math.round(R / 100) / 10,
      angleDeg: Math.round(C.Math.toDegrees(angle) * 10) / 10,
      halfDeg: Math.round(C.Math.toDegrees(half) * 10) / 10,
      cover: Math.round(cover * 10000) / 10000, boundR: Number(u.u_boundR) || 0,
      onScreen: cover > 0.0009 && (dist < R * 1.4 || angle - Math.asin(Math.max(0, Math.min(1, R / Math.max(dist, 1)))) < half),
    };
    return {
      age: r3(u.u_age), ageRaw: u.u_age, enabled: window.__blast.enabled, texScale: r3(window.__blast._textureScale ?? 1),
      stepScale: r3(u.u_stepScale), boundY: r3(u.u_bound.y), headR: u.u_head.w > 0 ? r3(u.u_head.w) : 0,
      ice: v4(u.u_ice), ice2: v4(u.u_ice2), ring0: v4(u.u_ring0), ring3: v4(u.u_ring3),
      sun: r3(u.u_sunI), flash: r3(u.u_flash), geo,
    };
  };

  const PINQ = (process.env.PINQ || '').split(':').map(Number);  const pinPx = PINQ.length === 2 ? PINQ[0] : 1;
  const pinStep = PINQ.length === 2 ? PINQ[1] : 1;
  if (PIN) {
    // Верхняя ступень адаптации: марш с шагом 1 и текстурой 1:1. Модуль
    // пересчитывает рычаг каждый кадр, поэтому pinned-значение возвращаем
    // после рендера — так видно, что графика умеет на полном качестве.
    // PINQ=px:step позволяет зафиксировать любую пару рычагов и померить её.
    await page.evaluate(([px, step]) => {
      window.__pin = true;
      window.__kupol.viewer.scene.postRender.addEventListener(() => {
        if (!window.__pin || !window.__blast) return;
        window.__blast.uniforms.u_stepScale = step;
        window.__blast._textureScale = px;
      });
    }, [pinPx, pinStep]);
  }

  // Виртуальные часы: модуль берёт возраст из performance.now(), а кадр здесь
  // стоит 3–4 с → один снимок сдвигал возраст на 7–9 модельных секунд и рамка,
  // посчитанная для 22 с, показывала облако 38 с (замер strike28: шляпа на 25 px
  // от верхней кромки при расчётных 150). Сдвигаем время явно на нужное число
  // модельных секунд — тогда кадр строго на заданном возрасте.
  await page.evaluate(([rate]) => {
    const real = performance.now.bind(performance);
    // Морозим сразу, а не с первого __setAge: разогрев подложки ниже делает
    // десятки кадров, и на настоящих часах показ перелистывается на 84 с ещё
    // до первого снимка (strike33: рамка 8 пришла сразу на 84.1 с, серию
    // закрыл дедуп возрастов).
    window.__vclock = true;
    window.__vnow = real();
    performance.now = () => (window.__vclock ? window.__vnow : real());
    window.__setAge = (a) => {
      if (!window.__blast) return null;
      const cur = window.__blast.uniforms.u_age;
      if (!window.__vclock) { window.__vclock = true; window.__vnow = real(); }
      window.__vnow += ((a - cur) / rate) * 1000;
      return cur;
    };
  }, [RATE]);

  // Цикл отрисовки игры гасим ДО съёмки: на этом железе кадр стоит секунды, и
  // пока puppeteer кодирует PNG игра успевает показать СВОЙ кадр с камерой,
  // которую увела своя анимация, — снимок выходил без гриба при enabled=true
  // (замер 15.11, strike24). Плюс без паузы на загрузку тайлов кадр показывает
  // белый globe.baseColor вместо спутника: один синхронный render их не ждёт.
  // Ожидание тайлов с выключенным маршем: кадр с объёмным проходом стоит
  // 8–12 с, за 60 с успевало уйти 6–7 запросов и земля оставалась белой
  // (baseColor глобуса). stage.enabled, а не show — по замеру #31.
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
  await page.evaluate(() => { window.__kupol.viewer.useDefaultRenderLoop = false; });
  // Разогрев подложки ДО цикла: на первом кадре кэш пуст, и даже дешёвый
  // маршем выключенный settle не успевал за 60 с (smoke-tile: 67 с и всё
  // равно «НЕ дождались»). Пока объёмного прохода нет, кадры копеечные.
  const warm = await settle(90000);
  console.log(`подложка разогрета: ${warm.done ? 'дождалась' : 'не дождалась'} за ${warm.ms} мс`);

  let live = await page.evaluate(DUMP);
  let shotAge = -1;
  for (const target of AGES) {
    const was = await page.evaluate((a) => window.__setAge(a), Math.min(target, TFULL));
    if (was === null) { console.log('объёмный проход исчез — показ партии закончился, серии дальше нет'); break; }
    const tiles = await settle();
    live = await page.evaluate(DUMP);
    if (Math.abs(live.ageRaw - shotAge) < 0.05) {
      console.log(`кадр ${shotAge.toFixed(1)} с уже снят, новых возрастов нет — серию закрываем`);
      break;
    }
    const eIvy = expected(pick, KT, live.ageRaw);
    const eRds = expected(byId('rds37'), 1600, live.ageRaw);
    const key = (o) => [o.boundY, o.headR, o.ice, o.ice2, o.ring0, o.ring3];
    const eq = (a, b) => JSON.stringify(key(a)) === JSON.stringify(key(b));
    const ivyOk = eq(live, eIvy);
    const rdsOk = eq(live, eRds);
    rows.push({ target, live, eIvy, eRds, ivyOk, rdsOk });
    console.log(`возраст ${live.age} с: boundY=${live.boundY} headR=${live.headR} ice=${live.ice} ice2=${live.ice2} r0=${live.ring0} r3=${live.ring3} step=${live.stepScale} tex=${live.texScale} enabled=${live.enabled}`);
    console.log(`   экран: R=${live.geo.Rkm} км, глаз в ${live.geo.distKm} км, угол ${live.geo.angleDeg}° против полуугла ${live.geo.halfDeg}°, cover=${live.geo.cover}, onScreen=${live.geo.onScreen}, тайлы подложки ${tiles.done ? 'загрузились' : 'НЕ дождались'} за ${tiles.ms} мс`);
    console.log(`   ivy_king@${KT}: boundY=${eIvy.boundY} headR=${eIvy.headR} ice=${eIvy.ice} ice2=${eIvy.ice2} r0=${eIvy.ring0} r3=${eIvy.ring3} → ${ivyOk ? 'СОВПАЛО' : 'нет'}`);
    console.log(`   rds37@1600   : boundY=${eRds.boundY} headR=${eRds.headR} ice=${eRds.ice} ice2=${eRds.ice2} r0=${eRds.ring0} r3=${eRds.ring3} → ${rdsOk ? 'СОВПАЛО' : 'нет'}`);
    const file = `${outDir}/strike_s${Math.round(live.age)}.png`;
    // Камеру ставим заново ПЕРЕД каждым кадром: за секунды ожидания игра
    // успевает увести её своей анимацией, и тогда гриб просто не в кадре
    // (замер 15.11: strike13/14 показали пустую землю при том же возрасте).
    // Рендерим кадр синхронно прямо перед съёмкой: буфер обмена с композитором
    // на этом железе отстаёт на кадр-два, и без этого гриб мог не попасть в PNG.
    const cost = await page.evaluate((aimY, dist, tilt, eyeAlt, y1) => {
      const v = window.__kupol.viewer;
      // Цикл отрисовки игры гасим: на этом железе кадр стоит секунды, и пока
      // puppeteer кодирует PNG, игра успевает показать СВОЙ кадр с камерой,
      // которую увела своя анимация, — снимок выходил без гриба при
      // enabled=true (замер 15.11, strike24). Теперь рисуем только сами.
      v.useDefaultRenderLoop = false;
      window.__aimBlast(aimY, dist, tilt, eyeAlt);
      const t0 = Date.now();
      v.render();
      const ms = Date.now() - t0;
      const u = window.__blast.uniforms;
      // шляпа в пикселях экрана: без этого «onScreen=true» опять означало бы
      // «объём где-то рядом», а не «гриб в кадре» (strike27 показал ножку).
      const scr = v.scene.cartesianToCanvasCoordinates(
        window.Cesium.Cartesian3.fromDegrees(window.__blastPos.lon, window.__blastPos.lat, u.u_head.y),
        new window.Cesium.Cartesian2());
      const px = (h) => {
        const q = v.scene.cartesianToCanvasCoordinates(
          window.Cesium.Cartesian3.fromDegrees(window.__blastPos.lon, window.__blastPos.lat, h),
          new window.Cesium.Cartesian2());
        return q ? Math.round(q.y) : null;
      };
      return {
        ms, last: window.__frameMs.slice(-4), age: u.u_age,
        head: scr ? { x: Math.round(scr.x), y: Math.round(scr.y) } : null,
        groundPx: px(0), topPx: px(y1),
        screen: [v.canvas.clientWidth, v.canvas.clientHeight],
      };
    }, frameFor(live.ageRaw).aimY, frameFor(live.ageRaw).dist, TILT,
    frameFor(live.ageRaw).eyeAlt, frameFor(live.ageRaw).y1);
    await page.screenshot({ path: file });
    shotAge = live.ageRaw;
    console.log(`   кадр: ${file} (синхронный render ${cost.ms} мс, последние кадры ${cost.last.join('/')} мс, возраст после рендера ${Math.round(cost.age * 10) / 10} с, шляпа в пикселях ${JSON.stringify(cost.head)}, облако ${cost.topPx}..${cost.groundPx} px при экране ${cost.screen.join('×')})`);
  }

  const launchMs = await page.evaluate(() => performance.now() - window.__strikeAt);
  const after = await page.evaluate(() => ({ now: window.__cnt(), before: window.__ents0, yieldKt: window.__kupol.state.nuclear.strikes.at(-1)?.yieldKt }));
  console.log(`гриб появился через ${(launchMs / 1000).toFixed(1)} с (снос + сборка примитивов); примитивов: слой партии ${after.before.world} → ${after.now.world} (+${after.now.world - after.before.world}), снесённая застройка ${after.before.dmg} → ${after.now.dmg} (+${after.now.dmg - after.before.dmg}), в снимке мощность ${after.yieldKt} кт`);
} catch (e) {
  console.log(`FATAL ${e.message}`);
} finally {
  console.log(`errors ${JSON.stringify(errs.slice(0, 6))}`);
  writeFileSync(`${outDir}/result.json`, JSON.stringify({ KT, profile: pick?.id, rows, errs }, null, 1));
  await browser.close();
}
