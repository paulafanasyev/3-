// Разбор формы облака для Малыша: что реально уходит в униформы по модельным секундам.
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const id = process.argv[2] || 'little_boy';
const bomb = profiles.bombs.find((b) => b.id === id);
const zones = zonesForBomb(bomb, bomb.yield_kt);
const timing = blastShapeAt(bomb, zones, bomb.yield_kt, 0).timing;
const rate = Math.max(1, Math.min(8, (timing.tHead1 * 4) / 30));
const life = Math.max(40, Math.min(180, (timing.tFull * 0.45) / rate));
console.log(id, 'rate', rate.toFixed(2), 'life', life.toFixed(1), 'sMax', (life * rate).toFixed(0));
console.log('timing', JSON.stringify(timing));
for (const s of [10, 30, 60, 90, 127, 160, 200]) {
  const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
  const f = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const flat = (o) => (Array.isArray(o) ? o.map(f) : o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])) : f(o));
  console.log(`s=${s}`, JSON.stringify({
    head: flat(st.head), headShape: flat(st.headShape), stem: flat(st.stem),
    skirt: flat(st.skirt), fb: flat(st.fb), rings: st.rings?.map(flat),
    ice: flat(st.ice), ice2: flat(st.ice2), dome: flat(st.dome), bound: flat(st.bound),
  }));
}
