# Icarus's Ascent: movement lab (milestone 1)

TypeScript + Vite + three.js. Fully 3D, built for portrait phones, with a fixed-angle chase camera. Placeholder art only.

```
npm install
npm run dev        # dev server (also on the LAN)
npm test           # vitest: movement invariants, gesture sequences, replay determinism
npm run build      # -> dist/
scripts/serve-public.sh   # static server on :8080 + Cloudflare quick tunnel (see notes)
node scripts/screenshot.mjs http://localhost:8080/?seed=12345   # headless 390x844 screenshots
node scripts/screenshot-tricks.mjs   # deterministic grind / wall / flip shots via the dev autopilot (icarus.pause/autopilot/advance)
```

## Modes
- **Opening course** (default): the authored teaching course (`src/course/opening.ts`). It has ten lessons in the order brief §10 lists them, each with one calm prompt and a checkpoint. A fail retries from the furthest lesson reached; "Restart" goes back to the top. At the finish you get "Ride again" or "Go to the lab".
- **Lab**: `?lab` (with `&seed=N`), the "Lab" button, or the C key. This is the seeded movement lab.

## Stale-build guard
Each build writes `version.json` (short commit + build time) and bakes the same value into the bundle. The page fetches `version.json` with cache-busting on load, when the tab becomes visible again, and every 60 s. It reloads only when the player isn't mid-run (start, fail or finish screen). If a newer build turns up mid-run, it waits for the next safe moment. The build version is shown small in the bottom-right corner and in the dev overlay.

## Controls
| Action | Touch | Keyboard |
|---|---|---|
| Push | downward stroke (a longer stroke gives a stronger push, up to 0.22 of the screen's short side) | ↓ / S (fresh presses only) |
| Jump | upward stroke, or reverse a push upward without lifting your finger | ↑ / W / Space |
| Backflip | a second, fresh upward stroke while airborne (one long stroke is only a jump). It must finish before landing | ↑ again in the air |
| Grind | in the air, swipe down near a rail's catch area. The catch window is generous. Jump to leave the rail, or ride it to the end | ↓ in the air |
| Wall ride | in the air, swipe right and hold beside a right-hand wall (needs about 7 m/s or more). Release or jump to leave | hold → |
| Grab | in the air away from a wall, swipe left/right and hold. Release before landing or you fail | hold ← / → |
| Heel skim | in the air on ordinary ground, swipe down and keep holding into the landing. The board goes onto its heel and you slow more the longer you hold. Release or push to end it | hold ↓ into landing |
| Pots | low obstacles: jump over them, or break them with your heel (hold down into the landing, or skim into them). Rolling into one or clipping it fails | |
| Pillars | tall obstacles: smash through while doing a trick at the moment of contact, either mid-flip or having grabbed on that jump (held or already released, any duration), or heel-skimming on the ground. Normal landing rules still apply afterwards: let go of the grab and finish the flip before touchdown. A trick completed just before also counts for 26 m (lenient extra). Rolling or plain-jumping into one fails. The hitbox is forgiving: with a trick it triggers 0.8 m early, and a plain hit needs a solid overlap | |
| Sound | "Sound" button (mute persists) | M |
| Retry (same seed) | tap or swipe after a fail | R, Enter, ↑ |
| New run (new seed) | "New run" button | N |
| Dev overlay | "Dev" button | ` or O (`?dev` in URL) |
| Replay last run | | L |

`?seed=N` in the URL pins the course. In the console, `icarus.trace()`, `icarus.lastTrace()` and `icarus.replay(trace)` give access to input traces.

## Architecture
- `src/tuning.ts`: the only tuning resource (gesture thresholds, movement, camera, feedback).
- `src/input/`: `gesture.ts` is a pure recogniser with 5 stages (dead zone, direction with hysteresis, fire, hold, release or reversal). `mapper.ts` maps gestures and keys to shared `Action`s, and `dom.ts` binds them to the DOM.
- `src/sim/`: deterministic fixed-step (120 Hz) simulation with an explicit `MoveMode` state machine, swept contact, coyote time and jump buffer.: modes `grounded`, `heelSkim`, `airborne` (sub-state none/flip/grab), `grinding`, `wallRiding`, `failed`, `finished`. The sim resolves context from actual proximity (rail catch band, wall span/height/speed).
- `src/course/`: course data (ground chains, gaps, rails, walls, markers) and the seeded lab layout.
- `src/render/`: presentation only. Camera rig, toon materials, environment (sky dome, fog, sun with shadows, distant scenery), course, rider and effects.
- `src/diag/`: input recorder, deterministic replay and the dev overlay.

## Camera
The camera is a fixed-angle chase view: 12 m behind and 6 m above the rider, pitched 12° down, FOV 52°. It pulls back slightly with speed and lifts up to 2.5 m to see over upcoming ramp lips and crests. It only ever translates.
- Search: `node scripts/camera-search-chase.mjs`
- Visibility check: `node scripts/camera-visibility.mjs '[[12,6,12,52]]'`

On a 390x844 screen the rider is about 108 px tall with feet at about 77% of screen height. A 7 m gap stays at least 10 px tall out to about 44 m ahead, which is 2.0 s at the hard cap.

## GitHub Pages
`.github/workflows/deploy.yml` tests, builds with `BASE_PATH=/<repo>/` and deploys to Pages on every push to `main`. In the repo settings, set Pages to "GitHub Actions". For a local build with a base path, run `BASE_PATH=/my-repo/ npm run build` (the default `./` is relative).

## Crests, kickers and downhill momentum

- **Crest separation:** at each ground-polyline vertex the sim compares the rider's centripetal need with gravity. If the surface turns down by more than `crestMinTurn`, the rider is above `crestMinSpeed`, and `v²·κ > airGravity·cosθ·crestStick` (κ = turn ÷ local segment length), the rider leaves the ground ballistically (`leftBy: 'crest'`). No gap is needed. Swiping up within the coyote window right after a crest launch "pops" it for extra height. A second swipe flips.
- **Slope gravity is asymmetric:** descents pull harder (`slopeGravityDown` 15.5) than climbs cost (`slopeGravityUp` 10). Over-soft-cap drag is scaled down (`descentOverCapScale` 0.3) on descents, so big descents can exceed the soft cap. The hard cap (27.5 m/s) still holds.
- **Shape helpers** for courses and endless phrases (`src/course/shapes.ts`): `crestPop(pts, rise, len, drop, backLen)` builds a kicker on continuous ground followed by a down-slope landing. `rollingHills(pts, count, amp, period)` builds a pop chain at amp ≈1.4 / period 18 (fast riders pop from ~19 m/s) and stays grounded at gentle settings (amp 0.4 / period 30 never pops, even at the hard cap).
- The opening course's Descent lesson ends in a crest pop.
