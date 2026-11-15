// Поиск «чёрной точки» в кадре: ищем компактные кластеры пикселей, которые
// темнее своего окружения. Метрика нужна потому, что глаз видит artifact,
// но не говорит, сколько он пикселей и где именно — а без этого не понять,
// это UI, дырка в объёмном проходе или тень сцены.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decode(p) {
  const b = fs.readFileSync(p);
  let i = 8;
  const idat = [];
  let w = 0; let h = 0; let bd = 8; let ct = 2;
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('ascii', i + 4, i + 8);
    const data = b.slice(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
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
const L = (x, y) => {
  const o = (y * w + x) * bpp;
  return (data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722);
};
const RGB = (x, y) => {
  const o = (y * w + x) * bpp;
  return [data[o], data[o + 1], data[o + 2]];
};

// карта яркости
const lum = new Float32Array(w * h);
for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) lum[y * w + x] = L(x, y);

// «тёмнее окружения»: сравниваем пиксель с медианоподобным средним кольца r=6..9
const R0 = 6; const R1 = 9;
const cand = [];
for (let y = R1; y < h - R1; y += 1) {
  for (let x = R1; x < w - R1; x += 1) {
    let s = 0; let n = 0;
    for (let dy = -R1; dy <= R1; dy += 1) {
      for (let dx = -R1; dx <= R1; dx += 1) {
        const d = Math.hypot(dx, dy);
        if (d < R0 || d > R1) continue;
        s += lum[(y + dy) * w + (x + dx)]; n += 1;
      }
    }
    const avg = s / n;
    const self = lum[y * w + x];
    if (avg - self > 60 && self < 45) cand.push([x, y, +self.toFixed(1), +avg.toFixed(1)]);
  }
}
// кластеризация простой flood-меткой
const seen = new Set();
const clusters = [];
const key = (x, y) => y * w + x;
const set = new Set(cand.map(([x, y]) => key(x, y)));
for (const c of cand) {
  const k0 = key(c[0], c[1]);
  if (seen.has(k0)) continue;
  const stack = [[c[0], c[1]]];
  const pts = [];
  seen.add(k0);
  while (stack.length) {
    const [x, y] = stack.pop();
    pts.push([x, y]);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nk = key(x + dx, y + dy);
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push([x + dx, y + dy]); }
      }
    }
  }
  if (pts.length < 3) continue;
  let minX = w; let maxX = 0; let minY = h; let maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  clusters.push({
    n: pts.length, box: [minX, minY, maxX, maxY], c: [Math.round(cx), Math.round(cy)],
    rgb: RGB(Math.round(cx), Math.round(cy)),
  });
}
clusters.sort((a, b) => b.n - a.n);
console.log(JSON.stringify({
  f: f.split('/').pop(), size: `${w}x${h}`, dark: cand.length,
  clusters: clusters.slice(0, Number(process.env.TOP || 8)),
}, null, 1));
