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

// ---------- фигурки юнитов (векторные силуэты, как фишки в Civilization) ----------
/** Рисует силуэт юнита в квадрате size×size с центром (x, y). Цвет — текущий fillStyle/strokeStyle. */
export function drawFigure(g, type, x, y, size) {
  const k = size / 32; // все координаты ниже в системе 32×32
  g.save();
  g.translate(x - 16 * k, y - 16 * k);
  g.scale(k, k);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (pts, w = 2.2) => { g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); };
  const poly = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
  const circle = (cx, cy, r) => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
  const person = (helmet = false) => {
    circle(13, 7, 3);
    if (helmet) { g.beginPath(); g.arc(13, 6.4, 3.8, Math.PI, 0); g.fill(); }
    line([13, 10, 13, 19], 3); line([13, 19, 9.5, 27]); line([13, 19, 16.5, 27]);
  };
  switch (type) {
    case 'settler':
      poly([4, 14, 22, 14, 21, 21, 5, 21]); g.beginPath(); g.ellipse(13, 14, 9, 6, 0, Math.PI, 0); g.fill();
      circle(8, 24, 3); circle(19, 24, 3); line([22, 18, 29, 16]); circle(28, 12, 2.4);
      break;
    case 'warrior':
      person(); line([13, 12, 20, 9]); line([20, 9, 24, 3], 3.4); line([13, 12, 8, 16]);
      break;
    case 'archer':
      person(); g.lineWidth = 1.8; g.beginPath(); g.arc(18, 13, 8, -1.2, 1.2); g.stroke();
      line([20.9, 5.6, 20.9, 20.4], 0.9); line([13, 12, 21, 13]); line([9, 13, 27, 13], 1.2);
      break;
    case 'swordsman':
      person(true); line([13, 12, 19, 12]); line([19, 12, 27, 4], 2); line([17, 9, 21, 13], 1.6);
      g.beginPath(); g.ellipse(8, 15, 3.6, 5.2, 0, 0, Math.PI * 2); g.fill();
      break;
    case 'infantry':
      person(true); line([13, 13, 20, 12]); line([7, 16, 27, 9], 1.8); line([24, 10, 28, 8.8], 1.2);
      break;
    case 'artillery':
      line([4, 21, 27, 10], 3.6); poly([14, 21, 27, 21, 25, 25, 13, 25]); circle(11, 22, 5.5);
      g.save(); g.globalCompositeOperation = 'destination-out'; circle(11, 22, 2); g.restore();
      break;
    case 'tank':
      poly([3, 18, 29, 18, 27, 25, 5, 25]);
      poly([6, 18, 26, 18, 23, 13, 9, 13]); poly([11, 13, 21, 13, 19, 9, 13, 9]); line([19, 11, 30, 9], 2.2);
      break;
    case 'galley':
      poly([2, 19, 30, 19, 25, 25, 7, 25]); line([16, 19, 16, 4], 1.8); poly([16, 5, 25, 15, 16, 15]);
      for (let i = 0; i < 5; i += 1) line([7 + i * 4.4, 23, 5 + i * 4.4, 29], 1.2);
      break;
    case 'ironclad':
      poly([1, 19, 31, 19, 27, 25, 5, 25]); poly([8, 19, 23, 19, 22, 14, 9, 14]); poly([13, 14, 17, 14, 17, 7, 13, 7]);
      line([22, 16, 29, 14], 2);
      break;
    case 'biplane':
      poly([4, 15, 28, 15, 28, 17, 4, 17]); poly([6, 10, 26, 10, 26, 12, 6, 12]); line([10, 12, 10, 15], 1.2); line([22, 12, 22, 15], 1.2);
      poly([14, 8, 18, 8, 18, 26, 14, 26]); poly([11, 25, 21, 25, 21, 27, 11, 27]);
      break;
    case 'fighter':
    case 'recon':
      poly([16, 2, 18, 12, 30, 20, 30, 22, 18, 19, 18, 26, 22, 29, 10, 29, 14, 26, 14, 19, 2, 22, 2, 20, 14, 12]);
      break;
    case 'drone':
      poly([1, 13, 31, 13, 31, 15, 1, 15]); poly([14, 6, 18, 6, 18, 26, 14, 26]); poly([10, 24, 22, 24, 16, 28]);
      break;
    case 'helicopter':
      g.beginPath(); g.ellipse(12, 17, 8, 5.5, 0, 0, Math.PI * 2); g.fill(); line([19, 16, 30, 14], 2.4); line([28, 10, 30, 18], 1.4);
      line([2, 9, 26, 9], 1.6); line([12, 9, 12, 12], 1.6); line([6, 25, 18, 25], 1.4); line([9, 22, 9, 25], 1.2); line([15, 22, 15, 25], 1.2);
      break;
    case 'icbm':
      poly([16, 1, 20, 7, 20, 25, 12, 25, 12, 7]); poly([12, 19, 7, 27, 12, 25]); poly([20, 19, 25, 27, 20, 25]);
      break;
    case 'satellite':
    case 'interceptor':
      poly([12, 12, 20, 12, 20, 20, 12, 20]); poly([1, 13, 10, 13, 10, 19, 1, 19]); poly([22, 13, 31, 13, 31, 19, 22, 19]);
      line([16, 12, 16, 5], 1.4); circle(16, 4, 2);
      break;
    default:
      circle(16, 16, 8);
  }
  g.restore();
}

/**
 * Фишка юнита в духе Civilization: медальон цвета нации с силуэтом, кольцо здоровья,
 * звёзды ветерана, у стека — счётчик, у выбранного — белая рамка.
 */
export function unitIcon(type, color, hp = 100, selected = false, count = 1, vet = 0) {
  const key = `u${type}${color}${Math.round(hp / 5)}${selected}${count}${vet}`;
  if (cache.has(key)) return cache.get(key);
  const S = 48; const cx = 22; const cy = 24; const r = 17;
  const [c, g] = canvas(S, S);
  g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
  g.fillStyle = 'rgba(8,12,20,.92)'; g.beginPath(); g.arc(cx, cy, r + 3, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  const grad = g.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, r);
  grad.addColorStop(0, shade(color, 0.35)); grad.addColorStop(1, shade(color, -0.25));
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = 3.2; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(cx, cy, r + 1.6, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = hp > 60 ? '#6be38f' : hp > 30 ? '#ffd166' : '#ff6b5e';
  g.beginPath(); g.arc(cx, cy, r + 1.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, hp / 100)); g.stroke();
  if (selected) { g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r + 4.4, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(8,12,20,.92)'; g.strokeStyle = 'rgba(8,12,20,.92)';
  drawFigure(g, type, cx, cy + 0.5, 26);
  if (vet) { g.fillStyle = '#f0c46a'; g.font = '700 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★'.repeat(vet), cx, cy + r - 2); }
  if (count > 1) {
    g.fillStyle = '#0b111b'; g.beginPath(); g.arc(S - 8, 8, 7, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1.2; g.strokeStyle = color; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(count), S - 8, 8.5);
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** Крупный портрет юнита для окна боя. */
export function unitPortrait(type, color, size = 96) {
  const key = `p${type}${color}${size}`;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(size, size);
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, shade(color, 0.25)); grad.addColorStop(1, shade(color, -0.45));
  g.fillStyle = grad; roundRect(g, 0, 0, size, size, size * 0.16); g.fill();
  g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(size / 2, size * 0.42, size * 0.42, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(8,12,20,.9)'; g.strokeStyle = 'rgba(8,12,20,.9)';
  drawFigure(g, type, size / 2, size / 2, size * 0.78);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

function shade(hex, amount) {
  const h = String(hex).replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const out = v.map((x) => Math.round(amount >= 0 ? x + (255 - x) * amount : x * (1 + amount)));
  return `rgb(${out.join(',')})`;
}
