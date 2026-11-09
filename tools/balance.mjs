// Headless balance check: a simple bot plays the real simulation, buys the
// cheapest upgrade it can afford, and prints how runs lengthen over time.
//   node tools/balance.mjs [quality=0.8] [seed=1] [class=mage] [--verbose] [--quiet]
import { RunSim, mulberry32 } from '../src/sim.js';
import {
  CLASSES, upgradeCost, computeStats, newSave, runePower, evolutionTier, totalLevels, CAVE_LENGTH,
} from '../src/data.js';

const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const quality = parseFloat(pos[0] ?? '0.8');
const seed = parseInt(pos[1] ?? '1', 10);
const cls = pos[2] ?? 'mage';
const verbose = process.argv.includes('--verbose'), quiet = process.argv.includes('--quiet');
const rng = mulberry32(seed * 7919);
const PREF = { mage: ['void', 'ember', 'storm', 'frost', 'arcane'], warrior: ['crown', 'cleave', 'whirl', 'quake', 'hurl'] };

const save = newSave();
save.cur = cls; save.cls[cls].unlocked = true;
const C = CLASSES[cls], mine = save.cls[cls];
const rows = [];
let playTime = 0;
for (let run = 1; run <= 200; run++) {
  const stats = computeStats(save, cls);
  const q = Math.max(0, Math.min(1, quality + (rng() - 0.5) * 0.2));
  const have = PREF[cls].filter(r => stats.runes.includes(r));
  const slots = [];
  for (let i = 0; i < stats.slots; i++) slots.push({ rune: have[i % have.length], power: runePower(q, stats.mastery), haste: 0.1 });
  const sim = new RunSim({ stats, slots, seed: seed * 1000 + run });
  let guard = 0, peak = 0;
  while (!sim.over && guard++ < 60 * 60 * 12) {
    sim.step(1 / 60);
    if (sim.offer) sim.chooseBoon((rng() * 2) | 0);
    sim.events.length = 0;
    if (sim.enemies.length > peak) peak = sim.enemies.length;
  }
  const sum = sim.summary(mine.bestDepth);
  save.gold += sum.total; save.totalGold += sum.total; save.runs++; mine.runs++;
  mine.bestDepth = Math.max(mine.bestDepth, sum.depth);
  playTime += sum.time + 14;                       // drawing, results and shopping overhead
  const bought = [];
  for (;;) {
    let best = null;
    for (const u of C.upgrades) {
      const l = mine.upgrades[u.id] || 0;
      if (l >= u.max) continue;
      const c = upgradeCost(u, l);
      if (c <= save.gold && (!best || c < best.c)) best = { u, c };
    }
    if (!best) break;
    save.gold -= best.c;
    mine.upgrades[best.u.id] = (mine.upgrades[best.u.id] || 0) + 1;
    bought.push(best.u.id);
  }
  rows.push({ run, t: sum.time, depth: sum.depth, kills: sum.kills, gold: sum.total, win: sum.victory });
  if (!quiet) console.log(
    `#${String(run).padStart(3)}  ${sum.time.toFixed(1).padStart(6)}s  depth ${sum.depth.toFixed(0).padStart(4)}m  ` +
    `kills ${String(sum.kills).padStart(4)}  +${String(sum.total).padStart(9)}g  lv ${String(totalLevels(save, cls)).padStart(3)} ` +
    `${C.evolutions[evolutionTier(save, cls)].name.padEnd(10)} boons ${sum.boons.length} peak ${peak} ${sum.victory ? 'VICTORY' : ''}` +
    (verbose ? '  ' + bought.join(',') : ''));
  if (sum.victory) break;
}
const last = rows[rows.length - 1];
const pick = [0, 2, 4, 7, 11, 15, 19].filter(i => i < rows.length - 1).map(i => `#${i + 1}:${rows[i].t.toFixed(0)}s/${rows[i].depth.toFixed(0)}m`).join(' ');
console.log(`${cls} q${quality} seed ${seed}: ${rows.length} runs, first ${rows[0].t.toFixed(1)}s/${rows[0].kills} kills/${rows[0].gold}g, ` +
  `final ${last.t.toFixed(0)}s ${last.win ? '(victory)' : '(no victory)'}, ~${(playTime / 60).toFixed(0)} min, ` +
  `levels ${totalLevels(save, cls)}/${C.upgrades.reduce((a, u) => a + u.max, 0)}, cave ${CAVE_LENGTH}m | ${pick}`);
