// Renderer, post-processing, camera rig and the procedurally built cave.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GeoBuilder, M, fbm, vnoise, makeRng, clamp, lerp, smoothstep, damp } from './geo.js';
import { CAVE_LENGTH, BIOMES } from './data.js';

const CHUNK = 20;
const ROW = 2;
const D_MIN = -40;
const D_MAX = CAVE_LENGTH + 20;

// ---------------------------------------------------------------- biome looks
const LOOKS = {
  entrance: { rock: 0x76685a, rock2: 0x3d3530, floor: 0x655848, fog: 0x0c1220, sky: 0x7c8fc0, ground: 0x3a2c20, key: 0xc8d6ff, amb: 1.0 },
  crystal:  { rock: 0x4c5a88, rock2: 0x242a44, floor: 0x3e4870, fog: 0x070d28, sky: 0x5a7fe0, ground: 0x1c2040, key: 0xa8c4ff, amb: 1.0 },
  fungal:   { rock: 0x3c5c50, rock2: 0x1c2e2a, floor: 0x33503f, fog: 0x051612, sky: 0x4aa888, ground: 0x12261c, key: 0xa8ffd8, amb: 0.95 },
  magma:    { rock: 0x4a3432, rock2: 0x1c1312, floor: 0x3c2a26, fog: 0x1c0805, sky: 0xb05a3a, ground: 0x401208, key: 0xffc09a, amb: 1.0 },
  throne:   { rock: 0x4a3248, rock2: 0x1c1420, floor: 0x3a2636, fog: 0x14050f, sky: 0x9a4a78, ground: 0x30081c, key: 0xffb0c8, amb: 1.0 },
};
const KEYS = ['rock', 'rock2', 'floor', 'fog', 'sky', 'ground', 'key'];
const LOOK_LIN = BIOMES.map(b => {
  const o = { amb: LOOKS[b.id].amb };
  for (const k of KEYS) { const c = new THREE.Color(LOOKS[b.id][k]); o[k] = [c.r, c.g, c.b]; }
  return o;
});
const _look = { rock: [0, 0, 0], rock2: [0, 0, 0], floor: [0, 0, 0], fog: [0, 0, 0], sky: [0, 0, 0], ground: [0, 0, 0], key: [0, 0, 0], amb: 1 };
/** Interpolated look at a depth (linear RGB triples). Returns a shared object. */
export function lookAt(d) {
  let i = 0;
  for (let k = 0; k < BIOMES.length; k++) if (d >= BIOMES[k].from - 14) i = k;
  const a = LOOK_LIN[Math.max(0, i - 1)], b = LOOK_LIN[i];
  const t = i === 0 ? 1 : smoothstep(BIOMES[i].from - 14, BIOMES[i].from + 14, d);
  for (const k of KEYS) for (let c = 0; c < 3; c++) _look[k][c] = lerp(a[k][c], b[k][c], t);
  _look.amb = lerp(a.amb, b.amb, t);
  return _look;
}
function biomeIndex(d) {
  let i = 0;
  for (let k = 0; k < BIOMES.length; k++) if (d >= BIOMES[k].from) i = k;
  return i;
}

// ---------------------------------------------------------------- cave shape
const hall = d => smoothstep(CAVE_LENGTH - 50, CAVE_LENGTH - 16, d);
export const caveW = d => 12.6 + 2.0 * Math.sin(d * 0.045 + 1.3) + 1.2 * Math.sin(d * 0.11) + hall(d) * 7;
export const caveH = d => 9.5 + 1.5 * Math.sin(d * 0.06 + 0.4) + 1.0 * Math.sin(d * 0.13 + 2) + hall(d) * 7;

function wallPoint(theta, d, shrink = 1) {
  const W = caveW(d), H = caveH(d);
  const cx = Math.cos(theta), sy = Math.sin(theta);
  const n = fbm(cx * W * 0.17 + 5.2, sy * H * 0.17, d * 0.12, 3);
  const ridge = vnoise(theta * 1.7 + 9.1, d * 0.055, 3.3);
  const s = (1 + (n - 0.5) * 0.42 + (ridge - 0.5) * 0.2) * shrink;
  return [cx * W * s, sy * H * s - 0.5, -d];
}
export function floorY(x, d) {
  const ax = Math.abs(x);
  const side = smoothstep(5, 9.5, ax);
  return side * (0.25 + 1.7 * fbm(x * 0.22 + 3.1, 0.5, d * 0.22, 2)) * Math.min(1.4, ax / 9)
    + (fbm(x * 0.8, 1.7, d * 0.8, 2) - 0.5) * 0.07;
}

const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
})();
export { glowTexture };

// ---------------------------------------------------------------- post shader
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.85 },
    uAberration: { value: 0.012 },
    uFlash: { value: new THREE.Color(1, 0.1, 0.05) },
    uFlashAmt: { value: 0 },
    uDesat: { value: 0 },
    uDim: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uAberration;
    uniform vec3 uFlash; uniform float uFlashAmt; uniform float uDesat; uniform float uDim;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float v = smoothstep(0.95, 0.25, length(c) * 1.18);
      col *= mix(1.0, v, uVignette);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.9, 0.95, 1.1), uDesat);
      col += uFlash * uFlashAmt * (0.04 + r2 * 1.5);
      col *= 1.0 - uDim;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const CAMS = {
  // offset from focus, look-at offset from focus, fov  (landscape / portrait)
  run:   { l: { pos: [4.4, 5.2, 9.0], look: [0.4, 1.4, -8.5], fov: 54 }, p: { pos: [2.2, 6.8, 11.5], look: [0, 1.3, -9], fov: 64 } },
  draw:  { l: { pos: [-3.2, 2.6, -8.2], look: [0, 1.9, 0], fov: 42 },     p: { pos: [-2.2, 2.8, -9.5], look: [0, 1.9, 0], fov: 50 } },
  shop:  { l: { pos: [-2.9, 2.5, -7.8], look: [0, 1.85, 0], fov: 40 },    p: { pos: [-2.4, 2.7, -9.2], look: [0, 1.85, 0], fov: 46 } },
  dead:  { l: { pos: [4.5, 3.2, 6.5], look: [0, 1.0, -1], fov: 46 },      p: { pos: [2.5, 4.5, 8.5], look: [0, 1.0, -1], fov: 56 } },
  boss:  { l: { pos: [5.4, 6.4, 12.5], look: [0.2, 2.4, -8.5], fov: 54 }, p: { pos: [2.4, 7.2, 14], look: [0, 2.2, -9], fov: 66 } },
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
    this.quality = mobile ? 1 : 2;   // 0 low, 1 medium, 2 high
    const forced = new URLSearchParams(location.search).get('q');
    this.lockQuality = forced !== null;
    if (this.lockQuality) this.quality = Math.max(0, Math.min(2, parseInt(forced, 10) || 0));
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1220);
    scene.fog = new THREE.FogExp2(0x0c1220, 0.034);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 140);
    this.camPos = new THREE.Vector3(0, 6, 12);
    this.camLook = new THREE.Vector3(0, 1.5, -6);
    this.camMode = 'draw';
    this.camSnap = true;
    this.viewShift = { x: 0, y: 0 };     // fraction of the viewport the subject is moved by
    this.viewShiftCur = { x: 0, y: 0 };
    this.shakeAmt = 0;
    this.orbit = 0;
    this.zoom = 1;
    this.speedK = 0;      // 0..1 how fast the subject is sprinting (widens the lens)

    // --- lights
    this.hemi = new THREE.HemisphereLight(0x7c8fc0, 0x3a2c20, 1.1);
    scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xc8d6ff, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 20; sc.bottom = -14; sc.near = 1; sc.far = 60;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.05;
    scene.add(this.key, this.key.target);
    this.propLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 26, 1.8);
      scene.add(l); this.propLights.push(l);
    }

    // --- post
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.7, 0.95);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.flashAmt = 0;
    this.time = 0;
    this.lights = [];
    this.emitters = [];
    this.buildCave();
    this.applyQuality();
    this.resize();
    this._fogCol = new THREE.Color();
    this._frameAvg = 16;
    this._slowT = 0;
  }

  // ------------------------------------------------------------ sizing / quality
  applyQuality() {
    const q = this.quality;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, q === 2 ? 2 : q === 1 ? 1.5 : 1);
    this.renderer.shadowMap.enabled = q > 0;
    this.key.castShadow = q > 0;
    const size = q === 2 ? 2048 : 1024;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    this.resize();
  }
  /** Called every frame with the raw frame time; steps quality down if we are struggling. */
  watchPerformance(ms) {
    if (this.lockQuality) return;
    this._frameAvg += (ms - this._frameAvg) * 0.05;
    if (this._frameAvg > 30) this._slowT += ms / 1000; else this._slowT = Math.max(0, this._slowT - ms / 2000);
    if (this._slowT > 2.5 && this.quality > 0) {
      this.quality--; this._slowT = 0; this._frameAvg = 16;
      this.applyQuality();
    }
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  get portrait() { return this.h > this.w * 1.05; }

  // ------------------------------------------------------------ cave construction
  buildCave() {
    const rockMat = this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true });
    const glowMat = this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const glowPts = [];   // x,y,z, r,g,b, size, phase, flicker
    this.caveGroup = new THREE.Group();
    this.scene.add(this.caveGroup);

    for (let d0 = D_MIN; d0 < D_MAX; d0 += CHUNK) {
      const rock = new GeoBuilder(), glow = new GeoBuilder();
      this.buildShell(rock, d0);
      this.buildProps(rock, glow, glowPts, d0);
      const mesh = new THREE.Mesh(rock.build(), rockMat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.caveGroup.add(mesh);
      if (!glow.empty) {
        const gm = new THREE.Mesh(glow.build(), glowMat);
        gm.matrixAutoUpdate = false;
        this.caveGroup.add(gm);
      }
    }
    this.buildEnds(rockMat, glowMat, glowPts);
    this.lights.sort((a, b) => a.d - b.d);
    this.emitters.sort((a, b) => a.d - b.d);

    // one draw call for every halo in the cave
    const n = glowPts.length / 9;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), misc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(glowPts.slice(i * 9, i * 9 + 3), i * 3);
      col.set(glowPts.slice(i * 9 + 3, i * 9 + 6), i * 3);
      misc.set(glowPts.slice(i * 9 + 6, i * 9 + 9), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('misc', new THREE.BufferAttribute(misc, 3));
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uMap: { value: glowTexture }, uFog: { value: 0.03 } },
      vertexShader: `
        attribute vec3 misc; varying vec3 vCol; varying float vFade; uniform float uTime; uniform float uScale; uniform float uFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float fl = 1.0 + misc.z * (sin(uTime * 9.0 + misc.y) * 0.6 + sin(uTime * 23.0 + misc.y * 1.7) * 0.4);
          gl_PointSize = misc.x * fl * uScale / max(0.1, -mv.z);
          float f = uFog * -mv.z; vFade = exp(-f * f) * fl; vCol = color;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vCol; varying float vFade;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol * a * vFade, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, vertexColors: true,
    });
    this.halos = new THREE.Points(g, this.haloMat);
    this.halos.frustumCulled = false;
    this.scene.add(this.halos);
  }

  buildShell(b, d0) {
    const SEG = 22, t0 = -0.1 * Math.PI, t1 = 1.1 * Math.PI;
    const rows = CHUNK / ROW;
    const wallCol = (p, d) => {
      const L = lookAt(d);
      const t = fbm(p[0] * 0.33, p[1] * 0.33, d * 0.33, 2);
      const hgt = clamp(p[1] / 14);
      const k = (0.55 + t * 0.75) * (1.05 - hgt * 0.5) * (p[1] < 1.2 ? 0.72 : 1);
      const c = [lerp(L.rock2[0], L.rock[0], t) * k, lerp(L.rock2[1], L.rock[1], t) * k, lerp(L.rock2[2], L.rock[2], t) * k];
      if (d < 255 && p[1] < 4 && vnoise(p[0] * 0.5, p[1] * 0.6, d * 0.5) > 0.55) { c[0] = c[0] * 0.6 + 0.012; c[1] = c[1] * 0.75 + 0.03; c[2] *= 0.55; } // moss
      if (d > 765 && d < 1095 && vnoise(p[0] * 0.9 + 3, p[1] * 0.9, d * 0.9) > 0.8) { c[0] += 0.5; c[1] += 0.07; }   // magma veins
      return c;
    };
    const floorCol = (x, d) => {
      const L = lookAt(d);
      const t = fbm(x * 0.5, 4.2, d * 0.5, 2);
      const lane = 1 - smoothstep(2.6, 5.5, Math.abs(x));
      const k = 0.5 + t * 0.6 + lane * 0.3;
      return [L.floor[0] * k, L.floor[1] * k, L.floor[2] * k];
    };
    for (let r = 0; r < rows; r++) {
      const da = d0 + r * ROW, db = da + ROW;
      // walls + ceiling
      let pa0 = wallPoint(t0, da), pb0 = wallPoint(t0, db);
      for (let s = 1; s <= SEG; s++) {
        const th = t0 + (t1 - t0) * (s / SEG);
        const pa1 = wallPoint(th, da), pb1 = wallPoint(th, db);
        const ca0 = wallCol(pa0, da), cb0 = wallCol(pb0, db), ca1 = wallCol(pa1, da), cb1 = wallCol(pb1, db);
        // wind so the faces look inward
        if ((s + r) % 2) { b.tri(pa0, pa1, pb0, ca0, ca1, cb0); b.tri(pa1, pb1, pb0, ca1, cb1, cb0); }
        else { b.tri(pa0, pa1, pb1, ca0, ca1, cb1); b.tri(pa0, pb1, pb0, ca0, cb1, cb0); }
        pa0 = pa1; pb0 = pb1;
      }
      // floor
      const COLS = 16;
      const fp = (u, d) => { const x = u * (caveW(d) + 2); return [x, floorY(x, d), -d]; };
      for (let c = 0; c < COLS; c++) {
        // denser columns in the middle where the action is
        const u0 = Math.sin(((c / COLS) * 2 - 1) * Math.PI / 2), u1 = Math.sin((((c + 1) / COLS) * 2 - 1) * Math.PI / 2);
        const a0 = fp(u0, da), a1 = fp(u1, da), b0 = fp(u0, db), b1 = fp(u1, db);
        const ca0 = floorCol(a0[0], da), ca1 = floorCol(a1[0], da), cb0 = floorCol(b0[0], db), cb1 = floorCol(b1[0], db);
        if ((c + r) % 2) { b.tri(a0, a1, b0, ca0, ca1, cb0); b.tri(a1, b1, b0, ca1, cb1, cb0); }
        else { b.tri(a0, a1, b1, ca0, ca1, cb1); b.tri(a0, b1, b0, ca0, cb1, cb0); }
      }
    }
  }

  buildProps(b, glow, glowPts, d0) {
    const rng = makeRng(d0 * 7 + 1337);
    const R = (a, b2) => a + rng() * (b2 - a);
    const self = this;
    const hex = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
    const halo = (x, y, z, color, size, flicker = 0, k = 1) => { const c = hex(color); glowPts.push(x, y, z, c[0] * k, c[1] * k, c[2] * k, size, rng() * 6.28, flicker); };
    const light = (x, y, d, color, intensity, flicker = 0) => self.lights.push({ x, y, z: -d, d, color: new THREE.Color(color), intensity, flicker, phase: rng() * 6.28 });
    const emitter = (x, y, d, type, color) => self.emitters.push({ x, y, z: -d, d, type, color });
    // the chase camera rides on the +x side: keep big bright props out of its face
    const sideX = (d, side, min = 6) => { const lo = side > 0 && min > 6.3 ? Math.max(min, 8.4) : min; return side * R(lo, Math.max(lo + 0.5, caveW(d) - 1.6)); };
    const rockTint = d => { const L = lookAt(d); const c = new THREE.Color(L.rock[0], L.rock[1], L.rock[2]); const c2 = new THREE.Color(L.rock2[0], L.rock2[1], L.rock2[2]); return [c.getHex(), c2.getHex()]; };

    const stalagmite = (x, d, h, r) => {
      const [c1, c2] = rockTint(d);
      b.add(new THREE.ConeGeometry(r, h, 5, 1), c2, M(x, floorY(x, d) + h / 2 - 0.25, -d, R(-0.12, 0.12), R(0, 6), R(-0.12, 0.12)), c1);
    };
    const stalactite = (theta, d, h, r) => {
      const p = wallPoint(theta, d, 0.97);
      const [c1, c2] = rockTint(d);
      h = Math.max(0.6, Math.min(h, p[1] - 6.9));   // never dangle into the camera's path
      b.add(new THREE.ConeGeometry(r, h, 5, 1), c1, M(p[0], p[1] - h / 2 + 0.5, -d, Math.PI + R(-0.1, 0.1), R(0, 6), R(-0.1, 0.1)), c2);
    };
    const boulder = (x, d, r) => {
      const [c1, c2] = rockTint(d);
      b.add(new THREE.IcosahedronGeometry(r, 0), c2, M(x, floorY(x, d) + r * 0.35, -d, R(0, 6), R(0, 6), R(0, 6), R(0.8, 1.3), R(0.6, 1), R(0.8, 1.3)), c1);
    };
    const torch = (x, d) => {
      const y = floorY(x, d);
      b.add(new THREE.CylinderGeometry(0.06, 0.09, 2.5, 5), 0x1c1816, M(x, y + 1.25, -d));
      b.add(new THREE.CylinderGeometry(0.3, 0.12, 0.28, 6), 0x2a2420, M(x, y + 2.6, -d));
      glow.add(new THREE.ConeGeometry(0.22, 0.7, 5), 0xff7a18, M(x, y + 3.05, -d), 0xffe08a, 3.2);
      halo(x, y + 3.0, -d, 0xff8a30, 3.4, 0.22, 0.9);
      light(x, y + 3.1, d, 0xff9a48, 42, 0.25);
      emitter(x, y + 3.05, d, 'flame', 0xff8a30);
    };
    const crystal = (x, y, d, s, color, big) => {
      const n = big ? 6 : 3 + (rng() * 3 | 0);
      const c = new THREE.Color(color), dark = c.clone().multiplyScalar(0.18), tip = c.clone().lerp(new THREE.Color(0xffffff), 0.35);
      for (let i = 0; i < n; i++) {
        const h = s * R(0.7, 2.1), r = s * R(0.14, 0.3);
        const tilt = i === 0 ? 0 : R(0.25, 0.75), az = R(0, 6.28);
        const m = M(x + Math.sin(az) * tilt * 0.4 * s, y, -d + Math.cos(az) * tilt * 0.4 * s, 0, 0, 0)
          .multiply(M(0, 0, 0, Math.cos(az) * tilt, 0, -Math.sin(az) * tilt))
          .multiply(M(0, h / 2 - 0.15, 0));
        glow.add(new THREE.ConeGeometry(r, h, 5, 1), dark.getHex(), m, tip.getHex(), 1.6);
      }
      halo(x, y + s * 0.9, -d, color, 2.2 + s * 2.2, 0.04, 0.55);
      if (big) light(x, y + s * 1.2, d, color, 55 + s * 25, 0.05);
    };
    const mushroom = (x, d, s, color) => {
      const y = floorY(x, d) - 0.1, lean = R(-0.25, 0.25), lean2 = R(-0.2, 0.2);
      const base = M(x, y, -d, lean, R(0, 6), lean2);
      b.add(new THREE.CylinderGeometry(0.1 * s, 0.2 * s, 1.5 * s, 6), 0x54604e, base.clone().multiply(M(0, 0.75 * s, 0)), 0xc8d4b8);
      const c = new THREE.Color(color), dark = c.clone().multiplyScalar(0.25);
      glow.add(new THREE.SphereGeometry(0.75 * s, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), c.getHex(), base.clone().multiply(M(0, 1.45 * s, 0, 0, 0, 0, 1, 0.55, 1)), dark.getHex(), 1.25);
      glow.add(new THREE.CircleGeometry(0.72 * s, 7), c.clone().multiplyScalar(0.7).getHex(), base.clone().multiply(M(0, 1.45 * s, 0, Math.PI / 2, 0, 0)), null, 1.4);
      halo(x, y + 1.3 * s, -d, color, 1.6 + s * 2.4, 0.03, 0.5);
      if (s > 1.8) { light(x, y + 1.2 * s, d, color, 45 + s * 14, 0.04); emitter(x, y + 1.5 * s, d, 'spore', color); }
    };
    const lava = (x, d, r) => {
      const y = floorY(x, d) + 0.12;
      glow.add(new THREE.CircleGeometry(r, 7), 0xff3c08, M(x, y, -d, -Math.PI / 2, 0, R(0, 6), 1, R(0.6, 1), 1), null, 2.6);
      glow.add(new THREE.CircleGeometry(r * 0.55, 6), 0xffa028, M(x + R(-0.2, 0.2), y + 0.02, -d, -Math.PI / 2, 0, R(0, 6)), null, 3.2);
      for (let i = 0; i < 5; i++) { const a = R(0, 6.28); boulder(x + Math.cos(a) * r * 1.05, d + Math.sin(a) * r * 0.9, R(0.3, 0.7)); }
      halo(x, y + 0.5, -d, 0xff4a10, 4 + r * 2.2, 0.12, 0.6);
      light(x, y + 1.4, d, 0xff5a20, 80 + r * 30, 0.15);
      emitter(x, y + 0.2, d, 'ember', 0xff6a20);
    };
    const banner = (x, d) => {
      const y = floorY(x, d);
      b.add(new THREE.CylinderGeometry(0.07, 0.09, 5, 5), 0x3a2a1c, M(x, y + 2.5, -d));
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5), 0x3a2a1c, M(x, y + 4.6, -d, 0, 0, Math.PI / 2));
      b.add(new THREE.BoxGeometry(1.2, 2.1, 0.05), 0x4a0c0c, M(x, y + 3.5, -d + 0.05), 0xa01c14);
      b.add(new THREE.ConeGeometry(0.6, 0.6, 3), 0x4a0c0c, M(x, y + 2.2, -d + 0.05, Math.PI, Math.PI / 6, 0, 1, 1, 0.08));
      // crude skull emblem
      b.add(new THREE.CircleGeometry(0.3, 7), 0xd8cfb8, M(x, y + 3.75, -d + 0.09));
      b.add(new THREE.BoxGeometry(0.26, 0.22, 0.02), 0xd8cfb8, M(x, y + 3.42, -d + 0.09));
      b.add(new THREE.CircleGeometry(0.075, 5), 0x1a0808, M(x - 0.11, y + 3.78, -d + 0.1));
      b.add(new THREE.CircleGeometry(0.075, 5), 0x1a0808, M(x + 0.11, y + 3.78, -d + 0.1));
      b.add(new THREE.ConeGeometry(0.12, 0.4, 4), 0x8a8a8a, M(x, y + 5.15, -d));
    };
    const totem = (x, d) => {
      const y = floorY(x, d);
      b.add(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 5), 0x3a2a1c, M(x, y + 1.6, -d, R(-0.1, 0.1), 0, R(-0.1, 0.1)));
      b.add(new THREE.SphereGeometry(0.3, 6, 5), 0xd8d0b8, M(x, y + 3.3, -d, 0, 0, 0, 1, 1.05, 1.1));
      b.add(new THREE.BoxGeometry(0.34, 0.2, 0.36), 0xc8c0a8, M(x, y + 3.02, -d + 0.04));
      b.add(new THREE.ConeGeometry(0.07, 0.6, 4), 0xe8e0c8, M(x - 0.34, y + 3.5, -d, 0, 0, 0.9));
      b.add(new THREE.ConeGeometry(0.07, 0.6, 4), 0xe8e0c8, M(x + 0.34, y + 3.5, -d, 0, 0, -0.9));
      glow.add(new THREE.SphereGeometry(0.07, 5, 4), 0xff3018, M(x - 0.11, y + 3.34, -d + 0.27), null, 3);
      glow.add(new THREE.SphereGeometry(0.07, 5, 4), 0xff3018, M(x + 0.11, y + 3.34, -d + 0.27), null, 3);
      halo(x, y + 3.34, -d + 0.3, 0xff3018, 1.2, 0.1, 0.5);
    };
    const bones = (x, d) => {
      const y = floorY(x, d);
      for (let i = 0; i < 5; i++) b.add(new THREE.CylinderGeometry(0.04, 0.05, R(0.4, 0.9), 4), 0xc8c0a8, M(x + R(-0.7, 0.7), y + 0.08, -d + R(-0.7, 0.7), Math.PI / 2, R(0, 6), R(0, 6)));
      b.add(new THREE.SphereGeometry(0.2, 6, 4), 0xd8d0b8, M(x + R(-0.4, 0.4), y + 0.16, -d + R(-0.4, 0.4)));
    };
    const spikes = (x, d) => {
      const y = floorY(x, d);
      for (let i = 0; i < 4; i++) b.add(new THREE.ConeGeometry(0.15, 2.6, 5), 0x2a1c12, M(x + (i - 1.5) * 0.55, y + 0.9, -d, 0.75 + R(-0.15, 0.15), 0, R(-0.2, 0.2)), 0x8a6a48);
      b.add(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 5), 0x3a2a1c, M(x, y + 0.5, -d + 0.3, 0, 0, Math.PI / 2));
    };
    const beam = d => {
      // mine props: a braced post on each wall, the left one carrying a lantern on an arm
      const w = 8.3, top = Math.min(7.5, caveH(d) * 0.75);
      for (const s of [-1, 1]) {
        b.add(new THREE.BoxGeometry(0.5, top + 0.4, 0.5), 0x33241a, M(s * w, top / 2 - 0.2, -d, 0, 0, s * -0.04), 0x6a4a30);
        b.add(new THREE.BoxGeometry(0.3, 2.2, 0.3), 0x4a3524, M(s * (w + 0.9), top - 0.8, -d, 0, 0, s * -0.8));
        b.add(new THREE.BoxGeometry(2.6, 0.4, 0.45), 0x5a4028, M(s * (w + 0.6), top, -d, 0, 0, R(-0.03, 0.03)));
      }
      const lx = -(w - 1.5), ly = top - 1.5;
      b.add(new THREE.BoxGeometry(1.8, 0.2, 0.2), 0x4a3524, M(lx + 0.75, top - 0.5, -d));
      b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), 0x1a1a1a, M(lx, ly + 0.62, -d));
      b.add(new THREE.BoxGeometry(0.34, 0.1, 0.34), 0x1c1816, M(lx, ly + 0.24, -d));
      glow.add(new THREE.BoxGeometry(0.26, 0.36, 0.26), 0xffb050, M(lx, ly, -d), 0xffe8a8, 2.2);
      b.add(new THREE.BoxGeometry(0.34, 0.08, 0.34), 0x1c1816, M(lx, ly - 0.22, -d));
      halo(lx, ly, -d, 0xffa040, 3.0, 0.1, 0.8);
      light(lx, ly - 0.2, d, 0xffb060, 45, 0.1);
    };

    const bi = biomeIndex(d0 + CHUNK / 2);
    const biome = BIOMES[bi].id;
    const endZone = d0 + CHUNK > CAVE_LENGTH - 4;

    // generic rock dressing
    for (const side of [-1, 1]) {
      const n = 3 + (rng() * 4 | 0);
      for (let i = 0; i < n; i++) { const d = d0 + R(0, CHUNK); stalagmite(sideX(d, side, 6.2), d, R(0.7, 3.4) * (biome === 'magma' ? 1.5 : 1), R(0.25, 0.75)); }
      const m = 1 + (rng() * 3 | 0);
      for (let i = 0; i < m; i++) { const d = d0 + R(0, CHUNK); boulder(sideX(d, side, 6), d, R(0.5, 1.4)); }
    }
    const ns = 7 + (rng() * 6 | 0);
    for (let i = 0; i < ns; i++) stalactite(R(0.2, 0.8) * Math.PI, d0 + R(0, CHUNK), R(0.8, 4.2), R(0.25, 0.7));
    if (d0 < 0 || endZone) { /* keep the ends tidy */ }

    if (biome === 'entrance') {
      if (d0 >= -20) { torch(-6.1 - R(0, 0.5), d0 + 4 + R(0, 2)); torch(8.1 + R(0, 0.5), d0 + 13 + R(0, 2)); }
      if (d0 >= 0 && (d0 / CHUNK) % 2 === 0) beam(d0 + 9);
      if (rng() < 0.35) crystal(sideX(d0 + 10, rng() < 0.5 ? -1 : 1, 7), 0.2, d0 + R(2, 18), R(0.5, 0.8), 0x4fd8ff, false);
      if (d0 > 40 && rng() < 0.5) bones(sideX(d0, rng() < 0.5 ? -1 : 1, 5.2), d0 + R(2, 18));
      if (d0 > 80 && rng() < 0.6) totem(sideX(d0, rng() < 0.5 ? -1 : 1, 5.8), d0 + R(2, 18));
    } else if (biome === 'crystal') {
      const cols = [0x4fd8ff, 0x7a8cff, 0xb070ff, 0x4fffe0];
      const main = cols[(rng() * cols.length) | 0];
      for (const side of [-1, 1]) {
        const d = d0 + R(3, 17), x = sideX(d, side, 6.4);
        crystal(x, floorY(x, d), d, R(1.3, 2.3), main, true);
        for (let i = 0; i < 3; i++) { const dd = d0 + R(0, CHUNK), xx = sideX(dd, side, 5.6); crystal(xx, floorY(xx, dd), dd, R(0.4, 0.9), cols[(rng() * cols.length) | 0], false); }
      }
      for (let i = 0; i < 3; i++) {   // ceiling and wall clusters
        const th = R(0.12, 0.88) * Math.PI, d = d0 + R(0, CHUNK), p = wallPoint(th, d, 0.95), col = cols[(rng() * cols.length) | 0];
        const c = new THREE.Color(col), dark = c.clone().multiplyScalar(0.2), tip = c.clone().lerp(new THREE.Color(0xffffff), 0.3);
        for (let k = 0; k < 4; k++) {
          const h = R(0.8, 2.6);
          glow.add(new THREE.ConeGeometry(R(0.15, 0.32), h, 5), dark.getHex(), M(p[0] + R(-0.5, 0.5), p[1], -d + R(-0.5, 0.5), 0, 0, th - Math.PI / 2 + Math.PI + R(-0.4, 0.4)).multiply(M(0, h / 2, 0)), tip.getHex(), 1.5);
        }
        halo(p[0] * 0.93, p[1] * 0.93, -d, col, 3.6, 0.04, 0.5);
      }
      if (rng() < 0.4) totem(sideX(d0, rng() < 0.5 ? -1 : 1, 5.6), d0 + R(2, 18));
    } else if (biome === 'fungal') {
      const cols = [0x5dffb0, 0x3fe8d8, 0xc8ff5a, 0x7affea];
      for (const side of [-1, 1]) {
        const d = d0 + R(3, 17);
        mushroom(sideX(d, side, 6.8), d, R(2.0, 3.6), cols[(rng() * cols.length) | 0]);
        const n = 4 + (rng() * 4 | 0);
        for (let i = 0; i < n; i++) { const dd = d0 + R(0, CHUNK); mushroom(sideX(dd, side, 5.4), dd, R(0.3, 0.9), cols[(rng() * cols.length) | 0]); }
      }
      for (let i = 0; i < 5; i++) {   // hanging vines
        const th = R(0.25, 0.75) * Math.PI, d = d0 + R(0, CHUNK), p = wallPoint(th, d, 0.97), h = R(2, 5.5);
        b.add(new THREE.CylinderGeometry(0.03, 0.05, h, 4), 0x2c5a3a, M(p[0], p[1] - h / 2 + 0.4, -d, R(-0.06, 0.06), 0, R(-0.06, 0.06)), 0x1a3424);
        glow.add(new THREE.SphereGeometry(0.11, 5, 4), 0x9dffb8, M(p[0], p[1] - h + 0.35, -d), null, 2.4);
        halo(p[0], p[1] - h + 0.35, -d, 0x7dffb0, 1.3, 0.1, 0.5);
      }
      if (rng() < 0.5) spikes(sideX(d0, rng() < 0.5 ? -1 : 1, 5.6), d0 + R(2, 18));
    } else if (biome === 'magma') {
      lava(sideX(d0 + 5, -1, 7.6), d0 + R(3, 9), R(1.4, 2.4));
      lava(sideX(d0 + 14, 1, 7.6), d0 + R(11, 17), R(1.4, 2.4));
      if (rng() < 0.7) banner(sideX(d0, rng() < 0.5 ? -1 : 1, 5.8) , d0 + R(2, 18));
      if (rng() < 0.6) spikes(sideX(d0, rng() < 0.5 ? -1 : 1, 5.6), d0 + R(2, 18));
      if (rng() < 0.5) bones(sideX(d0, rng() < 0.5 ? -1 : 1, 5.2), d0 + R(2, 18));
    } else if (biome === 'throne') {
      if (!endZone) {
        torch(-6.4, d0 + 5); torch(8.3, d0 + 15);
        banner(-7.4, d0 + 10); banner(8.8, d0 + 1);
        bones(sideX(d0, -1, 5.2), d0 + R(2, 18)); bones(sideX(d0, 1, 5.2), d0 + R(2, 18));
        totem(sideX(d0, rng() < 0.5 ? -1 : 1, 5.8), d0 + R(2, 18));
        const x = sideX(d0 + 8, rng() < 0.5 ? -1 : 1, 8), dd = d0 + R(2, 18);
        crystal(x, floorY(x, dd), dd, R(1, 1.8), 0xff2a55, true);
      }
    }
  }

  buildEnds(rockMat, glowMat, glowPts) {
    const b = new GeoBuilder(), glow = new GeoBuilder();
    const hex = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
    const halo = (x, y, z, color, size, flicker = 0, k = 1) => { const c = hex(color); glowPts.push(x, y, z, c[0] * k, c[1] * k, c[2] * k, size, Math.random() * 6, flicker); };
    // --- the way out: moonlight pouring in behind the mage
    glow.add(new THREE.CircleGeometry(15, 20), 0x9fc0ff, M(0, 5, -D_MIN - 0.5, 0, Math.PI, 0), 0xdfeaff, 1.5);
    halo(0, 5, -D_MIN - 1, 0x9fc0ff, 60, 0, 0.5);
    this.lights.push({ x: 0, y: 5, z: 14, d: -14, color: new THREE.Color(0x9fc0ff), intensity: 160, flicker: 0, phase: 0 });

    // --- throne hall
    const L = CAVE_LENGTH, tz = -(L + 9);
    b.add(new THREE.BoxGeometry(11, 0.8, 8), 0x2a1c28, M(0, 0.4, tz), 0x4a3444);
    b.add(new THREE.BoxGeometry(8.4, 0.7, 6), 0x2a1c28, M(0, 1.1, tz - 0.6), 0x4a3444);
    b.add(new THREE.BoxGeometry(4.6, 1.6, 3.6), 0x241824, M(0, 2.2, tz - 1), 0x54384c);
    b.add(new THREE.BoxGeometry(5.2, 9, 1.1), 0x1c1220, M(0, 6, tz - 2.9), 0x5a3c54);
    for (const s of [-1, 1]) {
      b.add(new THREE.BoxGeometry(1, 2.6, 3.6), 0x241824, M(s * 2.6, 3.2, tz - 1), 0x54384c);
      b.add(new THREE.ConeGeometry(0.5, 3.2, 4), 0x1c1220, M(s * 2.1, 12, tz - 2.9), 0x8a6a80);
      b.add(new THREE.ConeGeometry(0.4, 2.2, 4), 0x1c1220, M(s * 0.8, 11.6, tz - 2.9), 0x8a6a80);
      b.add(new THREE.SphereGeometry(0.42, 6, 5), 0xd8d0b8, M(s * 2.6, 4.9, tz + 0.6));
      b.add(new THREE.ConeGeometry(0.1, 0.8, 4), 0xe8e0c8, M(s * 2.6 - 0.4, 5.25, tz + 0.6, 0, 0, 0.8));
      b.add(new THREE.ConeGeometry(0.1, 0.8, 4), 0xe8e0c8, M(s * 2.6 + 0.4, 5.25, tz + 0.6, 0, 0, -0.8));
      // great braziers
      for (const dz of [-4, 8]) {
        const x = s * 8.5, z = tz + dz + 6;
        b.add(new THREE.CylinderGeometry(0.25, 0.5, 2.6, 6), 0x1c1816, M(x, 1.3, z));
        b.add(new THREE.CylinderGeometry(0.9, 0.35, 0.6, 7), 0x2a2420, M(x, 2.8, z));
        glow.add(new THREE.ConeGeometry(0.7, 1.9, 6), 0xff3a20, M(x, 3.9, z), 0xffc070, 3.2);
        halo(x, 3.8, z, 0xff5a30, 7, 0.22, 0.9);
        this.lights.push({ x, y: 4.2, z, d: -z, color: new THREE.Color(0xff5a38), intensity: 190, flicker: 0.25, phase: dz });
        this.emitters.push({ x, y: 3.6, z, d: -z, type: 'flame', color: 0xff5a30, big: true });
      }
    }
    glow.add(new THREE.OctahedronGeometry(0.7, 0), 0xff1a4a, M(0, 11.2, tz - 2.9, 0, 0.6, 0, 1, 1.5, 0.6), 0xff9ab0, 2.6);
    halo(0, 11.2, tz - 2.4, 0xff2a55, 6, 0.08, 0.8);
    // back wall
    const wallZ = -(L + 19);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2, r = 4 + (i % 5) * 4.4;
      b.add(new THREE.IcosahedronGeometry(4.2, 0), 0x1c1420, M(Math.cos(a) * r, 8 + Math.sin(a) * r * 0.8, wallZ - (i % 3), i, i * 2, i * 3), 0x4a3248);
    }
    const m = new THREE.Mesh(b.build(), rockMat);
    m.receiveShadow = true; m.matrixAutoUpdate = false;
    const g = new THREE.Mesh(glow.build(), glowMat);
    g.matrixAutoUpdate = false;
    this.caveGroup.add(m, g);
  }

  // ------------------------------------------------------------ camera
  setCamera(mode, snap = false) { this.camMode = mode; if (snap) this.camSnap = true; }
  shake(a) { this.shakeAmt = Math.min(1.6, Math.max(this.shakeAmt, a)); }
  flash(color, amt) { this.grade.uniforms.uFlash.value.set(color); this.flashAmt = Math.max(this.flashAmt, amt); }

  /**
   * @param focus {x,y,z} world position of the subject (the mage)
   */
  update(dt, focus, depth) {
    this.time += dt;
    const t = this.time;
    // --- atmosphere follows depth
    const L = lookAt(depth);
    this.scene.fog.color.setRGB(L.fog[0], L.fog[1], L.fog[2]);
    this.scene.background.copy(this.scene.fog.color);
    this.hemi.color.setRGB(L.sky[0], L.sky[1], L.sky[2]);
    this.hemi.groundColor.setRGB(L.ground[0], L.ground[1], L.ground[2]);
    this.hemi.intensity = 1.25 * L.amb;
    this.key.color.setRGB(L.key[0], L.key[1], L.key[2]);
    this.key.position.set(focus.x + 7, 22, focus.z + 6);
    this.key.target.position.set(focus.x, 0, focus.z - 3);

    // --- nearest prop lights
    const fd = -focus.z + (this.camMode === 'run' || this.camMode === 'boss' ? 7 : 0);
    const best = this._best || (this._best = []);
    best.length = 0;
    for (const l of this.lights) {
      const dist = Math.abs(l.d - fd);
      if (dist > 34) continue;
      l._w = dist;
      best.push(l);
    }
    best.sort((a, b) => a._w - b._w);
    for (let i = 0; i < this.propLights.length; i++) {
      const pl = this.propLights[i], l = best[i];
      if (!l) { pl.intensity = 0; continue; }
      const fade = 1 - smoothstep(20, 33, l._w);
      const fl = 1 + l.flicker * (Math.sin(t * 9 + l.phase) * 0.6 + Math.sin(t * 23 + l.phase * 1.7) * 0.4);
      pl.position.set(l.x, l.y, l.z);
      pl.color.copy(l.color);
      pl.intensity = l.intensity * fade * fl;
    }

    // --- camera rig
    const cfg = CAMS[this.camMode][this.portrait ? 'p' : 'l'];
    const tp = _v1.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    if (this.camMode === 'shop' || this.camMode === 'draw') {
      this.orbit += dt * (this.camMode === 'shop' ? 0.1 : 0.05);
      const a = Math.sin(this.orbit) * (this.camMode === 'shop' ? 0.5 : 0.22);
      tp.applyAxisAngle(_up, a);
    }
    tp.multiplyScalar(this.zoom).add(focus);
    const tl = _v2.set(cfg.look[0], cfg.look[1], cfg.look[2]).add(focus);
    if (this.camSnap) { this.camPos.copy(tp); this.camLook.copy(tl); this.camera.fov = cfg.fov; this.camSnap = false; this.viewShiftCur.x = this.viewShift.x; this.viewShiftCur.y = this.viewShift.y; }
    else {
      const k = this.camMode === 'run' || this.camMode === 'boss' ? 6 : 2.6;
      this.camPos.x = damp(this.camPos.x, tp.x, k, dt); this.camPos.y = damp(this.camPos.y, tp.y, k, dt); this.camPos.z = damp(this.camPos.z, tp.z, k * 1.6, dt);
      this.camLook.x = damp(this.camLook.x, tl.x, k, dt); this.camLook.y = damp(this.camLook.y, tl.y, k, dt); this.camLook.z = damp(this.camLook.z, tl.z, k * 1.6, dt);
      this.camera.fov = damp(this.camera.fov, cfg.fov + this.speedK * 7, 3, dt);
    }
    // keep the camera inside the rock
    const cd = -this.camPos.z, lim = caveW(cd) * 0.6;
    this.camera.position.copy(this.camPos);
    this.camera.position.x = clamp(this.camera.position.x, -lim, lim);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * this.shakeAmt * 0.5;
      this.camera.position.x += (Math.sin(t * 91) + Math.sin(t * 57.3)) * s * 0.5;
      this.camera.position.y += (Math.sin(t * 83 + 1) + Math.sin(t * 47.1)) * s * 0.5;
      this.shakeAmt *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.camLook);
    this.viewShiftCur.x = damp(this.viewShiftCur.x, this.viewShift.x, 4, dt);
    this.viewShiftCur.y = damp(this.viewShiftCur.y, this.viewShift.y, 4, dt);
    if (Math.abs(this.viewShiftCur.x) > 0.001 || Math.abs(this.viewShiftCur.y) > 0.001) {
      this.camera.setViewOffset(this.w, this.h, -this.viewShiftCur.x * this.w, -this.viewShiftCur.y * this.h, this.w, this.h);
    } else if (this.camera.view) this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();

    this.haloMat.uniforms.uTime.value = t;
    this.haloMat.uniforms.uScale.value = this.h * this.pixelRatio * 0.5 / Math.tan((this.camera.fov * Math.PI) / 360) * 0.5;
    this.haloMat.uniforms.uFog.value = this.scene.fog.density * 0.8;
    if (this.flashAmt > 0.001) this.flashAmt *= Math.exp(-5 * dt); else this.flashAmt = 0;
    this.grade.uniforms.uFlashAmt.value = this.flashAmt;
  }

  render() { this.composer.render(); }

  /** Project a world position to CSS pixels. Returns null when behind the camera. */
  toScreen(x, y, z, out) {
    _v1.set(x, y, z).project(this.camera);
    if (_v1.z > 1) return null;
    out.x = (_v1.x * 0.5 + 0.5) * this.w;
    out.y = (-_v1.y * 0.5 + 0.5) * this.h;
    return out;
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
