# Witch town: review media (branch level/witch-town)

All captures are from the production build, 390x844 portrait, DPR 1, headless Chrome with SwiftShader (software GL,
so these aren't phone frame rates). The runs are deterministic: seed 12345, look=witch, dev autopilot
`{minSpeed:13, strength:1, optionalRail:true, styleGrabs:true}`.
Cameras: the chase cam is the real game camera. The side cam sits 4.2 m to Ao's left, 1.1 m above her hips
(chest height or higher) and looks level to slightly down at her hips. No low cameras look up at her.

| file | what |
|---|---|
| `opening-chase.mp4` | whole opening course (x 0 to 1106 m, finish), chase cam, 20 fps (6 sim ticks/frame = real time) |
| `opening-side.mp4` | same run, side cam |
| `endless-chase.mp4` | endless mode sample, first ~335 m, chase cam |
| `endless-sample-sheet.jpg` | 6 frames from the endless clip |
| `stills-old-vs-new-chase.jpg` | main (top) vs town (bottom) at the same sim ticks/positions (t600 to t7800, x 75 to 1057 m) |
| `stills-old-vs-new-side.jpg` | same frames, side cam |
| `perf-main.txt`, `perf-town.txt` | `scripts/town-perf.mjs`: draw calls/triangles (incl. Ao) sampled every 250 ticks over the whole opening course |
| `opening-clip-meta.json`, `endless-clip-meta.json` | calls/tris for every clip frame |
| `proof/`, `sourcing/` | earlier sourcing-phase proof shots |

Perf, opening course (renderer.info, whole frame incl. Ao and the post quad):

| | max calls | avg calls | max tris | avg tris |
|---|---|---|---|---|
| main (c7dc292) | 110 | 88 | 204k | 187k |
| town | 113 | 95 | 302k | 273k |
| town, endless sample | 135 | — | 280k | — |

Target was ≤ ~150 calls and ≤ ~350k tris. The `main 102 / 201k` figure from the plan came from a single frame. The
table above gives the max over the whole run.

Scripts: `scripts/town-stills.mjs`, `scripts/town-clip.mjs`, `scripts/town-perf.mjs`, `scripts/town-proof.mjs`.
