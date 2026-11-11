// Mage Evolution: game flow. title -> [party] -> draw rune(s) -> run -> results -> shop -> ...
import * as THREE from 'three';
import { World } from './world.js';
import { Mage, Warrior, OrcPool } from './actors.js';
import { Vfx, ELEMENT_COLOR, ORC_HEIGHT } from './vfx.js';
import { Sfx } from './audio.js';
import { UI } from './ui.js';
import { RuneInput } from './runeInput.js';
import { RunSim, formation } from './sim.js';
import {
  RUNES, CLASSES, CLASS_ORDER, CLASS_SCREEN_AFTER_RUNS, findUpgrade, upgradeCost, computeStats, newSave, migrateSave,
  runePower, runeGrade, runeTempo, evolutionTier, biomeAt, fmt, ENEMIES,
} from './data.js';
import { damp } from './geo.js';

const SAVE_KEY = 'mage-evolution-save-v1';
const FF_STEPS = [1, 2, 4, 16];
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

    // one model per class; everyone recruited stands (and runs) together
    this.models = { mage: new Mage(), warrior: new Warrior() };
    this.elementBy = {};
    for (const id in this.models) {
      const h = this.models[id];
      h.root.rotation.y = Math.PI;                // run into the cave (-Z)
      h.build(evolutionTier(this.save, id));
      scene.add(h.root);
      const last = this.save.cls[id].lastRunes[0];
      const rune = last && RUNES[last] ? last : CLASSES[id].starter;
      h.setElement(RUNES[rune].color);
      this.elementBy[id] = RUNES[rune].element;
    }
    this.fill = new THREE.PointLight(0xffe6c8, 0, 34, 1.4);
    scene.add(this.fill);

    this.orcs = new OrcPool(scene);
    this.vfx = new Vfx(this.world);
    this.vfx.onCoin = (value, visible) => {
      this.hudGold += value;
      this.ui.setGold(this.hudGold, visible && this.ff < 16);
      if (visible) this.sfx.coin();
    };
    this.rune = new RuneInput($('rune-canvas'), this.sfx);
    this.ui = new UI(this);
    this.ui.setMuted(this.sfx.muted);
    this.ui.setTitle(this.save);

    this.state = 'title';
    this.sim = null;
    this.runParty = [];
    this.timeScale = 1; this.timeTarget = 1; this.slowT = 0;
    this.ff = 1;                                   // fast-forward for the current run
    this.speed = 1;                                // extra debug multiplier (window.__game.speed = 8)
    this.timers = [];
    this.hudGold = 0;
    this.chosen = [];
    this.fizzles = 0;
    this.biome = null;
    this.focusCls = null;                          // which hero the camera favours outside a run
    this.focus = new THREE.Vector3(0, 0, 0);
    this.t = 0;
    this.placeIdle();

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

  /** Everyone recruited, in the order the simulation numbers them. */
  party() { return CLASS_ORDER.filter(id => this.save.cls[id].unlocked); }
  get mine() { return this.save.cls[this.save.cur]; }
  /** The model of the hero whose shop tab is open. */
  get mage() { return this.models[this.save.cur]; }
  /** Stand the party in formation at the cave mouth. */
  placeIdle() {
    const party = this.party();
    for (const id in this.models) {
      const m = this.models[id], f = formation(id, party.length === 1);
      m.root.visible = party.includes(id);
      m.root.position.set(f.ox, 0, -f.od);
    }
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
    else if (this.state === 'classes') { s.x = 0; s.y = w.portrait ? -0.2 : -0.14; }
    else { s.x = 0; s.y = 0; }
  }
  setState(s) { this.state = s; this.applyViewShift(); }

  // ------------------------------------------------------------ flow
  onStart() {
    this.sfx.unlock();
    this.sfx.click();
    if (this.save.runs > 0) this.toShop(false); else this.toDraw();
  }

  /** Shop -> cave. While someone is still waiting to be recruited, the party screen comes first. */
  goCave() {
    const waiting = CLASS_ORDER.some(id => !this.save.cls[id].unlocked);
    if (waiting && this.save.runs >= CLASS_SCREEN_AFTER_RUNS) this.toClasses(); else this.toDraw();
  }
  toClasses() {
    this.sfx.click();
    this.focusCls = null;
    this.setState('classes');
    this.world.setCamera('draw');
    this.ui.showClasses(this.save);
  }
  recruit(id) {
    const C = CLASSES[id], mine = this.save.cls[id];
    if (mine.unlocked) return;
    if (this.save.gold < C.cost) { this.sfx.deny(); this.ui.classDenied(id); return; }
    this.save.gold -= C.cost;
    mine.unlocked = true;
    this.persist();
    this.placeIdle();
    this.sfx.evolve();
    this.world.flash(0xffe0a0, 0.9);
    const p = this.models[id].root.position;
    this.vfx.burst(p.x, 1.6, p.z, ELEMENT_COLOR.phys, 110, 9, 0.7, 1.3, { up: 0.6, drag: 1.4 });
    for (let i = 0; i < 3; i++) this.vfx.ring(p.x, 0.1 + i * 0.03, p.z, ELEMENT_COLOR.phys, 3 + i * 2, 0.6 + i * 0.2, 2.5);
    this.ui.showClasses(this.save);
  }
  switchClass(id) {
    if (!this.save.cls[id].unlocked || id === this.save.cur) return;
    this.sfx.click();
    this.save.cur = id;
    this.focusCls = id;
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

  /** Every hero in the party draws their own runes, one after the other. */
  toDraw() {
    this.sfx.click();
    const party = this.party();
    this.statsBy = {}; this.chosenBy = {}; this.queue = [];
    for (const cls of party) {
      const st = this.statsBy[cls] = computeStats(this.save, cls);
      this.chosenBy[cls] = [];
      for (let i = 0; i < st.slots; i++) this.queue.push({ cls, i });
    }
    this.qi = 0;
    this.fizzles = 0;
    this.placeIdle();
    this.setState('draw');
    this.world.setCamera('draw');
    this.ui.show('draw');
    this.nextRune();
  }
  nextRune() {
    const q = this.queue[this.qi], cls = q.cls, C = CLASSES[cls], st = this.statsBy[cls];
    const first = this.save.cls[cls].runs === 0;
    this.focusCls = cls;
    this.ui.setupDraw({ index: q.i, count: st.slots, chosen: this.chosenBy[cls], unlocked: st.runes, canShop: this.save.runs > 0, first, cls, party: this.party().length });
    this.layoutDraw();
    this.rune.begin(st.runes, (res, dur) => this.onStroke(res, dur), C.runes);
    if (first && q.i === 0) { this.rune.showGuide(C.starter); this.ui.selectRuneCard(C.starter); }
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
    const q = this.queue[this.qi], cls = q.cls, st = this.statsBy[cls];
    if (!res.ok) {
      if (res.reason === 'short') { this.rune.points = []; return; }
      this.sfx.fizzle();
      this.rune.reject();
      this.fizzles++;
      if (res.reason === 'locked') this.ui.runeFizzle('Not yet learned', `That looks like ${RUNES[res.locked].name}. You have not learned it yet.`);
      else this.ui.runeFizzle('It fizzles', 'One clean stroke. Tap a card below to see its shape.');
      if (this.fizzles >= 2 && !this.rune.guide) { this.rune.showGuide(st.runes[0]); this.ui.selectRuneCard(st.runes[0]); }
      return;
    }
    const R = RUNES[res.rune], model = this.models[cls];
    const power = runePower(res.quality, st.mastery);
    const haste = runeTempo(dur, R.complexity);
    const grade = runeGrade(res.quality);
    this.chosenBy[cls].push({ rune: res.rune, power, haste, grade, quality: res.quality });
    this.sfx.runeResult(grade);
    this.ui.runeResult({ rune: res.rune, grade, power, haste });
    this.ui.selectRuneCard(null);
    if (q.i === 0) { model.setElement(R.color); this.elementBy[cls] = R.element; }
    // the finished rune flies into that hero's weapon
    model.getStaffTip(_v);
    const sp = this.world.toScreen(_v.x, _v.y, _v.z, _p) || { x: this.world.w / 2, y: this.world.h / 2 };
    this.rune.accept(res.rune, sp.x, sp.y, () => {
      this.world.flash(R.hex, 0.35);
      this.fizzles = 0;
      if (++this.qi < this.queue.length) this.nextRune();
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
    const party = this.runParty = this.party(), save = this.save;
    for (const cls of party) save.cls[cls].lastRunes = this.chosenBy[cls].map(c => c.rune);
    this.sim = new RunSim({
      heroes: party.map(cls => ({ cls, stats: this.statsBy[cls], slots: this.chosenBy[cls] })),
      seed: (Math.random() * 1e9) | 0,
    });
    this.chosen = party.flatMap(cls => this.chosenBy[cls]);
    this.orcs.clear();
    this.vfx.reset();
    this.hudGold = 0;
    this.biome = null;
    this.focusCls = null;
    this.recordAtStart = save.bestDepth;           // passing this drops fast-forward back to 1x
    this.recordHit = false;
    this.timeScale = this.timeTarget = 1;
    this.setState('run');
    this.world.setCamera('run', true);
    this.ui.show('hud');
    this.ui.startRun(this.chosen, save.bestDepth, party);
    this.setFF(FF_STEPS.includes(save.ff) ? save.ff : 1);
    this.sfx.setBeat(true, 0);
    this.syncActors(0);
  }

  // ------------------------------------------------------------ fast-forward
  setFF(n, dropped) {
    this.ff = n;
    this.vfx.lod = n >= 16 ? 0.2 : n >= 4 ? 0.5 : 1;
    this.world.rate = n;
    this.ui.setFF(n, dropped);
  }
  /** The HUD button: 1x -> 2x -> 4x -> 16x -> 1x. The choice is remembered for the next run. */
  cycleFF() {
    const n = FF_STEPS[(FF_STEPS.indexOf(this.ff) + 1) % FF_STEPS.length];
    this.setFF(n);
    this.save.ff = n;
    this.persist();
    this.sfx.click();
  }

  endRun() {
    const sim = this.sim, save = this.save;
    const sum = sim.summary(save.bestDepth);
    save.gold += sum.total; save.totalGold += sum.total; save.runs++;
    save.bestDepth = Math.max(save.bestDepth, sum.depth);
    for (const cls of this.runParty) {
      const c = save.cls[cls];
      c.runs++; c.bestDepth = Math.max(c.bestDepth, sum.depth);
    }
    this.ui.hideBoons();
    if (sum.victory) { save.victories++; save.bestTime = save.bestTime ? Math.min(save.bestTime, sum.time) : sum.time; }
    this.persist();
    this.sfx.setBeat(false);
    this.setFF(1);
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
      this.placeIdle();
      this.focusCls = this.save.cur;
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
    for (const id in this.models) { this.models[id].build(0); this.models[id].setElement(RUNES[CLASSES[id].starter].color); this.elementBy[id] = RUNES[CLASSES[id].starter].element; }
    this.placeIdle();
    this.focusCls = null;
    this.ui.closeMenu();
    this.ui.setTitle(this.save);
    this.setState('title');
    this.world.setCamera('shop', true);
    this.ui.show('title');
  }

  // ------------------------------------------------------------ sim events
  screen(x, y, z) { return this.world.toScreen(x, y, z, _p); }
  onEvent(ev) {
    const sim = this.sim, ui = this.ui, sfx = this.sfx, vfx = this.vfx, fast = this.ff >= 4;
    vfx.handle(ev, sim);
    switch (ev.type) {
      case 'spawn':
        this.orcs.spawn(ev.e);
        if (ev.e.type === 'loot') { ui.toast('Loot hauler! Drop it before it runs.'); sfx.lootSpotted(); }
        break;
      case 'cast': sfx.cast(ev.rune); if (!fast) ui.slotFired(ev.slot); break;
      case 'boonOffer': this.slow(0.15, 0.3); ui.showBoons(ev.offer); sfx.tally(); break;
      case 'explode': sfx.explode(ev.kind); break;
      case 'meteor': sfx.meteorFall(); break;
      case 'hit': {
        sfx.hit(ev.element, ev.crit);
        if (fast || (ev.dot && ui.floats.length > 18)) break;
        const p = this.screen(ev.x, 1.4 + ev.r * 1.6, -ev.d);
        if (p) ui.float(p.x, p.y, fmt(Math.max(1, ev.amount)), (ev.crit ? 'crit ' : '') + (ev.dot ? 'dot ' : '') + ev.element);
        break;
      }
      case 'react': {
        sfx.react();
        if (fast) break;
        const p = this.screen(ev.x, 3, -ev.d);
        if (p) ui.reaction(p.x, p.y, ev.name);
        break;
      }
      case 'kill': {
        const e = ev.e, m = sim.lead;
        let dx = e.x - m.x, dz = -(e.d - m.d);
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const tint = ELEMENT_COLOR[ev.element] || ELEMENT_COLOR.phys;
        this.orcs.kill(e, dx, dz, e.def.heavy ? 3 : 7, tint);
        vfx.killBurst(e, ev.element, dx, dz);
        const n = e.type === 'boss' ? 60 : Math.min(e.type === 'loot' || e.def.elite ? 18 : 9, 2 + Math.floor(Math.log10(ev.gold + 1) * 2));
        vfx.spawnCoins(e.x, -e.d, ev.gold, n);
        sfx.kill(e.def.heavy);
        if (this.ff < 16) {
          const p = this.screen(e.x, (ORC_HEIGHT[e.type] || 1.2) * 1.5 + 0.4, -e.d);
          if (p) ui.float(p.x, p.y, '+' + fmt(Math.max(1, ev.gold)), 'gold');
        }
        if (e.def.elite) { this.slow(0.25, 0.5); this.world.flash(0xffe0a0, 0.5); }
        break;
      }
      case 'escape': this.orcs.remove(ev.e); ui.toast('The loot hauler got away.'); break;
      case 'lost': this.orcs.remove(ev.e); break;
      case 'horde': ui.toast('Goblin tide!'); sfx.horde(); break;
      case 'enemyShoot': sfx.throwAxe(); break;
      case 'mageHit': {
        const k = Math.min(1, ev.frac * 5 + 0.2);
        if (ev.amount > 0) { this.world.flash(0xff2010, 0.55 * k); this.world.shake(0.25 + k * 0.4); ui.hpHit(ev.hero); }
        else vfx.shieldHit[ev.hero] = 1;
        sfx.mageHurt(ev.amount <= 0);
        break;
      }
      case 'enemyAttack': sfx.enemySwing(); break;
      case 'shieldBreak': sfx.shieldBreak(); break;
      case 'revive': {
        const cls = this.runParty[ev.hero];
        sfx.revive(); ui.banner(findUpgrade(cls, 'phoenix').name, `The ${CLASSES[cls].name.toLowerCase()} rises again`, '#ffb24a'); this.slow(0.3, 0.6);
        break;
      }
      case 'heroDead': {
        const h = sim.heroes[ev.hero], cls = this.runParty[ev.hero];
        vfx.burst(h.x, 1.5, -h.d, ELEMENT_COLOR[this.elementBy[cls]] || ELEMENT_COLOR.phys, 70, 8, 0.6, 1.1, { up: 0.6, drag: 1.5 });
        if (!ev.last) { ui.banner(`The ${CLASSES[cls].name} has fallen`, 'Fight on', '#ff7a6a'); sfx.death(); this.world.shake(0.7); this.world.flash(0xff2010, 0.6); }
        break;
      }
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
        this.setState('ending');
        this.after(1.5 / Math.min(4, this.ff), () => this.endRun());
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
    sim.party.d = d;
    sim.packIdx = sim.packs.findIndex(p => p.d > d + 8);
    if (sim.packIdx < 0) sim.packIdx = sim.packs.length;
    this.world.camSnap = true;
  }
  /** Brief slow motion for big moments. Skipped while fast-forwarding. */
  slow(scale, sec) { if (this.ff > 1) return; this.timeScale = scale; this.timeTarget = scale; this.slowT = sec; }

  // ------------------------------------------------------------ per-frame
  syncActors(dt) {
    const sim = this.sim;
    if (!sim) return;
    const sprint = sim.party.alive && !sim.over ? sim.party.speedFrac : 0;
    for (const h of sim.heroes) {
      const model = this.models[this.runParty[h.idx]];
      if (h.alive) model.root.position.set(h.x, 0, -h.d);      // the fallen stay where they fell
      model.update(dt, { moving: h.alive && sprint > 0.15, speed: sprint, casting: h.castT > 0.1, hurt: h.hurtT > 0, dead: !h.alive });
    }
    for (const e of sim.enemies) {
      const v = this.orcs.get(e.id) || this.orcs.spawn(e);
      v.update(dt, e, sim.heroes[e.tgt ?? 0] || sim.party, this.t);
    }
    this.sprint = sprint;
  }
  pickElite() {
    let best = null;
    for (const e of this.sim.enemies) {
      if (!e.def.elite || e.d - this.sim.party.d > 36) continue;
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
    if (this.state === 'run' && this.ff === 1) this.world.watchPerformance(raw * 1000);

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= rdt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.slowT > 0) { this.slowT -= rdt; if (this.slowT <= 0) this.timeTarget = 1; }
    this.timeScale = damp(this.timeScale, this.timeTarget, 5, rdt);
    const running = this.state === 'run';
    const dt = rdt * this.timeScale * this.speed * (running ? this.ff : 1);
    this.t += dt;

    const sim = this.sim, world = this.world;
    let depth = 0;
    const heroes = [];                             // what the effects layer needs to know about each hero
    if (sim && (running || this.state === 'ending' || this.state === 'results')) {
      if (this.state !== 'results') {
        const steps = Math.max(1, Math.ceil(dt / (1 / 40)));
        for (let i = 0; i < steps; i++) {
          sim.step(dt / steps);
          const evs = sim.drainEvents();
          for (const ev of evs) this.onEvent(ev);
        }
      }
      this.syncActors(dt);
      const P = sim.party, lead = sim.lead;
      depth = P.d;
      world.speedK = damp(world.speedK, Math.min(1, this.sprint), 4, rdt);
      for (const h of sim.heroes) {
        const cls = this.runParty[h.idx], model = this.models[cls];
        heroes.push({
          pos: model.root.position,
          shieldFrac: h.alive && h.maxShield > 0 ? h.shield / h.maxShield : 0,
          wisps: h.alive ? h.stats.wisps : 0,
          element: h.alive ? this.elementBy[cls] : null,
          tier: model.tier, speed: h.alive ? this.sprint : 0,
        });
        model.getStaffTip(this.vfx.tips[h.idx]);
      }
      this.focus.set(P.x, 0, -P.d);
      this.vfx.magePos.set(lead.x, 0, -lead.d);
      if (running) {
        const elite = this.pickElite();
        this.ui.updateRun(sim, elite);
        world.setCamera(elite && elite.type === 'boss' ? 'boss' : 'run');
        const b = biomeAt(P.d);
        if (b !== this.biome) {
          const firstZone = this.biome === null;
          this.biome = b;
          this.ui.banner(b.name, firstZone ? 'Slay everything' : `${Math.floor(P.d)} m deep`, '#' + b.accent.toString(16).padStart(6, '0'));
          if (!firstZone) this.sfx.zone();
        }
        // new ground: fast-forward lets go so the player can watch the fight that matters
        if (!this.recordHit && this.recordAtStart > 1 && P.d > this.recordAtStart) {
          this.recordHit = true;
          this.sfx.tally();
          if (this.ff > 1) { this.setFF(1, true); this.ui.toast('New record! Back to 1×.'); }
          else this.ui.toast('New record!');
        }
        this.sfx.setBeat(true, Math.min(1, sim.enemies.length / 18));
        if (lead.alive && lead.hp < lead.maxHp * 0.3) { world.grade.uniforms.uFlash.value.set(0xff1808); world.flashAmt = Math.max(world.flashAmt, 0.3 + Math.sin(this.t * 7) * 0.1); }
      }
      this.fill.intensity = 0;
    } else {
      // out of a run: the party idles at the cave mouth
      const party = this.party();
      party.forEach((cls, i) => {
        const model = this.models[cls];
        model.update(rdt, { moving: false, casting: false, hurt: false, dead: false });
        heroes.push({ pos: model.root.position, shieldFrac: 0, wisps: computeStats(this.save, cls).wisps, element: this.elementBy[cls], tier: model.tier, speed: 0 });
        model.getStaffTip(this.vfx.tips[i]);
      });
      world.speedK = 0; this.sprint = 0;
      if (this.focusCls && this.save.cls[this.focusCls].unlocked) this.focus.copy(this.models[this.focusCls].root.position);
      else this.focus.set(0, 0, 0);
      this.vfx.magePos.copy(this.focus);
      // a soft fill so the heroes read against the moonlit entrance
      this.fill.position.copy(world.camera.position).add(_v.set(0, 1.5, 0));
      this.fill.intensity = damp(this.fill.intensity, 42, 4, rdt);
    }
    if (this.state === 'results') this.ui.updateResults(rdt);

    this.orcs.updateDying(dt);
    this.orcs.realShadows = world.quality === 2;
    this.orcs.updateBlobs();
    world.update(rdt, this.focus, depth);
    this.vfx.update(dt, { sim: sim && this.state !== 'shop' ? sim : null, depth, heroes });
    world.grade.uniforms.uDesat.value = damp(world.grade.uniforms.uDesat.value, sim && !sim.party.alive ? 0.75 : 0, 3, rdt);
    world.render();
    this.rune.update(rdt);
  }
}

window.__game = new Game();
