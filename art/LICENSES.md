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
