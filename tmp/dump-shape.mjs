// Дашборд формы гриба по модельным секундам — без браузера, чистая CPU-функция.
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const bomb = profiles.bombs.find((b) => b.id === 'castle_bravo');
const zones = zonesForBomb(bomb, bomb.yield_kt);
const d = (p) => Math.abs(Math.log(p.yield_kt / bomb.yield_kt));
const profile = profiles.bombs.slice().sort((a, b) => d(a) - d(b))[0];
const timing = blastShapeAt(profile, zones, bomb.yield_kt, 0).timing;
const rate = Math.max(1, Math.min(8, timing.tHead1 * 4 / 30));
const life = Math.max(40, Math.min(180, timing.tFull * 0.45 / rate));
console.log('profile', profile.id, profile.name, 'yieldKt', bomb.yield_kt,
  'rate', rate.toFixed(2), 'life', life.toFixed(1), 'timing', JSON.stringify(timing));

const f = (v, w = 8) => String(Math.round((Number(v) || 0) * 1000) / 1000).padStart(w);
const sMax = life * rate; // предельный модельный возраст, которого успевает дойти облако
for (const fr of [0.06, 0.15, 0.3, 0.45, 0.62, 0.8, 0.95]) {
  const s = sMax * fr;
  const st = blastShapeAt(profile, zones, bomb.yield_kt, s);
  if (!st.alive) { console.log(fr, 'мёртв'); continue; }
  console.log(`\n== доля ${fr}  модельных с ${s.toFixed(0)} ==`);
  console.log(' head  y', f(st.head.y), 'r', f(st.head.r), 'halfH', f(st.head.halfH),
    'torus', f(st.head.torus), 'dens', f(st.head.density), 'roll', f(st.head.roll),
    'noiseAmp', f(st.head.noiseAmp), 'billow', f(st.head.billow), 'erosion', f(st.head.erosion), 'lobes', f(st.head.lobes));
  console.log(' head  heatK', f(st.head.heatK), 'heatGlow', f(st.head.heatGlow), 'heatRadius', f(st.head.heatRadius),
    'cellRel', f(st.head.cellRel), 'colMix', f(st.head.colMix), 'darkBase', f(st.head.darkBase),
    'colA', st.head.colA.map((x) => x.toFixed(2)).join(','), 'colB', st.head.colB.map((x) => x.toFixed(2)).join(','));
  console.log(' stem  y0', f(st.stem.y0), 'y1', f(st.stem.y1), 'r', f(st.stem.r), 'dens', f(st.stem.density),
    'flare', f(st.stem.flare), 'waist', f(st.stem.waist), 'hollow', f(st.stem.hollow), 'rise', f(st.stem.rise),
    'wobble', f(st.stem.wobble), 'twist', f(st.stem.twist), 'topFlare', f(st.stem.topFlare),
    'stretch', f(st.stem.stretch), 'col', st.stem.col.map((x) => x.toFixed(2)).join(','));
  console.log(' fb    y', f(st.fireball.y), 'r', f(st.fireball.r), 'op', f(st.fireball.opacity),
    'temp', f(st.fireball.temp), 'emission', f(st.fireball.emission), 'noise', f(st.fireball.noise),
    'squash', f(st.fireball.squash), 'mottle', f(st.fireball.mottle), 'skin', f(st.fireball.skin), 'cut', f(st.fireball.cut));
  console.log(' skirt r', f(st.skirt.r), 'h', f(st.skirt.h), 'dens', f(st.skirt.density),
    'inner', f(st.skirt.inner), 'front', f(st.skirt.front), 'col', st.skirt.col.map((x) => x.toFixed(2)).join(','));
  console.log(' bound y', f(st.bound.y), 'r', f(st.bound.r), 'wind', st.wind.map((x) => x.toFixed(1)).join(','),
    'windH', f(st.windH), 'churn', f(st.churn), 'ground', st.groundCol.map((x) => x.toFixed(2)).join(','));
}
