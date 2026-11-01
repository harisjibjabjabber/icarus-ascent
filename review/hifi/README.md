# Hi-fi render pass — review (branch `render/hifi`, not merged)

Haris: "the whole thing looks like a 3DS game … your goal for phone optimisation is based off a 2015 phone, not an
iPhone 17 or a Samsung S25." Gameplay, physics, controls and the course are unchanged (all 227 tests pass).

## What changed
- **Quality tiers** (`src/render/quality.ts`): new `ultra` tier. Phones now start at **high** (was medium), desktops
  at **ultra**. A phone that holds 60 fps at full resolution for ~20 s is promoted to ultra automatically. It is
  never promoted again once it has had to step down.
- **Dynamic resolution**: small dips lower the render pixel ratio in 0.25 steps, down to the tier's floor, before
  the tier itself drops. A steady 60 fps brings the resolution back.
- **Painted textures on the town** instead of flat vertex colours:
  - The kit is re-baked with its UVs (`art/pipeline/bake_town.py`, kit v2).
  - The Quaternius kit's own CC0 textures (plaster, round roof tiles, wood, rock, rubble, brick) plus our painted
    planks and cobbles are packed into one texture array (`public/town/detail-array.webp`, 312 KB, built by
    `art/pipeline/build_detail_array.py`).
  - Colour = our palette × the texture's high-pass detail, so per-house tints stay art-directed.
  - Normal maps on high and ultra.
  - Boxes, pavements and foundations are projected in world space, seamless across chunks.
  - The 2 m pavement checker is gone.
- **Full tiled roofs** on high and ultra, replacing the decimated ones. This also removes most of the dotted roof
  outline noise.
- **Sun and shade in the streets** (high/ultra):
  - Houses and roofs cast shadows.
  - The shadow box is bigger and centred ahead of Ao: 4096 map / ±64 m on ultra, 2048 / ±42 m on high.
  - Shadows fade out at the box edge instead of stopping on a hard line.
  - Shadow intensity is 0.85 for a softer, painted shade.
- **Post** (`src/render/post.ts`):
  - Soft quarter-resolution bloom (high/ultra).
  - Plane-aware screen-space AO tinted lavender (ultra).
  - Split-tone grade (lavender shadows, warm lights) and a soft contrast curve.
- **Sharper textures**:
  - Anisotropic filtering 8× (high) / 16× (ultra), on the town, the street and Ao's clothes.
  - The cobble street texture is now 1024² (was 512²).
- **Less LOD shimmer**: houses stay full detail 1.5× (high) / 3× (ultra) further out, so the dithered crossfades
  happen deep in the haze.
- **FPS readout**: add `?fps=1`. Any `?q=` also turns it on. It shows fps, tier, render scale, resolution, draw
  calls and triangles.

## Tiers
| tier | max DPR (floor) | shadows | textures | post | LOD scale | roofs |
|---|---|---|---|---|---|---|
| low | 1.0 (0.75) | off | flat + brush | outline | 1 | lite |
| medium | 1.5 (1.0) | 1024, ±28 m, Ao/props only | painted detail | outline + grade | 1 | lite |
| high (phone default) | 2.25 (1.5) | 2048, ±42 m, + town | detail + normals, aniso 8 | + bloom | 1.5 | full |
| ultra (desktop / earned / `?q=ultra`) | 3.0 (2.0) | 4096, ±64 m, + town | detail + normals, aniso 16 | + bloom + AO | 3 | full |

## Perf (opening run, seed 12345, renderer.info per frame incl. shadow + post passes; `perf/`)
| | max calls | avg calls | max tris | avg tris |
|---|---|---|---|---|
| main (phone = medium) | 122 | 99 | 340k | 297k |
| low | 96 | 73 | 233k | 193k |
| medium | 119 | 99 | 334k | 296k |
| high | 128 | 110 | 728k | 550k |
| ultra | 135 | 113 | 895k | 715k |

**Not proven: real-phone FPS.** These are software-rendered (SwiftShader) counts from headless Chrome. They show the
cost went up as intended, about 2.6× the triangles, with draw calls nearly flat. They cannot show frame rate. Test on
a phone:
- `?q=ultra&fps=1` forces ultra and shows the readout.
- `?q=high&fps=1` forces high.
- `?fps=1` alone shows the automatic behaviour.

## Media
- `sheet-390x844.jpg`: 8 moments. Top row is main as a phone renders it today (medium), bottom row is ultra. Single
  frames are in `stills-390/`.
- `sheet-1170x2532-1680.jpg`: iPhone DPR 3. Main (rendered at 1.5×, upscaled) vs hifi high (2.25×) vs ultra (3×).
- `sheet-1170x2532-pairs.jpg` and `crop-1170-town-1680.jpg`: full-resolution comparisons. All frames are in
  `stills-1170/`.
- `after-chase-ultra.mp4` (7 MB): the first 15 s of the opening run on ultra, 585×1266 (DPR 1.5, to keep it small), 20 fps.
- Every shot uses the game's chase camera (chest height or above).

## Weak spots (honest)
- Real-phone frame rate and heat are unmeasured. Ultra at 3× with 4096 shadows, AO and bloom is heavy. Auto-fallback
  and dynamic resolution should catch a struggling phone, but that's untested on hardware.
- iOS Low Power Mode caps the browser at 30 fps. The auto system will read that as slow and step down. This was
  already true on main.
- Shadowed streets make some frames darker and greyer than before. The amount (intensity, sun angle) is a taste call.
- The painted sky/sea backdrop is still the 1280-px image upscaled. At DPR 3 it is the softest thing on screen.
- Distant houses still show a little dither shimmer while they fade in (much less on ultra).
- The track kerbs and sides are still plain colour. The far hillside blocks are still simple boxes.
- AO and bloom are subtle by design and hard to see in the stills.
- Ao is unchanged apart from sharper texture filtering. The double outline (MToon outline + post ink) remains.
