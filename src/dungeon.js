// Procedural dungeon generator.
// Rooms are scattered without overlap and given a shape (rectangle, round
// chamber, cross or organic cavern), then joined with a minimum spanning tree
// (so every room is reachable) plus a few extra corridors to create loops.
// The room farthest from the start (by walking distance) holds the stairs,
// and every BOSS_EVERY floors the largest far room becomes a boss arena.

import { RNG } from './rng.js';

export const WALL = 0;
export const FLOOR = 1;
export const BOSS_EVERY = 4;
export const FINAL_DEPTH = 12;

export const ENEMY_POOL = [
  { type: 'husk', minDepth: 1, weight: 10 },
  { type: 'spitter', minDepth: 1, weight: 5 },
  { type: 'brute', minDepth: 2, weight: 3 },
  { type: 'bloater', minDepth: 2, weight: 3 },
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
    const w = big ? rng.int(13, 15) : rng.int(5, 12);
    const h = big ? rng.int(13, 15) : rng.int(5, 12);
    const x = rng.int(2, W - w - 3);
    const y = rng.int(2, H - h - 3);
    const overlaps = rooms.some((o) => x - 2 < o.x + o.w && x + w + 2 > o.x && y - 2 < o.y + o.h && y + h + 2 > o.y);
    if (overlaps) continue;
    let shape = 'rect';
    if (rooms.length > 0 && !big && w >= 7 && h >= 7) {
      shape = rng.weighted([
        { weight: 5, value: 'rect' },
        { weight: 2, value: 'round' },
        { weight: 2, value: 'cross' },
        { weight: 3, value: 'cavern' },
      ]);
    }
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), role: 'combat', shape });
  }
  for (const r of rooms) carveRoom(r);

  function carveRoom(r) {
    const { x, y, w, h, cx, cy } = r;
    if (r.shape === 'rect') {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) carve(xx, yy);
    } else if (r.shape === 'round') {
      const rx = w / 2;
      const ry = h / 2;
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const nx = (xx + 0.5 - (x + rx)) / rx;
          const ny = (yy + 0.5 - (y + ry)) / ry;
          if (nx * nx + ny * ny <= 1.05) carve(xx, yy);
        }
    } else if (r.shape === 'cross') {
      const bw = Math.max(3, Math.round(w * 0.45));
      const bh = Math.max(3, Math.round(h * 0.45));
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          if (Math.abs(xx - cx) <= bw / 2 || Math.abs(yy - cy) <= bh / 2) carve(xx, yy);
        }
    } else {
      // Cavern: cellular automata smoothing, then keep only the pocket
      // connected to the centre so there are never sealed-off areas.
      let g = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) g[i] = rng.chance(0.58) ? 1 : 0;
      const at = (a, xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : a[yy * w + xx]);
      for (let it = 0; it < 4; it++) {
        const n = new Uint8Array(w * h);
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            let c = 0;
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) c += at(g, xx + i, yy + j);
            n[yy * w + xx] = c >= 5 ? 1 : 0;
          }
        g = n;
      }
      const lcx = cx - x;
      const lcy = cy - y;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) g[(lcy + j) * w + lcx + i] = 1;
      const keep = new Uint8Array(w * h);
      const stack = [lcy * w + lcx];
      keep[stack[0]] = 1;
      while (stack.length) {
        const c = stack.pop();
        const xx = c % w;
        const yy = (c / w) | 0;
        for (const [nx, ny] of [
          [xx + 1, yy],
          [xx - 1, yy],
          [xx, yy + 1],
          [xx, yy - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (g[k] && !keep[k]) {
            keep[k] = 1;
            stack.push(k);
          }
        }
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (keep[yy * w + xx]) carve(x + xx, y + yy);
    }
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
  const corridorTiles = new Set();
  for (const [ai, bi] of edges) {
    const a = rooms[ai];
    const b = rooms[bi];
    const horizontalFirst = rng.chance(0.5);
    let x = a.cx;
    let y = a.cy;
    const stepTo = (tx, ty) => {
      while (x !== tx) {
        x += Math.sign(tx - x);
        carveWide(x, y);
        corridorTiles.add(idx(x, y));
      }
      while (y !== ty) {
        y += Math.sign(ty - y);
        carveWide(x, y);
        corridorTiles.add(idx(x, y));
      }
    };
    if (horizontalFirst) {
      stepTo(b.cx, a.cy);
      stepTo(b.cx, b.cy);
    } else {
      stepTo(a.cx, b.cy);
      stepTo(b.cx, b.cy);
    }
  }

  // --- Room roles ---------------------------------------------------------
  const start = rooms[0];
  start.role = 'start';
  const field0 = bfs(tiles, W, H, start.cx, start.cy);
  const far = (r) => field0[idx(r.cx, r.cy)];
  let candidates = rooms.slice(1);
  if (boss) {
    const arenas = candidates.filter((r) => r.w >= 11 && r.h >= 11);
    if (arenas.length) candidates = arenas;
  }
  let stairsRoom = candidates[0];
  for (const r of candidates) if (far(r) > far(stairsRoom)) stairsRoom = r;
  stairsRoom.role = boss ? 'boss' : 'stairs';
  if (boss && stairsRoom.shape !== 'rect') {
    stairsRoom.shape = 'rect';
    carveRoom(stairsRoom); // only adds floor, so connectivity is preserved
  }
  const others = rng.shuffle(rooms.filter((r) => r.role === 'combat'));
  if (others.length) others[0].role = 'treasure';
  if (others.length > 3 && rng.chance(0.6)) others[1].role = 'shrine';
  if (others.length > 4 && depth >= 2 && rng.chance(0.55)) others[2].role = 'merchant';
  if (others.length > 6 && rng.chance(0.5)) others[3].role = 'treasure';

  // --- Pillars in large rectangular rooms (never on corridor centre lines) --
  for (const r of rooms) {
    if (r.shape !== 'rect' || r.w < 9 || r.h < 9) continue;
    for (const [px, py] of [
      [r.x + 2, r.y + 2],
      [r.x + r.w - 3, r.y + 2],
      [r.x + 2, r.y + r.h - 3],
      [r.x + r.w - 3, r.y + r.h - 3],
    ]) {
      if (corridorTiles.has(idx(px, py))) continue;
      tiles[idx(px, py)] = WALL;
      if (bfs(tiles, W, H, start.cx, start.cy).some((d, i) => tiles[i] === FLOOR && d < 0)) tiles[idx(px, py)] = FLOOR;
    }
  }

  // --- Spawns, items, decoration -----------------------------------------
  const pool = ENEMY_POOL.filter((e) => e.minDepth <= depth).map((e) => ({ weight: e.weight, value: e.type }));
  const spawns = [];
  const items = [];
  const usedTiles = new Set();
  const roomFloor = (r) => {
    const out = [];
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) if (tiles[idx(xx, yy)] === FLOOR) out.push({ x: xx, y: yy });
    return out;
  };
  const nearWall = (t) => tiles[idx(t.x + 1, t.y)] === WALL || tiles[idx(t.x - 1, t.y)] === WALL || tiles[idx(t.x, t.y + 1)] === WALL || tiles[idx(t.x, t.y - 1)] === WALL;
  const take = (t) => {
    const k = idx(t.x, t.y);
    if (usedTiles.has(k)) return false;
    usedTiles.add(k);
    return true;
  };
  const randomTileIn = (r, filter = () => true) => {
    const tilesIn = roomFloor(r).filter((t) => !usedTiles.has(idx(t.x, t.y)) && filter(t));
    if (!tilesIn.length) return null;
    const t = rng.pick(tilesIn);
    take(t);
    return t;
  };
  const awayFromCenter = (r) => (t) => Math.abs(t.x - r.cx) + Math.abs(t.y - r.cy) > 1;

  for (const r of rooms) take({ x: r.cx, y: r.cy });

  // Torches: the floor tile nearest each bounding-box corner that touches a wall.
  const torches = [];
  for (const r of rooms) {
    const edge = roomFloor(r).filter(nearWall);
    for (const [kx, ky] of [
      [r.x, r.y],
      [r.x + r.w - 1, r.y],
      [r.x, r.y + r.h - 1],
      [r.x + r.w - 1, r.y + r.h - 1],
    ]) {
      if (!edge.length || !rng.chance(0.8)) continue;
      let best = edge[0];
      for (const t of edge) if ((t.x - kx) ** 2 + (t.y - ky) ** 2 < (best.x - kx) ** 2 + (best.y - ky) ** 2) best = t;
      if (!torches.some((t) => t.x === best.x && t.y === best.y)) {
        torches.push(best);
        take(best);
      }
    }
  }


  const traps = [];
  const urns = [];
  const decor = [];
  for (const r of rooms) {
    if (r.role === 'boss') {
      const by = Math.max(r.y + 1, r.cy - 3);
      const pos = tiles[idx(r.cx, by)] === FLOOR ? { x: r.cx, y: by } : randomTileIn(r) || { x: r.cx, y: r.cy + 1 };
      spawns.push({ type: 'boss', x: pos.x, y: pos.y });
      continue;
    }
    if (r.role !== 'start') {
      const peaceful = r.role === 'shrine' || r.role === 'merchant';
      const base = peaceful ? 0 : rng.int(1, 3) + Math.floor(depth / 2);
      const area = (r.w * r.h) / 60;
      const count = Math.round(base * Math.min(1.6, Math.max(0.7, area)));
      for (let i = 0; i < count; i++) {
        const t = randomTileIn(r, awayFromCenter(r));
        if (t) spawns.push({ type: rng.weighted(pool), x: t.x, y: t.y, elite: depth >= 3 && rng.chance(0.06 + depth * 0.01) });
      }
      if (r.role === 'treasure') items.push({ kind: 'chest', x: r.cx, y: r.cy });
      if (r.role === 'shrine') items.push({ kind: 'shrine', x: r.cx, y: r.cy });
      if (r.role === 'merchant') items.push({ kind: 'merchant', x: r.cx, y: r.cy });
      if (r.role === 'combat' && rng.chance(0.2)) {
        const t = randomTileIn(r);
        if (t) items.push({ kind: 'potion', x: t.x, y: t.y });
      }
      // spike traps: a short strip across part of the room
      if (r.role === 'combat' && depth >= 2 && rng.chance(0.35)) {
        const horizontal = rng.chance(0.5);
        const len = rng.int(2, 4);
        const sx = horizontal ? rng.int(r.x + 1, Math.max(r.x + 1, r.x + r.w - 1 - len)) : rng.int(r.x + 1, r.x + r.w - 2);
        const sy = horizontal ? rng.int(r.y + 1, r.y + r.h - 2) : rng.int(r.y + 1, Math.max(r.y + 1, r.y + r.h - 1 - len));
        const phase = rng.next();
        for (let i = 0; i < len; i++) {
          const t = { x: sx + (horizontal ? i : 0), y: sy + (horizontal ? 0 : i) };
          if (tiles[idx(t.x, t.y)] === FLOOR && take(t)) traps.push({ ...t, phase });
        }
      }
    }
    // breakable urns hug the walls; scattered bones and rubble add texture
    const urnCount = r.role === 'start' ? 0 : rng.int(0, 3);
    for (let i = 0; i < urnCount; i++) {
      const t = randomTileIn(r, nearWall);
      if (t) urns.push(t);
    }
    const decorCount = rng.int(1, 4);
    for (let i = 0; i < decorCount; i++) {
      const t = roomFloor(r).filter((q) => !usedTiles.has(idx(q.x, q.y)));
      if (t.length) {
        const q = rng.pick(t);
        decor.push({ x: q.x, y: q.y, kind: rng.pick(['bones', 'rubble', 'rubble', 'skull']), ox: rng.range(-0.6, 0.6), oy: rng.range(-0.6, 0.6), rot: rng.range(0, Math.PI * 2) });
      }
    }
  }

  return {
    seed,
    depth,
    width: W,
    height: H,
    tiles,
    rooms,
    start: { x: start.cx, y: start.cy },
    stairs: { x: stairsRoom.cx, y: stairsRoom.cy },
    boss,
    spawns,
    items,
    torches,
    traps,
    urns,
    decor,
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
