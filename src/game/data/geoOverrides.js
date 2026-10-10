// Ручные поправки к маске суши. На сетке ~220 км по цвету снимка теряются Великие озёра
// и узкий Панамский перешеек. Поправки задаются точками на настоящей Земле (собственные
// координаты проекта, не чужие данные) и применяются к ближайшим ячейкам сетки.
import { nearestCell } from '../grid.js';

/** Великие озёра: пресная вода, проходимая как шельф. Эри и Онтарио на этой сетке — одна ячейка. */
export const LAKES = Object.freeze([
  { name: 'Верхнее (запад)', lat: 47.3, lon: -89.8 },
  { name: 'Верхнее (восток)', lat: 47.6, lon: -86.8 },
  { name: 'Мичиган', lat: 44.0, lon: -87.0 },
  { name: 'Гурон', lat: 44.8, lon: -82.4 },
  { name: 'Эри и Онтарио', lat: 43.6, lon: -77.9 },
]);

/** Панамский перешеек: сухопутный мост между Северной и Южной Америкой. */
export const LAND_BRIDGES = Object.freeze([
  { name: 'Коста-Рика и запад Панамы', lat: 9.0, lon: -82.0, terrain: 'F' },
  { name: 'Панама', lat: 9.2, lon: -80.0, terrain: 'F' },
  { name: 'Дарьен', lat: 8.0, lon: -79.0, terrain: 'F' },
]);

/** Возвращает новую строку местности с поправками. Шельф вокруг озёр не добавляется. */
export function applyGeoOverrides(terrain, grid) {
  const t = terrain.split('');
  for (const p of LAKES) t[nearestCell(grid, p)] = 'S';
  for (const p of LAND_BRIDGES) t[nearestCell(grid, p)] = p.terrain;
  return t.join('');
}
