import test from 'node:test';
import assert from 'node:assert/strict';
import { World, T } from '../src/world.js';
import { generateDungeon, WALL, FLOOR } from '../src/dungeon.js';
import { RNG } from '../src/rng.js';

// Use World's grid methods on a bare object (no WebGL / DOM needed).
function gridWorld(W, H, tiles) {
  const w = Object.create(World.prototype);
  Object.assign(w, { W, H, tiles });
  return w;
}

// Reference: does the segment pass through any wall tile? Sampled very finely.
function bruteLOS(w, ax, az, bx, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.002);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (w.solidAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

test('line of sight agrees with a brute-force reference on real dungeons', () => {
  const rng = new RNG(99);
  let disagreements = 0;
  let checked = 0;
  for (const seed of [1, 2, 3]) {
    const d = generateDungeon(seed, 3);
    const w = gridWorld(d.width, d.height, d.tiles);
    const floors = [];
    for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i] === FLOOR) floors.push(i);
    for (let k = 0; k < 400; k++) {
      const a = floors[(rng.next() * floors.length) | 0];
      const b = floors[(rng.next() * floors.length) | 0];
      const ax = (a % d.width) * T + rng.range(0.1, 1.9);
      const az = ((a / d.width) | 0) * T + rng.range(0.1, 1.9);
      const bx = (b % d.width) * T + rng.range(0.1, 1.9);
      const bz = ((b / d.width) | 0) * T + rng.range(0.1, 1.9);
      if (Math.hypot(bx - ax, bz - az) > 40) continue;
      checked++;
      if (w.lineOfSight(ax, az, bx, bz) !== bruteLOS(w, ax, az, bx, bz)) disagreements++;
    }
  }
  assert.ok(checked > 300);
  assert.equal(disagreements, 0, `${disagreements}/${checked} segments disagree`);
});

test('line of sight cannot slip diagonally between two walls touching at a corner', () => {
  // . #
  // # .
  const tiles = new Uint8Array([FLOOR, WALL, WALL, FLOOR]);
  const w = gridWorld(2, 2, tiles);
  assert.equal(w.lineOfSight(0.5, 0.5, 3.5, 3.5), false);
  assert.equal(w.lineOfSight(1.0, 1.0, 3.0, 3.0), false); // exactly through the corner
});

test('circle movement never ends inside a wall, even at high speed', () => {
  const d = generateDungeon(7, 4);
  const w = gridWorld(d.width, d.height, d.tiles);
  const rng = new RNG(3);
  const pos = { x: d.start.x * T + 1, z: d.start.y * T + 1 };
  for (let i = 0; i < 3000; i++) {
    const a = rng.range(0, Math.PI * 2);
    w.moveCircle(pos, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.42);
    assert.ok(!w.solidAt(pos.x, pos.z), `ended inside a wall at step ${i}`);
  }
});
