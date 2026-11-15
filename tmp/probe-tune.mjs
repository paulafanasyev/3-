import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5221, base = `http://127.0.0.1:${port}`;
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

const meta = await page.evaluate(() => ({
  life: window.__volumes[0].durationSeconds, rate: window.__volumes[0].timeScale,
}));
console.log('META', JSON.stringify(meta));

// Перематываем к зрелому грибу и замораживаем часы.
await page.evaluate((fraction) => {
  const v = window.__viewer.scene;
  let stage = null;
  for (let i = 0; i < v.postProcessStages.length; i += 1) {
    const c = v.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const ageNow = stage.uniforms.u_age / rate;
  const target = startedGuess(ageNow, life, fraction);
  function startedGuess(age, lf, f) {
    const t = realNow();
    return t - age * 1000 + (lf * f - age) * 1000;
  }
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
}, 0.62);

// Хук поверх униформ стадии: применяется ПОСЛЕ внутреннего update, поэтому
// перебивает любой примитив по одному — единственный способ понять, кто рисует шары.
await page.evaluate(() => {
  const s = window.__viewer.scene;
  let stage = null;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  window.__stage = stage;
  window.__over = {};
  s.preRender.addEventListener(() => {
    if (!stage || stage.isDestroyed()) return;
    for (const k of Object.keys(window.__over)) {
      const v = window.__over[k];
      const u = stage.uniforms[k];
      if (u && typeof v === 'object' && typeof u === 'object') {
        u.x = v.x; u.y = v.y; u.z = v.z; if ('w' in u && 'w' in v) u.w = v.w;
      } else if (u !== undefined) stage.uniforms[k] = v;
    }
  });
});
const dump = () => page.evaluate(() => {
  const q = window.__stage.uniforms;
  const r = (v, n = 3) => (v && typeof v === 'object'
    ? [v.x, v.y, v.z, v.w].filter((n2) => n2 !== undefined).map((n2) => +n2.toFixed(n))
    : +v.toFixed(n));
  return { age: +q.u_age.toFixed(1), boundR: Math.round(q.u_boundR), steps: q.u_steps,
    head: r(q.u_head), headShape: r(q.u_headShape), headDetail: r(q.u_headDetail),
    headHeat: r(q.u_headHeat), headColA: r(q.u_headColA), headColB: r(q.u_headColB),
    stem: r(q.u_stem), stemShape: r(q.u_stemShape), stemCol: r(q.u_stemCol), topFlare: +q.u_stemTopFlare.toFixed(2),
    skirt: r(q.u_skirt), skirtCol: r(q.u_skirtCol), fb: r(q.u_fb), fbLook: r(q.u_fbLook),
    exposure: +q.u_exposure.toFixed(3), sunI: +q.u_sunI.toFixed(2), life: +q.u_life.toFixed(2) };
});
console.log('DUMP', JSON.stringify(await dump()));
const shot = async (name, over) => {
  await page.evaluate((o) => { window.__over = o; window.__viewer.scene.requestRender(); }, over);
  await sleep(2500);
  await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/tune_${name}.png` });
  console.log(name, JSON.stringify(await dump()));
};
const ZERO = { x: 0, y: 0, z: 0, w: 0 };
await shot('mature', {});
await shot('only_head', { u_skirt: ZERO, u_stem: ZERO, u_fb: ZERO });
await shot('head_smooth', { u_skirt: ZERO, u_stem: ZERO, u_fb: ZERO, u_headDetail: { x: 0, y: 1.3, z: 0.8, w: 0 } });
console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
