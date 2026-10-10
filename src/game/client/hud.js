// Интерфейс партии: только отображение снимка и сбор намерений игрока.
// Все проверки делает сервер; HUD показывает варианты из snapshot.choices.
import { TECHS, ERAS } from '../data/techs.js';
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { NATIONS } from '../data/nations.js';
import { LEADERS } from '../data/leaders.js';
import { TREATY_NAMES } from '../i18n/ru.js';

const MOOD = { hostile: ['враждебность', '#ff6b5e'], cold: ['холодность', '#8fb3ff'], neutral: ['сдержанность', '#c6ccd6'], warm: ['дружелюбие', '#8fe0a6'], friend: ['близкий союзник', '#5ee0b0'] };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alpha = (hex, a) => { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
const itemName = (it) => (it.kind === 'unit' ? UNITS[it.id]?.name : it.kind === 'building' ? BUILDINGS[it.id]?.name : it.kind === 'dome' ? 'Вклад в щит «Купола»' : it.id);
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
    <div class="k-hint glass">ЛКМ — выбрать · ПКМ — идти/атаковать · двойной щелчок — приблизить · F — основать город · Enter — конец хода</div>`;
  const $ = (s) => root.querySelector(s);
  let toastTimer = null;
  let netStatus = 'connecting';

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
        ${sel.unitId && sel.units.find((u) => u.id === sel.unitId)?.owner === me.id ? `<div class="k-row">${sel.units.find((u) => u.id === sel.unitId).type === 'settler' ? `<button class="k-btn" data-act="found" data-unit="${sel.unitId}">Основать город (F)</button>` : `<button class="k-btn" data-act="fortify" data-unit="${sel.unitId}">Укрепиться</button>`}<button class="k-btn" data-act="disband" data-unit="${sel.unitId}">Распустить</button></div>` : ''}</div>`;
    }
    $('.k-left').innerHTML = html;
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
      <div class="k-bar"><i style="width:${Math.min(100, (fz.shield / 47000) * 100)}%"></i></div>
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

  return {
    setStatus(status) { netStatus = status; },
    render(s, sel, log) {
      const me = s.nations.find((n) => n.id === s.nationId);
      top(s, me); left(s, me, sel); right(s, me); chronicle(s, log); finale(s); offers(s);
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
