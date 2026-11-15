// Шляпа против ножки: во что реально вырастает гриб по модели на разных
// возрастах. Ориентир по замерам натурных испытаний: у зрелого гриба диаметр
// шляпы 0,4-0,7 высоты облака, диаметр ножки под шляпой 0,1-0,15. Кадр
// strike29 (150 кт, 21 с) дал 771 м радиус шляпы при вершине 10,7 км —
// это «гвоздь», и надо понять, где именно модель обрезает шляпу.
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const bombs = JSON.parse(await import('node:fs/promises')
  .then(({ readFile }) => readFile(new URL('../src/game/data/source-bomb-profiles.json', import.meta.url), 'utf8'))).bombs;

for (const [id, kt] of [['ivy_king', 150], ['ivy_king', 500], ['rds37', 1600], ['sedan', 104]]) {
  const bomb = bombs.find((b) => b.id === id);
  const zones = zonesForBomb(bomb, kt);
  const t = blastShapeAt(bomb, zones, kt, 0).timing;
  const ages = [0.5, 1, 2, 4, 8, 16, 24, 32, 48, 64, t.tFull, t.tFull * 1.5].filter((a) => a <= t.tFull * 1.6);
  console.log(`\n=== ${id} @ ${kt} кт: tHead1=${t.tHead1?.toFixed(1)} tFull=${t.tFull.toFixed(1)} life=${(t.tFull / Math.min(8, Math.max(t.tFull / 150, (t.tHead1 ?? 0) / 3, 1))).toFixed(0)} с`);
  console.log('возр  верх(2*boundY)  шляпаY  шляпаR  D/верх  ножкаR  юбкаR  stem.низ');
  for (const a of ages) {
    const s = blastShapeAt(bomb, zones, kt, Math.min(a, t.tFull));
    const top = s.bound.y * 2;
    const hr = s.head?.r ?? 0;
    const sr = s.stem?.r ?? s.stem?.w ?? 0;
    const ratio = top > 0 ? (2 * hr) / top : 0;
    console.log(`${a.toFixed(1).padStart(5)} ${top.toFixed(0).padStart(9)} м ${(s.head?.y ?? 0).toFixed(0).padStart(7)} м ${hr.toFixed(0).padStart(7)} м ${ratio.toFixed(2).padStart(6)} ${sr.toFixed(0).padStart(7)} ${(s.skirt?.r ?? 0).toFixed(0).padStart(6)} ${JSON.stringify(Object.keys(s.stem ?? {}))}`);
  }
}
