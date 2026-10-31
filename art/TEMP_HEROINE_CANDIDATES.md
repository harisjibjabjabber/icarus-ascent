# Free temp-heroine VRM candidates (2026-10-31)

Contact sheet: `art/concepts/temp-heroine-contact-sheet.png`, with per-shot PNGs in `spikes/vrm-character/shots/candidates/`.
All candidates were loaded in the spike scene (390×844, MToon + outline, idle→push→crouch blend + foot IK). Foot-IK error was ≈0 cm for every one.
Fetch them with `spikes/vrm-character/candidates/fetch-candidates.sh`. No accounts needed. View one at `?model=<name>`; add `&tint=icarus` to the Twist sample for the concept recolour.

VRM0 files now work in the spike: `VRMUtils.rotateVRM0` plus x/z-negated clip quaternions and a mirrored hipsX. Before this fix their arms flailed upward.

| # | Model | Source | Licence (evidence) | Tris | Closeness to concept |
|---|---|---|---|---|---|
| 1 | **VRM1_Constraint_Twist_Sample** (pixiv). This is the file already used as `heroine.vrm`. | github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample | **VRM Public License 1.0**. README: "(c) 2022 pixiv Inc." In-file meta: avatarPermission=everyone, commercialUsage=corporation, allowRedistribution=true, modification=allowModificationRedistribution, creditNotation=unnecessary. Serving the file to players is allowed. **Not CC0.** | 36.5k | **Closest.** Adult-proportioned young woman, long brown hair with spring bones, anime face with expressions. T-shirt and shorts. With `tint=icarus` (cream top, terracotta shorts, brown shoes, gold hip sash) it reads close to the concept. |
| 2 | Quaternius Superhero_Female + Female_Peasant outfit + Hair_Long (assembled here) | quaternius.itch.io/universal-base-characters and quaternius.itch.io/modular-character-outfits-fantasy | **CC0 1.0**. Itch "Asset license: Creative Commons Zero v1.0 Universal". Outfit pack License_Standard.txt says "CC0 1.0 Universal". Free download, no account. | 25k | Adult woman with a chestnut bob (tinted here) and a peasant blouse, corset and boots. Western stylised-realistic look, not anime. Darker and busier than the concept. No spring bones or expressions. Needs Blender assembly (`build_quaternius_peasant.py`). |
| 3 | 100Avatars **Rose** (Polygonal Mind) | github.com/PolygonalMind/100Avatars; registry github.com/ToxSam/open-source-avatars (projects.json: CC0) | **CC0**. In-file VRM0 meta: licenseName=CC0, commercial Allow. The 100Avatars releases page says "licensed under the CC0 License model". | 5.6k | Adult woman, brown hair, pirate hat, striped top, red trousers. Chunky low-poly flat-texture style, which suits a BotW-lite look. Mouth and eyes are painted. Pirate theme is off-concept, but the hat can be deleted in Blender. |
| 4 | 100Avatars **Lydia** | same | CC0 (same evidence) | 3.6k | Lavender top, dark short hair, very simple. Legs look odd in the chase push. Far from the concept. |
| 5 | 100Avatars **Kate** | same | CC0 | 4.0k | Red bob, teal sweater, black leggings. Cute toy-like style. Needs a hair recolour and a skirt. |
| 6 | 100Avatars **Erika** | same | CC0 | 4.0k | Purple hair, olive tee, jeans. Needs a recolour. |
| – | 100Avatars Olivia | same | CC0 | 3.9k | Shot but dropped: dark witch-like outfit. |

## Excluded or not verifiable

- **VRoid sample models:**
  - β AvatarSample_1 and Sendagaya Shino are explicitly high-school students. **Excluded.**
  - β AvatarSample_2 ("youngest of five siblings", youthful look). **Excluded as ambiguous.**
  - β AvatarSample_4 ("beautiful lady", blonde, CC0) and AvatarSample_A–C (free and commercial, no CC0 relicensing) are only downloadable from VRoid Hub, which needs a pixiv account. They **weren't fetched**. The VRoid Hub public API shows AvatarSample_A `is_downloadable: true`.
- **Seed-san** (VirtualCast, VRM PL with credit required): child or androgynous look, with a robot arm. Shot but excluded.
- **Booth free (0 JPY) models:** downloads need a pixiv login, and most use VN3-style terms that forbid extractable model files, which a web game can't avoid. Skipped.
- **Open Source Avatars** NFT collections: VIPE Heroes is CC-BY; the rest are mostly creatures or chibis. None fit.

## Tweaks toward the concept

- **Twist sample.** Runtime `tint=icarus` already does cream top, terracotta shorts, brown shoes and a gold torus sash. Better versions:
  1. In Blender, recolour `Tops_01_CLOTH` and `Bottoms_01_CLOTH` textures by hue map instead of flat colour.
  2. Replace the shorts with a short chiton skirt. The VRoid-style skirt mesh can be adapted from the placeholder bottoms, with spring bones.
  3. Add a sash ribbon with a 2-bone spring tail. Warm the hair toward chestnut.
  4. Keep the existing hair springs.
- **100Avatars Rose.** One 256–512 px atlas texture makes recolouring trivial with a palette swap in code or GIMP. Delete the hat mesh, recolour the top to cream and the trousers to terracotta. Hair is a rigid mesh: weight the ponytail to 2 added spring bones.
- **Quaternius.** Recolour the T_Peasant atlas (corset → terracotta, blouse → cream). The Source pack ($20) has more outfits and the Regular (non-superhero) female body. Add spring bones to the hair. Lighten the outline width.
