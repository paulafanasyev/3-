// Сферические функции игрового слоя. Чистые функции, без зависимости от Cesium.
// Перенесено из PR #2 (src/nuclear/geo.js) без изменений логики.
export const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export function isValidPoint(point) {
  return Boolean(point)
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lon)
    && point.lat >= -90 && point.lat <= 90
    && point.lon >= -180 && point.lon <= 180;
}

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function toVector({ lat, lon }) {
  const la = toRad(lat);
  const lo = toRad(lon);
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export function fromVector([x, y, z]) {
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) };
}

/** Точка на доле t (0..1) дуги большого круга от a до b. */
export function interpolateGreatCircle(a, b, t) {
  const va = toVector(a);
  const vb = toVector(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  if (omega < 1e-9 || sinOmega < 1e-9) return { lat: a.lat, lon: a.lon };
  const ka = Math.sin((1 - t) * omega) / sinOmega;
  const kb = Math.sin(t * omega) / sinOmega;
  return fromVector([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]]);
}

/** Сдвиг на stepKm от from к to по дуге большого круга. */
export function moveToward(from, to, stepKm) {
  const distance = haversineKm(from, to);
  if (distance <= stepKm || distance === 0) return { lat: to.lat, lon: to.lon, arrived: true };
  return { ...interpolateGreatCircle(from, to, stepKm / distance), arrived: false };
}

/** Абстрактная баллистическая дуга только для визуализации (км над землёй). */
export function ballisticAltitudeKm(distanceKm, t) {
  const apex = Math.min(1200, distanceKm * 0.2);
  return apex * 4 * t * (1 - t);
}
