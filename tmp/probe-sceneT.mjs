import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5231, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 300)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 180000 });
await page.evaluate(async () => { await window.runTest('castle_bravo', 'London', 'wide'); });

// 1) Заморозка часов на зрелом грибе, спрятать сущности — только объёмный проход.
await page.evaluate((fraction) => {
  const v = window.__viewer;
  let stage = null;
  for (let i = 0; i < v.scene.postProcessStages.length; i += 1) {
    const c = v.scene.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  window.__stage = stage;
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const ageNow = stage.uniforms.u_age / rate;
  const target = realNow() + (life * fraction - ageNow) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
  v.entities.show = false;
  v.dataSources.get(0).show = false;
}, 0.62);
await sleep(1500);

// 2) Истина из JS: расстояние камера→рельеф по лучу через центр кадра.
const truth = await page.evaluate(() => {
  const s = window.__viewer.scene, cam = s.camera;
  const ray = cam.getPickRay(new (window.__Cesium.Cartesian2)(640, 360));
  const pos = ray && s.globe.pick(ray, s);
  return {
    frustumNear: cam.frustum.near, frustumFar: cam.frustum.far,
    globeHitM: pos ? Math.round(window.__Cesium.Cartesian3.distance(cam.positionWC, pos)) : null,
    camAltM: Math.round(cam.positionWC ? window.__Cesium.Cartesian3.magnitude(cam.positionWC) - 6371000 : 0),
  };
});
console.log('TRUTH', JSON.stringify(truth));

// 3) Отладочная стадия: выводим sceneT / tEnter / (tExit-tEnter) прямо в пиксель.
//    Униформы — функции, значит всегда живые значения оригинальной стадии.
const built = await page.evaluate(() => {
  const C = window.__Cesium, s = window.__viewer.scene, stage = window.__stage;
  const names = ['u_ax0', 'u_ax1', 'u_ax2', 'u_cam', 'u_bound', 'u_boundR', 'u_seed', 'u_age', 'u_steps',
    'u_exposure', 'u_fb', 'u_fbLook', 'u_fbShape', 'u_fbTint', 'u_fbCut', 'u_head', 'u_headShape',
    'u_headColA', 'u_headColB', 'u_headHeat', 'u_headDetail', 'u_lobes', 'u_stem', 'u_stemShape',
    'u_stemCol', 'u_stemWobble', 'u_stemTwist', 'u_stemTopFlare', 'u_skirt', 'u_skirtCol', 'u_skirtFront',
    'u_wind', 'u_windH', 'u_churn', 'u_groundCol', 'u_sunI', 'u_flash', 'u_life', 'u_shock'];
  const live = {};
  for (const n of names) live[n] = () => stage.uniforms[n];
  const anchor = '  if (tExit <= tEnter + 1.0) {';
  let src = stage.fragmentShader
    // голубой = марш вообще не запущен (нулевой ограничитель), пурпур = луч мимо сферы
    .split('  if (u_boundR <= 0.0) {\n    out_FragColor = flashVeil(outColor);')
    .join('  if (u_boundR <= 0.0) {\n    out_FragColor = vec4(0.0, 1.0, 1.0, 1.0);')
    .split('  if (disc <= 0.0) {\n    out_FragColor = flashVeil(outColor);')
    .join('  if (disc <= 0.0) {\n    out_FragColor = vec4(1.0, 0.0, 1.0, 1.0);');
  src = src.split(anchor).join(
    '  out_FragColor = vec4(clamp(sceneT / 200000.0, 0.0, 1.0), clamp(tEnter / 200000.0, 0.0, 1.0),'
    + ' clamp((tExit - tEnter) / 50000.0, 0.0, 1.0), 1.0);\n'
    + anchor,
  );
  if (!src.includes('vec4(1.0, 0.0, 1.0, 1.0)')) return { error: 'якорь disc не найден' };
  if (!src.includes('clamp(sceneT / 200000.0')) return { error: 'якорь tExit не найден' };
  const dbg = s.postProcessStages.add(new C.PostProcessStage({ name: 'kupol-dbg2', fragmentShader: src, uniforms: live }));
  stage.show = false;
  window.__dbg = dbg;
  window.__raw = null;
  // Чтение пикселей синхронно в postRender: буфер ещё не сброшен.
  const c2 = document.createElement('canvas');
  c2.width = 1280; c2.height = 720;
  const cx = c2.getContext('2d', { willReadFrequently: true });
  s.postRender.addEventListener(() => {
    try {
      cx.drawImage(s.canvas, 0, 0, 1280, 720);
      const pts = [[640, 360], [640, 200], [640, 500], [400, 360], [900, 360], [640, 640], [100, 100]];
      window.__raw = pts.map(([x, y]) => {
        const d = cx.getImageData(x, y, 1, 1).data;
        return { x, y, sceneT: Math.round(d[0] * 200000 / 255), tEnter: Math.round(d[1] * 200000 / 255), span: Math.round(d[2] * 50000 / 255), a: d[3] };
      });
    } catch (e) { window.__raw = { error: String(e).slice(0, 200) }; }
  });
  return { ok: true };
});
console.log('BUILD', JSON.stringify(built));
if (built.error) { console.log('errors:', JSON.stringify(errs.slice(-4))); await browser.close(); vite.kill('SIGTERM'); process.exit(1); }

await sleep(6000);
const px = await page.evaluate(() => window.__raw);
console.log('PIXELS', JSON.stringify(px));
const st = await page.evaluate(() => {
  const u = window.__stage.uniforms;
  return { boundR: Math.round(u.u_boundR), boundY: Math.round(u.u_bound.z),
    cam: [Math.round(u.u_cam.x), Math.round(u.u_cam.y), Math.round(u.u_cam.z)] };
});
console.log('STATE', JSON.stringify(st));
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dbg_scenet.png' });
console.log('errors:', JSON.stringify(errs.slice(-4)));
await browser.close(); vite.kill('SIGTERM');
