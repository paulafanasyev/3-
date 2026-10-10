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
    <button class="k-end">Конец хода<small>Enter</small></button>
    <div class="k-toast glass" style="opacity:0"></div>
    <div class="k-offer glass" style="display:none"></div>
    <div class="k-live glass"></div>
    <div class="k-combat glass" style="display:none"></div>
    <div class="k-hint glass">ЛКМ — выбрать · ПКМ — идти/атаковать (у ракеты — пуск, у спутника — съёмка) · двойной щелчок — приблизить · F — основать город · Enter — конец хода</div>`;
  const $ = (s) => root.querySelector(s);
  let toastTimer = null;
  let netStatus = 'connecting';
  let lastSnap = null;
  let liveState = null;

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset;
    actions[d.act]?.(d);
  });
  $('.k-end').addEventListener('click', () => actions.endTurn());

  function top(s, me) {
    const fz = s.finale;
    const left = fz?.impactTurn ? fz.impactTurn - s.turn : null;
    $('.k-top').innerHTML = `<div class="k-logo">КУПОЛ</div><div class="k-sep"></div>
      <div class="k-turn"><b>Ход ${s.turn}</b><br>${esc(ERAS[me.era]?.name)}</div>
      <div class="k-status ${netStatus === 'online' ? '' : 'off'}">${netStatus === 'online' ? 'сервер на связи' : netStatus === 'offline' ? 'нет связи с сервером' : 'подключение…'}</div>
      <div class="k-chips">
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
      <div><div class="k-nm" style="color:${me.color}">${esc(me.name)}</div><div class="k-ld">${esc(me.leader?.name ?? leader?.name ?? '')}<br>${esc(me.leader?.title ?? '')}</div></div></div>
      <div class="k-row"><div class="k-chip"><i>эпоха</i><b>${esc(ERAS[me.era]?.name)}</b></div><div class="k-chip"><i>финал</i><b>${me.finale?.path === 'pact' ? '«Купол»' : me.finale?.path === 'ark' ? 'Ковчег' : '—'}</b></div></div></div>`;
    html += `<div class="glass k-card"><h4 class="k-h4">Исследование${research ? `: ${esc(research)}` : ''}</h4><div class="k-list">${
      s.choices.techs.map((t) => `<button class="k-btn ${me.research === t ? 'on' : ''}" data-act="research" data-tech="${t}">${esc(TECHS[t].name)}<small>${esc(ERAS[TECHS[t].era].name)}</small></button>`).join('') || '<small class="k-ld">Все доступные технологии изучены</small>'
    }</div></div>`;
    if (sel?.city) {
      const c = sel.city;
      const items = s.choices.production[c.id] ?? [];
      const current = c.queue?.[0];
      html += `<div class="glass k-card"><h4 class="k-h4">Город «${esc(c.name)}» · население ${c.pop}</h4>
        <div class="k-ld">Строится: ${current ? esc(itemName(current)) : 'ничего'} · постройки: ${c.buildings.length ? c.buildings.map((b) => esc(BUILDINGS[b]?.name)).join(', ') : 'нет'}</div>
        <div class="k-list" style="margin-top:8px">${items.map((it) => `<button class="k-btn ${current && current.kind === it.kind && current.id === it.id ? 'on' : ''}" data-act="produce" data-city="${c.id}" data-kind="${it.kind}" data-id="${it.id ?? ''}">${esc(itemName(it))}<small>${it.cost ?? '∞'}</small></button>`).join('')}</div>
        ${current && current.kind !== 'dome' ? `<div class="k-row"><button class="k-btn" data-act="buy" data-city="${c.id}">Купить за золото</button><button class="k-btn" data-act="fly" data-cell="${c.cell}">Приблизить</button></div>` : ''}</div>`;
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
    const others = s.nations.filter((n) => n.id !== me.id);
    const treaty = (id, type) => s.treaties.some((t) => t.type === type && (t.a === id || t.b === id));
    const war = (id) => s.wars.some((k) => k.split('|').includes(id));
    $('.k-right').innerHTML = others.map((n) => {
      const [mood, mc] = MOOD[n.moodId] ?? MOOD.neutral;
      const leader = n.leader;
      if (!n.met) {
        return `<div class="glass k-lc">${img('', '#3a4658', '?')}<div><div class="k-nm" style="color:${n.color}">${esc(n.name)}</div><div class="k-ld">Ещё не встречались</div></div></div>`;
      }
      const acts = war(n.id)
        ? `<button data-act="peace" data-target="${n.id}">Предложить мир</button>`
        : ['trade', 'nap', 'research', 'alliance'].filter((t) => !treaty(n.id, t)).map((t) => `<button data-act="propose" data-target="${n.id}" data-treaty="${t}">${esc(TREATY_NAMES[t])}</button>`).join('')
          + `<button class="war" data-act="war" data-target="${n.id}">Объявить войну</button>`;
      return `<div class="glass k-lc">${img(portrait(n.id, n.moodId), n.color, n.name[0])}<div style="flex:1">
        <div class="k-nm" style="color:${n.color}">${esc(n.name)}</div><div class="k-ld">${esc(leader?.name ?? '')} · ${esc(ERAS[n.era]?.name ?? '')}</div>
        <span class="k-mood" style="background:${alpha(mc, 0.16)};color:${mc}">${mood}${war(n.id) ? ' · война' : ''}</span>
        <div class="k-acts">${acts}</div></div></div>`;
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
          <div class="k-cb-side"><img src="${unitPortrait(p.attacker, me.color, 96)}" alt=""><div class="k-nm" style="color:${me.color}">${esc(UNITS[p.attacker]?.name)}</div><div class="k-cb-str">${p.attack}</div><div class="k-cb-mods">${mods('a')}</div></div>
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
    setStatus(status) { netStatus = status; },
    render(s, sel, log) {
      lastSnap = s;
      const me = s.nations.find((n) => n.id === s.nationId);
      top(s, me); left(s, me, sel); right(s, me); chronicle(s, log); finale(s); offers(s); live(null);
      $('.k-end').disabled = s.status !== 'running';
    },
    busy(on) { $('.k-end').disabled = on; },
    toast(text) {
      const el = $('.k-toast'); el.textContent = text; el.style.opacity = 1;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.opacity = 0; }, 2600);
    },
    /** Экран выбора нации перед партией. */
    chooseNation() {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'k-start';
        wrap.innerHTML = `<div class="glass"><h1>КУПОЛ</h1><p>Настоящая Земля, вымышленная политика. Через двести ходов к планете придёт астероид.</p>
          <div class="k-nations">${NATIONS.map((n) => `<button data-id="${n.id}">${img(portrait(n.id), n.color, n.name[0])}<div><div class="k-nm" style="color:${n.color}">${esc(n.name)}</div><div class="k-ld">${esc(LEADERS[n.id]?.name ?? '')}</div></div></button>`).join('')}</div></div>`;
        wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) { wrap.remove(); resolve(b.dataset.id); } });
        root.appendChild(wrap);
      });
    },
  };
}
