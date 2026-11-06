// Procedural canvas textures so the game ships with zero image assets.
import * as THREE from 'three';
import { RNG } from './rng.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function finish(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function brickTexture(seed = 7) {
  const rng = new RNG(seed);
  const [c, g] = canvas(256);
  g.fillStyle = '#3a3a3a';
  g.fillRect(0, 0, 256, 256);
  const rows = 8;
  const bh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const bw = 64;
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 256 + bw; x += bw) {
      const v = 150 + rng.int(-30, 30);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4);
      // grime speckles
      for (let i = 0; i < 18; i++) {
        const s = rng.int(60, 130);
        g.fillStyle = `rgba(${s},${s},${s},0.35)`;
        g.fillRect(x + off + rng.int(2, bw - 6), r * bh + rng.int(2, bh - 6), rng.int(1, 4), rng.int(1, 4));
      }
    }
  }
  return finish(c);
}

export function floorTexture(seed = 11) {
  const rng = new RNG(seed);
  const [c, g] = canvas(256);
  g.fillStyle = '#2b2b2b';
  g.fillRect(0, 0, 256, 256);
  const n = 2;
  const s = 256 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 135 + rng.int(-25, 25);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      for (let i = 0; i < 40; i++) {
        const k = rng.int(80, 170);
        g.fillStyle = `rgba(${k},${k},${k},0.3)`;
        g.fillRect(x * s + rng.int(4, s - 8), y * s + rng.int(4, s - 8), rng.int(1, 5), rng.int(1, 5));
      }
      // a crack now and then
      if (rng.chance(0.4)) {
        g.strokeStyle = 'rgba(40,40,40,0.8)';
        g.lineWidth = 1.5;
        g.beginPath();
        let px = x * s + rng.int(10, s - 10);
        let py = y * s + rng.int(10, s - 10);
        g.moveTo(px, py);
        for (let i = 0; i < 5; i++) {
          px += rng.int(-14, 14);
          py += rng.int(-14, 14);
          g.lineTo(px, py);
        }
        g.stroke();
      }
    }
  }
  return finish(c);
}

export function glowTexture() {
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
