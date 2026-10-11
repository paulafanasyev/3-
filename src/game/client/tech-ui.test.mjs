import assert from 'node:assert/strict';
import test from 'node:test';
import { technologyTree } from './tech-ui.js';

test('дерево технологий отмечает изученные, текущую и доступные', () => {
  const tree = technologyTree({ nationId: 'borea', choices: { techs: ['iron', 'writing'] }, nations: [{ id: 'borea', era: 0, techs: ['bronze'], research: 'iron' }] });
  const ancient = tree.eras[0];
  assert.equal(tree.currentEra, 0);
  assert.equal(ancient.current, true);
  assert.equal(ancient.techs.find((t) => t.id === 'bronze').researched, true);
  assert.equal(ancient.techs.find((t) => t.id === 'iron').current, true);
  assert.deepEqual(ancient.techs.find((t) => t.id === 'iron').command, { kind: 'research', tech: 'iron' });
  assert.equal(tree.advance, null);
});
