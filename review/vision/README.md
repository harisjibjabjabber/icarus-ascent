# Vision presets on the hi-fi renderer: check stills

390x844, DPR 1, `high` tier (phone default), seed 12345, opening course, tick 1500, game chase camera (`scripts/hifi-stills.mjs` flow; swiftshader).

- `default-1500.jpg`: no `?tod` / `?biome`. Matches origin/main at the same tick (SSIM 0.9995; the rest is JPEG and petal noise).
- `tod-night-1500.jpg`: `?tod=night`. Window glass and interiors glow (emissive into the bloom), wires and railings no longer glow.
  Still weak: down-the-street views see facades at grazing angles, so the glow shows as slivers, walls read grey-blue and there are no pools of light on the street.
- `biome-hills-1500.jpg`: `?biome=hills` (day lighting). A rough mock, same as on the spike: no painted backdrop, the terrain is flat-shaded, the cobble street stays, and the CommonTree leaves read red/pink.

The spike's own proof stills (old budget renderer) stay on `spike/vision` and are not copied.
