// Мера «цветной капусты» у шапки. Прошлая версия считала высокочастотную
// энергию по маске «отличается от среднего фона» — и захватывала небо, поэтому
// A/B давал 0.0175 против 0.0172 на разных шейдерах: прибор мерил градиент
// атмосферы, а не облако. Здесь маска предметная:
//   облако = яркое И нейтральное (небо синее: b-r большой; земля тёмная).
// Два числа:
//   rough = периметр/√площадь — гладкий купол ~3.6 (круг), рваный — больше;
//   tex   = std яркости внутри эрозированной маски (валуны внутри шапки).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.env.SHOTS || 'D:/mt5/tmp-nuclear/shots';
const listed = (process.env.FILES || '').split(',').filter(Boolean);
const files = listed.length
  ? listed.map((f) => (f.endsWith('.png') ? f : `${f}.png`))
  : readdirSync(dir).filter((f) => /^cap_/.test(f) && f.endsWith('.png'));

const run = async (name) => {
  // Кадр шапки вырезается ровно тем же прямоугольником, что и эталонные
  // cap_*-файлы (340,80,260,140 из 960x540): иначе маска видит то небо, то
  // землю, и сравнение сборок теряет смысл.
  const rect = (process.env.CROP || '340,80,260,140').split(',').map(Number);
  const pipe = rect.length === 4
    ? sharp(path.join(dir, name)).extract({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] })
    : sharp(path.join(dir, name));
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const ch = info.channels;
  const mask = new Uint8Array(W * H);
  const lum = new Float64Array(W * H);
  for (let i = 0, j = 0; i < W * H; i += 1, j += ch) {
    const r = data[j]; const g = data[j + 1]; const b = data[j + 2];
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[i] = L;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    mask[i] = (L > 0.42 && spread < 34 && b - r < 14) ? 1 : 0;
  }
  let area = 0; let per = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!mask[i]) continue;
      area += 1;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !mask[ny * W + nx]) per += 0.5;
      }
    }
  }
  // эрозия на 2 px: внутренность без пограничных пикселей, где смешаны небо и облако
  const inner = [];
  for (let y = 2; y < H - 2; y += 1) {
    for (let x = 2; x < W - 2; x += 1) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let solid = 1;
      for (let dy = -2; dy <= 2 && solid; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) if (!mask[(y + dy) * W + x + dx]) { solid = 0; break; }
      }
      if (solid) inner.push(lum[i]);
    }
  }
  const mean = inner.reduce((a, b) => a + b, 0) / (inner.length || 1);
  const std = Math.sqrt(inner.reduce((a, b) => a + (b - mean) ** 2, 0) / (inner.length || 1));
  return {
    file: name,
    area,
    rough: +(per / Math.max(Math.sqrt(area), 1)).toFixed(2),
    innerPx: inner.length,
    mean: +mean.toFixed(3),
    tex: +std.toFixed(4),
    // контраст шапки к небу меряем по всему кадру нельзя — тут только кроп,
    // поэтому отдельно: доля внутренних пикселей темнее 0.35 (тени под валами)
    shade: +(inner.filter((v) => v < 0.35).length / (inner.length || 1)).toFixed(3),
  };
};

for (const name of files.sort()) console.log(JSON.stringify(await run(name)));
