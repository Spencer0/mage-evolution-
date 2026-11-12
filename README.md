# Mage Evolution

Draw a rune with your finger or mouse. The shape picks the element, the quality of the
stroke sets its power, and the speed of the stroke sets how fast you cast. Then your mage
sprints into the cave on their own, blasting goblins and orcs apart until the horde drags
them down. Kills pay gold, gold buys upgrades, and every few upgrades the mage visibly
evolves. The first run lasts about seven seconds and twenty kills. The run that kills the
Warlord at 1,200 m lasts about three minutes and over a thousand.

Built with three.js. No build step, no assets: every model, effect and sound is generated
in code.

## Play

```bash
npm start          # serves the folder at http://localhost:5173
```

Any static host works: the game is `index.html`, `style.css`, `src/` and a vendored copy
of three.js in `vendor/`. It only needs to be served over http(s) because it uses ES modules.

### GitHub Pages

`.github/workflows/pages.yml` publishes the game every time `main` changes. It needs one
setting, once: repository **Settings -> Pages -> Source: GitHub Actions**. The site then
lives at `https://<owner>.github.io/<repo>/`.

## How it plays

**The party.** You start with the Mage. Three more heroes can be recruited on the party
screen (it appears before a run once you have two runs behind you), and everyone recruited
fights in every run. Gold is shared.

| Hero | Cost | Role | Runes (shape) |
| --- | --- | --- | --- |
| Mage | free | Ranged blaster | Ember (peak), Storm (zigzag), Frost (hourglass), Arcane (circle), Void (star) |
| Warrior | 500 | Takes point and soaks blows | Cleave (V), Hurl (arrowhead), Quake (M), Whirl (spiral), Judgement (crown) |
| Gnome | 3,000 | Sniper and engineer | Longshot (L), Drone (U), Bomb (Z), Orbital (square) |
| Nurse | 15,000 | Healer and poisoner | Mend (C), Toxin (tick), Adrenaline (peak), Defib (heartbeat line) |

**Drawing.** Each hero draws their own runes before a run. A clean stroke hits harder
(x0.6 to x1.5) and a quick one acts faster (up to +25%). "Same as last run" reuses a hero's
previous runes at their previous grades.

**Upgrades.** Each hero has exactly two things to buy: Damage and Defense.

**Talents.** A hero earns a talent point on their 1st upgrade, then the 3rd, 6th, 10th and
so on. Each hero has a three-branch tree: one branch teaches new runes and extra rune
slots, the other two change how the hero plays (spells that jump to a second target, wisps,
meteors, a taunting war cry, trampling goblins, a guardian angel for the party...).
Talents can be reset for free.

**Gear.** Champions guard every 200 m. Each one slain offers two pieces of gear; the one
you take is worn by one hero, visibly, until the run ends.

**Also**

- **It is a sprint, not a stand-off.** The party never stops for fodder. Goblins die in one
  hit; each one that latches on slows the sprint a little. Only brutes, champions and the
  boss are walls.
- **Reactions.** Mixing damage types sets things off: fire on a chilled orc doubles, lightning
  on a burning orc explodes, frost on a shocked orc freezes it.
- **Fast-forward** (1x / 2x / 4x / 16x) is a button on the run screen. It is remembered
  between runs and drops back to 1x by itself when you pass your record depth.
- The cave has five zones, five champions and a boss.

## Code map

| File | What it is |
| --- | --- |
| `src/data.js` | Classes, runes, talents, gear, enemies, evolutions and every balance number. |
| `src/sim.js` | The whole run as a headless simulation that emits events. |
| `src/recognizer.js` | The one-stroke rune recogniser. |
| `src/world.js` | Renderer, bloom and grading, camera rig, procedural cave. |
| `src/actors.js` | The four heroes (six tiers each), wearable gear and the orcs, built from primitives. |
| `src/vfx.js` | Particles, projectiles, lightning, coins, debris, explosions. |
| `src/audio.js` | All sound, synthesised with WebAudio. |
| `src/ui.js`, `src/runeInput.js`, `src/main.js` | HUD and shop, the rune circle, game flow. |

## Balancing

Because the simulation has no rendering in it, a bot can play the real game in a few
seconds:

```bash
npm run balance            # a bot drawing B/A-grade runes
node tools/balance.mjs 1                 # a bot that draws perfect runes
node tools/balance.mjs 0.45 3 --verbose  # quality, seed
node tools/balance.mjs 0.8 1 --solo      # never recruit anyone
node tools/balance.mjs 0.8 1 --gold=250  # try a balance knob without editing data.js
```

It prints every run's length, depth, kills and income until the Warlord dies. With the
current numbers that takes about 25 runs; the bot recruits the Warrior around run 8, the
Gnome around run 13 and the Nurse around run 19.

## Debugging

- `?q=0`, `?q=1` or `?q=2` in the URL pins the graphics quality (it normally adapts).
- In the console, `__game.speed = 8` fast-forwards a run and `__game.debugJump(500)`
  teleports the current run to a depth.
