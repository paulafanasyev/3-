// Замер #23: кольца конденсации, ледяные шапки и купол грунта вообще когда-нибудь
// nonzero? Логи свипов снимали состояние только на возрасте 450 с, где всё ноль,
// поэтому вывод по ним не доказательство. Здесь вызываем чистую blastShapeAt по
// всем профилям и возрастам — без браузера.
import { readFileSync } from 'node:fs';
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';

const file = new URL('../src/game/data/source-bomb-profiles.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data.bombs) ? data.bombs : Object.values(data.bombs ?? {});

const AGES = [0.2, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 450];
const nz = (a) => Array.isArray(a) && a.some((v) => Number(v) > 0);

let ringHits = 0, iceHits = 0, domeHits = 0, rows = 0;
const perProfile = [];
for (const p of list) {
  const art = p.profile ?? {};
  const name = p.id ?? p.name ?? art.id ?? '?';
  const zones = p.zones ?? {};
  const yk = p.yield_kt ?? p.yieldKt ?? 1000;
  const seen = { ring: 0, ice: 0, dome: 0 };
  for (const s of AGES) {
    let st;
    try { st = blastShapeAt(p, zones, yk, s); } catch (e) { console.log(`ERR ${name} @${s}: ${e.message}`); continue; }
    if (!st) continue;
    rows += 1;
    if (nz(st.rings?.[0]) || nz(st.rings?.[1]) || nz(st.rings?.[2]) || nz(st.rings?.[3])) seen.ring += 1;
    if (nz(st.ice)) seen.ice += 1;
    if (nz(st.dome)) seen.dome += 1;
  }
  if (seen.ring) ringHits += 1;
  if (seen.ice) iceHits += 1;
  if (seen.dome) domeHits += 1;
  perProfile.push({ name, ...seen, hasRings: art.rings, hasDome: art.dome_r, tier1: !!art.tier1, tier2: !!art.tier2 });
}

console.log(`profiles=${list.length} samples=${rows}`);
console.log(`profile-count с nonzero: rings=${ringHits} ice=${iceHits} dome=${domeHits}`);
for (const r of perProfile) {
  if (r.ring || r.ice || r.dome || r.hasRings || r.hasDome) {
    console.log(`${r.name} ring@${r.ring} ice@${r.ice} dome@${r.dome} art.rings=${r.hasRings} art.dome_r=${r.hasDome} t1=${r.tier1} t2=${r.tier2}`);
  }
}
