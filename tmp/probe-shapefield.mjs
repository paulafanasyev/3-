import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5235, base = `http://127.0.0.1:${port}`;
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
  const target = realNow() + (life * fraction - stage.uniforms.u_age / rate) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
  v.entities.show = false;
  v.dataSources.get(0).show = false;
  // Косой вид: гриб целиком, 80 км южнее, 7 км высота.
  v.camera.setView({
    destination: window.__Cesium.Cartesian3.fromDegrees(-0.13, 51.5074 - 0.72, 7000),
    orientation: { heading: 0, pitch: window.__Cesium.Math.toRadians(6), roll: 0 },
  });
}, 0.62);
await sleep(2500);

const built = await page.evaluate(() => {
  const C = window.__Cesium, s = window.__viewer.scene, stage = window.__stage;
  const names = ['u_ax0', 'u_ax1', 'u_ax2', 'u_cam', 'u_rayDir', 'u_rayUp', 'u_rayRight', 'u_rayTan', 'u_bound', 'u_boundR', 'u_seed', 'u_age', 'u_steps',
    'u_exposure', 'u_fb', 'u_fbLook', 'u_fbShape', 'u_fbTint', 'u_fbCut', 'u_head', 'u_headShape',
    'u_headColA', 'u_headColB', 'u_headHeat', 'u_headDetail', 'u_lobes', 'u_stem', 'u_stemShape',
    'u_stemCol', 'u_stemWobble', 'u_stemTwist', 'u_stemTopFlare', 'u_skirt', 'u_skirtCol', 'u_skirtFront',
    'u_wind', 'u_windH', 'u_churn', 'u_groundCol', 'u_sunI', 'u_flash', 'u_life', 'u_shock'];
  const live = {};
  for (const n of names) live[n] = () => stage.uniforms[n];
  let src = stage.fragmentShader;
  const before = src;
  // Где луч реально проходит мимо оси гриба: R — близость к оси (1 = на оси),
  // G — высота этой точки (0..25 км), B — близость к поверхности ножки.
  src = src.split('  float firstHit = -1.0;')
    .join('  float firstHit = -1.0;\n  float minRxz = 1e9;\n  float yAtMin = 0.0;\n  float nearStem = 0.0;');
  src = src.split('    if (sd > margin) {').join(
    '    if (length(p.xz) < minRxz) { minRxz = length(p.xz); yAtMin = p.y; }\n'
    + '    nearStem = max(nearStem, 1.0 - clamp(sdfStem(p) / 15000.0, 0.0, 1.0));\n'
    + '    if (sd > margin) {');
  src = src.split('  float alpha = clamp((1.0 - T) * u_life, 0.0, 1.0);')
    .join('  out_FragColor = vec4(1.0 - clamp(minRxz / 5000.0, 0.0, 1.0),'
      + ' clamp(yAtMin / 25000.0, 0.0, 1.0), nearStem, 1.0);\n'
      + '  float alpha = clamp((1.0 - T) * u_life, 0.0, 1.0);\n  return;\n');
  const misses = [];
  if (!src.includes('minRxz = 1e9')) misses.push('minRxz');
  if (!src.includes('clamp(yAtMin / 25000.0')) misses.push('output');
  if (misses.length) return { error: 'якоря не найдены', misses, probe: before.slice(0, 60) };
  const dbg = s.postProcessStages.add(new C.PostProcessStage({ name: 'kupol-dbg3', fragmentShader: src, uniforms: live }));
  stage.show = false;
  window.__dbg = dbg;
  return { ok: true };
});
console.log('BUILD', JSON.stringify(built));

// Аналитика на JS: тот ли луч шейдер обязан видеть в пикселе (640,460)?
const ray = await page.evaluate(() => {
  const C = window.__Cesium, v = window.__viewer, u = window.__stage.uniforms;
  const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2; // базис шейдера: x=восток, y=верх, z=север
  const camW = v.camera.positionWC;
  const originW = new C.Cartesian3(
    camW.x - (u.u_cam.x * e.x + u.u_cam.y * up.x + u.u_cam.z * n.x),
    camW.y - (u.u_cam.x * e.y + u.u_cam.y * up.y + u.u_cam.z * n.y),
    camW.z - (u.u_cam.x * e.z + u.u_cam.y * up.z + u.u_cam.z * n.z),
  );
  const toLocal = (p) => new C.Cartesian3(C.Cartesian3.dot(p, e), C.Cartesian3.dot(p, up), C.Cartesian3.dot(p, n));
  const out = { frustum: { fovy: +(v.camera.frustum.fovy ?? 0).toFixed(3), fovAxis: v.camera.frustum.fovAxis }, rows: [] };
  for (const y of [320, 400, 440, 460, 480, 520]) {
    const r = v.camera.getPickRay(new C.Cartesian2(640, y));
    if (!r) { out.rows.push({ y, error: 'нет луча' }); continue; }
    const ro = toLocal(C.Cartesian3.subtract(r.origin, originW, new C.Cartesian3()));
    const rd = toLocal(C.Cartesian3.normalize(r.direction, new C.Cartesian3()));
    // минимальное расстояние до оси ножки (вертикальный отрезок в начале координат)
    const top = u.u_stem.y;
    const tAxis = C.Cartesian3.dot(new C.Cartesian3(-ro.x, 0, -ro.z), new C.Cartesian3(rd.x, 0, rd.z));
    const px = ro.x + rd.x * tAxis, pz = ro.z + rd.z * tAxis, py = ro.y + rd.y * tAxis;
    out.rows.push({ y, ro: [Math.round(ro.x), Math.round(ro.y), Math.round(ro.z)],
      rd: [+rd.x.toFixed(3), +rd.y.toFixed(3), +rd.z.toFixed(3)],
      axisCrossY: Math.round(py), axisMissM: Math.round(Math.hypot(px, pz)),
      onStem: py > 0 && py < top && Math.hypot(px, pz) < u.u_stem.z });
  }
  return out;
});
console.log('RAY', JSON.stringify(ray));

// Пиксельное чтение: R=alpha, G=плотность, B=близость к геометрии.
const readout = await page.evaluate(() => new Promise((resolve) => {
  const C = window.__Cesium, s = window.__viewer.scene;
  const c2 = document.createElement('canvas');
  c2.width = 1280; c2.height = 720;
  const cx = c2.getContext('2d', { willReadFrequently: true });
  const off = document.createElement('canvas');
  off.width = 1280; off.height = 720;
  s.postRender.addEventListener(() => {
    try {
      cx.drawImage(s.canvas, 0, 0, 1280, 720);
      // вертикальный разрез по центру кадра — там должны быть шляпа, ножка, земля
      const col = [];
      for (let y = 200; y <= 560; y += 20) {
        const d = cx.getImageData(640, y, 1, 1).data;
        col.push({ y, cover: +(d[0] / 255).toFixed(2), iters: +(d[1] / 255).toFixed(2), stem: +(d[2] / 255).toFixed(2) });
      }
      resolve(col);
    } catch (e) { resolve({ error: String(e).slice(0, 200) }); }
  }, true);
  s.requestRender();
  setTimeout(() => resolve({ timeout: true }), 8000);
}));
console.log('SLICE', JSON.stringify(readout));
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dbg_shapefield.png' });
console.log('errors:', JSON.stringify(errs.slice(-4)));
await browser.close(); vite.kill('SIGTERM');
