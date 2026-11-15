import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const port = 5213, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
let viteOut = ''; vite.stdout.on('data', (c) => { viteOut += c; }); vite.stderr.on('data', (c) => { viteOut += c; });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${base}/preview.html`)).ok) break; } catch {} await sleep(500); }
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE ${m.text().slice(0, 300)}`); });
await page.goto(`${base}/preview.html`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
await page.waitForFunction('window.ready === true', { timeout: 120000 });

// средняя яркость прямоугольника уже снятого скриншота — декодируем в самой странице
const lum = async (buf, x0, y0, w, h) => page.evaluate(async (b64, x, y, ww, hh) => {
  const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const c = new OffscreenCanvas(ww, hh);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, x, y, ww, hh, 0, 0, ww, hh);
  const d = ctx.getImageData(0, 0, ww, hh).data;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n += 1; }
  return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
}, buf.toString('base64'), x0, y0, w, h);

const box = [520, 250, 260, 200];

await page.evaluate(async () => {
  await window.runTest('castle_bravo', 'London', 'wide');
  await new Promise((x) => setTimeout(x, 3000));
  const s = window.__viewer.scene;
  let st = null;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const cand = s.postProcessStages.get(i);
    if (String(cand.name).startsWith('kupol-blast')) st = cand;
  }
  const u = st?.uniforms || {};
  window.__info = {
    stage: !!st, show: st?.show, boundR: u.u_boundR, steps: u.u_steps, life: u.u_life,
    exposure: u.u_exposure, headR: u.u_head?.w, headDens: u.u_headShape?.z, headY: u.u_head?.y,
    stemR: u.u_stem?.z, skirtR: u.u_skirt?.x, fbR: u.u_fb?.w, boundZ: u.u_bound?.z,
    ax0: [u.u_ax0?.x, u.u_ax0?.y, u.u_ax0?.z].map((v) => Number(v?.toFixed?.(4))),
    cam: [u.u_cam?.x, u.u_cam?.y, u.u_cam?.z].map((v) => Math.round(v)),
    entities: window.__viewer.entities.values.length,
  };
});
console.log('info:', JSON.stringify(await page.evaluate(() => window.__info)));

const shotVol = await page.screenshot();
await page.evaluate(() => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const cand = s.postProcessStages.get(i);
    if (String(cand.name).startsWith('kupol-blast')) cand.show = false;
  }
});
await sleep(500);
const shotOff = await page.screenshot();
await page.evaluate(() => {
  const s = window.__viewer.scene;
  for (let i = 0; i < s.postProcessStages.length; i += 1) {
    const cand = s.postProcessStages.get(i);
    if (String(cand.name).startsWith('kupol-blast')) cand.show = true;
  }
  window.__viewer.entities.removeAll();
});
await sleep(500);
const shotNoEnt = await page.screenshot();
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/probe_vol_only.png' });

console.log('vol+ent :', await lum(shotVol, ...box));
console.log('vol off :', await lum(shotOff, ...box));
console.log('vol only:', await lum(shotNoEnt, ...box));
console.log('page errors:', JSON.stringify(errs.slice(-6)));
await browser.close(); vite.kill('SIGTERM');
