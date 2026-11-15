import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5223, base = `http://127.0.0.1:${port}`;
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

// Инвентарь того, что рисует слой разрушений: размеры эллипсов, точки, боксы.
const inv = await page.evaluate(() => {
  const out = { dsEllipses: [], dsPoints: [], dsBoxes: 0, entEllipses: [], entPoints: [], cam: null };
  const C = window.__Cesium;
  const num = (prop) => { try { return prop && prop.getValue ? prop.getValue(C.JulianDate.now()) : prop; } catch { return 'callback'; } };
  const grab = (coll, bag) => {
    for (const e of coll.values) {
      if (e.ellipse) {
        const maj = num(e.ellipse.semiMajorAxis); const mn = num(e.ellipse.semiMinorAxis);
        const h = num(e.ellipse.height);
        const mat = num(e.ellipse.material);
        bag.dsEllipses.push({ maj: Math.round(Number(maj) || 0), mn: Math.round(Number(mn) || 0), h: Number(h) || 0,
          alpha: mat?.color?.alpha ?? null, css: mat?.color ? `${Math.round(mat.color.red)},${Math.round(mat.color.green)},${Math.round(mat.color.blue)}` : null,
          outline: !!num(e.ellipse.outline) });
      }
      if (e.point) bag.dsPoints.push({ px: num(e.point.pixelSize), color: (() => { const c = num(e.point.color); return c ? `${Math.round(c.red*255)},${Math.round(c.green*255)},${Math.round(c.blue*255)},${Math.round(c.alpha*100)/100}` : null; })(), outline: num(e.point.outlineWidth) });
      if (e.box) bag.dsBoxes += 1;
    }
  };
  grab(window.__viewer.dataSources.get(0).entities, out);
  out.entEllipses = out.dsEllipses.slice(); out.dsEllipses = [];
  out.entPoints = out.dsPoints.slice(); out.dsPoints = [];
  grab(window.__viewer.entities, out);
  const c = window.__viewer.camera.positionCartographic;
  out.cam = { lon: +C.Math.toDegrees(c.longitude).toFixed(3), lat: +C.Math.toDegrees(c.latitude).toFixed(3), altKm: Math.round(c.height / 10) / 100 };
  return out;
});
console.log('INVENTORY', JSON.stringify(inv, null, 1));

// Зрелый гриб БЕЗ сущностей: только объём и спутник.
await page.evaluate((fraction) => {
  const v = window.__viewer;
  let stage = null;
  for (let i = 0; i < v.scene.postProcessStages.length; i += 1) {
    const c = v.scene.postProcessStages.get(i);
    if (String(c.name).startsWith('kupol-blast')) stage = c;
  }
  const rate = window.__volumes[0].timeScale;
  const life = window.__volumes[0].durationSeconds;
  const realNow = performance.now.bind(performance);
  const ageNow = stage.uniforms.u_age / rate;
  const target = realNow() + (life * fraction - ageNow) * 1000;
  const t0 = realNow();
  performance.now = () => target + (realNow() - t0) / 2000;
  v.entities.show = false;
  v.dataSources.get(0).show = false;
  v.scene.globe.depthTestAgainstTerrain = true;
}, 0.62);
await sleep(4000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/clean_mature.png' });
const st = await page.evaluate(() => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const c = s.postProcessStages.get(i);
    if (!String(c.name).startsWith('kupol-blast')) continue;
    return { age: +c.uniforms.u_age.toFixed(1), boundR: Math.round(c.uniforms.u_boundR), steps: c.uniforms.u_steps,
      headR: Math.round(c.uniforms.u_head.w), headY: Math.round(c.uniforms.u_head.y), halfH: Math.round(c.uniforms.u_headShape.x),
      stemY1: Math.round(c.uniforms.u_stem.y), stemR: Math.round(c.uniforms.u_stem.z), skirtR: Math.round(c.uniforms.u_skirt.x), fbR: Math.round(c.uniforms.u_fb.w) };
  }
  return { gone: true };
});
console.log('STATE', JSON.stringify(st));
console.log('errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
