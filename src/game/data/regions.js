// Географические регионы игры. Это описание местности на настоящей Земле,
// а не реальные государства.

/** Континент Северная Америка (грубый контур, без Гренландии и Южной Америки). */
export function isNorthAmerica({ lat, lon }) {
  if (lon < -170 || lon > -52) return false;
  if (lat < 7 || lat > 75) return false;
  if (lat > 59 && lon > -75) return false; // Гренландия
  if (lat < 10 && lon > -78) return false; // Южная Америка за Панамским перешейком
  return true;
}

/** Четыре стартовые зоны (§4.5 DESIGN.md). Якорь — точка местности, не город. */
export const START_ZONES = Object.freeze([
  { id: 'north', name: 'Северная', anchor: { lat: 54, lon: -98 } },
  { id: 'atlantic', name: 'Атлантическая', anchor: { lat: 38, lon: -79 } },
  { id: 'pacific', name: 'Тихоокеанская', anchor: { lat: 44, lon: -121 } },
  { id: 'south', name: 'Южная', anchor: { lat: 19, lon: -98 } },
]);
