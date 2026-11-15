import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';
import db from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
const now = new Date();
for (const id of ['little_boy', 'castle_bravo', 'tsar']) {
  const p = db.bombs.find(b => b.id === id);
  const z = zonesForBomb(p, p.yield_kt);
  const st0 = blastShapeAt(p, z, p.yield_kt, 0).timing;
  const rate = Math.min(8, Math.max(1, st0.tHead1 * 4 / 30));
  const life = Math.min(180, Math.max(40, st0.tFull * 0.45 / rate));
  console.log(`\n${id} W=${p.yield_kt}kt rate=${rate.toFixed(2)} life=${life.toFixed(0)}s tHead1=${st0.tHead1.toFixed(1)} tFull=${st0.tFull.toFixed(1)}`);
  for (const wall of [0.5, 1, 3.5, 8.5, 20]) {
    const t = wall * rate;
    const s = blastShapeAt(p, z, p.yield_kt, t);
    const f = s.fireball ?? {}; const h = s.head ?? {}; const sk = s.skirt ?? {};
    console.log(`  wall=${wall}s model=${t.toFixed(1)}s fbR=${(f.r ?? 0).toFixed(0)} fbOp=${(f.opacity ?? 0).toFixed(3)} fbT=${(f.temp ?? 0).toFixed(0)} headDens=${(h.density ?? 0).toFixed(3)} headR=${(h.r ?? 0).toFixed(0)} headY=${(h.y ?? 0).toFixed(0)} skirtR=${(sk.r ?? 0).toFixed(0)} skirtDens=${(sk.density ?? 0).toFixed(3)}`);
  }
}
console.log('\nsun now UTC', now.toISOString());
