// Adapted game audio playback for the Cesium client.
// Original OGG samples are copied from Prokopiy8247/Opus5-5-Atomic-Bombs
// with permission from the repository author. See THIRD_PARTY_NOTICES.md.
const PROFILES = [
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

/** Plays the author's front-impact and delayed distant rumble recordings.
 * Current game strike records do not carry warhead yield, so the 1.6 Mt RDS-37
 * profile is the honest default; a future yieldMt field selects the matching tier.
 */
export function playNuclearAudio(strike) {
  if (typeof Audio === 'undefined' || strike?.intercepted) return;
  if (activeFront) { activeFront.pause(); activeFront.currentTime = 0; }
  if (activeTail) { activeTail.pause(); activeTail.currentTime = 0; }
  if (tailTimer !== null) clearTimeout(tailTimer);

  const yieldMt = Number(strike?.yieldMt);
  const profile = Number.isFinite(yieldMt) && yieldMt > 0
    ? PROFILES.find((item) => yieldMt <= item.maxMt) ?? PROFILES.at(-1)
    : PROFILES[0];

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
}
