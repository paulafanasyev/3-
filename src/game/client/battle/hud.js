// Интерфейс тактического боя: карточки полков внизу (как в Shogun: Total War), полоса сил,
// время, скорость, пауза, строй, автобой, отступление, миникарта и подсказки.
// Мышь: ЛКМ — выбрать полк, рамка ЛКМ — несколько, Shift — добавить; ПКМ по земле — идти,
// двойной ПКМ — бегом, ПКМ по врагу — атаковать (Alt — сразу в рукопашную).
// Клавиши: Пробел — пауза, H — стоять, F — сменить строй, Ctrl+A — все, Esc — снять выбор,
// Home — к армии, +/− — скорость, WASD/стрелки/край экрана — камера, Q/E — поворот.
// Приказ виден сразу (маркер и линия), не дожидаясь ответа сервера. Кадры боя сервер шлёт сам
// каждые 100 мс (session.js), пауза и скорость уходят командой game:battleSpeed.
import './battle.css';
import { createBattleView } from './view.js';

const NAMES = { warrior: 'Копейщики', archer: 'Лучники', swordsman: 'Самураи', militia: 'Ополчение', infantry: 'Стрелки', artillery: 'Батарея', tank: 'Танки', helicopter: 'Вертолёты', drone: 'Беспилотники', fighter: 'Истребители', biplane: 'Бипланы' };
const FORM = [['line', 'Линия'], ['deep', 'Колонна'], ['loose', 'Рассыпной']];
const SPEEDS = [1, 2, 4];
/** Причины отказа приказа (сервер присылает код). */
const REJECT = { ROUTING: 'Полк бежит и не слушает приказов', NO_TARGET: 'Цель уже недоступна', NOT_YOUR_UNIT: 'Этот полк больше не может получать приказы', NO_BATTLE: 'Бой уже закончился', BAD_COMMAND: 'Такой приказ невозможен' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// статус дублируется значком (не только цветом): ⚑ бегут, ✕ погибли, ⧗ приказ, ⚔ бой, ➤ марш, » бегом, ✹ огонь, ⚠ нет боезапаса
const status = (r) => (r.state === 'rout' ? ['⚑ БЕГУТ', 'rout'] : r.state === 'dead' ? ['✕ ПОГИБЛИ', 'dead'] : r.state === 'fled' ? ['✕ УШЛИ', 'dead']
  : r.pending ? ['⧗ ПРИКАЗ', 'move'] : r.engaged ? ['⚔ В БОЮ', 'fight'] : r.order === 'move' ? [r.run ? '» БЕГОМ' : '➤ МАРШ', 'move'] : r.ammo > 0 && r.aim ? ['✹ ОГОНЬ', 'fire'] : r.ammo === 0 && r.menMax > 10 && ['archer', 'infantry'].includes(r.type) ? ['⚠ НЕТ БОЕЗАПАСА', 'warn'] : ['', '']);

/** Звуковые сигналы без файлов: синтез WebAudio (приказ принят, отказ, начало рукопашной, разгром). */
let audio = null; let muted = false; const lastBeep = {};
function beep(kind) {
  try {
    if (muted) return;
    const nowMs = performance.now();
    if (nowMs - (lastBeep[kind] ?? 0) < 400) return; // один сигнал каждого вида раз в 0,4 с: массовая свалка не превращается в какофонию
    lastBeep[kind] = nowMs;
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime; const o = audio.createOscillator(); const g = audio.createGain();
    const spec = { order: [660, 0.06, 'triangle'], reject: [140, 0.25, 'sawtooth'], clash: [220, 0.18, 'square'], rout: [330, 0.4, 'sine'], empty: [180, 0.3, 'triangle'] }[kind] ?? [440, 0.1, 'sine'];
    o.type = spec[2]; o.frequency.setValueAtTime(spec[0], t); if (kind === 'rout') o.frequency.exponentialRampToValueAtTime(110, t + spec[1]);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + spec[1]);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + spec[1] + 0.02);
  } catch { /* звук недоступен — не мешаем игре */ }
}

/**
 * Открывает бой поверх карты. net.command(cmd) → Promise<result>; colorOf(owner) → цвет нации.
 * Возвращает объект с finished: Promise с итогом (combat из сервера), когда бой закрыт.
 */
export function openBattle({ net, first, colorOf, iconOf = () => '', autoplay = true }) {
  const root = document.createElement('div');
  root.className = 'kb-root';
  root.innerHTML = `<div class="kb-scene"></div>
    <div class="kb-top"><div class="kb-side a"></div><div class="kb-mid"><div class="kb-time"></div><div class="kb-bar"><i></i><b></b></div></div><div class="kb-side d"></div></div>
    <canvas class="kb-mini" width="220" height="165" title="Миникарта: щелчок — перенести камеру"></canvas>
    <div class="kb-labels"></div><div class="kb-box"></div><div class="kb-toast"></div><div class="kb-queue"></div>
    <div class="kb-help">ЛКМ / рамка — выбрать · ПКМ — идти · двойной ПКМ — бегом · ПКМ по врагу — атака · Alt — рукопашная · Пробел — пауза · H — стоять · F — строй</div>
    <div class="kb-bottom"><div class="kb-cards"></div>
      <div class="kb-tools">
        <div class="kb-row kb-form">${FORM.map(([k, n]) => `<button data-form="${k}" title="Строй: ${n}">${n}</button>`).join('')}<button data-hold="1" title="Стоять на месте (H)">Стоять</button></div>
        <div class="kb-row"><button data-pause="1" title="Пауза (Пробел)">❚❚</button>${SPEEDS.map((v) => `<button data-speed="${v}" class="${v === 1 ? 'on' : ''}" title="Скорость ×${v} (+/−)">×${v}</button>`).join('')}</div>
        <div class="kb-row"><button data-auto="1" title="Досчитать бой без управления">Автобой</button><button data-retreat="1" class="warn" title="Бой проигран, уцелевшие уходят">Отступить</button><button data-mute="1" title="Звук вкл/выкл (M)">🔊</button></div>
      </div></div>
    <div class="kb-result"></div>`;
  document.body.appendChild(root);
  const view = createBattleView(root.querySelector('.kb-scene'), { colorOf });
  let battle = first; let selected = []; let speed = 1; let paused = false; let busy = false; let done = null;
  const me = () => battle.human ?? 'a';
  const mine = () => battle.regiments.filter((r) => r.side === me() && r.state !== 'dead' && r.state !== 'fled');

  // ---------- верхняя полоса и карточки: узлы создаются один раз ----------
  const cards = new Map(); const labels = new Map();
  function render() {
    const b = battle;
    const total = (side) => b.regiments.filter((r) => r.side === side && r.state !== 'dead' && r.state !== 'fled').reduce((s, r) => s + r.men * (r.menMax <= 4 ? 12 : 1), 0);
    const ta = total('a'); const td = total('d');
    root.querySelector('.kb-side.a').innerHTML = `<b style="color:${colorOf(b.attacker.owner)}">${esc(b.attacker.name)}</b><small>наступление</small>`;
    root.querySelector('.kb-side.d').innerHTML = `<b style="color:${colorOf(b.defender.owner)}">${esc(b.defender.name)}</b><small>${b.city ? 'оборона города' : 'оборона'}</small>`;
    root.querySelector('.kb-time').textContent = `${mmss(b.seconds)} / ${mmss(b.timeLimit)}${paused ? ' · ПАУЗА' : ''}`;
    const share = ta / Math.max(1, ta + td) * 100;
    root.querySelector('.kb-bar i').style.cssText = `width:${share}%;background:${colorOf(b.attacker.owner)}`;
    root.querySelector('.kb-bar b').style.cssText = `width:${100 - share}%;background:${colorOf(b.defender.owner)}`;
    const box = root.querySelector('.kb-cards');
    for (const r of b.regiments.filter((x) => x.side === me())) {
      let c = cards.get(r.id);
      if (!c) {
        c = document.createElement('div'); c.className = 'kb-card'; c.dataset.reg = r.id; c.style.setProperty('--c', colorOf(r.owner));
        c.innerHTML = `<div class="kb-ico">${iconOf(r.type, colorOf(r.owner))}</div><div class="kb-nm">${esc(NAMES[r.type] ?? r.type)}</div><div class="kb-men"></div><div class="kb-mor"><i></i></div><div class="kb-st"></div>`;
        box.appendChild(c); cards.set(r.id, c);
      }
      const [st, cls] = status(r);
      c.className = `kb-card ${selected.includes(r.id) ? 'sel' : ''} ${r.state} ${cls}`;
      c.querySelector('.kb-men').innerHTML = `${r.men}<small>/${r.menStart}</small>`;
      c.querySelector('.kb-mor i').style.width = `${Math.max(0, Math.min(100, r.morale))}%`;
      c.querySelector('.kb-st').textContent = st;
      c.title = `${NAMES[r.type] ?? r.type}: ${r.men} из ${r.menStart}, дух ${r.morale}, усталость ${r.fatigue}${r.ammo ? `, боезапас ${r.ammo}` : ''}`;
    }
  }
  function drawLabels() {
    const box = root.querySelector('.kb-labels');
    for (const r of battle.regiments) {
      let el = labels.get(r.id);
      if (!el) {
        el = document.createElement('div'); el.className = `kb-lab ${r.side === me() ? 'own' : 'foe'}`; el.style.setProperty('--c', colorOf(r.owner));
        el.innerHTML = `<span><em class="t">${esc(NAMES[r.type] ?? r.type)}</em> <b></b></span><i></i><u></u>`;
        box.appendChild(el); labels.set(r.id, el);
      }
      const p = view.screenOf(r);
      const show = p.visible && r.state !== 'dead' && r.state !== 'fled';
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      const scale = Math.max(0.7, Math.min(1.15, 260 / Math.max(60, p.dist)));
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      el.classList.toggle('sel', selected.includes(r.id));
      el.classList.toggle('rout', r.state === 'rout');
      el.classList.toggle('far', p.dist > 170 && !selected.includes(r.id)); // тип полка — только вблизи или у выбранного
      el.querySelector('b').textContent = r.men;
      el.querySelector('i').style.width = `${Math.max(0, Math.min(100, r.morale)) * 0.4}px`;
      el.querySelector('u').textContent = r.state === 'rout' ? 'бегут' : r.engaged ? 'бой' : '';
    }
  }

  // ---------- миникарта ----------
  const mini = root.querySelector('.kb-mini'); const mg = mini.getContext('2d');
  function drawMini() {
    const f = battle.field; const t = view.terrain; const W = mini.width; const H = mini.height;
    const sx = W / f.w; const sy = H / f.h;
    mg.fillStyle = '#3f5226'; mg.fillRect(0, 0, W, H);
    if (t) {
      mg.fillStyle = '#26361a';
      for (const w of t.woods) { mg.beginPath(); mg.ellipse((w.x + f.w / 2) * sx, (f.h / 2 - w.y) * sy, w.r * sx, w.r * sy, 0, 0, Math.PI * 2); mg.fill(); }
    }
    if (battle.city) { mg.strokeStyle = '#cbbd9e'; mg.beginPath(); mg.arc((battle.city.x + f.w / 2) * sx, (f.h / 2 - battle.city.y) * sy, battle.city.r * sx, 0, Math.PI * 2); mg.stroke(); }
    for (const r of battle.regiments) {
      if (r.state === 'dead' || r.state === 'fled') continue;
      const x = (r.x + f.w / 2) * sx; const y = (f.h / 2 - r.y) * sy;
      mg.save(); mg.translate(x, y); mg.rotate(-r.facing + Math.PI / 2);
      mg.fillStyle = r.state === 'rout' ? '#ddd' : colorOf(r.owner);
      mg.fillRect(-Math.max(3, r.w * sx) / 2, -2, Math.max(3, r.w * sx), 4);
      if (selected.includes(r.id)) { mg.strokeStyle = '#ffe8a0'; mg.lineWidth = 1.5; mg.strokeRect(-Math.max(3, r.w * sx) / 2 - 2, -4, Math.max(3, r.w * sx) + 4, 8); }
      mg.restore();
    }
    // рамка обзора: реальный размер видимой земли и поворот камеры
    const c = view.camera.target; const vs = view.viewSize();
    mg.save(); mg.translate((c.x + f.w / 2) * sx, (c.z + f.h / 2) * sy); mg.rotate(-vs.yaw);
    mg.strokeStyle = '#fffc'; mg.lineWidth = 1; mg.strokeRect(-vs.w * sx / 2, -vs.h * sy / 2, vs.w * sx, vs.h * sy);
    mg.restore();
  }
  mini.addEventListener('mousedown', (e) => {
    const rect = mini.getBoundingClientRect(); const f = battle.field;
    view.camera.target.x = ((e.clientX - rect.left) / rect.width - 0.5) * f.w;
    view.camera.target.z = ((e.clientY - rect.top) / rect.height - 0.5) * f.h;
    e.stopPropagation();
  });

  // ---------- сеть: старые ответы не откатывают кадр ----------
  function apply(b, force = false) {
    if (!b || (!force && battle && b.tick < battle.tick)) return;
    if (!b.terrain) b.terrain = battle.terrain;
    // звуковые события по своим полкам: вступили в рукопашную, побежали, кончился боезапас
    for (const r of b.regiments) {
      const old = battle.regiments.find((x) => x.id === r.id);
      if (!old || r.side !== me()) continue;
      if (r.engaged && !old.engaged) beep('clash');
      else if (r.state === 'rout' && old.state !== 'rout') beep('rout');
      else if (r.ammo === 0 && old.ammo > 0) beep('empty');
    }
    battle = b; view.update(battle); render();
  }
  // команды идут строго по очереди: ответы не обгоняют друг друга и не откатывают приказ
  let chain = Promise.resolve();
  const send = (cmd) => {
    const run = async () => {
      let r;
      try { r = await net.command(cmd); } catch { r = { ok: false, message: 'Нет связи с сервером' }; }
      if (r?.battle) apply(r.battle, cmd.kind === 'battleOrder');
      if (r?.finished) finish(r);
      return r;
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  };
  let pending = 0;
  const showQueue = () => { const el = root.querySelector('.kb-queue'); el.textContent = pending ? `приказов в пути: ${pending}` : ''; el.classList.toggle('on', pending > 0); };
  let toastT = 0;
  function toast(text) {
    const el = root.querySelector('.kb-toast'); el.textContent = text; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200);
  }
  function order(orders) {
    // оптимистично: сразу показываем приказ на карте и в карточках
    for (const o of orders) {
      const r = battle.regiments.find((x) => x.id === o.regiment);
      if (!r) continue;
      if (o.kind === 'move') { r.order = 'move'; r.dest = [o.x, o.y]; r.run = o.run; view.showOrder(o.x, o.y, o.run ? 'run' : 'move'); }
      if (o.kind === 'attack') { r.order = 'attack'; r.dest = null; r.target = o.target; const t = battle.regiments.find((x) => x.id === o.target); if (t) view.showOrder(t.x, t.y, 'attack'); }
      if (o.kind === 'hold') { r.order = 'hold'; r.dest = null; }
      if (o.kind === 'formation') r.formation = o.formation;
    }
    for (const o of orders) { const r = battle.regiments.find((x) => x.id === o.regiment); if (r) r.pending = true; }
    pending += 1; showQueue(); beep('order');
    view.update(battle); render();
    return send({ kind: 'battleOrder', orders }).then((r) => {
      pending -= 1; showQueue();
      if (r?.ok) return r;
      // сервер отклонил: красный маркер, причина и честное состояние с сервера
      const first = orders[0]; const reg = battle.regiments.find((x) => x.id === first?.regiment);
      if (reg) view.showOrder(reg.x, reg.y, 'reject');
      beep('reject');
      toast(REJECT[r?.error] ?? r?.message ?? 'Приказ не принят');
      return send({ kind: 'battleOrder', orders: [] });
    });
  }

  function finish(r) {
    if (done) return;
    stopLoop();
    const c = r.combat ?? {}; const won = c.won;
    const el = root.querySelector('.kb-result');
    el.innerHTML = `<div class="kb-res ${won ? 'win' : 'loss'}"><h2>${won ? (c.captured ? 'Город взят' : 'Победа') : 'Поражение'}</h2>
      <p>Бой длился ${mmss(c.seconds ?? battle.seconds)}. Потери: ваши ${c.lossesA ?? 0}, противника ${c.lossesD ?? 0}.</p>
      <button data-close="1">К карте</button></div>`;
    el.style.display = 'flex';
    done = c;
  }

  // режим «сервер сам шлёт кадры»: если сеть умеет подписку, опроса нет вообще
  const push = typeof net.onBattle === 'function';
  const unsubscribe = push ? net.onBattle((m) => { if (m.battle) apply(m.battle); if (m.finished) finish(m); }) : null;
  const serverSpeed = () => { if (push) net.battleSpeed(paused ? 0 : speed).catch(() => {}); };
  let timer = 0;
  function startLoop() {
    if (push) return;
    stopLoop();
    timer = setInterval(async () => {
      if (paused || busy || done) return;
      busy = true;
      try { await send({ kind: 'battleAdvance', ticks: speed }); } finally { busy = false; }
    }, 200);
  }
  function stopLoop() { clearInterval(timer); timer = 0; }
  const setPaused = (v) => { paused = v; root.querySelector('[data-pause]').classList.toggle('on', paused); serverSpeed(); render(); };
  const setSpeed = (v) => { speed = v; root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === v)); setPaused(false); };
  const select = (ids) => { selected = ids; view.select(ids); view.showRange(ids); render(); };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button,[data-reg]');
    if (!t) return;
    if (t.dataset.reg) {
      const id = t.dataset.reg;
      if (e.detail === 2) { const r = battle.regiments.find((x) => x.id === id); if (r) view.focus(r.x, r.y); }
      select(e.shiftKey ? [...new Set([...selected, id])] : [id]);
    }
    if (t.dataset.form && selected.length) order(selected.map((id) => ({ regiment: id, kind: 'formation', formation: t.dataset.form })));
    if (t.dataset.hold && selected.length) order(selected.map((id) => ({ regiment: id, kind: 'hold' })));
    if (t.dataset.mute) { muted = !muted; t.textContent = muted ? '🔇' : '🔊'; }
    if (t.dataset.pause) setPaused(!paused);
    if (t.dataset.speed) setSpeed(Number(t.dataset.speed));
    if (t.dataset.auto) send({ kind: 'battleAdvance', auto: true });
    if (t.dataset.retreat && confirm('Отступить? Бой будет проигран, но уцелевшие полки уйдут.')) send({ kind: 'battleRetreat' });
    if (t.dataset.close) close();
  });

  // выбор: щелчок или рамка
  const canvas = view.renderer.domElement; const boxEl = root.querySelector('.kb-box');
  let press = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) press = { x: e.clientX, y: e.clientY, shift: e.shiftKey }; });
  window.addEventListener('pointermove', onPress);
  window.addEventListener('pointerup', onRelease);
  function onPress(e) {
    if (!press) return;
    const w = e.clientX - press.x; const h = e.clientY - press.y;
    if (Math.abs(w) + Math.abs(h) < 6) return;
    boxEl.style.cssText = `display:block;left:${Math.min(press.x, e.clientX)}px;top:${Math.min(press.y, e.clientY)}px;width:${Math.abs(w)}px;height:${Math.abs(h)}px`;
  }
  function onRelease(e) {
    if (!press || e.button !== 0) return;
    const p0 = press; press = null;
    const dragged = Math.abs(e.clientX - p0.x) + Math.abs(e.clientY - p0.y) >= 6;
    boxEl.style.display = 'none';
    if (dragged) {
      const x0 = Math.min(p0.x, e.clientX); const x1 = Math.max(p0.x, e.clientX); const y0 = Math.min(p0.y, e.clientY); const y1 = Math.max(p0.y, e.clientY);
      const hit = mine().filter((r) => { const s = view.screenOf(r); return s.visible && s.x >= x0 && s.x <= x1 && s.y + 30 >= y0 && s.y <= y1 + 30; }).map((r) => r.id);
      select(p0.shift ? [...new Set([...selected, ...hit])] : hit);
      return;
    }
    if (e.target !== canvas) return;
    const p = view.pickField(e.clientX, e.clientY); if (!p) return;
    const r = view.regimentAt(p, me());
    select(r ? (p0.shift ? [...new Set([...selected, r.id])] : [r.id]) : p0.shift ? selected : []);
  }
  let lastRight = 0;
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selected.length) return;
    const p = view.pickField(e.clientX, e.clientY); if (!p) return;
    const run = performance.now() - lastRight < 350; lastRight = performance.now();
    const foe = view.regimentAt(p, me() === 'a' ? 'd' : 'a');
    if (foe) order(selected.map((id) => ({ regiment: id, kind: 'attack', target: foe.id, run, melee: e.altKey })));
    else {
      // несколько полков встают в линию вокруг точки, сохраняя порядок слева направо
      const sel = battle.regiments.filter((r) => selected.includes(r.id)).sort((a, b) => a.x - b.x);
      const gap = 6 + Math.max(0, ...sel.map((r) => r.w));
      order(sel.map((r, i) => ({ regiment: r.id, kind: 'move', x: p.x + (i - (sel.length - 1) / 2) * gap, y: p.y, run })));
    }
  });
  const onKey = (e) => {
    if (e.target.closest?.('input,textarea') || done) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setPaused(!paused); }
    else if ((k === 'h' || k === 'р') && selected.length) order(selected.map((id) => ({ regiment: id, kind: 'hold' })));
    else if ((k === 'f' || k === 'а') && selected.length) {
      const cur = battle.regiments.find((r) => r.id === selected[0])?.formation ?? 'line';
      const next = FORM[(FORM.findIndex(([f]) => f === cur) + 1) % FORM.length][0];
      order(selected.map((id) => ({ regiment: id, kind: 'formation', formation: next })));
    } else if ((k === 'a' || k === 'ф') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(mine().map((r) => r.id)); }
    else if (k === 'escape') select([]);
    else if (k === 'm' || k === 'ь') { muted = !muted; root.querySelector('[data-mute]').textContent = muted ? '🔇' : '🔊'; }
    else if (k === 'home') { const m = mine(); if (m.length) view.focus(m.reduce((s, r) => s + r.x, 0) / m.length, m.reduce((s, r) => s + r.y, 0) / m.length); }
    else if (k === '+' || k === '=') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
    else if (k === '-') setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
  };
  window.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', () => { if (audio?.state === 'suspended') audio.resume(); }, { once: true });

  let raf = 0; let miniT = 0;
  const tick = (t) => { drawLabels(); if (t - miniT > 100) { drawMini(); miniT = t; } raf = requestAnimationFrame(tick); };
  view.update(battle); render(); view.start(); raf = requestAnimationFrame(tick);
  if (autoplay) startLoop();
  let resolveDone;
  const finished = new Promise((res) => { resolveDone = res; });
  function close() {
    stopLoop(); unsubscribe?.(); cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onPress); window.removeEventListener('pointerup', onRelease);
    view.dispose(); root.remove(); resolveDone(done);
  }
  return {
    finished, view, root, select, finish, pause: setPaused,
    setBattle(b) { apply(b); drawLabels(); drawMini(); },
    labels: () => { drawLabels(); drawMini(); },
  };
}
