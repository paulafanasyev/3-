// Сравнение полосы кадра, где должна быть шляпа, с эталонной полосой неба слева.
// Если объём рисует шляпу, среднее по окну смещено относительно эталона.
import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width; const H = info.height;
const mean = (x0, x1, y0, y1) => {
  let n = 0; const acc = [0, 0, 0];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * info.channels;
      acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n += 1;
    }
  }
  return acc.map((v) => +(v / n).toFixed(1));
};
console.log('file', file, `${W}x${H}`);
console.log('rows  ref(x80-280)        cap(x380-580)       delta');
for (let y = 20; y < 300; y += 20) {
  const ref = mean(80, 280, y, y + 20);
  const cap = mean(380, 580, y, y + 20);
  const d = cap.map((v, i) => +(v - ref[i]).toFixed(1));
  console.log(String(y).padStart(4), JSON.stringify(ref).padEnd(20), JSON.stringify(cap).padEnd(20), JSON.stringify(d));
}
