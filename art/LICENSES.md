# Art asset licences — Witch Broom (working title)

Project rule (BRIEF): every shipped asset is CC0 or self-made, recorded here.
**Open decision for Haris:** the recommended character route uses a VRoid Studio model. VRoid
output is licensed for commercial game use but is *not* CC0 (pixiv keeps rights in its base meshes
and presets). Shipping it needs the rule widened to "CC0, self-made, or VRoid Studio Terms
Art. 11 / VRM Public License with modification + redistribution allowed". Nothing below ships yet.

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| Concept images `art/concepts/*.jpg` | generated for this project (Grok Bot GenerateImage) | self-made reference art, not shipped in the game | prompts in CHARACTER_PLAN.md §1 | reference only |
| VRM1_Constraint_Twist_Sample.vrm (spike placeholder) | https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample — (c) 2022 pixiv Inc. | VRM Public License 1.0 (https://vrm.dev/licenses/1.0/). Embedded meta read on the box 2026-10-31: `modification: allowModificationRedistribution`, `allowRedistribution: true`, `commercialUsage: corporation`, `creditNotation: unnecessary`, `avatarPermission: everyone`, `allowAntisocialOrHateUsage: false` | `spikes/vrm-character/fetch-model.sh`; meta dumped with python glTF reader | spike only (not CC0; wrong outfit) |
| Seed-san.vrm (looked at, not used) | vrm-c/vrm-specification samples, VirtualCast, Inc. | VRM PL 1.0, `creditNotation: required` | — | no (male-presenting robot-arm design) |
| VRoid β Ver AvatarSample_1–4 (looked at, not used) | https://vroid.pixiv.help/hc/en-us/articles/4402614652569 | CC0 | — | **no**: written as high-school students; Icarus must read clearly adult |
| Future `public/characters/icarus.vrm` | made by Haris in VRoid Studio (spec in CHARACTER_PLAN.md §5) | VRoid Studio Terms of Use Art. 11 / guidelines https://vroid.com/en/studio/guidelines — commercial use incl. games allowed; pixiv presets not CC0; avoid presets marked with special licence terms | to record at drop-in: VRM meta dump + screenshot of export licence settings | after rule decision |
| @pixiv/three-vrm 3.5.5 (library) | npm | MIT | `npm view @pixiv/three-vrm license` → MIT | yes (code) |
| VRM Add-on for Blender 4.10.3 (tool) | https://github.com/saturday06/VRM-Addon-for-Blender | MIT (tool, output not encumbered) | release zip v4.10.3 | tool only |
| Blender 5.2.3 `bpy` (tool) | PyPI `bpy` | GPL (tool; output is yours) | `pip install bpy` in /workspace/bpyenv | tool only |
| Quaternius Universal Animation Library 1+2 (candidate) | https://quaternius.com, https://opengameart.org/content/universal-animation-library-2 | CC0 | OpenGameArt page lists CC0 | not yet downloaded/retargeted (UNPROVEN) |
| `art/concepts/icarus-apose-front.jpg`, `icarus-tpose-front.jpg` | generated for this project (GenerateImage) as image-to-3D input | self-made | MODEL_ROUTES.md | input only |
| TripoSR code + weights (tool) | https://github.com/VAST-AI-Research/TripoSR, `stabilityai/TripoSR` | MIT (c) 2024 Tripo AI & Stability AI | LICENSE file in repo | tool; outputs ours |
| `art/generated/icarus-triposr-rigged.vrm` | TripoSR mesh from our T-pose image, rigged in Blender onto the VRM1_Constraint_Twist_Sample skeleton (meshes, textures and face removed; armature and spring setup kept) | Mesh/texture: ours. Skeleton is derived from pixiv's sample, so the file is Adapted Work Data under **VRM Public License 1.0** (modification + redistribution allowed, credit not required). Not CC0. | `spikes/vrm-character/gen/rig.py` | placeholder only |
| rembg `bria-rmbg-2.0` | auto-downloaded by TripoSR's default path | **CC BY-NC 4.0**, so it must NOT be used for shipped assets | replaced by `gen/prep.py` flood-fill matte | not used for the final mesh |
| TRELLIS / TRELLIS.2 (candidate) | `microsoft/TRELLIS.2-4B`, HF Space `microsoft/TRELLIS.2` | MIT | Space cardData license: mit | not yet run (ZeroGPU quota) |
| Hunyuan3D 2/2.1 | Tencent | Tencent Hunyuan Community licence: non-commercial, territory excludes UK/EU | — | **ruled out** |
| Tripo / Meshy / Rodin outputs (candidates) | commercial services | Tripo API: commercial rights to the API account; Tripo free web: IP Tripo + attribution. Meshy free: CC BY 4.0 (Meshy owns); paid: user owns. Rodin: paid plan for commercial | vendor pricing/terms pages, Oct 2026 | not used |
| VRoid Mobile output (candidate) | VRoid Mobile via VRoid Hub VRM download | commercial use allowed, **redistribution NO**, so not safe to serve in a public web game | vroid.pixiv.help article 360000343262 | not used |
| Temp-heroine candidate: `VRM1_Constraint_Twist_Sample.vrm` (pixiv), same file as `heroine.vrm` | github.com/vrm-c/vrm-specification samples | VRM Public License 1.0: redistribution + modification + corporate commercial allowed, credit not required. Not CC0 | in-file VRMC_vrm meta + samples README | candidate (TEMP_HEROINE_CANDIDATES.md) |
| Temp-heroine candidates: 100Avatars Rose, Lydia, Kate, Erika, Olivia (Polygonal Mind) | arweave URLs in `spikes/vrm-character/candidates/fetch-candidates.sh` (from ToxSam/open-source-avatars registry) | **CC0** | in-file VRM0 meta licenseName=CC0; github.com/polygonalmind/100Avatars releases text | candidate |
| Temp-heroine candidate: Quaternius Universal Base Characters [Standard] + Modular Character Outfits Fantasy [Standard] | quaternius.itch.io | **CC0 1.0** | itch "Asset license: CC0"; License_Standard.txt in the zip | candidate (assembled by `build_quaternius_peasant.py`) |
| Candidates (tested, no login): VRoid AvatarSample_A / _B (pixiv) | mirror github.com/madjin/vrm-samples vroid/stable | pixiv sample terms: free incl. commercial, no credit; no CC0 relicensing, no paid redistribution | vroid.pixiv.help article 4402394424089 | candidate (BEST_HEROINE_CANDIDATES.md) |
| Candidates (tested, no login): Vivi, Vita, Victoria Rubin (old VRoid alpha/beta samples) | mirror github.com/madjin/vrm-samples vroid/beta | CC0 (in-file VRM meta; OpenGameArt "VRoid Studio CC0 models"; VRoid Hub 歴代サンプルモデル note) | in-file meta | candidate |
| Candidates (login-only, not downloaded): Ao (白い白米), Hikari (あわ), Elf woman (りん, credit required), Yuzuki (Tovie), beta AvatarSample_4 | hub.vroid.com model pages listed in BEST_HEROINE_CANDIDATES.md | VRoid Hub panel: commercial + redistribution + modification allowed | API licence fields, 2026-10-31 | not yet downloaded |

### Shipped heroine: Ao (branch `art/heroine-ao`, chosen by Haris 2026-10-31)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `public/heroine/ao-longhair.vrm` (main look), optimised from VRoid Hub model 8534999798317965556 | Creator **白い白米 (siroihakumai)**. https://hub.vroid.com/en/characters/-/models/8534999798317965556 | VRoid Hub VRM 0.0 licence panel: avatar use allowed (everyone); **corporate and individual commercial use allowed**; **redistribution allowed**; **alterations allowed**; credit **not required**. Embedded `otherPermissionUrl` also lists sexual_expression=allow, violent_expression=allow. Character page note: "In-game data usage OK … Use the above with modifications OK" | VRM meta read on the box from the downloaded file; VRoid Hub page and API licence fields, 2026-10-31. Downloaded through the signed-in VRoid Hub browser session (no purchase) | **yes** (branch only) |
| `public/heroine/ao-witch.vrm` (selectable look, `?look=witch` or the Outfit button), optimised from model 2338813411564378208 | 白い白米. https://hub.vroid.com/en/characters/-/models/2338813411564378208 | same panel as above | same | **yes** (branch only) |
| Ao dress-style model 4502686513672574798 (looked at, not used) | 白い白米. https://hub.vroid.com/en/characters/-/models/4502686513672574798 | same panel as above | same | no |
| Modifications made | `art/heroine/pipeline/optimize-vrm.mjs`: hidden-skin removal, meshopt simplification, texture atlasing + WebP, material merge, meshopt compression, bust spring chains removed; our own animation clips (`src/render/heroine/clips.ts`) | Alterations are allowed by the panel above. Source VRMs are not committed (rebuild with `art/heroine/pipeline/build.sh`) | — | — |
| meshoptimizer, sharp, three-mesh-bvh (pipeline tools) | npm | MIT (meshoptimizer, three-mesh-bvh), Apache-2.0 (sharp) | package licences | tool only |

Content rule kept: Ao is an adult-presenting character; animations are playful but non-explicit.

### Broom prototype concept art (branch `proto/broom`, 2026-10-31)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `art/concepts/broom/01..06-*.jpg` (key art, town overview, rooftop grind, wall run, mood board, broom + stance sheet) | Generated for this project with the Grok Bot image tool from text prompts (`art/concepts/broom/README.md`); no reference images, no third-party art | Our own generated concept art; internal reference only | prompts in the README | no (reference only, not in `public/`) |
| Broom mesh + trail (`src/render/broom.ts`) | Procedural three.js geometry written for this project | project code | — | yes (branch only) |

## Witch town sourcing (level/witch-town, proof only: spikes/town-proof/assets/)
- Quaternius – Medieval Village MegaKit (Standard) – CC0 1.0 – https://quaternius.com/packs/medievalvillagemegakit.html (via opengameart.org/content/medieval-village-megakit). Textures downscaled to 512².
- Quaternius – Stylized Nature MegaKit (Standard) – CC0 1.0 – opengameart.org/content/stylized-nature-megakit
- MiniPoly – "Witch Broom" – CC0 – https://poly.pizza/m/gwE8397gO3 (palette atlas recoloured by us: minipoly-witch-broom-palette-retex.png)
- Painted backdrop + tileable textures (plaster, roof tiles, cobbles, wood) – generated for this project (ours).
- Evaluated, not shipped: Kenney Fantasy Town Kit 2.0 (CC0), Kenney Pirate Kit 2.1 (CC0), poly.pizza brooms by Jarlan Perez / Garrett LeFever / Don Carson (CC-BY), Polygonal Mind Broom Character (CC0).

## Hi-fi render pass (branch `render/hifi`, 2026-11-01)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `public/town/detail-array.webp` layers 0-5 (plaster, round roof tiles, wood trim, rock trim, uneven brick, brick: luminance + normal map) | Quaternius Medieval Village MegaKit textures (`T_*_BaseColor.png`, `T_*_Normal.png`), repacked by `art/pipeline/build_detail_array.py` (luminance only, median-softened; colour comes from our palette) | CC0 1.0 | `spikes/town-proof/assets/mvm/LICENSE.txt` | yes (branch only) |
| `public/town/detail-array.webp` layers 6-7 (planks, cobbles) | Our painted tiles `spikes/town-proof/assets/painted/{wood,cobbles}.jpg` (generated for this project), normals derived from luminance | ours | listed above | yes (branch only) |
| `public/town/kit.bin` v2 (adds UVs + texture layer per vertex) | Same CC0 kit pieces as before (Quaternius MVM, Kenney Fantasy Town 2.0, Kenney Pirate 2.1), re-baked by `art/pipeline/bake_town.py` | CC0 1.0 | as above | yes (branch only) |
| Cobble street texture (1024², was 512²), bloom / AO / grade shaders | procedural, written for this project | project code | — | yes (branch only) |

No new third-party downloads, accounts or purchases.

## Course props (high line + collectible lanterns, 2026-11-01)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `art/props/kenney/lantern-hanging.glb`, `cabin-fence.glb`, `colormap.png` | Kenney Holiday Kit 2.0. Source mirror: https://community.rokojori.com/Rokojori/winter-tales (commit `96840efcffe0879d933f32353dcb0dbad000f67d`, `assets/kenney_holiday-kit/`). Pack page: https://kenney.nl/assets/holiday-kit | **CC0 1.0** | `art/props/kenney/License.txt` (Kenney, www.kenney.nl, "CC0 1.0 Universal", creation date 11-12-2024) | source only |
| `public/props/props.bin` pieces `lantern` and `rail` | Those two meshes, recoloured by `art/pipeline/bake_props.py` into the witch-town palette and multiplied by the painted detail array (rock layer for the lantern, wood layer for the fence). The hanging lantern is the collectible; the fence panel is the risky high line. Flame and the gold top rail are untextured warm colours. | CC0 source, our recolour | baker + this table | **yes** |
| `public/props/props.bin` piece `beacon` | The `lantern` piece already in `public/town/kit.bin` (Kenney Fantasy Town Kit 2.0, CC0, recorded above), recoloured warm by the same baker and used as the pair of post lanterns that frame a high line | CC0 source, our recolour | `art/pipeline/bake_props.py` `beacon()` | **yes** |

No new accounts or purchases. Poly Pizza and kenney.nl direct downloads were blocked; the Gitea mirror above served the same CC0 pack.

## Collectible orbs — SFX and particles (2026-11-01)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `public/orbs/sfx/gold.ogg` / `.mp3` | **Gem Collect SFX** `gem-gather-stereo-reverb.wav` (Bobjt), mono, trimmed to **~0.35 s** for gold streaks | CC0 | opengameart.org/content/gem-collect-sfx | **yes** |
| `public/orbs/sfx/rare.ogg` / `.mp3` | Same source, **full-length** (~0.55 s bake) for purple orbs | CC0 (Bobjt) | same | **yes** |
| `public/orbs/sfx/trail.ogg` / `.mp3` | Kenney Interface Sounds `confirmation_003.ogg` | CC0 (Kenney) | same Interface Sounds pack | **yes** |
| `public/orbs/sfx/trailPerfect.ogg` / `.mp3` | `24.wav` from Bell Arpeggio (cynicmusic) | CC0 | opengameart.org/content/bell-arpeggio-24 | **yes** |
| `public/orbs/tex/particles.webp` | Kenney Particle Pack sprites (circle_02, star_09, star_02, circle_05, circle_03, twirl_02, light_03, trace_01), white-alpha atlas | CC0 (Kenney) | opengameart.org/content/particle-pack-80-sprites | **yes** |

Bake: `node art/orb/process-assets.mjs` (requires `sharp` for atlas; `ffmpeg` for audio).

Street bunting is a catenary of cloth pennants hooked to both facades (the old straight bar of flat boxes is gone). A high line dressed as bunting uses the same string, with a hook on each facade; the grind itself stays on its rail. `rail` is the risky grind's fence panel.

## Wall rides and dressed lines (2026-11-01)

Downloaded for this pass. Kenney zips from OpenGameArt (CC0 stated on each pack page and in the pack's `License.txt`). Pixor models from `https://pixor.art/library/files/<name>/pixor-library-<name>.glb`. Pixor publishes the library as CC0: https://pixor.art/library/license/ (checked 2026-11-01). No accounts or purchases. `art/pipeline/bake_props.py` recolours Kenney by colormap and Pixor by material name, and drops named parts (posts, poles, smoke).

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `art/props/kenney/pirate/` (`boat-row-small.glb`, `boat-row-large.glb`, `mast-ropes.glb`, `flag-pennant.glb`, `flag-pirate-pennant.glb`, `colormap.png`, `License.txt`) | Kenney Pirate Kit 2.1. https://opengameart.org/content/pirate-kit — zip `kenney_pirate-kit_2.1.zip` | **CC0 1.0** | `License.txt` ("Creative Commons Zero, CC0", created 17-02-2026); OpenGameArt page lists CC0 | source; baked (`boat-small`, `boat-large`, `pennant`, `pennant-dark`). The mast is no longer the harbour crane |
| `art/props/kenney/town/` (`stall-red.glb`, `stall-green.glb`, `colormap.png`, `License.txt`) | Kenney Fantasy Town Kit 2.0. https://opengameart.org/content/fantasy-town-kit — zip `kenney_fantasy-town-kit_2.0.zip` | **CC0 1.0** | `License.txt` (CC0, created 03-08-2025) | source; baked (`stall-red`, `stall-green`), not instanced yet |
| `art/props/kenney/holiday/` (`lights-colored.glb`, `colormap.png`, `License.txt`) | Kenney Holiday Kit 2.0. https://opengameart.org/content/holiday-kit — zip `kenney_holiday-kit.zip` | **CC0 1.0** | `License.txt` (CC0, created 11-12-2024) | source; baked (`lights`), not instanced yet |
| `art/props/kenney/city/` (`detail-awning.glb`, `detail-awning-wide.glb`, `colormap.png`, `License.txt`) | Kenney City Kit Commercial 2.1. https://opengameart.org/content/city-kit-commercial — zip `kenney_city-kit-commercial_2.1.zip` | **CC0 1.0** | `License.txt` (CC0, created 21-07-2025) | source; baked (`awning`, `awning-wide`), not instanced yet |
| `art/props/pixor/pixor-library-washing-line.glb` | https://pixor.art/library/files/washing-line/pixor-library-washing-line.glb | **CC0** | Pixor library licence page | source; `cloth-*` kept in the bin, not used for the set-piece line |
| `art/props/pixor/pixor-library-sign-inn.glb` | https://pixor.art/library/files/sign-inn/pixor-library-sign-inn.glb | **CC0** | same | source; iron arm baked as `bracket` and **placed** from the line out to the facade. Post dropped |
| `art/props/pixor/pixor-library-fishing-boat.glb`, `pier-post.glb`, `hot-air-balloon.glb`, `street-lamp-oil.glb`, `lamp-post.glb`, `sign-shop.glb`, `banner-street.glb`, `chimney-pot.glb`, `steam-vent.glb`, `windmill.glb`, `pinwheel.glb` | `https://pixor.art/library/files/<name>/pixor-library-<name>.glb` | **CC0** | same | source; lamp, signs, vent, pinwheel and pennant still placed. The chimney pot and the fishing boat are not the set-piece props |

Harbour wall rides are drawn in code (warehouse bays, planked hulls), not from these meshes. Town shop walls stay the existing azulejo wall. Gold orb trails along a wall ride use the orb meshes already in the game (pickup `wall`, so a pass on the street does not take them).

## Sourced set pieces (2026-11-02)

CC0 1.0. Grab3D models are the GLB on each model page (no login). Restyle drops normal, roughness and metallic maps, repaints the base colour, and writes WebP atlases. Decimate and the laundry cloth sim run in Blender: `art/pipeline/decimate_setpieces.py`, `art/pipeline/laundry_sim.py` (`pip install bpy` if Blender is not installed). `art/pipeline/restyle_setpieces.py` then `art/pipeline/bake_props.py`.

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `art/props/grab3d/awning.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/buildings/awning/ | **CC0 1.0** | model page (CC0, no login) | yes — `set-awning`, `set-awning-teal`, `set-awning-ochre` |
| `art/props/grab3d/market-stall.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/buildings/market-stall/ | **CC0 1.0** | model page | baked as `set-stall`, **not placed** — at real size it reads as a bare table over the water |
| `art/props/grab3d/hot-air-balloon.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/vehicles/hot-air-balloon/ | **CC0 1.0** | model page | **no** — restyled, not packed. A 21 m envelope at 3k tris facets in game |
| `art/props/grab3d/balloon.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/props/balloon/ | **CC0 1.0** | model page | yes — `set-balloon` |
| `art/props/grab3d/rowboat.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/vehicles/rowboat/ | **CC0 1.0** | model page | yes — `set-boat` (oars dropped) |
| `art/props/grab3d/chimney.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/buildings/chimney/ | **CC0 1.0** | model page | yes — replaces the `chimney` piece |
| `art/props/grab3d/treadwheel-crane.glb` | CC0 1.0, Grab3D, https://grab3d.com/models/buildings/treadwheel-crane/ | **CC0 1.0** | model page | yes — replaces the `crane` piece |
| `art/props/smoke/smoke1.png`, `smoke3.png` | CC0 1.0, OpenGameArt, https://opengameart.org/content/smoke-vapor-particles (fupi) | **CC0 1.0** | OpenGameArt page lists CC0 | yes — `public/props/steam/smoke1.webp`, `smoke3.webp` |
| `art/props/smoke/smoke_04.png`, `smoke_07.png` | CC0 1.0, Kenney, https://opengameart.org/content/particle-pack-80-sprites | **CC0 1.0** | same pack as the orb atlas | yes — `public/props/steam/smoke_04.webp`, `smoke_07.webp` |
| `art/props/fabric/Fabric019_Color.jpg` | CC0 1.0, ambientCG, https://ambientcg.com/view?id=Fabric019 | **CC0 1.0** | ambientCG lists CC0 1.0 | weave baked into cloth atlases, not shipped as its own file |
| Laundry garments | no sourced mesh; cloth sim in `art/pipeline/laundry_sim.py` | project | — | yes — `set-sheet`, `set-shirt`, `set-towel`, `set-dress`, `set-sock`, `set-sock-b` |

## Sky layer (workstream B, 2026-11-02)

No CC0 balloon with a tied neck and knot was a better fit than building one: the packed `set-balloon` (Grab3D) is a different prop and is not used for sky clusters. The pieces below are procedural three.js geometry in the game, toon-shaded with the existing lavender ramp.

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| Balloon clusters (lathe teardrop, knot, string, inverted-hull outline) | `src/render/sky/balloons.ts` | project code, self-made | — | yes |
| Tuft grate, spiral ribbons, leaves, petals, dust, lure stars | `src/render/sky/tuftFx.ts` | project code, self-made | — | yes |
| Centre-line rope, facade brackets, poles, pegs, procedural laundry fallback | `src/render/sky/skyLines.ts` | project code, self-made | — | yes. When `props.bin` has loaded, the hanging cloth is the existing self-made laundry set instead of the fallback |
| Gust pose | `src/render/heroine/clips.ts` (`gust`) | project code, self-made | — | yes |

## Vision presets (time of day + hills biome mock, ported from `spike/vision`, 2026-11-01)

| Asset | Where | Licence | Evidence | Ships? |
|---|---|---|---|---|
| `public/spike-biome/*.gltf/.bin/.png` (CommonTree_1/3, TwistedTree_1, Pine_1/3, Bush_Common_Flowers, Flower_3_Group, Rock_Medium_1 + their textures, downscaled to 512 px) | Quaternius – Stylized Nature MegaKit (Standard/free), https://quaternius.com/packs/stylizednaturemegakit.html (also opengameart.org/content/stylized-nature-megakit) | **CC0 1.0** | `public/spike-biome/LICENSE-Quaternius-CC0.txt` (the pack's own licence file) | yes, loaded only with `?biome=hills` (~3.4 MB) |
| Time-of-day presets, star field, window glow, hills terrain (`src/render/timeOfDay.ts`, `src/render/biomeHills.ts`) | procedural, written for this project | project code | — | yes (behind `?tod=` / `?biome=`) |
