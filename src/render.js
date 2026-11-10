// Rendering pipeline: scene -> (MSAA, HDR) -> bloom -> tone map -> grade.
//
// Quality presets
//   low    : direct render, no post-processing, 1x pixel ratio
//   medium : bloom + grade, up to 1.5x pixel ratio
//   high   : bloom + grade + the player's lantern casts real shadows, up to 2x
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final colour grade in display space: gentle contrast/saturation, a warm-cool
// split tone, vignette, film grain, chromatic aberration while hurt, and a
// fade-to-black used for floor transitions.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHurt: { value: 0 },
    uFade: { value: 0 },
    uLowHp: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uHurt, uFade, uLowHp;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration grows toward the edges and when hurt
      float ca = (0.0015 + uHurt * 0.012) * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      // grade
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.12);                                   // saturation
      col = (col - 0.5) * 1.06 + 0.5;                                  // contrast
      col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.06, 1.0, 0.92), smoothstep(0.0, 0.7, l)); // split tone
      // vignette, pulsing red when low on health
      float vig = smoothstep(0.85, 0.2, r2 * 2.2);
      col *= mix(0.55, 1.0, vig);
      col = mix(col, col * vec3(1.0, 0.25, 0.22), (1.0 - vig) * (uLowHp * (0.55 + 0.25 * sin(uTime * 5.0)) + uHurt * 0.8));
      // film grain
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.035;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.3;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.fx = { hurt: 0, fade: 0, lowHp: 0 };
    this.quality = null;
    this.w = 1;
    this.h = 1;
  }

  _dpr() {
    const q = this.quality;
    return Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'medium' ? 1.5 : 2);
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.gl.setPixelRatio(this._dpr());
    const wantShadows = q === 'high';
    if (this.gl.shadowMap.enabled !== wantShadows) {
      this.gl.shadowMap.enabled = wantShadows;
      // materials must recompile to pick up the shadow-map change
      this.scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    if (this.composer) {
      // EffectComposer.dispose() frees its own targets but not the passes'
      for (const pass of this.composer.passes) pass.dispose?.();
      this.composer.dispose();
      this.composer = null;
    }
    if (q !== 'low') {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.gl, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.82);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      composer.addPass(this.grade);
      this.composer = composer;
    }
    this.resize(this.w, this.h);
  }

  get shadows() {
    return this.gl.shadowMap.enabled;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    if (this.quality) this.gl.setPixelRatio(this._dpr());
    this.gl.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.gl.getPixelRatio());
      this.composer.setSize(w, h);
      this.grade.uniforms.uRes.value.set(w * this.gl.getPixelRatio(), h * this.gl.getPixelRatio());
    }
  }

  render(time) {
    if (this.composer) {
      const u = this.grade.uniforms;
      u.uTime.value = time;
      u.uHurt.value = this.fx.hurt;
      u.uFade.value = this.fx.fade;
      u.uLowHp.value = this.fx.lowHp;
      this.composer.render();
    } else {
      this.gl.render(this.scene, this.camera);
    }
  }
}
