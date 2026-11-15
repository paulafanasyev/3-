import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5217, base = `http://127.0.0.1:${port}`;
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

// 1. Кто вообще на сцене: стадии, слои,DataSource, примитивы.
const census = await page.evaluate(() => {
  const s = window.__viewer.scene;
  const stages = [];
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    let hasAgx = null, len = null;
    try {
      const src = c.fragmentShader;
      if (typeof src === 'string') { hasAgx = src.includes('agxTone'); len = src.length; }
    } catch { /* нет доступа к исходнику стадии */ }
    stages.push({ name: String(c.name), show: c.show, enabled: c.enabled, hasAgx, len });
  }
  const ds = [];
  try {
    const coll = window.__viewer.dataSources;
    for (let i = 0; i < coll.length; i += 1) { const d = coll.get(i); ds.push({ name: d.name, show: d.show, ents: d.entities.values.length }); }
  } catch (e) { ds.push({ error: String(e.message) }); }
  const prims = [];
  for (let i = 0; i < s.primitives.length; i += 1) prims.push(String(s.primitives.get(i).constructor?.name));
  return {
    stages, ds, prims,
    entities: window.__viewer.entities.values.length,
    entityShow: window.__viewer.entities.show,
    volState: window.__volState ? window.__volState().filter(Boolean).map((st) => ({
      lobes: st.head?.lobes, billow: st.head?.billow, cellRel: st.head?.cellRel,
      erosion: st.head?.erosion, noiseAmp: st.head?.noiseAmp, darkBase: st.head?.darkBase,
      headR: Math.round(st.head?.r ?? 0), headY: Math.round(st.head?.y ?? 0),
      stemR: Math.round(st.stem?.r ?? 0), twist: st.stem?.twist, wobble: st.stem?.wobble,
      exposure: +st.exposure?.toFixed?.(3) ?? null,
    })) : null,
  };
});
console.log('CENSUS', JSON.stringify(census, null, 1));

// Полный дамп униформ ДО медленных кадров: стадия живёт считанные десятки секунд.
const uni = await page.evaluate(() => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (!String(c.name).startsWith('kupol-blast')) continue;
    const q = c.uniforms; const out = {};
    for (const k of Object.keys(q)) {
      if (!k.startsWith('u_')) continue;
      const v = q[k];
      out[k] = typeof v === 'object' && v !== null
        ? [v.x, v.y, v.z, v.w].map((n) => (Number.isFinite(n) ? +n.toFixed(2) : n))
        : v;
    }
    return out;
  }
  return { gone: true };
});
console.log('UNIFORMS', JSON.stringify(uni));

// 2. Три кадра: всё / только объём (сущности гасим) / только сущности (стадию гасим).
const shot = async (name) => page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/who_${name}.png` });
await page.evaluate(() => { window.__viewer.entities.show = false; });
await sleep(1200); await shot('vol_only');
await page.evaluate(() => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) c.show = false;
  }
  for (let i = 0; i < window.__viewer.dataSources.length; i += 1) window.__viewer.dataSources.get(i).show = false;
});
await sleep(1500); await shot('stage_off');
console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
