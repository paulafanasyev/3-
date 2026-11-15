// Что рисуется поверх объёмного прохода: перебираем все коллекции сущностей и
// печатаем каждый ellipse/point/polyline с вычисленными show, осями и
// материалом. Кадр на этот вопрос не отвечает: пунктир на земле одинаково даёт
// и знак карты, и полоса конденсации в марше.
import puppeteer from 'puppeteer';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const port = Number(process.env.GAME_PORT || 4237);
const CITY = process.env.CITY || 'London';
const KT = Number(process.env.KT || 1600);
const AGE = Number(process.env.AGE || 8);
const CITIES = {
  London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405],
  Washington: [38.907, -77.037], 'New York': [40.713, -74.005],
};
const [LAT, LON] = CITIES[CITY];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/chrome-signs',
  headless: 'new', protocolTimeout: 1800000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120000 });
  await page.click('.k-start .k-nations button[data-id]');
  await page.waitForFunction(() => window.__kupol?.viewer, { timeout: 120000 });
  await page.evaluate(() => { window.__kupol.viewer.useDefaultRenderLoop = false; });

  // Таймер показа растягиваем, иначе марш снимут до съёмки.
  await page.evaluate(() => {
    const realST = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => realST(fn, ms >= 15000 && ms <= 60000 ? ms * 100 : ms, ...a);
  });
  await page.evaluate(async (lat, lon, kt) => window.__kupol.layers
    .playNuclearTest({ lat, lon }, kt / 1000, { profileId: 'rds37', cityName: 'London', damage: false }), LAT, LON, KT);
  await page.waitForFunction(() => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = 0; i < col.length; i += 1) { if (String(col.get(i)?.name).indexOf('kupol-blast') === 0) return true; }
    return false;
  }, { timeout: 900000, polling: 1500 });

  // Виртуальные часы: тот же возраст, что у снимателя.
  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    window.__vclock = true;
    window.__vnow = real();
    performance.now = () => (window.__vclock ? window.__vnow : real());
  });
  const data = JSON.parse(await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8')));
  const bomb = data.bombs.find((b) => b.id === 'rds37');
  const t0 = blastShapeAt(bomb, zonesForBomb(bomb, KT), KT, 0).timing;
  const rate = Math.min(8, Math.max(t0.tFull / 150, (t0.tHead1 ?? 0) / 3, 1));
  await page.evaluate(([a, r]) => {
    const col = window.__kupol.viewer.scene.postProcessStages;
    for (let i = 0; i < col.length; i += 1) {
      const s = col.get(i);
      if (String(s?.name).indexOf('kupol-blast') !== 0) continue;
      window.__vnow += ((a - Number(s.uniforms.u_age)) / r) * 1000;
    }
  }, [AGE, rate]);
  await sleep(200);

  const report = await page.evaluate(() => {
    const v = window.__kupol.viewer;
    const Cesium = window.Cesium;
    v.render();
    const time = v.clock.currentTime;
    const out = [];
    const sources = [];
    for (let i = 0; i < v.dataSources.length; i += 1) {
      const ds = v.dataSources.get(i);
      sources.push([ds.name || `ds${i}`, ds.entities, ds.show]);
    }
    if (v.entities) sources.push(['viewer.entities', v.entities, v.entities.show]);
    for (const [name, coll, dsShow] of sources) {
      for (const e of coll.values) {
        const g = [];
        if (e.ellipse) g.push('ellipse');
        if (e.point) g.push('point');
        if (e.polyline) g.push('polyline');
        if (e.model) g.push('model');
        if (!g.length) continue;
        const val = (p) => (typeof p?.getValue === 'function' ? p.getValue(time) : p);
        const rec = { src: name, kinds: g, id: e.id, name: e.name, ds: dsShow !== false, show: val(e.show) !== false };
        if (e.ellipse) {
          rec.majorKm = Math.round(Number(val(e.ellipse.semiMajorAxis) || 0) / 100) / 10;
          rec.outline = val(e.ellipse.outline) === true;
          const m = val(e.ellipse.material);
          rec.matAlpha = m?.color ? Math.round(m.color.alpha * 100) / 100 : (m ? 'other' : null);
          rec.outlineAlpha = m ? null : Math.round(Number(val(e.ellipse.outlineColor)?.alpha ?? 0) * 100) / 100;
        }
        if (e.point) {
          rec.px = Math.round(Number(val(e.point.pixelSize) || 0) * 10) / 10;
          rec.colorAlpha = Math.round(Number(val(e.point.color)?.alpha ?? 0) * 100) / 100;
        }
        out.push(rec);
      }
    }
    const col = v.scene.postProcessStages;
    let stage = null;
    for (let i = 0; i < col.length; i += 1) { if (String(col.get(i)?.name).indexOf('kupol-blast') === 0) stage = col.get(i); }
    return {
      entities: out,
      volume: stage ? {
        enabled: stage.enabled === true,
        age: Math.round(Number(stage.uniforms.u_age) * 10) / 10,
        shock2: [Number(stage.uniforms.u_shock2?.x), Number(stage.uniforms.u_shock2?.y), Number(stage.uniforms.u_shock2?.z)].map((x) => Math.round(x * 100) / 100),
        rings: [Number(stage.uniforms.u_ring0?.w ?? 0), Number(stage.uniforms.u_ring1?.w ?? 0), Number(stage.uniforms.u_ring2?.w ?? 0)],
      } : null,
    };
  });
  console.log(`объёмный проход: ${JSON.stringify(report.volume)}`);
  console.log(`всего графических сущностей: ${report.entities.length}`);
  const groups = {};
  for (const e of report.entities) {
    const k = `${e.src}|${e.kinds.join(',')}|show=${e.show}`;
    groups[k] = groups[k] || { n: 0, sample: [] };
    groups[k].n += 1;
    if (groups[k].sample.length < 3) groups[k].sample.push(e);
  }
  for (const [k, g] of Object.entries(groups)) console.log(`${k} × ${g.n}`);
  console.log('знаки удара (ellipse):');
  for (const e of report.entities.filter((q) => q.kinds.includes('ellipse'))) console.log('  ', JSON.stringify(e));
} finally {
  await browser.close();
}
