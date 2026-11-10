import test from 'node:test';
import assert from 'node:assert/strict';
import { NUCLEAR_AUDIO_SAMPLES, defaultNuclearSound } from './nuclearAudio.js';

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
