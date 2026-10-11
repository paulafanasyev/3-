import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDING_VALUES, endingCopy } from './endgame.js';

test('есть русские тексты для каждого ending сервера', () => {
  assert.deepEqual(ENDING_VALUES, ['defeat', 'conquest', 'saved', 'partial', 'betrayal', 'lastRefuge', 'silence']);
  for (const ending of ENDING_VALUES) {
    const copy = endingCopy({ ending });
    assert.ok(copy.title && copy.text, ending);
    assert.match(copy.title, /[А-Яа-яЁё]/, ending);
    assert.match(copy.text, /[А-Яа-яЁё]/, ending);
  }
});
