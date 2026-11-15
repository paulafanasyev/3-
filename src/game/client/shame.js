// Позорный экран за попытку ядерного удара по России: герб на весь экран,
// гимн и блокировка ядерных сил до перезапуска страницы.
//
// Экран намеренно НЕ сообщает, что куда-то что-то передано. Игра про игрока
// не знает ничего: сервер партии не ведёт журнала адресов, а браузер физически
// не может прочитать MAC-адрес устройства. Писать обратное значило бы врать
// о работе с чужими данными прямо в собранном продукте.
import { SHAME } from '../i18n/ru.js';

export const EMBLEM_SRC = '/game/state/emblem-russia.svg';
export const ANTHEM_SRC = '/audio/state/anthem-russia-instrumental.ogg';
export const SHAME_EVENT = 'kupol:shame';

let shamed = false;
let overlay = null;
let anthem = null;
let muted = false;

const CSS = `
  .k-shame{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;
    background:radial-gradient(ellipse at 50% 34%,rgba(74,10,10,.96),rgba(6,4,4,.98) 62%,#020202 100%);
    color:#f2e9d6;font:14px/1.6 Georgia,"Times New Roman",serif;pointer-events:auto}
  .k-shame-frame{width:min(760px,94vw);max-height:92vh;overflow:auto;padding:26px 30px 20px;text-align:center;
    border:2px solid #b08a3c;outline:1px solid rgba(176,138,60,.45);outline-offset:6px;
    background:linear-gradient(180deg,rgba(16,14,20,.96),rgba(9,8,12,.98));box-shadow:0 30px 90px rgba(0,0,0,.7)}
  .k-shame-emblem{display:block;margin:0 auto 10px;height:clamp(210px,44vh,480px);width:auto;
    filter:drop-shadow(0 6px 26px rgba(226,180,86,.34))}
  .k-shame-title{margin:6px 0 4px;color:#eac37c;font-size:clamp(22px,4.6vh,42px);letter-spacing:.14em;text-transform:uppercase}
  .k-shame-rule{height:1px;margin:10px auto;width:60%;background:linear-gradient(90deg,transparent,#b08a3c,transparent)}
  .k-shame-body{margin:8px auto;max-width:62ch}
  .k-shame-target{margin:2px 0 10px;color:#c9b78d;font-size:13px}
  .k-shame-lock{margin:10px auto;padding:9px 12px;max-width:58ch;border:1px solid rgba(198,86,68,.7);
    background:rgba(78,20,16,.5);color:#f0b6a6;font-size:13px}
  .k-shame-actions{display:flex;gap:10px;justify-content:center;margin:14px 0 6px}
  .k-shame-actions button{padding:9px 14px;border:1px solid #7d6529;border-radius:8px;background:#1a1712;
    color:#f2e9d6;font:600 12px "Noto Sans",sans-serif;cursor:pointer}
  .k-shame-actions button.primary{background:linear-gradient(180deg,#e8c37c,#a97f2c);color:#20160a;border-color:#e8c37c}
  .k-shame-fine{margin:8px 0 0;color:#8d8271;font-size:10px;line-height:1.5}
`;

/** Только флаг: партии и полигону довольно знать, что позор уже случился. */
export const isShamed = () => shamed;

function play() {
  anthem ??= new Audio(ANTHEM_SRC);
  anthem.volume = 0.9;
  // Намерение важнее флага paused: пока дорожка только начала грузиться,
  // anthem.paused ещё true, и клик «выключить» по ошибке запускал гимн заново.
  if (muted) return Promise.resolve(false);
  return anthem.play().then(() => !muted).catch(() => false);
}

function build(target) {
  const layer = document.createElement('div');
  layer.className = 'k-shame';
  layer.setAttribute('role', 'alertdialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'k-shame-title');
  layer.innerHTML = `
    <div class="k-shame-frame">
      <img class="k-shame-emblem" src="${EMBLEM_SRC}" alt="Герб Российской Федерации">
      <h2 class="k-shame-title" id="k-shame-title">${SHAME.title}</h2>
      <div class="k-shame-rule"></div>
      <p class="k-shame-body">${SHAME.body}</p>
      <p class="k-shame-target" data-target></p>
      <p class="k-shame-lock">${SHAME.lock}</p>
      <div class="k-shame-actions">
        <button type="button" data-sound>${SHAME.mute}</button>
        <button type="button" class="primary" data-reload>${SHAME.reload}</button>
      </div>
      <p class="k-shame-fine">${SHAME.fine}</p>
    </div>
  `;
  layer.querySelector('[data-target]').textContent = target ? `${SHAME.targetLabel} ${target}` : SHAME.targetUnknown;
  const sound = layer.querySelector('[data-sound]');
  sound.addEventListener('click', () => {
    muted = !muted;
    if (muted) {
      anthem?.pause();
      sound.textContent = SHAME.unmute;
      return;
    }
    play().then((ok) => { sound.textContent = ok ? SHAME.mute : SHAME.unmute; });
  });
  layer.querySelector('[data-reload]').addEventListener('click', () => window.location.reload());
  return layer;
}

/** Позор случается один раз за загрузку страницы: повторная попытка только
 *  дописывает цель и не перекрывает уже открытое окно. */
export function triggerShame({ target = null } = {}) {
  const first = !shamed;
  shamed = true;
  if (!overlay) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    overlay = build(target);
    document.body.appendChild(overlay);
  } else if (target) {
    overlay.querySelector('[data-target]').textContent = `${SHAME.targetLabel} ${target}`;
  }
  if (first) play().then((ok) => { if (!ok) overlay.querySelector('[data-sound]').textContent = SHAME.unmute; });
  window.dispatchEvent(new CustomEvent(SHAME_EVENT, { detail: { target } }));
  return { first };
}

export function destroyShame() {
  overlay?.remove();
  overlay = null;
  if (anthem) { anthem.pause(); anthem = null; }
  shamed = false;
  muted = false;
}
