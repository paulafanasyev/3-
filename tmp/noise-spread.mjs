// Реальный разброс шума ножки. В шейдере n — сумма трёх октав, и если его
// стандартное отклонение в разы меньше номинального 0..1, то любое «усиление»
// складки упирается не в коэффициент, а в сам шум: 0.85 при разбросе ±0.15
// даёт ±70 м, и кадр не двигается. Считаем распределение тем же арифметическим
// шумом, что и в GLSL.
const fract = (x) => x - Math.floor(x);
function nHash(p) {
  let x = fract(p[0] * 0.3183098861 + 0.71) * 17.0;
  let y = fract(p[1] * 0.3183098861 + 0.113) * 17.0;
  let z = fract(p[2] * 0.3183098861 + 0.419) * 17.0;
  return fract(x * y * z * (x + y + z));
}
function nValue(p) {
  const i = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  let f = [p[0] - i[0], p[1] - i[1], p[2] - i[2]];
  f = f.map((t) => t * t * (3 - 2 * t));
  const at = (a, b, c) => nHash([i[0] + a, i[1] + b, i[2] + c]);
  const x00 = at(0, 0, 0), x10 = at(1, 0, 0), x01 = at(0, 1, 0), x11 = at(1, 1, 0);
  const x02 = at(0, 0, 1), x12 = at(1, 0, 1), x03 = at(0, 1, 1), x13 = at(1, 1, 1);
  const a = x00 + (x10 - x00) * f[0];
  const b = x01 + (x11 - x01) * f[0];
  const c = x02 + (x12 - x02) * f[0];
  const d = x03 + (x13 - x03) * f[0];
  const ab = a + (b - a) * f[1];
  const cd = c + (d - c) * f[1];
  return ab + (cd - ab) * f[2];
}
const nlf = (p) => {
  const q = [p[0] * 4, p[1] * 4, p[2] * 4];
  const s = (v, m) => [v[0] * m + 0, v[1] * m, v[2] * m];
  const l1 = (v, m, o) => [v[0] * m + o, v[1] * m + o, v[2] * m + o];
  const inner = nValue(q) * 0.5 + nValue(l1(q, 2.07, 5)) * 0.5;
  return inner * (1 - 0.28) + nValue(l1(q, 4.3, 11)) * 0.28;
};
function nbl(p) {
  const q = [p[0] * 6, p[1] * 6, p[2] * 6];
  const i = [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])];
  const f = [q[0] - i[0], q[1] - i[1], q[2] - i[2]];
  let best = 1;
  for (let k = 0; k < 8; k += 1) {
    const o = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
    const io = [i[0] + o[0], i[1] + o[1], i[2] + o[2]];
    const j = [nHash([io[0] - 0.5, io[1] - 0.5, io[2] - 0.5]),
      nHash([io[0] + 3.7, io[1] + 1.1, io[2] + 5.3]),
      nHash([io[0] + 9.1, io[1] + 6.3, io[2] + 2.7])];
    const r = [o[0] + j[0] * 0.7 - f[0], o[1] + j[1] * 0.7 - f[1], o[2] + j[2] * 0.7 - f[2]];
    best = Math.min(best, r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
  }
  return Math.max(0, Math.min(1, 1 - Math.sqrt(best) * 1.35));
}

// Те же коэффициенты, что в stemDensity: np = pt / 374, клетка изотропная.
const K = 1 / (831.909 * 0.45);
const SEED = 4242 * 0.21;
const nOf = (pt) => {
  const np = [pt[0] * K + SEED, pt[1] * K + SEED, pt[2] * K + SEED];
  const a = nlf([np[0] * 0.34 + 1, np[1] * 0.34 + 1, np[2] * 0.34 + 1]) * 0.5;
  const b = nlf([np[0] * 0.1 + 5, np[1] * 0.1 + 5, np[2] * 0.1 + 5]) * 0.3;
  const c = nbl([np[0] * 0.1 + 3, np[1] * 0.1 + 3, np[2] * 0.1 + 3]) * 0.2;
  return a + b + c;
};
const wf = (p, s) => [p[0] * s, p[1] * s, p[2] * s];
const stats = (arr) => {
  const m = arr.reduce((x, y) => x + y, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length);
  return { mean: +m.toFixed(3), sd: +sd.toFixed(3), min: +Math.min(...arr).toFixed(3), max: +Math.max(...arr).toFixed(3) };
};
const vals = [];
for (let k = 0; k < 40000; k += 1) {
  const th = Math.random() * 2 * Math.PI;
  const rr = 300 + Math.random() * 500;
  vals.push(nOf([Math.cos(th) * rr, Math.random() * 9000, Math.sin(th) * rr]));
}
console.log('n (3 октавы, метки 275/935/623 м):', JSON.stringify(stats(vals)));
const one = [];
for (let k = 0; k < 40000; k += 1) {
  const th = Math.random() * 2 * Math.PI;
  const rr = 300 + Math.random() * 500;
  const pt = [Math.cos(th) * rr, Math.random() * 9000, Math.sin(th) * rr];
  const np = wf(pt, K);
  one.push(nlf([np[0] * 0.34 + 1, np[1] * 0.34 + 1, np[2] * 0.34 + 1]));
}
console.log('одна октава nlf*0.34:', JSON.stringify(stats(one)));
// смещение поверхности и его перепад на шаг 88 м по вертикали
const r = 831.909;
for (const gain of [0.85, 1.25, 1.8]) {
  const amp = (stats(vals).sd) * gain * r * 0.55;
  let mx = 0;
  for (let k = 0; k < 20000; k += 1) {
    const th = Math.random() * 2 * Math.PI;
    const rr = 300 + Math.random() * 500;
    const y = Math.random() * 8900;
    mx = Math.max(mx, Math.abs(nOf([Math.cos(th) * rr, y + 88, Math.sin(th) * rr])
      - nOf([Math.cos(th) * rr, y, Math.sin(th) * rr])));
  }
  console.log(`gain ${gain}: ср.кв. амплитуда ${Math.round(amp)} м, шаг/88м p95-подобный max ${Math.round(mx * gain * r * 0.55)} м`);
}
