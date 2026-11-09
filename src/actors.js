// The mage (six evolution tiers) and the orc horde, all built from primitives
// merged into a few faceted meshes each. Characters face +Z in local space.
import * as THREE from 'three';
import { GeoBuilder, M, clamp, damp } from './geo.js';
import { glowTexture } from './world.js';

const litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, flatShading: true });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

function part(lit, glow, material = litMat, shadow = true) {
  const g = new THREE.Group();
  if (lit && !lit.empty) {
    const m = new THREE.Mesh(lit.build(), material);
    m.castShadow = shadow; m.receiveShadow = false;
    g.add(m); g.userData.lit = m;
  }
  if (glow && !glow.empty) {
    const m = new THREE.Mesh(glow.build(), glowMat);
    g.add(m); g.userData.glow = m;
  }
  return g;
}
const cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 5) => new THREE.ConeGeometry(r, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, w = 6, h = 5) => new THREE.SphereGeometry(r, w, h);

// =================================================================== MAGE
const MAGE_TIERS = [
  // Apprentice
  { robe: 0x6a4e34, robe2: 0xa48460, trim: 0xb89a70, hat: 0x7a5a3a, hat2: 0xa48460, beard: 0x8a6a4a, beardLen: 0.22, staff: 0x5a4028, metal: 0x7a6a50, hatH: 0.7, orb: 0.08, scale: 0.94 },
  // Adept
  { robe: 0x1c2f6e, robe2: 0x3458b8, trim: 0x9aa4b8, hat: 0x1c2f6e, hat2: 0x3a62c8, beard: 0xa89a88, beardLen: 0.3, staff: 0x4a3420, metal: 0x9aa4b8, hatH: 0.9, orb: 0.13, scale: 0.98 },
  // Conjurer
  { robe: 0x241a5c, robe2: 0x4a34b0, trim: 0xe0b040, hat: 0x241a5c, hat2: 0x5a40c8, beard: 0xc8c0b4, beardLen: 0.4, staff: 0x3a2618, metal: 0xe0b040, hatH: 1.05, orb: 0.16, scale: 1.02 },
  // Sorcerer
  { robe: 0x3c0f52, robe2: 0x8a2a9a, trim: 0xf0c048, hat: 0x3c0f52, hat2: 0x9a34a8, beard: 0xd8d4cc, beardLen: 0.5, staff: 0x2a1c14, metal: 0xf0c048, hatH: 1.2, orb: 0.19, scale: 1.06, cape: 0x7a1030, pads: true, stones: 2 },
  // Archmage
  { robe: 0x56648a, robe2: 0xb4bcd4, trim: 0xe8b848, hat: 0x2c4a9a, hat2: 0x5a84e8, beard: 0xd8d8d4, beardLen: 0.66, staff: 0x9a9aa8, metal: 0xe8b848, hatH: 1.35, orb: 0.22, scale: 1.1, cape: 0x2c4a9a, pads: true, stones: 3, ring: 1 },
  // Ascendant
  { robe: 0x9a7a30, robe2: 0xd8c898, trim: 0xf0cc60, hat: 0xb08a28, hat2: 0xe0cc88, beard: 0xe4e4e0, beardLen: 0.8, staff: 0xc8b880, metal: 0xf0cc60, hatH: 1.5, orb: 0.27, scale: 1.16, cape: 0xfff0c8, pads: true, stones: 4, ring: 2, halo: true, wings: true, float: true },
];

export class Mage {
  constructor() {
    this.root = new THREE.Group();
    this.tier = -1;
    this.orbColor = new THREE.Color(0xff7a2a);
    this.phase = 0;
    this.castK = 0;
    this.hurtK = 0;
    this.deadT = -1;
    this.t = 0;
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.light = new THREE.PointLight(0xff7a2a, 10, 24, 1.5);
    this.staffTip = new THREE.Vector3();
    this.build(0);
  }

  build(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    const T = this.T = MAGE_TIERS[tier];
    // throw away the previous body
    this.root.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.root.clear();
    const body = this.body = new THREE.Group();
    this.root.add(body);
    this.root.scale.setScalar(T.scale);

    // ---- robe + torso
    const b = new GeoBuilder(), g = new GeoBuilder();
    const prof = [[0.66, 0], [0.6, 0.14], [0.46, 0.62], [0.36, 1.1], [0.34, 1.32]].map(p => new THREE.Vector2(p[0], p[1]));
    b.add(new THREE.LatheGeometry(prof, 9), T.robe, null, T.robe2);
    b.add(cyl(0.3, 0.36, 0.56, 8), T.robe2, M(0, 1.56, 0, 0, 0, 0, 1, 1, 0.82));
    b.add(sph(0.2, 6, 4), T.robe2, M(0.3, 1.78, 0, 0, 0, 0, 1, 0.75, 0.9));
    b.add(sph(0.2, 6, 4), T.robe2, M(-0.3, 1.78, 0, 0, 0, 0, 1, 0.75, 0.9));
    b.add(cyl(0.37, 0.38, 0.1, 8), T.trim, M(0, 1.26, 0, 0, 0, 0, 1, 1, 0.88));          // belt
    b.add(box(0.14, 0.14, 0.06), T.metal, M(0, 1.26, 0.33));                              // buckle
    b.add(cyl(0.2, 0.3, 0.16, 8), T.trim, M(0, 1.9, 0, 0, 0, 0, 1, 1, 0.9));              // collar
    if (tier >= 2) {
      b.add(new THREE.TorusGeometry(0.63, 0.05, 4, 12), T.metal, M(0, 0.1, 0, Math.PI / 2));
      b.add(box(0.09, 1.1, 0.03), T.metal, M(0, 0.68, 0.44, -0.2));                       // front stole
    }
    if (tier >= 4) {
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; g.add(new THREE.OctahedronGeometry(0.045, 0), T.metal, M(Math.sin(a) * 0.52, 0.5, Math.cos(a) * 0.52), null, 2.2); }
    }
    if (T.pads) {
      for (const s of [-1, 1]) {
        b.add(new THREE.SphereGeometry(0.24, 6, 3, 0, 6.283, 0, 1.6), T.metal, M(s * 0.36, 1.82, 0, 0, 0, s * -0.3, 1.1, 0.8, 1.1));
        b.add(cone(0.06, 0.22, 4), T.metal, M(s * 0.46, 2.0, 0, 0, 0, s * -0.7));
      }
    }
    if (!T.float) { /* boots are separate so they can step */ }
    this.robe = part(b, g);
    body.add(this.robe);

    // ---- boots
    this.boots = [];
    if (!T.float) {
      for (const s of [-1, 1]) {
        const bb = new GeoBuilder();
        bb.add(box(0.2, 0.16, 0.36), 0x2a1c14, M(0, 0.08, 0.06));
        const boot = part(bb, null);
        boot.position.set(s * 0.2, 0, 0.1);
        this.root.add(boot);
        this.boots.push(boot);
      }
    }

    // ---- cape
    this.cape = null;
    if (T.cape) {
      const cb = new GeoBuilder();
      const dark = new THREE.Color(T.cape).multiplyScalar(0.45).getHex();
      const mid = new THREE.Color(T.cape).multiplyScalar(0.7).getHex();
      for (let i = 0; i < 4; i++) cb.add(box(0.86 + i * 0.1, 0.42, 0.04), i % 2 ? mid : T.cape, M(0, -0.2 - i * 0.4, -0.02 - i * i * 0.035, 0.1 + i * 0.09));
      cb.add(box(1.2, 0.07, 0.05), T.metal, M(0, -1.6, -0.34, 0.37));
      this.cape = part(cb, null);
      this.cape.position.set(0, 1.86, -0.24);
      body.add(this.cape);
    }

    // ---- head, beard and hat
    const head = this.head = new THREE.Group();
    head.position.set(0, 2.04, 0.02);
    body.add(head);
    const hb = new GeoBuilder(), hg = new GeoBuilder();
    hb.add(sph(0.2, 7, 5), 0xd8a078, M(0, 0, 0), 0xf0c8a0);
    hb.add(cone(0.05, 0.16, 4), 0xe0a880, M(0, -0.02, 0.2, Math.PI / 2));
    hb.add(cone(0.17, T.beardLen + 0.2, 6), T.beard, M(0, -0.16 - T.beardLen / 2, 0.13, Math.PI + 0.22, 0, 0, 1, 1, 0.7));
    hb.add(cone(0.06, 0.2, 4), T.beard, M(0.1, -0.07, 0.18, 0, 0, -1.9));
    hb.add(cone(0.06, 0.2, 4), T.beard, M(-0.1, -0.07, 0.18, 0, 0, 1.9));
    hb.add(box(0.14, 0.035, 0.03), T.beard, M(0.09, 0.07, 0.185, 0, 0, -0.25));          // brows
    hb.add(box(0.14, 0.035, 0.03), T.beard, M(-0.09, 0.07, 0.185, 0, 0, 0.25));
    if (tier >= 5) {
      hg.add(sph(0.035, 5, 4), 0xfff0b0, M(0.08, 0.02, 0.185), null, 3.5);
      hg.add(sph(0.035, 5, 4), 0xfff0b0, M(-0.08, 0.02, 0.185), null, 3.5);
    } else {
      hb.add(sph(0.028, 5, 4), 0x16161c, M(0.08, 0.02, 0.185));
      hb.add(sph(0.028, 5, 4), 0x16161c, M(-0.08, 0.02, 0.185));
    }
    head.add(part(hb, hg));

    const hat = this.hat = new THREE.Group();
    const tb = new GeoBuilder(), tg = new GeoBuilder();
    const H = T.hatH;
    tb.add(cyl(0.5 + tier * 0.02, 0.54 + tier * 0.02, 0.05, 10), T.hat, M(0, 0, 0));
    tb.add(cyl(0.16, 0.3, H * 0.5, 8), T.hat, M(0, H * 0.25, 0), T.hat2);
    tb.add(cone(0.165, H * 0.55, 7), T.hat2, M(0, H * 0.5 + H * 0.24, -H * 0.07, -0.32), T.hat);
    tb.add(cone(0.07, H * 0.3, 5), T.hat, M(0, H * 0.98, -H * 0.24, -1.0));
    tb.add(cyl(0.3, 0.31, 0.09, 8), T.trim, M(0, 0.07, 0));
    if (tier >= 2) tb.add(box(0.12, 0.13, 0.04), T.metal, M(0, 0.08, 0.3));
    if (tier >= 4) for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.4; tg.add(new THREE.OctahedronGeometry(0.035, 0), 0xfff0a0, M(Math.sin(a) * 0.24, H * 0.2 + (i % 3) * H * 0.12, Math.cos(a) * 0.24), null, 2.6); }
    hat.add(part(tb, tg));
    hat.position.set(0, 0.14, -0.02);
    hat.rotation.x = -0.12;
    head.add(hat);

    // ---- arms
    const sleeve = () => {
      const ab = new GeoBuilder();
      ab.add(cyl(0.1, 0.18, 0.62, 6), T.robe2, M(0, -0.31, 0), T.robe);
      ab.add(cyl(0.185, 0.185, 0.06, 6), T.trim, M(0, -0.6, 0));
      ab.add(sph(0.085, 5, 4), 0xe8b890, M(0, -0.68, 0));
      return part(ab, null);
    };
    this.armL = sleeve(); this.armL.position.set(0.4, 1.76, 0);
    this.armR = sleeve(); this.armR.position.set(-0.4, 1.76, 0);
    body.add(this.armL, this.armR);

    // ---- staff
    const staff = this.staff = new THREE.Group();
    const sb = new GeoBuilder(), sg = new GeoBuilder();
    const SL = 2.25 + tier * 0.06;
    sb.add(cyl(0.035, 0.05, SL, 5), T.staff, M(0, SL / 2 - 0.9, 0));
    const top = SL - 0.9;
    if (tier === 0) sb.add(sph(0.08, 5, 4), T.staff, M(0, top, 0));
    if (tier === 1) sb.add(cyl(0.08, 0.04, 0.12, 5), T.metal, M(0, top, 0));
    if (tier >= 2) {
      const n = tier >= 4 ? 4 : 3, r = T.orb + 0.06;
      for (let i = 0; i < n; i++) {
        const a = i / n * 6.283;
        sb.add(cone(0.035, 0.42 + tier * 0.03, 4), T.metal, M(Math.sin(a) * r, top + 0.2, Math.cos(a) * r, Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35));
      }
      sb.add(cyl(0.09, 0.05, 0.1, 6), T.metal, M(0, top, 0));
      sb.add(cyl(0.055, 0.055, 0.06, 6), T.metal, M(0, top - 0.5, 0));
    }
    if (tier >= 3) sb.add(cone(0.05, 0.2, 4), T.metal, M(0, -0.95, 0, Math.PI));
    staff.add(part(sb, sg));
    this.orbY = top + (tier <= 1 ? 0.14 : 0.24 + T.orb * 0.4);
    const orb = this.orb = new THREE.Mesh(tier === 1 ? new THREE.OctahedronGeometry(T.orb * 1.25, 0) : new THREE.IcosahedronGeometry(T.orb, 1), this.orbMat);
    orb.position.y = this.orbY;
    staff.add(orb);
    const sprite = this.orbGlow = new THREE.Sprite(this.haloMat);
    sprite.position.y = this.orbY;
    sprite.scale.setScalar(T.orb * 9 + 0.5);
    staff.add(sprite);
    this.light.position.set(0, this.orbY + 0.9, 0.5);
    staff.add(this.light);
    this.rings = [];
    for (let i = 0; i < (T.ring || 0); i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(T.orb + 0.12 + i * 0.07, 0.014, 4, 18), this.orbMat);
      ring.position.y = this.orbY;
      staff.add(ring); this.rings.push(ring);
    }
    staff.position.set(0, -0.68, 0.04);
    this.armR.add(staff);

    // ---- floating rune stones, halo, wings
    this.stones = [];
    for (let i = 0; i < (T.stones || 0); i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), this.orbMat);
      s.scale.set(0.8, 1.5, 0.8);
      this.root.add(s); this.stones.push(s);
    }
    this.halo = null;
    if (T.halo) {
      this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 5, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe890).multiplyScalar(3) }));
      this.halo.rotation.x = Math.PI / 2;
      head.add(this.halo);
      this.halo.position.y = T.hatH + 0.45;
    }
    this.wings = [];
    if (T.wings) {
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd880).multiplyScalar(1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
        const w = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), wm);
        w.scale.set(0.12, 1.5 - i * 0.3, 0.02);
        const holder = new THREE.Group();
        holder.position.set(s * 0.2, 1.8, -0.3);
        w.position.set(0, 0.7 - i * 0.12, 0);
        holder.rotation.z = s * (-0.6 - i * 0.42);
        holder.add(w); body.add(holder);
        this.wings.push({ holder, s, i });
      }
    }
    this.setElement(this.orbColor);
  }

  setElement(color) {
    this.orbColor.set(color);
    this.orbMat.color.copy(this.orbColor).lerp(_white, 0.25).multiplyScalar(2.6);
    this.haloMat.color.copy(this.orbColor);
    this.light.color.copy(this.orbColor);
  }

  /** @param s { moving, casting(0..1), hurt, dead, idle } */
  update(dt, s) {
    this.t += dt;
    const t = this.t, T = this.T;
    const body = this.body;
    if (s.dead) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT += dt;
      const k = clamp(this.deadT / 0.55);
      const e = 1 - (1 - k) * (1 - k);
      body.rotation.x = -1.45 * e;
      body.position.y = -0.2 * e + Math.sin(k * Math.PI) * 0.3;
      body.position.z = -0.6 * e;
      this.hat.position.y = 0.14 + Math.sin(clamp(this.deadT / 0.8) * Math.PI) * 1.2;
      this.hat.position.z = -0.02 - clamp(this.deadT / 0.8) * 1.3;
      this.hat.rotation.x = -0.12 - this.deadT * 4;
      this.light.intensity = damp(this.light.intensity, 0, 6, dt);
      this.orbGlow.scale.setScalar(Math.max(0.01, this.orbGlow.scale.x * Math.exp(-4 * dt)));
      return;
    }
    if (this.deadT >= 0) {   // revived / new run
      this.deadT = -1;
      body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
      this.hat.position.set(0, 0.14, -0.02); this.hat.rotation.x = -0.12;
    }
    this.castK = damp(this.castK, s.casting ? 1 : 0, s.casting ? 30 : 9, dt);
    this.hurtK = damp(this.hurtK, s.hurt ? 1 : 0, s.hurt ? 40 : 8, dt);
    const run = s.moving ? (s.speed ?? 1) : 0;
    this.runK = damp(this.runK ?? 0, run, 8, dt);
    this.phase += dt * (5 + 11 * this.runK);
    const ph = this.phase, rk = this.runK;
    const hover = T.float ? 0.32 + Math.sin(t * 2.2) * 0.08 : 0;
    body.position.y = hover + Math.abs(Math.sin(ph)) * 0.08 * rk + Math.sin(t * 2.1) * 0.015 * (1 - rk);
    body.rotation.x = 0.27 * rk + this.castK * 0.08 - this.hurtK * 0.3;
    body.rotation.z = Math.sin(ph) * 0.035 * rk;
    body.rotation.y = this.castK * 0.25;
    this.robe.rotation.y = Math.sin(ph) * 0.06 * rk;
    this.head.rotation.x = -0.2 * rk + Math.sin(t * 1.3) * 0.03 - this.castK * 0.08;
    this.head.rotation.y = Math.sin(t * 0.7) * 0.08 * (1 - rk);
    this.armL.rotation.x = Math.sin(ph) * 0.95 * rk - 0.1 - this.castK * 0.5;
    this.armL.rotation.z = 0.16 + this.castK * 0.3;
    const armR = -0.75 + Math.sin(ph + Math.PI) * 0.12 * rk - this.castK * 0.95;
    this.armR.rotation.x = armR;
    this.armR.rotation.z = -0.2;
    this.staff.rotation.x = -armR - body.rotation.x + 0.1 + this.castK * 0.7;
    this.staff.rotation.z = 0.2;
    for (let i = 0; i < this.boots.length; i++) {
      const sgn = i ? 1 : -1;
      this.boots[i].position.z = 0.1 + Math.sin(ph + (i ? Math.PI : 0)) * 0.42 * rk;
      this.boots[i].position.y = Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 1.2)) * 0.26 * rk;
      this.boots[i].rotation.y = sgn * 0.1;
    }
    if (this.cape) this.cape.rotation.x = 0.12 + rk * 0.8 + Math.sin(ph * 0.5) * 0.08 * rk + Math.sin(t * 1.7) * 0.03;
    const pulse = 1 + Math.sin(t * 5) * 0.08 + this.castK * 0.7;
    this.orb.scale.setScalar(pulse);
    this.orb.rotation.y = t * 1.5; this.orb.rotation.x = t;
    this.orbGlow.scale.setScalar((T.orb * 9 + 0.5) * (1 + this.castK * 0.8));
    this.light.intensity = (12 + this.tier * 2.5) * (1 + this.castK * 1.2 + Math.sin(t * 7) * 0.06);
    for (let i = 0; i < this.rings.length; i++) { this.rings[i].rotation.x = t * (1.4 + i); this.rings[i].rotation.y = t * (0.9 + i * 0.7); }
    for (let i = 0; i < this.stones.length; i++) {
      const a = t * 1.3 + i * (6.283 / this.stones.length);
      this.stones[i].position.set(Math.sin(a) * 1.05, 1.5 + hover + Math.sin(t * 2 + i * 2) * 0.25, Math.cos(a) * 1.05);
      this.stones[i].rotation.y = t * 2 + i;
    }
    if (this.halo) this.halo.rotation.z = t * 0.8;
    for (const w of this.wings) w.holder.rotation.z = w.s * (-0.6 - w.i * 0.42 - Math.sin(t * 2.2 + w.i * 0.5) * 0.12 - this.castK * 0.25);
  }

  /** World position of the staff orb (where spells come from). */
  getStaffTip(out) {
    this.orb.getWorldPosition(out);
    return out;
  }
}
const _white = new THREE.Color(1, 1, 1);
const _bm = new THREE.Matrix4();

// =================================================================== ORCS
const ORC_LOOK = {
  grunt:    { s: 1.0,  skin: 0x5f9038, skin2: 0x3a6224, cloth: 0x4a3524, metal: 0x565660, weapon: 'club',     eyes: 0xffc020 },
  whelp:    { s: 0.62, skin: 0x8fb04a, skin2: 0x5e7e30, cloth: 0x5a4028, metal: 0x66605a, weapon: 'dagger',   eyes: 0xffe040, bigHead: true },
  archer:   { s: 0.96, skin: 0x6f9258, skin2: 0x44603a, cloth: 0x2e3e26, metal: 0x565660, weapon: 'handaxe',  eyes: 0xffc020, hood: true, slim: true },
  brute:    { s: 1.62, skin: 0x4c7440, skin2: 0x2a4626, cloth: 0x33241a, metal: 0x3c3e48, weapon: 'maul',     eyes: 0xff5a20, helmet: true, heavy: true },
  shaman:   { s: 1.02, skin: 0x5a8272, skin2: 0x36564c, cloth: 0x4a2a62, metal: 0x8a7440, weapon: 'staff',    eyes: 0xc060ff, feathers: true, robe: true },
  loot:     { s: 0.92, skin: 0x97aa40, skin2: 0x667428, cloth: 0x6a5020, metal: 0xe0b030, weapon: 'none',     eyes: 0xffe040, sack: true },
  champion: { s: 2.0,  skin: 0x74603c, skin2: 0x443820, cloth: 0x5a1414, metal: 0x2e3038, weapon: 'axe',      eyes: 0xff3010, helmet: true, heavy: true, banner: true, paint: 0xb01c14 },
  boss:     { s: 3.0,  skin: 0x3e5a44, skin2: 0x1e3024, cloth: 0x5a0c1c, metal: 0x2a2a34, weapon: 'greataxe', eyes: 0xff1038, heavy: true, crown: true, cape: true, paint: 0xd0a030 },
};

const orcGeoCache = {};
function orcGeometry(type) {
  if (orcGeoCache[type]) return orcGeoCache[type];
  const K = ORC_LOOK[type];
  const bulk = K.heavy ? 1.18 : K.slim ? 0.84 : 1;
  const bone = 0xe8e0c8;
  // ---- torso + head (origin at the hips)
  const b = new GeoBuilder(), g = new GeoBuilder();
  b.add(cyl(0.5 * bulk, 0.36 * bulk, 0.85, 7), K.skin2, M(0, 0.48, 0, 0, 0, 0, 1, 1, 0.74), K.skin);
  if (K.heavy) b.add(sph(0.4, 7, 5), K.skin, M(0, 0.22, 0.14, 0, 0, 0, 1.1, 0.9, 0.9));        // gut
  b.add(cyl(0.4 * bulk, 0.4 * bulk, 0.15, 7), K.cloth, M(0, 0.07, 0, 0, 0, 0, 1, 1, 0.78));
  b.add(box(0.16, 0.16, 0.06), K.metal, M(0, 0.07, 0.31 * bulk));
  b.add(box(0.46 * bulk, 0.46, 0.06), K.cloth, M(0, -0.2, 0.24 * bulk, -0.12));
  b.add(box(0.46 * bulk, 0.4, 0.06), K.cloth, M(0, -0.18, -0.24 * bulk, 0.12));
  for (const s of [-1, 1]) b.add(sph(0.24 * bulk, 6, 4), K.skin, M(s * 0.5 * bulk, 0.82, 0));
  b.add(box(0.13, 1.0, 0.05), K.cloth, M(0.08, 0.5, 0.36 * bulk, 0, 0, 0.75));                  // chest strap
  if (K.robe) b.add(cyl(0.42, 0.6, 0.9, 7), K.cloth, M(0, -0.4, 0), 0x2a1638);
  // head
  const hs = K.bigHead ? 1.35 : 1, hy = 1.1, hz = 0.2;
  b.add(sph(0.3 * hs, 7, 5), K.skin2, M(0, hy, hz, 0, 0, 0, 1.05, 0.95, 1.05), K.skin);
  b.add(box(0.46 * hs, 0.2 * hs, 0.38 * hs), K.skin2, M(0, hy - 0.19 * hs, hz + 0.09 * hs));       // jaw
  b.add(box(0.52 * hs, 0.09 * hs, 0.2 * hs), K.paint || K.skin2, M(0, hy + 0.1 * hs, hz + 0.2 * hs, 0.2));   // brow
  b.add(box(0.14 * hs, 0.12 * hs, 0.12 * hs), K.skin2, M(0, hy - 0.02 * hs, hz + 0.3 * hs));       // snout
  for (const s of [-1, 1]) {
    b.add(cone(0.05 * hs, 0.24 * hs, 4), bone, M(s * 0.16 * hs, hy - 0.06 * hs, hz + 0.27 * hs, 0.15, 0, s * -0.15));   // tusks
    b.add(cone(0.08 * hs, (K.bigHead ? 0.5 : 0.34) * hs, 4), K.skin, M(s * 0.36 * hs, hy + 0.08 * hs, hz - 0.02, 0, 0, s * -1.25)); // ears
    g.add(sph(0.05 * hs, 5, 4), K.eyes, M(s * 0.125 * hs, hy + 0.02 * hs, hz + 0.27 * hs), null, 3.2);
  }
  // gear
  if (K.helmet) {
    b.add(new THREE.SphereGeometry(0.33, 7, 4, 0, 6.283, 0, 1.5), K.metal, M(0, hy + 0.06, hz - 0.02, -0.15));
    for (const s of [-1, 1]) b.add(cone(0.075, 0.5, 5), bone, M(s * 0.36, hy + 0.3, hz - 0.02, 0, 0, s * -0.7));
    b.add(box(0.07, 0.3, 0.05), K.metal, M(0, hy + 0.02, hz + 0.31));
  }
  if (K.hood) b.add(cone(0.36, 0.55, 6), K.cloth, M(0, hy + 0.2, hz - 0.1, -0.5));
  if (K.feathers) for (let i = -2; i <= 2; i++) b.add(cone(0.05, 0.6, 4), i % 2 ? 0xd04a30 : 0xe8d8b0, M(i * 0.12, hy + 0.42, hz - 0.1, -0.3, 0, i * -0.22));
  if (K.crown) {
    b.add(cyl(0.3, 0.3, 0.12, 8), 0xd0a030, M(0, hy + 0.26, hz - 0.02));
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.add(cone(0.05, i % 2 ? 0.34 : 0.22, 4), 0xe8c040, M(Math.sin(a) * 0.29, hy + 0.42, hz - 0.02 + Math.cos(a) * 0.29)); }
    for (const s of [-1, 1]) b.add(cone(0.1, 0.8, 5), bone, M(s * 0.48, hy + 0.3, hz - 0.05, 0, 0, s * -1.0));
    g.add(new THREE.OctahedronGeometry(0.07, 0), 0xff2040, M(0, hy + 0.27, hz + 0.3), null, 3);
  }
  // shoulder armour
  const pads = K.heavy ? [-1, 1] : type === 'whelp' || type === 'loot' ? [] : [1];
  for (const s of pads) {
    b.add(new THREE.SphereGeometry(0.31 * bulk, 6, 3, 0, 6.283, 0, 1.6), K.metal, M(s * 0.54 * bulk, 0.88, 0, 0, 0, s * -0.35));
    b.add(cone(0.07, 0.3, 4), K.metal, M(s * 0.66 * bulk, 1.12, 0, 0, 0, s * -0.6));
    if (K.heavy) b.add(cone(0.06, 0.24, 4), K.metal, M(s * 0.5 * bulk, 1.16, 0.12, 0.3, 0, s * -0.2));
  }
  if (K.sack) {
    b.add(sph(0.5, 7, 5), 0x8a6a3a, M(0, 0.75, -0.5, 0, 0, 0, 1, 1.15, 0.9), 0xa8844a);
    b.add(cyl(0.12, 0.2, 0.2, 6), 0x6a5028, M(0, 1.3, -0.5));
    for (let i = 0; i < 5; i++) g.add(cyl(0.07, 0.07, 0.025, 6), 0xffc830, M(-0.2 + i * 0.1, 1.42 + (i % 2) * 0.05, -0.5 + (i % 3) * 0.06, i, i * 2, 0), null, 1.8);
  }
  if (K.banner) {
    b.add(cyl(0.035, 0.035, 2.0, 4), 0x2a1c12, M(-0.15, 1.5, -0.32));
    b.add(box(0.5, 0.75, 0.03), K.cloth, M(0.12, 2.05, -0.32), 0xc02820);
  }
  if (K.cape) b.add(box(1.25, 1.7, 0.06), 0x3a0812, M(0, 0.2, -0.42, 0.18), K.cloth);

  // ---- leg (origin at hip)
  const leg = new GeoBuilder();
  leg.add(cyl(0.18 * bulk, 0.13 * bulk, 0.7, 6), K.skin2, M(0, -0.35, 0), K.skin);
  leg.add(box(0.24 * bulk, 0.15, 0.4), K.cloth, M(0, -0.75, 0.09));

  // ---- arm (origin at shoulder), optionally holding the weapon
  const arm = withWeapon => {
    const a = new GeoBuilder(), ag = new GeoBuilder();
    a.add(cyl(0.13 * bulk, 0.165 * bulk, 0.86, 6), K.skin, M(0, -0.42, 0), K.skin2);
    a.add(cyl(0.175 * bulk, 0.18 * bulk, 0.2, 6), K.metal, M(0, -0.68, 0));
    a.add(sph(0.17 * bulk, 6, 4), K.skin2, M(0, -0.92, 0));
    if (withWeapon) {
      const hy2 = -0.92, w = K.weapon;
      const wm = (z, rx = Math.PI / 2) => M(0, hy2, z, rx);
      if (w === 'club') {
        a.add(cyl(0.14, 0.06, 1.15, 6), 0x5a4028, wm(0.45), 0x3a2818);
        for (let i = 0; i < 5; i++) { const an = i * 1.257; a.add(cone(0.045, 0.2, 4), 0xc8c8d0, M(Math.sin(an) * 0.15, hy2 + Math.cos(an) * 0.15, 0.82, Math.cos(an) * -1.57 + 1.57, 0, Math.sin(an) * -1.57)); }
      } else if (w === 'dagger') {
        a.add(box(0.05, 0.03, 0.5), 0xc8c8d0, M(0, hy2, 0.3));
        a.add(box(0.2, 0.05, 0.05), 0x3a2818, M(0, hy2, 0.08));
      } else if (w === 'handaxe') {
        a.add(cyl(0.035, 0.04, 0.8, 5), 0x5a4028, wm(0.3));
        a.add(box(0.05, 0.34, 0.3), 0x8e8e9c, M(0, hy2 + 0.14, 0.62), 0xd0d0dc);
      } else if (w === 'maul') {
        a.add(cyl(0.06, 0.07, 1.5, 6), 0x3a2818, wm(0.6));
        a.add(box(0.52, 0.52, 0.72), 0x4a4a52, M(0, hy2, 1.3), 0x7a7a84);
        a.add(box(0.56, 0.12, 0.76), 0x2a2a30, M(0, hy2, 1.3));
      } else if (w === 'staff') {
        a.add(cyl(0.04, 0.05, 2.0, 5), 0x3a2818, wm(0.3));
        a.add(sph(0.14, 6, 4), 0xe8e0c8, M(0, hy2, 1.35));
        ag.add(new THREE.OctahedronGeometry(0.12, 0), 0xc060ff, M(0, hy2, 1.62), null, 3);
      } else if (w === 'axe' || w === 'greataxe') {
        a.add(cyl(0.05, 0.06, 1.7, 6), 0x3a2818, wm(0.6));
        const blade = sgn => {
          a.add(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 8, 1, false, -0.9, 1.8), 0x3e3e4a, M(0, hy2 + sgn * 0.12, 1.25, 0, 0, sgn > 0 ? Math.PI / 2 : -Math.PI / 2).multiply(M(0, 0, 0, Math.PI / 2, 0, 0)), 0x8e8e9c);
        };
        blade(1);
        if (w === 'greataxe') blade(-1);
        a.add(cone(0.06, 0.3, 4), 0x8a8a94, wm(1.6));
      }
    }
    return [a, ag];
  };
  const [a1, a1g] = arm(true), [a2] = arm(false);
  return (orcGeoCache[type] = {
    torso: b.build(), torsoGlow: g.build(), leg: leg.build(),
    armR: a1.build(), armRGlow: a1g.empty ? null : a1g.build(), armL: a2.build(),
    look: K,
  });
}

const iceGeo = new THREE.IcosahedronGeometry(1, 0);
const iceMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2a6a9a, transparent: true, opacity: 0.6, roughness: 0.15, flatShading: true, depthWrite: false });
const markGeo = new THREE.OctahedronGeometry(0.16, 0);
const markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb06cff).multiplyScalar(2.5) });
const buffGeo = new THREE.RingGeometry(0.75, 0.9, 16);
const buffMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc060ff).multiplyScalar(1.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

export class OrcVisual {
  constructor(type) {
    this.type = type;
    const G = orcGeometry(type);
    const K = this.look = G.look;
    this.mat = litMat.clone();
    this.root = new THREE.Group();
    const inner = this.inner = new THREE.Group();
    inner.scale.setScalar(K.s);
    this.root.add(inner);
    const mk = (geo, glowGeo) => {
      const grp = new THREE.Group();
      const m = new THREE.Mesh(geo, this.mat);
      m.castShadow = true;
      grp.add(m);
      if (glowGeo) grp.add(new THREE.Mesh(glowGeo, glowMat));
      return grp;
    };
    this.hip = new THREE.Group(); this.hip.position.y = 0.84;
    inner.add(this.hip);
    this.torso = mk(G.torso, G.torsoGlow);
    this.hip.add(this.torso);
    const bulk = K.heavy ? 1.18 : K.slim ? 0.84 : 1;
    this.legL = mk(G.leg); this.legL.position.set(0.22 * bulk, 0, 0);
    this.legR = mk(G.leg); this.legR.position.set(-0.22 * bulk, 0, 0);
    this.hip.add(this.legL, this.legR);
    this.armL = mk(G.armL); this.armL.position.set(0.6 * bulk, 0.8, 0);
    this.armR = mk(G.armR, G.armRGlow); this.armR.position.set(-0.6 * bulk, 0.8, 0);
    this.torso.add(this.armL, this.armR);
    this.ice = new THREE.Mesh(iceGeo, iceMat);
    this.ice.scale.set(0.85, 1.25, 0.85); this.ice.position.y = 1.1; this.ice.visible = false;
    inner.add(this.ice);
    this.mark = new THREE.Mesh(markGeo, markMat);
    this.mark.position.y = 2.75; this.mark.visible = false;
    inner.add(this.mark);
    this.buff = new THREE.Mesh(buffGeo, buffMat);
    this.buff.rotation.x = -Math.PI / 2; this.buff.position.y = 0.06; this.buff.visible = false;
    inner.add(this.buff);
    this.phase = Math.random() * 6;
    this.height = 2.3 * K.s;
    this.reset();
  }

  reset() {
    this.dying = -1;
    this.spawnT = 0;
    this.vel = null;
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.inner.scale.setScalar(this.look.s);
    this.inner.rotation.set(0, 0, 0);
    this.inner.position.set(0, 0, 0);
    this.mat.color.setRGB(1, 1, 1);
    this.mat.emissive.setRGB(0, 0, 0);
    this.ice.visible = false; this.mark.visible = false; this.buff.visible = false;
    this.yaw = 0;
    this.hurtK = 0;
  }

  /** Live update from a sim enemy. */
  update(dt, e, mage, t) {
    this.root.position.set(e.x, 0, -e.d);
    // face the mage (or run away with the loot)
    let dx = mage.x - e.x, dz = e.d - mage.d;
    if (e.fleeing) { dx = -dx; dz = -dz; }
    const yaw = Math.atan2(dx, dz);
    let dy = yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);
    this.root.rotation.y = this.yaw;
    this.spawnT = Math.min(1, this.spawnT + dt * 4);
    const pop = this.spawnT < 1 ? 1 - Math.pow(1 - this.spawnT, 3) : 1;
    this.inner.scale.setScalar(this.look.s * pop);

    const frozen = e.freezeT > 0;
    const K = this.look;
    if (!frozen) {
      const rate = (e.moving ? 15 : 2.2) * (e.chillT > 0 ? 0.6 : 1) / Math.sqrt(K.s);
      this.phase += dt * rate;
    }
    const ph = this.phase;
    const mv = e.moving ? 1 : 0;
    this.mvK = damp(this.mvK ?? 0, mv, 10, dt);
    const k = this.mvK;
    const hop = this.type === 'whelp' ? 0.34 : this.type === 'loot' ? 0.2 : 0.12;
    this.hip.position.y = 0.84 + Math.abs(Math.sin(ph)) * hop * k + Math.sin(ph * 0.5) * 0.015 * (1 - k);
    this.legL.rotation.x = Math.sin(ph) * 0.85 * k;
    this.legR.rotation.x = -Math.sin(ph) * 0.85 * k;
    this.hurtK = damp(this.hurtK, e.hitFlash > 0 ? 1 : 0, e.hitFlash > 0 ? 40 : 10, dt);
    this.torso.rotation.x = 0.24 + (this.type === 'whelp' ? 0.42 : 0.26) * k - this.hurtK * 0.35;
    this.torso.rotation.y = Math.sin(ph) * 0.16 * k;
    this.torso.rotation.z = Math.sin(ph * 0.5) * 0.03 * (1 - k);
    this.armL.rotation.x = -Math.sin(ph) * 0.7 * k - 0.15;
    this.armL.rotation.z = 0.22;
    // weapon arm: carry, wind up, slam
    let ar = Math.sin(ph) * 0.5 * k - 0.5;
    if (e.attackAnim > 0) {
      const a = Math.max(0, 1 - e.attackAnim / (e.attackDur || 0.45));          // 0 -> 1
      ar = a < 0.45 ? -0.5 - (a / 0.45) * 2.3 : -2.8 + ((a - 0.45) / 0.55) * 3.3;
      this.torso.rotation.x += a < 0.45 ? -0.25 * (a / 0.45) : -0.25 + ((a - 0.45) / 0.55) * 0.7;
    } else if (e.type === 'loot') { ar = -2.6 + Math.sin(ph * 2) * 0.3; this.armL.rotation.x = -2.6 - Math.sin(ph * 2) * 0.3; }
    this.armR.rotation.x = ar;
    this.armR.rotation.z = -0.22;

    // status dressing
    const m = this.mat;
    let r = 1, g = 1, b = 1;
    if (e.chillT > 0 || frozen) { r = 0.6; g = 0.88; b = 1.3; }
    if (e.burnT > 0) { r *= 1.5; g *= 0.8; b *= 0.6; }
    if (e.enraged) { r *= 1.5; g *= 0.7; b *= 0.7; }
    m.color.setRGB(r, g, b);
    const fl = e.hitFlash > 0 ? e.hitFlash / 0.12 : 0;
    m.emissive.setRGB(fl * 0.4 + (e.burnT > 0 ? 0.1 : 0), fl * 0.4, fl * 0.4 + (e.shockT > 0 ? 0.08 + Math.sin(t * 40) * 0.06 : 0));
    this.ice.visible = frozen;
    this.mark.visible = !!e.mark;
    if (e.mark) { this.mark.rotation.y = t * 3; this.mark.position.y = 2.75 + Math.sin(t * 4) * 0.08; }
    this.buff.visible = !!e.buffed;
    if (e.buffed) this.buff.rotation.z = t * 2;
  }

  setShadow(on) { if (this.shadowOn === on) return; this.shadowOn = on; this.root.traverse(o => { if (o.isMesh && o.material === this.mat) o.castShadow = on; }); }

  /** Start the death tumble. dir: unit vector away from the blast. */
  kill(dirX, dirZ, power, tint) {
    this.dying = 0;
    this.vel = { x: dirX * power, y: 5 + power * 0.5, z: dirZ * power, spin: (Math.random() - 0.5) * 16 };
    this.tint = tint;
    this.ice.visible = false; this.mark.visible = false; this.buff.visible = false;
  }
  /** @returns true while still animating */
  updateDying(dt) {
    this.dying += dt;
    const k = this.dying / 0.55;
    if (k >= 1) return false;
    const v = this.vel;
    v.y -= 22 * dt;
    this.root.position.x += v.x * dt; this.root.position.z += v.z * dt;
    this.inner.position.y = Math.max(0, this.inner.position.y + v.y * dt / Math.max(0.4, this.look.s));
    this.inner.rotation.x -= v.spin * dt;
    this.inner.scale.setScalar(this.look.s * (1 - k * k));
    const f = Math.max(0, 1 - k * 2.2);
    this.mat.emissive.setRGB(this.tint.r * f * 0.9, this.tint.g * f * 0.9, this.tint.b * f * 0.9);
    this.mat.color.setScalar(1 - k * 0.7);
    return true;
  }
}

/** Pool of orc visuals bound to sim enemies by id. */
export class OrcPool {
  constructor(scene) {
    this.scene = scene;
    this.free = {};
    this.live = new Map();
    this.dying = [];
    this.realShadows = true;
    // one instanced blob under every orc: used instead of shadow maps on weaker devices
    const g = new THREE.CircleGeometry(1, 12);
    g.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }), 64);
    this.blobs.frustumCulled = false; this.blobs.count = 0; this.blobs.renderOrder = 1;
    scene.add(this.blobs);
  }
  updateBlobs() {
    let i = 0;
    if (!this.realShadows) {
      for (const v of this.live.values()) {
        if (i >= 64) break;
        const r = v.look.s * 0.62;
        _bm.makeScale(r, 1, r * 0.8).setPosition(v.root.position.x, 0.05, v.root.position.z);
        this.blobs.setMatrixAt(i++, _bm);
      }
      this.blobs.instanceMatrix.needsUpdate = true;
    }
    this.blobs.count = i;
  }
  spawn(e) {
    const list = this.free[e.type] || (this.free[e.type] = []);
    const v = list.pop() || new OrcVisual(e.type);
    v.reset();
    v.setShadow(this.realShadows || e.def.heavy);
    if (e.type === 'boss' || e.type === 'champion') v.spawnT = 1;
    v.root.position.set(e.x, 0, -e.d);
    v.yaw = 0;
    this.scene.add(v.root);
    this.live.set(e.id, v);
    return v;
  }
  get(id) { return this.live.get(id); }
  kill(e, dirX, dirZ, power, tint) {
    const v = this.live.get(e.id);
    if (!v) return;
    this.live.delete(e.id);
    v.kill(dirX, dirZ, power, tint);
    this.dying.push(v);
  }
  remove(e) {
    const v = this.live.get(e.id);
    if (!v) return;
    this.live.delete(e.id);
    this.release(v);
  }
  release(v) {
    this.scene.remove(v.root);
    (this.free[v.type] || (this.free[v.type] = [])).push(v);
  }
  updateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (!this.dying[i].updateDying(dt)) { this.release(this.dying[i]); this.dying.splice(i, 1); }
    }
  }
  clear() {
    for (const v of this.live.values()) this.release(v);
    this.live.clear();
    for (const v of this.dying) this.release(v);
    this.dying.length = 0;
  }
  /** Compile shaders / upload geometry up front so the first pack does not hitch. */
  prewarm(types) { for (const t of types) { const v = new OrcVisual(t); this.scene.add(v.root); this.dying.push(v); v.dying = 9; v.vel = { x: 0, y: 0, z: 0, spin: 0 }; v.tint = { r: 0, g: 0, b: 0 }; v.root.position.y = -60; } }
}
