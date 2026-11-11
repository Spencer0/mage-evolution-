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

Any static host works (GitHub Pages included): the game is `index.html`, `style.css`,
`src/` and a vendored copy of three.js in `vendor/`. It only needs to be served over
http(s) because it uses ES modules.

## How it plays

**Mage** (the starting hero)

| Rune | Shape | Spell | Why you would pick it |
| --- | --- | --- | --- |
| Ember | a peak (upside-down V) | Fireball | Splash damage and burning. The starter. |
| Storm | zigzag | Chain Lightning | Fast, chains through packs, shocked orcs take +20% damage. |
| Frost | hourglass | Ice Lance | Pierces a line and slows everything it touches. |
| Arcane | circle | Seeker Missiles | Marked orcs drop +60% gold. The farming rune. |
| Void | five-point star | Singularity | Drags a pack together and crushes it. Hardest to draw. |

**Warrior** (recruit for 50,000 gold on the party screen, which appears before each run once
you have two runs; after that he fights alongside the mage in every run)

| War mark | Shape | Attack | Why you would pick it |
| --- | --- | --- | --- |
| Cleave | V | Sword arcs | Hits everything in front and leaves it bleeding. The starter. |
| Hurl | arrowhead pointing right | Thrown axes | His ranged option; punches through a line. |
| Quake | double peak (M) | Ground slam | Dazes and briefly stuns everything around him. |
| Whirl | spiral | Whirlwind | Constant damage all round, and it heals. |
| Judgement | crown | Sky blade | A spectral greatsword on the thickest pack. Hardest to draw. |

Each hero has their own shop, talents, runes and six evolutions. Gold is shared. In a party
the warrior takes point and soaks most of the blows while the mage casts from behind; each
hero draws their own runes before the run, and the run ends when everyone is down.

- **It is a sprint, not a stand-off.** The mage never stops for fodder. Goblins die in one
  hit and come in tides; each one that latches on slows the sprint a little. Axe throwers
  backpedal ahead and hurl axes. Only brutes, champions and the boss are walls that have
  to be killed before the mage can move on.
- **Precision is power.** A sloppy rune casts at ×0.6, a flawless one at ×1.5 or more.
- **Tempo is haste.** A quick stroke adds up to +25% cast speed. Fast and clean is the skill.
- **Extra Sigils** let you draw two, then three runes per run. Mixing elements sets off
  reactions: fire on a chilled orc is a *Thermal Shock* (double damage), lightning on a
  burning orc is an *Overload* (explosion), frost on a shocked orc is a *Deep Freeze*.
- **Fast-forward** (1× / 2× / 4× / 16×) is a button on the run screen. It is remembered
  between runs and drops back to 1× by itself the moment you pass your record depth.
- **Champions** guard every 200 m. Each one slain stops the run for a moment and offers two
  boons; the one you take lasts until the run ends.
- Frost has a second use: chilled orcs cannot keep up, so the mage shakes them off.
- Perks include orbiting wisps, a recharging mana barrier, meteor strikes, corpse
  explosions, spell echoes and a phoenix revive.
- The cave has five zones, five champions and a boss.

## Code map

| File | What it is |
| --- | --- |
| `src/data.js` | Classes, runes, enemies, upgrades, boons, evolutions and every balance number. |
| `src/sim.js` | The whole run as a headless simulation that emits events. |
| `src/recognizer.js` | The one-stroke rune recogniser. |
| `src/world.js` | Renderer, bloom and grading, camera rig, procedural cave. |
| `src/actors.js` | The mage and warrior (six tiers each) and the orcs, built from primitives. |
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
node tools/balance.mjs 0.8 1 --solo      # never recruit the warrior
```

It prints every run's length, depth, kills and income until the Warlord dies. With the
current numbers that takes about 22 runs; the bot recruits the warrior around run 18.

## Debugging

- `?q=0`, `?q=1` or `?q=2` in the URL pins the graphics quality (it normally adapts).
- In the console, `__game.speed = 8` fast-forwards a run and `__game.debugJump(500)`
  teleports the current run to a depth.
