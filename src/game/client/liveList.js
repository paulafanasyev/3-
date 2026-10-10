// Список слоёв «Живой Земли» без зависимостей: его читает HUD, а модули GEV грузит liveLayers.js.
// Каждый слой — прибор разведки, который нация получает вместе с технологией (unlock).
export const LIVE_LAYERS = Object.freeze([
  { key: 'flights', name: 'Самолёты', source: 'OpenSky', unlock: 'flight', why: 'Авиадиспетчерская служба', load: () => import('../../data/flights.js') },
  { key: 'launches', name: 'Запуски ракет', source: 'Launch Library 2', unlock: 'rocketry', why: 'Слежение за пусками', load: () => import('../../data/rocketLaunches.js') },
  { key: 'satellites', name: 'Спутники', source: 'CelesTrak', unlock: 'satellites', why: 'Каталог орбит', load: () => import('../../data/satellites.js') },
  { key: 'earthquakes', name: 'Сейсмика', source: 'USGS', unlock: 'fission', why: 'Сейсмический мониторинг ядерных испытаний', load: () => import('../../data/earthquakes.js') },
]);

/** Открыт ли прибор для нации: нужная технология (спутники — ещё и собственный спутник на орбите). */
export function liveUnlocked(layer, me, units = []) {
  if (!me) return false;
  if (me.techs?.includes(layer.unlock)) return true;
  return layer.key === 'satellites' && units.some((u) => u.owner === me.id && u.type === 'satellite');
}
