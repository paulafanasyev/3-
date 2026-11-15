// Классификатор цветов diagnostic-канала u_dbg: ищем не «пятно вообще», а
// конкретные каналы (красный=отсечка глубиной, циан=марш запустился).
// Почему отдельный инструмент: blob-режим pngstats ловит только «чистый» один
// канал, а u_dbg=5 выдаёт R/G=лог(sceneT) и B=tEnter/tExit — циан (0,255,255)
// им не считается, и центроид уезжал к логотипу Cesium.
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

const files = process.argv.slice(2);
for (const f of files) {
  const { w, h, bpp, data } = decode(f);
  const cats = {
    red: (r, g, b) => r > 180 && g < 90 && b < 90,
    cyan: (r, g, b) => r < 90 && g > 180 && b > 180,
    green: (r, g, b) => r < 90 && g > 180 && b < 90,
    blue: (r, g, b) => r < 90 && g < 90 && b > 180,
    white: (r, g, b) => r > 235 && g > 235 && b > 235,
  };
  const acc = {};
  for (const k of Object.keys(cats)) acc[k] = { n: 0, sx: 0, sy: 0, x0: w, x1: 0, y0: h, y1: 0, sr: 0, sg: 0, sb: 0 };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * bpp;
      const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
      for (const k of Object.keys(cats)) {
        if (!cats[k](r, g, b)) continue;
        const a = acc[k];
        a.n += 1; a.sx += x; a.sy += y;
        if (x < a.x0) a.x0 = x; if (x > a.x1) a.x1 = x;
        if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y;
        a.sr += r; a.sg += g; a.sb += b;
      }
    }
  }
  const rep = { f: f.split(/[\\/]/).pop(), size: `${w}x${h}` };
  for (const [k, a] of Object.entries(acc)) {
    if (!a.n) { rep[k] = 0; continue; }
    const cx = a.sx / a.n; const cy = a.sy / a.n;
    rep[k] = {
      px: a.n,
      center: [Math.round(cx), Math.round(cy)],
      uv: [+(cx / w).toFixed(3), +(1 - cy / h).toFixed(3)],
      ndc: [+(2 * cx / w - 1).toFixed(3), +(1 - 2 * cy / h).toFixed(3)],
      box: { x: [a.x0, a.x1], y: [a.y0, a.y1], w: a.x1 - a.x0 + 1, h: a.y1 - a.y0 + 1 },
      rgb: [Math.round(a.sr / a.n), Math.round(a.sg / a.n), Math.round(a.sb / a.n)],
    };
  }
  console.log(JSON.stringify(rep));
}
