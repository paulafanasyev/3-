// Лица лидеров «Купола». Отрисовщик — avatar-svg.js из репо
// paulafanasyev/ai-english-teacher (скопирован без изменений, см. CREDITS.md).
// Здесь только токены внешности и игровые дополнения поверх: борода, седина,
// значок-герб на одежде, рамка цвета нации и мимика под настроение лидера.
import { renderAvatarSVG } from './avatar-svg.js';

export const LEADER_FACES = Object.freeze({
  borea: {
    id: 'borea', name: 'Ингвар Хольмстад', gender: 'm',
    bg: '#9CC3E0', clothing: '#24364A', clothingDark: '#121D29', clothingStyle: 'collar',
    skin: '#D9A88A', skinLight: '#F1C7AA', hair: '#A3A29E', hairLight: '#D6D5D0',
    eyes: '#6C9CC4', brow: '#8E8D88', lips: '#9C5B52', blush: '#D9917F',
    hairStyle: 'sidepart', faceShape: 'broad', eyeShape: 'almond', accessory: 'none', accessoryColor: '#C0C8D2',
    extras: { beard: '#A9A8A3', frame: '#7FB2D9', pin: '#C0C8D2' },
  },
  cartel: {
    id: 'cartel', name: 'Сабина Ортелли', gender: 'f',
    bg: '#E7C27A', clothing: '#1E1A16', clothingDark: '#0C0A08', clothingStyle: 'collar',
    skin: '#EBC2A2', skinLight: '#FFE0C6', hair: '#231814', hairLight: '#5A3C30',
    eyes: '#5A3A26', brow: '#2A1C16', lips: '#A23A44', blush: '#E39A92',
    hairStyle: 'messyBun', faceShape: 'oval', eyeShape: 'almond', accessory: 'earrings', accessoryColor: '#D9A441',
    extras: { frame: '#D9A441', pin: '#D9A441' },
  },
  meridian: {
    id: 'meridian', name: 'Таэль Ноэрис', gender: 'f',
    bg: '#9ED3C4', clothing: '#2F7F6C', clothingDark: '#1A4F43', clothingStyle: 'crew',
    skin: '#A97A5A', skinLight: '#C99874', hair: '#16130F', hairLight: '#4A4038',
    eyes: '#3D2A1C', brow: '#2A2018', lips: '#8E4D44', blush: '#C27E6E',
    hairStyle: 'longStraight', faceShape: 'oval', eyeShape: 'soft', accessory: 'none', accessoryColor: '#D8C79A',
    extras: { frame: '#4CB39A', pin: '#D8C79A' },
  },
  auris: {
    id: 'auris', name: 'Илан Сорейо', gender: 'm',
    bg: '#E8A07E', clothing: '#C8574D', clothingDark: '#8C3A33', clothingStyle: 'collar',
    skin: '#C9946C', skinLight: '#E3B089', hair: '#2A1D18', hairLight: '#5E4A40',
    eyes: '#3A2414', brow: '#2A1D18', lips: '#94493F', blush: '#D18774',
    hairStyle: 'crop', faceShape: 'angular', eyeShape: 'almond', accessory: 'none', accessoryColor: '#E9C46A',
    extras: { temples: '#B8B0A6', frame: '#C8574D', pin: '#E9C46A' },
  },
});

/** Настроение лидера → эмоция отрисовщика и наклон бровей (для гнева). */
export const MOOD_EMOTION = Object.freeze({
  hostile: { emotion: 'neutral', viseme: 'M', frown: 1 },
  cold: { emotion: 'neutral', viseme: 'rest', frown: 0.5 },
  neutral: { emotion: 'neutral', viseme: 'rest', frown: 0 },
  warm: { emotion: 'happy', frown: 0 },
  friend: { emotion: 'encourage', frown: 0 },
  worried: { emotion: 'worried', frown: 0 },
});

const beard = (color) => `<g id="leader-beard"><path d="M100 196 C104 240 126 268 160 271 C194 268 216 240 220 196 C212 222 196 234 178 236 Q160 226 142 236 C124 234 108 222 100 196Z" fill="${color}"/><path d="M124 218 Q160 206 196 218 Q186 214 160 214 Q134 214 124 218Z" fill="${color}"/></g>`;
const temples = (color) => `<path d="M98 150 Q94 124 104 108 M222 150 Q226 124 216 108" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" opacity=".9"/>`;
const pin = (color, x = 212, y = 318) => `<g id="leader-pin"><circle cx="${x}" cy="${y}" r="11" fill="${color}"/><circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#1B1B1B" stroke-width="2" opacity=".55"/></g>`;
const frown = (amount) => (amount > 0
  ? `<g id="leader-frown" opacity="${0.6 + 0.4 * amount}"><path d="M110 128 L148 ${132 + 6 * amount}" stroke="var(--brow)" stroke-width="5" stroke-linecap="round"/><path d="M210 128 L172 ${132 + 6 * amount}" stroke="var(--brow)" stroke-width="5" stroke-linecap="round"/></g>`
  : '');
const frame = (color) => `<rect x="3" y="3" width="314" height="354" fill="none" stroke="${color}" stroke-width="6"/><rect x="10" y="10" width="300" height="340" fill="none" stroke="#FFFFFF" stroke-width="1" opacity=".35"/>`;

/**
 * SVG-портрет лидера. `mood` — id настроения (MOODS из leaders.js) или 'worried'.
 * `viseme` позволяет клиенту анимировать речь, как в ai-english-teacher.
 */
export function renderLeaderSVG(nationId, { mood = 'neutral', viseme } = {}) {
  const def = LEADER_FACES[nationId];
  if (!def) throw new Error(`Нет лица для ${nationId}`);
  const m = MOOD_EMOTION[mood] ?? MOOD_EMOTION.neutral;
  let svg = renderAvatarSVG(def, { emotion: m.emotion, viseme: viseme ?? m.viseme, instanceId: mood });
  const x = def.extras;
  // борода под ртом, седина и значок поверх волос и одежды
  if (x.beard) svg = svg.replace('<g id="avatar-mouth"', `${beard(x.beard)}<g id="avatar-mouth"`);
  const overlay = `${x.temples ? temples(x.temples) : ''}${frown(m.frown).replaceAll('var(--brow)', def.brow)}${pin(x.pin)}`;
  svg = svg.replace('\n  </g>\n  <path d="M39 329', `${overlay}\n  </g>\n  <path d="M39 329`);
  svg = svg.replace('  <style>', `  ${frame(x.frame)}\n  <style>`);
  svg = svg.replace(/aria-label="[^"]*"/, `aria-label="${def.name}"`);
  return svg;
}

export const LEADER_MOODS = Object.freeze(Object.keys(MOOD_EMOTION));
