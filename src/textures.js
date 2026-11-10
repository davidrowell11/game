// Procedural canvas textures, so the game ships with zero image assets.
// Each surface is painted as an albedo map plus a height map; the height map
// is turned into a tangent-space normal map with a Sobel filter so mortar
// lines and flagstone seams catch the moving torch light.
import * as THREE from 'three';
import { RNG } from './rng.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTexture(c, srgb = true) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.userData.shared = true;
  return tex;
}

// Height canvas (greyscale, white = high) -> tangent-space normal map.
function normalFromHeight(hc, strength = 3) {
  const size = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, size, size).data;
  const [nc, ng] = canvas(size);
  const out = ng.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ng.putImageData(out, 0, 0);
  return toTexture(nc, false);
}

// Soft value noise used for grime and wear.
function speckle(g, rng, x, y, w, h, count, lo, hi, alpha, maxSize = 4) {
  for (let i = 0; i < count; i++) {
    const v = rng.int(lo, hi);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(x + rng.range(0, w), y + rng.range(0, h), rng.range(1, maxSize), rng.range(1, maxSize));
  }
}

export function brickTextures(seed = 7) {
  const rng = new RNG(seed);
  const S = 256;
  const [c, g] = canvas(S);
  const [hc, hg] = canvas(S);
  g.fillStyle = '#2e2c2a';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, S, S);
  const rows = 8;
  const bh = S / rows;
  const bw = 64;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < S + bw; x += bw) {
      const bx = x + off + 3;
      const by = r * bh + 3;
      const w = bw - 6;
      const hgt = bh - 6;
      const v = 140 + rng.int(-28, 28);
      const warm = rng.int(-6, 10);
      g.fillStyle = `rgb(${v + warm},${v},${v - warm})`;
      g.fillRect(bx, by, w, hgt);
      // bevelled edges: lighter top-left, darker bottom-right
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(bx, by, w, 2);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(bx, by + hgt - 2, w, 2);
      speckle(g, rng, bx, by, w - 4, hgt - 4, 26, 60, 140, 0.32);
      // height: raised brick with rounded shoulders and pitted face
      const grad = hg.createLinearGradient(0, by, 0, by + hgt);
      grad.addColorStop(0, '#9a9a9a');
      grad.addColorStop(0.15, '#e0e0e0');
      grad.addColorStop(0.85, '#e0e0e0');
      grad.addColorStop(1, '#9a9a9a');
      hg.fillStyle = grad;
      hg.fillRect(bx, by, w, hgt);
      speckle(hg, rng, bx, by, w - 4, hgt - 4, 30, 120, 200, 0.6, 5);
      if (rng.chance(0.25)) {
        // a chipped corner
        hg.fillStyle = '#707070';
        hg.beginPath();
        const cx = rng.chance(0.5) ? bx : bx + w;
        hg.arc(cx, by + (rng.chance(0.5) ? 0 : hgt), rng.range(4, 9), 0, Math.PI * 2);
        hg.fill();
      }
    }
  }
  // moss / soot streaks running down the wall
  for (let i = 0; i < 6; i++) {
    const x = rng.range(0, S);
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grad;
    g.fillRect(x, 0, rng.range(6, 20), S);
  }
  return { map: toTexture(c), normal: normalFromHeight(hc, 2.4) };
}

export function floorTextures(seed = 11) {
  const rng = new RNG(seed);
  const S = 256;
  const [c, g] = canvas(S);
  const [hc, hg] = canvas(S);
  g.fillStyle = '#262422';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#202020';
  hg.fillRect(0, 0, S, S);
  const n = 2;
  const s = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 128 + rng.int(-22, 22);
      const x0 = x * s + 4;
      const y0 = y * s + 4;
      g.fillStyle = `rgb(${v + 4},${v},${v - 4})`;
      g.fillRect(x0, y0, s - 8, s - 8);
      speckle(g, rng, x0, y0, s - 12, s - 12, 70, 80, 170, 0.28, 5);
      const grad = hg.createRadialGradient(x0 + s / 2, y0 + s / 2, s * 0.1, x0 + s / 2, y0 + s / 2, s * 0.75);
      grad.addColorStop(0, '#e8e8e8');
      grad.addColorStop(1, '#b0b0b0');
      hg.fillStyle = grad;
      hg.fillRect(x0, y0, s - 8, s - 8);
      speckle(hg, rng, x0, y0, s - 12, s - 12, 60, 140, 230, 0.5, 6);
      if (rng.chance(0.55)) {
        // a crack, carved into both colour and height
        let px = x0 + rng.int(12, s - 24);
        let py = y0 + rng.int(12, s - 24);
        g.strokeStyle = 'rgba(30,28,26,0.85)';
        hg.strokeStyle = '#404040';
        g.lineWidth = hg.lineWidth = 1.6;
        g.beginPath();
        hg.beginPath();
        g.moveTo(px, py);
        hg.moveTo(px, py);
        for (let i = 0; i < 6; i++) {
          px = Math.min(x0 + s - 10, Math.max(x0 + 2, px + rng.int(-16, 16)));
          py = Math.min(y0 + s - 10, Math.max(y0 + 2, py + rng.int(-16, 16)));
          g.lineTo(px, py);
          hg.lineTo(px, py);
        }
        g.stroke();
        hg.stroke();
      }
    }
  }
  return { map: toTexture(c), normal: normalFromHeight(hc, 2.0) };
}

export function glowTexture() {
  if (glowTexture.cached) return glowTexture.cached;
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  return (glowTexture.cached = tex);
}
