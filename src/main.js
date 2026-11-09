// Mage Evolution: game flow. title -> [choose hero] -> draw rune(s) -> run -> results -> shop -> ...
import * as THREE from 'three';
import { World } from './world.js';
import { Mage, Warrior, OrcPool } from './actors.js';
import { Vfx, ELEMENT_COLOR, ORC_HEIGHT } from './vfx.js';
import { Sfx } from './audio.js';
import { UI } from './ui.js';
import { RuneInput } from './runeInput.js';
import { RunSim } from './sim.js';
import {
  RUNES, CLASSES, CLASS_SCREEN_AFTER_RUNS, findUpgrade, upgradeCost, computeStats, newSave, migrateSave,
  runePower, runeGrade, runeTempo, evolutionTier, biomeAt, fmt, ENEMIES,
} from './data.js';
import { damp } from './geo.js';

const SAVE_KEY = 'mage-evolution-save-v1';
const $ = id => document.getElementById(id);
const _p = { x: 0, y: 0 };
const _v = new THREE.Vector3();

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return migrateSave(JSON.parse(raw));
  } catch (e) { /* storage unavailable: play without saving */ }
  return newSave();
}

class Game {
  constructor() {
    this.save = loadSave();
    this.sfx = new Sfx();
    this.sfx.muted = !!this.save.muted;
    this.world = new World($('scene'));
    const scene = this.world.scene;

    // one model per class; only the current one is shown
    this.heroes = { mage: new Mage(), warrior: new Warrior() };
    for (const id in this.heroes) {
      const h = this.heroes[id];
      h.root.rotation.y = Math.PI;                // run into the cave (-Z)
      h.build(evolutionTier(this.save, id));
      h.root.visible = false;
      scene.add(h.root);
    }
    this.setHero(this.save.cur);
    this.fill = new THREE.PointLight(0xffe6c8, 0, 34, 1.4);
    scene.add(this.fill);

    this.orcs = new OrcPool(scene);
    this.vfx = new Vfx(this.world);
    this.vfx.onCoin = (value, visible) => {
      this.hudGold += value;
      this.ui.setGold(this.hudGold, visible);
      if (visible) this.sfx.coin();
    };
    this.rune = new RuneInput($('rune-canvas'), this.sfx);
    this.ui = new UI(this);
    this.ui.setMuted(this.sfx.muted);
    this.ui.setTitle(this.save);

    this.state = 'title';
    this.sim = null;
    this.stats = computeStats(this.save);
    this.timeScale = 1; this.timeTarget = 1; this.slowT = 0;
    this.speed = 1;                                // debug fast-forward (window.__game.speed = 8)
    this.timers = [];
    this.hudGold = 0;
    this.hurtT = 0;
    this.chosen = [];
    this.fizzles = 0;
    this.biome = null;
    this.focus = new THREE.Vector3(0, 0, 0);
    this.t = 0;

    // compile every shader up front (orcs, coins, spells) while the loading veil is still up
    this.orcs.prewarm(Object.keys(ENEMIES));
    this.vfx.prewarm();
    try { this.world.renderer.compile(scene, this.world.camera); } catch (e) { /* older drivers: compile lazily */ }
    this.vfx.reset();

    this.world.setCamera('shop', true);
    this.ui.show('title');
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    document.addEventListener('pointerdown', () => this.sfx.unlock(), { passive: true });
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
    this.onResize();
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    requestAnimationFrame(() => this.ui.loaded());
  }

  /** The hero on screen. Kept under the old name: most of the flow just says "mage". */
  get mage() { return this.hero; }
  get mine() { return this.save.cls[this.save.cur]; }
  setHero(cls) {
    this.save.cur = cls;
    const pos = this.hero ? this.hero.root.position : null;
    for (const id in this.heroes) this.heroes[id].root.visible = id === cls;
    this.hero = this.heroes[cls];
    if (pos) this.hero.root.position.copy(pos);
    const last = this.mine.lastRunes[0] && RUNES[this.mine.lastRunes[0]] ? this.mine.lastRunes[0] : CLASSES[cls].starter;
    this.hero.setElement(RUNES[last].color);
    this.element = RUNES[last].element;
    this.stats = computeStats(this.save);
  }

  persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* ignore */ } }
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  onResize() {
    this.world.resize();
    this.rune.resize();
    this.layoutDraw();
    this.applyViewShift();
  }
  layoutDraw() {
    if (this.state !== 'draw') return;
    const head = document.querySelector('.draw-head').getBoundingClientRect();
    const foot = document.querySelector('.grimoire').getBoundingClientRect();
    const game = $('game').getBoundingClientRect();
    this.rune.setInsets(head.bottom - game.top + 8, game.bottom - foot.top + 8);
    this.applyViewShift();
  }
  applyViewShift() {
    const w = this.world, s = w.viewShift;
    if (this.state === 'shop') { if (w.portrait) { s.x = 0.2; s.y = -0.27; } else { s.x = -0.29; s.y = 0.02; } }
    else if (this.state === 'draw') { s.x = 0; s.y = (this.rune.cy - this.rune.h / 2) / this.rune.h + 0.02; }
    else if (this.state === 'title') { s.x = 0; s.y = 0.06; }
    else if (this.state === 'classes') { s.x = 0; s.y = w.portrait ? -0.16 : -0.12; }
    else { s.x = 0; s.y = 0; }
  }
  setState(s) { this.state = s; this.applyViewShift(); }

  // ------------------------------------------------------------ flow
  onStart() {
    this.sfx.unlock();
    this.sfx.click();
    if (this.save.runs > 0) this.toShop(false); else this.toDraw();
  }

  /** Shop -> cave. Once the player has a couple of runs behind them, they choose a hero first. */
  goCave() {
    if (this.save.runs >= CLASS_SCREEN_AFTER_RUNS) this.toClasses(); else this.toDraw();
  }
  toClasses() {
    this.sfx.click();
    this.setState('classes');
    this.world.setCamera('draw');
    this.ui.showClasses(this.save);
  }
  pickClass(id) {
    const C = CLASSES[id], mine = this.save.cls[id];
    if (!mine.unlocked) {
      if (this.save.gold < C.cost) { this.sfx.deny(); this.ui.classDenied(id); return; }
      this.save.gold -= C.cost;
      mine.unlocked = true;
      this.setHero(id);
      this.persist();
      this.sfx.evolve();
      this.world.flash(0xffe0a0, 0.9);
      const p = this.hero.root.position;
      this.vfx.burst(p.x, 1.6, p.z, ELEMENT_COLOR.phys, 110, 9, 0.7, 1.3, { up: 0.6, drag: 1.4 });
      this.ui.showClasses(this.save);
      return;
    }
    this.setHero(id);
    this.persist();
    this.toDraw();
  }
  switchClass(id) {
    if (!this.save.cls[id].unlocked || id === this.save.cur) return;
    this.sfx.click();
    this.setHero(id);
    this.persist();
    this.ui.buildShop(this.save);
  }
  pickBoon(i) {
    if (!this.sim || !this.sim.offer) return;
    const b = this.sim.chooseBoon(i);
    this.ui.hideBoons();
    this.ui.addBoon(b);
    this.ui.banner(b.name, b.desc, '#ffe9a6');
    this.sfx.revive();
    this.world.flash(0xffe0a0, 0.5);
    for (const ev of this.sim.drainEvents()) this.onEvent(ev);
  }

  toDraw() {
    this.sfx.click();
    this.stats = computeStats(this.save);
    this.chosen = [];
    this.fizzles = 0;
    this.setState('draw');
    this.world.setCamera('draw');
    this.ui.show('draw');
    this.nextRune();
  }
  nextRune() {
    const C = CLASSES[this.save.cur];
    const first = this.mine.runs === 0;
    this.ui.setupDraw({ index: this.chosen.length, count: this.stats.slots, chosen: this.chosen, unlocked: this.stats.runes, canShop: this.save.runs > 0, first, cls: this.save.cur });
    this.layoutDraw();
    this.rune.begin(this.stats.runes, (res, dur) => this.onStroke(res, dur), C.runes);
    if (first && this.chosen.length === 0) { this.rune.showGuide(C.starter); this.ui.selectRuneCard(C.starter); }
  }
  onRuneCard(id, has) {
    if (!has) {
      this.sfx.deny();
      this.ui.runeFizzle('Not yet learned', `Buy ${RUNES[id].name} in the shop.`);
      return;
    }
    this.sfx.click();
    this.rune.showGuide(id);
    this.ui.selectRuneCard(id);
  }
  onStroke(res, dur) {
    if (this.state !== 'draw') return;
    if (!res.ok) {
      if (res.reason === 'short') { this.rune.points = []; return; }
      this.sfx.fizzle();
      this.rune.reject();
      this.fizzles++;
      if (res.reason === 'locked') this.ui.runeFizzle('Not yet learned', `That looks like ${RUNES[res.locked].name}. You have not learned it yet.`);
      else this.ui.runeFizzle('It fizzles', 'One clean stroke. Tap a card below to see its shape.');
      if (this.fizzles >= 2 && !this.rune.guide) { this.rune.showGuide(this.stats.runes[0]); this.ui.selectRuneCard(this.stats.runes[0]); }
      return;
    }
    const R = RUNES[res.rune];
    const power = runePower(res.quality, this.stats.mastery);
    const haste = runeTempo(dur, R.complexity);
    const grade = runeGrade(res.quality);
    this.chosen.push({ rune: res.rune, power, haste, grade, quality: res.quality });
    this.sfx.runeResult(grade);
    this.ui.runeResult({ rune: res.rune, grade, power, haste });
    this.ui.selectRuneCard(null);
    if (this.chosen.length === 1) { this.mage.setElement(R.color); this.element = R.element; }
    // the finished rune flies into the staff
    this.mage.getStaffTip(_v);
    const sp = this.world.toScreen(_v.x, _v.y, _v.z, _p) || { x: this.world.w / 2, y: this.world.h / 2 };
    this.rune.accept(res.rune, sp.x, sp.y, () => {
      this.world.flash(R.hex, 0.35);
      if (this.chosen.length < this.stats.slots) this.nextRune();
      else this.launch();
    });
  }
  launch() {
    this.rune.end();
    this.sfx.runStart();
    this.ui.fade(true);
    this.after(0.26, () => {
      this.startRun();
      this.ui.fade(false);
    });
  }
  startRun() {
    this.mine.lastRunes = this.chosen.map(c => c.rune);
    this.sim = new RunSim({ stats: this.stats, slots: this.chosen, seed: (Math.random() * 1e9) | 0 });
    this.orcs.clear();
    this.vfx.reset();
    this.hudGold = 0;
    this.biome = null;
    this.timeScale = this.timeTarget = 1;
    this.setState('run');
    this.world.setCamera('run', true);
    this.ui.show('hud');
    this.ui.startRun(this.chosen, this.mine.bestDepth);
    this.sfx.setBeat(true, 0);
    this.syncActors(0);
  }

  endRun() {
    const sim = this.sim, save = this.save;
    const mine = this.mine;
    const sum = sim.summary(mine.bestDepth);
    save.gold += sum.total; save.totalGold += sum.total; save.runs++; mine.runs++;
    mine.bestDepth = Math.max(mine.bestDepth, sum.depth);
    this.ui.hideBoons();
    if (sum.victory) { save.victories++; save.bestTime = save.bestTime ? Math.min(save.bestTime, sum.time) : sum.time; }
    this.persist();
    this.sfx.setBeat(false);
    this.setState('results');
    this.timeTarget = 1;
    this.ui.showResults(sum, save, () => this.toShop(false));
  }

  toShop(fromDraw) {
    this.sfx.click();
    if (fromDraw) this.rune.end();
    this.ui.fade(true);
    this.after(0.3, () => {
      this.sim = null;
      this.orcs.clear();
      this.vfx.reset();
      this.timeScale = this.timeTarget = 1;
      this.mage.root.position.set(0, 0, 0);
      this.stats = computeStats(this.save);
      this.setState('shop');
      this.world.setCamera('shop', true);
      this.ui.buildShop(this.save);
      this.ui.show('shop');
      this.ui.fade(false);
    });
  }

  buy(id) {
    const save = this.save, u = findUpgrade(save.cur, id), up = this.mine.upgrades;
    if (!u) return;
    const lvl = up[id] || 0;
    if (lvl >= u.max) return;
    const cost = upgradeCost(u, lvl);
    if (save.gold < cost) { this.sfx.deny(); this.ui.boughtFx(id, false); return; }
    save.gold -= cost;
    up[id] = lvl + 1;
    this.stats = computeStats(save);
    this.sfx.buy(lvl);
    this.ui.refreshShop(save);
    this.ui.boughtFx(id, true);
    const p = this.mage.root.position;
    this.vfx.burst(p.x, 1.4, p.z, ELEMENT_COLOR.phys, 16, 4, 0.4, 0.6, { up: 0.8, drag: 2 });
    const tier = evolutionTier(save);
    if (tier > this.mage.tier) this.evolve(tier);
    this.persist();
  }
  evolve(tier) {
    const p = this.mage.root.position, c = ELEMENT_COLOR.phys;
    this.sfx.evolve();
    this.world.flash(0xffe0a0, 0.9);
    this.world.shake(0.5);
    this.vfx.burst(p.x, 1.6, p.z, c, 120, 9, 0.7, 1.4, { up: 0.6, drag: 1.4 });
    for (let i = 0; i < 3; i++) this.vfx.ring(p.x, 0.1 + i * 0.03, p.z, c, 4 + i * 2.5, 0.6 + i * 0.25, 2.5);
    this.vfx.flash(p.x, 1.6, p.z, c, 4, 0.5, 3);
    this.vfx.light(p.x, 2.5, p.z, c, 900, 0.9);
    this.mage.build(tier);
    this.ui.showEvolve(tier, this.save.cur);
  }
  toggleMute() {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    this.persist();
    this.sfx.click();
  }
  resetProgress() {
    this.save = newSave();
    this.persist();
    for (const id in this.heroes) this.heroes[id].build(0);
    this.setHero('mage');
    this.ui.closeMenu();
    this.ui.setTitle(this.save);
    this.setState('title');
    this.world.setCamera('shop', true);
    this.ui.show('title');
  }

  // ------------------------------------------------------------ sim events
  screen(x, y, z) { return this.world.toScreen(x, y, z, _p); }
  onEvent(ev) {
    const sim = this.sim, ui = this.ui, sfx = this.sfx, vfx = this.vfx;
    vfx.handle(ev, sim);
    switch (ev.type) {
      case 'spawn':
        this.orcs.spawn(ev.e);
        if (ev.e.type === 'loot') { ui.toast('Loot hauler! Drop it before it runs.'); sfx.lootSpotted(); }
        break;
      case 'cast': sfx.cast(ev.rune); ui.slotFired(ev.slot); break;
      case 'boonOffer': this.slow(0.15, 0.3); ui.showBoons(ev.offer); sfx.tally(); break;
      case 'explode': sfx.explode(ev.kind); break;
      case 'meteor': sfx.meteorFall(); break;
      case 'hit': {
        sfx.hit(ev.element, ev.crit);
        if (ev.dot && ui.floats.length > 18) break;
        const p = this.screen(ev.x, 1.4 + ev.r * 1.6, -ev.d);
        if (p) ui.float(p.x, p.y, fmt(Math.max(1, ev.amount)), (ev.crit ? 'crit ' : '') + (ev.dot ? 'dot ' : '') + ev.element);
        break;
      }
      case 'react': {
        sfx.react();
        const p = this.screen(ev.x, 3, -ev.d);
        if (p) ui.reaction(p.x, p.y, ev.name);
        break;
      }
      case 'kill': {
        const e = ev.e, m = sim.mage;
        let dx = e.x - m.x, dz = -(e.d - m.d);
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const tint = ELEMENT_COLOR[ev.element] || ELEMENT_COLOR.phys;
        this.orcs.kill(e, dx, dz, e.def.heavy ? 3 : 7, tint);
        vfx.killBurst(e, ev.element, dx, dz);
        const n = e.type === 'boss' ? 60 : Math.min(e.type === 'loot' || e.def.elite ? 18 : 9, 2 + Math.floor(Math.log10(ev.gold + 1) * 2));
        vfx.spawnCoins(e.x, -e.d, ev.gold, n);
        sfx.kill(e.def.heavy);
        const p = this.screen(e.x, (ORC_HEIGHT[e.type] || 1.2) * 1.5 + 0.4, -e.d);
        if (p) ui.float(p.x, p.y, '+' + fmt(Math.max(1, ev.gold)), 'gold');
        if (e.def.elite) { this.slow(0.25, 0.5); this.world.flash(0xffe0a0, 0.5); }
        break;
      }
      case 'escape': this.orcs.remove(ev.e); ui.toast('The loot hauler got away.'); break;
      case 'lost': this.orcs.remove(ev.e); break;
      case 'horde': ui.toast('Goblin tide!'); sfx.horde(); break;
      case 'enemyShoot': sfx.throwAxe(); break;
      case 'mageHit': {
        this.hurtT = 0.16;
        const k = Math.min(1, (ev.amount + ev.absorbed) / sim.mage.maxHp * 5 + 0.2);
        if (ev.amount > 0) { this.world.flash(0xff2010, 0.55 * k); this.world.shake(0.25 + k * 0.4); ui.hpHit(); }
        else vfx.shieldHit = 1;
        sfx.mageHurt(ev.amount <= 0);
        break;
      }
      case 'enemyAttack': sfx.enemySwing(); break;
      case 'shieldBreak': sfx.shieldBreak(); break;
      case 'revive': sfx.revive(); ui.banner('Phoenix Feather', 'You rise again', '#ffb24a'); this.slow(0.3, 0.6); break;
      case 'champion': ui.banner(ev.e.name, 'Champion of the horde', '#ff8a70'); sfx.roar(); break;
      case 'bossIntro': ui.banner('Gor’mak the Warlord', 'End him', '#ff2a55'); sfx.roar(); this.world.shake(0.8); break;
      case 'bossEnrage': ui.banner('Enraged', '', '#ff2a55'); sfx.roar(); this.world.shake(0.8); break;
      case 'bossSummon': sfx.roar(); break;
      case 'slamHit': sfx.slam(); break;
      case 'bossDead': this.slow(0.2, 1.3); this.world.flash(0xffffff, 1); this.world.shake(1.4); ui.banner('Victory', 'The cave is yours', '#ffe9a6'); sfx.victory(); break;
      case 'mageDead':
        sfx.death();
        this.world.setCamera('dead');
        this.world.shake(0.9);
        this.world.flash(0xff2010, 0.9);
        this.slow(0.22, 1.1);
        vfx.burst(sim.mage.x, 1.5, -sim.mage.d, ELEMENT_COLOR[this.element] || ELEMENT_COLOR.phys, 70, 8, 0.6, 1.1, { up: 0.6, drag: 1.5 });
        this.setState('ending');
        this.after(1.5, () => this.endRun());
        break;
      case 'victory':
        this.setState('ending');
        this.after(1.4, () => this.endRun());
        break;
    }
  }
  /** Debug helper: teleport the current run to a depth. */
  debugJump(d) {
    const sim = this.sim;
    if (!sim) return;
    for (const e of sim.enemies) this.orcs.remove(e);
    sim.enemies.length = 0;
    sim.mage.d = d;
    sim.packIdx = sim.packs.findIndex(p => p.d > d + 8);
    if (sim.packIdx < 0) sim.packIdx = sim.packs.length;
    this.world.camSnap = true;
  }
  slow(scale, sec) { this.timeScale = scale; this.timeTarget = scale; this.slowT = sec; }

  // ------------------------------------------------------------ per-frame
  syncActors(dt) {
    const sim = this.sim;
    if (!sim) return;
    const m = sim.mage;
    this.mage.root.position.set(m.x, 0, -m.d);
    for (const e of sim.enemies) {
      const v = this.orcs.get(e.id) || this.orcs.spawn(e);
      v.update(dt, e, m, this.t);
    }
  }
  pickElite() {
    let best = null;
    for (const e of this.sim.enemies) {
      if (!e.def.elite || e.d - this.sim.mage.d > 36) continue;
      if (!best || e.type === 'boss') best = e;
    }
    return best;
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const raw = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const rdt = Math.min(raw, 1 / 20);
    // the host frame can change size without a window resize event (phones, embeds)
    const cv = this.world.canvas;
    if (cv.clientWidth && cv.clientHeight && (cv.clientWidth !== this.world.w || cv.clientHeight !== this.world.h)) this.onResize();
    if (this.state === 'run') this.world.watchPerformance(raw * 1000);

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= rdt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.slowT > 0) { this.slowT -= rdt; if (this.slowT <= 0) this.timeTarget = 1; }
    this.timeScale = damp(this.timeScale, this.timeTarget, 5, rdt);
    const dt = rdt * this.timeScale * this.speed;
    this.t += dt;
    this.hurtT -= dt;

    const sim = this.sim, world = this.world, mage = this.mage;
    let depth = 0;
    if (sim && (this.state === 'run' || this.state === 'ending' || this.state === 'results')) {
      if (this.state !== 'results') {
        const steps = Math.max(1, Math.ceil(dt / (1 / 40)));
        for (let i = 0; i < steps; i++) {
          sim.step(dt / steps);
          const evs = sim.drainEvents();
          for (const ev of evs) this.onEvent(ev);
        }
      }
      this.syncActors(dt);
      const m = sim.mage;
      depth = m.d;
      const sprint = m.alive && !sim.over ? m.speedFrac : 0;
      mage.update(dt, { moving: sprint > 0.15, speed: sprint, casting: m.castT > 0.1, hurt: this.hurtT > 0, dead: !m.alive });
      world.speedK = damp(world.speedK, sprint, 4, rdt);
      this.sprint = sprint;
      if (this.state === 'run') {
        const elite = this.pickElite();
        this.ui.updateRun(sim, elite);
        world.setCamera(elite && elite.type === 'boss' ? 'boss' : 'run');
        const b = biomeAt(m.d);
        if (b !== this.biome) {
          const firstZone = this.biome === null;
          this.biome = b;
          this.ui.banner(b.name, firstZone ? 'Slay everything' : `${Math.floor(m.d)} m deep`, '#' + b.accent.toString(16).padStart(6, '0'));
          if (!firstZone) this.sfx.zone();
        }
        this.sfx.setBeat(true, Math.min(1, sim.enemies.length / 18));
        if (m.hp < m.maxHp * 0.3 && m.alive) { world.grade.uniforms.uFlash.value.set(0xff1808); world.flashAmt = Math.max(world.flashAmt, 0.3 + Math.sin(this.t * 7) * 0.1); }
      }
      this.fill.intensity = 0;
    } else {
      mage.update(rdt, { moving: false, casting: false, hurt: false, dead: false });
      world.speedK = 0; this.sprint = 0;
      // a soft fill so the mage reads against the moonlit entrance
      this.fill.position.copy(world.camera.position).add(_v.set(0, 1.5, 0));
      this.fill.intensity = damp(this.fill.intensity, 42, 4, rdt);
    }
    if (this.state === 'results') this.ui.updateResults(rdt);

    this.orcs.updateDying(dt);
    this.orcs.realShadows = world.quality === 2;
    this.orcs.updateBlobs();
    this.focus.copy(mage.root.position);
    world.update(rdt, this.focus, depth);
    mage.getStaffTip(this.vfx.staffTip);
    this.vfx.magePos.copy(mage.root.position);
    const live = sim && sim.mage.alive;
    this.vfx.update(dt, {
      sim: sim && this.state !== 'shop' ? sim : null,
      depth,
      mage: {
        shieldFrac: live && sim.mage.maxShield > 0 ? sim.mage.shield / sim.mage.maxShield : 0,
        wisps: !sim || live ? this.stats.wisps : 0,
        element: !sim || live ? this.element : null,
        tier: mage.tier,
        speed: this.sprint || 0,
      },
    });
    world.grade.uniforms.uDesat.value = damp(world.grade.uniforms.uDesat.value, sim && !sim.mage.alive ? 0.75 : 0, 3, rdt);
    world.render();
    this.rune.update(rdt);
  }
}

window.__game = new Game();
