// Спектр зерна: какой длины волной рассыпается столб. Глаз говорит «соль»,
// но не говорит период, а без периода не выбрать, что чинить — шаг марша,
// клетку шума или полосу сглаживания.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decode(p) {
  const b = fs.readFileSync(p);
  let i = 8;
  const idat = [];
  let w = 0; let h = 0; let ct = 2;
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('ascii', i + 4, i + 8);
    const data = b.slice(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    i += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const ft = raw[pos]; pos += 1;
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + bb) & 255;
      else if (ft === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + bb - c;
        const pa = Math.abs(pp - a); const pb = Math.abs(pp - bb); const pc = Math.abs(pp - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c);
        v = (v + pr) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

const f = process.argv[2];
const { w, h, bpp, data } = decode(f);
const box = (process.env.BOX || '430,240,530,400').split(',').map(Number);
const [x0, y0, x1, y1] = box;const cw = x1 - x0; const ch = y1 - y0;
const L = (x, y) => {
  const o = (y * w + x) * bpp;
  return data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
};
const g = new Float64Array(cw * ch);
let mean = 0;
for (let y = 0; y < ch; y += 1) {
  for (let x = 0; x < cw; x += 1) {
    const v = L(x0 + x, y0 + y);
    g[y * cw + x] = v;
    mean += v;
  }
}
mean /= cw * ch;
// высокочастотная часть: минус гауссово размытие r=6
const blur = (x, y, r) => {
  let s = 0; let n = 0;
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const xx = Math.min(cw - 1, Math.max(0, x + dx));
      const yy = Math.min(ch - 1, Math.max(0, y + dy));
      s += g[yy * cw + xx]; n += 1;
    }
  }
  return s / n;
};
const hp = new Float64Array(cw * ch);
let hpRms = 0;
for (let y = 0; y < ch; y += 1) {
  for (let x = 0; x < cw; x += 1) {
    const d = g[y * cw + x] - blur(x, y, 6);
    hp[y * cw + x] = d;
    hpRms += d * d;
  }
}
hpRms = Math.sqrt(hpRms / (cw * ch));
// автокорреляция высокочастотной части по горизонтали и вертикали
const acf = (dx, dy) => {
  let s = 0; let n = 0;
  for (let y = 0; y + dy < ch; y += 1) {
    for (let x = 0; x + dx < cw; x += 1) {
      s += hp[y * cw + x] * hp[(y + dy) * cw + (x + dx)];
      n += 1;
    }
  }
  return s / n;
};
const acf0 = acf(0, 0);
const row = [];
const col = [];
for (let k = 1; k <= 24; k += 1) {
  row.push(+(acf(k, 0) / acf0).toFixed(3));
  col.push(+(acf(0, k) / acf0).toFixed(3));
}
console.log(JSON.stringify({
  f: f.split('/').pop(), box, mean: +mean.toFixed(1), hpRms: +hpRms.toFixed(1),
  acfX: row, acfY: col,
}, null, 1));
