import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5237, base = `http://127.0.0.1:${port}`;
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
  v.camera.setView({
    destination: window.__Cesium.Cartesian3.fromDegrees(-0.13, 51.5074 - 0.72, 7000),
    orientation: { heading: 0, pitch: window.__Cesium.Math.toRadians(6), roll: 0 },
  });
}, 0.62);
await sleep(2500);

// Отладочный слой: тот же шейдер, но вместо объёма — компонент реконструированного луча.
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
  src = src.split('  vec3 ro = u_cam;')
    .join('  vec3 ro = u_cam;\n'
      + '  out_FragColor = vec4(0.5 + rd.y * 2.0, 0.5 + rd.z * 0.5, 0.5 - rd.x * 2.0, 1.0);\n  return;\n');
  if (!src.includes('0.5 + rd.y * 2.0')) return { error: 'якорь не найден' };
  const dbg = s.postProcessStages.add(new C.PostProcessStage({ name: 'kupol-dbg-ray', fragmentShader: src, uniforms: live }));
  stage.show = false;
  window.__dbg = dbg;
  return { ok: true, age: stage.uniforms.u_age, stem: [stage.uniforms.u_stem.x, stage.uniforms.u_stem.y, stage.uniforms.u_stem.z, stage.uniforms.u_stem.w] };
});
console.log('BUILD', JSON.stringify(built));

// В одном кадре: пиксели шейдера и аналитический луч JS.
const cmp = await page.evaluate(() => new Promise((resolve) => {
  const C = window.__Cesium, v = window.__viewer, s = v.scene, u = window.__stage.uniforms;
  const c2 = document.createElement('canvas');
  c2.width = 1280; c2.height = 720;
  const cx = c2.getContext('2d', { willReadFrequently: true });
  const e = u.u_ax0, up = u.u_ax1, n = u.u_ax2;
  const toLocal = (p) => new C.Cartesian3(C.Cartesian3.dot(p, e), C.Cartesian3.dot(p, up), C.Cartesian3.dot(p, n));
  s.postRender.addEventListener(() => {
    try {
      cx.drawImage(s.canvas, 0, 0, 1280, 720);
      const f = v.camera.frustum;
      const tanY = Math.tan((f.fovy ?? 0.628) / 2);
      const rows = [];
      for (const y of [200, 320, 360, 400, 440, 460, 520, 600]) {
        const d = cx.getImageData(640, y, 1, 1).data;
        const shader = [+(d[0] / 255 - 0.5).toFixed(4) / 2, +(d[1] / 255 - 0.5).toFixed(4) / 0.5, +((0.5 - d[2] / 255)).toFixed(4) / 2];
        const ndcY = 1 - 2 * ((y + 0.5) / 720);
        const wc = C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(v.camera.upWC, ndcY * tanY, new C.Cartesian3()),
          v.camera.directionWC, new C.Cartesian3());
        const truth = toLocal(C.Cartesian3.normalize(wc, new C.Cartesian3()));
        rows.push({ y, sh: [+shader[2].toFixed(3), +shader[0].toFixed(3), +shader[1].toFixed(3)],
          js: [+truth.x.toFixed(3), +truth.y.toFixed(3), +truth.z.toFixed(3)],
          dY: +(shader[0] - truth.y).toFixed(3) });
      }
      resolve({ rows, fovy: +(f.fovy ?? 0).toFixed(3), aspect: +(s.canvas.width / s.canvas.height).toFixed(3),
        camLocal: [+u.u_cam.x.toFixed(0), +u.u_cam.y.toFixed(0), +u.u_cam.z.toFixed(0)] });
    } catch (err) { resolve({ error: String(err).slice(0, 200) }); }
  }, true);
  s.requestRender();
  setTimeout(() => resolve({ timeout: true }), 9000);
}));
console.log('CMP', JSON.stringify(cmp, null, 1));
console.log('errors:', JSON.stringify(errs.slice(-4)));
await browser.close();
vite.kill('SIGTERM');
