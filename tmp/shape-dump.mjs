// Быстрый замер формы без браузера: соотношение шапки, колонны и ограничителя.
import { readFileSync } from 'node:fs';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';

const json = JSON.parse(readFileSync('src/game/data/source-bomb-profiles.json', 'utf8'));
const id = process.argv[2] || 'little_boy';
const bomb = json.bombs.find((b) => b.id === id);
const p = bomb.profile;
const zones = {
  cloudTopKm: (p.cloud_top_m || 12500) / 1000,
  cloudCapKm: (p.cap_radius_m || 2250) * 2 / 1000,
  fireball: 200,
};
const yk = bomb.yield_kt ?? bomb.yieldKt ?? 15;
console.log(id, 'yieldKt', yk, 'cap_radius_m', p.cap_radius_m, 'stem_radius_m', p.stem_radius_m,
  'cloud_top_m', p.cloud_top_m, 't_stab_s', p.t_stab_s);
for (const s of [20, 72, 180, 330, 587, 900]) {
  const st = blastShapeAt(p, zones, yk, s);
  const capD = st.head.r * 2;
  const stemD = st.stem.r * 2;
  const topY = st.head.y + st.head.halfH;
  console.log(`s=${s}`,
    `capD=${Math.round(capD)}`, `capH=${Math.round(st.head.halfH * 2)}`,
    `stemD=${Math.round(stemD)}`, `stemTop=${Math.round(st.stem.y1)}`,
    `capTop=${Math.round(topY)}`, `capD/topY=${(capD / topY).toFixed(2)}`,
    `capR/stemR=${(st.head.r / Math.max(st.stem.r, 1)).toFixed(2)}`,
    `bound=${Math.round(st.bound.r)}`, `torus=${st.head.torus.toFixed(2)}`,
    `skirt=${Math.round(st.skirt.r)}x${Math.round(st.skirt.h)}`);
}
