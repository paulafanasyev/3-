// Кадры для замера #23: конденсационные кольца, ледяная шапка и купол грунта.
// Прежний сниматель ловил кнопку панели и срывался по таймауту; здесь вызов
// идёт напрямую через layers.playNuclearTest — тот же путь, что у полигона,
// но без кликов. Возраст цели берём из чистого замера blastShapeAt, где
// соответствующая деталь ненулевая.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const base = `http://127.0.0.1:${port}`;
const PROFILE = process.env.PROFILE || 'rds37';
const KT = Number(process.env.KT || 1600);
const CITY = process.env.CITY || 'London';
const AGES = (process.env.AGES || '4,10,60').split(',').map(Number);
const DAMAGE = process.env.DAMAGE === '1';
const OUT = process.env.OUT || `D:/mt5/tmp-nuclear/shots/feat-${PROFILE}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Координаты пяти городов God's Eye View — те же, что в списке полигона.
const CITIES = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
const [LAT, LON] = CITIES[CITY] ?? CITIES.London;

const data = JSON.parse(readFileSync(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8'));
const bomb = data.bombs.find((b) => b.id === PROFILE);
if (!bomb) throw new Error(`профиля ${PROFILE} нет в каталоге`);
const zones = zonesForBomb(bomb, KT);
const nz = (a) => Array.isArray(a) && a.some((v) => Number(v) > 0);
const shapeAt = (s) => blastShapeAt(bomb, zones, KT, s);
const t0 = shapeAt(0).timing;
console.log(`${PROFILE} @ ${KT} кт: tFull=${t0.tFull.toFixed(0)} с, облако ${t0.cloudTop.toFixed(0)} м, купол шапки ${t0.capRadius.toFixed(0)} м`);
for (const s of AGES) {
  const st = shapeAt(s);
  console.log(`  возраст ${s} с: dome=${nz(st.dome)} ice=${nz(st.ice)} ice2=${nz(st.ice2)} rings=${st.rings.map((r) => (nz(r) ? 1 : 0)).join('')}`);
}

const browser = await puppeteer.launch({
  userDataDir: process.env.PPDIR || `D:/mt5/tmp-nuclear/chrome-feat-${PROFILE}`,
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
  await page.waitForFunction(() => window.__kupol?.layers?.playNuclearTest, { timeout: 120000 });
  console.log('шаг: партия идёт, слои доступны');

  // Кадр подгоняем под размер облака: 2.2 высоты гриба с расстояния, взгляд
  // чуть вниз. Для купола грунта это несколько километров, для Царь-бомбы —
  // десятки, и один и тот же кадр не показывает ни то, ни другое.
  const boundY = Math.max(2000, shapeAt(Math.max(...AGES)).bound.y);
  const dist = boundY * 2.4;
  await page.evaluate(async (lat, lon, kt, profile, city, damage, dist, aimY) => {
    const Cesium = window.Cesium;
    document.getElementById('kupol-root')?.style.setProperty('display', 'none');
    window.__kupol.layers.playNuclearTest({ lat, lon }, kt / 1000, { profileId: profile, cityName: city, damage });
    const dLat = dist / 111_320;
    const dLon = dist / (111_320 * Math.cos(lat * Math.PI / 180));
    window.__blastPos = { lon, lat };
    window.__cam = { lon: lon + dLon, lat: lat + dLat, alt: dist * 0.75 };
    // Наводка считается геометрически, а не фиксированным pitch=-16: глаз стоит
    // на горизонтальном расстоянии dist и высоте 0,75·dist, то есть цель ниже
    // горизонта на atan(0,75)=37°, а прежние -16° задирали кадр вверх и облако
    // оставалось за нижней кромкой (замер 15.11: в кадре только маркеры войск).
    const origin = Cesium.Cartesian3.fromDegrees(lon, lat, aimY);
    const enu = Cesium.Matrix4.inverseTransformation(
      Cesium.Transforms.eastNorthUpToFixedFrame(origin), new Cesium.Matrix4());
    window.__aim = () => {
      const eye = Cesium.Cartesian3.fromDegrees(window.__cam.lon, window.__cam.lat, window.__cam.alt);
      const p = Cesium.Matrix4.multiplyByPoint(enu, eye, new Cesium.Cartesian3());
      const horiz = Math.hypot(p.x, p.y);
      const v = window.__kupol.viewer;
      v.camera.cancelFlight();
      v.camera.setView({
        destination: eye,
        orientation: { heading: Math.atan2(-p.x, -p.y), pitch: Math.atan2(-p.z, horiz), roll: 0 },
      });
    };
    window.__aim();
    return true;
  }, LAT, LON, KT, PROFILE, CITY, DAMAGE, dist, boundY * 0.5);
  console.log(`шаг: испытание запущено, камера с ${Math.round(dist / 1000)} км на высоте ${Math.round(dist * 0.75 / 1000)} км`);

  await page.waitForFunction(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = 0; i < col.length; i += 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('kupol-blast') === 0) { window.__blast = s; return true; }
    }
    return false;
  }, { timeout: 900000, polling: 1000 });
  console.log('шаг: объёмный проход появился');

  const DUMP = () => {
    const u = window.__blast.uniforms;
    const r3 = (v) => Math.round(Number(v) * 10) / 10;
    const v4 = (x) => [x.x, x.y, x.z, x.w].map(r3);
    return {
      ageRaw: u.u_age, age: r3(u.u_age), enabled: window.__blast.enabled,
      stepScale: r3(u.u_stepScale), texScale: r3(window.__blast._textureScale ?? 1),
      boundY: r3(u.u_bound.y), dome: v4(u.u_dome), ice: v4(u.u_ice), ice2: v4(u.u_ice2),
      r0: v4(u.u_ring0), r1: v4(u.u_ring1), r2: v4(u.u_ring2), r3_: v4(u.u_ring3),
    };
  };

  for (const target of AGES) {
    let last = -1;
    for (let i = 0; i < 300; i += 1) {
      const a = await page.evaluate(() => window.__blast.uniforms.u_age);
      if (a >= target) break;
      if (a <= last) { console.log(`возраст встал на ${a.toFixed(1)} с`); break; }
      last = a;
      await sleep(1500);
    }
    // Камеру наводим заново перед каждым кадром: за ожидание игра успевает
    // увести её своей анимацией, и тогда облако просто не в кадре.
    await page.evaluate(() => window.__aim());
    await sleep(2500);
    const live = await page.evaluate(DUMP);
    const want = shapeAt(live.ageRaw);
    const ok = Math.abs(live.boundY - Math.round(want.bound.y * 10) / 10) < 0.2;
    const file = `${OUT}/${PROFILE}_s${Math.round(live.age)}.png`;
    await page.screenshot({ path: file });
    frames.push({ live, file, ok });
    console.log(`возраст ${live.age} с: dome=${live.dome} ice=${live.ice} ice2=${live.ice2} r0=${live.r0} r3=${live.r3_} step=${live.stepScale} tex=${live.texScale} enabled=${live.enabled} модель=${ok ? 'сходится' : 'РАСХОЖДЕНИЕ'} → ${file}`);
  }
} catch (e) {
  console.log(`FATAL ${e.message}`);
} finally {
  console.log(`errors ${JSON.stringify(errs.slice(0, 6))}`);
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ PROFILE, KT, CITY, frames, errs }, null, 1));
  await browser.close();
}
