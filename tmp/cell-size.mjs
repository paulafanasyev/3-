// Насколько центр клетки сетки близок к реальному городу: если удар и подпись
// города сидят на центроиде клетки, то «Лондон» в партии — это центроид, а не
// 51.502,-0.119. Меряем расстояние для пяти городов God's Eye View.
import { createCellGeometry } from '../src/game/client/geometry.js';
const g = createCellGeometry();
const cells = g.cells ?? g;
console.log(`клеток: ${cells.length}`);
const R = 6371008.8, rad = Math.PI / 180;
const dist = (a, b) => {
  const s = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const CITY = { London: [51.502, -0.119], Paris: [48.857, 2.352], Berlin: [52.52, 13.405], Washington: [38.907, -77.037], 'New York': [40.713, -74.005] };
for (const [n, [lat, lon]] of Object.entries(CITY)) {
  let best = null, bd = Infinity, second = Infinity;
  for (let i = 0; i < cells.length; i += 1) {
    const d = dist(cells[i], { lat, lon });
    if (d < bd) { second = bd; bd = d; best = i; } else if (d < second) second = d;
  }
  console.log(`${n}: ближайшая клетка #${best} в ${(bd / 1000).toFixed(1)} км, шаг сетки ~${(second / 1000).toFixed(0)} км`);
}
