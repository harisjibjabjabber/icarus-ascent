import * as THREE from 'three';

/**
 * One full-screen pass after the scene: a depth-based ink outline (replaces per-mesh inverted hulls, which
 * blacked out window openings and doubled draw calls) and a gentle colour grade matched to Ao's MToon look.
 * The scene renders into a half-float target (MSAA where the device has it) with a depth texture; the quad
 * applies tone mapping and the sRGB transfer itself (three skips both when rendering to a target).
 *
 * Edges come from the Laplacian of inverse view depth, which is exactly zero on any plane, so ground seen at
 * a grazing angle stays clean while silhouettes and creases ink. Lines fade with distance into the haze.
 */
export const POST_STYLE = {
  ink: '#3b2c48',
  inkStrength: 0.78,
  threshold: 0.035,
  fadeNear: 70,
  fadeFar: 420,
  saturation: 1.07,
  warm: [1.025, 1.0, 0.965] as [number, number, number],
  lift: 0.012,
};

export class PostPass {
  enabled = true;
  private rt: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer, samples = 4) {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    const S = POST_STYLE;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uInk: { value: new THREE.Color(S.ink) }, uInkStrength: { value: S.inkStrength }, uThreshold: { value: S.threshold },
        uFade: { value: new THREE.Vector2(S.fadeNear, S.fadeFar) }, uSat: { value: S.saturation }, uWarm: { value: new THREE.Vector3(...S.warm) }, uLift: { value: S.lift },
        uWidth: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear, uFar, uInkStrength, uThreshold, uSat, uLift, uWidth;
        uniform vec3 uInk, uWarm; uniform vec2 uFade;
        varying vec2 vUv;
        float viewZ(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, uNear, uFar); }
        void main(){
          vec4 c = texture2D(tColor, vUv);
          vec2 o = uTexel * uWidth;
          float z0 = viewZ(vUv);
          float zl = viewZ(vUv - vec2(o.x, 0.0)), zr = viewZ(vUv + vec2(o.x, 0.0));
          float zd = viewZ(vUv - vec2(0.0, o.y)), zu = viewZ(vUv + vec2(0.0, o.y));
          float w0 = 1.0 / z0;
          float lap = abs(1.0/zl + 1.0/zr - 2.0*w0) + abs(1.0/zu + 1.0/zd - 2.0*w0);
          float zmin = min(z0, min(min(zl, zr), min(zu, zd)));
          // past ~40 m the threshold rises with distance: real silhouettes still ink, but small depth steps (LOD
          // crossfade dither, roof tiles) don't sparkle as the camera moves
          float thr = uThreshold * (1.0 + max(0.0, zmin - 40.0) / 40.0);
          float e = smoothstep(thr, thr * 2.2, lap / w0);
          e *= 1.0 - smoothstep(uFade.x, uFade.y, zmin);
          e *= step(zmin, uFar * 0.98);
          // town LOD crossfade / spawn dissolve pixels are tagged alpha 0.5: no ink in or right next to them
          float tag = 0.0;
          for (int i = 0; i < 5; i++) {
            vec2 oo = i == 0 ? vec2(0.0) : i == 1 ? vec2(o.x, 0.0) : i == 2 ? vec2(-o.x, 0.0) : i == 3 ? vec2(0.0, o.y) : vec2(0.0, -o.y);
            float a = texture2D(tColor, vUv + oo).a;
            tag = max(tag, 1.0 - step(0.05, abs(a - 0.5)));
          }
          e *= 1.0 - tag;
          vec3 col = c.rgb;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat) * uWarm + uLift;
          col = mix(col, uInk * (0.35 + 0.65 * min(l, 1.0)), e * uInkStrength);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    }));
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number, dpr: number): void {
    const W = Math.max(1, Math.floor(w * dpr)), H = Math.max(1, Math.floor(h * dpr));
    this.rt.setSize(W, H);
    this.size.set(W, H);
    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / W, 1 / H);
    u.uWidth.value = Math.max(1, Math.round(dpr * 0.85));
  }

  /** Render `scene` through the outline/grade pass (or straight to screen when disabled). */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    const pc = camera as THREE.PerspectiveCamera;
    const u = this.quad.material.uniforms;
    u.uNear.value = pc.near; u.uFar.value = pc.far;
    // keep renderer.info counting the whole frame (scene + quad), not just the last call
    const info = r.info, ar = info.autoReset; info.autoReset = false; info.reset();
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    const auto = r.autoClear; r.autoClear = false;
    r.render(this.quad, this.cam);
    r.autoClear = auto; info.autoReset = ar;
  }

  dispose(): void { this.rt.dispose(); this.quad.geometry.dispose(); this.quad.material.dispose(); }
}
