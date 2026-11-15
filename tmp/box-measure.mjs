// Рамка ярких пикселей кадра: где реально лежит облако на экране.
// Нужна, чтобы перевести пиксели в километры и понять, что рисует объёмный проход.
import sharp from 'sharp';

const file = process.argv[2];
const THRESH = Number(process.env.THRESH || 150);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
let minX = width; let maxX = -1; let minY = height; let maxY = -1; let n = 0;
const hist = new Map();
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * channels;
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    if (lum > THRESH) {
      n += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      hist.set(y, (hist.get(y) || 0) + 1);
    }
  }
}
const rows = [...hist.entries()].sort((a, b) => a[0] - b[0]);
const wide = rows.filter(([, c]) => c > 3).map(([y, c]) => `${y}:${c}`).join(' ');
console.log(JSON.stringify({
  file, size: `${width}x${height}`, threshold: THRESH, brightPx: n,
  box: n ? { x0: minX, x1: maxX, y0: minY, y1: maxY, wPx: maxX - minX + 1, hPx: maxY - minY + 1 } : null,
  rowsOver3px: wide.slice(0, 400),
}, null, 1));
