// Насколько новый фронт сдвигает фон в пикселях? Считаем верхнюю границу
// смещения (prof = 1 при s = d, par = 1) для тех же кадров, что рисует lab.
import profiles from '../src/game/data/source-bomb-profiles.json' with { type: 'json' };
import { blastShapeAt } from '../src/game/client/nuclearVolumetrics.js';
import { zonesForBomb } from '../src/game/client/nuclearBlastModel.js';

const H = 720, Wd = 1280, FOVY = 0.6;
const tanY = Math.tan(FOVY / 2);
const pxPerRad = 0.5 * H / tanY;
const MAX_PX = 6;
const smoothstep = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

for (const id of ['trinity', 'little_boy', 'castle_bravo', 'tsar']) {
  const bomb = profiles.bombs.find((b) => b.id === id);
  const zones = zonesForBomb(bomb, bomb.yield_kt);
  console.log(`\n== ${id} ${bomb.yield_kt} kt  (px/rad = ${pxPerRad.toFixed(0)})`);
  for (const s of [1, 4, 16, 64, 256, 1024, 4096]) {
    const st = blastShapeAt(bomb, zones, bomb.yield_kt, s);
    const sh = st.shock;
    if (!sh.r) { console.log(`   s=${String(s).padStart(4)}  погас (фронт ещё в шаре или давление < 0.05 psi)`); continue; }
    // Камера lab-кадра: примерно тройной радиус фронта, но не дальше 200 км.
    const tc = Math.min(Math.max(sh.r * 3, 30_000), 200_000);
    const d = Math.max(sh.thick, 0.05);
    const dPx = d / tc * pxPerRad;
    const stem = 1 + (sh.stem > 0 ? 1 : 0);
    const defl = 1.3e-5 * sh.psi * Math.sqrt(2 * sh.r / d) * sh.amp * stem * smoothstep(0.75, 3, dPx);
    const disp = Math.min(defl * pxPerRad, MAX_PX);
    console.log(`   s=${String(s).padStart(4)}  R=${(sh.r / 1000).toFixed(1).padStart(7)} km  p=${sh.psi.toFixed(2).padStart(6)} psi  d=${(sh.thick / 1000).toFixed(2).padStart(6)} km  amp=${sh.amp.toFixed(2)}  cond=${sh.cond.toFixed(2)}  dPx=${dPx.toFixed(1)}  сдвиг=${disp.toFixed(2)} px  альфа=${Math.min(1, disp * 1.5).toFixed(2)}`);
  }
}
