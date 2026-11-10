import test from 'node:test';
import assert from 'node:assert/strict';
import places from '../data/populated_places.json' with { type: 'json' };

test('God’s Eye View offline city catalogue keeps source provenance and global coverage', () => {
  assert.equal(places.meta.source, 'ne_10m_populated_places_simple');
  assert.equal(places.meta.license, 'Public domain (https://www.naturalearthdata.com/about/terms-of-use/)');
  assert.ok(places.places.length >= 7000);
  assert.ok(places.places.some(([name]) => name === 'Moscow'));
  assert.ok(places.places.some(([name]) => name === 'Hanoi'));
  for (const [name, lat, lon, scalerank, rankMax] of places.places) {
    assert.equal(typeof name, 'string');
    assert.ok(lat >= -90 && lat <= 90);
    assert.ok(lon >= -180 && lon <= 180);
    assert.ok(scalerank >= 0 && scalerank <= 10);
    assert.ok(rankMax >= 0 && rankMax <= 14);
  }
});
