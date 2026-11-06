import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDungeon, bfs, FLOOR, WALL, isBossFloor } from '../src/dungeon.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

test('generation is deterministic for a given seed and depth', () => {
  const a = generateDungeon(12345, 3);
  const b = generateDungeon(12345, 3);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.deepEqual(a.spawns, b.spawns);
});

test('different seeds give different layouts', () => {
  const a = generateDungeon(1, 1);
  const b = generateDungeon(2, 1);
  assert.notDeepEqual(Array.from(a.tiles), Array.from(b.tiles));
});

for (const depth of [1, 2, 4, 7, 8, 12, 20]) {
  test(`every floor tile, spawn, item and the stairs are reachable (depth ${depth})`, () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed, depth);
      const { width: W, height: H, tiles } = d;
      const dist = bfs(tiles, W, H, d.start.x, d.start.y);
      for (let i = 0; i < tiles.length; i++) {
        if (tiles[i] === FLOOR) assert.ok(dist[i] >= 0, `seed ${seed}: isolated floor tile ${i % W},${(i / W) | 0}`);
      }
      const at = (p) => p.y * W + p.x;
      assert.ok(dist[at(d.stairs)] > 0, `seed ${seed}: stairs unreachable`);
      for (const s of d.spawns) assert.equal(tiles[at(s)], FLOOR, `seed ${seed}: spawn in wall`);
      for (const it of d.items) assert.equal(tiles[at(it)], FLOOR, `seed ${seed}: item in wall`);
      // Border must be solid so nothing escapes the map.
      for (let x = 0; x < W; x++) {
        assert.equal(tiles[x], WALL);
        assert.equal(tiles[(H - 1) * W + x], WALL);
      }
      assert.ok(d.rooms.length >= 5, `seed ${seed}: only ${d.rooms.length} rooms`);
    }
  });
}

test('boss floors contain exactly one boss in the stairs room', () => {
  for (const seed of SEEDS) {
    const d = generateDungeon(seed, 4);
    assert.ok(isBossFloor(4));
    assert.equal(d.spawns.filter((s) => s.type === 'boss').length, 1);
    assert.ok(d.rooms.some((r) => r.role === 'boss'));
  }
  const normal = generateDungeon(5, 3);
  assert.equal(normal.spawns.filter((s) => s.type === 'boss').length, 0);
});

test('every floor has at least one treasure room', () => {
  for (const seed of SEEDS) {
    const d = generateDungeon(seed, 2);
    assert.ok(d.items.some((i) => i.kind === 'chest'), `seed ${seed}`);
  }
});
