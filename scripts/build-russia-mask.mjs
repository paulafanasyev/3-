// Сборка маски территории для запрета ядерных ударов.
// Источник — тот же закреплённый коммит Natural Earth, из которого собран
// каталог городов полигона (src/game/data/populated_places.json), поэтому
// граница и подписи городов не расходятся.
// Запуск: node scripts/build-russia-mask.mjs <geojson> <толщ.допуск,км>
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_countries.geojson';
const COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const src = process.argv[2] || join(root, '..', 'tmp-nuclear', 'data', 'ne_10m_admin_0_countries.geojson');
const tolKm = Number(process.argv[3] || 3);
const DECIMALS = Number(process.argv[4] || 3);

/** Упрощение Дануэра — Пекера в «выпрямленных» градусах: на 70° с.ш. градус
 *  долготы — это 38 км, поэтому без косинуса широты допуск был бы разной длины. */
function simplify(ring, tolDeg) {
  const lat0 = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const pts = ring.map((c) => [c[0] * k, c[1]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const dist = (a, b, p) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = -1; let at = -1;
    for (let n = i + 1; n < j; n += 1) {
      const d = dist(pts[i], pts[j], pts[n]);
      if (d > max) { max = d; at = n; }
    }
    if (max > tolDeg && at > 0) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  const out = [];
  const f = 10 ** DECIMALS;
  for (let n = 0; n < pts.length; n += 1) {
    if (!keep[n]) continue;
    const p = [Math.round(ring[n][0] * f) / f, Math.round(ring[n][1] * f) / f];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  if (out.length > 2) {
    const first = out[0]; const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out;
}

const geo = JSON.parse(readFileSync(src, 'utf8'));
const feature = geo.features.find((f) => f.properties.ADM0_A3 === 'RUS');
if (!feature) throw new Error('в источнике нет ADM0_A3=RUS');
const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
const tolDeg = tolKm / 111.32;
const polygons = [];
for (const rings of polys) {
  if (rings.length !== 1) throw new Error('кольца с дырами тут не поддерживаются');
  const s = simplify(rings[0], tolDeg);
  if (s.length >= 4) polygons.push(s);
}
polygons.sort((a, b) => b.length - a.length);
const bounds = polygons.map((p) => {
  let minLat = 90; let maxLat = -90; let minLon = 180; let maxLon = -180;
  for (const [lon, lat] of p) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  }
  return [minLon, minLat, maxLon, maxLat];
});
const doc = {
  meta: {
    title: 'Территория, по которой ядерные удары запрещены: Российская Федерация',
    source: 'ne_10m_admin_0_countries',
    url: SOURCE_URL,
    commit: COMMIT,
    license: 'Public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    simplification: `Douglas-Peucker ${tolKm} км, координаты — ${DECIMALS} знака`,
    polygons: polygons.length,
    points: polygons.reduce((a, p) => a + p.length, 0),
    schema: 'polygons[]: [[longitude, latitude], …], внешний кольцо, без дыр; bounds[]: [minLon, minLat, maxLon, maxLat]',
  },
  bounds,
  polygons,
};
// Жёсткие промеры: границы, где города стоят в паре километров друг от друга,
// и островной город, который полигон не накрывает вовсе. Координаты — не по
// памяти, а по OSM (Nominatim) и по строкам того же каталога.
const PROBE = [
  ['Печоры (РФ)', 57.8133, 27.6082, true],
  // Линия источника идёт восточнее замка, так что узкая полоса эстонского берега
  // попадает под защиту: отказ бить по чужому городу — ошибочный, но
  // безопасный род, в отличие от разрешения удара по своему.
  ['Замок Нарва (Эстония, полоса у линии источника)', 59.3756, 28.2004, true],
  ['Ивангород (РФ)', 59.3744, 28.2193, true],
  ['Кронштадт (РФ, остров)', 59.9908, 29.7747, true],
  ['Уэльен (РФ, Чукотка)', 66.154, -169.811, true],
  ['Приведения (РФ)', 64.430, -173.230, true],
  ['Хейхэ (Китай на Амуре)', 50.244, 127.490, false],
  ['Благовещенск (РФ)', 50.289, 127.535, true],
  ['Нарва (строка каталога)', 59.3776, 28.1603, false],
  ['Київ', 50.450, 30.523, false],
  ['Харків', 49.993, 36.231, false],
  ['Мінск', 53.901, 27.560, false],
  ['Приозерск (РФ)', 61.023, 30.135, true],
  ['Хельсинки', 60.170, 24.938, false],
  ['Таллінн', 59.437, 24.754, false],
  ['Астана', 51.169, 71.449, false],
  ['Орал (Казахстан)', 51.233, 51.366, false],
  ['Тбілісі', 41.715, 44.820, false],
  ['Баку', 40.409, 49.867, false],
  ['Улан-Батор', 47.886, 106.905, false],
  ['Пекін', 39.931, 116.386, false],
  ['Токіо', 35.687, 139.749, false],
  ['Анадырь (РФ)', 64.737, 177.475, true],
  ['Севастополь (РФ по источнику)', 44.600, 33.465, true],
];
const inMask = (lat, lon, rings, bnds) => {
  for (let i = 0; i < rings.length; i += 1) {
    const b = bnds[i];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    let hit = false;
    for (let a = 0, c = rings[i].length - 1; a < rings[i].length; c = a++) {
      const [x1, y1] = rings[i][a]; const [x2, y2] = rings[i][c];
      if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) hit = !hit;
    }
    if (hit) return true;
  }
  return false;
};

// Список городов берём из того же закреплённого источника, что и каталог
// полигона (ne_10m_populated_places_simple, 7342 строки = строки каталога):
// у строки есть adm0name, поэтому «российский город» — это факт источника,
// а не угадывание по границе. Плюс город получает защитный круг там, где
// полигон его не накрывает (мысовые и островные города), — круг никогда не
// дотягивается до чужого города: радиус режется до 0,45 расстояния до
// ближайшей нероссийской строки каталога.
const PLACES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_populated_places_simple.geojson';
const placesSrc = process.argv[5] || join(root, '..', 'tmp-nuclear', 'data', 'ne_10m_populated_places_simple.geojson');
const places = JSON.parse(readFileSync(placesSrc, 'utf8')).features;
const round = (v) => Math.round(v * 1000) / 1000;
const ru = places.filter((f) => f.properties.adm0name === 'Russia').map((f) => ({
  name: f.properties.name, lat: round(f.properties.latitude), lon: round(f.properties.longitude),
}));
const others = places.filter((f) => f.properties.adm0name !== 'Russia')
  .map((f) => [f.properties.latitude, f.properties.longitude]);
const km = (a, b, c, d) => {
  const dx = (c - a) * Math.cos(((b + d) / 2) * Math.PI / 180) * 111.32;
  return Math.hypot(dx, (d - b) * 110.57);
};
const CITY_CAP_KM = 3;
const cities = ru.map((c) => {
  let near = Infinity;
  for (const [lat, lon] of others) { const d = km(c.lat, c.lon, lat, lon); if (d < near) near = d; }
  const covered = inMask(c.lat, c.lon, polygons, bounds);
  const radiusKm = covered ? 0 : Math.round(Math.min(CITY_CAP_KM, near * 0.45) * 10) / 10;
  return [c.name, c.lat, c.lon, radiusKm];
});

const doc2 = {
  meta: {
    title: 'Города России: запрет ядерного удара по строке каталога',
    source: 'ne_10m_populated_places_simple',
    url: PLACES_URL,
    commit: COMMIT,
    license: 'Public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    note: 'Признак — adm0name источника, а не угадывание по границе. radiusKm = защитный круг там, где полигон территории не накрывает город (мыс, остров); 0 значит «полигон покрывает».',
    schema: 'cities[]: [name, latitude, longitude, radiusKm]',
    cities: cities.length,
    discs: cities.filter((c) => c[3] > 0).length,
  },
  cities,
};
const outMask = join(root, 'src', 'game', 'data', 'russia-territory.json');
const outCities = join(root, 'src', 'game', 'data', 'russia-cities.json');
writeFileSync(outMask, `${JSON.stringify(doc)}\n`);
writeFileSync(outCities, `${JSON.stringify(doc2)}\n`);

// Аудит: классификация маской + кругами по всему каталогу, и живые промеры
// на спорных участках (Нарва/Ивангород в 2 км друг от друга, Кронштадт на острове).
const banned = (lat, lon) => inMask(lat, lon, polygons, bounds)
  || cities.some(([, clat, clon, r]) => r > 0 && km(clat, clon, lat, lon) <= r);
const bad = [];
for (const [name, lat, lon] of cities) if (!banned(lat, lon)) bad.push(`город РФ, а пропустило: ${name}`);
for (const f of places.filter((x) => x.properties.adm0name !== 'Russia')) {
  if (banned(f.properties.latitude, f.properties.longitude)) bad.push(`чужой город, а залез: ${f.properties.name}/${f.properties.adm0name}`);
}
for (const [name, lat, lon, want] of PROBE) if (banned(lat, lon) !== want) bad.push(`промер ${name}: ${banned(lat, lon)}, ждали ${want}`);
console.log(`маска: полигонов ${polygons.length}, точек ${doc.meta.points}, ${(statSync(outMask).size / 1024).toFixed(1)} КБ, допуск ${tolKm} км, квант ${DECIMALS} знака`);
console.log(`города: ${cities.length} (${(statSync(outCities).size / 1024).toFixed(1)} КБ), из них с кругом ${doc2.meta.discs}`);
console.log(`аудит: ${ru.length} своих + ${places.length - ru.length} чужих + ${PROBE.length} промеров, ошибок ${bad.length}`);
for (const b of bad.slice(0, 25)) console.log('  ' + b);

