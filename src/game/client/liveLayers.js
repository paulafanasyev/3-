// «Живая Земля»: настоящие слои God's Eye View поверх партии. Самолёты, спутники,
// землетрясения и запуски ракет идут через те же модули и /api-прокси, что и в GEV.
// На правила игры они не влияют. Модули тяжёлые, поэтому грузятся при первом включении.
import { DataLayerManager } from '../../data/manager.js';
import { LIVE_LAYERS } from './liveList.js';

export { LIVE_LAYERS };


export function createLiveLayers(viewer, onChange = () => {}) {
  let manager = null;
  let loading = null;
  const idOf = new Map(); // наш ключ → id слоя GEV
  const failed = new Set();
  const state = Object.fromEntries(LIVE_LAYERS.map((l) => [l.key, { on: false, busy: false, count: 0, error: null }]));

  async function ensure() {
    if (manager) return manager;
    loading ??= (async () => {
      const m = new DataLayerManager(viewer);
      const modules = await Promise.all(LIVE_LAYERS.map((l) => l.load().then((mod) => mod.default, (error) => {
        console.warn(`[Купол] слой ${l.key} не загрузился:`, error);
        failed.add(l.key);
        return null;
      })));
      LIVE_LAYERS.forEach((l, i) => {
        const mod = modules[i];
        if (!mod) return;
        try { m.register(mod); idOf.set(l.key, mod.id); } catch (error) { failed.add(l.key); console.warn(error); }
      });
      m.finalizeRegistrations([...idOf.values()].map((id) => ({ id, disposition: 'enabled-only' })));
      const launches = modules[LIVE_LAYERS.findIndex((l) => l.key === 'launches')];
      launches?.attachDataManager?.(m);
      m.subscribe(() => refresh());
      manager = m;
      return m;
    })();
    return loading;
  }

  function refresh() {
    if (manager) {
      for (const l of LIVE_LAYERS) {
        const id = idOf.get(l.key);
        const entry = id && manager.getAll().find((x) => x.id === id);
        if (!entry) continue;
        const s = state[l.key];
        s.on = entry.enabled;
        s.busy = entry.lifecycleState === 'enabling' || entry.lifecycleState === 'disabling';
        s.count = entry.stats?.count ?? 0;
        s.error = entry.stats?.error || entry.stats?.lastError || entry.stats?.managerRefreshError || null;
      }
    }
    for (const key of failed) state[key].error = 'модуль не загрузился';
    onChange(state);
  }

  return {
    state,
    async toggle(key) {
      const s = state[key];
      if (!s || s.busy) return;
      s.busy = true; onChange(state);
      try {
        const m = await ensure();
        const id = idOf.get(key);
        if (!id) throw new Error('слой недоступен');
        await m.setEnabled(id, !m.isEnabled(id), { origin: 'user' });
      } catch (error) {
        console.warn(`[Купол] слой ${key}:`, error);
        s.error = 'не удалось включить';
      }
      s.busy = false;
      refresh();
    },
  };
}
