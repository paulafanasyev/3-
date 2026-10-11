import test from 'node:test';
import assert from 'node:assert/strict';
import { repairIdentifiers, repairRepository } from '../scripts/repair-i18n-identifiers.mjs';

test('repairIdentifiers restores Latin words inside UPPER_SNAKE identifiers only', () => {
  const source = [
    'export const ROCKET_МИССИЯ_AMBIENT_OVERLAY_COHORT_LIMIT = 48;',
    'const REPLAY_ОРБИТА_DURATION_SEC = 28;',
    "const label = 'МЕСТО ЗАПУСКА · MULTI-ПОЛЕЗНАЯ НАГРУЗКА';",
  ].join('\n');
  const { text, unknown } = repairIdentifiers(source);
  assert.match(text, /ROCKET_MISSION_AMBIENT_OVERLAY_COHORT_LIMIT = 48/);
  assert.match(text, /REPLAY_ORBIT_DURATION_SEC = 28/);
  assert.match(text, /'МЕСТО ЗАПУСКА · MULTI-ПОЛЕЗНАЯ НАГРУЗКА'/);
  assert.deepEqual(unknown, []);
});

test('repairIdentifiers leaves unknown Cyrillic tokens alone and reports them', () => {
  const { text, unknown } = repairIdentifiers("const x = 'T_МИНУС';");
  assert.equal(text, "const x = 'T_МИНУС';");
  assert.deepEqual(unknown, ['T_МИНУС']);
});

test('no source identifiers are broken by the Russian translation', () => {
  const { changed } = repairRepository(process.cwd(), { write: false });
  assert.deepEqual(changed.map((c) => c.file), [], 'run: node scripts/repair-i18n-identifiers.mjs');
});
