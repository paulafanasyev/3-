// Замер формы объёмного взрыва по реальным профилям бомб: пылевой вал обязан
// ехать строго за фронтом ударной волны, а не по придуманной кривой.
import { readFileSync } from 'node:fs';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb, shockRadiusM } from '../src/game/client/nuclearBlastModel.js';

const db = JSON.parse(readFileSync(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8'));
const byId = new Map(db.bombs.map((b) => [b.id, b]));
const ids = process.argv[2] ? process.argv[2].split(',') : ['little_boy', 'castle_bravo', 'tsar'];
const f = (v, w = 10) => String(Number.isFinite(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)) : v).padStart(w);

for (const id of ids) {
  const p = byId.get(id);
  if (!p) { console.log(`no profile "${id}" (have: ${[...byId.keys()].join(',')})`); continue; }
  const kt = Math.max(0.001, p.yield_kt);
  const zones = zonesForBomb(p, kt);
  console.log(`\n=== ${id}  ${f(kt, 8)} kt  ${p.burst_type}  h=${p.burst_height_m} m`);
  console.log(['s', 'slant km', 'dustR km', 'dustH m', 'dens', 'fbR', 'fbT K', 'headY', 'capR', 'boundR']
    .map((x) => x.padStart(10)).join(''));
  for (const s of [0.05, 0.2, 1, 3, 8, 20, 45, 90, 200, 400]) {
    const st = blastShapeAt(p, zones, kt, s);
    console.log([
      f(s), f(shockRadiusM(kt, s, st.skirt.front >= 1) / 1000), f(st.skirt.r / 1000), f(st.skirt.h),
      f(st.skirt.density), f(st.fireball.r), f(st.fireball.temp), f(st.head.y), f(st.head.r), f(st.bound.r),
    ].join(''));
  }
  const bad = [];
  for (let s = 0.05; s < 900; s *= 1.05) {
    const st = blastShapeAt(p, zones, kt, s);
    if (!Number.isFinite(st.bound.r) || st.bound.r <= 0) bad.push(`bound ${s.toFixed(2)}=${st.bound.r}`);
    if (!(st.skirt.r >= 0) || !(st.skirt.h > 0)) bad.push(`skirt ${s.toFixed(2)}`);
    if (!(st.fireball.r > 0) || !(st.fireball.temp > 0)) bad.push(`fireball ${s.toFixed(2)}`);
    if (!(st.head.r > 0) || !(st.head.halfH > 0)) bad.push(`head ${s.toFixed(2)}`);
    if (st.head.y < st.fireball.y * 0.0) bad.push(`head below ${s.toFixed(2)}`);
  }
  console.log(bad.length ? `NON-FINITE/DEGENERATE: ${bad.slice(0, 8).join(' | ')}` : 'shape sane across 0.05..900 s');
}
