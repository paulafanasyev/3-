// Запрет ядерных ударов по России и её городам. Один источник правды для
// партии, испытательного полигона и ИИ: территория — маска из закреплённого
// Natural Earth, города — строки того же каталога, по которому полигон ищет
// цель. Собрано scripts/build-russia-mask.mjs; аудит — 585 своих городов
// под запретом, 6757 чужих городов чисты.
// Атрибут type:'json' обязателен: модуль читают и Node (партия, ИИ, тесты),
// и Vite (полигон), а голый импорт JSON в Node без него падает.
import territory from './data/russia-territory.json' with { type: 'json' };
import russianCities from './data/russia-cities.json' with { type: 'json' };

export const BANNED_NATION = 'Россия';
export const NUKE_BAN_ERROR = 'NUKE_BANNED_RUSSIA';

const ringPoint = (ring, lat, lon) => {
  let hit = false;
  for (let a = 0, c = ring.length - 1; a < ring.length; c = a++) {
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[c];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) hit = !hit;
  }
  return hit;
};

const DEGREE_KM = 111.32;
const kmBetween = (latA, lonA, latB, lonB) => Math.hypot(
  (lonB - lonA) * Math.cos(((latA + latB) / 2) * (Math.PI / 180)) * DEGREE_KM,
  (latB - latA) * 110.57,
);

/** Точка на Земле — по маске территории плюс защитные круги городов, которые
 *  полигон не накрывает (мысы и острова). */
export function inRussia(at) {
  const lat = Number(at?.lat);
  const lon = Number(at?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  for (let i = 0; i < territory.polygons.length; i += 1) {
    const b = territory.bounds[i];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (ringPoint(territory.polygons[i], lat, lon)) return true;
  }
  for (const [, clat, clon, radiusKm] of russianCities.cities) {
    if (radiusKm > 0 && kmBetween(clat, clon, lat, lon) <= radiusKm) return true;
  }
  return false;
}

const cityKey = (name, lat, lon) => `${String(name).toLocaleLowerCase('ru')}|${Number(lat).toFixed(3)}|${Number(lon).toFixed(3)}`;
const RUSSIAN_CITY_KEYS = new Set(russianCities.cities.map(([name, lat, lon]) => cityKey(name, lat, lon)));

/** Строка каталога (или карточка города) — российский город по признаку
 *  источника, а не по угадыванию через границу: пары городов в сотнях метров
 *  друг от друга на границе не путаются. */
export function isRussianCity(city) {
  if (!city) return false;
  const name = city[0] ?? city.name;
  const lat = city[1] ?? city.lat ?? city.latitude;
  const lon = city[2] ?? city.lon ?? city.longitude;
  if (name == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false;
  return RUSSIAN_CITY_KEYS.has(cityKey(name, lat, lon));
}

/** Запрет для цели: координата из маски или город из каталога. Возвращает
 *  название запрещённой стороны или null. */
export function nuclearBanFor(at, city = null) {
  return (city && isRussianCity(city)) || inRussia(at) ? BANNED_NATION : null;
}
