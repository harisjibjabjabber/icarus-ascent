# Witch Town: asset sourcing + retexture plan

Branch `level/witch-town`. Haris's direction: stop hand-modelling / procedural town art; build the town from
**premade, licence-compatible models**, then pull them into one Ghibli look with **our own retexture + shader pass**.
Candidates are judged on silhouette / topology / modularity and licence (must allow modification), not on their
original textures. Everything below was downloaded without login or payment, except where noted.

Proof media: `review/town/proof/` · shortlists: `review/town/sourcing/` · proof code: `spikes/town-proof/proof.ts`
(look-only, loaded into the live game by `scripts/town-proof.mjs`; no game code changed).

## 1. Picks

| Role | Pick | Licence | Why |
|---|---|---|---|
| Buildings | **Quaternius – Medieval Village MegaKit (Standard, 176 pieces)** | CC0 | 2 m grid modular walls (plaster, uneven brick, timber), round-tile (Mediterranean) roofs 4x4…8x14, shutters, balconies, stairs, chimneys, vines, metal fences, arches. Silhouettes are the closest to the Kiki concept; walls are double-sided (exterior+interior). |
| Nature | **Quaternius – Stylized Nature MegaKit (Standard)** | CC0 | Common/twisted trees, pines, bushes w/ flowers, grass, rocks, rock paths. Same author → matching scale/topology. |
| Harbour | **Kenney – Pirate Kit 2.1** | CC0 | Row boats, ships, docks/platforms, barrels, crates, palms (harbour wall-run section). |
| Alt. buildings | Kenney – Fantasy Town Kit 2.0 (167 pieces) | CC0 | Cleaner, chunkier, palette-atlas (very cheap). Good fallback / far-LOD set; reads more "toy" than Ghibli. |
| Broom | **MiniPoly – "Witch Broom" (poly.pizza/m/gwE8397gO3)** | CC0 | 732 tris, classic Kiki silhouette (fat bound straw, curled handle top). Palette-atlas UVs → trivial recolour. |
| Backdrop | Our own painted panorama + tileable painted textures (generated, `spikes/town-proof/assets/painted/`) | ours | No CC0 painted Ghibli-style panoramas exist at usable quality; photo HDRIs (Poly Haven) clash. |

Broom shortlist (`review/town/sourcing/broom-shortlist.jpg`):
1. **MiniPoly Witch Broom** – CC0 – picked.
2. Jarlan Perez "Broom" (poly.pizza/m/eirJlDWOBm8) – CC-BY – thin heather broom, good silhouette, needs credit.
3. Garrett LeFever "Simple Broom" (poly.pizza/m/5dJ0_Qe5DJp) – CC-BY – too simple (126 tris).
4. Don Carson "Broom" (poly.pizza/m/cOMoz6gJFN) – CC-BY – push broom, wrong shape.
5. Polygonal Mind "Broom Character" (poly.pizza/m/JLbYFPteTC) – CC0 – mascot with a face, no.
Not downloaded (login required): TeaX3 "Low poly stylised Broom/Witch Broom" on Sketchfab (CC-BY, 360 tris, nice
stylised shape) and BlendSwap "Pepper's Broom" (CC-BY, from Pepper&Carrot). Worth grabbing if Haris logs in.

Kit shortlist: `review/town/sourcing/kit-shortlist.jpg`. Painted art: `review/town/sourcing/painted-art.jpg`.

## 2. Retexture pipeline (implemented in the proof)

Goal: every premade piece ends up on **one shared toon ramp, one palette, one outline**, so mixed sources read as one
painted world.

1. **Material-name routing.** Each kit uses a small, stable set of material names (Quaternius: `MI_Plaster`,
   `MI_RoundTiles`, `MI_WoodTrim`, `MI_WoodTrim_Wear`, `MI_Brick`, `MI_RockTrim`, `MI_UnevenBrick`, …; Kenney/MiniPoly:
   one palette atlas). A table maps each name to one of three treatments:
   - **Painted swap** – replace the base map with our hand-painted tileable texture (plaster, cobbles, wood), tinted per
     house from the concept palette (cream, ochre, peach, pale pink, pale blue).
   - **Gradient map** – keep the source texture's *luminance* (its modelled detail: tile rows, brick joints) and recolour
     it through a 2-stop palette (shadow colour → lit colour) in the shader. Used for roof tiles, brick, stone trims,
     shutters (teal / blue / sage).
   - **Palette-atlas remap** – for gradient-atlas assets (MiniPoly broom, Kenney, KayKit): remap the atlas *columns* the
     model actually samples to our palette offline (`minipoly-witch-broom-palette-retex.png`: orange → straw gold,
     brown → oak, grey band → red ribbon). Zero runtime cost.
2. **Shading.** All results go through `toon()` from `src/render/materials.ts` (the soft lavender→warm ramp + warm rim we
   already use on Ao and the broom), so lighting matches the heroine exactly. PBR roughness/normal/ORM maps are dropped.
3. **Outline.** Inverted-hull outline (warm dark brown `#4a3428`, width scaled gently with distance) on closed meshes
   (roofs, props, broom). Skipped on open wall panels (window reveals showed the hull as black holes). Production: replace
   with a single screen-space edge pass (depth+normal Sobel) so open meshes and instanced pieces outline consistently.
4. **Atmosphere / grading.** Warm-haze distance fog (`#cfe2ee`, 40–260 m) that fades into the painted backdrop; the
   backdrop card is unlit/no-fog with the horizon at camera height. Production adds: mild bloom on sun-lit highlights,
   a colour-grade LUT (lift shadows to lavender, warm highlights), and 2–3 parallax cloud cards.
5. **New painted textures** come from GenerateImage (tileable swatches, 1024² → 512² in game) or CC0 hand-painted sets;
   keep ≤ 6 shared textures in one 2048² atlas for the whole town.

## 3. Proof results (390x844 chase cam, real game, Ao witch look)

- `review/town/proof/proof-chase-sheet.jpg` – main today | premade with original textures | premade **retextured** + painted backdrop | retextured + our current v2 broom.
- `review/town/proof/proof-building-before-after.jpg` – one Quaternius house, as shipped vs retextured.
- `review/town/proof/proof-broom-before-after.jpg` – MiniPoly broom as shipped vs palette retex vs our current broom (same pose; IK feet still plant on the deck).
- Individual frames + render stats: `review/town/proof/*-{chase,broomcu,wide}.jpg`, `*-meta.json`.

## 4. Performance

Measured in the proof (headless SwiftShader, medium quality, opening course start):

| Scene | Draw calls | Triangles |
|---|---|---|
| main (Greek sky track) | 102 | 201k |
| proof, naive clones, original materials | 4,029 | 585k |
| proof, naive clones, retex + outlines | 6,889 | 926k |

The proof clones every kit piece (≈ 60 houses × ~40 meshes) – fine for judging looks, unusable on phones. Production
plan to get back to ≤ ~150 calls / ≤ 350k tris:
- **Bake per-chunk merged geometry** (one mesh per material per 40 m chunk; materials collapse to ~6 shared toon
  materials via the atlas) – removes >95 % of calls.
- **InstancedMesh** for repeated props (crates, barrels, trees, lamps, pots) and repeated roof sizes.
- **LOD:** near ring = full kit pieces; 40–120 m = Kenney-style low-poly blocks or impostor cards; beyond = painted backdrop.
- **Decimate** roofs (Quaternius 4x4 roof is 2k tris; a 300-tri version with the gradient-mapped tile texture reads the same at chase distance).
- Screen-space outline (1 pass) instead of a hull per mesh (halves calls).
- Stream/cull by chunk as the existing environment does; keep fog.

## 5. Rollout

1. Kit import script: GLTF → name-routed retex → per-chunk merge → `public/town/*.glb` (build step, checked in).
2. Reskin course pieces with kit parts: street surface = cobbles, rails = `Prop_MetalFence` / roof ridges, walls = plaster/brick panels, pillars = crates/barrels/stalls (Kenney pirate barrels + Quaternius crate), gaps = rooftops / canals.
3. Scenery placement along the route (houses stepping down to the sea, trees, harbour from Pirate Kit) using the existing scenery streaming.
4. Broom: swap our procedural broom for the retextured MiniPoly mesh (or keep ours if Haris prefers – see broom sheet); retune grab targets/clamp samples.
5. Painted backdrop: commission/generate a proper wide (21:9+) panorama set: sky, sea + far town, near rooftops, as 3 parallax layers.

## 6. Still open / honest notes

- The gradient-map pass on wood trims/shutters is not visibly taking effect in the proof yet (shutters still show the
  source wood, should be teal/blue/sage) – shader hook bug to fix in the import script.
- Rider reads small in the chase cam at this moment of the run (same on main); town density makes it more noticeable.
- Backdrop is a single 1280×720 card; fine for the proof, needs higher res + parallax layers.
- Medieval kit leans "Northern European timber" in places (wood beams); for a sunnier Mediterranean feel use the
  plaster-only wall variants and fewer timber trims.

## 7. Side note: alternative witch VRM (low priority)

- **"【Free model】Ki" (witch)** by 白い白米 (same author as Ao) – https://hub.vroid.com/en/characters/5216127528712133624/models/7641493879527461940 –
  VRM 0.0; conditions: corporate + individual commercial use allowed, redistribution allowed, **alterations allowed**,
  attribution not required. Navy dress, gold sash, black capelet, wide witch hat, round glasses; non-explicit, no school
  uniform. Reads young-adult but quite youthful (glasses, small frame) – judge vs Ao before switching. Thumbnail:
  `review/town/sourcing/vroid-ki-witch-thumb.jpg`. Download needs a VRoid Hub login (not done).

## Status (build-out, 2026-10-31)
Done on level/witch-town: the baked MiniPoly broom is in game. The town streams in 40 m chunks: Quaternius MVM pieces are baked into vertex colours, one material, one draw call per chunk LOD, and the far LOD and back rows use cheap houses. The course has the restyle (cobbles, tiled plazas, iron rails, plaster and harbour walls, flower pots, crate stacks, lamp gap posts). There's a harbour, sea and clock towers, plus a painted sky/sea band, a far-town layer and a sky dome. The full-screen depth outline and colour grade replace the per-mesh hulls.
Perf and media are in review/town/README.md.
