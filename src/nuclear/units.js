// Game unit catalog. Every mobile unit reuses a 3D model God's Eye View already
// ships in public/models/. All stats are abstract game values, not real-world data.
export const UNIT_TYPES = Object.freeze({
  icbm_silo: {
    label: 'Шахта МБР', model: null, marker: 'silo', role: 'launcher', mobile: false,
    ammo: 1, payload: 'ballistic', rangeKm: 13000,
  },
  naval_group: {
    label: 'Корабельная группа', model: 'ship.glb', role: 'launcher', mobile: true, speedKmS: 0.6,
    ammo: 2, payload: 'ballistic', rangeKm: 6000,
  },
  bomber: {
    label: 'Стратегический бомбардировщик', model: 'airplane.glb', role: 'launcher', mobile: true, speedKmS: 3,
    ammo: 1, payload: 'cruise', rangeKm: 3000,
  },
  interceptor: {
    label: 'Перехватчик', model: 'jet.glb', role: 'defense', mobile: true, speedKmS: 5,
    ammo: 4, defends: 'cruise', defenseRangeKm: 500, interceptChance: 0.6,
  },
  abm_site: {
    label: 'Комплекс ПРО', model: null, marker: 'abm', role: 'defense', mobile: false,
    ammo: 6, defends: 'ballistic', defenseRangeKm: 1200, interceptChance: 0.45,
  },
  recon_drone: {
    label: 'Разведывательный БПЛА', model: 'mq9.glb', role: 'recon', mobile: true, speedKmS: 2,
    sensorRangeKm: 1500,
  },
  scout_plane: {
    label: 'Лёгкий разведчик', model: 'c172.glb', role: 'recon', mobile: true, speedKmS: 1.5,
    sensorRangeKm: 700,
  },
  awacs: {
    label: 'Самолёт ДРЛО', model: 'citation2.glb', role: 'awacs', mobile: true, speedKmS: 2.5,
    sensorRangeKm: 2000, defenseBonus: 0.15, bonusRangeKm: 2000,
  },
  rescue_heli: {
    label: 'Спасательный вертолёт', model: 'bell206.glb', role: 'rescue', mobile: true, speedKmS: 1,
    rescueFactor: 0.15, rescueRangeKm: 600,
  },
  evac_airliner: {
    label: 'Эвакуационный лайнер', model: 'b789.glb', role: 'rescue', mobile: true, speedKmS: 3,
    rescueFactor: 0.3, rescueRangeKm: 1500,
  },
  regional_transport: {
    label: 'Региональный транспорт', model: 'atr72.glb', role: 'rescue', mobile: true, speedKmS: 2,
    rescueFactor: 0.2, rescueRangeKm: 900,
  },
  warning_satellite: {
    label: 'Спутник раннего предупреждения', model: null, marker: 'satellite', role: 'warning', mobile: false,
    orbital: true, defenseBonus: 0.2,
  },
});

export const PAYLOADS = Object.freeze({
  ballistic: { label: 'Баллистическая ракета', speedKmS: 40, blastRadiusKm: 150 },
  cruise: { label: 'Крылатая ракета', speedKmS: 4, blastRadiusKm: 80 },
});

export const DEFAULT_ROSTER = Object.freeze({
  icbm_silo: 4,
  naval_group: 2,
  bomber: 2,
  interceptor: 3,
  abm_site: 2,
  recon_drone: 2,
  scout_plane: 1,
  awacs: 1,
  rescue_heli: 2,
  evac_airliner: 1,
  regional_transport: 1,
  warning_satellite: 1,
});
