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

| Rune | Shape | Spell | Why you would pick it |
| --- | --- | --- | --- |
| Ember | triangle | Fireball | Splash damage and burning. The starter. |
| Storm | zigzag | Chain Lightning | Fast, chains through packs, shocked orcs take +20% damage. |
| Frost | hourglass | Ice Lance | Pierces a line and slows everything it touches. |
| Arcane | circle | Seeker Missiles | Marked orcs drop +60% gold. The farming rune. |
| Void | five-point star | Singularity | Drags a pack together and crushes it. Hardest to draw. |

- **It is a sprint, not a stand-off.** The mage never stops for fodder. Goblins die in one
  hit and come in tides; each one that latches on slows the sprint a little. Axe throwers
  backpedal ahead and hurl axes. Only brutes, champions and the boss are walls that have
  to be killed before the mage can move on.
- **Precision is power.** A sloppy rune casts at ×0.6, a flawless one at ×1.5 or more.
- **Tempo is haste.** A quick stroke adds up to +25% cast speed. Fast and clean is the skill.
- **Extra Sigils** let you draw two, then three runes per run. Mixing elements sets off
  reactions: fire on a chilled orc is a *Thermal Shock* (double damage), lightning on a
  burning orc is an *Overload* (explosion), frost on a shocked orc is a *Deep Freeze*.
- **Combos** raise gold per kill, so killing quickly pays better than killing slowly.
- Frost has a second use: chilled orcs cannot keep up, so the mage shakes them off.
- Perks include orbiting wisps, a recharging mana barrier, meteor strikes, corpse
  explosions, spell echoes and a phoenix revive.
- The cave has five zones, three champions and a boss. The mage has six evolutions.

## Code map

| File | What it is |
| --- | --- |
| `src/data.js` | Runes, enemies, upgrades, evolutions and every balance number. |
| `src/sim.js` | The whole run as a headless simulation that emits events. |
| `src/recognizer.js` | The one-stroke rune recogniser. |
| `src/world.js` | Renderer, bloom and grading, camera rig, procedural cave. |
| `src/actors.js` | The mage (six tiers) and the orcs, built from primitives. |
| `src/vfx.js` | Particles, projectiles, lightning, coins, debris, explosions. |
| `src/audio.js` | All sound, synthesised with WebAudio. |
| `src/ui.js`, `src/runeInput.js`, `src/main.js` | HUD and shop, the rune circle, game flow. |

## Balancing

Because the simulation has no rendering in it, a bot can play the real game in a few
seconds:

```bash
npm run balance            # a bot drawing B/A-grade runes
node tools/balance.mjs 1   # a bot that draws perfect runes
node tools/balance.mjs 0.45 3 --verbose
```

It prints every run's length, depth, kills and income until the Warlord dies. With the
current numbers that takes 20 to 28 runs depending on how well the runes are drawn.

## Debugging

- `?q=0`, `?q=1` or `?q=2` in the URL pins the graphics quality (it normally adapts).
- In the console, `__game.speed = 8` fast-forwards a run and `__game.debugJump(500)`
  teleports the current run to a depth.
