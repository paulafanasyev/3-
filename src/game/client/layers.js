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
  let fallout = null; let falloutKey = null;
  const reconEntities = [];
  const seenStrikes = new Set();
  let strikesPrimed = false;

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
      e.billboard.image = unitIcon(top.type, color, top.hp, top.id === selectedUnitId, list.length, top.vet ?? 0);
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

  // радиоактивные осадки: жёлто-зелёные клетки, пока не рассеются
  function buildFallout(state) {
    const list = state.nuclear?.fallout ?? [];
    const key = list.map(([c]) => c).join(',');
    if (key === falloutKey) return;
    falloutKey = key;
    fallout = replacePrimitive(fallout, list.length ? new Cesium.GroundPrimitive({
      geometryInstances: list.map(([cell]) => new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringDegrees(geometry.rings[cell]))) }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#b8ff3a').withAlpha(0.38)) },
      })),
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: Cesium.ClassificationType.BOTH, asynchronous: false,
    }) : null);
  }

  // зоны орбитальной разведки: голубые круги радиусом ~3 клетки
  function syncRecon(state) {
    for (const e of reconEntities.splice(0)) entities.entities.remove(e);
    for (const z of state.nuclear?.recon ?? []) {
      const p = center(z.cell);
      reconEntities.push(entities.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        ellipse: { semiMajorAxis: 420_000, semiMinorAxis: 420_000, material: Cesium.Color.fromCssColorString('#5ad1ff').withAlpha(0.07), outline: false, classificationType: Cesium.ClassificationType.BOTH },
        label: { text: `Спутниковая съёмка · до хода ${z.until}`, font: '600 12px "Noto Sans", sans-serif', fillColor: Cesium.Color.fromCssColorString('#a8e6ff'), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(200_000, 9_000_000) },
      }));
    }
  }

  /** Новый пуск: дуга от шахты к цели и вспышка с расходящейся волной. Старые удары не проигрываем. */
  function syncStrikes(state) {
    const list = state.nuclear?.strikes ?? [];
    for (const st of list) {
      const key = `${st.turn}:${st.cell}:${st.from}`;
      if (seenStrikes.has(key)) continue;
      seenStrikes.add(key);
      if (strikesPrimed && st.cell !== null && st.cell !== undefined) animateStrike(st);
    }
    strikesPrimed = true;
  }

  function animateStrike(st) {
    const to = center(st.cell);
    const start = performance.now();
    const color = st.intercepted ? Cesium.Color.fromCssColorString('#5ad1ff') : Cesium.Color.fromCssColorString('#ffd23a');
    const added = [];
    if (st.fromCell !== null && st.fromCell !== undefined) {
      const from = center(st.fromCell);
      const n = 48; const pts = [];
      const km = Cesium.Cartesian3.distance(Cesium.Cartesian3.fromDegrees(from.lon, from.lat), Cesium.Cartesian3.fromDegrees(to.lon, to.lat));
      for (let i = 0; i <= n; i += 1) {
        const t = i / n;
        pts.push(Cesium.Cartesian3.fromDegrees(from.lon + (to.lon - from.lon) * t, from.lat + (to.lat - from.lat) * t, Math.sin(Math.PI * t) * Math.max(150_000, km * 0.25)));
      }
      added.push(entities.entities.add({ polyline: { positions: pts, width: 3, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color }) } }));
    }
    const radius = new Cesium.CallbackProperty(() => 30_000 + Math.min(1, (performance.now() - start) / 2500) * (st.intercepted ? 60_000 : 260_000), false);
    const alpha = new Cesium.CallbackProperty(() => color.withAlpha(Math.max(0, 0.75 - (performance.now() - start) / 8000)), false);
    added.push(entities.entities.add({
      position: Cesium.Cartesian3.fromDegrees(to.lon, to.lat),
      ellipse: { semiMajorAxis: radius, semiMinorAxis: radius, material: new Cesium.ColorMaterialProperty(alpha), classificationType: Cesium.ClassificationType.BOTH },
      point: st.intercepted ? undefined : { pixelSize: 26, color: Cesium.Color.WHITE.withAlpha(0.9), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
    if (!st.intercepted) added.push(...mushroom(to, start));
    setTimeout(() => { for (const e of added) entities.entities.remove(e); }, 12000);
  }

  /** Грибовидное облако: огненный столб и шапка растут, остывают от оранжевого к серому. */
  function mushroom(at, start) {
    const t = () => Math.min(1, (performance.now() - start) / 6000);
    const ease = () => 1 - (1 - t()) ** 3;
    const fire = Cesium.Color.fromCssColorString('#ff8a2a');
    const ash = Cesium.Color.fromCssColorString('#8d8478');
    const tint = (a) => new Cesium.CallbackProperty(() => Cesium.Color.lerp(fire, ash, Math.min(1, t() * 1.4), new Cesium.Color()).withAlpha(a * (1 - Math.max(0, t() - 0.75) * 2)), false);
    const H = 60_000;
    const stemLen = new Cesium.CallbackProperty(() => Math.max(1000, H * ease()), false);
    const stemPos = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, Math.max(500, H * ease()) / 2), false);
    const capPos = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, H * ease()), false);
    const capR = new Cesium.CallbackProperty(() => { const r = 4000 + 30_000 * ease(); return new Cesium.Cartesian3(r, r, r * 0.55); }, false);
    const ringR = new Cesium.CallbackProperty(() => { const r = 6000 + 40_000 * ease(); return new Cesium.Cartesian3(r, r, r * 0.18); }, false);
    return [
      entities.entities.add({ position: stemPos, cylinder: { length: stemLen, topRadius: 5000, bottomRadius: 9000, material: new Cesium.ColorMaterialProperty(tint(0.85)) } }),
      entities.entities.add({ position: capPos, ellipsoid: { radii: capR, material: new Cesium.ColorMaterialProperty(tint(0.9)) } }),
      entities.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(at.lon, at.lat, H * ease() * 0.55), false), ellipsoid: { radii: ringR, material: new Cesium.ColorMaterialProperty(tint(0.6)) } }),
      entities.entities.add({ position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat), ellipsoid: { radii: new Cesium.CallbackProperty(() => { const r = 8000 + 45_000 * ease(); return new Cesium.Cartesian3(r, r, r * 0.25); }, false), material: new Cesium.ColorMaterialProperty(tint(0.55)) } }),
    ];
  }

  // ---------- анимация боя ----------
  const RANGED = new Set(['archer', 'artillery', 'galley', 'ironclad', 'helicopter', 'drone', 'fighter', 'biplane']);
  /**
   * Бой как в Civilization: атакующий бросается на клетку (ближний бой) или стреляет
   * по дуге (лучники, артиллерия, флот, авиация); вспышка, всплывающий урон и итог.
   */
  function playCombat(c, state) {
    if (c?.from === undefined || c.to === undefined) return;
    const a = center(c.from); const b = center(c.to);
    const start = performance.now();
    const T = 1600;
    const col = Cesium.Color.fromCssColorString(colorOf(c.attackerOwner, state));
    const added = [];
    const ranged = RANGED.has(c.attacker);
    const lerp = (p) => Cesium.Cartesian3.fromDegrees(a.lon + (b.lon - a.lon) * p, a.lat + (b.lat - a.lat) * p, ranged ? Math.sin(Math.PI * p) * 60_000 : 0);
    // фишка атакующего: рывок к цели и назад или снаряд по дуге
    added.push(entities.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const t = Math.min(1, (performance.now() - start) / T);
        if (ranged) return lerp(Math.min(1, t * 1.6));
        const advance = c.won && (c.captured || (c.killed && !c.city)); // занял клетку
        const p = t < 0.45 ? 0.8 * (t / 0.45) : advance ? 0.8 + 0.2 * ((t - 0.45) / 0.55) : 0.8 * (1 - (t - 0.45) / 0.55);
        return lerp(p);
      }, false),
      billboard: ranged
        ? { image: shellIcon(), scale: 0.9, disableDepthTestDistance: Number.POSITIVE_INFINITY }
        : { image: unitIcon(c.attacker, colorOf(c.attackerOwner, state), c.hpBefore ?? 100, false, 1), scale: 1.25, disableDepthTestDistance: Number.POSITIVE_INFINITY, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    }));
    if (ranged) {
      const pts = []; for (let i = 0; i <= 30; i += 1) pts.push(lerp(i / 30));
      added.push(entities.entities.add({ polyline: { positions: pts, width: 2, material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.8), dashLength: 14 }) } }));
    }
    // вспышка удара по цели
    const hitAt = ranged ? T / 1.6 : T * 0.45;
    const flash = new Cesium.CallbackProperty(() => {
      const dt = performance.now() - start - hitAt;
      return dt < 0 ? 1 : 2_000 + Math.min(1, dt / 700) * 22_000;
    }, false);
    const flashColor = new Cesium.CallbackProperty(() => {
      const dt = performance.now() - start - hitAt;
      return Cesium.Color.fromCssColorString('#ffb347').withAlpha(dt < 0 ? 0 : Math.max(0, 0.8 - dt / 1200));
    }, false);
    added.push(entities.entities.add({ position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat), ellipse: { semiMajorAxis: flash, semiMinorAxis: flash, material: new Cesium.ColorMaterialProperty(flashColor), classificationType: Cesium.ClassificationType.BOTH } }));
    // всплывающий урон: красный у проигравшего, итог над целью
    const rise = (dy0) => new Cesium.CallbackProperty(() => new Cesium.Cartesian2(0, dy0 - Math.min(40, (performance.now() - start - hitAt) / 40)), false);
    const fade = (rgb) => new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString(rgb).withAlpha(Math.max(0, Math.min(1, (performance.now() - start - hitAt) / 200)) * Math.max(0, 1 - (performance.now() - start - hitAt - 1800) / 800)), false);
    const lostA = Math.max(0, (c.hpBefore ?? 100) - (c.attackerHp ?? 0));
    const label = (pos, text, rgb, dy, size = 18) => entities.entities.add({ position: pos, label: { text, font: `800 ${size}px "Noto Sans", sans-serif`, fillColor: fade(rgb), outlineColor: Cesium.Color.BLACK, outlineWidth: 4, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: rise(dy), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    added.push(label(Cesium.Cartesian3.fromDegrees(a.lon, a.lat), lostA ? `−${lostA}` : '', '#ff6b5e', -30));
    added.push(label(Cesium.Cartesian3.fromDegrees(b.lon, b.lat), c.won ? (c.captured ? 'ГОРОД ВЗЯТ' : c.killed ? 'УНИЧТОЖЕН' : c.city ? `−${(c.cityHpBefore ?? 0) - (c.cityHp ?? 0)} прочности` : 'ПОБЕДА') : 'АТАКА ОТБИТА', c.won ? '#ffd166' : '#8fd3ff', -36, 20));
    setTimeout(() => { for (const e of added) entities.entities.remove(e); }, 3400);
  }

  let shell = null;
  function shellIcon() {
    if (shell) return shell;
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(12, 12, 1, 12, 12, 11);
    r.addColorStop(0, '#fff7d1'); r.addColorStop(0.4, '#ffb347'); r.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = r; g.fillRect(0, 0, 24, 24);
    shell = c.toDataURL();
    return shell;
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
      buildFallout(state);
      syncRecon(state);
      syncStrikes(state);
    },
    playCombat,
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
