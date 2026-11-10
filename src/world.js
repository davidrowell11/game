// Turns a generated dungeon grid into 3D geometry and offers spatial queries
// (collision, line of sight, path-finding flow fields, fog of war).
//
// Rendering notes
// - The floor is ONE subdivided plane whose vertex colours carry baked
//   ambient occlusion (darkening where floor meets wall). Vertex colours
//   multiply the albedo, so the darkening holds under every light, unlike
//   three.js aoMap which only affects ambient light.
// - Walls are a single InstancedMesh with a vertical vertex-colour gradient
//   (dark at the foot) for contact shading.
// - Lighting uses a FIXED pool of point lights that are re-assigned each frame
//   to the nearest "emitters" (torches, portals, shrines, the boss...). The
//   number of lights in the scene therefore never changes, which matters:
//   three.js recompiles every shader when the light count changes.
import * as THREE from 'three';
import { WALL } from './dungeon.js';
import { brickTextures, floorTextures, glowTexture } from './textures.js';

export const T = 2; // world units per tile
export const WALL_H = 2.4;
export const LIGHT_POOL = 8;

const THEMES = [
  { name: 'Forgotten Crypt', wall: 0xa4a8b4, top: 0x4a4e5a, floor: 0x8a857c, bg: 0x07080b, torch: 0xff9a40, hemi: [0x4a5a7a, 0x140e0a], dust: 0xffd8a8 },
  { name: 'Mossy Catacombs', wall: 0x8ea284, top: 0x2e3a28, floor: 0x6c7860, bg: 0x050906, torch: 0xd8ff7a, hemi: [0x3a5a42, 0x0c0e08], dust: 0xd8ffb0 },
  { name: 'Ember Halls', wall: 0xb07e6c, top: 0x46281e, floor: 0x6c4a40, bg: 0x0c0504, torch: 0xff6a2a, hemi: [0x6a3a2c, 0x120604], dust: 0xffa060 },
  { name: 'Frozen Vault', wall: 0xb0cce0, top: 0x2e4252, floor: 0x7a92a4, bg: 0x05080d, torch: 0x7ad8ff, hemi: [0x3a5c7c, 0x080c12], dust: 0xc8ecff },
];

export function themeFor(depth) {
  return THEMES[Math.floor((depth - 1) / 4) % THEMES.length];
}

export const tileCenter = (x, y) => ({ x: x * T + T / 2, z: y * T + T / 2 });

let sharedTex = null;
function textures() {
  if (!sharedTex) {
    const brick = brickTextures();
    const floor = floorTextures();
    sharedTex = { brick, floor, glow: glowTexture() };
  }
  return sharedTex;
}

// Dispose every geometry/material/texture under `root` that is not marked
// as shared (cached resources set userData.shared = true).
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData.shared) continue;
      for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) if (m[k] && !m[k].userData.shared) m[k].dispose();
      m.dispose();
    }
  });
}

export class World {
  constructor(scene, dungeon, { quality = 'medium' } = {}) {
    this.scene = scene;
    this.d = dungeon;
    this.W = dungeon.width;
    this.H = dungeon.height;
    this.tiles = dungeon.tiles;
    this.theme = themeFor(dungeon.depth);
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.explored = new Uint8Array(this.W * this.H);
    this.flow = new Int32Array(this.W * this.H);
    this._queue = new Int32Array(this.W * this.H);
    this.emitters = new Set();
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

  // Moves a circle through the grid, sliding along walls. Sub-steps so a fast
  // mover never advances more than half its radius per step (no tunnelling).
  // Returns true on a wall hit.
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

  // Exact grid traversal (Amanatides & Woo, 1987). Visits every tile the
  // segment passes through, so unlike fixed-step sampling it can never slip
  // diagonally between two walls that only touch at a corner.
  lineOfSight(ax, az, bx, bz) {
    let x = Math.floor(ax / T);
    let y = Math.floor(az / T);
    const ex = Math.floor(bx / T);
    const ey = Math.floor(bz / T);
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(T / dx) : Infinity;
    const tDeltaY = dz !== 0 ? Math.abs(T / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((stepX > 0 ? (x + 1) * T - ax : ax - x * T) / Math.abs(dx)) : Infinity;
    let tMaxY = dz !== 0 ? ((stepY > 0 ? (y + 1) * T - az : az - y * T) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 512; guard++) {
      if (x === ex && y === ey) return true;
      if (tMaxX < tMaxY) {
        tMaxX += tDeltaX;
        x += stepX;
      } else if (tMaxY < tMaxX) {
        tMaxY += tDeltaY;
        y += stepY;
      } else {
        // passing exactly through a corner: blocked if either side is solid
        if (!this.walkable(x + stepX, y) || !this.walkable(x, y + stepY)) return false;
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
        x += stepX;
        y += stepY;
      }
      if (tMaxX > 1 && tMaxY > 1 && !(x === ex && y === ey)) {
        // numerical safety: we've passed the end point
        return this.walkable(x, y);
      }
      if (!this.walkable(x, y)) return false;
    }
    return true;
  }

  // Breadth-first distance field from the player; enemies walk downhill on it.
  // Bounded to 80 steps: enemies further away than that are not chasing.
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
      if (nd > 80) continue;
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

  // ---- light emitters ----------------------------------------------------
  // An emitter is { x, y, z, color, intensity, distance, flicker, follow? }.
  // Mutate it freely; the pool picks it up next frame.
  addEmitter(e) {
    const em = { y: 1.6, distance: 12, flicker: 0, phase: Math.random() * 10, ...e, color: new THREE.Color(e.color) };
    this.emitters.add(em);
    return em;
  }
  removeEmitter(e) {
    this.emitters.delete(e);
  }

  // ---- geometry ----------------------------------------------------------
  _build() {
    const { W, H, tiles, theme } = this;
    const tex = textures();
    const isWallFace = (x, y) => {
      if (tiles[y * W + x] !== WALL) return false;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && this.walkable(x + ox, y + oy)) return true;
      return false;
    };
    const wallCells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWallFace(x, y)) wallCells.push([x, y]);

    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();

    // ---- Walls: instanced boxes with a vertical AO gradient
    const wallGeo = new THREE.BoxGeometry(T, WALL_H, T);
    const pos = wallGeo.attributes.position;
    const vcol = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = pos.getY(i) < 0 ? 0.42 : 1.0;
      vcol.set([k, k, k], i * 3);
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
    const side = new THREE.MeshStandardMaterial({ map: tex.brick.map, normalMap: tex.brick.normal, normalScale: new THREE.Vector2(1.4, 1.4), color: theme.wall, roughness: 0.88, vertexColors: true });
    const top = new THREE.MeshStandardMaterial({ map: tex.floor.map, color: new THREE.Color(theme.top).multiplyScalar(1.6), emissive: theme.top, emissiveIntensity: 0.55, emissiveMap: tex.floor.map, roughness: 1 });
    const walls = new THREE.InstancedMesh(wallGeo, [side, side, top, top, side, side], wallCells.length);
    wallCells.forEach(([x, y], i) => {
      const c = tileCenter(x, y);
      m4.makeTranslation(c.x, WALL_H / 2, c.z);
      walls.setMatrixAt(i, m4);
      walls.setColorAt(i, col.setScalar(0.85 + (((x * 31 + y * 17) % 7) / 40)));
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    walls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(walls);
    this.walls = walls;
    this.wallCells = wallCells;
    this.wallIndex = new Map(wallCells.map(([x, y], i) => [y * W + x, i]));
    this.wallH = new Float32Array(wallCells.length).fill(1);
    this.loweredWalls = new Set();

    // ---- Floor: one plane, 2 vertices per tile edge, baked AO in vertex colours
    const SUB = 2;
    const floorGeo = new THREE.PlaneGeometry(W * T, H * T, W * SUB, H * SUB);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate((W * T) / 2, 0, (H * T) / 2);
    const fpos = floorGeo.attributes.position;
    const fcol = new Float32Array(fpos.count * 3);
    for (let i = 0; i < fpos.count; i++) {
      const wx = fpos.getX(i);
      const wz = fpos.getZ(i);
      // occlusion: sum of wall proximity within ~1 tile
      let occ = 0;
      const tx0 = Math.floor(wx / T) - 1;
      const ty0 = Math.floor(wz / T) - 1;
      for (let ty = ty0; ty <= ty0 + 2; ty++)
        for (let tx = tx0; tx <= tx0 + 2; tx++) {
          if (this.walkable(tx, ty)) continue;
          const cx = Math.min(Math.max(wx, tx * T), tx * T + T);
          const cz = Math.min(Math.max(wz, ty * T), ty * T + T);
          const d = Math.hypot(wx - cx, wz - cz) / T;
          occ += Math.max(0, 1 - d * 1.6);
        }
      // gentle per-tile tint variation so the floor isn't uniform
      const tint = 0.9 + (((Math.floor(wx / T) * 13 + Math.floor(wz / T) * 29) % 9) / 45);
      const ao = Math.max(0.32, 1 - occ * 0.32) * tint;
      fcol.set([ao, ao, ao], i * 3);
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    const floorMap = tex.floor.map.clone();
    const floorNormal = tex.floor.normal.clone();
    for (const t of [floorMap, floorNormal]) {
      t.userData = {};
      t.repeat.set(W, H);
      t.needsUpdate = true;
    }
    const floorMat = new THREE.MeshStandardMaterial({ map: floorMap, normalMap: floorNormal, normalScale: new THREE.Vector2(1.2, 1.2), color: theme.floor, roughness: 0.92, vertexColors: true });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- Torches: braziers that register as light emitters
    const baseGeo = new THREE.CylinderGeometry(0.16, 0.26, 0.9, 10);
    const bowlGeo = new THREE.CylinderGeometry(0.34, 0.18, 0.22, 12, 1, true);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2e2a28, metalness: 0.7, roughness: 0.45 });
    const flameGeo = new THREE.ConeGeometry(0.2, 0.55, 8);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.torch).multiplyScalar(2.2) });
    const glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: theme.torch, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    this.torches = this.d.torches.map((t, i) => {
      const c = tileCenter(t.x, t.y);
      const nx = !this.walkable(t.x + 1, t.y) ? 0.42 : !this.walkable(t.x - 1, t.y) ? -0.42 : 0;
      const nz = !this.walkable(t.x, t.y + 1) ? 0.42 : !this.walkable(t.x, t.y - 1) ? -0.42 : 0;
      const g = new THREE.Group();
      g.position.set(c.x + nx, 0, c.z + nz);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.45;
      base.castShadow = true;
      const bowl = new THREE.Mesh(bowlGeo, baseMat);
      bowl.position.y = 0.98;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 1.3;
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(2.2);
      glow.position.y = 1.3;
      g.add(base, bowl, flame, glow);
      this.group.add(g);
      const emitter = this.addEmitter({ x: g.position.x, y: 1.9, z: g.position.z, color: theme.torch, intensity: 16, distance: 15, flicker: 1, phase: i * 1.7 });
      const torch = { group: g, flame, emitter, phase: i * 1.7 };
      emitter.torch = torch;
      return torch;
    });

    this._buildDecor();

    // ---- The light pool (constant size: see header comment)
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 15, 1.5);
      this.group.add(l);
      this.lights.push(l);
    }

    // ---- Atmosphere: embers rising from torches, dust drifting in the air
    this._buildParticles();
  }

  _buildDecor() {
    const byKind = { bones: [], rubble: [], skull: [] };
    for (const d of this.d.decor || []) byKind[d.kind].push(d);
    const defs = {
      bones: [new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.9 })],
      rubble: [new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: this.theme.wall, roughness: 1 })],
      skull: [new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8 })],
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of Object.entries(byKind)) {
      const [geo, mat] = defs[kind];
      if (!list.length) {
        geo.dispose();
        mat.dispose();
        continue;
      }
      const per = kind === 'rubble' ? 3 : kind === 'bones' ? 2 : 1;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length * per);
      let i = 0;
      for (const d of list) {
        const c = tileCenter(d.x, d.y);
        for (let k = 0; k < per; k++) {
          const a = d.rot + k * 1.9;
          const off = kind === 'rubble' ? 0.3 * k : 0;
          v.set(c.x + d.ox + Math.cos(a) * off, kind === 'skull' ? 0.15 : kind === 'bones' ? 0.05 : 0.1, c.z + d.oy + Math.sin(a) * off);
          q.setFromAxisAngle(up, a + (kind === 'bones' ? k * 1.2 : 0));
          const s = kind === 'rubble' ? 0.6 + ((k * 37 + d.x) % 5) / 6 : 1;
          m.compose(v, q, sc.set(s, s * 0.8, s));
          mesh.setMatrixAt(i++, m);
        }
      }
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  _buildParticles() {
    const tex = textures().glow;
    const mk = (n, color, size, opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ map: tex, color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.group.add(pts);
      return pts;
    };
    const nEmbers = this.quality === 'low' ? 0 : 160;
    const nDust = this.quality === 'low' ? 0 : 140;
    this.embers = { pts: mk(Math.max(1, nEmbers), new THREE.Color(this.theme.torch).multiplyScalar(1.6), 0.16, 1), n: nEmbers, p: [] };
    for (let i = 0; i < nEmbers; i++) this.embers.p.push({ x: 0, y: -10, z: 0, vy: 0, life: 0, max: 1, seed: Math.random() * 10 });
    this.dust = { pts: mk(Math.max(1, nDust), this.theme.dust, 0.07, 0.55), n: nDust, p: [] };
    for (let i = 0; i < nDust; i++) this.dust.p.push({ x: (Math.random() - 0.5) * 30, y: Math.random() * 4, z: (Math.random() - 0.5) * 30, s: Math.random() * 10 });
    this._nearTorches = [];
  }

  _updateParticles(dt, time, px, pz) {
    // embers: spawn from the closest lit torches
    const E = this.embers;
    if (E.n) {
      const arr = E.pts.geometry.attributes.position.array;
      for (let i = 0; i < E.n; i++) {
        const p = E.p[i];
        p.life -= dt;
        if (p.life <= 0) {
          const t = this._nearTorches[(Math.random() * this._nearTorches.length) | 0];
          if (t && Math.random() < 0.5) {
            p.x = t.group.position.x + (Math.random() - 0.5) * 0.3;
            p.z = t.group.position.z + (Math.random() - 0.5) * 0.3;
            p.y = 1.3;
            p.vy = 0.6 + Math.random() * 0.9;
            p.life = p.max = 0.8 + Math.random() * 1.4;
          } else p.y = -10;
        } else {
          p.y += p.vy * dt;
          p.x += Math.sin(time * 3 + p.seed) * dt * 0.3;
          p.z += Math.cos(time * 2.3 + p.seed) * dt * 0.3;
        }
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.life > 0 ? p.y : -10;
        arr[i * 3 + 2] = p.z;
      }
      E.pts.geometry.attributes.position.needsUpdate = true;
    }
    // dust: a box of motes that wraps around the viewer
    const D = this.dust;
    if (D.n) {
      const arr = D.pts.geometry.attributes.position.array;
      for (let i = 0; i < D.n; i++) {
        const p = D.p[i];
        p.x += Math.sin(time * 0.3 + p.s) * dt * 0.25;
        p.y += Math.sin(time * 0.5 + p.s * 2) * dt * 0.08;
        p.z += Math.cos(time * 0.27 + p.s) * dt * 0.25;
        const wrap = (v, c) => ((((v - c + 15) % 30) + 30) % 30) - 15 + c;
        p.x = wrap(p.x, px);
        p.z = wrap(p.z, pz);
        if (p.y < 0.1 || p.y > 4) p.y = 0.2 + Math.random() * 3.6;
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      }
      D.pts.geometry.attributes.position.needsUpdate = true;
    }
  }

  // Lower the walls between the camera (which sits south of the player, +z)
  // and the player so the hero is never hidden behind masonry.
  _updateCutaway(dt, px, pz) {
    const [tx, ty] = this.toTile(px, pz);
    const want = this._want || (this._want = new Set());
    want.clear();
    for (let y = ty + 1; y <= ty + 4; y++) {
      for (let x = tx - 3; x <= tx + 3; x++) {
        const i = this.wallIndex.get(y * this.W + x);
        if (i !== undefined) want.add(i);
      }
    }
    for (const i of want) this.loweredWalls.add(i);
    if (!this.loweredWalls.size) return;
    const m = this._cutM || (this._cutM = new THREE.Matrix4());
    const q = this._cutQ || (this._cutQ = new THREE.Quaternion());
    const v = this._cutV || (this._cutV = new THREE.Vector3());
    const sc = this._cutS || (this._cutS = new THREE.Vector3());
    for (const i of this.loweredWalls) {
      const target = want.has(i) ? 0.22 : 1;
      let h = this.wallH[i];
      h += (target - h) * Math.min(1, dt * 10);
      if (Math.abs(h - target) < 0.01) h = target;
      this.wallH[i] = h;
      if (h === 1 && target === 1) this.loweredWalls.delete(i);
      const [x, y] = this.wallCells[i];
      const c = tileCenter(x, y);
      m.compose(v.set(c.x, (WALL_H * h) / 2, c.z), q, sc.set(1, h, 1));
      this.walls.setMatrixAt(i, m);
    }
    this.walls.instanceMatrix.needsUpdate = true;
  }

  update(dt, time, px, pz, cutaway = true) {
    if (cutaway) this._updateCutaway(dt, px, pz);
    for (const t of this.torches) {
      const s = 1 + Math.sin(time * 9 + t.phase) * 0.12 + Math.sin(time * 23 + t.phase) * 0.06;
      t.flame.scale.set(1, s, 1);
    }
    // Assign the light pool to the most relevant emitters near the viewer.
    const R = 30;
    const cand = this._cand || (this._cand = []);
    cand.length = 0;
    for (const e of this.emitters) {
      if (e.follow) {
        e.x = e.follow.position.x;
        e.z = e.follow.position.z;
      }
      if (e.intensity <= 0) continue;
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < R) {
        e._score = d - (e.priority || 0);
        e._d = d;
        cand.push(e);
      }
    }
    cand.sort((a, b) => a._score - b._score);
    this._nearTorches.length = 0;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const e = cand[i];
      if (!e) {
        l.intensity = 0;
        continue;
      }
      if (e.torch) this._nearTorches.push(e.torch);
      const flick = e.flicker ? 0.86 + Math.sin(time * 11 + e.phase) * 0.09 + Math.sin(time * 27 + e.phase) * 0.05 : 1;
      const fade = Math.min(1, (R - e._d) / 6); // fade out at the edge of the pool radius
      l.color.copy(e.color);
      l.distance = e.distance;
      l.position.set(e.x, e.y, e.z);
      l.intensity = e.intensity * flick * fade;
    }
    this._updateParticles(dt, time, px, pz);
  }

  dispose() {
    this.scene.remove(this.group);
    disposeTree(this.group);
    this.emitters.clear();
  }
}
