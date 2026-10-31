# VRM character spike (not game code)

Proves the character pipeline for Icarus's Ascent: `@pixiv/three-vrm` load, MToon soft-cel tweak,
spring-bone hair with speed wind, keyframed clips on normalized humanoid bones, AnimationMixer
crossfades (idle → push → crouch → idle), analytic two-bone IK planting both feet on the deck,
the game's chase camera (fov 52, 11.5 m behind, 7 m up, 17° pitch), and a frame-time probe.

    ./fetch-model.sh && npm i && npm run dev     # then open http://localhost:5190/?cam=chase|side|close
    npm run shoot                                # 390x844 headless shots into shots/ + probe line

`blender-roundtrip.py`: headless Blender 5.2 (pip `bpy`) + VRM Add-on for Blender 4.10.3:
import VRM → decimate → export VRM; the exported file loads back in this spike.
