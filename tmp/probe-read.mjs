// Разбор пробных кадров: есть ли вообще жёлтый пиксель рядом с проекцией цели.
import sharp from 'sharp';

const DIR = process.env.DIR || 'D:/mt5/tmp-nuclear/shots/point-probe';

for (const name of ['size_meters', 'size_pixels']) {
  const { data, info } = await sharp(`${DIR}/${name}.png`).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const C = info.channels;
  const hist = {};
  let mx = -1;
  let ms = '';
  for (let y = 190; y < 350; y += 1) {
    for (let x = 400; x < 560; x += 1) {
      const i = (y * W + x) * C;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 110 && r - b > 45 && g - b > 35) {
        const k = `r${Math.round(r / 40) * 40}`;
        hist[k] = (hist[k] || 0) + 1;
      }
      if (r + g > mx) {
        mx = r + g;
        ms = `${r},${g},${b} @${x},${y}`;
      }
    }
  }
  console.log(`${name}: ${JSON.stringify(hist)} | ярчайший в окне: ${ms}`);
}
