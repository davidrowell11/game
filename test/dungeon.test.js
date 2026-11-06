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
      for (const t of [...d.traps, ...d.urns, ...d.torches]) assert.equal(tiles[at(t)], FLOOR, `seed ${seed}: trap/urn/torch in wall`);
      for (const r of d.rooms) assert.equal(tiles[r.cy * W + r.cx], FLOOR, `seed ${seed}: room centre is wall`);
      // nothing interactive shares a tile
      const occupied = [...d.spawns, ...d.items, ...d.traps, ...d.urns, ...d.torches].map(at);
      assert.equal(new Set(occupied).size, occupied.length, `seed ${seed}: overlapping placements`);
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
    const arena = d.rooms.find((r) => r.role === 'boss');
    assert.ok(arena);
    assert.ok(arena.w >= 11 && arena.h >= 11, `seed ${seed}: boss arena only ${arena.w}x${arena.h}`);
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

test('rooms come in several shapes', () => {
  const shapes = new Set();
  for (const seed of SEEDS.slice(0, 20)) for (const r of generateDungeon(seed, 6).rooms) shapes.add(r.shape);
  for (const s of ['rect', 'round', 'cross', 'cavern']) assert.ok(shapes.has(s), `never generated a ${s} room`);
});

test('merchants appear on some floors from depth 2', () => {
  const n = SEEDS.filter((seed) => generateDungeon(seed, 3).items.some((i) => i.kind === 'merchant')).length;
  assert.ok(n > 5, `only ${n} merchants in ${SEEDS.length} floors`);
  assert.ok(!SEEDS.some((seed) => generateDungeon(seed, 1).items.some((i) => i.kind === 'merchant')));
});
