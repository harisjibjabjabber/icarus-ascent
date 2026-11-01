# Witch Broom (working title): vision

The title is a working one. It lives in a single constant, `GAME_TITLE` in `src/meta.ts`, so it is easy to change.

## Identity

Ao is a young witch who rides her broom like a skateboard. She pushes, jumps, grinds rails and rides walls through a sunlit Mediterranean seaside town, in the spirit of Kiki's Delivery Service. It is a portrait-phone 3D momentum game with a fixed chase camera.

It started life as "Icarus's Ascent" (a Greek skater above the clouds). The movement, controls and sim carried over unchanged. The setting, art and character are new.

## Vision in one line

**One endless run is one day's journey.**

Ao leaves the old town in the morning, drops through the harbour and cliffs in late morning, crosses Ghibli-style hills at golden hour, threads a forest at dusk and reaches a lantern-lit castle at night. Difficulty climbs in waves, with hand-built set pieces between the generated phrases. The score rewards style and close calls.

## Movement first

The control vocabulary and the movement and level-design rules in [BRIEF.md](BRIEF.md) stay canonical: controls, gestures, momentum, camera readability and failures. Only the setting and art direction in that file are superseded by this one.

- Score and combo exist to reward good movement, never to replace it.
- In-run UI stays calm: distance, a quiet score, lives. Nothing that competes with reading the terrain.
- A mechanic that adds or changes a gesture (ducking under arches, a broom air dash, lane steering) needs Haris's approval before it is built.

## Biomes

Each area runs 1.5 to 2 km and ends at a gate set piece where the next area cross-fades in.

| Area | Look | Movement features | Time of day | Status |
|---|---|---|---|---|
| Old town | Warm terracotta, cream plaster, teal shutters | Pots, signs, handrails, garden walls | Morning | Built |
| Harbour and cliffs | Turquoise sea, sandstone quay, white sails | Canal wall runs, pier gaps, rope rails, cliff updrafts | Late morning | Part built |
| Ghibli hills | Lime grass, wildflowers, big cumulus, soft gold | Fence rails, hay bales, windmill-sail rail, rolling crests | Golden hour | Mocked |
| Forest | Deep greens, moss, god-rays, fireflies | Log rails, fallen-trunk gaps, bounce mushrooms, tree-trunk wall runs | Dusk | Not started |
| Castle | Slate and blue stone, banners, lanterns, moon | Battlement rails, bridge gaps, portcullis spell gates, wall-run zigzags | Night | Not started |

## Roadmap

Each phase lands on its own branch, passes the autopilot fairness tests, and Haris reviews it before it is merged.

| # | Phase | Status |
|---|---|---|
| 0 | Hi-fi render pass: painted textures, shadows, bloom/AO, quality tiers | Merged to main |
| 1 | Endless feels like a game: score, combo, near-miss, sawtooth waves, set pieces, 3 lives | Merged to main |
| 2 | Day and night v1 on hifi: lanterns, window glow, time advancing with distance | Day/night presets (`?tod=`) merged to main. Time-of-day progression with distance, and street lanterns, are not done |
| 3 | Hills area | Rough stub |
| 4 | Forest area: updrafts, bounce mushrooms, log rails | Not started |
| 5 | Castle area: zigzag wall runs, spell gates, chase set piece | Not started |
| 6 | One hand-built course level per area, each with 3 star goals | Not started |

## Unproven risks

- Night that actually looks good (lanterns, moon, readable silhouettes).
- Biome cross-fade at the gates while the course is streaming.
- Painted backdrops for the new areas (the town's sky/sea and far-town layers are the model to match).
- Score and combo tuning, so style pays without overriding clean movement.
- Mid-range Android performance with bloom and point lights. Current numbers come from software-rendered headless Chrome and say nothing about real frame rate.

## Assets and pipeline

The source of truth is [`art/LICENSES.md`](art/LICENSES.md). The rule: every shipped asset is CC0, self-made, or explicitly licence-checked and recorded there.

- **Ao.** Her VRM models come from VRoid Hub creator 白い白米, whose licence panel allows commercial use, redistribution and alterations. They are optimised by the scripts in `art/heroine/pipeline/`.
- **Town.** Built from CC0 kits (Quaternius Medieval Village MegaKit, Kenney Fantasy Town 2.0 and Pirate 2.1), baked into `public/town/kit.bin` by `art/pipeline/bake_town.py`. A painted texture array comes from `art/pipeline/build_detail_array.py`. The broom is baked by `art/pipeline/bake_broom.py`.
- **Backdrops and tiles.** Painted backdrops and tiles are generated in-house.
- **Planned packs for new biomes** (all CC0): Quaternius Stylized Nature MegaKit, Kenney Nature, Castle, Pirate and Watercraft kits, Rubberduck Castle & Dungeon, and Poly Haven and ambientCG textures and HDRIs.
- **Avoid** CC-BY-NC tools and assets. Hunyuan3D is ruled out because of its licence.

## Where things are

- `README.md`: running, controls, architecture, endless mode, render quality.
- `BRIEF.md`: the movement, controls and level-design brief (setting superseded by this file).
- `art/`: asset plans, licences and pipelines.
- `review/`: review media for each landed pass.
