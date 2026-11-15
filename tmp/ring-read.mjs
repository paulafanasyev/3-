// Что за пунктир лежит на земле: читаем PNG и печатаем пиксели ярче фона в
// полосе кольца, с их цветом. Оранжевый — обломки, сине-белый — знак или лёд.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
const file = process.argv[2];
const buf = readFileSync(file);
let p = 8, w = 0, h = 0, depth = 0, ctype = 0;
const idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
  if (type === 'IDAT') idat.push(data);
  p += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const bpp = ctype === 6 ? 4 : 3;
const stride = w * bpp;
const px = (x, y) => {
  let o = y * (stride + 1) + 1;
  const row = raw.subarray(o - 1, o + stride);
  // фильтры по строке надо разворачивать — делаем полное декодирование один раз
  return null;
};
const img = Buffer.alloc(h * stride);
for (let y = 0; y < h; y += 1) {
  const ft = raw[y * (stride + 1)];
  const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  for (let x = 0; x < stride; x += 1) {
    const a = x >= bpp ? img[y * stride + x - bpp] : 0;
    const b = y > 0 ? img[(y - 1) * stride + x] : 0;
    const c = (x >= bpp && y > 0) ? img[(y - 1) * stride + x - bpp] : 0;
    let v = src[x];
    if (ft === 1) v = (v + a) & 255;
    else if (ft === 2) v = (v + b) & 255;
    else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (ft === 4) {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    img[y * stride + x] = v;
  }
}
const at = (x, y) => {
  const o = y * stride + x * bpp;
  return [img[o], img[o + 1], img[o + 2]];
};
const [x0, x1, y0, y1] = (process.env.BOX || '360,600,340,440').split(',').map(Number);
const hist = {};
let n = 0;
for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 1) {
  const [r, g, b] = at(x, y);
  const lum = (r + g + b) / 3;
  if (lum < 150) continue;
  const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
  hist[key] = (hist[key] || 0) + 1;
  n += 1;
}
console.log(`${file} ${w}×${h} depth=${depth} ctype=${ctype} светлых в окне: ${n}`);
console.log(Object.entries(hist).sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join('  '));
