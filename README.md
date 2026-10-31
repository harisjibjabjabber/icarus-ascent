# Icarus's Ascent: movement lab (milestone 1)

TypeScript + Vite + three.js. Fully 3D, built for portrait phones. Placeholder art only.

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
