// Замер: какая подложка Земли реально стоит в игре и что видит камера над London.
import puppeteer from 'puppeteer';

const port = Number(process.env.GAME_PORT || 4237);
const CITY = process.env.CITY || 'London';
const ALT = Number(process.env.ALT || 3000);
const TILT = Number(process.env.TILT || -35);

const browser = await puppeteer.launch({
  headless: 'new', protocolTimeout: 1800000,
  userDataDir: 'D:/mt5/tmp-nuclear/chrome-probe',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const errs = [];
const hosts = new Map();
page.on('console', (m) => { if (m.type() === 'error') errs.push(`${m.type()} ${m.text().slice(0, 200)}`); });
page.on('requestfailed', (r) => errs.push(`reqfail ${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400) errs.push(`http ${r.status()} ${u.slice(0, 140)}`);
  try {
    const host = new URL(u).host;
    const isImg = /tile|imagery|z\//.test(u) || /\.(png|jpe?g|webp)/i.test(u);
    if (!isImg) return;
    const k = `${host} ${r.status()}`;
    hosts.set(k, (hosts.get(k) || 0) + 1);
  } catch { /* не-http схема */ }
});

await page.goto(`http://127.0.0.1:${port}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__kupol?.viewer, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 20000));

const info = await page.evaluate(() => {
  const v = window.__kupol.viewer;
  const layers = v.imageryLayers.length;
  const desc = [];
  for (let i = 0; i < layers; i++) {
    const L = v.imageryLayers.get(i);
    const p = L.imageryProvider;
    desc.push({
      i, kind: p.constructor.name, url: p.url || '', ready: p.ready,
      level: p.maximumLevel, alpha: L.alpha, show: L.show,
      prov: p.provider ? p.provider.constructor.name : '',
    });
  }
  const tiles = v.scene.globe._surface._tilesToRender || [];
  const urls = [];
  for (const t of tiles.slice(0, 8)) {
    for (const im of t.imagery || []) {
      const raw = im.tile?.imagery;
      urls.push(String(raw?.url ?? raw?._resource ?? raw ?? '').slice(0, 150));
    }
  }
  return {
    layers, desc, tilesToRender: tiles.length, urls,
    source: v.__kupolImagerySource ?? null,
    state: window.__kupol.state?.imagerySource ?? null,
  };
});
console.log('слоёв подложки:', info.layers, 'источник из state:', info.state, '/', info.source);
for (const d of info.desc) console.log(`  #${d.i}: ${d.kind}${d.prov ? `<-${d.prov}` : ''} ready=${d.ready} maxLevel=${d.level} alpha=${d.alpha} show=${d.show} url=${d.url}`);
console.log('тайлов в отрисовке:', info.tilesToRender);
for (const u of [...new Set(info.urls)].slice(0, 8)) console.log('  тайл:', u);

// ракурс над самим городом: видны ли постройки и снимок
const cam = await page.evaluate(([alt, tilt]) => {
  const v = window.__kupol.viewer; const C = window.Cesium;
  document.getElementById('kupol-root')?.style.setProperty('display', 'none');
  v.camera.cancelFlight();
  v.camera.setView({
    destination: C.Cartesian3.fromDegrees(-0.119, 51.502, alt),
    orientation: { heading: 0, pitch: C.Math.toRadians(tilt), roll: 0 },
  });
  const t0 = performance.now();
  v.render();
  return { alt: v.camera.positionCartographic.height, renderMs: performance.now() - t0 };
}, [ALT, TILT]);
console.log(`камера: высота ${Math.round(cam.alt)} м, синхронный render ${Math.round(cam.renderMs)} мс`);
await new Promise((r) => setTimeout(r, 25000));
await page.evaluate(() => { window.__kupol.viewer.render(); window.__kupol.viewer.render(); });
await page.screenshot({ path: `D:/mt5/tmp-nuclear/shots/imagery-probe-${CITY}.png` });

const byHost = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('запрошенные тайлы/картинки по хостам:', JSON.stringify(byHost));
console.log('ошибки:', JSON.stringify([...new Set(errs)].slice(0, 14), null, 1));
await browser.close();
