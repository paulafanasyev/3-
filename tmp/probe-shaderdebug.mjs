import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5227, base = `http://127.0.0.1:${port}`;
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
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 400)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 180000 });
await page.evaluate(async () => { await window.runTest('castle_bravo', 'London', 'wide'); });

const built = await page.evaluate(() => {
  const C = window.__Cesium;
  const s = window.__viewer.scene;
  let stage = null;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  if (!stage) return { error: 'нет стадии' };
  // Счётчик шагов внутри плотности + тепловой вывод вместо тонмаппинга.
  let src = stage.fragmentShader
    .split('out_FragColor = flashVeil(outColor);').join('out_FragColor = vec4(0.0, 0.0, 1.0, 1.0);')
    .split('  float T = 1.0;').join('  float T = 1.0;\n  float nIn = 0.0;')
    .split('      if (firstHit < 0.0) firstHit = t;').join('      if (firstHit < 0.0) firstHit = t;\n      nIn += 1.0;')
    .split('  float alpha = clamp((1.0 - T) * u_life, 0.0, 1.0);')
    .join('  float alpha = clamp((1.0 - T) * u_life, 0.0, 1.0);\n'
      + '  out_FragColor = vec4(clamp(alpha, 0.0, 1.0), clamp(length(acc) * 0.02, 0.0, 1.0), clamp(nIn / 180.0, 0.0, 1.0), 1.0);\n'
      + '  return;\n  float fogUnused = 0.0;');
  if (!src.includes('nIn += 1.0')) return { error: 'не удалось вставить счётчик', probe: src.slice(0, 80) };

  const names = ['u_ax0', 'u_ax1', 'u_ax2', 'u_cam', 'u_bound', 'u_boundR', 'u_seed', 'u_age', 'u_steps',
    'u_exposure', 'u_fb', 'u_fbLook', 'u_fbShape', 'u_fbTint', 'u_fbCut', 'u_head', 'u_headShape',
    'u_headColA', 'u_headColB', 'u_headHeat', 'u_headDetail', 'u_lobes', 'u_stem', 'u_stemShape',
    'u_stemCol', 'u_stemWobble', 'u_stemTwist', 'u_stemTopFlare', 'u_skirt', 'u_skirtCol', 'u_skirtFront',
    'u_wind', 'u_windH', 'u_churn', 'u_groundCol', 'u_sunI', 'u_flash', 'u_life', 'u_shock'];
  const plain = {};
  for (const n of names) {
    const v = stage.uniforms[n];
    plain[n] = (v && typeof v === 'object') ? new C.Cartesian4(v.x ?? 0, v.y ?? 0, v.z ?? 0, v.w ?? 0) : v;
  }
  const dbg = s.postProcessStages.add(new C.PostProcessStage({ name: 'kupol-dbg', fragmentShader: src, uniforms: plain }));
  s.preRender.addEventListener(() => {
    if (stage.isDestroyed()) return;
    for (const n of names) {
      const live = stage.uniforms[n];
      const mine = plain[n];
      if (live && typeof live === 'object') { mine.x = live.x; mine.y = live.y; mine.z = live.z; mine.w = live.w; }
      else plain[n] = live;
    }
  });
  // сама стадия-оригинал больше не нужна на экране
  stage.show = false;
  window.__dbg = dbg; window.__names = names;
  return { ok: true, count: names.length, srcLen: src.length };
});
console.log('BUILD', JSON.stringify(built));
if (built.error) { console.log('errors:', JSON.stringify(errs)); await browser.close(); vite.kill('SIGTERM'); process.exit(1); }

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
await sleep(5000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/dbg_mature.png' });
const q = await page.evaluate(() => {
  const st = window.__stage;
  const u = st.uniforms;
  const g = (v, d = 3) => (typeof v === 'number' ? +v.toFixed(d) : v);
  return {
    show: st.show, age: g(u.u_age, 1), life: g(u.u_life), flash: g(u.u_flash), exp: g(u.u_exposure),
    steps: u.u_steps, boundR: Math.round(u.u_boundR), boundY: Math.round(u.u_bound.z),
    headR: Math.round(u.u_head.w), headDens: g(u.u_headShape.z), halfH: Math.round(u.u_headShape.x),
    stemR: Math.round(u.u_stem.z), stemDens: g(u.u_stem.w), stemY0: Math.round(u.u_stem.x), stemY1: Math.round(u.u_stem.y),
    skirtR: Math.round(u.u_skirt.x), skirtH: Math.round(u.u_skirt.y), skirtDens: g(u.u_skirt.z),
    fbR: Math.round(u.u_fb.w), fbOp: g(u.u_fbLook.w), sunI: g(u.u_sunI), windH: Math.round(u.u_windH),
    camAbs: Math.round(Math.hypot(u.u_cam.x, u.u_cam.y, u.u_cam.z)),
  };
});
console.log('STATE', JSON.stringify(q));
console.log('errors:', JSON.stringify(errs.slice(-4)));
await browser.close(); vite.kill('SIGTERM');
