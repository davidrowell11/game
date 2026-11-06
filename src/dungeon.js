// Procedural dungeon generator.
// Rooms are scattered without overlap, joined with a minimum spanning tree
// (so every room is reachable) plus a few extra corridors to create loops.
// The room farthest from the start (by walking distance) holds the stairs,
// and every BOSS_EVERY floors that room becomes a boss arena.

import { RNG } from './rng.js';

export const WALL = 0;
export const FLOOR = 1;
export const BOSS_EVERY = 4;
export const FINAL_DEPTH = 12;

export const ENEMY_POOL = [
  { type: 'husk', minDepth: 1, weight: 10 },
  { type: 'spitter', minDepth: 1, weight: 5 },
  { type: 'brute', minDepth: 2, weight: 3 },
  { type: 'wisp', minDepth: 3, weight: 5 },
  { type: 'shaman', minDepth: 5, weight: 2 },
];

export function isBossFloor(depth) {
  return depth % BOSS_EVERY === 0;
}

export function generateDungeon(seed, depth) {
  const rng = new RNG(seed);
  const size = Math.min(44 + depth * 3, 84);
  const W = size;
  const H = size;
  const tiles = new Uint8Array(W * H); // all WALL
  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  const carve = (x, y) => {
    if (inBounds(x, y)) tiles[idx(x, y)] = FLOOR;
  };

  // --- Rooms -------------------------------------------------------------
  const rooms = [];
  const targetRooms = Math.min(7 + depth, 18);
  const boss = isBossFloor(depth);
  for (let attempt = 0; attempt < 800 && rooms.length < targetRooms; attempt++) {
    const big = boss && rooms.length === 1; // reserve a large arena candidate
    const w = big ? rng.int(13, 15) : rng.int(5, 11);
    const h = big ? rng.int(13, 15) : rng.int(5, 11);
    const x = rng.int(2, W - w - 3);
    const y = rng.int(2, H - h - 3);
    const overlaps = rooms.some(
      (o) => x - 2 < o.x + o.w && x + w + 2 > o.x && y - 2 < o.y + o.h && y + h + 2 > o.y,
    );
    if (overlaps) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), role: 'combat' });
  }
  for (const r of rooms) {
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) carve(xx, yy);
  }

  // --- Corridors (MST via Prim + extra loops) -----------------------------
  const dist2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  const edges = [];
  const inTree = [0];
  const remaining = new Set(rooms.map((_, i) => i).slice(1));
  while (remaining.size) {
    let best = null;
    for (const a of inTree) {
      for (const b of remaining) {
        const d = dist2(rooms[a], rooms[b]);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    edges.push([best.a, best.b]);
    inTree.push(best.b);
    remaining.delete(best.b);
  }
  const hasEdge = (a, b) => edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  for (let i = 0; i < rooms.length; i++) {
    if (!rng.chance(0.25)) continue;
    const nearest = rooms
      .map((r, j) => ({ j, d: dist2(rooms[i], r) }))
      .filter((e) => e.j !== i && !hasEdge(i, e.j))
      .sort((p, q) => p.d - q.d)
      .slice(0, 3);
    if (nearest.length) edges.push([i, rng.pick(nearest).j]);
  }

  const carveWide = (x, y) => {
    carve(x, y);
    carve(x + 1, y);
    carve(x, y + 1);
    carve(x + 1, y + 1);
  };
  const corridors = [];
  for (const [ai, bi] of edges) {
    const a = rooms[ai];
    const b = rooms[bi];
    const horizontalFirst = rng.chance(0.5);
    const path = [];
    let x = a.cx;
    let y = a.cy;
    const stepTo = (tx, ty) => {
      while (x !== tx) {
        x += Math.sign(tx - x);
        path.push([x, y]);
      }
      while (y !== ty) {
        y += Math.sign(ty - y);
        path.push([x, y]);
      }
    };
    if (horizontalFirst) {
      stepTo(b.cx, a.cy);
      stepTo(b.cx, b.cy);
    } else {
      stepTo(a.cx, b.cy);
      stepTo(b.cx, b.cy);
    }
    for (const [px, py] of path) carveWide(px, py);
    corridors.push(path);
  }

  // --- Pillars in large rooms (never on the centre lines corridors use) ---
  const pillars = [];
  for (const r of rooms) {
    if (r.w < 9 || r.h < 9) continue;
    for (const [px, py] of [
      [r.x + 2, r.y + 2],
      [r.x + r.w - 3, r.y + 2],
      [r.x + 2, r.y + r.h - 3],
      [r.x + r.w - 3, r.y + r.h - 3],
    ]) {
      tiles[idx(px, py)] = WALL;
      pillars.push([px, py]);
    }
  }

  // --- Walking distances from the start room ------------------------------
  const start = rooms[0];
  const distField = bfs(tiles, W, H, start.cx, start.cy);
  // Safety net: if a pillar somehow sealed a pocket, remove pillars.
  const unreachable = rooms.some((r) => distField[idx(r.cx, r.cy)] < 0);
  if (unreachable) {
    for (const [px, py] of pillars) tiles[idx(px, py)] = FLOOR;
    pillars.length = 0;
  }
  const field = unreachable ? bfs(tiles, W, H, start.cx, start.cy) : distField;

  // --- Room roles ---------------------------------------------------------
  start.role = 'start';
  let stairsRoom = rooms[1];
  for (const r of rooms.slice(1)) {
    if (field[idx(r.cx, r.cy)] > field[idx(stairsRoom.cx, stairsRoom.cy)]) stairsRoom = r;
  }
  stairsRoom.role = boss ? 'boss' : 'stairs';
  const others = rng.shuffle(rooms.filter((r) => r.role === 'combat'));
  if (others.length) others[0].role = 'treasure';
  if (others.length > 3 && rng.chance(0.6)) others[1].role = 'shrine';
  if (others.length > 6 && rng.chance(0.5)) others[2].role = 'treasure';

  // --- Spawns, items, torches --------------------------------------------
  const pool = ENEMY_POOL.filter((e) => e.minDepth <= depth).map((e) => ({ weight: e.weight, value: e.type }));
  const spawns = [];
  const usedTiles = new Set();
  const randomTileIn = (r, margin = 1) => {
    for (let i = 0; i < 30; i++) {
      const x = rng.int(r.x + margin, r.x + r.w - 1 - margin);
      const y = rng.int(r.y + margin, r.y + r.h - 1 - margin);
      const k = idx(x, y);
      if (tiles[k] === FLOOR && !usedTiles.has(k)) {
        usedTiles.add(k);
        return { x, y };
      }
    }
    return null;
  };

  usedTiles.add(idx(stairsRoom.cx, stairsRoom.cy));
  const items = [];
  for (const r of rooms) {
    if (r.role === 'start') continue;
    if (r.role === 'boss') {
      const by = Math.max(r.y + 1, r.cy - 3);
      const pos = tiles[idx(r.cx, by)] === FLOOR ? { x: r.cx, y: by } : randomTileIn(r) || { x: r.cx, y: r.cy + 1 };
      spawns.push({ type: 'boss', x: pos.x, y: pos.y });
      continue;
    }
    const base = r.role === "shrine" ? 0 : rng.int(1, 3) + Math.floor(depth / 2);
    const area = (r.w * r.h) / 60;
    const count = Math.round(base * Math.min(1.6, Math.max(0.7, area)));
    for (let i = 0; i < count; i++) {
      const t = randomTileIn(r);
      if (t) spawns.push({ type: rng.weighted(pool), x: t.x, y: t.y, elite: depth >= 3 && rng.chance(0.06 + depth * 0.01) });
    }
    if (r.role === 'treasure') items.push({ kind: 'chest', x: r.cx, y: r.cy });
    if (r.role === 'shrine') items.push({ kind: 'shrine', x: r.cx, y: r.cy });
    if (r.role === 'combat' && rng.chance(0.25)) {
      const t = randomTileIn(r);
      if (t) items.push({ kind: 'potion', x: t.x, y: t.y });
    }
  }

  const torches = [];
  for (const r of rooms) {
    const corners = [
      [r.x, r.y],
      [r.x + r.w - 1, r.y],
      [r.x, r.y + r.h - 1],
      [r.x + r.w - 1, r.y + r.h - 1],
    ];
    for (const [x, y] of corners) if (tiles[idx(x, y)] === FLOOR && rng.chance(0.8)) torches.push({ x, y });
  }

  return {
    seed,
    depth,
    width: W,
    height: H,
    tiles,
    rooms,
    corridors,
    start: { x: start.cx, y: start.cy },
    stairs: { x: stairsRoom.cx, y: stairsRoom.cy },
    boss,
    spawns,
    items,
    torches,
  };
}

// Breadth-first walking distance from (sx, sy). -1 = unreachable.
export function bfs(tiles, W, H, sx, sy) {
  const dist = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const s = sy * W + sx;
  if (tiles[s] === WALL) return dist;
  dist[s] = 0;
  queue[tail++] = s;
  while (head < tail) {
    const c = queue[head++];
    const cx = c % W;
    const cy = (c / W) | 0;
    const nd = dist[c] + 1;
    if (cx > 0 && tiles[c - 1] !== WALL && dist[c - 1] < 0) (dist[c - 1] = nd), (queue[tail++] = c - 1);
    if (cx < W - 1 && tiles[c + 1] !== WALL && dist[c + 1] < 0) (dist[c + 1] = nd), (queue[tail++] = c + 1);
    if (cy > 0 && tiles[c - W] !== WALL && dist[c - W] < 0) (dist[c - W] = nd), (queue[tail++] = c - W);
    if (cy < H - 1 && tiles[c + W] !== WALL && dist[c + W] < 0) (dist[c + W] = nd), (queue[tail++] = c + W);
  }
  return dist;
}
