// Во сколько у ivy_king на 150 кт nonzero кольца и ледяная шапка — чтобы живой
// прогон снимал кадры на этих возрастах, а не наугад.
import { readFileSync } from 'node:fs';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb, nearestAirBurstProfile } from '../src/game/client/nuclearBlastModel.js';
const data = JSON.parse(readFileSync(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8'));
const nz = (a) => Array.isArray(a) && a.some((v) => Number(v) > 0);
for (const kt of [150, 1600]) {
  const p = nearestAirBurstProfile(data.bombs, kt);
  const z = zonesForBomb(p, kt);
  const out = [];
  for (let s = 2; s <= 460; s += 2) {
    const st = blastShapeAt(p, z, kt, s);
    const f = [];
    if (nz(st.rings?.[0])) f.push('r0');
    if (nz(st.rings?.[1])) f.push('r1');
    if (nz(st.rings?.[2])) f.push('r2');
    if (nz(st.rings?.[3])) f.push('r3');
    if (nz(st.ice)) f.push('ice');
    if (nz(st.ice2)) f.push('ice2');
    if (nz(st.dome)) f.push('dome');
    if (f.length) out.push(`${s}:${f.join(',')}`);
  }
  console.log(`${p.id}@${kt}кт cloudTop=${(z.cloudTopKm||0).toFixed(1)}км: ${out.join(' ') || 'ничего'}`);
}
