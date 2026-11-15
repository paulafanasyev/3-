// Поминутный разбор полосы на ножке: brightness-профиль по строкам.
// Конденсация = плавный горб (белёсая вуаль). Разрыв рефракции = резкий
// стык: строки над и под линией зеркально сдвинуты, значит соседние строки
// перескакивают по яркости, а цвет остаётся цветом колонны.
import sharp from 'sharp';

const file = process.argv[2];
const [x0, y0, w, h] = (process.env.CROP || '420,310,130,70').split(',').map(Number);
const { data, info } = await sharp(file).extract({ left: x0, top: y0, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
const { width, channels } = info;
const rowStats = [];
for (let y = 0; y < h; y += 1) {
  let lum = 0, r = 0, g = 0, b = 0, sat = 0;
  for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * channels;
    const R = data[o], G = data[o + 1], B = data[o + 2];
    lum += 0.2126 * R + 0.7152 * G + 0.0722 * B;
    r += R; g += G; b += B;
    sat += Math.max(R, G, B) - Math.min(R, G, B);
  }
  rowStats.push({
    y: y0 + y,
    lum: +(lum / width).toFixed(1),
    rgb: [r, g, b].map((v) => Math.round(v / width)),
    sat: +(sat / width).toFixed(1),
  });
}
let prev = null;
for (const s of rowStats) {
  const jump = prev === null ? '' : ` Δ=${(s.lum - prev).toFixed(1)}`;
  console.log(`y=${s.y} lum=${s.lum}${jump} rgb=${s.rgb.join(',')} sat=${s.sat}`);
  prev = s.lum;
}
