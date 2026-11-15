// Живой замер свободного полёта камеры (WASD/QE/ZX) — ровно то, что просил
// заказчик: «возможность полета камери как у исто4ника». Прибор честный: он
// сверяет ФАКТИЧЕСКИ пройденное за настенные секунды расстояние с номиналом
// flightSpeed(высота), потому что шаг камеры считается по dt между тиками
// часов, а dt ограничен сверху 0.25 с. На SwiftShader тиков в секунду мало,
// и недополученное время — это не баг игры, а цена этого рендерера: прибор
// обязан их разделить.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4245);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GOOGLE_MAPS_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', () => {});

const SNAP = () => {
  const cam = window.__kupol.viewer.camera;
  const C = window.__kupol.viewer.scene.globe.ellipsoid.cartesianToCartographic(cam.positionWC);
  const deg = 57.29577951308232;
  return { lat: C.latitude * deg, lon: C.longitude * deg, h: C.height,
    heading: cam.heading * deg, pitch: cam.pitch * deg, frames: window.__frames };
};

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofileFlight',
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
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.__frames = 0;
    window.__kupol.viewer.scene.postRender.addEventListener(() => { window.__frames += 1; });
    // Мелкий рендер — больше тиков в секунду на софтом растере. На скорость
    // камеры это не влияет (шаг считается от высоты, не от разрешения), только
    // на честность замера fps.
    window.__kupol.viewer.resolutionScale = 0.4;
    for (const sel of ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-live', '.k-hint']) {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    }
  });
  await sleep(15000);

  const fps = async (ms) => {
    const a = await page.evaluate(() => window.__frames);
    const t0 = Date.now();
    await sleep(ms);
    const b = await page.evaluate(() => window.__frames);
    return { ticksPerSec: ((b - a) / ((Date.now() - t0) / 1000)).toFixed(2) };
  };
  console.log('покой', JSON.stringify(await fps(6000)));

  const run = async (label, keys, ms, expect) => {
    const before = await page.evaluate(SNAP);
    for (const k of keys) await page.keyboard.down(k);
    const t0 = Date.now();
    await sleep(ms);
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    await sleep(1200);
    const after = await page.evaluate(SNAP);
    const dtReal = (Date.now() - t0) / 1000;
    const dLat = (after.lat - before.lat) * 111_320;
    const dLon = (after.lon - before.lon) * 111_320 * Math.cos((before.lat * Math.PI) / 180);
    const ground = Math.hypot(dLat, dLon);
    const hNom = (before.h + after.h) / 2;
    const nominal = Math.min(4e6, Math.max(30, Math.abs(hNom) * 0.28)) * dtReal * (expect?.boost ? 4 : 1);
    // Клавиши высоты и рыскание дают свой размер: доля считается от того, что
    // данная проба вообще обязана изменить.
    const lift = Math.abs(after.h - before.h);
    const yawRad = Math.abs(((after.heading - before.heading) * Math.PI) / 180);
    const progress = expect?.height ? lift : ground;
    const moved = {
      проба: label,
      't_сек': +dtReal.toFixed(2),
      'кадров': after.frames - before.frames,
      'км_земля': +(ground / 1000).toFixed(3),
      'км_номинал': +(nominal / 1000).toFixed(3),
      'доля_номинала': +(progress / nominal).toFixed(2),
      'высота_до_м': Math.round(before.h), 'высота_после_м': Math.round(after.h),
      'азимут_до': +before.heading.toFixed(1), 'азимут_после': +after.heading.toFixed(1),
    };
    if (expect?.height) moved['Δвысота_км'] = +(lift / 1000).toFixed(3);
    if (expect?.yaw) {
      moved['Δазимут_рад'] = +yawRad.toFixed(3);
      moved['азимут_номинал_рад'] = +(1.1 * dtReal).toFixed(3);
      moved['доля_номинала'] = +(yawRad / (1.1 * dtReal)).toFixed(2);
    }
    console.log('ПОЛЁТ', JSON.stringify(moved));
    return after;
  };

  // Высота, с которой игра показывает город после наводки, неизвестна — сначала
  // просто подняться и посмотреть, что клавиши вообще двигают камеру.
  await run('X-вверх 3с', ['KeyX'], 3000, { height: true });
  await run('W-вперёд 3с', ['KeyW'], 3000, {});
  await run('Shift+W 3с', ['ShiftLeft', 'KeyW'], 3000, { boost: true });
  await run('S-назад 3с', ['KeyS'], 3000, {});
  await run('A-влево 3с', ['KeyA'], 3000, {});
  await run('D-вправо 3с', ['KeyD'], 3000, {});
  await run('Q-рыскание 2с', ['KeyQ'], 2000, { yaw: true });
  await run('E-рыскание 2с', ['KeyE'], 2000, { yaw: true });
  await run('Z-вниз 3с', ['KeyZ'], 3000, { height: true });
  console.log('покой после', JSON.stringify(await fps(6000)));

  // Раскладка: обработчик смотрит на event.key, значит кириллический символ
  // обязан попасть в ту же роль. Это проверка маппинга (событие синтезируется
  // в странице), а не проверки физической раскладки браузера.
  const cyr = await page.evaluate(async () => {
    const cam = window.__kupol.viewer.camera;
    const ell = window.__kupol.viewer.scene.globe.ellipsoid;
    const before = ell.cartesianToCartographic(cam.positionWC);
    const fire = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    fire('keydown', 'ц');
    await new Promise((r) => setTimeout(r, 2500));
    fire('keyup', 'ц');
    const after = ell.cartesianToCartographic(cam.positionWC);
    const deg = 57.29577951308232;
    return { 'км': Math.hypot((after.latitude - before.latitude) * 111320,
      (after.longitude - before.longitude) * 111320 * Math.cos(before.latitude)) / 1000 };
  });
  console.log('ЦЫВ-вперёд', JSON.stringify(cyr));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
  console.log('FLIGHT DONE');
} catch (e) {
  console.log('FATAL', String(e.message).slice(0, 300));
  console.log('errors', JSON.stringify(errs.slice(0, 8)));
} finally {
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
}
