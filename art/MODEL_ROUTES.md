# Making the Icarus model without 3–5 hours in VRoid Studio

Researched and tested 2026-10-31 on the box: Linux, 8 CPUs, **no GPU**. Haris is on an Android phone (Galaxy Z Fold7) and may not have a PC.
**PROVEN** means done on the box, with evidence linked. Nothing was paid for and no accounts were created.

## What was proven end-to-end

The whole chain runs on the box: concept art → AI 3D mesh → auto-rig → VRM → in-game scene.

- **Input art** (GenerateImage, self-made):
  - `art/concepts/icarus-apose-front.jpg`
  - `art/concepts/icarus-tpose-front.jpg`
- **Image-to-3D: TripoSR**, MIT licence, run **on the box's CPU**.
  - It took 3 s to infer and about 40 s to bake the texture, with no account or GPU.
  - Background removal is our own white-border flood fill (`spikes/vrm-character/gen/prep.py`). This avoids the default rembg model, `bria-rmbg-2.0`, which is CC BY-NC.
  - Marching cubes were patched to scikit-image (`gen/triposr-isosurface-skimage.py`), because torchmcubes doesn't build here.
  - Raw output: 92k tris, watertight, consistent winding.
- **Auto-rig: headless Blender 5.2 with the VRM Add-on** (`spikes/vrm-character/gen/rig.py`). It:
  1. welds the UV seams;
  2. decimates to 24k tris;
  3. reorients and scales the mesh to 1.55 m;
  4. refits the arm and leg joints of the VRM placeholder humanoid skeleton to the mesh;
  5. weights the mesh by distance to bone segments (Blender's bone-heat weighting fails on generated meshes), with the skirt blended toward the hips so it doesn't tear between the legs;
  6. builds an MToon material from the baked texture and exports VRM 1.0.
- **Result:** `art/generated/icarus-triposr-rigged.vrm`. Its derivative licence is described in `LICENSES.md`.
- **In the game scene:** the existing idle → push → crouch → idle blend and foot IK run unchanged. Runtime MToon is soft cel with an outline (`?fresh=1`).
  - Shots at 390×844: `spikes/vrm-character/shots/generated/gen-strip-chase.png`, `gen-strip-side.png` and `gen-strip-close.png`.
  - Blender check renders: `blender-rigged-front-textured.png` and `blender-rigged-front-solid.png`.
  - Character cost: 0.3–0.4 ms of CPU per frame, and 13 draw calls including the outline.

**Honest quality verdict on the TripoSR result: placeholder grade only. Not shippable as the heroine.**
- **Silhouette and colours:** read fine at the gameplay chase distance (`gen-strip-chase.png`).
- **Face:** a smeared painted blob. There are no real eyes, so there's no expression and no blink.
- **Hands:** mitts with no fingers.
- **Hair:** one solid lump fused to the back. Spring bones can't move it.
- **Skirt:** fused to the legs. A deep crouch still stretches cloth webbing between the knees.
- **Topology:** marching-cubes triangle soup, with no edge loops at the knees, elbows or shoulders. Bends crease and collapse.
- **Texture:** blurry, with the back side guessed.

## Image-to-3D options (ranked by quality)

| Route | Tested? | Quality for an anime heroine | Effort for Haris | Cost | Licence of output |
|---|---|---|---|---|---|
| **TRELLIS.2** (Microsoft, HF Space `microsoft/TRELLIS.2`) | Tried from the box, **blocked by ZeroGPU quota.** Anonymous use is 2 min/day per IP, and the shared box IP was already over: "exceeded your ZeroGPU quota… Try again in 19:38". | Best open model: sharp PBR textures, much better shape than TripoSR. It is still one fused mesh, so face, hair and hands share the same structural limits. | He'd make a free Hugging Face account (works on a phone) and create a **read token**. Free accounts get **5 GPU-min/day**, enough for about 2–4 generations. | £0 | Code and weights MIT, so the output is ours. |
| TRELLIS 1 (`trellis-community/TRELLIS`) | Same quota block | Good; also takes multi-view input | Same token | £0 | MIT |
| **Tripo API** (rig types include **VRM bone naming**, v3.0) | Not tested (needs a key) | Image→3D in about 30–50 credits, auto-rig 25 credits. Commercially among the best for characters, with optional quad remesh. | Account, API key, and a minimum $1 credit top-up by card | About $0.55–$1 per character | API outputs carry commercial rights. The free web plan is not usable: IP stays with Tripo, it needs attribution, and exports are limited to H2.5. |
| Meshy | Not tested | Similar tier, with free rigging and animation | Account. The free plan can only download *untextured* Meshy 6 Lite models. | Pro from about $20/month for textured downloads | Free plan: CC BY 4.0 (Meshy owns the output, credit required). Paid: you own it. |
| Hyper3D Rodin | Not tested | Strong for props, weaker for characters | Account plus a paid plan for commercial export | About $24/month (Creator) | Free tier is not clearly cleared for commercial use |
| Hunyuan3D 2 / 2.1 (Tencent) | Not used | Good | — | — | **Ruled out.** The Tencent Hunyuan Community licence is non-commercial and **excludes the UK and EU**, and Haris is in the UK. |

Even the best of these gives a **figurine-style** mesh: one surface, no separate hair or cloth, fused fingers and no face rig. To get to our target from there, someone has to retopologise and separate the hair and skirt (artist work), or accept a stiff character.

## Other routes from a phone

- **VRoid Mobile (Android):**
  - It can make an anime avatar from presets, upload it to VRoid Hub and download the VRM, which works with our pipeline.
  - **However, its terms say "Redistribution: NO".** A public web game serves the `.vrm` to every visitor, which is effectively redistribution. Not safe to ship. Fine for a private prototype.
  - Customisation is also preset-limited (no custom chiton texture painting on mobile). Effort is about 30–60 minutes.
- **Ready-made VRoid Hub or Booth models:**
  - Booth VRMs typically cost $20–50.
  - Most use VN3 or similar licences, which allow individual commercial use but usually forbid making the model file extractable. A WebGL game can't hide the file.
  - Each one needs its own licence check, and none will match our concept without edits.
  - Low effort, low fit.
- **Commission a VRoid or 3D artist (VGen, Booth, Fiverr):**
  - VRoid-based custom avatars run about **$40–150**, typically $80–150 for detailed work with custom textures.
  - Fully custom Blender models run about **$300–1,100+**.
  - Haris sends our concept sheet (`concept-5-botw-ghibli-turnaround.jpg`), the A-pose image and the VRoid spec in `CHARACTER_PLAN.md` §5.3.
  - He must require VRM 1.0 delivery and **written permission for commercial use in a public web game, including the model file being served to players**.
  - His effort is about 15 minutes of messaging plus payment. Turnaround is usually 1–3 weeks.
  - **Best quality per pound, and the only route that reliably reaches the BotW × Ghibli target.**
- **VRoid Studio on any computer** (the original plan, 3–5 hours): still valid if he has, or can borrow, a Windows PC or Mac.

## MCP (blender-mcp / "MCP for Blender")

It wouldn't help here.
- **What it is:** it lets an AI drive a *desktop* Blender over a local socket (run Python, import from Sketchfab, call Hyper3D Rodin with *his* API key).
- **What the box already has:** headless Blender 5.2 with the VRM add-on, scripted end-to-end (proven above). The MCP would only add a second way to send the same Python commands.
- **The real bottleneck** is the art: model quality, face, hair and cloth topology. It isn't tool access, and an MCP doesn't add GPU generation or artistic skill.
- **It can't run on his phone** anyway. It needs desktop Blender, Python and uv on a PC.

## Recommendation

1. **Now, at £0 and about 5 minutes for Haris:**
   - He creates a free Hugging Face account on his phone and a read token, and gives it to me through the secure form, not pasted in chat.
   - I re-run the proven pipeline with **TRELLIS.2** in place of TripoSR. That gives a much better placeholder heroine, rigged and in-game the same day.
   - It's good enough for gameplay readability at the chase distance, but it still won't have an expressive face, moving hair or cloth.
2. **For the real heroine:** **commission a VRoid artist (about $80–150)** with our concept pack and spec, requiring VRM 1.0 and web-game commercial rights.
   - It drops straight into the proven three-vrm pipeline with spring hair and skirt and expressions. No other work is needed on our side.
   - If he'd rather not pay and has computer access, VRoid Studio himself is still the route.
3. **Optional middle route** (about $1, needs his Tripo API key and a card top-up): Tripo image→3D plus VRM-named auto-rig. Likely slightly better than TRELLIS.2 plus our rig, but with the same fused-mesh limits.
