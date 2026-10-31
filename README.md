# Icarus's Ascent: movement lab (milestone 1)

TypeScript + Vite + three.js. Fully 3D, built for portrait phones, with a fixed-angle chase camera. Placeholder art only.

```
npm install
npm run dev        # dev server (also on the LAN)
npm test           # vitest: movement invariants, gesture sequences, replay determinism
npm run build      # -> dist/
scripts/serve-public.sh   # static server on :8080 + Cloudflare quick tunnel (see notes)
node scripts/screenshot.mjs http://localhost:8080/?seed=12345   # headless 390x844 screenshots
```

## Controls
| Action | Touch | Keyboard |
|---|---|---|
| Push | downward stroke (a longer stroke gives a stronger push, up to 0.22 of the screen's short side) | ↓ / S (fresh presses only) |
| Jump | upward stroke, or reverse a push upward without lifting your finger | ↑ / W / Space |
| Retry (same seed) | tap or swipe after a fail | R, Enter, ↑ |
| New run (new seed) | "New run" button | N |
| Dev overlay | "Dev" button | ` or O (`?dev` in URL) |
| Replay last run | | L |

`?seed=N` in the URL pins the course. In the console, `icarus.trace()`, `icarus.lastTrace()` and `icarus.replay(trace)` give access to input traces.

## Architecture
- `src/tuning.ts`: the only tuning resource (gesture thresholds, movement, camera, feedback).
- `src/input/`: `gesture.ts` is a pure recogniser with 5 stages (dead zone, direction with hysteresis, fire, hold, release or reversal). `mapper.ts` maps gestures and keys to shared `Action`s, and `dom.ts` binds them to the DOM.
- `src/sim/`: deterministic fixed-step (120 Hz) simulation with an explicit `MoveMode` state machine, swept contact, coyote time and jump buffer. M2 hooks are marked (`grinding`, `wallRiding`, airborne down/side/up).
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
