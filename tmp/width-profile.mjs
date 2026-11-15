// Профиль ширины облака по строкам кадра: есть ли шляпка или только колонна.
// Белый/светлый пиксель = яркость выше порога И насыщенность ниже порога
// (небо тоже светлое, но оно голубое и сверху — его отсекаем по цвету).
import sharp from 'sharp';

const file = process.argv[2];
const THRESH = Number(process.argv[3] || 150);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width; const H = info.height;
const px = (x, y) => {
  const i = (y * W + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const rows = [];
for (let y = 0; y < H; y += 1) {
  let lo = -1; let hi = -1; let n = 0;
  for (let x = 0; x < W; x += 1) {
    const [r, g, b] = px(x, y);
    const v = Math.min(r, g, b);
    const sat = Math.max(r, g, b) - v;
    // облако: яркое И почти бесцветное (серо-белое), небо — синее (b >> r)
    if (v > THRESH && sat < 45 && b < r + 30) {
      if (lo < 0) lo = x;
      hi = x; n += 1;
    }
  }
  rows.push({ y, lo, hi, n, w: hi >= 0 ? hi - lo + 1 : 0, cx: hi >= 0 ? (lo + hi) / 2 : -1 });
}
// строки с содержательным набором пикселей
const ys = rows.filter((r) => r.n > 3);
console.log('file', file, 'size', `${W}x${H}`, 'thresh', THRESH);
console.log('row  n     width  cx      (только строки с n>3)');
for (const r of ys) console.log(String(r.y).padStart(3), String(r.n).padStart(5), String(r.w).padStart(6), String(r.cx.toFixed(0)).padStart(6));
const widths = ys.map((r) => r.w);
if (widths.length) {
  const max = Math.max(...widths);
  const at = ys[widths.indexOf(max)].y;
  console.log('MAX width', max, 'at row', at, '| median', widths[Math.floor(widths.length / 2)],
    '| rows', ys.length, '| span', ys[0].y, '..', ys.at(-1).y);
}
