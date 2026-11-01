import * as THREE from 'three';

/**
 * Soft stylised shading (art pass). A toon material with:
 *  - a soft, *coloured* light ramp (cool lavender shadows -> warm sunlit tops), linearly
 *    filtered so bands blend gently instead of hard cel steps;
 *  - a warm rim light that separates silhouettes from the background (readability);
 *  - optional wind sway for foliage (vertex attribute `sway`, 0 = rigid).
 * Shared uniforms (time, wind) are ticked once per frame by the view.
 */
export const ART = {
  ramp: [
    [150, 140, 196], // deep shadow: lavender
    [196, 182, 214],
    [236, 220, 214], // half light: warm grey-pink
    [255, 244, 228], // lit
    [255, 250, 240], // highlight
  ],
  rimColor: new THREE.Color('#ffe9c7'),
  rim: 0.32,
};

/**
 * Hi-fi: the sun's shadow box follows the rider, so its edge used to be a visible line where shadows start. Patch
 * three's PCF lookup (once, before any program compiles) so shadows fade out over the outer ~18% of the box instead.
 */
const SHADOW_RET = 'return mix( 1.0, shadow, shadowIntensity );';
if (THREE.ShaderChunk.shadowmap_pars_fragment.includes(SHADOW_RET) && !THREE.ShaderChunk.shadowmap_pars_fragment.includes('shadowEdgeFade')) {
  THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(SHADOW_RET,
    'vec2 shadowEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy ); float shadowEdgeFade = smoothstep( 0.0, 0.18, min( shadowEdge.x, shadowEdge.y ) );\n\t\t\treturn mix( 1.0, shadow, shadowIntensity * shadowEdgeFade );');
}

export const ART_UNIFORMS = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array(ART.ramp.length * 4);
  ART.ramp.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  ramp = new THREE.DataTexture(data, ART.ramp.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
  ramp.colorSpace = THREE.SRGBColorSpace;
  ramp.needsUpdate = true;
  return ramp;
}

export interface SoftOpts {
  vertexColors?: boolean;
  side?: THREE.Side;
  /** Rim light strength multiplier (default 1). */
  rim?: number;
  /** Geometry carries a `sway` attribute (foliage). */
  sway?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

export function toon(color: THREE.ColorRepresentation, opts: SoftOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: toonRamp(), vertexColors: opts.vertexColors ?? false, side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
  });
  const rim = ART.rim * (opts.rim ?? 1);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: ART.rimColor };
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uTime = ART_UNIFORMS.uTime;
    sh.uniforms.uWind = ART_UNIFORMS.uWind;
    if (opts.sway) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
            float ph = wp.x * 0.11 + wp.z * 0.07;
            transformed.x += sin(uTime * 1.6 + ph) * sway * 0.28 * uWind;
            transformed.z += cos(uTime * 1.1 + ph * 1.3) * sway * 0.2 * uWind;
          }`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRim;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 2.6);
          outgoingLight += uRimColor * rimF * uRim * (0.55 + 0.45 * diffuseColor.rgb);
        }
        #include <opaque_fragment>`);
  };
  // programs are shared across materials; rim strength is a per-material uniform
  m.customProgramCacheKey = () => `soft|${opts.sway ? 1 : 0}`;
  return m;
}
