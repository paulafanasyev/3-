import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb, shockRadiusM } from '../src/game/client/nuclearBlastModel.js';

const cbrt = (x) => Math.cbrt(Math.max(1e-6, x));
for (const id of ['trinity', 'little_boy', 'castle_bravo', 'tsar', 'rds37']) {
  const bomb = profiles.bombs.find((b) => b.id === id);
  const zones = zonesForBomb(bomb, bomb.yield_kt);
  const surface = zones.burstType !== 'NUCLEAR_AIR' && zones.burstType !== 'NUCLEAR_HIGH_AIR';
  const hob = Math.max(0, bomb.burst_height_m ?? 0);
  const art = bomb.profile ?? {};
  console.log(`\n${id} W=${bomb.yield_kt} kt surface=${surface} hob=${hob} burst=${bomb.burst_type} skirt=${art.skirt} skirt_height=${art.skirt_height} skirt_max_r=${art.skirt_max_r} fade=${JSON.stringify(art.skirt_fade_s)} col_height=${art.col_height} surge_inner=${art.surge_inner}`);
  for (const s of [1, 4, 16, 64, 256, 1024]) {
    const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
    const slant = shockRadiusM(bomb.yield_kt, s, surface);
    const frontR = Math.sqrt(Math.max(0, slant * slant - hob * hob));
    const r3 = 2200 * cbrt(bomb.yield_kt) * (surface ? 2 ** (1 / 3) : 1) / 3 ** (2 / 3);
    const cap = Math.max(st.timing.fireballMax, art.skirt_max_r ?? r3 * 0.9);
    console.log(` s=${s} fbMax=${st.timing.fireballMax.toFixed(1)} skirt r=${st.skirt.r.toFixed(1)} h=${st.skirt.h.toFixed(1)} d=${st.skirt.density.toFixed(3)} inner=${st.skirt.inner.toFixed(3)} front=${st.skirt.front}` +
      ` | frontR=${frontR.toFixed(1)} cap=${cap.toFixed(1)} min=${Math.min(frontR, cap).toFixed(1)} h/r=${(st.skirt.h / Math.max(st.skirt.r, 1)).toFixed(4)}`);
  }
}
