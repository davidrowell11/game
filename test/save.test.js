import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSave, UPGRADES } from '../src/save.js';

test('a hostile or corrupted save is coerced into a valid one', () => {
  const s = sanitizeSave({ gold: 'lots', runs: -4, kills: 1e99, volume: 7, upgrades: { vitality: 99, might: 'x', bogus: 3 }, settings: { quality: 'ultra', screenShake: 'yes' } });
  assert.equal(s.gold, 0);
  assert.equal(s.runs, 0);
  assert.equal(s.kills, 1e9);
  assert.equal(s.volume, 1);
  assert.equal(s.upgrades.vitality, UPGRADES.find((u) => u.id === 'vitality').max);
  assert.equal(s.upgrades.might, 0);
  assert.ok(!('bogus' in s.upgrades));
  assert.equal(s.settings.quality, 'medium');
  assert.equal(s.settings.screenShake, true);
});

test('a valid save round-trips unchanged', () => {
  const ok = sanitizeSave({ gold: 120, bestDepth: 6, runs: 3, kills: 80, wins: 1, volume: 0.4, upgrades: { vitality: 2 }, settings: { quality: 'high', screenShake: false, damageNumbers: true } });
  assert.equal(ok.gold, 120);
  assert.equal(ok.upgrades.vitality, 2);
  assert.deepEqual(ok.settings, { quality: 'high', screenShake: false, damageNumbers: true });
  assert.deepEqual(sanitizeSave(ok), ok);
});

test('non-objects fall back to defaults', () => {
  for (const bad of [null, 42, 'save', []]) assert.equal(sanitizeSave(bad).gold, 0);
});
