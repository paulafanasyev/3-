import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGameBuild } from '../../scripts/check-game-build.mjs';

async function fakeDist({ complete = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kupol-build-check-'));
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<html><script type="module" src="/assets/app.js"></script></html>');
  await writeFile(join(root, 'assets', 'app.js'), 'bootKupol(); // /kupol');
  if (complete) {
    await mkdir(join(root, 'cesium', 'Assets', 'Textures', 'NaturalEarthII'), { recursive: true });
    await writeFile(join(root, 'cesium', 'Assets', 'Textures', 'NaturalEarthII', 'NE2_1.jpg'), 'fake');
    await mkdir(join(root, 'game', 'units', 'forge'), { recursive: true });
    await writeFile(join(root, 'game', 'units', 'forge', 'index.json'), JSON.stringify({ 'Космическая эпоха': [{ file: 'forge/infantry.glb' }] }));
    await writeFile(join(root, 'game', 'units', 'forge', 'infantry.glb'), 'fake');
    await mkdir(join(root, 'game', 'leaders'), { recursive: true });
    await writeFile(join(root, 'game', 'leaders', 'borea.png'), 'fake');
  }
  return root;
}

test('checkGameBuild accepts the complete required dist tree', async (t) => {
  const root = await fakeDist();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(checkGameBuild(root), {
    ok: true,
    errors: [],
    checks: { kupol: true, naturalEarth: true, units: true, portraits: true },
  });
});

test('checkGameBuild reports missing Kupol release assets', async (t) => {
  const root = await fakeDist({ complete: false });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = checkGameBuild(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks, { kupol: true, naturalEarth: false, units: false, portraits: false });
  assert.match(result.errors.join('\n'), /NaturalEarthII/);
  assert.match(result.errors.join('\n'), /юниты/);
  assert.match(result.errors.join('\n'), /портреты/);
});
