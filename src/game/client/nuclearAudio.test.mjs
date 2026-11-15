import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { NUCLEAR_AUDIO_SAMPLES, defaultNuclearSound, nuclearSoundForStrike } from './nuclearAudio.js';

test('the test range exposes all 20 source front/tail recordings', () => {
  assert.equal(NUCLEAR_AUDIO_SAMPLES.length, 20);
  assert.equal(new Set(NUCLEAR_AUDIO_SAMPLES.map((sample) => sample.id)).size, 20);
  for (const sample of NUCLEAR_AUDIO_SAMPLES) {
    assert.ok(sample.front.endsWith('_front.ogg') || sample.front.endsWith('-front.ogg'));
    assert.ok(sample.tail.endsWith('_tail.ogg') || sample.tail.endsWith('-tail.ogg'));
  }
});

test('historical bomb presets resolve to a source sound', () => {
  assert.equal(defaultNuclearSound('little-boy'), 'little-boy');
  assert.equal(defaultNuclearSound('fat-man'), 'trinity');
  assert.equal(defaultNuclearSound('rds-37'), 'rds37');
  assert.equal(defaultNuclearSound('ivy-mike'), 'ivy-mike');
  assert.equal(defaultNuclearSound('tsar'), 'tsar');
  assert.ok(NUCLEAR_AUDIO_SAMPLES.some((sample) => sample.id === defaultNuclearSound('castle-bravo')));
});

test('every source audio front/tail asset is bundled locally', async () => {
  for (const sample of NUCLEAR_AUDIO_SAMPLES) {
    for (const side of ['front', 'tail']) {
      const path = new URL(`../../../public${sample[side]}`, import.meta.url);
      const file = await stat(path);
      assert.ok(file.size > 1000, `${sample.id} ${side} audio is missing or empty`);
    }
  }
});

// Удар партии не приносит soundId, поэтому идёт по лестнице мощности. Та
// лестница указывала на имена исходного датасета («16-rds37-front.ogg»), которых
// в бандле нет, — взрыв молчал и ронял две 404 в консоль каждый раз.
test('the yield ladder resolves to bundled files, not dataset names', async () => {
  const cases = [
    { yieldMt: 0.15 },
    { yieldMt: 5 },
    { yieldMt: 20 },
    { yieldMt: 100 },
    {},
  ];
  for (const strike of cases) {
    const profile = nuclearSoundForStrike(strike);
    for (const side of ['front', 'tail']) {
      const path = new URL(`../../../public${profile[side]}`, import.meta.url);
      const file = await stat(path);
      assert.ok(file.size > 1000, `${JSON.stringify(strike)} ${side} audio is missing or empty`);
    }
  }
  assert.equal(nuclearSoundForStrike({ yieldMt: 0.15 }).front, '/audio/nuclear/rds37-front.ogg');
  assert.equal(nuclearSoundForStrike({ soundId: 'ivy-king', yieldMt: 0.15 }).id, 'ivy-king');
});
