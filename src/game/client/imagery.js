// Подложка глобуса без ключа Google. Порядок:
//  1. Natural Earth II — снимок, который поставляется вместе с CesiumJS (Assets/Textures/NaturalEarthII):
//     грузится с нашего же сервера, без ключей и без интернета. Кладётся всегда, снизу.
//  2. Фото-подложка ArcGIS World Imagery: настоящий спутник до уровня улицы, ключа не требует.
//  3. Спутниковые снимки Cesium ion (asset 2) — только если ArcGIS недоступен.
//  4. И только потом OpenStreetMap (векторная карта, без ключа, но нужен интернет).
// Если верхний слой не грузится (нет сети, токен отозван), он снимается — под ним остаётся Natural Earth.
// Cesium передаётся параметром, чтобы логику можно было проверить в Node без браузера.
//
// ion стоит ниже ArcGIS не из-за надёжности, а из-за разрешения: asset 2 — это
// глобальный композит Blue Marble (~500 м/пиксель), и над городом он выглядит
// раскрашенной картой, а не снимком. Игрок требует «спутниковую карту как у
// God's Eye View», поэтому первым пробуем слой с реальным разрешением улицы.

export const ION_WORLD_IMAGERY_ASSET = 2;
export const TILE_ERROR_LIMIT = 8;
export const ESRI_WORLD_IMAGERY_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Ждём промис не дольше ms, иначе ошибка (ion без сети может висеть долго). */
export function withTimeout(promise, ms, label = 'timeout') {
  let timer; let late = false;
  // если ответ пришёл уже после таймаута, брошенный провайдер освобождаем
  const guarded = Promise.resolve(promise).then((value) => { if (late) value?.destroy?.(); return value; });
  return Promise.race([
    guarded,
    new Promise((_, reject) => { timer = setTimeout(() => { late = true; reject(new Error(label)); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Снимает слой после TILE_ERROR_LIMIT ошибок тайлов; onDrop вызывается один раз. */
export function dropOnTileErrors(viewer, layer, provider, onDrop = () => {}) {
  let errors = 0; let dropped = false;
  const unsubscribe = provider?.errorEvent?.addEventListener?.(() => {
    errors += 1;
    if (dropped || errors < TILE_ERROR_LIMIT) return;
    dropped = true;
    if (typeof unsubscribe === 'function') unsubscribe(); // слой уничтожается: слушатель больше не нужен
    viewer.imageryLayers.remove(layer, true);
    onDrop();
  });
}

/**
 * Кладёт подложку и возвращает источник: 'ion' | 'osm' | 'offline' | 'none'.
 * onChange(source) — если верхний слой отвалился уже после старта.
 */
export async function addFallbackImagery(Cesium, viewer, { online = true, timeoutMs = 8000, onChange = () => {} } = {}) {
  let base = false;
  try {
    const provider = await Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'));
    viewer.imageryLayers.add(new Cesium.ImageryLayer(provider));
    base = true;
  } catch (error) {
    console.warn('[Купол] встроенная подложка Natural Earth не загрузилась:', error);
  }
  const offline = base ? 'offline' : 'none';
  if (!online) return offline;

  try {
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: ESRI_WORLD_IMAGERY_URL,
      maximumLevel: 19,
      credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    dropOnTileErrors(viewer, layer, provider, () => onChange(offline));
    return 'esri';
  } catch (error) {
    console.warn('[Купол] ArcGIS World Imagery недоступен, пробую Cesium ion:', error);
  }
  try {
    const provider = await withTimeout(Cesium.IonImageryProvider.fromAssetId(ION_WORLD_IMAGERY_ASSET), timeoutMs, 'ion timeout');
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    dropOnTileErrors(viewer, layer, provider, () => onChange(offline));
    return 'ion';
  } catch (error) {
    console.warn('[Купол] Cesium ion недоступен, пробую OpenStreetMap:', error);
  }
  try {
    const provider = new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    dropOnTileErrors(viewer, layer, provider, () => onChange(offline));
    return 'osm';
  } catch (error) {
    console.warn('[Купол] OpenStreetMap недоступен:', error);
  }
  return offline;
}

/** Подсказка игроку: какая Земля сейчас на экране. */
export const SOURCE_TOAST = {
  esri: 'Без ключа Google: спутник ArcGIS World Imagery (Maxar/Earthstar)',
  ion: 'Без ключа Google: снимок Cesium ion (ArcGIS недоступен, разрешение ниже)',
  osm: 'Без ключа Google: карта OpenStreetMap поверх встроенного снимка',
  offline: 'Офлайн-глобус: встроенный снимок Natural Earth, ключи и интернет не нужны',
  none: 'Подложка глобуса не загрузилась: видны только игровые слои',
};
