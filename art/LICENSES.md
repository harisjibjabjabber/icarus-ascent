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
