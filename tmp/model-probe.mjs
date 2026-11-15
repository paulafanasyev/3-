// Прогон модели по модельным возрастам без браузера: где шляпа появляется,
// где шум долек гаснет, и до какого возраста вообще жив показ.
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const bomb = profiles.bombs.find((b) => b.id === (process.env.BOMB || 'little_boy'));
const zones = zonesForBomb(bomb, bomb.yield_kt);
const P = bomb.profile;
const st0 = blastShapeAt(P, zones, bomb.yield_kt, 0);
console.log('bomb', bomb.id, 'yield_kt', bomb.yield_kt);
console.log('timing', JSON.stringify(st0.timing));
const FULL_WINDOW = 150, HEAD1_MIN = 3;
const rate = Math.min(8, Math.max(1, Math.max(st0.timing.tFull / FULL_WINDOW, st0.timing.tHead1 / HEAD1_MIN)));
const life = Math.min(200, Math.max(40, st0.timing.tFull / rate));
console.log('rate', rate.toFixed(3), '| life реальных сек', life.toFixed(1), '| tFull', st0.timing.tFull,
  '| max s живой показ =', (life * rate).toFixed(0));
const f = (n, w = 7) => String(Number.isFinite(n) ? n.toFixed(1) : n).padStart(w);
console.log('   s alive| head.y  head.r  head.H  dens noiseAmp torus| stem.y1 stem.r| wind.xz   churn| fb.r');
for (const s of [1, 5, 10, 20, 40, 60, 90, 120, 160, 200, 250, 300, 360, 420, 480, 514, 560, 620, 700, 800]) {
  const st = blastShapeAt(P, zones, bomb.yield_kt, s);
  if (!st.alive) { console.log(String(s).padStart(5), 'DEAD'); continue; }
  console.log(
    String(s).padStart(5), '  y  ',
    f(st.head.y, 8), f(st.head.r, 8), f(st.head.halfH, 8), f(st.head.density, 6), f(st.head.noiseAmp, 7), f(st.head.torus, 6),
    '|', f(st.stem.y1, 8), f(st.stem.r, 8),
    '|', `${st.wind[0].toFixed(1)},${st.wind[1].toFixed(1)}`.padStart(9), f(st.churn, 6),
    '| fb', f(st.fireball.r, 7), 'skirt', f(st.skirt.r, 6),
  );
}
