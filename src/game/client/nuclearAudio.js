// Nuclear test-range audio library.
// Original front/tail OGG samples are served from the source project's public repository.
// The three frequently used samples are also mirrored locally in public/audio/nuclear/.
const SAMPLES = [
  ['mk82', 'Mk 82', '01_mk82'],
  ['mk84', 'Mk 84', '02_mk84'],
  ['tallboy', 'Tallboy', '03_tallboy'],
  ['grand-slam', 'Grand Slam', '04_grand_slam'],
  ['moab', 'MOAB', '05_moab'],
  ['davy-crockett', 'Davy Crockett', '06_davy_crockett'],
  ['foab', 'FOAB', '07_foab'],
  ['b61-12', 'B61-12', '08_b61_12'],
  ['grable', 'Grable', '09_grable'],
  ['little-boy', 'Little Boy', '10_little_boy'],
  ['trinity', 'Trinity', '11_trinity'],
  ['baker', 'Baker', '12_baker'],
  ['sedan', 'Sedan', '13_sedan'],
  ['ivy-king', 'Ivy King', '14_ivy_king'],
  ['b83', 'B83', '15_b83'],
  ['rds37', 'РДС-37', '16_rds37'],
  ['ivy-mike', 'Ivy Mike', '17_ivy_mike'],
  ['castle-bravo', 'Castle Bravo', '18_castle_bravo'],
  ['test219', 'Test 219', '19_test219'],
  ['tsar', 'Царь-бомба', '20_tsar'],
].map(([id, name, prefix]) => Object.freeze({
  id, name,
  front: id === 'rds37' ? '/audio/nuclear/16-rds37-front.ogg'
    : id === 'castle-bravo' ? '/audio/nuclear/18-castle-bravo-front.ogg'
      : id === 'tsar' ? '/audio/nuclear/20-tsar-front.ogg' : `/audio/nuclear/${id}-front.ogg`,
  tail: id === 'rds37' ? '/audio/nuclear/16-rds37-tail.ogg'
    : id === 'castle-bravo' ? '/audio/nuclear/18-castle-bravo-tail.ogg'
      : id === 'tsar' ? '/audio/nuclear/20-tsar-tail.ogg' : `/audio/nuclear/${id}-tail.ogg`,
}));

const DEFAULT_SOUND = Object.freeze({
  'little-boy': 'little-boy', 'fat-man': 'trinity',
  'rds-1': 'rds37', 'rds-2': 'rds37', 'rds-3': 'rds37', 'rds-4': 'rds37', 'rds-5': 'rds37',
  'rds-6s': 'rds37', 'rds-37': 'rds37', 'ivy-mike': 'ivy-mike',
  'castle-bravo': 'castle-bravo', 'castle-romeo': 'castle-bravo', 'castle-yankee': 'castle-bravo',
  mk17: 'castle-bravo', 'grapple-x': 'test219', 'grapple-y': 'test219',
  b41: 'tsar', tsar: 'tsar', b53: 'b83', 'china-test-6': 'test219', canopus: 'test219',
});

export const NUCLEAR_AUDIO_SAMPLES = SAMPLES;
export const defaultNuclearSound = (bombId) => DEFAULT_SOUND[bombId] ?? 'rds37';

const GAME_PROFILES = [
  { maxMt: 5, front: '/audio/nuclear/16-rds37-front.ogg', tail: '/audio/nuclear/16-rds37-tail.ogg' },
  { maxMt: 20, front: '/audio/nuclear/18-castle-bravo-front.ogg', tail: '/audio/nuclear/18-castle-bravo-tail.ogg' },
  { maxMt: Infinity, front: '/audio/nuclear/20-tsar-front.ogg', tail: '/audio/nuclear/20-tsar-tail.ogg' },
];

let activeFront = null;
let activeTail = null;
let tailTimer = null;

function safePlay(audio) {
  const result = audio.play();
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

export function playNuclearAudio(strike = {}) {
  if (typeof Audio === 'undefined' || strike.intercepted) return false;
  if (activeFront) { activeFront.pause(); activeFront.currentTime = 0; }
  if (activeTail) { activeTail.pause(); activeTail.currentTime = 0; }
  if (tailTimer !== null) clearTimeout(tailTimer);

  const selected = SAMPLES.find((sample) => sample.id === strike.soundId);
  const yieldMt = Number(strike.yieldMt);
  const profile = selected ?? (Number.isFinite(yieldMt) && yieldMt > 0
    ? GAME_PROFILES.find((item) => yieldMt <= item.maxMt) ?? GAME_PROFILES.at(-1)
    : GAME_PROFILES[0]);

  activeFront = new Audio(profile.front);
  activeFront.preload = 'auto';
  activeFront.volume = 0.9;
  safePlay(activeFront);

  tailTimer = setTimeout(() => {
    activeTail = new Audio(profile.tail);
    activeTail.preload = 'auto';
    activeTail.volume = 0.82;
    safePlay(activeTail);
  }, 1700);
  return true;
}
