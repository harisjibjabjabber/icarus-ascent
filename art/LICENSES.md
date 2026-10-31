# Art asset licences — Icarus's Ascent

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
