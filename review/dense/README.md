# Dense course — review (branch `level/dense-course`)

Haris: "the course is too sparse in elements… the gap between pots to grind rails is too much, it takes ages to even see the
harbour with the wall runs… it should be closer together for the challenge."

## What changed
- **Opening course rewritten dense** (`src/course/opening.ts`). It keeps the same 10 lessons, the same physics and the same controls.
  - The first ~10 s (push, descent + crest pop, first jump) stay a gentle tutorial.
  - From the Pot lesson on, the lessons chain with almost no recovery: pot → heel-skim pair → optional rail → rail gap → pot → handrail descent → big jump → pillar → handrail descent → wall-run gap → garden wall → pot → canal wall-run gap → pillar → handrail → pot pair → harbour wall.
  - Each lesson's prompt and checkpoint start right after the previous feature, so every compulsory prompt still gets its ≥2 s.
- **Harbour aligned to the new course**:
  - The course now exports `harbourX`, which is the big jump's landing (x 440, was 880).
  - The view builds the harbour (quay, sea, piers) from there, so both wall-run gaps sit in the harbour.
  - Clock towers are placed relative to the harbour: one over the old town, one at the way down into the harbour.
- **Endless mode** (`src/course/endless.ts`):
  - Optional handrails on the descents of style and ramp phrases.
  - Shorter flat recoveries after the hop, pot and crest-pillar.
  - Style weight is 1.3 (was 1.6). Up to 2 compulsory phrases in a row from difficulty 0.15 (was 0.4).
  - All 200-seed ride tests still pass.
- **Painted cobblestone street** replaces the flat orange checker:
  - The texture is a procedural canvas texture, so it is CC0 by construction.
  - It is greyscale and is tinted by the old palette: grey-ochre streets and warm sandstone plazas.
  - Lip lines, orange/teal gap lamps, gold required rails and turquoise required walls are unchanged.
- **Perf fixes**:
  - Debris now draws as 3 instanced meshes. It was one draw call per shard: 51 calls right after a crate smash, which was the over-budget spike on both main and the branch.
  - Lip lines are merged per chunk.
  - Street, kerbs and sides share one material.
- **Tests**:
  - New opening density test: after the tutorial no empty stretch is longer than 48 m / 3.5 s, there are ≥2.5 elements per 100 m, harbour ≤30 s, first wall run ≤38 s, first gap ≥9 s.
  - New endless density test: ≥1 element per 100 m over 50 seeds, and no gap of 100 m or more including style hills (was 120 m).
  - All the old fairness tests still pass. Wall gaps are crossable by wall run at 12/14/18 m/s, and a plain jump falls short.
  - Result: 225/225 tests pass.

## Density (dev autopilot minSpeed 13, the same rider as the clips) — `density-before.json` / `density-after.json`
Elements counted: gaps, rails (including optional handrails), walls (including optional), pots and pillars.

| Opening | before (main b6aa377) | after |
|---|---|---|
| course length to finish | 1124 m | 806 m |
| time to finish | 69.5 s | 50.0 s |
| **time to harbour** | **53.2 s** (x 880) | **26.4 s** (x 440) |
| time to first wall run | 52.4 s | 34.0 s |
| first gap (end of tutorial) | 12.6 s | 10.0 s |
| elements per 100 m (whole) | 1.51 | 2.86 |
| elements per 100 m (after tutorial) | 1.77 | 3.52 |
| longest empty stretch after tutorial | 106 m / 6.1 s | 45 m / 3.0 s |
| longest empty stretch incl. tutorial | 216 m / 12.6 s (start run-in) | 174 m / 10.0 s (start run-in) |

| Endless (seeds 1, 2, 3, 7, 42; x 300–3000) | before | after |
|---|---|---|
| elements per 100 m (mean) | 0.71 | 1.26 |
| longest empty stretch (no elements) | 299–611 m / 16.8–32.9 s | 147–165 m / 7.6–9.9 s |
| longest empty incl. style hills (crests, rollers) | ≤108 m | ≤94 m |

Regenerate the density files with `DENSITY_OUT=review/dense/density-after.json npx vitest run tests/density-report.test.ts`.

## Perf probe (390×844, chase cam, opening, sampled every 150 ticks) — `perf-before.txt` / `perf-after.txt`
| | max draw calls | avg calls | max tris | avg tris |
|---|---|---|---|---|
| before (main) | 151 | 105 | 330k | 301k |
| after | 122 | 99 | 340k | 297k |

Budget: ≤150 calls and ≤350k tris. The branch is within budget. Main peaked at 151 right after a crate smash (debris).

## Media
- `before-chase.mp4` — main b6aa377, the whole opening (69.5 s).
- `after-chase.mp4` — this branch, the whole opening (≈50 s).
- `before-after-side-by-side.mp4` — both, started together. The right side ends first and holds on the finish.
- `contact-sheet.jpg` — after-branch stills of the combos and the cobble street.

All clips use the chase camera at chest height or above (the game's own chase rig).
