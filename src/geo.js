// Small geometry toolkit: merge primitives into one faceted, vertex-coloured
// BufferGeometry so a whole orc limb or cave chunk is a single draw call.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Compose a matrix from position / euler rotation / scale. */
export function M(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

export class GeoBuilder {
  constructor() { this.p = []; this.c = []; }

  /**
   * @param geo     any BufferGeometry (disposed after use)
   * @param color   hex colour (sRGB) for the bottom of the part
   * @param matrix  placement
   * @param color2  optional hex colour for the top (vertical gradient)
   * @param boost   multiply colour (use >1 for HDR emissive parts)
   */
  add(geo, color, matrix, color2, boost = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    _c1.set(color);
    let minY = 0, span = 1;
    if (color2 !== undefined && color2 !== null) {
      _c2.set(color2);
      g.computeBoundingBox();
      minY = g.boundingBox.min.y;
      span = Math.max(1e-5, g.boundingBox.max.y - minY);
    }
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      let r = _c1.r, gg = _c1.g, b = _c1.b;
      if (color2 !== undefined && color2 !== null) {
        const t = (_v.y - minY) / span;
        r += (_c2.r - r) * t; gg += (_c2.g - gg) * t; b += (_c2.b - b) * t;
      }
      if (matrix) _v.applyMatrix4(matrix);
      this.p.push(_v.x, _v.y, _v.z);
      this.c.push(r * boost, gg * boost, b * boost);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  /** Raw triangle with per-vertex linear colours (arrays of 3). */
  tri(a, b, c, ca, cb, cc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }

  get empty() { return this.p.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.p = null; this.c = null;
    return g;
  }
}

// ---- cheap deterministic noise
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 11.7) * 43758.5453;
  return s - Math.floor(s);
}
function h3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf), yf),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf), yf),
    zf);
}
export function fbm(x, y, z, oct = 3) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}
export function makeRng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
