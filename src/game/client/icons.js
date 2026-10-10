// Значки городов и юнитов рисуются на canvas и кешируются: никаких сторонних ассетов.
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2; // 2× для чётких значков на ретине
  const g = c.getContext('2d');
  g.scale(2, 2);
  return [c, g];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Значок города: кольцо цвета нации, население внутри, у столицы — звезда. */
export function cityIcon(color, pop, capital) {
  const key = `c${color}${pop}${capital}`;
  if (cache.has(key)) return cache.get(key);
  const s = capital ? 34 : 28;
  const [c, g] = canvas(s, s);
  const r = s / 2 - 2;
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4;
  g.fillStyle = 'rgba(10,16,26,.88)'; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.lineWidth = capital ? 3.5 : 2.5; g.strokeStyle = color; g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${capital ? 13 : 12}px "Noto Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(pop ?? '?'), s / 2, s / 2 + 0.5);
  if (capital) {
    g.fillStyle = '#f0c46a'; g.font = '700 11px sans-serif'; g.fillText('★', s / 2, 5);
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

const GLYPH = {
  settler: 'Пс', warrior: 'Вн', archer: 'Лк', swordsman: 'Мч', galley: 'Гл', infantry: 'Пх', artillery: 'Ар', tank: 'Тк',
  ironclad: 'Бр', biplane: 'Бп', fighter: 'Ис', drone: 'Бл', helicopter: 'Вт', recon: 'Рз', satellite: 'Сп', interceptor: 'Пр',
};

/** Фишка юнита: плашка цвета нации с сокращением, полоска здоровья, рамка выделения. */
export function unitIcon(type, color, hp = 100, selected = false, count = 1) {
  const key = `u${type}${color}${Math.round(hp / 10)}${selected}${count}`;
  if (cache.has(key)) return cache.get(key);
  const w = 34; const h = 26;
  const [c, g] = canvas(w + 6, h + 10);
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 4;
  roundRect(g, 3, 3, w, h, 6); g.fillStyle = color; g.fill();
  g.shadowBlur = 0;
  g.lineWidth = selected ? 3 : 1.5; g.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,.45)'; g.stroke();
  g.fillStyle = 'rgba(8,12,20,.9)'; g.font = '700 12px "Noto Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(GLYPH[type] ?? '?', 3 + w / 2, 3 + h / 2 + 0.5);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(6, h + 5, w - 6, 3);
  g.fillStyle = hp > 60 ? '#6be38f' : hp > 30 ? '#ffd166' : '#ff6b5e'; g.fillRect(6, h + 5, (w - 6) * hp / 100, 3);
  if (count > 1) {
    g.fillStyle = '#0b111b'; g.beginPath(); g.arc(w + 1, 6, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '700 9px sans-serif'; g.fillText(String(count), w + 1, 6.5);
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
