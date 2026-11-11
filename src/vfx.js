// Everything that glows, flies, bounces or explodes.
import * as THREE from 'three';
import { glowTexture } from './world.js';
import { clamp, lerp, damp } from './geo.js';
import { RUNES, biomeAt } from './data.js';

export const ELEMENT_COLOR = {
  fire: new THREE.Color(0xff6a1a), storm: new THREE.Color(0x8fcaff), frost: new THREE.Color(0x6fe8ff),
  arcane: new THREE.Color(0xb06cff), void: new THREE.Color(0xff3fc8), wisp: new THREE.Color(0xbfe8ff),
  phys: new THREE.Color(0xffd890),
  steel: new THREE.Color(0xffd0c0), iron: new THREE.Color(0xffa040), earth: new THREE.Color(0xd09a48),
  blood: new THREE.Color(0xff2a5a), spirit: new THREE.Color(0x8fdcff),
};
export const ORC_HEIGHT = { grunt: 1.25, whelp: 0.8, archer: 1.2, brute: 2.0, shaman: 1.25, loot: 1.15, champion: 2.5, boss: 3.7 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _s = new THREE.Vector3(), _zAxis = new THREE.Vector3(0, 0, 1), _c = new THREE.Color();
const rand = (a, b) => a + Math.random() * (b - a);

// ================================================================ particles
class Particles {
  constructor(scene, cap, blending) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 4);      // r,g,b, startSize
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.misc = new Float32Array(cap * 3);      // gravity, drag, endSize factor
    this.next = 0;
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uMap: { value: glowTexture }, uFog: { value: 0.02 } },
      vertexShader: `
        attribute vec4 pcol; attribute float psize; varying vec4 vCol; uniform float uScale; uniform float uFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / max(0.1, -mv.z);
          float f = uFog * -mv.z; vCol = vec4(pcol.rgb, pcol.a * exp(-f * f));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec4 vCol;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a * vCol.a; if (a < 0.003) discard; gl_FragColor = vec4(vCol.rgb, a); }`,
      blending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0, endSize = 0) {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.base[i4] = r; this.base[i4 + 1] = g; this.base[i4 + 2] = b; this.base[i4 + 3] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.misc[i3] = grav; this.misc[i3 + 1] = drag; this.misc[i3 + 2] = endSize;
  }
  update(dt) {
    const { pos, vel, col, size, base, life, maxLife, misc, cap } = this;
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) continue;
      const i3 = i * 3, i4 = i * 4;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[i4 + 3] = 0; continue; }
      const drag = misc[i3 + 1];
      if (drag) { const k = Math.exp(-drag * dt); vel[i3] *= k; vel[i3 + 1] *= k; vel[i3 + 2] *= k; }
      vel[i3 + 1] -= misc[i3] * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.03 && misc[i3] > 0) { pos[i3 + 1] = 0.03; vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      const k = life[i] / maxLife[i];
      const fade = k < 0.5 ? k * 2 : 1;
      col[i4] = base[i4]; col[i4 + 1] = base[i4 + 1]; col[i4 + 2] = base[i4 + 2]; col[i4 + 3] = fade;
      size[i] = base[i4 + 3] * (misc[i3 + 2] + (1 - misc[i3 + 2]) * k);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcol.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.size.fill(0); }
}

// ================================================================ generic pool
class Pool {
  constructor(make) { this.make = make; this.free = []; this.live = []; }
  get() { const o = this.free.pop() || this.make(); this.live.push(o); return o; }
  release(i) { const o = this.live[i]; this.live[i] = this.live[this.live.length - 1]; this.live.pop(); this.free.push(o); return o; }
}

export class Vfx {
  constructor(world) {
    this.world = world;
    const scene = this.scene = world.scene;
    this.glow = new Particles(scene, 3600, THREE.AdditiveBlending);
    this.smoke = new Particles(scene, 500, THREE.NormalBlending);
    this.t = 0;
    this.onCoin = null;
    this.magePos = new THREE.Vector3();                 // where coins fly to: the hero on point
    this.tips = [new THREE.Vector3(0, 2.4, 0), new THREE.Vector3(0, 2.4, 0)];   // weapon tip of each hero in the party
    this.heroPos = [new THREE.Vector3(), new THREE.Vector3()];
    this.lod = 1;                                       // < 1 while fast-forwarding: fewer particles, same game
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- coins
    const COINS = this.COINS = 280;
    const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 8);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.9, roughness: 0.3, emissive: 0xff9a10, emissiveIntensity: 0.75 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, COINS);
    this.coinMesh.frustumCulled = false; this.coinMesh.count = 0;
    scene.add(this.coinMesh);
    this.coins = [];

    // ---- debris
    const DEB = this.DEB = 220;
    this.debMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), DEB);
    this.debMesh.frustumCulled = false; this.debMesh.count = 0;
    this.debMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEB * 3), 3);
    scene.add(this.debMesh);
    this.debris = [];

    // ---- lightning segments
    const SEG = this.SEG = 360;
    this.boltMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), SEG);
    this.boltMesh.frustumCulled = false; this.boltMesh.count = 0;
    this.boltMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SEG * 3), 3);
    scene.add(this.boltMesh);
    this.bolts = [];

    // ---- rings and flashes
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new Pool(() => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      scene.add(m); return { m };
    });
    const sphGeo = new THREE.IcosahedronGeometry(1, 2);
    this.flashes = new Pool(() => {
      const m = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(m); return { m };
    });
    // sword arcs: one shared wedge, re-aimed and scaled per swing
    const arcGeo = new THREE.RingGeometry(0.45, 1, 28, 1, Math.PI / 2 - 1.35, 2.7);
    arcGeo.rotateX(-Math.PI / 2);
    this.slashes = new Pool(() => {
      const m = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      scene.add(m); return { m };
    });
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 30, 1.6); scene.add(l); this.lights.push({ l, t: 0, dur: 1, peak: 0 }); }

    // ---- projectile visuals
    this.projGeo = {
      orb: new THREE.IcosahedronGeometry(1, 1),
      lance: new THREE.OctahedronGeometry(1, 0),
      shaft: new THREE.CylinderGeometry(0.035, 0.035, 0.8, 5),
      blade: new THREE.BoxGeometry(0.06, 0.36, 0.34),
    };
    this.projFree = {};
    this.projLive = new Map();

    // ---- void zones, meteors, telegraphs
    this.zones = new Map();
    this.zoneFree = [];
    this.meteors = [];

    // ---- mage attachments
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 3), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x6ab8ff) }, uAlpha: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uHit; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          float hexa = 0.5 + 0.5 * sin(vP.y * 9.0 + uTime * 3.0) * sin(vP.x * 9.0) * sin(vP.z * 9.0);
          float a = (f * 1.3 + hexa * 0.1) * uAlpha + uHit * 0.5 * (0.3 + f);
          gl_FragColor = vec4(uColor * (1.0 + uHit * 1.5), a); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.shield.visible = false; this.shield.renderOrder = 4;
    scene.add(this.shield);
    this.shields = [this.shield, new THREE.Mesh(this.shield.geometry, this.shield.material.clone())];
    this.shields[1].visible = false; this.shields[1].renderOrder = 4;
    scene.add(this.shields[1]);
    this.shieldK = [0, 0]; this.shieldHit = [0, 0];
    this.wisps = [];
    const wispMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe8ff).multiplyScalar(3) });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.projGeo.orb, wispMat);
      m.scale.setScalar(0.14); m.visible = false;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x9fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.setScalar(9); m.add(sp);
      scene.add(m); this.wisps.push(m);
    }
    this.wispCount = 0;
    this.dustT = 0;
  }

  /** Build one of everything pooled so the first fight does not hitch on shader compiles. */
  prewarm() {
    for (const kind of ['fireball', 'lance', 'missile', 'wisp', 'hex', 'axe', 'haxe']) this.freeProj(this.makeProj(kind));
    const c = ELEMENT_COLOR.fire;
    for (let i = 0; i < 6; i++) { this.ring(0, -50, 0, c, 1, 0.01); this.flash(0, -50, 0, c, 1, 0.01); }
    this.addZone({ id: -1, x: 0, d: 0, r: 1, t: 0, dur: 0.01, dead: true });
    this.addMeteor(0, 0, 0.01, 1);
    this.coinMesh.count = 1; this.debMesh.count = 1; this.boltMesh.count = 1;
    this.shield.visible = true;
    for (const w of this.wisps) w.visible = true;
  }

  reset() {
    this.glow.clear(); this.smoke.clear();
    this.coins.length = 0; this.coinMesh.count = 0;
    this.debris.length = 0; this.debMesh.count = 0;
    this.bolts.length = 0; this.boltMesh.count = 0;
    while (this.rings.live.length) { this.rings.live[0].m.visible = false; this.rings.release(0); }
    while (this.flashes.live.length) { this.flashes.live[0].m.visible = false; this.flashes.release(0); }
    while (this.slashes.live.length) { this.slashes.live[0].m.visible = false; this.slashes.release(0); }
    for (const [, v] of this.projLive) this.freeProj(v);
    this.projLive.clear();
    for (const [, z] of this.zones) { z.g.visible = false; this.zoneFree.push(z); }
    this.zones.clear();
    for (const m of this.meteors) { m.mesh.visible = false; m.ring.visible = false; }
    this.meteors.length = 0;
    for (const l of this.lights) { l.l.intensity = 0; l.t = 0; }
    for (const sh of this.shields) sh.visible = false;
    this.shieldK = [0, 0];
  }

  // ------------------------------------------------------------ primitives
  burst(x, y, z, color, n, speed, size, life, o = {}) {
    const up = o.up ?? 0.5, grav = o.grav ?? 0, drag = o.drag ?? 2, sys = o.smoke ? this.smoke : this.glow, k = o.boost ?? 1.6;
    if (this.lod < 1) n = Math.max(1, Math.round(n * this.lod));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = Math.acos(rand(-1, 1)), sp = speed * rand(0.35, 1);
      const vx = Math.sin(e) * Math.cos(a) * sp, vy = Math.cos(e) * sp + up * speed, vz = Math.sin(e) * Math.sin(a) * sp;
      const j = o.jitter ?? 0.2;
      sys.emit(x + rand(-j, j), y + rand(-j, j), z + rand(-j, j), vx, vy, vz, color.r * k, color.g * k, color.b * k, size * rand(0.6, 1.2), life * rand(0.6, 1.2), grav, drag, o.end ?? 0);
    }
  }
  ring(x, y, z, color, radius, dur = 0.4, k = 2) {
    const r = this.rings.get();
    r.m.visible = true; r.m.position.set(x, y, z);
    r.m.material.color.copy(color).multiplyScalar(k);
    r.t = 0; r.dur = dur; r.radius = radius; r.shrink = false;
    return r;
  }
  flash(x, y, z, color, radius, dur = 0.22, k = 2.5) {
    const f = this.flashes.get();
    f.m.visible = true; f.m.position.set(x, y, z);
    f.m.material.color.copy(color).multiplyScalar(k);
    f.t = 0; f.dur = dur; f.radius = radius;
  }
  slash(x, z, ang, radius, color) {
    const sl = this.slashes.get();
    sl.m.visible = true; sl.m.position.set(x, 1.1, z);
    sl.m.rotation.y = -ang; sl.ang = ang; sl.dir = Math.random() < 0.5 ? 1 : -1;
    sl.m.material.color.copy(color).multiplyScalar(2.2);
    sl.t = 0; sl.dur = 0.17; sl.radius = radius;
    // sparks along the edge of the cut
    for (let i = 0; i < 7; i++) {
      const a = ang + rand(-1.2, 1.2), r = radius * rand(0.75, 1);
      this.glow.emit(x + Math.sin(a) * r, rand(0.7, 1.6), z - Math.cos(a) * r, Math.sin(a) * 6, rand(0, 3), -Math.cos(a) * 6, color.r * 1.8, color.g * 1.8, color.b * 1.8, rand(0.22, 0.4), 0.22, 6, 3, 0);
    }
  }
  light(x, y, z, color, peak, dur = 0.35) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.t <= 0) { best = l; break; } else if (l.t / l.dur < best.t / best.dur) best = l;
    best.l.position.set(x, y, z); best.l.color.copy(color);
    best.t = dur; best.dur = dur; best.peak = peak * 0.3;
  }
  spawnDebris(x, y, z, color, n, speed, dirX = 0, dirZ = 0) {
    if (this.lod < 1) n = Math.round(n * this.lod);
    for (let i = 0; i < n && this.debris.length < this.DEB; i++) {
      this.debris.push({
        x, y: y + rand(-0.3, 0.5), z, vx: rand(-1, 1) * speed + dirX * speed, vy: rand(2, 7), vz: rand(-1, 1) * speed + dirZ * speed,
        rx: rand(0, 6), ry: rand(0, 6), spin: rand(-12, 12), life: rand(0.7, 1.3), max: 1.3, s: rand(0.5, 1.5),
        r: color.r * rand(0.7, 1.1), g: color.g * rand(0.7, 1.1), b: color.b * rand(0.7, 1.1),
      });
    }
  }
  spawnCoins(x, z, value, n) {
    if (this.lod < 1) n = Math.max(1, Math.round(n * this.lod));
    const each = value / n;
    for (let i = 0; i < n; i++) {
      if (this.coins.length >= this.COINS) { this.onCoin && this.onCoin(each, false); continue; }
      const a = Math.random() * 6.283, sp = rand(1.5, 4.5);
      this.coins.push({ x, y: rand(0.8, 1.6), z, vx: Math.cos(a) * sp, vy: rand(5, 9.5), vz: Math.sin(a) * sp, t: 0, home: rand(0.28, 0.5) + i * 0.01, rot: rand(0, 6), spin: rand(8, 16), value: each, sp: 14 });
    }
  }

  // ------------------------------------------------------------ recipes
  explosion(kind, x, z, r) {
    const W = this.world;
    if (kind === 'fire') {
      const c = ELEMENT_COLOR.fire;
      this.flash(x, 1.0, z, c, r * 0.75, 0.24, 3);
      this.ring(x, 0.12, z, c, r, 0.38, 2.4);
      this.burst(x, 1, z, c, 26, 7, 0.9, 0.5, { up: 0.35, drag: 3 });
      this.burst(x, 1, z, _c.setRGB(1, 0.85, 0.4), 12, 9, 0.28, 0.7, { up: 0.6, grav: 14, drag: 0.5 });
      this.burst(x, 1.2, z, _c.setRGB(0.09, 0.07, 0.06), 6, 2.2, 2.4, 0.9, { smoke: true, up: 0.8, boost: 1, end: 1.6 });
      this.light(x, 1.6, z, c, 420, 0.35);
      W.shake(0.32);
    } else if (kind === 'overload') {
      const c = _c.setRGB(1, 0.9, 0.4).clone();
      this.flash(x, 1.1, z, c, r * 0.8, 0.2, 3.2);
      this.ring(x, 0.14, z, c, r * 1.1, 0.3, 2.6);
      this.burst(x, 1.1, z, c, 30, 12, 0.5, 0.35, { drag: 4 });
      this.light(x, 1.6, z, c, 520, 0.3);
      W.shake(0.4);
    } else if (kind === 'corpse') {
      const c = _c.setRGB(0.7, 1, 0.3).clone();
      this.ring(x, 0.12, z, c, r, 0.3, 1.5);
      this.burst(x, 1, z, c, 14, 7, 0.5, 0.4, { drag: 3 });
    } else if (kind === 'meteor') {
      const c = ELEMENT_COLOR.fire;
      this.flash(x, 1.2, z, _c.setRGB(1, 0.8, 0.5), r * 1.0, 0.34, 4);
      this.ring(x, 0.14, z, c, r * 1.3, 0.55, 3);
      this.ring(x, 0.16, z, _c.setRGB(1, 0.9, 0.6), r * 0.8, 0.35, 3);
      this.burst(x, 1, z, c, 60, 13, 1.3, 0.75, { up: 0.5, drag: 2.5 });
      this.burst(x, 1, z, _c.setRGB(1, 0.85, 0.4), 30, 16, 0.32, 1.0, { up: 0.7, grav: 16, drag: 0.4 });
      this.burst(x, 1.4, z, _c.setRGB(0.08, 0.06, 0.05), 12, 3.5, 3.4, 1.3, { smoke: true, up: 0.9, boost: 1, end: 1.7 });
      this.spawnDebris(x, 0.4, z, _c.setRGB(0.25, 0.2, 0.18), 14, 6);
      this.light(x, 2.5, z, c, 1100, 0.55);
      W.shake(0.95);
      W.flash(0xff8030, 0.35);
    } else if (kind === 'nova') {
      const c = ELEMENT_COLOR.fire;
      this.flash(x, 1.4, z, _c.setRGB(1, 0.85, 0.5), r * 0.9, 0.5, 4);
      for (let i = 0; i < 3; i++) this.ring(x, 0.14 + i * 0.02, z, i ? c : _c.setRGB(1, 0.9, 0.6), r * (1 + i * 0.25), 0.45 + i * 0.15, 3);
      this.burst(x, 1.5, z, c, 90, 15, 1.2, 0.9, { up: 0.3, drag: 2 });
      this.burst(x, 1.5, z, _c.setRGB(1, 0.9, 0.5), 50, 9, 0.4, 1.4, { up: 1.2, drag: 1 });
      this.light(x, 3, z, c, 1500, 0.8);
      W.shake(1.1);
      W.flash(0xffc060, 0.6);
    } else if (kind === 'quake') {
      const c = ELEMENT_COLOR.earth;
      this.ring(x, 0.12, z, c, r, 0.34, 2.4);
      this.ring(x, 0.14, z, _c.setRGB(1, 0.85, 0.5), r * 0.6, 0.24, 2);
      this.burst(x, 0.3, z, _c.setRGB(0.3, 0.25, 0.2), 14, 6, 1.3, 0.6, { smoke: true, up: 0.7, boost: 1, end: 1.6 });
      this.burst(x, 0.4, z, c, 22, 9, 0.36, 0.5, { up: 0.6, grav: 16, drag: 0.6 });
      this.spawnDebris(x, 0.3, z, _c.setRGB(0.28, 0.24, 0.2), 9, 6);
      this.light(x, 1.4, z, c, 380, 0.3);
      W.shake(0.42);
    } else if (kind === 'judge') {
      const c = ELEMENT_COLOR.spirit;
      this.flash(x, 1.6, z, _c.setRGB(0.8, 0.95, 1), r * 0.85, 0.28, 3.6);
      this.ring(x, 0.13, z, c, r * 1.2, 0.45, 3);
      this.burst(x, 1.2, z, c, 46, 13, 0.7, 0.55, { up: 0.5, drag: 3 });
      this.burst(x, 3, z, _c.setRGB(0.9, 0.97, 1), 16, 4, 0.3, 0.8, { up: 1.5, drag: 1 });
      this.light(x, 2.4, z, c, 800, 0.45);
      W.shake(0.6);
    } else if (kind === 'rupture') {
      const c = _c.setRGB(1, 0.2, 0.15).clone();
      this.flash(x, 1.1, z, c, r * 0.7, 0.18, 3);
      this.ring(x, 0.14, z, c, r, 0.28, 2.4);
      this.burst(x, 1.1, z, c, 26, 10, 0.45, 0.4, { grav: 10, drag: 2 });
      this.light(x, 1.5, z, c, 420, 0.26);
      W.shake(0.34);
    } else if (kind === 'void') {
      const c = ELEMENT_COLOR.void;
      this.flash(x, 1.3, z, c, r * 0.9, 0.3, 3.5);
      this.ring(x, 0.14, z, c, r * 1.25, 0.45, 3);
      this.burst(x, 1.3, z, c, 46, 14, 0.7, 0.55, { drag: 3 });
      this.burst(x, 1.3, z, _c.setRGB(0.75, 0.6, 1), 20, 6, 0.3, 0.9, { up: 0.6 });
      this.light(x, 1.8, z, c, 700, 0.45);
      W.shake(0.6);
    }
  }

  hitSpark(x, y, z, element, crit) {
    if (this.lod < 0.4 && !crit) return;
    const c = ELEMENT_COLOR[element] || ELEMENT_COLOR.phys;
    this.burst(x, y, z, c, crit ? 14 : 6, crit ? 9 : 5, crit ? 0.5 : 0.36, 0.28, { drag: 5, jitter: 0.25 });
    if (element === 'frost') this.burst(x, y, z, _c.setRGB(0.9, 1, 1), 5, 4, 0.2, 0.5, { grav: 9, drag: 1 });
    if (crit) this.flash(x, y, z, c, 0.9, 0.14, 2.2);
  }

  killBurst(e, element, dirX, dirZ) {
    const x = e.x, z = -e.d, h = ORC_HEIGHT[e.type] || 1.2, big = e.def.elite ? 3 : e.def.heavy ? 1.8 : 1;
    const c = ELEMENT_COLOR[element] || ELEMENT_COLOR.phys;
    this.burst(x, h, z, c, Math.round(14 * big), 7 * Math.sqrt(big), 0.6 * Math.sqrt(big), 0.45, { up: 0.4, drag: 3 });
    this.burst(x, h, z, _c.setRGB(0.55, 0.95, 0.3), Math.round(8 * big), 4.5, 0.42, 0.5, { up: 0.5, grav: 12, drag: 1 });
    // a little soul wisp
    this.glow.emit(x, h + 0.3, z, rand(-0.3, 0.3), 3.2, rand(-0.3, 0.3), 0.6, 1.1, 0.75, 0.55 * Math.sqrt(big), 0.6, -1, 1, 0.2);
    this.spawnDebris(x, h, z, _c.setRGB(0.2, 0.4, 0.12), Math.round(5 * big), 3.2, dirX * 0.8, dirZ * 0.8);
    this.spawnDebris(x, h, z, _c.setRGB(0.3, 0.26, 0.22), Math.round(2 * big), 3.2, dirX * 0.8, dirZ * 0.8);
    if (element === 'frost') this.spawnDebris(x, h, z, _c.setRGB(0.6, 0.95, 1.2), 7, 4.5, dirX, dirZ);
    if (big > 1) { this.ring(x, 0.12, z, c, 2.2 * big, 0.4, 2); this.light(x, h, z, c, 300 * big, 0.4); this.world.shake(0.2 * big); }
  }

  castFlash(rune, hero = 0) {
    if (this.lod < 0.4) return;
    const R = RUNES[rune], c = _c.set(R.hex).clone(), p = this.tips[hero];
    this.burst(p.x, p.y, p.z, c, 8, 3.5, 0.5, 0.25, { drag: 4, jitter: 0.05 });
    this.flash(p.x, p.y, p.z, c, 0.55, 0.12, 2.4);
  }

  // ------------------------------------------------------------ projectiles
  makeProj(kind) {
    const mk = (geo, color, k) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
    const withGlow = (m, color, size) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.setScalar(size); m.add(sp); return m;
    };
    let m;
    if (kind === 'fireball') { m = withGlow(mk(this.projGeo.orb, 0xff8a2a, 3.2), 0xff6a1a, 7.5); m.scale.setScalar(0.34); }
    else if (kind === 'lance') { m = withGlow(mk(this.projGeo.lance, 0x9ff4ff, 2.8), 0x5fe6ff, 3.2); m.scale.set(0.2, 0.2, 1.25); }
    else if (kind === 'missile') { m = withGlow(mk(this.projGeo.orb, 0xc58bff, 3.2), 0xb06cff, 6.5); m.scale.setScalar(0.19); }
    else if (kind === 'wisp') { m = withGlow(mk(this.projGeo.orb, 0xdff4ff, 3.2), 0x9fd8ff, 6); m.scale.setScalar(0.12); }
    else if (kind === 'haxe') {
      m = withGlow(new THREE.Mesh(this.projGeo.shaft, new THREE.MeshStandardMaterial({ color: 0x8a6a48, emissive: 0x4a2a10 })), 0xffa040, 3.4);
      const blade = new THREE.Mesh(this.projGeo.blade, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(2.4) }));
      blade.position.set(0, 0.3, 0.14); m.add(blade); m.scale.setScalar(1.5);
    }
    else if (kind === 'hex') { m = withGlow(mk(this.projGeo.orb, 0xb040ff, 2.6), 0x9a30e0, 7); m.scale.setScalar(0.24); }
    else {   // a thrown axe, tumbling end over end
      m = new THREE.Mesh(this.projGeo.shaft, new THREE.MeshStandardMaterial({ color: 0x8a6a48, emissive: 0x3a2410 }));
      const blade = new THREE.Mesh(this.projGeo.blade, new THREE.MeshStandardMaterial({ color: 0xd8d8e4, emissive: 0x6a6a78, metalness: 0.6, roughness: 0.35 }));
      blade.position.set(0, 0.3, 0.14); m.add(blade);
      m.scale.setScalar(1.25);
    }
    this.scene.add(m);
    return { m, kind };
  }
  freeProj(v) { v.m.visible = false; (this.projFree[v.kind] || (this.projFree[v.kind] = [])).push(v); }

  syncProjectiles(sim, dt) {
    const live = this.projLive;
    for (const p of sim.projectiles) {
      if (p.delay > 0) continue;
      let v = live.get(p.id);
      const tx = p.x, tz = -p.d;
      if (!v) {
        v = (this.projFree[p.kind] && this.projFree[p.kind].pop()) || this.makeProj(p.kind);
        v.m.visible = true; v.age = 0;
        if (p.hostile) v.m.position.set(tx, 1.7, tz);
        else if (p.kind === 'wisp') v.m.position.copy(this.wisps[(p.by ? p.by.idx : 0) * 3 + p.wisp].position);
        else v.m.position.copy(this.tips[p.by ? p.by.idx : 0]);
        v.px = v.m.position.x; v.py = v.m.position.y; v.pz = v.m.position.z;
        live.set(p.id, v);
      }
      v.age += dt;
      const m = v.m;
      v.px = m.position.x; v.py = m.position.y; v.pz = m.position.z;
      // horizontal position follows the sim; height eases from the staff to chest level
      const blend = clamp(v.age * 9);
      m.position.x = lerp(m.position.x, tx, blend);
      m.position.z = lerp(m.position.z, tz, blend);
      const targetY = p.hostile ? 1.5 + Math.sin(Math.min(1, v.age * 1.6) * Math.PI) * 1.1 : p.kind === 'fireball' ? 1.25 + Math.sin(clamp(v.age * 2.2) * Math.PI) * 0.5 : 1.2;
      m.position.y = damp(m.position.y, targetY, 7, dt);
      const dx = m.position.x - v.px, dy = m.position.y - v.py, dz = m.position.z - v.pz;
      if (p.kind === 'haxe') { m.rotation.x += dt * 26; m.rotation.y = Math.atan2(dx, dz); for (let i = 0; i < 2; i++) this.glow.emit(m.position.x - dx * i * 0.5, m.position.y, m.position.z - dz * i * 0.5, 0, 0, 0, 1.9, 1.0, 0.35, 0.34, 0.2, 0, 0, 0); }
      else if (p.kind === 'axe') { m.rotation.x -= dt * 22; m.rotation.y = Math.atan2(dx, dz); if (Math.random() < dt * 30) this.glow.emit(m.position.x, m.position.y, m.position.z, 0, 0, 0, 0.9, 0.9, 1.0, 0.22, 0.16, 0, 0, 0); }
      else if (p.kind === 'lance') {
        if (dx * dx + dz * dz > 1e-6) { _v.set(m.position.x + dx, m.position.y + dy, m.position.z + dz); m.lookAt(_v); }
      } else { m.rotation.x += dt * 9; m.rotation.y += dt * 7; }
      // trails
      const g = this.glow, x = m.position.x, y = m.position.y, z = m.position.z;
      if (p.kind === 'fireball') {
        for (let i = 0; i < 3; i++) { const k = i / 3; g.emit(x - dx * k + rand(-0.1, 0.1), y - dy * k + rand(-0.1, 0.1), z - dz * k + rand(-0.1, 0.1), rand(-0.6, 0.6), rand(0.2, 1.4), rand(-0.6, 0.6), 1.9, 0.62 + Math.random() * 0.4, 0.14, rand(0.5, 0.9), rand(0.2, 0.36), 0, 1, 0); }
        if (Math.random() < 0.35) this.smoke.emit(x, y, z, 0, 0.8, 0, 0.1, 0.08, 0.07, 1.0, 0.6, 0, 1, 1.8);
      } else if (p.kind === 'lance') {
        for (let i = 0; i < 2; i++) { const k = i / 2; g.emit(x - dx * k, y - dy * k, z - dz * k, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5), 0.6, 1.5, 1.8, rand(0.25, 0.5), rand(0.2, 0.4), 2, 1, 0); }
      } else if (p.kind === 'missile') {
        for (let i = 0; i < 2; i++) { const k = i / 2; g.emit(x - dx * k, y - dy * k, z - dz * k, 0, 0, 0, 1.25, 0.65, 2.0, 0.42, 0.3, 0, 0, 0); }
      } else if (p.kind === 'wisp') {
        g.emit(x, y, z, 0, 0, 0, 1.0, 1.5, 1.9, 0.3, 0.2, 0, 0, 0);
      } else if (p.kind === 'hex') {
        g.emit(x + rand(-0.1, 0.1), y + rand(-0.1, 0.1), z, 0, 0.3, 0, 1.1, 0.3, 1.6, 0.5, 0.3, 0, 0, 0);
      }
    }
  }
  endProjectile(p, hit) {
    const v = this.projLive.get(p.id);
    const x = v ? v.m.position.x : p.x, y = v ? v.m.position.y : 1.3, z = v ? v.m.position.z : -p.d;
    if (v) { this.projLive.delete(p.id); this.freeProj(v); }
    if (p.kind === 'haxe') this.burst(x, y, z, ELEMENT_COLOR.iron, 10, 6, 0.36, 0.3, { grav: 10, drag: 2 });
    else if (p.kind === 'lance') { this.burst(x, y, z, ELEMENT_COLOR.frost, 12, 6, 0.4, 0.4, { grav: 8, drag: 1 }); }
    else if (p.kind === 'missile') { this.burst(x, y, z, ELEMENT_COLOR.arcane, 10, 5, 0.45, 0.3, { drag: 4 }); this.flash(x, y, z, ELEMENT_COLOR.arcane, 0.8, 0.14, 2); }
    else if (p.kind === 'wisp') this.burst(x, y, z, ELEMENT_COLOR.wisp, 5, 4, 0.3, 0.22, { drag: 4 });
    else if (p.kind === 'hex' && hit) this.burst(x, y, z, _c.setRGB(0.7, 0.25, 1), 12, 5, 0.5, 0.35, { drag: 3 });
  }

  // ------------------------------------------------------------ lightning
  bolt(points, color = ELEMENT_COLOR.storm, width = 0.085) {
    this.bolts.push({ pts: points.map(p => p.clone()), t: 0, dur: 0.2, jit: 0, segs: [], color: color.clone(), width });
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      this.burst(p.x, p.y, p.z, color, 9, 6, 0.36, 0.26, { drag: 5 });
      this.flash(p.x, p.y, p.z, color, 0.75, 0.12, 2.2);
    }
    const last = points[Math.min(1, points.length - 1)];
    this.light(last.x, last.y + 0.5, last.z, color, 380, 0.2);
  }
  jitterBolt(b) {
    b.segs.length = 0;
    for (let i = 1; i < b.pts.length; i++) {
      const a = b.pts[i - 1], c = b.pts[i];
      const len = a.distanceTo(c), n = Math.max(3, Math.min(10, Math.round(len / 1.1)));
      let px = a.x, py = a.y, pz = a.z;
      for (let k = 1; k <= n; k++) {
        const t = k / n, amp = Math.sin(t * Math.PI) * Math.min(0.9, len * 0.14);
        const x = lerp(a.x, c.x, t) + (k < n ? rand(-amp, amp) : 0), y = lerp(a.y, c.y, t) + (k < n ? rand(-amp, amp) : 0), z = lerp(a.z, c.z, t) + (k < n ? rand(-amp, amp) : 0);
        b.segs.push(px, py, pz, x, y, z, 1);
        if (k < n && Math.random() < 0.22) b.segs.push(x, y, z, x + rand(-0.9, 0.9), y + rand(-0.2, 0.9), z + rand(-0.9, 0.9), 0.5);
        px = x; py = y; pz = z;
      }
    }
  }

  // ------------------------------------------------------------ void zones / meteors
  addZone(z) {
    let v = this.zoneFree.pop();
    if (!v) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(this.projGeo.orb, new THREE.MeshBasicMaterial({ color: 0x000000 }));
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3fc8).multiplyScalar(3), side: THREE.DoubleSide });
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 5, 36), ringMat);
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.035, 5, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a5cff).multiplyScalar(3) }));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xc030ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.setScalar(8);
      g.add(sp, core, r1, r2);
      this.scene.add(g);
      v = { g, core, r1, r2, sp };
    }
    v.g.visible = true; v.g.position.set(z.x, 1.5, -z.d); v.z = z; v.k = 0;
    this.zones.set(z.id, v);
    this.ring(z.x, 0.12, -z.d, ELEMENT_COLOR.void, z.r, 0.5, 2);
  }
  addMeteor(x, z, delay, r, spirit) {
    let m = this.meteors.find(o => o.done);
    if (!m) {
      const mesh = new THREE.Mesh(this.projGeo.orb, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a3a).multiplyScalar(3.5) }));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xff6a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.setScalar(9); mesh.add(sp);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1a).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.scene.add(mesh, ring);
      m = { mesh, ring }; this.meteors.push(m);
    }
    m.done = false; m.t = 0; m.delay = delay; m.x = x; m.z = z; m.r = r; m.spirit = !!spirit;
    m.mesh.material.color.set(spirit ? 0xbfeaff : 0xff9a3a).multiplyScalar(3.5);
    m.mesh.children[0].material.color.set(spirit ? 0x8fdcff : 0xff6a1a);
    m.ring.material.color.set(spirit ? 0x8fdcff : 0xff5a1a).multiplyScalar(2);
    m.mesh.scale.set(spirit ? 0.3 : 0.85, spirit ? 3.2 : 0.85, spirit ? 0.3 : 0.85);
    m.mesh.visible = true; m.ring.visible = true;
    m.ring.position.set(x, 0.1, z);
  }
  telegraph(x, z, r, delay, color) { const rr = this.ring(x, 0.1, z, color, r, delay, 1.6); rr.shrink = true; }

  // ------------------------------------------------------------ sim events
  handle(ev, sim) {
    switch (ev.type) {
      case 'cast': this.castFlash(ev.rune, ev.hero || 0); break;
      case 'projEnd': this.endProjectile(ev.p, ev.hit); break;
      case 'explode': this.explosion(ev.kind, ev.x, -ev.d, ev.r); break;
      case 'bolt': {
        const pts = ev.pts.map(p => p.src ? this.tips[ev.hero || 0].clone() : new THREE.Vector3(p.x, 1.2 * (p.r / 0.6) * 0.9 + 0.2, -p.d));
        this.bolt(pts);
        break;
      }
      case 'hit': if (!ev.dot) this.hitSpark(ev.x, 1.1 + ev.r * 0.6, -ev.d, ev.element, ev.crit); break;
      case 'zone': this.addZone(ev.z); break;
      case 'meteor': this.addMeteor(ev.x, -ev.d, ev.delay, ev.r, ev.spirit); break;
      case 'slash': this.slash(ev.x, -ev.d, ev.ang, ev.r, ELEMENT_COLOR.steel); break;
      case 'whirl': {
        const c = ELEMENT_COLOR.blood;
        this.ring(ev.x, 1.0, -ev.d, c, ev.r, 0.2, 1.5);
        for (let i = 0; i < 5; i++) { const a = Math.random() * 6.283; this.glow.emit(ev.x + Math.cos(a) * ev.r * 0.9, rand(0.6, 1.6), -ev.d + Math.sin(a) * ev.r * 0.9, -Math.sin(a) * 9, 0.5, Math.cos(a) * 9, 1.9, 0.35, 0.5, 0.36, 0.2, 0, 2, 0); }
        break;
      }
      case 'boonTaken': {
        const p = this.magePos, c = _c.setRGB(1, 0.85, 0.4).clone();
        for (let i = 0; i < 3; i++) this.ring(p.x, 0.1 + i * 0.03, p.z, c, 3 + i * 2, 0.5 + i * 0.2, 2.4);
        this.burst(p.x, 1.6, p.z, c, 70, 8, 0.6, 1.1, { up: 0.7, drag: 1.5 });
        this.light(p.x, 2.5, p.z, c, 700, 0.7);
        break;
      }
      case 'react': {
        const c = ev.name === 'thermal' ? _c.setRGB(1, 0.7, 0.3) : ev.name === 'overload' ? _c.setRGB(1, 0.95, 0.5) : ev.name === 'execute' || ev.name === 'rupture' ? _c.setRGB(1, 0.25, 0.2) : ev.name === 'petrify' ? _c.setRGB(0.85, 0.7, 0.45) : _c.setRGB(0.6, 0.95, 1);
        this.ring(ev.x, 0.14, -ev.d, c.clone(), 2, 0.3, 2.4);
        this.burst(ev.x, 1.3, -ev.d, c, 16, 8, 0.45, 0.4, { drag: 3 });
        break;
      }
      case 'bossSlam': this.telegraph(sim.mage.x, -sim.mage.d, 4.2, ev.delay, _c.setRGB(1, 0.15, 0.1).clone()); break;
      case 'slamHit': {
        const x = sim.mage.x, z = -sim.mage.d, c = _c.setRGB(1, 0.3, 0.15).clone();
        this.ring(x, 0.14, z, c, 6, 0.45, 2.5);
        this.burst(x, 0.4, z, _c.setRGB(0.5, 0.42, 0.36), 26, 9, 0.7, 0.7, { smoke: true, up: 0.7, boost: 1, end: 1.5 });
        this.spawnDebris(x, 0.3, z, _c.setRGB(0.3, 0.26, 0.24), 16, 7);
        this.world.shake(1.0);
        break;
      }
      case 'bossSummon': {
        const c = _c.setRGB(1, 0.2, 0.3).clone();
        this.ring(ev.e.x, 0.14, -ev.e.d, c, 7, 0.6, 2);
        this.burst(ev.e.x, 3.5, -ev.e.d, c, 30, 9, 0.7, 0.6, { drag: 2 });
        break;
      }
      case 'shieldBreak': {
        const p = this.heroPos[ev.hero || 0], c = _c.setRGB(0.45, 0.75, 1).clone();
        this.burst(p.x, 1.5, p.z, c, 34, 10, 0.5, 0.5, { drag: 3 });
        this.ring(p.x, 0.14, p.z, c, 3.5, 0.35, 2);
        break;
      }
      case 'revive': this.world.flash(0xffd070, 0.8); break;
      case 'enemyHit': {
        const p = this.heroPos[ev.hero || 0];
        this.burst(p.x, 1.5, p.z + 0.3, _c.setRGB(1, 0.2, 0.12), 8, 5, 0.42, 0.25, { drag: 4 });
        break;
      }
      case 'lootFlee': this.burst(ev.e.x, 2.4, -ev.e.d, _c.setRGB(1, 0.8, 0.2), 14, 5, 0.4, 0.6, { grav: 9, drag: 1 }); break;
      case 'escape': break;
      case 'enemyShoot': if (ev.e.type === 'shaman') this.burst(ev.e.x, 2.6, -ev.e.d, _c.setRGB(0.7, 0.25, 1), 6, 3, 0.4, 0.3, { drag: 3 }); break;
    }
  }

  // ------------------------------------------------------------ per-frame
  /**
   * @param ctx { sim?, mage:{shieldFrac, wisps, element}, depth, ambient }
   */
  update(dt, ctx) {
    this.t += dt;
    const t = this.t, world = this.world;
    const scale = world.h * world.pixelRatio * 0.5 / Math.tan((world.camera.fov * Math.PI) / 360);
    this.glow.mat.uniforms.uScale.value = scale; this.smoke.mat.uniforms.uScale.value = scale;
    this.glow.mat.uniforms.uFog.value = world.scene.fog.density * 0.7; this.smoke.mat.uniforms.uFog.value = world.scene.fog.density;

    const sim = ctx.sim;
    if (sim) {
      this.syncProjectiles(sim, dt);
      // status dressing on orcs
      for (const e of sim.enemies) {
        const h = ORC_HEIGHT[e.type] || 1.2, z = -e.d;
        if (e.burnT > 0 && e.bleed) { if (Math.random() < dt * 16) this.glow.emit(e.x + rand(-e.r, e.r) * 0.6, rand(0.5, h), z + rand(-e.r, e.r) * 0.6, rand(-1, 1), rand(0.5, 2), rand(-1, 1), 1.7, 0.08, 0.1, rand(0.16, 0.28), 0.5, 12, 0.5, 0.5); }
        else if (e.burnT > 0 && Math.random() < dt * 22) this.glow.emit(e.x + rand(-e.r, e.r) * 0.7, rand(0.3, h + 0.5), z + rand(-e.r, e.r) * 0.7, 0, rand(1.5, 3), 0, 1.9, 0.65 + Math.random() * 0.4, 0.12, rand(0.4, 0.8), 0.4, 0, 1, 0);
        if (e.chillT > 0 && e.daze) { if (Math.random() < dt * 10) { const a = this.t * 6 + e.id; this.glow.emit(e.x + Math.cos(a) * 0.5, h + 0.75, z + Math.sin(a) * 0.5, 0, 0.2, 0, 1.9, 1.6, 0.4, 0.2, 0.3, 0, 0, 0.4); } }
        else if (e.chillT > 0 && Math.random() < dt * 9) this.glow.emit(e.x + rand(-e.r, e.r), rand(0.3, h + 0.4), z + rand(-e.r, e.r), 0, -0.6, 0, 0.7, 1.4, 1.7, 0.24, 0.6, 0, 0, 0.3);
        if (e.shockT > 0 && Math.random() < dt * 12) this.glow.emit(e.x + rand(-e.r, e.r), rand(0.4, h + 0.4), z + rand(-e.r, e.r), rand(-3, 3), rand(-1, 3), rand(-3, 3), 1.1, 1.5, 2.0, 0.26, 0.14, 0, 0, 0);
        if (e.type === 'loot' && Math.random() < dt * 14) this.glow.emit(e.x + rand(-0.4, 0.4), rand(1.2, 2.2), z + rand(-0.4, 0.4), 0, 0.6, 0, 1.9, 1.4, 0.3, 0.3, 0.5, 0, 0, 0);
        if (e.type === 'boss' && e.enraged && Math.random() < dt * 30) this.glow.emit(e.x + rand(-1.5, 1.5), rand(0.5, 5.5), z + rand(-1.2, 1.2), 0, rand(1, 3), 0, 2, 0.25, 0.2, rand(0.5, 1), 0.5, 0, 1, 0);
      }
    }

    // particles
    this.glow.update(dt); this.smoke.update(dt);

    // coins
    const coins = this.coins, mp = this.magePos;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.t += dt; c.rot += c.spin * dt;
      if (c.t < c.home) {
        c.vy -= 26 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        if (c.y < 0.14) { c.y = 0.14; c.vy = Math.abs(c.vy) * 0.45; c.vx *= 0.7; c.vz *= 0.7; }
      } else {
        const dx = mp.x - c.x, dy = mp.y + 1.4 - c.y, dz = mp.z - c.z, dist = Math.hypot(dx, dy, dz);
        c.sp += 90 * dt;
        const st = c.sp * dt;
        if (dist < st + 0.5) {
          this.onCoin && this.onCoin(c.value, true);
          if (Math.random() < 0.6) this.glow.emit(c.x, c.y, c.z, 0, 1, 0, 2, 1.5, 0.35, 0.55, 0.22, 0, 0, 0);
          coins[i] = coins[coins.length - 1]; coins.pop();
          continue;
        }
        c.x += (dx / dist) * st; c.y += (dy / dist) * st; c.z += (dz / dist) * st;
      }
    }
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      _q.setFromAxisAngle(_v.set(0.3, 1, 0).normalize(), c.rot);
      _m.compose(_v2.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1));
      this.coinMesh.setMatrixAt(i, _m);
    }
    this.coinMesh.count = coins.length;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // debris
    const deb = this.debris;
    for (let i = deb.length - 1; i >= 0; i--) {
      const d = deb[i];
      d.life -= dt;
      if (d.life <= 0) { deb[i] = deb[deb.length - 1]; deb.pop(); continue; }
      d.vy -= 24 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.rx += d.spin * dt;
      if (d.y < 0.1) { d.y = 0.1; d.vy = Math.abs(d.vy) * 0.4; d.vx *= 0.6; d.vz *= 0.6; d.spin *= 0.5; }
    }
    for (let i = 0; i < deb.length; i++) {
      const d = deb[i], s = d.s * Math.min(1, d.life * 3);
      _q.setFromEuler(_e.set(d.rx, d.ry, d.rx * 0.7));
      _m.compose(_v2.set(d.x, d.y, d.z), _q, _s.set(s, s, s));
      this.debMesh.setMatrixAt(i, _m);
      this.debMesh.instanceColor.setXYZ(i, d.r, d.g, d.b);
    }
    this.debMesh.count = deb.length;
    this.debMesh.instanceMatrix.needsUpdate = true;
    this.debMesh.instanceColor.needsUpdate = true;

    // lightning
    let si = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt; b.jit -= dt;
      if (b.t >= b.dur) { this.bolts.splice(i, 1); continue; }
      if (b.jit <= 0) { this.jitterBolt(b); b.jit = 0.045; }
      const k = 1 - b.t / b.dur, segs = b.segs;
      for (let s = 0; s < segs.length && si < this.SEG; s += 7) {
        _v.set(segs[s], segs[s + 1], segs[s + 2]); _v2.set(segs[s + 3], segs[s + 4], segs[s + 5]);
        const len = _v.distanceTo(_v2), w = b.width * segs[s + 6] * (0.4 + k * 0.9);
        _s.set(w, w, len);
        _v2.sub(_v).normalize();
        _q.setFromUnitVectors(_zAxis, _v2);
        _v.addScaledVector(_v2, len / 2);
        _m.compose(_v, _q, _s);
        this.boltMesh.setMatrixAt(si, _m);
        const kk = 2 + k * 3;
        this.boltMesh.instanceColor.setXYZ(si, lerp(b.color.r, 1, 0.5) * kk, lerp(b.color.g, 1, 0.5) * kk, lerp(b.color.b, 1, 0.5) * kk);
        si++;
      }
    }
    this.boltMesh.count = si;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    this.boltMesh.instanceColor.needsUpdate = true;

    // rings / flashes / lights
    for (let i = this.rings.live.length - 1; i >= 0; i--) {
      const r = this.rings.live[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.m.visible = false; this.rings.release(i); continue; }
      const e = r.shrink ? 1 - k * 0.85 : 1 - (1 - k) * (1 - k) * (1 - k);
      r.m.scale.setScalar(Math.max(0.01, r.radius * e));
      r.m.material.opacity = r.shrink ? 0.35 + k * 0.65 : 1 - k;
    }
    for (let i = this.flashes.live.length - 1; i >= 0; i--) {
      const f = this.flashes.live[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.m.visible = false; this.flashes.release(i); continue; }
      f.m.scale.setScalar(f.radius * (0.3 + 0.7 * (1 - (1 - k) * (1 - k))));
      f.m.material.opacity = (1 - k) * (1 - k);
    }
    for (let i = this.slashes.live.length - 1; i >= 0; i--) {
      const sl = this.slashes.live[i];
      sl.t += dt;
      const k = sl.t / sl.dur;
      if (k >= 1) { sl.m.visible = false; this.slashes.release(i); continue; }
      sl.m.scale.setScalar(sl.radius * (0.75 + k * 0.3));
      sl.m.rotation.y = -sl.ang + sl.dir * (k - 0.5) * 0.9;
      sl.m.material.opacity = (1 - k) * 0.9;
    }
    for (const l of this.lights) {
      if (l.t > 0) { l.t -= dt; const k = Math.max(0, l.t / l.dur); l.l.intensity = l.peak * k * k; } else l.l.intensity = 0;
    }

    // void zones
    for (const [id, v] of this.zones) {
      const z = v.z;
      if (z.dead || z.t >= z.dur) { v.g.visible = false; this.zones.delete(id); this.zoneFree.push(v); continue; }
      v.k = damp(v.k, 1, 9, dt);
      const pulse = 1 + Math.sin(t * 18) * 0.06, end = clamp((z.dur - z.t) / 0.25);
      v.core.scale.setScalar(0.95 * v.k * pulse * (0.4 + 0.6 * end));
      v.r1.rotation.set(1.2 + Math.sin(t * 2) * 0.3, t * 5, 0); v.r2.rotation.set(t * 4, 0.7, t * 3);
      v.r1.scale.setScalar(v.k * end); v.r2.scale.setScalar(v.k * end);
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * 6.283, rad = z.r * rand(0.5, 1.15), px = z.x + Math.cos(a) * rad, pz = -z.d + Math.sin(a) * rad, py = rand(0.2, 3);
        const sp = 7;
        this.glow.emit(px, py, pz, (z.x - px) / rad * sp - Math.sin(a) * 4, (1.5 - py) * 2, (-z.d - pz) / rad * sp + Math.cos(a) * 4, 1.7, 0.4, 1.6, rand(0.3, 0.6), 0.45, 0, 0, 0.2);
      }
    }
    // meteors
    for (const m of this.meteors) {
      if (m.done) continue;
      m.t += dt;
      const k = clamp(m.t / m.delay);
      if (k >= 1) { m.done = true; m.mesh.visible = false; m.ring.visible = false; continue; }
      const e = k * k;
      if (m.spirit) m.mesh.position.set(m.x, 1.6 + (1 - e) * 26, m.z);
      else m.mesh.position.set(m.x + (1 - e) * 9, 0.8 + (1 - e) * 30, m.z - (1 - e) * 5);
      m.ring.scale.setScalar(m.r * (1.2 - k * 0.2));
      m.ring.material.opacity = 0.3 + k * 0.7;
      for (let i = 0; i < 4; i++) this.glow.emit(m.mesh.position.x + rand(-0.4, 0.4), m.mesh.position.y + rand(-0.4, 0.4) + (m.spirit ? rand(0, 3) : 0), m.mesh.position.z + rand(-0.4, 0.4), rand(-1, 1), rand(0, 2), rand(-1, 1), m.spirit ? 0.9 : 2, m.spirit ? 1.5 : 0.7 + Math.random() * 0.5, m.spirit ? 2 : 0.15, rand(0.9, 1.6), rand(0.3, 0.55), 0, 1, 0);
    }

    // hero attachments: barrier, wisps, weapon embers, sprint dust
    const heroes = ctx.heroes || [];
    for (let hi = 0; hi < 2; hi++) {
      const mg = heroes[hi], sh = this.shields[hi], hp = this.heroPos[hi];
      if (mg) hp.copy(mg.pos);
      const target = mg && mg.shieldFrac > 0 ? 0.05 + mg.shieldFrac * 0.1 : 0;
      this.shieldK[hi] = damp(this.shieldK[hi], target, 8, dt);
      this.shieldHit[hi] = Math.max(0, this.shieldHit[hi] - dt * 4);
      sh.visible = this.shieldK[hi] > 0.01;
      if (sh.visible) {
        sh.position.set(hp.x, 1.55, hp.z);
        const u = sh.material.uniforms;
        u.uAlpha.value = this.shieldK[hi]; u.uHit.value = this.shieldHit[hi]; u.uTime.value = t;
      }
      for (let i = 0; i < 3; i++) {
        const w = this.wisps[hi * 3 + i];
        w.visible = !!mg && i < mg.wisps;
        if (!w.visible) continue;
        const a = t * 2.1 + i * (6.283 / Math.max(1, mg.wisps)) + hi * 1.7;
        w.position.set(hp.x + Math.sin(a) * 1.45, 2.7 + Math.sin(t * 3 + i * 2) * 0.3, hp.z + Math.cos(a) * 1.45);
        if (Math.random() < dt * 30) this.glow.emit(w.position.x, w.position.y, w.position.z, 0, 0, 0, 0.9, 1.4, 1.9, 0.3, 0.3, 0, 0, 0);
      }
      if (!mg) continue;
      // dust kicked up by the sprint
      if (mg.speed > 0.5 && Math.random() < dt * 26 * mg.speed) this.smoke.emit(hp.x + rand(-0.3, 0.3), 0.12, hp.z + rand(0.2, 0.7), rand(-0.6, 0.6), rand(0.3, 1), rand(1, 2.5), 0.13, 0.11, 0.1, rand(0.35, 0.6), rand(0.3, 0.5), 0, 1.5, 1.8);
      // weapon embers in the active element
      if (mg.element && Math.random() < dt * (10 + mg.tier * 5)) {
        const c = ELEMENT_COLOR[mg.element] || ELEMENT_COLOR.phys, p = this.tips[hi];
        this.glow.emit(p.x + rand(-0.12, 0.12), p.y + rand(-0.1, 0.1), p.z + rand(-0.12, 0.12), rand(-0.3, 0.3), rand(0.4, 1.3), rand(-0.3, 0.3), c.r * 1.7, c.g * 1.7, c.b * 1.7, rand(0.18, 0.38), rand(0.4, 0.8), 0, 0.5, 0);
      }
      if (mg.tier >= 4 && Math.random() < dt * 14) {
        const a = Math.random() * 6.283, r = rand(0.5, 0.9);
        this.glow.emit(hp.x + Math.cos(a) * r, 0.1, hp.z + Math.sin(a) * r, 0, rand(0.8, 1.8), 0, 1.9, 1.5, 0.6, 0.2, rand(0.8, 1.3), 0, 0, 0);
      }
    }

    // ambient: cave emitters + drifting motes
    const fd = ctx.depth;
    for (const em of world.emitters) {
      const dd = em.d - fd;
      if (dd < -22 || dd > 46) continue;
      if (em.type === 'flame') {
        const n = em.big ? 3 : 1;
        for (let i = 0; i < n; i++) if (Math.random() < dt * 34) this.glow.emit(em.x + rand(-0.14, 0.14) * n, em.y + rand(-0.1, 0.1), em.z + rand(-0.14, 0.14) * n, rand(-0.25, 0.25), rand(1.4, 2.8) * (em.big ? 1.5 : 1), rand(-0.25, 0.25), 1.9, 0.6 + Math.random() * 0.5, 0.12, rand(0.4, 0.75) * (em.big ? 1.9 : 1), rand(0.3, 0.55), 0, 0.6, 0);
        if (Math.random() < dt * 3) this.glow.emit(em.x, em.y + 0.2, em.z, rand(-0.8, 0.8), rand(1.5, 3.5), rand(-0.8, 0.8), 2, 1.1, 0.3, 0.12, rand(0.7, 1.3), -0.5, 0.4, 0.4);
      } else if (em.type === 'ember') {
        if (Math.random() < dt * 9) this.glow.emit(em.x + rand(-1.4, 1.4), em.y, em.z + rand(-1.4, 1.4), rand(-0.5, 0.5), rand(0.8, 2.6), rand(-0.5, 0.5), 2, 0.7, 0.14, rand(0.1, 0.22), rand(1.4, 3), -0.3, 0.2, 0.3);
      } else if (em.type === 'spore') {
        if (Math.random() < dt * 5) { _c.set(em.color); this.glow.emit(em.x + rand(-1.5, 1.5), em.y + rand(-1, 0.6), em.z + rand(-1.5, 1.5), rand(-0.3, 0.3), rand(-0.25, 0.3), rand(-0.3, 0.3), _c.r * 1.4, _c.g * 1.4, _c.b * 1.4, rand(0.1, 0.2), rand(2, 4.5), 0, 0, 0.5); }
      }
    }
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.07;
      _c.set(biomeAt(fd).accent);
      this.glow.emit(mp.x + rand(-9, 9), rand(0.3, 6), mp.z + rand(-26, 9), rand(-0.2, 0.2), rand(-0.08, 0.12), rand(-0.2, 0.2), _c.r * 0.5 + 0.2, _c.g * 0.5 + 0.2, _c.b * 0.5 + 0.2, rand(0.06, 0.15), rand(3, 6), 0, 0, 0.6);
    }
  }
}
const _e = new THREE.Euler();
