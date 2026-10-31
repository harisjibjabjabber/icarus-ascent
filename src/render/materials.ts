import * as THREE from 'three';

/**
 * Toon-ish material factory: soft 4-step light ramp, so the art pass can swap
 * the ramp / palette / add outlines without touching geometry code.
 */
let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  // soft steps: shadow, half-tone, lit, highlight
  const steps = [110, 168, 222, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

export function toon(color: THREE.ColorRepresentation, opts: { vertexColors?: boolean; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), vertexColors: opts.vertexColors ?? false, side: opts.side ?? THREE.FrontSide });
}
