# SKY-LAYER: ground tufts, the upper layer, along-street lines and real balloons

Base: main @ d29620b. Owner: Gamebot (tech lead). Status: ready to build.
Units: metres, seconds, m/s. **G** is the x where the tuft grate starts. **yS** is the street height at G. All heights below are above yS unless marked otherwise.

## 0. Why (what the code does today)
- The sim is 2D: x runs along the route and y is height. "Lateral" is used for presentation only.
- **Washing line.** The `wash-line` grind spline runs *along* the route at lip+2.05 m. Its laundry is drawn on separate cross-street spans at street+4.5–5.6 m (`hangSpans`, `courseView.ts:787`). The thing you see is not the thing you grind, so Haris reads the line as horizontal, ungrindable and too high.
- **Bounce phrase.** It puts 4 "balloon" pads at street+1.05 m and lateral 2.25 (`endless.ts:509`). In the harbour they become boats.
- **Updraft.** A chimney column at lateral 3.6 needs a deliberate jump in. It only gains 1.5 m, then gives a 2.35 s steered flight. It is not a ground tuft and it reaches no upper level.
- **Cross-street props.** Laundry (`town.ts` laundry at g+5.7) and the bunting (street+5.7) cross the street right where an upper layer would fly.

## 1. Player-facing design
**Loop:** you see a tuft, it lifts you, you grind lines along the street, hop between them, ride a balloon ladder, grind a top line, then glide down a descending line back to the street.

1. **Tuft (telegraph).**
   - A cast-iron drain grate (3.0 × 1.2 m) sits in the cobbles at lateral 0.
   - A swirling column rises from it, leaning 45° forward along the route (it follows the lift path). It is 2.2 m wide at the base, 4 m at the top and 8 m tall. Leaves, petals and dust rise through it.
   - It must be readable 60 m out: that is 4.3 s at 14 m/s and 3.0 s at 20 m/s.
   - 3 gold stars lead up the column as a lure.
   - The 45 m before G is flat and empty (no features).
2. **Lift.**
   - Any rider whose feet are ≤ 2.5 m above the grate while over G..G+3 is caught. Grounded riders count, and so does a normal jump (a flat-jump apex is 1.41 m).
   - Mode `gusting` runs for 0.75 s on a fixed path from the entry point to the exit point (G+9, 7.0). x moves linearly and y uses easeOutQuad. Ao's pose is broom nose-up 20° with her hair and skirt fluttering.
   - At the exit: vx = 12, vy = +4, mode becomes airborne and `layer = 'sky'`.
   - During the gust, Up is rejected ("riding the gust"). Down arms the catch, and that carries into the airborne phase.
3. **Up there (existing gestures only; no new gesture, per VISION).**
   - **Lines run ALONG the street** and alternate lateral +1.1 / −1.1. They hang off iron brackets on the 3rd-floor facades, plus a timber mast where a line ends.
   - Laundry is pegged *under* each line. You grind on top of it.
   - Down catches a line. Up hops off it. Rolling off a line's end gives the existing 2.2 m/s pop.
   - **Balloon ladder:** clusters of 3–7 balloons, each cluster 1.0 m higher than the last. Landing on one (descending) bounces you at the existing `balloonVy` 10.4. A cluster squashes and springs back rather than popping, and triggers once each. Flips and grabs between bounces score.
   - **Star trails:** gold every 2.5 m, 0.9 m above each line and along every hop or bounce arc. The purple goes at the apex of the last bounce.
4. **Way down.** The last line slopes down at about −17% to 3.8 m and ends at a pavement mast. Rolling off lands you on a flat 25 m landing with nothing required.
5. **Falling off.**
   - Over a continuous street you just land; no landing fails at any height.
   - From 1.4 km on, some segments have a telegraphed gap *under line 2 or later* (never under line 1). A street-level rail bridges it at 1.0 m, which gives a last-chance catch and the ground route.
   - Missing line 1 always drops you onto street at least 25 m before any gap.
6. **Speed governor (decision).**
   - While `layer === 'sky'` and the mode is airborne or grinding: `v += (14 − v)·(1 − e^(−dt/0.4))`.
   - This keeps the authored hop and ladder positions exact. The cost is that a 25 m/s rider leaves the segment at 14 m/s.
7. **Camera.** The camera's pitch and yaw never change (existing rule).
   - During the gust and for 0.3 s after, `heightLag` drops from 0.3 to 0.12 s, so Ao stays at 45–80% of screen height while rising 7 m in 0.75 s.
   - In the sky layer: follow height = riderY + 0.8 m extra and `heightLag` 0.45 s, so the ladder doesn't bob the view.
   - `aheadMaxY` includes the sky lines and clusters in the next 34 m, with the existing 1.9 m cap.
   - After landing, `heightLag` returns to 0.3 with no snap.
   - Check from current numbers: camera height 5.25 + 0.8, distance behind 7.5 at rest, FOV 52 + 5. The bottom ray is 44° down, so the street under the rider is visible from about 5 m ahead of Ao. A gap below can be read.

## 2. Fixes to existing pieces
| Piece | Change | Owner |
|---|---|---|
| `wash-line`, town `updraft`, town `bounce` phrases | Remove them from `TOWN.phrases` and `weights`. Remove `wash-line` and `updraft` from harbour too; the harbour keeps `bounce` (boats). The flight code stays for later cliffs. | C |
| `hangSpans` cross-street laundry | Delete it. Laundry only appears under sky lines. | B |
| Low `lineDress`/`highLine` with dress `wash` (wall-line, high-line) | Re-dress as `balcony` / `gutter` / `bunting` (C changes the values; B renders). | C, B |
| Cross-street laundry in `town.ts` | Remove it from the near and far LOD. | B |
| Bunting (approved) | Keep it, except within [segment.x0 − 10, segment.x1 + 10]. | B |
| Balloons | Only on the sky layer (`Bounce.sky`). The harbour's balloon→boat conversion skips `sky` pads. | C |
| Front-row houses in sky zones | Force 3 floors (eave 9.36 m) on both sides from x0 − 10 to x1 + 10. Today they are 2–3 floors, and a 6.24 m eave sits under the 6.4 m lines. Flower boxes on at least 50% of 3rd-floor windows. | B |

**Balloon art bar (Ghibli, no flat placeholders):**
- **Sourcing.** First look for CC0 balloon models (Poly Pizza CC0-only, Kenney, Quaternius, Poly Haven). Accept one only if it has a teardrop latex body, a neck and a knot. Otherwise build it procedurally:
  - `LatheGeometry`, 32 radial × 24 profile.
  - Width 0.55 m, height 0.68 m (ratio 1.24), tapering to a 0.05 m neck.
  - Knot 0.06 m. String: tube r 0.006, 1.4–2.2 m long, converging on one tether knot that is tied to a bracket or balcony rail.
- **Cluster.** 3–7 balloons in a loose phyllotaxis dome, 2.0–2.4 m across (this matches the 1.2 m gameplay half-width).
- **Shading.** MeshToon with 3 bands, lavender shadow #8a7fa0, inverted-hull outline #2a1a14 at 0.012 m.
  - Specular: one sharp highlight (Blinn exponent 60, stepped to 2 bands).
  - Fresnel rim 0.35, and a back-light boost of +15% for latex translucency.
- **Palette.** #c96a42, #3f8f8a, #d9a441, #e8899a, #f7ecd4, #a99ad0, #7fb7d9.
- **Motion.** Bob ±0.05 m at 0.5–0.7 Hz with random phase, sway ±4°. On a hit: squash to y 0.75 / xz 1.12 over 80 ms, then a damped spring back over 250 ms, with a string tug.
- **Licensing.** Log everything in `art/LICENSES.md`. That includes procedural pieces, logged as self-made.

**Tuft VFX bar:**
- **Grate:** a CC0 model, or procedural with an ambientCG CC0 metal texture, plus a warm under-glow.
- **Wind ribbons:** 3 nested spiral ribbon meshes, toon two-tone cream #fff8ee / lavender #b9b3c9 at alpha ≤ 0.55, UV scroll 1.6 m/s, 1 turn per 3 m.
- **Particles:** 60 leaves (#86b05c, #d9a441), petals (#f2b8c6) and motes (#f7ecd4), rising at 6–9 m/s with a 0.6–1.4 m swirl.
- **Ground:** a dust ring every 0.8 s.
- The column must be at least 120 px tall on a 390×844 screen from 42 m away.

**Lines bar:**
- Cotton rope #efe2c8, r 0.022 m, with outline. Sag 0.08 m per 8 m span, and the grind spline includes that sag.
- Brackets use the existing `bracket` piece every 6–8 m.
- Garments come from the existing self-made laundry set. They hang at least 0.05 m below the rope, drop at most 0.9 m, and are spaced 0.9–1.3 m apart.

## 3. Exact data
**Template T1 `sky-intro` (220 m: G−45 to G+175).** All rows use lateral as listed. "L" rows are rails with `sky:true` and are not `wash`.

| Element | x (rel G) | y | Lat | Notes |
|---|---|---|---|---|
| Grate / catch | 0 → 3 | catch ≤ 2.5 | 0 | |
| Gust exit | 9 | 7.0 | 0 | v = (12, +4) |
| L1 | 10 → 34 | 6.4 | +1.1 | Brackets at 10, 18, 26, 34. Catch: Down. |
| L2 (hop up) | 36.5 → 55 | 7.0 | −1.1 | Jump window x ∈ [28.9, 34]: 0.36 s at 14 m/s. Rolling off misses. |
| L3 (step down) | 59 → 79 | 6.2 | +1.1 | Roll off or jump, then Down. A roll-off arrives at +0.20 m. |
| C1 / C2 / C3 | 83 / 91.1 / 99.2 | 5.6 / 6.6 / 7.6 | 0 | half 1.2, rad 0.7; counts 5 / 4 / 6. Roll off L3 to reach C1 (a jump overshoots). |
| L4 | 104 → 118 flat, 118 → 146 down to 3.8 | 8.6 → 3.8 | +1.1 | Catch window after C3: x ∈ [102.9, 108.3]. Mast at 146 (lateral 2.0, 4.4 m tall). |
| Landing | 146 → 175 | street | | Lands at about G+153. Flat, nothing required. |

**Ballistics** (C must compute these with a helper, not copy the numbers):
- Rail-jump vy is 9.2 × 0.9 = 8.28, with g = 30.
- A cluster 1.0 m higher is reached at t = 0.578 s, so it sits 8.09 m further on at 14 m/s.

**Other templates:**
- **T0 `sky-hop` (150 m):** grate; L1 10 → 34 @ 6.4 (+1.1); L2 36.5 → 52 @ 7.0 (−1.1), then sloping 52 → 80 down to 3.6; mast; lands at about G+87; ends at G+105.
- **T2 `sp-sky-gap`:** T1, plus a street gap at G+40 → G+62 (22 m, receiving −0.8). That is more than the 19.0 m maximum jump at 27.5 m/s. A street rail at +1.0 runs G+38 → G+64 (the same builder as `rail-gap`).
- **T3 `sp-sky-gauntlet` (290 m):**
  - T1 up to C3, then C4 at (G+107.3, 8.6).
  - L4 @ 9.6 from G+112 → G+130.
  - Step down to L5 @ 8.4 from G+134 → G+150, sloping down to 3.8 at G+190.
  - Gap G+70 → G+100 with a street rail.
  - In the harbour, anchors are ship masts and crane jibs (the right side is water).

**Placement (endless):**
| Band | Rule |
|---|---|
| 0–300 m | T1 is forced on every seed with G = 110 (chunk 65 → 285). The first death hole stays at ≥ 300. Wave 0's build is full: 2 holes + the 72 m tail ≈ 288 of 382 m, so the warm-up is the only slot under 600 m. |
| 300–1400 | T0 as an `isPlay` filler: x ≥ 450, ≥ 350 m after the previous sky segment ends, ≤ 1 per wave. Weights: town 2.4, harbour 1.8. |
| 1400–2650 | T2 is the forced set piece at the wave 1 peak (≈ 1482). After that it has minWave 1 and weight 1.6. T0 continues. |
| ≥ 2650 (harbour) | T3 has minWave 3, weight 1.4, in town and harbour. |

Target: at least 5 sky segments per 4200 m on each seed, mean spacing 500–800 m.

## 4. Contracts (phase 0: one commit before A, B and C start, composer-safe)
New file `src/course/skyTypes.ts`:
```ts
export type SkyVariant = 'sky-intro' | 'sky-hop' | 'sky-gap' | 'sky-gauntlet';
export interface Tuft { id: number; x0: number; x1: number; yBase: number; catchH: number; exitX: number; exitY: number; lateral: number; source: 'grate' | 'drain'; segmentId: number }
export interface SkyAnchor { x: number; y: number; lateral: number; kind: 'bracket-left' | 'bracket-right' | 'mast' | 'ship-mast' }
export interface SkyLine { railId: number; anchors: SkyAnchor[]; laundry: boolean }
export interface SkyCluster { bounceId: number; count: number; tether: SkyAnchor; seed: number }
export interface SkyHop { x0: number; x1: number; action: 'down' | 'jump' | 'roll'; targetRail?: number; targetBounce?: number }
export interface SkySegment { id: number; variant: SkyVariant; x0: number; gx: number; xLand: number; x1: number; yBase: number; tuftId: number; lines: SkyLine[]; clusters: SkyCluster[]; hops: SkyHop[]; gapBelow: { x0: number; x1: number } | null }
```

Additions to existing files:
- **`course.ts`:**
  - `Rail.sky?: true`
  - `Bounce.sky?: true; rad?: number`
  - `Feature.kind` adds `'tuft'`
  - `Chunk.tufts?: number[]; sky?: number`
  - `RideHook.activity` adds `'sky'`
  - `Course.tufts: Tuft[]`, `Course.sky: SkySegment[]`, `tuft(id)`, `skyAt(x): SkySegment | undefined`
  - `addChunk` registers and recycles them.
- **`sim/types.ts`:**
  - `MoveMode` adds `'gusting'`
  - `RiderState` adds `layer: 'street' | 'sky'; tuftId: number; gustT: number; gustFrom: Vec2`
  - `SimEvent` adds:
    - `{type:'tuft-start'; tuftId; x; y}`
    - `{type:'tuft-end'; tuftId; x; y}`
    - `{type:'sky-exit'; segmentId; reason:'complete'|'fell'; x; y}`
- **`tuning.ts`:**
  ```ts
  sky: {
    gustCatchH: 2.5, gustDuration: 0.75, gustExitDx: 9, gustExitDy: 7.0,
    gustExitVx: 12, gustExitVy: 4,
    lineY: 6.4, speed: 14, speedTau: 0.4,
    clusterHalf: 1.2, clusterRad: 0.7, rungRise: 1.0, landingClear: 25,
    camGustLag: 0.12, camSkyLag: 0.45, camSkyLift: 0.8,
  }
  ```
- **`src/course/skyFixture.ts`:** a `SKY_FIXTURE_INTRO: SkySegment` holding the T1 table at G = 110, yS = 0. A and B test against it before C lands.

## 5. Workstreams (branch off the phase-0 commit; no file is shared)
**A: mechanics and sim** (grok-4.7, high)
- **Owns:** `src/sim/simulation.ts`, `src/diag/autopilot.ts`, `src/render/cameraRig.ts`, the camera-update call in `src/render/view.ts`, `src/score/*`, and new tests `tests/sky-sim.test.ts` and `tests/sky-camera.test.ts`.
- **Mechanics:**
  - Tuft catch and the `gusting` mode.
  - The `layer` flag and the speed governor.
  - Sky lines use the normal rail catch with no `wash` gate.
  - Clusters use `rad`.
  - `sky-exit` is `'complete'` if the landing x ≥ xLand − 10, otherwise `'fell'`.
- **Score:** balloon +1 combo and 50 points; clearing a segment gives a "Sky run!" bonus of 500.
- **Autopilot:**
  - Sky handling is on by default: it arms Down 0.15 s before each `down` hop, jumps at the middle of each `jump` window, and does nothing on `roll`.
  - `sky:false` makes it passive.
  - `skyMistime:'drop-over-gap'` makes it skip the L2 hop and ignore the street rail.
- **Tests:**
  - For entry speeds {8, 12, 20, 27.5}, the gust exits at (gx+9, 7.0) within ±0.01.
  - At governed speeds {13.5, 14, 14.5}, every hop in the fixture catches, and every jump window is ≥ 0.30 s.
  - The passive rider on the fixture never fails.
  - Camera: through the whole fixture, Ao's feet stay at 45–85% of screen height, and the street point at x + 10 stays inside the frustum.
  - `replay.test` stays deterministic.

**B: art** (grok-4.7, high; xhigh for the balloon and tuft shaders if the first pass is "mid")
- **Owns:** new `src/render/sky/{tuftFx,balloons,skyLines}.ts`, `src/render/courseView.ts`, `src/render/town/town.ts`, `src/render/riderView.ts` and `heroine/clips.ts` (gust pose), `art/LICENSES.md`, `art/pipeline/*`, `public/*` assets, and a new `tests/sky-render.test.ts`.
- **Scope:** everything in the §2 art bars, plus the §2 rows owned by B. It renders from `Course.sky`, `tufts`, `rails` and `bounces` only.
- **Tests:**
  - No cross-street laundry is created.
  - No bunting inside sky zones.
  - Front-row houses in sky zones have ≥ 3 floors.
  - Every cluster has `count` balloons and a string.

**C: course layout** (grok-4.7, high)
- **Owns:** a new `src/course/sky.ts` (templates T0–T3 with ballistic helpers), `src/course/skyLab.ts` (`?lab=sky`, a straight street with the fixture), `src/course/endless.ts`, `src/course/opening.ts`, `src/course/orbTrails.ts`, `src/zones/*.ts`, and new `tests/sky-course.test.ts`. It also updates `tests/activities.test.ts`, `death-gaps.test.ts` and the density tests.
- **Deliver `skyLab` first**, within the first hour; B is blocked until it exists.
- **Scope:** the §3 placement, the §2 rows owned by C, and a 'Ride the gust' lesson at the end of the opening course (see conflict 7).
- **Tests:**
  - The first grate is at x = 110 ± 5 on all 5 seeds.
  - ≥ 5 segments per 4200 m.
  - No gap under line 1.
  - ≥ 25 m of continuous street after line 1.
  - 45 m run-in before every grate; 25 m clear after landing.

**Integration fairness** (run by C after rebasing on A; it gates the merge):
- Ideal `{minSpeed:14}` on seeds 1, 7, 13, 21, 42 to 4200 m: 0 fails, and every segment ends `'complete'`.
- Passive `{minSpeed:14, sky:false}`: 0 fails.
- `skyMistime` on the first T2: fails with `fell-in-gap` or `missed-rail` (proves the death is real).
- All 311 existing tests pass, or are updated with a stated reason.

**Required screenshots:**
- 390×844 at DPR 2, default chase camera, named `sky-NN-*.png`, taken with the ideal autopilot unless noted.
- Seed 1, `?endless&seed=1`; distances are relative to the first G (110 m):

| File | When |
|---|---|
| 01-telegraph | G − 42 |
| 02-gust-mid | gust t = 0.35 s |
| 03-line1 | G + 20 |
| 04-hop | mid L1 → L2 hop |
| 05-ladder | at the C2 bounce |
| 06-balloon-close | debug orbit camera 2.5 m from C3 |
| 07-top-line | G + 110 |
| 08-descent | G + 135 |
| 09-landing | G + 155 |
| 10-gap-below | seed 7, first T2, mid L2 |
| 11-street-clean | seed 1 at 600 m: no cross-street laundry |
| 12-harbour | seed 42, first T3 |
| strip | 8 frames, 0.5 s apart, from G − 10 |

- Every frame is taken after the streaming fade-in finishes.

**Definition of done:**
- All tests are green.
- Gamebot has reviewed the screenshots against the §2 bars: balloons unmistakable, laundry under lines that run along the street, the tuft readable at 01.
- The merge order is phase 0 → A → B → C. Each is squashed to main after review.

## 6. Model assignment
- **Phase-0 contract commit:** composer-2.5 is safe. The code is given verbatim in §4, and the fixture is the T1 table.
- **Also composer-safe:** removing the phrases from the zone lists (§2 row 1), deleting `hangSpans` and the cross-street laundry calls, and adding the `LICENSES.md` rows once B supplies the text.
- **Everything else is grok-4.7 high:** A, B, C and the integration. That covers physics, art judgement and generator balancing.
