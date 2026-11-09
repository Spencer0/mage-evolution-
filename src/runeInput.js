// The rune circle: captures one stroke, draws it as a glowing trail, and plays
// the "rune accepted / fizzled" animations on a 2D canvas above the 3D scene.
import { recognize } from './recognizer.js';
import { RUNES } from './data.js';

const TAU = Math.PI * 2;

export class RuneInput {
  constructor(canvas, sfx) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sfx = sfx;
    this.active = false;
    this.drawing = false;
    this.points = [];
    this.sparks = [];
    this.guide = null;
    this.guideT = 0;
    this.anim = null;
    this.t = 0;
    this.insets = { top: 110, bottom: 150 };
    this.unlocked = ['ember'];
    this.onStroke = null;
    this.dirty = true;
    this.lastMove = 0;
    this.speed = 0;

    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.layout();
    this.dirty = true;
  }
  setInsets(top, bottom) { this.insets.top = top; this.insets.bottom = bottom; this.layout(); }
  layout() {
    const availH = Math.max(120, this.h - this.insets.top - this.insets.bottom);
    this.cx = this.w / 2;
    this.cy = this.insets.top + availH / 2;
    this.R = Math.max(70, Math.min(this.w * 0.44, availH * 0.48, 300));
  }

  begin(unlocked, onStroke, pool = unlocked) {
    this.unlocked = unlocked; this.onStroke = onStroke; this.pool = pool;
    this.active = true; this.drawing = false; this.points = []; this.anim = null;
    this.dirty = true;
  }
  end() { this.active = false; this.drawing = false; this.guide = null; this.sfx.humStop(); this.dirty = true; }
  showGuide(id) { this.guide = id; this.guideT = 0; }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, performance.now()]; }
  down(e) {
    if (!this.active || this.anim || this.drawing) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    this.pointerId = e.pointerId;
    this.drawing = true;
    this.points = [this.pos(e)];
    this.sfx.unlock();
    this.sfx.humStart();
    this.speed = 0;
  }
  move(e) {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const evs = list && list.length ? list : [e];
    for (const ev of evs) {
      const p = this.pos(ev), last = this.points[this.points.length - 1];
      const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      if (d < 2.5) continue;
      this.points.push(p);
      const dtm = Math.max(1, p[2] - last[2]);
      this.speed += (Math.min(1, d / dtm / 1.6) - this.speed) * 0.3;
      for (let i = 0; i < 2; i++) this.sparks.push({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90 - 20, life: 0.5 + Math.random() * 0.4, max: 0.9, c: '190,215,255' });
    }
    this.lastMove = performance.now();
    this.sfx.humSet(this.speed);
  }
  up(e) {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    this.drawing = false;
    this.sfx.humStop();
    const pts = this.points;
    const dur = pts.length > 1 ? (pts[pts.length - 1][2] - pts[0][2]) / 1000 : 0;
    const res = recognize(pts.map(p => [p[0], p[1]]), this.unlocked, this.pool || this.unlocked);
    if (this.onStroke) this.onStroke(res, dur);
  }

  /** Play the success animation, then fly the rune to (tx, ty) and call done. */
  accept(runeId, tx, ty, done) {
    const R = RUNES[runeId];
    const user = this.points.map(p => [p[0], p[1]]);
    // place the ideal glyph over where the player actually drew
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of user) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const gx = (minX + maxX) / 2, gy = (minY + maxY) / 2, gr = Math.max(40, Math.max(maxX - minX, maxY - minY) / 2);
    this.anim = { kind: 'accept', t: 0, rune: runeId, rgb: hexToRgb(R.color), user, gx, gy, gr, tx, ty, done };
    this.guide = null;
    const glyph = R.glyph;
    for (let i = 0; i < 46; i++) {
      const k = Math.random() * (glyph.length - 1), i0 = Math.floor(k), f = k - i0;
      const x = gx + (glyph[i0][0] + (glyph[i0 + 1][0] - glyph[i0][0]) * f) * gr, y = gy + (glyph[i0][1] + (glyph[i0 + 1][1] - glyph[i0][1]) * f) * gr;
      const a = Math.random() * TAU, s = 60 + Math.random() * 240;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, max: 1.1, c: this.anim.rgb });
    }
  }
  reject() {
    this.anim = { kind: 'reject', t: 0, user: this.points.map(p => ({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 60 })) };
  }

  get busy() { return !!this.anim; }

  update(dt) {
    this.t += dt;
    const idle = !this.active && !this.anim && this.sparks.length === 0;
    if (idle && !this.dirty) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.dirty = false;
    if (idle) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (this.active) this.drawCircle(ctx, dt);
    if (this.active && this.guide && !this.drawing && !this.anim) this.drawGuide(ctx, dt);

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      if (a.kind === 'accept') {
        const morph = Math.min(1, a.t / 0.28);
        if (morph < 1) this.strokePath(ctx, a.user, '200,220,255', 1 - morph, 1);
        const flyT = Math.max(0, (a.t - 0.8) / 0.42);
        const e = flyT * flyT;
        const x = a.gx + (a.tx - a.gx) * e, y = a.gy + (a.ty - a.gy) * e, r = a.gr * (1 - e * 0.94);
        const pulse = 1 + Math.sin(a.t * 14) * 0.03 + (1 - morph) * 0.15;
        const g = RUNES[a.rune].glyph.map(p => [x + p[0] * r * pulse, y + p[1] * r * pulse]);
        this.strokePath(ctx, g, a.rgb, morph * (1 - flyT * 0.3), 1.25 - e * 0.7, true);
        if (flyT > 0 && flyT < 1) for (let i = 0; i < 3; i++) this.sparks.push({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, life: 0.35, max: 0.35, c: a.rgb });
        if (flyT >= 1) {
          for (let i = 0; i < 34; i++) { const an = Math.random() * TAU, s = 80 + Math.random() * 300; this.sparks.push({ x: a.tx, y: a.ty, vx: Math.cos(an) * s, vy: Math.sin(an) * s, life: 0.3 + Math.random() * 0.5, max: 0.8, c: a.rgb }); }
          const done = a.done; this.anim = null; this.points = [];
          if (done) done();
        }
      } else {
        const k = a.t / 0.55;
        for (const p of a.user) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        if (k < 1) this.strokePath(ctx, a.user.map(p => [p.x, p.y]), '226,110,100', 1 - k, 0.9);
        else { this.anim = null; this.points = []; }
      }
    } else if (this.points.length > 1) {
      this.strokePath(ctx, this.points, '200,220,255', 1, 1);
      if (this.drawing) {
        const p = this.points[this.points.length - 1];
        const grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 26);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.3, 'rgba(190,215,255,0.5)'); grad.addColorStop(1, 'rgba(190,215,255,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p[0], p[1], 26, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // sparks
    if (this.sparks.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.life -= dt;
        if (s.life <= 0) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
        s.vx *= 1 - 2.5 * dt; s.vy *= 1 - 2.5 * dt; s.vy += 60 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const k = s.life / s.max;
        ctx.fillStyle = `rgba(${s.c},${(k * 0.9).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.2 + k * 2.6, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (this.sparks.length > 500) this.sparks.splice(0, this.sparks.length - 500);
    }
    this.dirty = true;
  }

  strokePath(ctx, pts, rgb, alpha, scale = 1, closedGlow = false) {
    if (pts.length < 2 || alpha <= 0) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length < 6) { for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }
    else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
    ctx.globalCompositeOperation = 'lighter';
    const passes = closedGlow ? [[44, 0.07], [26, 0.14], [13, 0.34], [5.5, 1]] : [[30, 0.07], [15, 0.2], [8, 0.4], [3.6, 1]];
    for (const [w, a] of passes) {
      ctx.lineWidth = w * scale;
      ctx.strokeStyle = w < 6 ? `rgba(255,255,255,${(a * alpha).toFixed(3)})` : `rgba(${rgb},${(a * alpha).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawCircle(ctx) {
    const { cx, cy, R, t } = this;
    const pulse = this.drawing ? 1 : 0.75 + Math.sin(t * 2) * 0.08;
    const grad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.12);
    grad.addColorStop(0, 'rgba(60,90,170,0.16)'); grad.addColorStop(0.75, 'rgba(30,45,100,0.12)'); grad.addColorStop(1, 'rgba(30,45,100,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(244,196,82,${0.5 * pulse})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(244,196,82,${0.1 * pulse})`; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(150,185,255,${0.36 * pulse})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, 0, TAU); ctx.stroke();
    // tick ring
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.12);
    ctx.strokeStyle = `rgba(244,196,82,${0.42 * pulse})`; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, r0 = R * (i % 4 === 0 ? 0.925 : 0.955); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * R * 0.99, Math.sin(a) * R * 0.99); }
    ctx.stroke();
    // eight little sigils
    ctx.fillStyle = `rgba(190,215,255,${0.6 * pulse})`;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, x = Math.cos(a) * R * 1.06, y = Math.sin(a) * R * 1.06, s = R * 0.022 + 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.6); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // counter-rotating dashed inner ring
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t * 0.2);
    ctx.setLineDash([R * 0.05, R * 0.09]);
    ctx.strokeStyle = `rgba(150,185,255,${0.2 * pulse})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawGuide(ctx, dt) {
    const R = RUNES[this.guide];
    if (!R) return;
    this.guideT += dt;
    const { cx, cy } = this, r = this.R * 0.6, rgb = hexToRgb(R.color);
    const g = R.glyph.map(p => [cx + p[0] * r, cy + p[1] * r]);
    ctx.setLineDash([6, 9]);
    ctx.strokeStyle = `rgba(${rgb},0.4)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(g[0][0], g[0][1]);
    for (let i = 1; i < g.length; i++) ctx.lineTo(g[i][0], g[i][1]);
    ctx.stroke(); ctx.setLineDash([]);
    // a bright bead traces the stroke order
    let total = 0; const lens = [];
    for (let i = 1; i < g.length; i++) { const l = Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]); lens.push(l); total += l; }
    const cyc = (this.guideT % 2.2) / 1.7;
    if (cyc <= 1) {
      const head = cyc * total, tail = Math.max(0, head - total * 0.3);
      const seg = [];
      let acc = 0;
      for (let i = 0; i < lens.length; i++) {
        const a = acc, b = acc + lens[i];
        if (b >= tail && a <= head) {
          const f0 = Math.max(0, (tail - a) / lens[i]), f1 = Math.min(1, (head - a) / lens[i]);
          if (!seg.length) seg.push([g[i][0] + (g[i + 1][0] - g[i][0]) * f0, g[i][1] + (g[i + 1][1] - g[i][1]) * f0]);
          seg.push([g[i][0] + (g[i + 1][0] - g[i][0]) * f1, g[i][1] + (g[i + 1][1] - g[i][1]) * f1]);
        }
        acc = b;
      }
      if (seg.length > 1) {
        this.strokePath(ctx, seg, rgb, 0.85, 0.8);
        const h = seg[seg.length - 1];
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(h[0], h[1], 5, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
