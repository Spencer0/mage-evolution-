// Rune recogniser: a $1-unistroke style matcher, tuned to be orientation-aware
// (a rune is not the same rune upside-down unless we say so) and to return a
// "quality" score that feels fair for finger drawing.
import { RUNES } from './data.js';

const N = 64;
const SIZE = 250;
const DIAG = Math.sqrt(2) * SIZE;
const HALF_DIAG = DIAG / 2;
const ANGLE_RANGE = (22 * Math.PI) / 180;
const ANGLE_STEP = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

export function resample(points, n = N) {
  const pts = points.map(p => [p[0], p[1]]);
  const I = pathLength(pts) / (n - 1);
  if (I <= 0) return null;
  let D = 0;
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d;
      const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push(pts[pts.length - 1].slice());
  out.length = n;
  return out;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return { x: a, y: b, w: c - a, h: d - b };
}
function normalize(points) {
  let pts = resample(points);
  if (!pts) return null;
  const bb = bbox(pts);
  // Mostly non-uniform scaling (forgives squashed drawings) but never blows up
  // a nearly flat axis.
  const m = Math.max(bb.w, bb.h);
  const sx = SIZE / Math.max(bb.w, m * 0.3), sy = SIZE / Math.max(bb.h, m * 0.3);
  pts = pts.map(p => [p[0] * sx, p[1] * sy]);
  const c = centroid(pts);
  return pts.map(p => [p[0] - c[0], p[1] - c[1]]);
}
function rotate(pts, a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(p => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]);
}
function pathDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return d / a.length;
}
function distAtAngle(pts, tpl, a) { return pathDistance(rotate(pts, a), tpl); }
function distAtBestAngle(pts, tpl) {
  let a = -ANGLE_RANGE, b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b, f1 = distAtAngle(pts, tpl, x1);
  let x2 = (1 - PHI) * a + PHI * b, f2 = distAtAngle(pts, tpl, x2);
  while (Math.abs(b - a) > ANGLE_STEP) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = distAtAngle(pts, tpl, x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = distAtAngle(pts, tpl, x2); }
  }
  return Math.min(f1, f2);
}

// ---- template generation: every start corner, both directions, plus allowed rotations.
function variants(rune) {
  const g = rune.glyph;
  const out = [];
  for (const r of rune.rots || [0]) {
    const base = rotate(g, r);
    const paths = [];
    if (rune.closed) {
      const ring = base.slice(0, -1);
      const step = ring.length > 12 ? 5 : 1;
      for (let s = 0; s < ring.length; s += step) {
        const p = ring.slice(s).concat(ring.slice(0, s));
        p.push(p[0]);
        paths.push(p);
      }
    } else {
      paths.push(base);
      paths.push(base.map(p => [-p[0], p[1]]));   // mirrored: either hand, either way round
    }
    for (const p of paths) { out.push(p); out.push(p.slice().reverse()); }
  }
  return out;
}

const TEMPLATES = [];
for (const id in RUNES) {
  for (const v of variants(RUNES[id])) TEMPLATES.push({ id, cls: RUNES[id].cls, pts: normalize(v) });
}

function scoreToQuality(score) {
  // Empirically: a careless but recognisable rune scores ~0.78, a careful one ~0.93.
  return Math.max(0, Math.min(1, (score - 0.72) / (0.925 - 0.72)));
}

/**
 * @param points  [[x,y],...] in screen space
 * @param unlocked array of rune ids the player may cast
 * @param pool     every rune id of the current class (locked ones are recognised but refused)
 * @returns { ok, rune, score, quality, reason?, locked? }
 */
export function recognize(points, unlocked, pool = unlocked) {
  if (!points || points.length < 8) return { ok: false, reason: 'short' };
  const bb = bbox(points);
  if (Math.max(bb.w, bb.h) < 40 || pathLength(points) < 120) return { ok: false, reason: 'short' };
  const pts = normalize(points);
  if (!pts) return { ok: false, reason: 'short' };
  const best = {};
  for (const t of TEMPLATES) {
    if (!pool.includes(t.id)) continue;
    const d = distAtBestAngle(pts, t.pts);
    if (best[t.id] === undefined || d < best[t.id]) best[t.id] = d;
  }
  // Roundness: how much the distance from the centre varies. A circle is flat
  // (~0.05), a triangle is not (~0.2). Keeps soft-cornered triangles from
  // reading as circles, and makes a lumpy circle score lower.
  let mean = 0;
  for (const p of pts) mean += Math.hypot(p[0], p[1]);
  mean /= pts.length;
  let dev = 0;
  for (const p of pts) dev += (Math.hypot(p[0], p[1]) - mean) ** 2;
  const cv = Math.sqrt(dev / pts.length) / mean;
  const score = id => 1 - best[id] / HALF_DIAG - (id === 'arcane' ? Math.max(0, cv - 0.1) * 1.2 : 0);
  let top = null, topAny = null;
  for (const id of pool) {
    const s = score(id);
    if (!topAny || s > topAny.s) topAny = { id, s };
    if (unlocked.includes(id) && (!top || s > top.s)) top = { id, s };
  }
  if (topAny.id !== top.id && topAny.s > 0.8 && topAny.s - top.s > 0.07) {
    return { ok: false, reason: 'locked', locked: topAny.id, score: topAny.s };
  }
  if (top.s < 0.66) return { ok: false, reason: 'unclear', score: top.s };
  return { ok: true, rune: top.id, score: top.s, quality: scoreToQuality(top.s), cv };
}

/** Ideal glyph for a rune fitted to a box centred at (cx, cy). */
export function glyphPath(id, cx, cy, radius) {
  return RUNES[id].glyph.map(p => [cx + p[0] * radius, cy + p[1] * radius]);
}
