import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
for (const b of profiles.bombs) {
  const t = blastShapeAt(b, zonesForBomb(b, b.yield_kt), b.yield_kt, 0).timing;
  const rateOld = clamp((t.tHead1 * 4) / 30, 1, 8);
  const lifeOld = clamp((t.tFull * 0.45) / rateOld, 40, 180);
  const sMaxOld = rateOld * lifeOld;
  const rateNew = clamp(Math.max(t.tFull / 150, t.tHead1 / 3), 1, 8);
  const lifeNew = clamp(t.tFull / rateNew, 40, 200);
  console.log(
    b.id.padEnd(15), b.yield_kt,
    '| tHead1', t.tHead1.toFixed(1).padStart(6), 'tFull', String(t.tFull).padStart(6),
    '| old rate', rateOld.toFixed(2), 'sMax', sMaxOld.toFixed(0).padStart(4), `(${(sMaxOld / t.tFull).toFixed(2)} tFull)`,
    '| new rate', rateNew.toFixed(2), 'life', lifeNew.toFixed(0), 'sMax', (rateNew * lifeNew).toFixed(0).padStart(4),
    `(${((rateNew * lifeNew) / t.tFull).toFixed(2)} tFull)`,
    '| head1@', (t.tHead1 / rateNew).toFixed(1), 's',
  );
}
