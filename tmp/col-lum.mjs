// Вертикальный профиль яркости по колонкам: ищем широкое затемнение (тёмная
// шляпа) вокруг луча, где по расчёту должна быть шапка гриба.
import sharp from 'sharp';

const file = process.argv[2];
const y0 = Number(process.argv[3] || 125);
const y1 = Number(process.argv[4] || 200);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const lum = (x, y) => {
  const i = (y * W + x) * info.channels;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
};
const colMean = (x) => {
  let s = 0;
  for (let y = y0; y < y1; y += 1) s += lum(x, y);
  return s / (y1 - y0);
};
const xs = [];
for (let x = 0; x < W; x += 8) xs.push(x);
const vals = xs.map(colMean);
const base = vals.reduce((a, b) => a + b, 0) / vals.length;
console.log('file', file, `rows ${y0}..${y1}`, 'среднее', base.toFixed(1));
let minV = 1e9; let minX = -1;
for (let i = 0; i < xs.length; i += 1) {
  const d = vals[i] - base;
  if (vals[i] < minV) { minV = vals[i]; minX = xs[i]; }
  if (Math.abs(d) > 6) console.log('x', String(xs[i]).padStart(4), 'L', vals[i].toFixed(1), 'Δ', d.toFixed(1));
}
console.log('самый тёмный столбец', minX, minV.toFixed(1), 'Δ', (minV - base).toFixed(1));
