// Клиент «Купола» на CesiumJS. Земля та же, что в God's Eye View: Google Photorealistic
// 3D Tiles (спутниковые снимки и 3D-здания от орбиты до улицы), при недоступности —
// глобус Cesium со спутниковой подложкой. Игровые слои ложатся поверх (layers.js).
import * as Cesium from 'cesium';
import './hud.css';
import { createCellGeometry } from './geometry.js';
import { createWorldLayers } from './layers.js';
import { createHud } from './hud.js';
import { connectGame } from './net.js';

const START_VIEW = { lon: -98, lat: 22, height: 7_500_000 };

async function createViewer(container) {
  const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
  if (cesiumToken) Cesium.Ion.defaultAccessToken = cesiumToken;
  const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) Cesium.GoogleMaps.defaultApiKey = googleApiKey;

  const credits = document.createElement('div');
  credits.id = 'cesium-credits';
  document.body.appendChild(credits);
  const viewer = new Cesium.Viewer(container, {
    timeline: false, animation: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, vrButton: false,
    selectionIndicator: false, infoBox: false, baseLayer: false,
    creditContainer: credits, // атрибуция Google обязательна по условиям использования
    msaaSamples: 4,
  });
  viewer.targetFrameRate = 60;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
  viewer.scene.skyAtmosphere.saturationShift = -0.12;
  viewer.scene.skyAtmosphere.brightnessShift = -0.08;
  viewer.screenSpaceCameraController.enableCollisionDetection = true;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  let source = 'google';
  try {
    if (!googleApiKey) throw new Error('нет GOOGLE_MAPS_API_KEY');
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false; // у 3D-тайлов свой глобус на всех масштабах
  } catch (error) {
    console.warn('[Купол] Google 3D Tiles недоступны, включаю запасной глобус:', error);
    viewer.scene.globe.show = true;
    source = 'fallback';
    try {
      viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery()); // спутниковая подложка Cesium Ion
      source = 'ion';
    } catch {
      viewer.imageryLayers.add(new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })));
      source = 'osm';
    }
  }
  await Cesium.GroundPrimitive.initializeTerrainHeights();
  return { viewer, source };
}

function flyToCell(viewer, geometry, cell, height = 2_200_000, duration = 2.2) {
  const { lat, lon } = geometry.cells[cell];
  const pitch = height < 200_000 ? -35 : -70;
  // камера смотрит на клетку под углом: отодвигаем точку обзора к югу на высоту/тангенс
  const back = height < 200_000 ? (height / Math.tan(Cesium.Math.toRadians(35))) / 111_000 : height / 400_000;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat - back, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
    duration,
  });
}

export async function bootKupol() {
  document.body.classList.add('kupol');
  document.title = 'Купол';
  const globe = document.createElement('div'); globe.id = 'kupol-globe'; document.body.appendChild(globe);
  const root = document.createElement('div'); root.id = 'kupol-root'; document.body.appendChild(root);

  const geometry = createCellGeometry();
  const { viewer, source } = await createViewer(globe);
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(START_VIEW.lon, START_VIEW.lat, START_VIEW.height) });
  const layers = createWorldLayers(viewer, geometry);

  let state = null;
  let selection = { cell: null, unitId: null };
  const log = [];
  let firstState = true;

  const myUnit = (id) => state?.units.find((u) => u.id === id && u.owner === state.nationId);

  const hud = createHud(root, {
    research: (d) => send({ kind: 'research', tech: d.tech }),
    produce: (d) => send({ kind: 'produce', cityId: d.city, item: d.kind === 'dome' ? { kind: 'dome' } : { kind: d.kind, id: d.id } }),
    buy: (d) => send({ kind: 'buy', cityId: d.city }),
    fly: (d) => flyToCell(viewer, geometry, Number(d.cell), 9_000),
    selectUnit: (d) => { selection.unitId = d.unit; redraw(); },
    found: (d) => send({ kind: 'found', unitId: d.unit }),
    fortify: (d) => send({ kind: 'fortify', unitId: d.unit }),
    disband: (d) => send({ kind: 'disband', unitId: d.unit }),
    propose: (d) => send({ kind: 'propose', target: d.target, treaty: d.treaty }).then((r) => r.ok && hud.toast(r.queued ? 'Предложение отправлено' : 'Договор заключён')),
    peace: (d) => send({ kind: 'proposePeace', target: d.target }),
    war: (d) => { if (confirm('Объявить войну? Это ударит по репутации, если нет повода.')) send({ kind: 'declareWar', target: d.target }); },
    respond: (d) => send({ kind: 'respond', offerId: d.offer, accept: d.accept === '1' }),
    path: (d) => send({ kind: 'choosePath', path: d.path }),
    contribute: () => { const me = state.nations.find((n) => n.id === state.nationId); send({ kind: 'contribute', gold: Math.floor(me.gold / 2) }); },
    endTurn: endTurn,
  });
  const net = connectGame({
    onState(next) {
      state = next;
      for (const e of next.events) log.push({ turn: e.turn, text: e.text });
      if (log.length > 200) log.splice(0, log.length - 200);
      // выбранный юнит мог уйти или погибнуть: выделение следует за ним
      const picked = state.units.find((u) => u.id === selection.unitId);
      if (picked) selection.cell = picked.cell;
      else if (selection.unitId) selection.unitId = null;
      if (firstState) {
        firstState = false;
        const me = state.nations.find((n) => n.id === state.nationId);
        const home = state.cities.find((c) => c.owner === me.id)?.cell ?? state.units.find((u) => u.owner === me.id)?.cell;
        if (home !== undefined) flyToCell(viewer, geometry, home, 2_400_000, 3.5);
      }
      redraw();
    },
    onError(msg) { hud.toast(msg.message ?? 'Ошибка сервера'); },
    onStatus(status) { hud.setStatus(status); if (state) redraw(); },
  });

  function selectionView() {
    if (!state || selection.cell === null) return null;
    const city = state.cities.find((c) => c.cell === selection.cell && c.owner === state.nationId && c.queue);
    const units = state.units.filter((u) => u.cell === selection.cell);
    return { city, units, unitId: selection.unitId };
  }

  function redraw() {
    if (!state) return;
    layers.update(state, { selectedUnitId: selection.unitId, selectedCell: selection.cell });
    hud.render(state, selectionView(), log);
  }

  async function send(command) {
    const r = await net.command(command).catch(() => ({ ok: false, message: 'Нет связи с сервером' }));
    if (!r.ok) hud.toast(r.message ?? 'Нельзя');
    return r;
  }

  hud.setStatus('connecting');
  if (source !== 'google') hud.toast('Google 3D Tiles недоступны: показан запасной спутниковый глобус');

  async function endTurn() {
    if (!state || state.status !== 'running') return;
    hud.busy(true);
    const r = await net.endTurn().catch(() => ({ ok: false, message: 'Нет связи с сервером' }));
    hud.busy(false);
    if (!r.ok) hud.toast(r.message ?? 'Ход не завершён');
  }

  // мышь: ЛКМ — выбор, ПКМ — приказ идти, двойной щелчок — подлёт к земле (как в God's Eye View)
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((e) => {
    const hit = layers.pick(e.position);
    if (!hit || !state) return;
    if (hit.kind === 'units') {
      selection = { cell: hit.cell, unitId: hit.ids.find((id) => myUnit(id)) ?? hit.ids[0] };
    } else if (hit.kind === 'city') {
      const c = state.cities.find((x) => x.id === hit.id);
      selection = { cell: c.cell, unitId: null };
    } else {
      const mine = state.units.find((u) => u.cell === hit.cell && u.owner === state.nationId);
      selection = { cell: hit.cell, unitId: mine?.id ?? null };
    }
    redraw();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((e) => {
    if (!state || !myUnit(selection.unitId)) return;
    const hit = layers.pick(e.position);
    const cell = hit?.kind === 'city' ? state.cities.find((x) => x.id === hit.id)?.cell : hit?.cell;
    if (cell === undefined || cell === null) return;
    send({ kind: 'move', unitId: selection.unitId, to: cell }).then((r) => {
      const u = myUnit(selection.unitId);
      if (u) selection.cell = u.cell;
      if (r.ok && r.attacked) hud.toast(r.won ? 'Атака успешна' : 'Атака отбита');
      redraw();
    });
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  handler.setInputAction((e) => {
    const hit = layers.pick(e.position);
    const cell = hit?.kind === 'city' ? state?.cities.find((x) => x.id === hit.id)?.cell : hit?.cell;
    if (cell !== undefined && cell !== null) flyToCell(viewer, geometry, cell, 9_000);
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'Enter') endTurn();
    if (e.key === 'Escape') { selection = { cell: null, unitId: null }; redraw(); }
    if ((e.key === 'f' || e.key === 'а') && myUnit(selection.unitId)?.type === 'settler') send({ kind: 'found', unitId: selection.unitId });
  });

  const player = await hud.chooseNation();
  net.newGame({ player });
  window.__kupol = { viewer, get state() { return state; } };
}
