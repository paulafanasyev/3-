// Слои игры поверх настоящей Земли (Google Photorealistic 3D Tiles или запасной глобус).
// Территории и туман — GroundPrimitive, они ложатся прямо на снимки и 3D-тайлы;
// границы — GroundPolylinePrimitive; города и юниты — сущности с привязкой к земле.
import * as Cesium from 'cesium';
import { borderEdges, chainSegments, unwrapRing } from './geometry.js';
import { cityIcon, unitIcon } from './icons.js';
import { UNITS } from '../data/units.js';

/** Ниже этой высоты камеры заливка территорий гаснет, остаются границы: видно сами снимки. */
export const FILL_FADE_HEIGHT = 120_000;
const AIR_ALTITUDE = 2500;
const MODEL_VISIBLE_KM = 450;

const ringDegrees = (ring) => unwrapRing(ring.points).flatMap((p) => [p.lon, p.lat]);
const hashOf = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

export function createWorldLayers(viewer, geometry) {
  const scene = viewer.scene;
  const entities = new Cesium.CustomDataSource('kupol');
  viewer.dataSources.add(entities);
  let fill = null; let fog = null; let borders = null;
  let fillKey = null; let fogKey = null;
  const cityEntities = new Map();
  const unitEntities = new Map();
  let selectionEntity = null;
  let impactEntity = null;
  let colors = {};

  const center = (cell) => geometry.cells[cell];
  const colorOf = (owner, state) => {
    const n = state.nations.find((x) => x.id === owner);
    if (n) return n.color;
    const p = state.neutrals.find((x) => x.id === owner);
    return p?.color ?? '#9a8f7a';
  };

  function replacePrimitive(old, next) {
    if (old) scene.groundPrimitives.remove(old);
    if (next) scene.groundPrimitives.add(next);
    return next;
  }

  function buildTerritory(state) {
    const key = hashOf(state.owner.map((o) => o ?? '').join(',') + state.nations.map((n) => n.color).join());
    if (key === fillKey) return;
    fillKey = key;
    colors = {};
    const instances = [];
    const owners = new Set();
    state.owner.forEach((owner, cell) => {
      if (!owner) return;
      owners.add(owner);
      const major = state.nations.some((n) => n.id === owner);
      const color = Cesium.Color.fromCssColorString(colors[owner] ??= colorOf(owner, state)).withAlpha(major ? 0.32 : 0.14);
      instances.push(new Cesium.GeometryInstance({
        id: { kind: 'cell', cell },
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringDegrees(geometry.rings[cell]))) }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
    });
    fill = replacePrimitive(fill, instances.length ? new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: Cesium.ClassificationType.BOTH,
      asynchronous: true,
    }) : null);
    // границы: у крупных наций яркий контур со свечением, у народов тонкий
    const lines = [];
    for (const owner of owners) {
      const major = state.nations.some((n) => n.id === owner);
      const base = Cesium.Color.fromCssColorString(colors[owner]);
      for (const line of chainSegments(borderEdges(geometry, state.owner, owner))) {
        const positions = Cesium.Cartesian3.fromDegreesArray(unwrapRing(line).flatMap((p) => [p.lon, p.lat]));
        if (major) {
          lines.push(new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions, width: 9 }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(base.withAlpha(0.22)) },
          }));
        }
        lines.push(new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions, width: major ? 2.6 : 1.2 }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(base.withAlpha(major ? 0.95 : 0.5)) },
        }));
      }
    }
    if (borders) scene.groundPrimitives.remove(borders);
    borders = lines.length ? scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: lines,
      appearance: new Cesium.PolylineColorAppearance(),
      classificationType: Cesium.ClassificationType.BOTH,
      asynchronous: true,
    })) : null;
  }

  function buildFog(state) {
    if (fogKey === state.explored) return;
    fogKey = state.explored;
    const instances = [];
    const dark = Cesium.ColorGeometryInstanceAttribute.fromColor(new Cesium.Color(0.02, 0.03, 0.06, 0.62));
    for (let cell = 0; cell < geometry.size; cell += 1) {
      if (state.explored[cell] === '1') continue;
      instances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringDegrees(geometry.rings[cell]))) }),
        attributes: { color: dark },
      }));
    }
    fog = replacePrimitive(fog, instances.length ? new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: Cesium.ClassificationType.BOTH,
      asynchronous: true,
    }) : null);
  }

  function syncCities(state) {
    const seen = new Set();
    for (const city of state.cities) {
      seen.add(city.id);
      const { lat, lon } = center(city.cell);
      const color = colorOf(city.owner, state);
      const major = state.nations.some((n) => n.id === city.owner);
      let e = cityEntities.get(city.id);
      if (!e) {
        e = entities.entities.add({
          id: `city:${city.id}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          billboard: { heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.15, 1.2e7, 0.55) },
          label: {
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, font: '600 15px "Noto Sans", sans-serif', style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Cesium.Color.fromCssColorString('#05080d'), outlineWidth: 4, fillColor: Cesium.Color.WHITE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(2e4, 1.1, 1.2e7, 0.6),
          },
        });
        e.kupol = { kind: 'city', id: city.id };
        cityEntities.set(city.id, e);
      }
      e.billboard.image = cityIcon(color, city.pop, city.capital);
      e.label.text = city.name;
      // столицы видны с орбиты, прочие города — когда камера ближе 4000 км, нейтральные — ближе 2500 км
      e.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, city.capital ? Number.POSITIVE_INFINITY : major ? 4.0e6 : 2.5e6);
      e.billboard.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, city.capital || major ? Number.POSITIVE_INFINITY : 6e6);
    }
    for (const [id, e] of cityEntities) if (!seen.has(id)) { entities.entities.remove(e); cityEntities.delete(id); }
  }

  function syncUnits(state, selectedUnitId) {
    const byCell = new Map();
    for (const u of state.units) {
      if (UNITS[u.type]?.domain === 'space') continue; // спутники и перехватчики показываются в HUD
      if (!byCell.has(u.cell)) byCell.set(u.cell, []);
      byCell.get(u.cell).push(u);
    }
    const seen = new Set();
    for (const [cell, list] of byCell) {
      list.sort((a, b) => (b.id === selectedUnitId) - (a.id === selectedUnitId) || (UNITS[b.type].str - UNITS[a.type].str) || a.id.localeCompare(b.id));
      const top = list[0];
      const key = `cell:${cell}`;
      seen.add(key);
      const def = UNITS[top.type];
      const { lat, lon } = center(cell);
      const air = def.domain === 'air';
      const color = colorOf(top.owner, state);
      let e = unitEntities.get(key);
      if (!e) {
        e = entities.entities.add({
          id: `units:${cell}`,
          position: Cesium.Cartesian3.fromDegrees(lon + 0.35, lat - 0.25, air ? AIR_ALTITUDE : 0),
          billboard: { verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(2e4, 1.1, 1.2e7, 0.6) },
        });
        unitEntities.set(key, e);
      }
      e.kupol = { kind: 'units', cell, ids: list.map((u) => u.id) };
      e.billboard.heightReference = air ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND;
      e.billboard.image = unitIcon(top.type, color, top.hp, top.id === selectedUnitId, list.length);
      // вблизи корабли и самолёты показываются 3D-моделями из public/models (CC BY 4.0)
      if (def.model) {
        e.model = new Cesium.ModelGraphics({
          uri: `/models/${def.model}`, minimumPixelSize: 42, maximumScale: 6000,
          heightReference: air ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, MODEL_VISIBLE_KM * 1000),
          color: Cesium.Color.fromCssColorString(color), colorBlendMode: Cesium.ColorBlendMode.MIX, colorBlendAmount: 0.25,
        });
      } else e.model = undefined;
    }
    for (const [key, e] of unitEntities) if (!seen.has(key)) { entities.entities.remove(e); unitEntities.delete(key); }
  }

  function syncSelection(cell) {
    if (selectionEntity) { entities.entities.remove(selectionEntity); selectionEntity = null; }
    if (cell === null || cell === undefined) return;
    const pts = unwrapRing(geometry.rings[cell].points);
    selectionEntity = entities.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([...pts, pts[0]].flatMap((p) => [p.lon, p.lat])),
        width: 6, clampToGround: true, classificationType: Cesium.ClassificationType.BOTH,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.WHITE }),
      },
    });
  }

  function syncImpact(state) {
    const area = state.finale?.impactArea;
    if (!area) { if (impactEntity) { entities.entities.remove(impactEntity); impactEntity = null; } return; }
    const radius = Math.max(150, area.uncertaintyKm) * 1000;
    if (!impactEntity) {
      impactEntity = entities.entities.add({
        position: Cesium.Cartesian3.fromDegrees(area.lon, area.lat),
        ellipse: { semiMajorAxis: radius, semiMinorAxis: radius, material: Cesium.Color.fromCssColorString('#ff4a3a').withAlpha(0.16), classificationType: Cesium.ClassificationType.BOTH },
        label: { text: 'Зона падения «Немезиды»', font: '700 14px "Noto Sans", sans-serif', fillColor: Cesium.Color.fromCssColorString('#ffb3a8'), outlineColor: Cesium.Color.BLACK, outlineWidth: 4, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    }
    impactEntity.position = Cesium.Cartesian3.fromDegrees(area.lon, area.lat);
    impactEntity.ellipse.semiMajorAxis = radius;
    impactEntity.ellipse.semiMinorAxis = radius;
  }

  // заливка территорий гаснет вблизи: на уровне города видно настоящие снимки и здания
  scene.preRender.addEventListener(() => {
    const h = viewer.camera.positionCartographic.height;
    if (fill) fill.show = h > FILL_FADE_HEIGHT;
    if (fog) fog.show = true;
  });

  return {
    update(state, { selectedUnitId = null, selectedCell = null } = {}) {
      buildTerritory(state);
      buildFog(state);
      syncCities(state);
      syncUnits(state, selectedUnitId);
      syncSelection(selectedCell);
      syncImpact(state);
    },
    /** Что под курсором: город, стек юнитов или ячейка. */
    pick(position) {
      const picked = scene.pick(position);
      const meta = picked?.id?.kupol;
      if (meta) return meta;
      let cartesian = scene.pickPositionSupported ? scene.pickPosition(position) : undefined;
      if (!Cesium.defined(cartesian)) cartesian = viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid);
      if (!Cesium.defined(cartesian)) return null;
      const c = Cesium.Cartographic.fromCartesian(cartesian);
      return { kind: 'cell', cell: geometry.nearest(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude)) };
    },
  };
}
