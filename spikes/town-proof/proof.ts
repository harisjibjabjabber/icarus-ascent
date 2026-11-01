// Town asset proof (sourcing phase, NOT game code): drops premade CC0 kit pieces, a premade broom and a
// painted backdrop into the live game scene around Ao, so we can judge them from the real chase camera.
// Loaded by scripts/town-proof.mjs via the vite dev server: import('/spikes/town-proof/proof.ts').
// variant 'orig'  = kit pieces + broom with their ORIGINAL materials (PBR textures as shipped)
// variant 'retex' = our retexture pipeline: painted tileable maps / gradient-mapped trims, palette-swapped
//                   broom atlas, shared toon ramp + rim, inverted-hull outline, warm haze fog.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toon } from '/src/render/materials.ts';
import { toScene } from '/src/render/space.ts';

const A = '/spikes/town-proof/assets/';
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const load = (p: string) => { if (!cache.has(p)) cache.set(p, loader.loadAsync(A + p).then((g) => g.scene)); return cache.get(p)!; };
const texL = new THREE.TextureLoader();
const tex = (p: string, rep = 1) => { const t = texL.load(A + p); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// ---------- retexture pipeline ----------
const PAINTED = () => ({ plaster: tex('painted/plaster.jpg'), wood: tex('painted/wood.jpg'), cobbles: tex('painted/cobbles.jpg') });
let P: ReturnType<typeof PAINTED>;
/** gradient-map: keep the source texture's luminance (its modelled detail) but recolour it through a 2-stop palette */
function gradMap(src: THREE.Texture | null, dark: string, light: string, outlineW = 0): THREE.Material {
  const m = toon('#ffffff');
  m.map = src;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uDark = { value: new THREE.Color(dark) }; sh.uniforms.uLight = { value: new THREE.Color(light) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uDark; uniform vec3 uLight;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sc = texture2D(map, vMapUv); float l = smoothstep(0.08, 0.75, dot(sc.rgb, vec3(0.3, 0.59, 0.11)));
        diffuseColor.rgb *= mix(uDark, uLight, l);
      #endif`);
  };
  m.userData.ow = outlineW;
  return m;
}
function painted(map: THREE.Texture, tint = '#ffffff'): THREE.Material { const m = toon(tint); m.map = map; return m; }
const PLASTER_TINTS = ['#fff6e8', '#ffe2bf', '#ffd2b8', '#fff0d0', '#e8f0ff', '#ffe9d6'];
function retexMaterial(name: string, houseIx: number): THREE.Material | null {
  if (/wear/i.test(name)) name = 'MI_WoodTrim_Wear';
  (window as any).__matNames = ((window as any).__matNames ?? new Set()).add(name);
  switch (name) {
    case 'MI_Plaster': return painted(P.plaster, PLASTER_TINTS[houseIx % PLASTER_TINTS.length]);
    case 'MI_RoundTiles': return null; // keep source map, gradient-mapped below
    case 'MI_WoodTrim': return gradMap(P.wood, '#5a3a2a', '#c89a6a');
    case 'MI_WoodTrim_Wear': { const c = [['#2f6d68', '#9ad8c4'], ['#2e5a86', '#9cc4e8'], ['#4d7a3a', '#bcd88a']][houseIx % 3]; return gradMap(P.wood, c[0], c[1]); } // painted shutters
    default: return null;
  }
}
const GRAD: Record<string, [string, string]> = {
  MI_RoundTiles: ['#8a3a2a', '#f08a58'], MI_Brick: ['#7d6a74', '#e8d8c4'], MI_RockTrim: ['#7d6e80', '#e6d8c8'],
  MI_UnevenBrick: ['#7d6e80', '#eadcc8'], MI_MetalOrnaments: ['#2a2430', '#5a5060'],
};
const OUT_MAT = new THREE.ShaderMaterial({
  uniforms: { uW: { value: 0.012 }, uC: { value: new THREE.Color('#4a3428') } },
  vertexShader: `uniform float uW; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal);
    mv.xyz += n * uW * clamp(-mv.z / 15.0, 1.0, 3.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uC; void main() { gl_FragColor = vec4(uC, 1.0); }`, side: THREE.BackSide,
});
function retex(root: THREE.Object3D, houseIx: number, outlineW = 0.03): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const sm = m as THREE.MeshStandardMaterial;
      const r = retexMaterial(sm.name, houseIx);
      if (r) return r;
      const g = GRAD[sm.name]; if (g) return gradMap(sm.map, g[0], g[1]);
      const t = toon(sm.color ?? '#ffffff'); t.map = sm.map ?? null; t.transparent = sm.transparent; t.alphaTest = sm.alphaTest; t.side = sm.side; return t;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
    if (outlineW > 0 && !mats.some((m) => m.name === 'MI_Plaster' || (m as THREE.MeshStandardMaterial).transparent || (m as THREE.MeshStandardMaterial).alphaTest > 0)) {
      const o = new THREE.Mesh(mesh.geometry, OUT_MAT); o.userData.outline = true; mesh.add(o);
    }
  }
}

// ---------- kit assembly (placement of premade pieces only) ----------
async function piece(name: string, dir = 'mvm/'): Promise<THREE.Object3D> { return (await load(dir + name + '.gltf')).clone(true); }
/** a 4x4 m house from the Quaternius kit: `floors` storeys of 2 wall panels per side + round-tile roof + chimney */
async function house(ix: number, floors: number, doorSide: number): Promise<THREE.Group> {
  const g = new THREE.Group();
  const sides = [[0, 2, 0], [Math.PI, -2, 0], [Math.PI / 2, 0, 2], [-Math.PI / 2, 0, -2]] as const; // [rotY, offset along local z]
  for (let f = 0; f < floors; f++) {
    for (let s = 0; s < 4; s++) {
      for (const k of [-1, 1]) {
        const ground = f === 0;
        let n = ground ? 'Wall_UnevenBrick_Straight' : 'Wall_Plaster_Window_Wide_Round';
        if (ground && s === doorSide && k === 1) n = 'Wall_Plaster_Door_Round';
        else if (ground && (ix + s + k) % 3 === 0) n = 'Wall_UnevenBrick_Window_Wide_Round';
        else if (!ground && (ix + s * 3 + k + f) % 4 === 0) n = 'Wall_Plaster_Window_Thin_Round';
        else if (!ground && (ix + s + k + f) % 5 === 0) n = 'Wall_Plaster_Straight';
        const w = await piece(n);
        const [ry] = sides[s];
        const holder = new THREE.Group(); holder.rotation.y = ry; holder.add(w);
        w.position.set(k, f * 3.12, 1.91);
        g.add(holder);
        if (n.includes('Window_Wide')) { const sh = await piece('WindowShutters_Wide_Round_Open'); sh.position.copy(w.position); holder.add(sh); }
        if (n.includes('Window_Thin')) { const sh = await piece('WindowShutters_Thin_Round_Open'); sh.position.copy(w.position); holder.add(sh); }
        if (!ground && s === 0 && k === -1 && f === 1 && ix % 2 === 0) { const b = await piece('Balcony_Simple_Straight'); b.position.copy(w.position); holder.add(b); }
        if (ground && (ix + s) % 4 === 1 && k === -1) { const v = await piece(ix % 2 ? 'Prop_Vine1' : 'Prop_Vine4'); v.position.copy(w.position).add(new THREE.Vector3(0, 0, 0.12)); holder.add(v); }
      }
    }
  }
  const roof = await piece('Roof_RoundTiles_4x4'); roof.position.y = floors * 3.12; g.add(roof);
  const ch = await piece('Prop_Chimney'); ch.position.set(1, floors * 3.12 + 0.6, 1); g.add(ch);
  return g;
}

export interface ProofOpts { variant: 'orig' | 'retex'; broom: 'ours' | 'premade' | 'none'; ahead?: number }
export async function install(ic: any, opts: ProofOpts): Promise<object> {
  P = PAINTED();
  const v = ic.game.view, course = ic.game.view.courseView.course, s = ic.game.sim.state;
  // hide the Greek sky track's scenery + course art (sim/collision untouched; this is a look-only proof)
  v.courseView.group.visible = false;
  for (const c of v.env.group.children) c.visible = false;
  for (const o of v.scene.children) if (o !== v.env.group && o !== v.rider.root && !(o as THREE.Light).isLight && o !== v.rig.camera && o.type !== 'Object3D') { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.InstancedMesh).isInstancedMesh) o.visible = false; }
  const proof = new THREE.Group(); proof.name = 'townProof'; v.env.group.add(proof);
  const retexOn = opts.variant === 'retex';
  v.scene.fog = retexOn ? new THREE.Fog('#cfe2ee', 40, 260) : new THREE.Fog('#dfe8f0', 80, 600);
  v.scene.background = new THREE.Color(retexOn ? '#5d9fd6' : '#8fb8e0');

  const gy = (x: number, prev: number) => { const g = course.groundBelow(x, 1e6); return g ? g.sample.y : prev; };
  const x0 = s.x - 25, x1 = s.x + (opts.ahead ?? 140);
  // cobbled street ribbon following the real (hidden) ground profile
  const W = 7, pts: number[] = [], uvs: number[] = [], idx: number[] = [];
  let y = s.y, n = 0;
  for (let x = x0; x <= x1; x += 0.5, n++) {
    y = gy(x, y);
    const a = toScene(x, y - 0.02, -W / 2), b = toScene(x, y - 0.02, W / 2);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z); uvs.push(0, (x - x0) / 1.5, W / 1.5, (x - x0) / 1.5);
    if (n) { const i = (n - 1) * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); sg.setIndex(idx); sg.computeVertexNormals();
  const streetMat = retexOn ? painted(P.cobbles, '#fff4ea') : new THREE.MeshStandardMaterial({ map: (await piece('Floor_UnevenBrick').catch(() => null)) ? null : null, color: '#9a9a9a', roughness: 1 });
  if (!retexOn) { const t = texL.load(A + 'mvm/T_UnevenBrick_BaseColor.png'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; (streetMat as THREE.MeshStandardMaterial).map = t; (streetMat as THREE.MeshStandardMaterial).color.set('#ffffff'); }
  // broad base under the houses (no sky showing through beside the street)
  const base = new THREE.Mesh(new THREE.PlaneGeometry(60, x1 - x0 + 60), retexOn ? painted(P.cobbles, '#d8c8c0') : new THREE.MeshStandardMaterial({ color: '#8a8478' }));
  base.rotation.x = -Math.PI / 2; base.position.copy(toScene((x0 + x1) / 2, s.y - 0.6, 0)); proof.add(base);
  if (retexOn) { const bm = (base.material as THREE.MeshToonMaterial).map!.clone(); bm.repeat.set(14, 60); bm.needsUpdate = true; (base.material as THREE.MeshToonMaterial).map = bm; }
  const street = new THREE.Mesh(sg, streetMat); street.receiveShadow = true; proof.add(street);
  if (sg.attributes.normal.getY(0) < 0) (streetMat as THREE.Material).side = THREE.DoubleSide;

  // houses lining the street: dense on the far side (rider's right), sparse + set back on the camera side
  let hi = 0; const tasks: Promise<void>[] = [];
  for (let x = x0 + 2; x < x1; x += 4.6) {
    for (const side of [1, -1]) {
      const ix = hi++, floors = 2 + ((ix * 7) % 3 === 0 ? 1 : 0);
      const lat = side * (W / 2 + 2.6 + (ix % 2) * 0.6) + (side === -1 ? -0.4 : 0);
      const gx = gy(x, s.y);
      tasks.push(house(ix, floors, side === 1 ? 3 : 2).then((h) => {
        h.position.copy(toScene(x, gx - 0.1 - (ix % 3) * 0.4, lat)); h.rotation.y = 0;
        if (retexOn) retex(h, ix); proof.add(h);
      }));
    }
  }
  // trees and props
  const props: [string, string, number, number, number][] = [];
  for (let x = x0 + 6; x < x1; x += 17) props.push(['nature/', x % 2 ? 'CommonTree_1' : 'CommonTree_3', x, 9.5, 1.1]);
  for (let x = x0 + 10; x < x1; x += 13) props.push(['mvm/', 'Prop_Crate', x, -W / 2 + 0.7, 0.9], ['nature/', 'Bush_Common_Flowers', x + 3, W / 2 + 0.6, 0.8]);
  for (const [d, nme, x, lat, sc] of props) tasks.push(piece(nme, d).then((o) => { o.position.copy(toScene(x, gy(x, s.y), lat)); o.scale.setScalar(sc); if (retexOn) retex(o, Math.floor(x)); proof.add(o); }));
  await Promise.all(tasks);

  // painted backdrop card far ahead, horizon at camera height (retex: our painted panorama; orig: plain sky)
  if (retexOn) {
    const bt = texL.load(A + 'painted/backdrop.jpg'); bt.colorSpace = THREE.SRGBColorSpace;
    const Hc = 300, Wc = Hc * 16 / 9;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(Wc, Hc), new THREE.MeshBasicMaterial({ map: bt, fog: false, depthWrite: false }));
    const camY = v.rig.camera.position.y;
    const p = toScene(s.x + 380, 0, 0); p.y = camY + (0.5 - 0.37) * Hc - 48;
    card.position.copy(p); card.lookAt(toScene(s.x, 0, 0).setY(p.y)); card.renderOrder = -10;
    proof.add(card);
  }

  // broom swap: premade witch broom bound to the deck group (IK still plants on the same deck)
  const br = v.rider.broom;
  if (opts.broom !== 'ours') {
    br.group.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) o.visible = false; });
  }
  if (opts.broom === 'premade') {
    const src = (await load('broom/minipoly-witch-broom.glb')).getObjectByProperty('isMesh', true) as THREE.Mesh;
    const geo = src.geometry.clone();
    // the mesh lies diagonally in its own space (bristles at the origin, handle along +x+z): point the handle to +X (nose)
    const d = new THREE.Vector3(0.0122, 0, 0.0132).normalize();
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(d, new THREE.Vector3(1, 0, 0)));
    geo.computeBoundingBox(); const bb = geo.boundingBox!; const len = bb.max.x - bb.min.x, sc = 2.75 / len;
    geo.translate(-bb.min.x, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2); geo.scale(sc, sc * 0.62, sc * 0.62); geo.translate(-1.5, 0.0, 0);
    let mat: THREE.Material;
    if (retexOn) { const t = texL.load(A + 'broom/minipoly-witch-broom-palette-retex.png'); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; const m = toon('#ffffff', { rim: 2 }); m.map = t; mat = m; }
    else mat = src.material as THREE.Material;
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.name = 'premadeBroom';
    if (retexOn) { const o = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color('#3a2414') } }, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.014, 1.0); }', fragmentShader: 'uniform vec3 uC; void main(){ gl_FragColor = vec4(uC,1.0); }', side: THREE.BackSide })); mesh.add(o); }
    br.group.add(mesh);
  }
  return { houses: hi, bbox: null };
}
