// Диаметр «осколков» на кадре: если они в метрах, с 5–9 км это единицы
// пикселей; если pixelSize читается как пиксели, кластеры лягут ровно на
// 18/32/46/60 (18 + (i%4)*14). Разметка — простой flood fill по кремовому.
import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const hit = (x, y) => {
  const i = (y * W + x) * C;
  return data[i] > 215 && data[i + 1] > 175 && data[i + 2] > 120 && data[i + 2] < 200
    && data[i] - data[i + 2] > 30;
};
const seen = new Uint8Array(W * H);
const blobs = [];
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const p = y * W + x;
    if (seen[p] || !hit(x, y)) continue;
    const stack = [[x, y]];
    let minX = x, maxX = x, minY = y, maxY = y, n = 0;
    seen[p] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      n += 1;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (!seen[np] && hit(nx, ny)) { seen[np] = 1; stack.push([nx, ny]); }
      }
    }
    if (n >= 12) blobs.push({ n, w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) >> 1, cy: (minY + maxY) >> 1 });
  }
}
blobs.sort((a, b) => b.w - a.w);
console.log(`${file}: пятен ${blobs.length}`);
for (const b of blobs) console.log(`  ${b.w}×${b.h} px (площадь ${b.n}) в ${b.cx},${b.cy}`);
