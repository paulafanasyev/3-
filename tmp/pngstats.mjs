// Измерение по пикселям самого PNG: чистый декодер (zlib + фильтры), без зависимостей.
// Нужен потому, что чтение WebGL-канваса из страницы (drawImage/toDataURL без
// preserveDrawingBuffer) даёт mean=0 на живом кадре — метрика мертва.
// Использование:
//   node tmp/pngstats.mjs stats  a.png b.png            — mean/max/доля белых по центру
//   node tmp/pngstats.mjs diff   a.png b.png            — сколько пикселей различается
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

const mode = process.argv[2];
const files = process.argv.slice(3);
if (mode === 'blob') {
  // Центр и размер ПЯТНА, которое нарисовал diagnostic-канал u_dbg (u_dbg=1
  // даёт белое покрытие, 2 — RGB по слоям, 4 — сине-голубой firstHit). Фон
  // сцены тёмно-синий, поэтому пятно ищем как «почти белый» или «чистый
  // канал». Три камеры = три луча, и из них восстанавливается местность
  // пятна в локальных метрах шейдера.
  for (const f of files) {
    const { w, h, bpp, data } = decode(f);
    // BOX=0,0.5,0.5,1 — доля кадра: UI-крестики и логотип Cesium тоже белые,
    // без окна центроид уезжает к ним.
    const bx = (process.env.BOX || '0,0,1,1').split(',').map(Number);
    const x0 = Math.round(bx[0] * w); const x1 = Math.round(bx[2] * w);
    const y0 = Math.round(bx[1] * h); const y1 = Math.round(bx[3] * h);
    let n = 0; let sx = 0; let sy = 0; let minX = w; let maxX = 0; let minY = h; let maxY = 0;
    let sr = 0; let sg = 0; let sb = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = (y * w + x) * bpp;
        const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
        const whiteish = r > 235 && g > 235 && b > 235;
        const pure = (g > 200 && r < 90 && b < 90) || (b > 200 && r < 90 && g < 90)
          || (r > 200 && g < 90 && b < 90);
        if (whiteish || pure) {
          n += 1; sx += x; sy += y; sr += r; sg += g; sb += b;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!n) { console.log(JSON.stringify({ f: f.split('/').pop(), n: 0 })); continue; }
    const cx = sx / n; const cy = sy / n;
    console.log(JSON.stringify({
      f: f.split('/').pop(), size: `${w}x${h}`, px: n,
      center: [Math.round(cx), Math.round(cy)],
      ndc: [+((2 * cx / w - 1).toFixed(3)), +((1 - 2 * cy / h).toFixed(3))],
      box: { x: [minX, maxX], y: [minY, maxY], w: maxX - minX, h: maxY - minY },
      rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    }));
  }
} else if (mode === 'diffmap') {
  // Форма вклада объёмного прохода: где именно пиксели изменились при
  // выключенном/включённом проходе. «Рисуется» и «рисует гриб» — разные вещи.
  const A = decode(files[0]); const B = decode(files[1]);
  const cols = Number(process.env.COLS || 48);
  const rows = Math.round(cols * A.h / A.w);
  const grid = Array.from({ length: rows }, () => new Float64Array(cols));
  const cw = A.w / cols; const ch = A.h / rows;
  let minX = A.w; let maxX = 0; let minY = A.h; let maxY = 0; let n = 0;
  for (let y = 0; y < A.h; y += 1) {
    for (let x = 0; x < A.w; x += 1) {
      const o = (y * A.w + x) * A.bpp;
      const d = (Math.abs(A.data[o] - B.data[o]) + Math.abs(A.data[o + 1] - B.data[o + 1]) + Math.abs(A.data[o + 2] - B.data[o + 2])) / 3;
      if (d > 8) {
        n += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        grid[Math.floor(y / ch)][Math.floor(x / cw)] += d;
      }
    }
  }
  const chars = ' .:-=+*#%@';
  const peak = Math.max(1, ...grid.map((r) => Math.max(...r)));
  console.log(JSON.stringify({
    pair: `${files[0].split('/').pop()} vs ${files[1].split('/').pop()}`,
    size: `${A.w}x${A.h}`, changedPct: Math.round(n / (A.w * A.h) * 1000) / 10,
    box: n ? { x: [minX, maxX], y: [minY, maxY], w: maxX - minX, h: maxY - minY } : null,
  }));
  for (let r = 0; r < rows; r += 1) {
    let line = '';
    for (let c = 0; c < cols; c += 1) {
      const v = grid[r][c] / peak;
      line += v <= 0.02 ? ' ' : chars[Math.min(9, Math.max(1, Math.round(v * 9)))];
    }
    console.log(`|${line}|`);
  }
} else if (mode === 'diff') {
  const A = decode(files[0]); const B = decode(files[1]);
  if (A.w !== B.w || A.h !== B.h) { console.log('РАЗМЕРЫ РАЗНЫЕ', A.w, A.h, B.w, B.h); process.exit(0); }
  let n = 0; let sum = 0; let max = 0; let bright = 0;
  for (let i = 0; i < A.data.length; i += A.bpp) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > 6) n += 1;
    sum += d / 3;
    if (d / 3 > max) max = d / 3;
    const l = A.data[i] * 0.299 + A.data[i + 1] * 0.587 + A.data[i + 2] * 0.114;
    if (l > 200) bright += 1;
  }
  const px = A.w * A.h;
  console.log(JSON.stringify({ pair: `${files[0].split('/').pop()} vs ${files[1].split('/').pop()}`, size: `${A.w}x${A.h}`, changedPct: Math.round(n / px * 10000) / 100, meanDelta: Math.round(sum / px * 100) / 100, maxDelta: Math.round(max), brightPct: Math.round(bright / px * 1000) / 10 }));
} else if (mode === 'bands') {
  // Пососной разбор: дельта A-B по горизонтальным полосам. Нужен чтобы
  // отличить вездесущий сдвиг пост-процессного блита от вклада самого облака.
  const A = decode(files[0]); const B = decode(files[1]);
  const NB = Number(process.env.BANDS || 12);
  const out = [];
  for (let b = 0; b < NB; b += 1) {
    const y0 = Math.floor(b * A.h / NB); const y1 = Math.floor((b + 1) * A.h / NB);
    let la = 0; let lb = 0; let d = 0; let n = 0; let over8 = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < A.w; x += 1) {
        const o = (y * A.w + x) * A.bpp;
        const ca = A.data[o] * 0.299 + A.data[o + 1] * 0.587 + A.data[o + 2] * 0.114;
        const cb = B.data[o] * 0.299 + B.data[o + 1] * 0.587 + B.data[o + 2] * 0.114;
        la += ca; lb += cb; d += ca - cb; n += 1;
        if (Math.abs(ca - cb) > 8) over8 += 1;
      }
    }
    out.push({ band: b, y: `${y0}-${y1}`, lumOn: Math.round(la / n * 10) / 10, lumOff: Math.round(lb / n * 10) / 10, dLum: Math.round(d / n * 10) / 10, changedPct: Math.round(over8 / n * 1000) / 10 });
  }
  for (const r of out) console.log(JSON.stringify(r));
} else if (mode === 'curve') {
  // Кривая преобразования, которую конвейер накладывает на ФОН: 16 корзин по
  // яркости off -> средняя on. По форме кривой видно, что именно делает проход
  // (гамма, удвоенный sRGB-энкод, тонмаппинг) и чем это компенсировать.
  const A = decode(files[0]); const B = decode(files[1]);
  const NB = 16;
  const sum = new Float64Array(NB); const cnt = new Float64Array(NB);
  const rs = new Float64Array(NB); const gs = new Float64Array(NB); const bs = new Float64Array(NB);
  const ro = new Float64Array(NB); const go = new Float64Array(NB); const bo = new Float64Array(NB);
  for (let i = 0; i < A.data.length; i += A.bpp) {
    const e = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const la = A.data[i] * 0.299 + A.data[i + 1] * 0.587 + A.data[i + 2] * 0.114;
    const lb = B.data[i] * 0.299 + B.data[i + 1] * 0.587 + B.data[i + 2] * 0.114;
    const k = Math.min(NB - 1, Math.floor(lb / 256 * NB));
    sum[k] += la; cnt[k] += 1;
    // попиксельно по каналам: две гипотезы — «вход считают линейным и энкодят
    // заново» (двойной sRGB) и «вход возводят в 1/2.2».
    const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    ro[k] += A.data[i] / 255; go[k] += A.data[i + 1] / 255; bo[k] += A.data[i + 2] / 255;
    rs[k] += enc(A.data[i] / 255) * 255; gs[k] += enc(A.data[i + 1] / 255) * 255; bs[k] += enc(A.data[i + 2] / 255) * 255;
  }
  for (let k = 0; k < NB; k += 1) {
    if (!cnt[k]) continue;
    const oR = ro[k] / cnt[k] * 255; const oG = go[k] / cnt[k] * 255; const oB = bo[k] / cnt[k] * 255;
    console.log(JSON.stringify({
      offLumBucket: Math.round((k + 0.5) * 256 / NB),
      n: Math.round(cnt[k]),
      onLum: Math.round(sum[k] / cnt[k] * 10) / 10,
      offLum: Math.round((k + 0.5) * 256 / NB * 10) / 10,
      predDoubleEncode: { r: Math.round(rs[k] / cnt[k]), g: Math.round(gs[k] / cnt[k]), b: Math.round(bs[k] / cnt[k]) },
      inputRgb: { r: Math.round(oR), g: Math.round(oG), b: Math.round(oB) },
    }));
  }
} else {
  for (const f of files) {
    const { w, h, bpp, data } = decode(f);
    const box = [Math.round(w * 0.3), Math.round(h * 0.05), Math.round(w * 0.75), Math.round(h * 0.75)];
    let n = 0; let sum = 0; let mx = 0; let white = 0;
    for (let y = box[1]; y < box[3]; y += 1) {
      for (let x = box[0]; x < box[2]; x += 1) {
        const o = (y * w + x) * bpp;
        const l = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
        sum += l; n += 1; if (l > mx) mx = l;
        if (data[o] > 235 && data[o + 1] > 235 && data[o + 2] > 235) white += 1;
      }
    }
    console.log(JSON.stringify({ f: f.split('/').pop(), size: `${w}x${h}`, box, mean: Math.round(sum / n * 10) / 10, max: Math.round(mx), whitePct: Math.round(white / n * 1000) / 10 }));
  }
}
