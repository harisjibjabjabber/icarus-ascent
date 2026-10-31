# Ao — in-game heroine (branch `art/heroine-ao`)

Model: **Ao** by 白い白米 (siroihakumai), VRoid Hub. Licence and evidence: `art/LICENSES.md`.

## Looks
| Look | File | Source size | Shipped size | Tris | Materials |
|---|---|---|---|---|---|
| Long hair (default) | `public/heroine/ao-longhair.vrm` | 24.7 MB | 1.9 MB | 33,461 | 10 |
| Witch (`?look=witch`, HUD outfit button) | `public/heroine/ao-witch.vrm` | 24.9 MB | 1.8 MB | 34,850 | 9 |

The second look is only fetched when it is chosen (lazy `import()` + load). Rebuild: `art/heroine/pipeline/build.sh`
(source VRMs are not committed: download them from the VRoid Hub pages in LICENSES.md).

## Runtime (`src/render/heroine/`)
- `heroine.ts`: `Heroine` character API. `attach()`, `event(SimEvent)`, `update(dt, frame)`, `reset()`, `setTier()`.
  Presentation only: it reads sim state and events and never writes back (gameplay, physics, controls, tuning and camera unchanged).
- `clips.ts`: 29 keyframed clips on the VRM normalized rig (PCHIP-baked at 30 Hz). `kit.ts`: bake + two-bone IK.
- `looks.ts`: look selection (`?look=`, localStorage `icarus.look`).
- Layers: state crossfades, additive flinch, procedural squash/lean/roll/breathing, head look-at, foot IK to the deck, hand IK for grabs.
  Spring bones for hair, skirt, cape and hat with leg/hip colliders; VRM expressions per trick with auto-blink.
- Quality tiers: low = no outlines, no shadows, springs at 30 Hz, no head look or hand IK.

## Review
`scripts/heroine-review.mjs <idle|push|run|crash|gallery|perf> <look> <outDir>` (headless Chrome, deterministic),
`scripts/heroine-cut.py <look>` → `review/ao/clips/`, `scripts/contact-sheet.py`. Sheets in `review/ao/sheets/`.

## Performance (headless Chrome, SwiftShader software GL, lab run with autopilot, 240 frames)
| Tier | Character CPU avg / p95 | Character draw calls | Character tris (incl. outline + shadow passes) |
|---|---|---|---|
| high / medium (long hair) | 0.96 / 1.4 ms | 26 | 127k |
| low (long hair) | 0.32 / 0.5 ms | 10 | 33k |
| high (witch) | 0.92 / 1.3 ms | 24 | 133k |
| low (witch) | 0.34 / 0.6 ms | 9 | 35k |
