import test from 'node:test';
import assert from 'node:assert/strict';
import { thermalPower, meterExposure } from './nuclearVolumetrics.js';

const tSecond = (kt) => 0.0417 * kt ** 0.44;

test('thermal power is normalised so the second maximum equals one', () => {
  const kt = 1000;
  const peak = tSecond(kt);
  const at = thermalPower(kt, peak);
  assert.ok(Math.abs(at - 1) < 0.02, `power at t2 = ${at}`);
  assert.equal(thermalPower(kt, 0), 0);
  assert.equal(thermalPower(kt, -5), 0);
});

test('the first ultraviolet pulse spikes before the second maximum and dies', () => {
  const kt = 1000;
  const tMin = 0.0035 * kt ** 0.4;
  const early = thermalPower(kt, tMin / 6);
  assert.ok(early > 0.85, `first pulse peak ${early}`);
  assert.ok(thermalPower(kt, 60 * tSecond(kt)) < 0.2, 'must decay with the fireball');
});

test('a bigger charge burns longer: the second maximum scales as W^0.44', () => {
  assert.ok(tSecond(50000) / tSecond(1000) > 4);
  const kt = 50000;
  assert.ok(Math.abs(thermalPower(kt, tSecond(kt)) - 1) < 0.02);
});

test('a blinding fireball in view forces the camera to stop down hard', () => {
  const kt = 15000;
  const day = meterExposure({
    yieldKt: kt, seconds: 18, fireballRadius: 1583, fireballOpacity: 1,
    fireballTemp: 3589, emission: 2400, distanceM: 11000, halfFovRad: 0.524, sunFactor: 1,
  });
  assert.ok(day < 0.12, `daylight exposure while blinding = ${day}`);
  assert.ok(day > 0.004, 'must stay finite and never go black');
});

test('once the ball cools the metering releases and the cloud is exposed normally', () => {
  const kt = 15000;
  const late = meterExposure({
    yieldKt: kt, seconds: 400, fireballRadius: 2810, fireballOpacity: 0,
    fireballTemp: 824, emission: 2400, distanceM: 11000, halfFovRad: 0.524, sunFactor: 1,
  });
  assert.ok(late > 0.1, `late exposure = ${late}`);
  assert.ok(late <= 0.42 + 1e-9, `daylight base must not be exceeded, got ${late}`);
});

test('night opens the camera and a distant ball stops it less than a near one', () => {
  const base = {
    yieldKt: 1000, seconds: 8, fireballRadius: 900, fireballOpacity: 1,
    fireballTemp: 4000, emission: 1600, halfFovRad: 0.524,
  };
  const near = meterExposure({ ...base, distanceM: 3000, sunFactor: 1 });
  const far = meterExposure({ ...base, distanceM: 120000, sunFactor: 1 });
  assert.ok(far > near, `far ${far} must exceed near ${near}`);
  const night = meterExposure({ ...base, distanceM: 3000, sunFactor: 0 });
  assert.ok(night > near * 2, `night ${night} must open well past day ${near}`);
});

test('the whiteout window blanks the frame for its own duration only', () => {
  const during = meterExposure({
    yieldKt: 20, seconds: 0.05, fireballRadius: 200, fireballOpacity: 1,
    fireballTemp: 6000, emission: 1600, distanceM: 5000, halfFovRad: 0.524,
    sunFactor: 1, whiteoutSeconds: 0.15,
  });
  const after = meterExposure({
    yieldKt: 20, seconds: 6, fireballRadius: 200, fireballOpacity: 0.2,
    fireballTemp: 1200, emission: 1600, distanceM: 5000, halfFovRad: 0.524,
    sunFactor: 1, whiteoutSeconds: 0.15,
  });
  assert.ok(during < 0.05, `whiteout exposure ${during}`);
  assert.ok(after > during * 4, `after ${after} vs during ${during}`);
});

test('a sub-kiloton ball seen from afar does not keep the camera shut', () => {
  const e = meterExposure({
    yieldKt: 0.5, seconds: 40, fireballRadius: 60, fireballOpacity: 0.6,
    fireballTemp: 2200, emission: 1600, distanceM: 12000, halfFovRad: 0.524, sunFactor: 1,
  });
  assert.ok(e > 0.2, `exposure ${e}`);
});
