# Witch Broom (working title): movement lab

A momentum game about Ao, a young witch who rides her broom like a skateboard through a Mediterranean seaside town. TypeScript + Vite + three.js, fully 3D, built for portrait phones, with a fixed-angle chase camera.

The game's identity, biome plan and roadmap are in [VISION.md](VISION.md). [BRIEF.md](BRIEF.md) remains the reference for controls and movement. The working title is a single constant in `src/meta.ts`.

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
| Heel skim | in the air on ordinary ground, swipe down and keep holding into the landing. The broom goes onto its heel and you slow more the longer you hold. Release or push to end it | hold ↓ into landing |
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

## Endless mode

Open it with `?endless` (add `&seed=N` to choose the seed), the **Endless** button on the start card, **Continue endless** after finishing the course, or the top-bar mode button (cycles Course → Endless → Lab; key C, or E for endless). **New run** picks a new seed. The HUD shows distance and your local best, which is saved in `localStorage`.

- **Phrase library** (`src/course/endless.ts`): 18 authored phrases plus 5 connectors (start, boost, bleed, recovery, climb). Each declares an entry speed range, a likely exit speed, its airtime, its receiving surface (flat, down-slope, climb or broad) and a tier (1–3).
  - Style-air phrases are built from `crestPop` and `rollingHills`, with no gaps: crest pop, rolling hills, valley launch, pop chain, big kicker, double crest, crest flip → pillar, and rail → launch.
  - Compulsory phrases: hop, pot, heel-skim pair, pot → pillar, step-downs, ramp → flip → broad landing, rail gap, compression → wall ride → receiving climb, big jump → pillar, and pot → gap → pillar.
- **Assembly:** phrase *i* uses its own seeded RNG, so a seed always produces the same route, whatever the streaming pace. Difficulty rises with distance (0 at 300 m, 1 at 4.8 km).
  - Tier 2 unlocks at ~0.75 km and tier 3 at ~1.9 km.
  - Runs of compulsory phrases can be 1, then 2, then 3 long.
  - Gaps get a little longer and combos tighter as difficulty rises.
- **Neighbour validation:** connectors are inserted for speed (boost or bleed), for flow (a recovery after a compulsory run) and for height (a climb when the route is far below its start).
  - Every phrase starts and ends flat, so neighbours join seamlessly: the sim transfers the rider from one chain onto the next.
- **Streaming:** content is generated 700 m ahead of the rider. Phrases are recycled once they end 160 m behind and have no active ground, rail or wall contact.
  - Sim state that refers to recycled content (broken obstacles) is pruned.
  - Course meshes are built per chunk in chunk-local coordinates. Obstacle meshes are pooled and materials are shared.
  - Scenery streams in 200 m segments.
- **Floating origin:** the sim uses absolute float64 coordinates, which are exact at any run length. The renderer lays the scene out relative to an origin that is rebased every 1 km (and every 300 m of height), shifting only the objects that persist.
- **Checkpoints:** every phrase is a checkpoint. A retry starts from the last phrase you rode on the ground, at its declared speed. Traces record the seed and start point and replay bit-for-bit on a freshly streamed course.

## Art direction and render quality

Look: a warm, painterly Kiki's-Delivery-Service-style seaside town on a hill, ridden through in the morning light
(setting and plan in [VISION.md](VISION.md)). The town is built from CC0 kit pieces and painted textures, not
procedural boxes; licences are tracked in `art/LICENSES.md`.

- **Town** (`src/render/town/`): premade kit pieces (Quaternius Medieval Village MegaKit, Kenney Fantasy Town and
  Pirate kits, baked into `public/town/kit.bin` by `art/pipeline/bake_town.py`) are placed along both sides of the
  street in 40 m chunks and merged into one mesh per chunk, with a near and a far level of detail. Surfaces use a
  painted texture array (`public/town/detail-array.webp`, built by `art/pipeline/build_detail_array.py`) multiplied by
  per-house palette tints.
- **Backdrop** (`src/render/environment.ts`): a gradient sky dome, a painted sky and sea panorama, a painted far-town
  layer on the hill, a shader sea far below, distant hillside blocks, and cumulus puffs.
- **Course** (`src/render/courseView.ts`): a cobbled street with darker kerbs, terracotta-tiled plazas, wrought-iron
  rails, whitewashed walls with terracotta coping and a blue tile band, terracotta pots and crates or barrels for the
  breakables. Gameplay markers (lip lines, takeoff and receiving posts, required rail and wall tints) keep their contrast.
- **Rider** (`src/render/riderView.ts`, `src/render/heroine/`, `src/render/broom.ts`): Ao is a VRM model (look chosen
  with `?look=witch` or the look button) with a cel-style MToon material, riding a broom whose handle is the deck her
  feet plant on and whose straw tail trails sparkles and drags in a heel skim. Until the model loads, a procedural
  low-poly stand-in rides instead.
- **Post** (`src/render/post.ts`): one full-screen pass with a depth-based ink outline, a split-tone grade (lavender
  shadows, warm lights), and on the higher tiers soft bloom and ambient occlusion.
- **Effects**: drifting petals (one instanced mesh) stay outside the route corridor, and a CSS warm vignette grades the
  frame edges.

**Quality levels** (`src/render/quality.ts`). Pick one with `?q=low|medium|high|ultra`, which pins it at full
resolution (no automatic changes); the dev overlay shows the current level. `?fps=1` shows an fps, tier, resolution
and draw-call readout (any `?q=` also turns it on).

| level  | max pixel ratio (floor) | shadow map | town shadows | textures | bloom | AO |
|--------|-------------------------|------------|--------------|----------|-------|----|
| low    | 1 (0.75)                | off        | no           | flat + brush | no | no |
| medium | 1.5 (1)                 | 1024       | no           | painted detail | no | no |
| high   | 2.25 (1.5)              | 2048       | yes          | detail + normal maps | yes | no |
| ultra  | 3 (2)                   | 4096       | yes          | detail + normal maps | yes | yes |

Phones start at high and desktops at ultra. Unless the level is pinned, small frame-rate dips lower the render
resolution first, and a sustained shortfall (under 45 fps for two consecutive 2 s windows) steps the tier down. A
phone that holds the refresh cap at full resolution for about 20 s can be promoted to ultra, but never again once it
has stepped down. `node scripts/perf-probe.mjs [url]` prints draw calls, triangles and frame time.
