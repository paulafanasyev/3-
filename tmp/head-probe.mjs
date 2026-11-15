// Профиль шляпы и ножки по возрастам: что именно модель даёт шейдеру, когда
// на кадре видно «пушистый шар» вместо гриба. Смотрим формы (r/halfH —
// плоскость купола, torus — доля «шляпки-бублика»), амплитуду деталей и то,
// расходится ли ножка под шляпой.
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const id = process.argv[2] || 'ivy_king';
const kt = Number(process.argv[3] || 150);
const ages = (process.argv[4] || '8,22,40,55,66').split(',').map(Number);
const bomb = profiles.bombs.find((b) => b.id === id);
if (!bomb) { console.log(`профиля ${id} нет`); process.exit(1); }
const zones = zonesForBomb(bomb, kt);
const tFull = blastShapeAt(bomb, zones, kt, 0).timing.tFull;
console.log(`${id} @${kt} кт: tFull ${tFull.toFixed(0)} с`);
console.log('s      boundY  headY  headR  halfH  R/H   torus dens  noiseAmp billow erod lobeGain lobes | stemX stemY stemR stemW flare');
for (const s of ages) {
  const st = blastShapeAt(bomb, zones, kt, s);
  const h = st.head, sm = st.stem;
  const f = (v, d = 0) => Number(v).toFixed(d).padStart(6);
  console.log(
    `${f(s, 1)} ${f(st.bound.y)} ${f(h.y)} ${f(h.r)} ${f(h.halfH)} ${(h.r / Math.max(h.halfH, 1)).toFixed(2).padStart(5)} `
    + `${f(h.torus, 2)} ${f(h.density, 2)} ${f(h.noiseAmp, 3)} ${f(h.billow, 2)} ${f(h.erosion, 2)} ${f(h.lobeGain, 2)} ${f(h.lobes, 2)} | `
    + `${f(sm.x)} ${f(sm.y)} ${f(sm.z)} ${f(sm.w, 2)} ${f(st.stemTopFlare ?? 0, 2)}`,
  );
}
