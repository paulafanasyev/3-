// Список слоёв «Живой Земли» без зависимостей: его читает HUD, а модули GEV грузит liveLayers.js.
export const LIVE_LAYERS = Object.freeze([
  { key: 'flights', name: 'Самолёты', source: 'OpenSky', load: () => import('../../data/flights.js') },
  { key: 'satellites', name: 'Спутники', source: 'CelesTrak', load: () => import('../../data/satellites.js') },
  { key: 'earthquakes', name: 'Землетрясения', source: 'USGS', load: () => import('../../data/earthquakes.js') },
  { key: 'launches', name: 'Запуски ракет', source: 'Launch Library 2', load: () => import('../../data/rocketLaunches.js') },
]);
