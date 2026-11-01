import * as THREE from 'three';

/**
 * One full-screen pass after the scene: a depth-based ink outline (replaces per-mesh inverted hulls, which
 * blacked out window openings and doubled draw calls) and a gentle colour grade matched to Ao's MToon look.
 * The scene renders into a half-float target (MSAA where the device has it) with a depth texture; the quad
 * applies tone mapping and the sRGB transfer itself (three skips both when rendering to a target).
 *
 * Edges come from the Laplacian of inverse view depth, which is exactly zero on any plane, so ground seen at
 * a grazing angle stays clean while silhouettes and creases ink. Lines fade with distance into the haze.
 *
 * Hi-fi extras (per quality tier):
 *  - soft bloom (high/ultra): bright pass at quarter resolution + two separable blur rounds, added before tone mapping,
 *    so sunlit plaster, sparks and the sky glow bleed softly like a painted highlight (4 extra small passes);
 *  - ambient occlusion (ultra): 8 taps in the composite against the *plane-predicted* depth (flat ground and walls get
 *    none; only creases, eaves, doorways and contact under props darken), tinted lavender rather than grey;
 *  - grade: split-tone (cool lavender shadows, warm highlights) and a soft contrast curve.
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
  /** Split tone: shadow tint, highlight tint, amount. */
  shadowTint: '#8f86c4', highTint: '#ffe6c2', split: 0.07,
  /** Soft S-curve amount (0 = off). */
  contrast: 0.06,
  bloomThreshold: 0.95, bloomKnee: 0.45, bloomStrength: 0.22,
  aoRadius: 0.55, aoStrength: 0.55, aoTint: '#7c72a8', aoFar: 70,
};

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class PostPass {
  enabled = true;
  private rt: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  private bloomOn = false;
  private bA: THREE.WebGLRenderTarget;
  private bB: THREE.WebGLRenderTarget;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private fsq: THREE.Mesh;

  constructor(private renderer: THREE.WebGLRenderer, samples = 4) {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.bA = mk(); this.bB = mk();
    const S = POST_STYLE;
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2() }, uThr: { value: S.bloomThreshold }, uKnee: { value: S.bloomKnee } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThr, uKnee; varying vec2 vUv;
        void main(){
          // 4 bilinear taps = a 4x4 box from the full-res HDR target (stable, no shimmer on the quarter-res grid)
          vec3 c = (texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
                  + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
          float w = max(soft, br - uThr) / max(br, 1e-4);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          // 9-tap gaussian folded into 5 bilinear fetches
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
          c += (texture2D(tSrc, vUv + uDir * 1.384615).rgb + texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
          c += (texture2D(tSrc, vUv + uDir * 3.230769).rgb + texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.fsq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.fsq.frustumCulled = false;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, tBloom: { value: this.bA.texture },
        uTexel: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uInk: { value: new THREE.Color(S.ink) }, uInkStrength: { value: S.inkStrength }, uThreshold: { value: S.threshold },
        uFade: { value: new THREE.Vector2(S.fadeNear, S.fadeFar) }, uSat: { value: S.saturation }, uWarm: { value: new THREE.Vector3(...S.warm) }, uLift: { value: S.lift },
        uWidth: { value: 1 },
        uShadowTint: { value: new THREE.Color(S.shadowTint) }, uHighTint: { value: new THREE.Color(S.highTint) }, uSplit: { value: 0 }, uContrast: { value: 0 },
        uBloom: { value: S.bloomStrength },
        uAoRadius: { value: S.aoRadius }, uAoStrength: { value: S.aoStrength }, uAoTint: { value: new THREE.Color(S.aoTint) }, uAoFar: { value: S.aoFar }, uFocal: { value: 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom;
        uniform vec2 uTexel; uniform float uNear, uFar, uInkStrength, uThreshold, uSat, uLift, uWidth;
        uniform vec3 uInk, uWarm; uniform vec2 uFade;
        uniform vec3 uShadowTint, uHighTint; uniform float uSplit, uContrast, uBloom;
        uniform float uAoRadius, uAoStrength, uAoFar, uFocal; uniform vec3 uAoTint;
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
          #ifdef USE_AO
          if (z0 < uAoFar) {
            // inverse depth is linear in screen space on a plane: predict each tap from the local gradient, count taps
            // that sit clearly in front of that plane (a crease or an overhang), ignore big jumps (other objects)
            vec2 g = vec2(1.0/zr - 1.0/zl, 1.0/zu - 1.0/zd) * 0.5 / uWidth;
            float rpx = clamp(uAoRadius * uFocal / z0, 3.0, 48.0);
            float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            float occ = 0.0;
            for (int i = 0; i < 8; i++) {
              float fi = (float(i) + 0.5) / 8.0, a = ang + float(i) * 2.3999632;
              vec2 off = vec2(cos(a), sin(a)) * rpx * sqrt(fi);
              float zs = viewZ(vUv + off * uTexel);
              float zp = 1.0 / max(1e-4, w0 + dot(g, off));
              float dz = zp - zs;
              occ += smoothstep(0.03 * z0 * 0.05 + 0.04, 0.25, dz) * (1.0 - smoothstep(uAoRadius * 1.5, uAoRadius * 4.0, dz));
            }
            float ao = clamp(occ / 8.0, 0.0, 1.0) * uAoStrength * (1.0 - smoothstep(uAoFar * 0.6, uAoFar, z0)) * (1.0 - tag);
            col *= mix(vec3(1.0), uAoTint * 1.15, ao);
          }
          #endif
          #ifdef USE_BLOOM
          col += texture2D(tBloom, vUv).rgb * uBloom;
          #endif
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat) * uWarm + uLift;
          // split tone: lavender into the shadows, warm into the lights (painted, not grey)
          float ln = clamp(l, 0.0, 1.0);
          col *= mix(vec3(1.0), mix(uShadowTint, uHighTint, smoothstep(0.15, 0.75, ln)) * 1.12, uSplit);
          // soft S-curve around mid grey (applied pre tone map on 0..1, leaves HDR highlights to the tone mapper)
          vec3 cc = clamp(col, 0.0, 1.0);
          col += (cc * cc * (3.0 - 2.0 * cc) - cc) * uContrast;
          col = mix(col, uInk * (0.35 + 0.65 * min(l, 1.0)), e * uInkStrength);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    }));
    this.quad.frustumCulled = false;
    this.variants.set('00', this.quad.material);
  }

  /**
   * One composite material per bloom/AO combination, all sharing one uniforms object: a tier switch swaps the
   * material (a program that `prewarm` already compiled) instead of changing defines (a synchronous recompile).
   */
  private variants = new Map<string, THREE.ShaderMaterial>();
  private variant(bloom: boolean, ao: boolean): THREE.ShaderMaterial {
    const key = `${+bloom}${+ao}`;
    let m = this.variants.get(key);
    if (!m) {
      const base = this.variants.get('00')!;
      const defines: Record<string, string> = {};
      if (bloom) defines.USE_BLOOM = '';
      if (ao) defines.USE_AO = '';
      m = new THREE.ShaderMaterial({ uniforms: base.uniforms, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader, defines, depthTest: false, depthWrite: false, toneMapped: true });
      this.variants.set(key, m);
    }
    return m;
  }

  /** Tier switches: bloom (high/ultra), AO (ultra), split-tone grade + contrast (medium and up). */
  configure(opts: { bloom: boolean; ao: boolean; grade: boolean }): void {
    this.bloomOn = opts.bloom;
    const m = this.quad.material = this.variant(opts.bloom, opts.ao);
    m.uniforms.uSplit.value = opts.grade ? POST_STYLE.split : 0;
    m.uniforms.uContrast.value = opts.grade ? POST_STYLE.contrast : 0;
  }

  /**
   * Colour grade warmth / saturation (time of day). Writes the uniforms every composite variant shares: no recompile,
   * no material swap. Defaults are POST_STYLE's.
   */
  setGrade(warm: readonly [number, number, number] = POST_STYLE.warm, sat = POST_STYLE.saturation): void {
    const u = this.quad.material.uniforms;
    (u.uWarm.value as THREE.Vector3).set(warm[0], warm[1], warm[2]);
    u.uSat.value = sat;
  }

  /**
   * Compile the given composite variants (and the bloom passes) off the critical path: `compileAsync` uses
   * KHR_parallel_shader_compile where available, so a later tier switch finds its program ready. Best-effort.
   */
  prewarm(combos: { bloom: boolean; ao: boolean }[]): Promise<void> {
    const r = this.renderer;
    if (r.getContext().isContextLost()) return Promise.resolve();
    const prev = r.getRenderTarget();
    const mk = (mat: THREE.Material) => { const o = new THREE.Mesh(this.quad.geometry, mat); o.frustumCulled = false; return o; };
    const jobs: Promise<unknown>[] = [];
    const compile = (g: THREE.Object3D) => jobs.push(typeof r.compileAsync === 'function' ? r.compileAsync(g, this.cam) : Promise.resolve(r.compile(g, this.cam)));
    try {
      // programs depend on the target (tone mapping / output transfer only on screen): compile each where it renders
      const onScreen = new THREE.Group();
      for (const c of combos) onScreen.add(mk(this.variant(c.bloom, c.ao)));
      r.setRenderTarget(null); compile(onScreen);
      if (combos.some((c) => c.bloom)) { const off = new THREE.Group(); off.add(mk(this.brightMat), mk(this.blurMat)); r.setRenderTarget(this.bA); compile(off); }
    } catch { /* precompile is best-effort */ }
    r.setRenderTarget(prev);
    return Promise.all(jobs).then(() => {}, () => {});
  }

  setSize(w: number, h: number, dpr: number): void {
    const W = Math.max(1, Math.floor(w * dpr)), H = Math.max(1, Math.floor(h * dpr));
    this.rt.setSize(W, H);
    this.size.set(W, H);
    const bw = Math.max(1, Math.floor(W / 4)), bh = Math.max(1, Math.floor(H / 4));
    this.bA.setSize(bw, bh); this.bB.setSize(bw, bh);
    this.brightMat.uniforms.uTexel.value.set(1 / W, 1 / H);
    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / W, 1 / H);
    u.uWidth.value = Math.max(1, Math.round(dpr * 0.85));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.fsq.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsq, this.cam);
  }

  /** Render `scene` through the outline/grade pass (or straight to screen when disabled). */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    const pc = camera as THREE.PerspectiveCamera;
    const u = this.quad.material.uniforms;
    u.uNear.value = pc.near; u.uFar.value = pc.far;
    u.uFocal.value = this.size.y / (2 * Math.tan(THREE.MathUtils.degToRad(pc.fov ?? 50) / 2));
    // keep renderer.info counting the whole frame (scene + quad), not just the last call
    const info = r.info, ar = info.autoReset; info.autoReset = false; info.reset();
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    const auto = r.autoClear;
    if (this.bloomOn) {
      this.pass(this.brightMat, this.bA);
      const bu = this.blurMat.uniforms, tx = 1 / this.bA.width, ty = 1 / this.bA.height;
      for (const k of [1, 2]) {
        bu.tSrc.value = this.bA.texture; bu.uDir.value.set(tx * k, 0); this.pass(this.blurMat, this.bB);
        bu.tSrc.value = this.bB.texture; bu.uDir.value.set(0, ty * k); this.pass(this.blurMat, this.bA);
      }
    }
    r.setRenderTarget(null);
    r.autoClear = false;
    r.render(this.quad, this.cam);
    r.autoClear = auto; info.autoReset = ar;
  }

  dispose(): void {
    this.rt.dispose(); this.bA.dispose(); this.bB.dispose();
    this.quad.geometry.dispose(); for (const m of this.variants.values()) m.dispose(); this.fsq.geometry.dispose(); this.brightMat.dispose(); this.blurMat.dispose();
  }
}
