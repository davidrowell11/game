// Turns a generated dungeon grid into 3D geometry and offers spatial queries
// (collision, line of sight, path-finding flow fields, fog of war).
import * as THREE from 'three';
import { WALL } from './dungeon.js';
import { brickTexture, floorTexture, glowTexture } from './textures.js';

export const T = 2; // world units per tile
export const WALL_H = 2.4;

const THEMES = [
  { name: 'Forgotten Crypt', wall: 0x9a9fae, top: 0x3a3e48, floor: 0x77736c, bg: 0x050608, torch: 0xffa04a, hemi: [0x3a4a6a, 0x120c08] },
  { name: 'Mossy Catacombs', wall: 0x84987a, top: 0x2e3a28, floor: 0x5f6a52, bg: 0x040805, torch: 0xd8ff7a, hemi: [0x2e4a36, 0x0a0c06] },
  { name: 'Ember Halls', wall: 0xa87766, top: 0x442820, floor: 0x5e4038, bg: 0x0a0403, torch: 0xff6a2a, hemi: [0x5a3026, 0x100604] },
  { name: 'Frozen Vault', wall: 0xa6c4d8, top: 0x2e4252, floor: 0x6c8292, bg: 0x04070b, torch: 0x7ad8ff, hemi: [0x2e4c6c, 0x060a10] },
];

export function themeFor(depth) {
  return THEMES[Math.floor((depth - 1) / 4) % THEMES.length];
}

export const tileCenter = (x, y) => ({ x: x * T + T / 2, z: y * T + T / 2 });

let sharedTex = null;
function textures() {
  if (!sharedTex) sharedTex = { brick: brickTexture(), floor: floorTexture(), glow: glowTexture() };
  return sharedTex;
}

export class World {
  constructor(scene, dungeon) {
    this.scene = scene;
    this.d = dungeon;
    this.W = dungeon.width;
    this.H = dungeon.height;
    this.tiles = dungeon.tiles;
    this.theme = themeFor(dungeon.depth);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.explored = new Uint8Array(this.W * this.H);
    this.flow = new Int32Array(this.W * this.H);
    this._queue = new Int32Array(this.W * this.H);
    this.disposables = [];
    this._build();
  }

  // ---- grid queries ------------------------------------------------------
  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return WALL;
    return this.tiles[y * this.W + x];
  }
  walkable(x, y) {
    return this.tile(x, y) !== WALL;
  }
  solidAt(wx, wz) {
    return !this.walkable(Math.floor(wx / T), Math.floor(wz / T));
  }
  toTile(wx, wz) {
    return [Math.floor(wx / T), Math.floor(wz / T)];
  }

  // Moves a circle through the grid, sliding along walls. Returns true on a wall hit.
  moveCircle(pos, dx, dz, r) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
    let hit = false;
    for (let i = 0; i < steps; i++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      if (this._resolve(pos, r)) hit = true;
    }
    return hit;
  }

  _resolve(pos, r) {
    let hit = false;
    const x0 = Math.floor((pos.x - r) / T);
    const x1 = Math.floor((pos.x + r) / T);
    const y0 = Math.floor((pos.z - r) / T);
    const y1 = Math.floor((pos.z + r) / T);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.walkable(x, y)) continue;
        const bx0 = x * T;
        const bz0 = y * T;
        const cx = Math.min(Math.max(pos.x, bx0), bx0 + T);
        const cz = Math.min(Math.max(pos.z, bz0), bz0 + T);
        const ox = pos.x - cx;
        const oz = pos.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          pos.x += (ox / d) * (r - d);
          pos.z += (oz / d) * (r - d);
        } else {
          // centre inside the block: push out along the shallowest axis
          const left = pos.x - bx0;
          const right = bx0 + T - pos.x;
          const top = pos.z - bz0;
          const bottom = bz0 + T - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = bx0 - r;
          else if (m === right) pos.x = bx0 + T + r;
          else if (m === top) pos.z = bz0 - r;
          else pos.z = bz0 + T + r;
        }
      }
    }
    return hit;
  }

  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.35);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  // Breadth-first distance field from the player; enemies walk downhill on it.
  computeFlow(wx, wz) {
    const [sx, sy] = this.toTile(wx, wz);
    const { W, H, tiles, flow } = this;
    const q = this._queue;
    flow.fill(-1);
    if (!this.walkable(sx, sy)) return;
    let head = 0;
    let tail = 0;
    const s = sy * W + sx;
    flow[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const c = q[head++];
      const cx = c % W;
      const cy = (c / W) | 0;
      const nd = flow[c] + 1;
      if (nd > 60) continue;
      if (cx > 0 && tiles[c - 1] !== WALL && flow[c - 1] < 0) (flow[c - 1] = nd), (q[tail++] = c - 1);
      if (cx < W - 1 && tiles[c + 1] !== WALL && flow[c + 1] < 0) (flow[c + 1] = nd), (q[tail++] = c + 1);
      if (cy > 0 && tiles[c - W] !== WALL && flow[c - W] < 0) (flow[c - W] = nd), (q[tail++] = c - W);
      if (cy < H - 1 && tiles[c + W] !== WALL && flow[c + W] < 0) (flow[c + W] = nd), (q[tail++] = c + W);
    }
  }

  // Returns a world-space point to walk toward, following the flow field.
  flowTarget(wx, wz) {
    const [tx, ty] = this.toTile(wx, wz);
    const { W, flow } = this;
    const here = this.walkable(tx, ty) ? flow[ty * W + tx] : -1;
    let best = null;
    let bestD = here < 0 ? Infinity : here;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox;
        const ny = ty + oy;
        if (!this.walkable(nx, ny)) continue;
        if (ox && oy && (!this.walkable(tx + ox, ty) || !this.walkable(tx, ty + oy))) continue; // no corner cutting
        const d = flow[ny * W + nx];
        if (d >= 0 && d < bestD) {
          bestD = d;
          best = tileCenter(nx, ny);
        }
      }
    }
    return best;
  }

  reveal(wx, wz, radius = 9) {
    const [px, py] = this.toTile(wx, wz);
    let changed = false;
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const k = y * this.W + x;
        if (this.explored[k]) continue;
        if ((x - px) ** 2 + (y - py) ** 2 > radius * radius) continue;
        if (this.tiles[k] === WALL) continue;
        const c = tileCenter(x, y);
        if (this.lineOfSight(wx, wz, c.x, c.z)) {
          this.explored[k] = 1;
          changed = true;
        }
      }
    }
    return changed;
  }

  // ---- geometry ----------------------------------------------------------
  _build() {
    const { W, H, tiles, theme } = this;
    const tex = textures();
    const isWallFace = (x, y) => {
      if (tiles[y * W + x] !== WALL) return false;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) if (this.walkable(x + ox, y + oy) && !(ox === 0 && oy === 0)) return true;
      return false;
    };

    const wallCells = [];
    const floorCells = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (tiles[y * W + x] !== WALL) floorCells.push([x, y]);
        else if (isWallFace(x, y)) wallCells.push([x, y]);
      }
    }

    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();

    // Walls
    const wallGeo = new THREE.BoxGeometry(T, WALL_H, T);
    const side = new THREE.MeshStandardMaterial({ map: tex.brick, color: theme.wall, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ color: theme.top, roughness: 1 });
    const walls = new THREE.InstancedMesh(wallGeo, [side, side, top, top, side, side], wallCells.length);
    wallCells.forEach(([x, y], i) => {
      const c = tileCenter(x, y);
      m4.makeTranslation(c.x, WALL_H / 2, c.z);
      walls.setMatrixAt(i, m4);
      const v = 0.85 + ((x * 31 + y * 17) % 7) / 40;
      walls.setColorAt(i, col.setScalar(v));
    });
    walls.receiveShadow = true;
    this.group.add(walls);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(T, T);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ map: tex.floor, color: theme.floor, roughness: 0.95 });
    const floor = new THREE.InstancedMesh(floorGeo, floorMat, floorCells.length);
    floorCells.forEach(([x, y], i) => {
      const c = tileCenter(x, y);
      m4.makeTranslation(c.x, 0, c.z);
      floor.setMatrixAt(i, m4);
      const v = 0.8 + ((x * 13 + y * 29) % 9) / 30;
      floor.setColorAt(i, col.setScalar(v));
    });
    floor.receiveShadow = true;
    this.group.add(floor);

    this.disposables.push(wallGeo, side, top, floorGeo, floorMat);

    // Torches (braziers) with a small pool of real lights assigned to the nearest ones.
    const baseGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.9, 8);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3330, metalness: 0.6, roughness: 0.5 });
    const flameGeo = new THREE.ConeGeometry(0.18, 0.45, 6);
    const flameMat = new THREE.MeshBasicMaterial({ color: theme.torch });
    const glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: theme.torch, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.disposables.push(baseGeo, baseMat, flameGeo, flameMat, glowMat);
    this.torches = this.d.torches.map((t, i) => {
      const c = tileCenter(t.x, t.y);
      // nudge toward the room corner so it hugs the wall
      const nx = this.walkable(t.x - 1, t.y) ? 0.35 : -0.35;
      const nz = this.walkable(t.x, t.y - 1) ? 0.35 : -0.35;
      const g = new THREE.Group();
      g.position.set(c.x + nx * 1.2, 0, c.z + nz * 1.2);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.45;
      base.castShadow = true;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 1.1;
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.6);
      glow.position.y = 1.1;
      g.add(base, flame, glow);
      this.group.add(g);
      return { group: g, flame, phase: i * 1.7 };
    });

    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(theme.torch, 0, 16, 1.4);
      l.position.y = 1.6;
      this.group.add(l);
      this.lights.push(l);
    }
  }

  update(dt, time, px, pz) {
    for (const t of this.torches) {
      const s = 1 + Math.sin(time * 9 + t.phase) * 0.12 + Math.sin(time * 23 + t.phase) * 0.06;
      t.flame.scale.set(1, s, 1);
      t._d = (t.group.position.x - px) ** 2 + (t.group.position.z - pz) ** 2;
    }
    const near = this.torches.slice().sort((a, b) => a._d - b._d);
    this.lights.forEach((l, i) => {
      const t = near[i];
      if (!t || t._d > 26 * 26) {
        l.intensity = 0;
        return;
      }
      l.position.x = t.group.position.x;
      l.position.z = t.group.position.z;
      l.intensity = 14 * (0.85 + Math.sin(time * 11 + t.phase) * 0.1 + Math.sin(time * 27 + t.phase) * 0.05);
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
