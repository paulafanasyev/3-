// Интерфейс партии: только отображение снимка и сбор намерений игрока.
// Все проверки делает сервер; HUD показывает варианты из snapshot.choices.
import { TECHS, ERAS } from '../data/techs.js';
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { NATIONS } from '../data/nations.js';
import { LEADERS } from '../data/leaders.js';
import { TREATY_NAMES } from '../i18n/ru.js';
import { LIVE_LAYERS, liveUnlocked } from './liveList.js';
import { unitPortrait } from './icons.js';
import { diplomacyActions } from './diplomacy-ui.js';
import { technologyTree } from './tech-ui.js';
import { endingCopy } from './endgame.js';

const MOOD = { hostile: ['враждебность', '#ff6b5e'], cold: ['холодность', '#8fb3ff'], neutral: ['сдержанность', '#c6ccd6'], warm: ['дружелюбие', '#8fe0a6'], friend: ['близкий союзник', '#5ee0b0'] };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alpha = (hex, a) => { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
const itemName = (it) => (it.kind === 'unit' ? UNITS[it.id]?.name : it.kind === 'building' ? BUILDINGS[it.id]?.name : it.kind === 'dome' ? 'Вклад в щит «Купола»' : ({ science: 'Научный проект', gold: 'Торговый проект' }[it.id] ?? it.id));
const portrait = (nationId, mood) => `/game/leaders/${nationId}${mood && mood !== 'neutral' ? `-${mood}` : ''}.png`;

function img(src, color, fallback) {
  return `<img class="k-por" src="${src}" style="border-color:${color}" onerror="this.outerHTML='<div class=&quot;k-por&quot; style=&quot;border-color:${color};color:${color}&quot;>${esc(fallback)}</div>'">`;
}

export function createHud(root, actions) {
  root.innerHTML = `
    <div class="k-top glass"></div>
    <div class="k-left"></div>
    <div class="k-right"></div>
    <div class="k-chron glass"></div>
    <div class="k-fin glass" style="display:none"></div>
    <div class="k-gameover" style="display:none"></div>
    <div class="k-reconnect" style="display:none"><b>Связь с сервером потеряна — переподключаемся…</b><button data-act="reload">Обновить страницу</button></div>
    <button class="k-end">Конец хода<small>Enter</small></button>
    <div class="k-toast glass" style="opacity:0"></div>
    <div class="k-offer glass" style="display:none"></div>
    <div class="k-live glass"></div>
    <button class="k-help" data-act="help" title="Справка (F1 или ?)">?</button>
    <div class="k-help-overlay" style="display:none"></div>
    <div class="k-combat glass" style="display:none"></div>
    <div class="k-hint glass">ЛКМ — выбрать · ПКМ — идти/атаковать (у ракеты — пуск, у спутника — съёмка) · двойной щелчок — приблизить · F — основать город · Enter — конец хода</div>`;
  const $ = (s) => root.querySelector(s);
  let toastTimer = null;
  let netStatus = 'connecting';
  let turnBusy = false;
  let lastSnap = null;
  let liveState = null;

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset;
    const input = b.closest('.k-action')?.querySelector('input[data-value]') ?? b.closest('.k-lc, .k-card')?.querySelector('input[data-value]');
    const data = { ...d, amount: input?.value };
    if (d.act === 'help') help();
    else if (d.act === 'helpClose') help(false);
    else actions[d.act]?.(data);
  });
  $('.k-end').addEventListener('click', () => actions.endTurn());

  function help(show = true) {
    const el = $('.k-help-overlay');
    if (!show) { el.style.display = 'none'; return; }
    let first = false;
    try { first = !localStorage.getItem('kupol.help.seen'); localStorage.setItem('kupol.help.seen', '1'); } catch { /* приватный режим браузера */ }
    el.innerHTML = `<div class="glass k-help-box"><button class="k-help-close" data-act="helpClose">×</button><h2>Справка по «Куполу»</h2>
      ${first ? '<div class="k-first-hint"><b>Совет первого хода:</b> основайте город клавишей F, выберите исследование и поставьте производство. Затем нажмите Enter.</div>' : ''}
      <h3>Цель</h3><p>Через 25 ходов после обнаружения астероида спасти Землю общим пактом «Купол» или пережить удар в Ковчеге. Полное спасение требует щита и совместных вкладов; при провале выживает только держава с построенным Ковчегом.</p>
      <h3>Управление</h3><p><b>ЛКМ</b> — выбрать юнит или город; <b>ПКМ</b> — идти или атаковать; <b>Shift+ПКМ</b> — тактический бой; двойной щелчок — приблизить; <b>F</b> — основать город; <b>Enter</b> — конец хода; <b>Esc</b> — снять выбор; <b>F1</b> или <b>?</b> — эта справка.</p>
      <h3>Ход</h3><p>Выберите технологию, задайте производство городам и прикажите юнитам действовать. В конце хода города дают ресурсы, накапливается наука, завершается исследование и обновляются армии.</p>
      <h3>Дипломатия</h3><p>В правой панели можно заключать договоры, дарить золото, торговаться, выдвигать ультиматумы, вести тайные операции и объявлять войну. Влияние и золото списываются сервером; предложения другой стороны появляются сверху.</p>
      <h3>Ядерные правила</h3><p>Ракета требует войны и разведки цели. Удар ухудшает репутацию и вызывает ядерную зиму; ПРО и спутники могут перехватить ракету. Спутник открывает разведанную область, а перехватчики помогают обороне «Купола».</p>
      <button class="k-btn" data-act="helpClose">Понятно</button></div>`;
    el.style.display = 'grid';
  }
  root.addEventListener('click', (e) => { if (e.target.closest('.k-help-close')) help(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'F1' || e.key === '?') { e.preventDefault(); help(); } });

  function top(s, me) {
    const fz = s.finale;
    const left = fz?.impactTurn ? fz.impactTurn - s.turn : null;
    $('.k-top').innerHTML = `<div class="k-logo">КУПОЛ</div><div class="k-sep"></div>
      <div class="k-turn"><b>Ход ${s.turn}</b><br>${esc(ERAS[me.era]?.name)}</div>
      <div class="k-status ${netStatus === 'online' ? '' : 'off'}">${netStatus === 'online' ? 'сервер на связи' : netStatus === 'offline' ? 'нет связи с сервером' : 'подключение…'}</div>
      <div class="k-chips">
        ${s.difficulty || me.difficulty ? `<div class="k-chip"><i>сложность</i><b>${esc(({ easy: 'лёгкая', normal: 'обычная', hard: 'сложная' }[s.difficulty || me.difficulty] ?? (s.difficulty || me.difficulty)))}</b></div>` : ''}
        <div class="k-chip"><i>золото</i><b>${Math.floor(me.gold)}</b></div>
        <div class="k-chip"><i>наука</i><b>${Math.floor(me.sciencePool ?? 0)}</b></div>
        <div class="k-chip"><i>влияние</i><b>${Math.floor(me.influence ?? 0)}</b></div>
        <div class="k-chip"><i>технологии</i><b>${me.techs.length}</b></div>
        <div class="k-chip"><i>репутация</i><b>${Math.round(me.reputation)}</b></div>
        ${s.nuclear?.warheads ? `<div class="k-chip nuke"><i>боеголовки</i><b>${s.nuclear.warheads}</b></div>` : ''}
        ${s.nuclear?.winter ? `<div class="k-chip winter"><i>ядерная зима</i><b>−${s.nuclear.winter}% еды</b></div>` : ''}
        ${fz ? `<div class="k-chip red"><i>Немезида</i><b>${s.result ? 'удар' : left > 0 ? `через ${left} ход.` : 'удар'}</b></div>` : ''}
      </div>`;
  }

  function left(s, me, sel) {
    const leader = LEADERS[me.id];
    const research = me.research ? TECHS[me.research]?.name : null;
    let html = `<div class="glass k-card"><div class="k-head">${img(portrait(me.id), me.color, me.name[0])}
      <div><div class="k-nm" style="color:${esc(me.color)}">${esc(me.name)}</div><div class="k-ld">${esc(me.leader?.name ?? leader?.name ?? '')}<br>${esc(me.leader?.title ?? '')}</div></div></div>
      <div class="k-row"><div class="k-chip"><i>эпоха</i><b>${esc(ERAS[me.era]?.name)}</b></div><div class="k-chip"><i>финал</i><b>${me.finale?.path === 'pact' ? '«Купол»' : me.finale?.path === 'ark' ? 'Ковчег' : '—'}</b></div></div></div>`;
    const tree = technologyTree(s);
    html += `<div class="glass k-card k-tech"><h4 class="k-h4">Исследование${research ? `: ${esc(research)}` : ''}</h4>${tree.eras.map((era) => `<details ${era.current ? 'open' : ''}><summary>${esc(era.name)} <small>${era.researched}/${era.required}</small></summary><div class="k-list">${era.techs.map((t) => `<button class="k-btn ${t.current ? 'on' : ''} ${t.researched ? 'done' : ''}" data-act="research" data-tech="${esc(t.id)}" ${t.available ? '' : 'disabled'} title="${esc(t.researched ? 'Технология изучена' : t.available ? 'Начать исследование' : `Нужны: ${t.req.map((r) => TECHS[r]?.name ?? r).join(', ') || 'предыдущая эпоха'}`)}">${esc(t.name)}<small>${t.researched ? 'изучено' : t.current ? 'исследуется' : t.available ? 'доступно' : 'закрыто'}</small></button>`).join('')}</div></details>`).join('')}</div>`;
    if (sel?.city) {
      const c = sel.city;
      const items = s.choices.production[c.id] ?? [];
      const current = c.queue?.[0];
      html += `<div class="glass k-card"><h4 class="k-h4">Город «${esc(c.name)}» · население ${c.pop}</h4>
        <div class="k-ld">Строится: ${current ? esc(itemName(current)) : 'ничего'} · постройки: ${c.buildings.length ? c.buildings.map((b) => esc(BUILDINGS[b]?.name)).join(', ') : 'нет'}</div>
        <div class="k-list" style="margin-top:8px">${items.map((it) => `<div class="k-prod"><button class="k-btn ${current && current.kind === it.kind && current.id === it.id ? 'on' : ''}" data-act="produce" data-city="${esc(c.id)}" data-kind="${esc(it.kind)}" data-id="${esc(it.id ?? '')}" title="Заменить очередь">${esc(itemName(it))}<small>${it.cost ?? '∞'}</small></button><button class="k-queue" data-act="produce" data-append="1" data-city="${esc(c.id)}" data-kind="${esc(it.kind)}" data-id="${esc(it.id ?? '')}" title="Добавить в очередь">+</button></div>`).join('')}</div>
        ${current && current.kind !== 'dome' ? `<div class="k-row"><button class="k-btn" data-act="buy" data-city="${esc(c.id)}">Купить за золото</button><button class="k-btn" data-act="fly" data-cell="${esc(c.cell)}">Приблизить</button></div>` : ''}</div>`;
    }
    if (sel?.units?.length) {
      html += `<div class="glass k-card"><h4 class="k-h4">Юниты в клетке</h4><div class="k-list">${sel.units.map((u) => `<button class="k-btn ${u.id === sel.unitId ? 'on' : ''}" data-act="selectUnit" data-unit="${u.id}">${esc(UNITS[u.type].name)}<small>${u.owner === me.id ? `ходы ${u.moves} · ${u.hp}%` : 'чужой'}</small></button>`).join('')}</div>
        ${unitActions(s, me, sel)}</div>`;
    }
    $('.k-left').innerHTML = html;
  }

  function unitActions(s, me, sel) {
    const u = sel.unitId && sel.units.find((x) => x.id === sel.unitId);
    if (!u || u.owner !== me.id) return '';
    const disband = `<button class="k-btn" data-act="disband" data-unit="${u.id}">Распустить</button>`;
    if (u.type === 'settler') return `<div class="k-row"><button class="k-btn" data-act="found" data-unit="${u.id}">Основать город (F)</button>${disband}</div>`;
    if (u.type === 'icbm') {
      const pact = me.finale?.path === 'pact' && s.finale;
      return `<div class="k-nuke-hint">☢ Ракета на боевом дежурстве. <b>ПКМ по вражеской клетке</b> — пуск (нужна война и разведка цели). Перехват: до 70% у противника с ПРО и спутниками. Весь мир запомнит.</div>
        <div class="k-row">${pact ? `<button class="k-btn" data-act="dismantle" data-unit="${u.id}">Разобрать в щит «Купола» (+250)</button>` : ''}${disband}</div>`;
    }
    if (u.type === 'satellite') {
      const ready = (u.reconReady ?? 0) <= s.turn;
      return `<div class="k-nuke-hint sat">🛰 ${ready ? '<b>ПКМ по любой точке Земли</b> — спутниковая съёмка: круг в 3 клетки на 5 ходов' : `Спутник перестраивает орбиту, съёмка с хода ${u.reconReady}`}</div><div class="k-row">${disband}</div>`;
    }
    if (u.type === 'interceptor') return `<div class="k-nuke-hint sat">Перехватчик на орбите: +12% к шансу сбить летящую в вас ракету и вклад в «Купол».</div><div class="k-row">${disband}</div>`;
    return `<div class="k-row"><button class="k-btn" data-act="fortify" data-unit="${u.id}">Укрепиться</button>${disband}</div>`;
  }

  function right(s, me) {
    // нейтральные народы: только живые и уже открытые на карте (иначе панель — список из десятков незнакомцев)
    // owner в снимке уже скрыт туманом: народ «известен», если видна хоть одна его клетка
    const known = (id) => (s.owner ?? []).some((o) => o === id);
    const neutrals = (s.neutrals ?? []).filter((p) => p.alive !== false && known(p.id)).sort((a, b) => (b.relation ?? 0) - (a.relation ?? 0));
    const all = [...(s.nations ?? []).filter((n) => n.id !== me.id), ...neutrals];
    const war = (id) => (s.wars ?? []).some((k) => k.split('|').includes(id));
    const actionHtml = (a) => {
      const d = Object.entries(a.payload ?? {}).filter(([k, v]) => v !== null && v !== undefined && typeof v !== 'object');
      const attrs = d.map(([k, v]) => `data-${esc(k)}="${esc(v)}"`).join(' ');
      const input = a.input ? `<input data-value type="number" min="1" step="1" value="10" aria-label="Количество золота" title="Количество золота">` : '';
      return `<span class="k-action">${input}<button ${attrs} data-act="${esc(a.action)}" ${a.enabled ? '' : 'disabled'} title="${esc(!a.enabled && a.reason ? a.reason : (a.title || ''))}">${esc(a.label)}</button></span>`;
    };
    $('.k-right').innerHTML = all.map((n) => {
      const major = s.nations.some((x) => x.id === n.id);
      const [mood, mc] = MOOD[n.moodId] ?? MOOD.neutral;
      if (major && !n.met) return `<div class="glass k-lc">${img('', '#3a4658', '?')}<div><div class="k-nm" style="color:${esc(n.color)}">${esc(n.name)}</div><div class="k-ld">Ещё не встречались</div></div></div>`;
      const actionsList = diplomacyActions(s, n.id);
      const acts = `${war(n.id) ? '<button data-act="peace" data-target="'+esc(n.id)+'" title="Мир возможен после пяти ходов войны.">Предложить мир</button>' : ''}${!war(n.id) && major ? '<button class="war" data-act="war" data-target="'+esc(n.id)+'" title="Ухудшит отношения и репутацию.">Объявить войну</button>' : ''}${actionsList.map(actionHtml).join('')}`;
      return `<div class="glass k-lc">${major ? img(portrait(n.id, n.moodId), n.color, n.name[0]) : img('', n.color ?? '#3a4658', n.name[0])}<div style="flex:1"><div class="k-nm" style="color:${esc(n.color)}">${esc(n.name)}</div><div class="k-ld">${major ? esc(n.leader?.name ?? '')+' · '+esc(ERAS[n.era]?.name ?? '') : 'нейтральный народ'}</div><span class="k-mood" style="background:${alpha(mc, 0.16)};color:${mc}">${esc(major ? mood : `отношение ${n.relation ?? 0}`)}${war(n.id) ? ' · война' : ''}</span><div class="k-acts">${acts}</div></div></div>`;
    }).join('');
  }

  function chronicle(s, log) {
    $('.k-chron').innerHTML = '<h4 class="k-h4">Хроника</h4>' + log.slice(-8).reverse().map((e) => `<div><b>${e.turn}</b>${esc(e.text)}</div>`).join('');
  }

  function finale(s) {
    const fz = s.finale; const el = $('.k-fin');
    if (!fz) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const r = s.result;
    el.innerHTML = `<h4 class="k-h4">Пакт «Купол»</h4>Щит: <b>${Math.round(fz.shield).toLocaleString('ru')}</b>
      <div class="k-bar"><i style="width:${Math.min(100, (fz.shield / (fz.shieldTarget || 45000)) * 100)}%"></i></div>
      ${r ? `Итог: <b>${r.outcome === 'saved' ? 'Земля спасена' : r.outcome === 'partial' ? 'частичный успех' : 'провал'}</b>` : `<div class="k-acts">
        <button data-act="path" data-path="pact">Вступить в «Купол»</button><button data-act="path" data-path="ark">Строить Ковчег</button>
        <button data-act="contribute">Вложить половину золота</button></div>`}`;
  }

  function gameOver(s) {
    const el = $('.k-gameover');
    if (!s || s.status === 'running') { el.style.display = 'none'; return; }
    const r = s.result ?? {};
    const copy = endingCopy(r);
    const winner = r.winnerName ?? s.nations.find((n) => n.id === r.winner)?.name ?? 'нет';
    const contribution = Object.entries(r.contributions ?? {}).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, value]) => `<div><span>${esc(s.nations.find((n) => n.id === id)?.name ?? id)}</span><b>${Math.round(value).toLocaleString('ru')}</b></div>`).join('');
    el.style.display = 'grid';
    el.innerHTML = `<div class="k-gameover-card glass"><h1>${esc(copy.title)}</h1><p>${esc(copy.text)}</p>
      <div class="k-gameover-stats"><div><span>Ход</span><b>${Number(s.turn) || 0}</b></div><div><span>Победитель</span><b>${esc(winner)}</b></div>${r.defense !== undefined ? `<div><span>Защита</span><b>${esc(r.defense)}%</b></div>` : ''}</div>
      ${contribution ? `<h4 class="k-h4">Вклад в спасение</h4><div class="k-contributions">${contribution}</div>` : ''}
      <button class="k-btn k-new-game" data-act="newGame">Новая партия</button></div>`;
  }

  function offers(s) {
    const o = s.offers[0]; const el = $('.k-offer');
    if (!o) { el.style.display = 'none'; return; }
    const from = s.nations.find((n) => n.id === o.from);
    el.style.display = 'block';
    const what = o.type === 'deal' ? 'сделку' : o.type === 'demand' ? 'ультиматум' : o.type === 'peace' ? 'мир' : TREATY_NAMES[o.type];
    el.innerHTML = `<h4 class="k-h4">${esc(from?.name)} предлагает: ${esc(what)}</h4>
      ${o.reply ? `<div class="k-line">«${esc(o.reply.text)}» — ${esc(o.reply.leader)}</div>` : ''}
      <div class="k-row"><button class="k-btn" data-act="respond" data-offer="${o.id}" data-accept="1">Принять</button><button class="k-btn" data-act="respond" data-offer="${o.id}" data-accept="0">Отклонить</button></div>`;
  }

  /** Панель «Живая Земля»: настоящие слои GEV. Каждый прибор открывается своей технологией. */
  function live(state) {
    if (state) liveState = state;
    const me = lastSnap?.nations.find((n) => n.id === lastSnap.nationId);
    $('.k-live').innerHTML = '<h4 class="k-h4">Живая Земля · разведка</h4>' + LIVE_LAYERS.map((l) => {
      const st = liveState?.[l.key] ?? {};
      if (lastSnap && !liveUnlocked(l, me, lastSnap.units)) {
        return `<button class="k-btn locked" disabled title="${esc(l.why)}: нужна технология «${esc(TECHS[l.unlock]?.name)}»">${esc(l.name)}<small>🔒 ${esc(TECHS[l.unlock]?.name)}</small></button>`;
      }
      const label = st.busy ? '…' : st.on ? (st.count ? String(st.count) : 'вкл') : 'выкл';
      return `<button class="k-btn ${st.on ? 'on' : ''}" data-act="live" data-key="${l.key}" title="${esc(l.why)} · ${esc(st.error ?? l.source)}">${esc(l.name)}<small>${esc(st.error && !st.on ? 'нет данных' : label)}</small></button>`;
    }).join('');
  }
  live(null);

  return {
    live,
    unlocked(key) {
      const l = LIVE_LAYERS.find((x) => x.key === key);
      const me = lastSnap?.nations.find((n) => n.id === lastSnap.nationId);
      return Boolean(l && liveUnlocked(l, me, lastSnap?.units));
    },
    /**
     * Окно боя как в Civilization: две фишки, силы, модификаторы и шанс победы.
     * Возвращает Promise<boolean>: атаковать или нет.
     */
    combatPreview(p, s) {
      const el = $('.k-combat');
      const me = s.nations.find((n) => n.id === s.nationId);
      const foe = s.nations.find((n) => n.id === p.defenderOwner) ?? s.neutrals.find((n) => n.id === p.defenderOwner);
      const odds = p.odds;
      const verdict = odds >= 80 ? ['Решительная победа', '#6be38f'] : odds >= 60 ? ['Вероятная победа', '#a8e08f'] : odds >= 40 ? ['Равный бой', '#ffd166'] : odds >= 20 ? ['Вероятное поражение', '#ffa36b'] : ['Почти верная гибель', '#ff6b5e'];
      const mods = (side) => p.mods.filter((m) => m.side === side).map((m) => `<div>${esc(m.text)}</div>`).join('') || '<div class="k-ld">без бонусов</div>';
      el.innerHTML = `<div class="k-cb-title" style="color:${verdict[1]}">${verdict[0]}</div>
        <div class="k-cb-row">
          <div class="k-cb-side"><img src="${unitPortrait(p.attacker, me.color, 96)}" alt=""><div class="k-nm" style="color:${esc(me.color)}">${esc(UNITS[p.attacker]?.name)}</div><div class="k-cb-str">${p.attack}</div><div class="k-cb-mods">${mods('a')}</div></div>
          <div class="k-cb-mid"><div class="k-cb-odds" style="color:${verdict[1]}">${odds}%</div><div class="k-cb-bar"><i style="width:${odds}%;background:${me.color}"></i><b style="width:${100 - odds}%;background:${foe?.color ?? '#888'}"></b></div><small>шанс победы</small></div>
          <div class="k-cb-side"><img src="${unitPortrait(p.defender ?? 'warrior', foe?.color ?? '#9a8f7a', 96)}" alt="" ${p.defender ? '' : 'style="opacity:.5"'}><div class="k-nm" style="color:${foe?.color}">${esc(p.city ? `«${p.city}»` : UNITS[p.defender]?.name ?? '')}</div><div class="k-cb-str">${p.defense}</div><div class="k-cb-mods">${mods('d')}</div></div>
        </div>
        ${p.atWar ? '' : `<div class="k-nuke-hint">Войны с «${esc(foe?.name)}» нет: атака ${foe && s.neutrals.some((n) => n.id === foe.id) ? 'объявит войну этому народу' : 'невозможна, сначала объявите войну'}.</div>`}
        <div class="k-row"><button class="k-btn k-cb-go" data-cb="1" ${p.atWar || s.neutrals.some((n) => n.id === p.defenderOwner) ? '' : 'disabled'}>Атаковать</button><button class="k-btn" data-cb="0">Отмена</button></div>`;
      el.style.display = 'block';
      return new Promise((resolve) => {
        const onClick = (e) => {
          const b = e.target.closest('[data-cb]');
          if (!b) return;
          el.removeEventListener('click', onClick);
          el.style.display = 'none';
          resolve(b.dataset.cb === '1');
        };
        el.addEventListener('click', onClick);
      });
    },
    /** Тревога на весь экран при ядерном ударе. */
    alarm(text, intercepted) {
      const el = document.createElement('div');
      el.className = `k-alarm ${intercepted ? 'blue' : ''}`;
      el.innerHTML = `<div><b>${intercepted ? 'РАКЕТА ПЕРЕХВАЧЕНА' : 'ЯДЕРНЫЙ УДАР'}</b><span>${esc(String(text ?? '').replace(/^(ЯДЕРНЫЙ УДАР|Ракета перехвачена)\.\s*/, ''))}</span></div>`;
      root.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    },
    setStatus(status) {
      netStatus = status;
      const overlay = $('.k-reconnect');
      overlay.style.display = status === 'offline' || status === 'reconnecting' ? 'flex' : 'none';
    },
    render(s, sel, log) {
      lastSnap = s;
      const me = s.nations.find((n) => n.id === s.nationId);
      top(s, me); left(s, me, sel); right(s, me); chronicle(s, log); finale(s); gameOver(s); offers(s); live(null);
      $('.k-end').disabled = turnBusy || s.status !== 'running';
    },
    busy(on) { turnBusy = on; $('.k-end').disabled = on || lastSnap?.status !== 'running'; },
    toast(text) {
      const el = $('.k-toast'); el.textContent = text; el.style.opacity = 1;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.opacity = 0; }, 2600);
    },
    reset() { $('.k-gameover').style.display = 'none'; },
    /** Экран выбора нации перед партией. */
    chooseNation() {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'k-start';
        wrap.innerHTML = `<div class="glass"><h1>КУПОЛ</h1><p>Настоящая Земля, вымышленная политика. Через двести ходов к планете придёт астероид.</p>
          <label class="k-difficulty">Сложность: <select data-difficulty><option value="easy">Лёгкая</option><option value="normal" selected>Обычная</option><option value="hard">Сложная</option></select></label><div class="k-nations">${NATIONS.map((n) => `<button data-id="${n.id}">${img(portrait(n.id), n.color, n.name[0])}<div><div class="k-nm" style="color:${esc(n.color)}">${esc(n.name)}</div><div class="k-ld">${esc(LEADERS[n.id]?.name ?? '')}</div></div></button>`).join('')}</div></div>`;
        wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) { wrap.remove(); resolve({ player: b.dataset.id, difficulty: wrap.querySelector('[data-difficulty]')?.value ?? 'normal' }); } });
        root.appendChild(wrap);
      });
    },
  };
}
