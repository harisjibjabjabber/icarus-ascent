import * as THREE from 'three';
import { ART_UNIFORMS, toon } from '../materials';
import { GeoBuilder } from '../geo';
import { ROUTE_YAW } from '../space';

/**
 * Ground tuft: a grate and a column of wind the chase camera can read from
 * 60 m. Cream and white ribbons spiral 8–10 m up, with leaves and petals
 * inside them and a dust ring on the grate. The same column is what wraps
 * Ao while the gust lifts her.
 */

const CREAM = new THREE.Color('#fff6e4');
const WHITE = new THREE.Color('#fffefb');
const LEAF = ['#86b05c', '#5f8f4a', '#d9a441', '#c4d86a'];
const PETAL = ['#fff8ee', '#ffffff', '#f2b8c6', '#f7ecd4'];
const IRON = '#3b3440';
const IRON_LIT = '#6e6578';

const ironMat = toon('#ffffff', { vertexColors: true, rim: 0.55 });
const starMat = toon('#d9a441', { emissive: '#a86a18', emissiveIntensity: 0.45 });
const leafMat = toon('#ffffff', { side: THREE.DoubleSide, rim: 0.55 });

let ribbonMat: THREE.ShaderMaterial | null = null;
function ribbons(): THREE.ShaderMaterial {
  if (ribbonMat) return ribbonMat;
  ribbonMat = new THREE.ShaderMaterial({
    uniforms: { uTime: ART_UNIFORMS.uTime },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float flutter = sin(uv.x * 2.4 - uTime * 3.2) * 0.14 * smoothstep(0.0, 0.2, uv.y);
        p += normal * flutter;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
        vec3 cream = vec3(${CREAM.r.toFixed(4)}, ${CREAM.g.toFixed(4)}, ${CREAM.b.toFixed(4)});
        vec3 white = vec3(${WHITE.r.toFixed(4)}, ${WHITE.g.toFixed(4)}, ${WHITE.b.toFixed(4)});
        vec3 col = mix(cream, white, smoothstep(0.15, 0.85, core));
        float scroll = fract(vUv.x * 0.35 - uTime * 0.55);
        float gleam = smoothstep(0.46, 0.5, scroll) * smoothstep(0.58, 0.5, scroll);
        col += vec3(0.18) * gleam;
        float edge = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        float ends = smoothstep(0.0, 0.015, vUv.x) * smoothstep(1.0, 0.975, vUv.x);
        gl_FragColor = vec4(col, 0.92 * edge * ends);
      }`,
  });
  return ribbonMat;
}

let hazeMat: THREE.ShaderMaterial | null = null;
function haze(): THREE.ShaderMaterial {
  if (hazeMat) return hazeMat;
  hazeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: ART_UNIFORMS.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p += normal * sin(uv.x * 1.4 + uTime * 1.6) * 0.08;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        gl_FragColor = vec4(1.0, 0.97, 0.9, 0.42 * edge * ends);
      }`,
  });
  return hazeMat;
}

function shapeGeo(build: (s: THREE.Shape) => void): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  build(shape);
  const g = new THREE.ShapeGeometry(shape, 4);
  g.computeVertexNormals();
  return g;
}

let leafGeo: THREE.BufferGeometry | null = null;
function leafShape(): THREE.BufferGeometry {
  if (!leafGeo) {
    leafGeo = shapeGeo((shape) => {
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.2, 0.08, 0.18, 0.34, 0.02, 0.52);
      shape.bezierCurveTo(-0.16, 0.34, -0.18, 0.08, 0, 0);
    });
  }
  return leafGeo;
}

let petalGeo: THREE.BufferGeometry | null = null;
function petalShape(): THREE.BufferGeometry {
  if (!petalGeo) {
    petalGeo = shapeGeo((shape) => {
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.26, 0.04, 0.3, 0.2, 0.02, 0.34);
      shape.bezierCurveTo(-0.28, 0.2, -0.24, 0.04, 0, 0);
    });
  }
  return petalGeo;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Mote {
  speed: number;
  phase: number;
  spin: number;
  scale: number;
  rad0: number;
  rad1: number;
  revs: number;
}

interface RibbonSpec { rad0: number; rad1: number; width: number; revs: number; phase: number; }

/**
 * One grate and its column. The column rises 9.5 m and leans forward the
 * same distance, so the gust (which climbs through the middle of it) has
 * streaks around Ao.
 */
export class TuftFx {
  readonly group = new THREE.Group();
  private clouds: { mesh: THREE.InstancedMesh; motes: Mote[] }[] = [];
  private dust: THREE.Mesh;
  private dustMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private stars: THREE.Object3D[] = [];
  private origin: THREE.Vector3;
  private dir: THREE.Vector3;
  private side: THREE.Vector3;
  private bin: THREE.Vector3;
  private length: number;
  private readonly tmp = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly p = new THREE.Vector3();

  constructor(opts: { place: (x: number, y: number, lat: number) => THREE.Vector3; x: number; streetY: number; seed: number; lat?: number }) {
    this.group.name = 'sky-tuft';
    const { place, x, streetY, seed } = opts;
    const lat0 = opts.lat ?? 0;
    const rise = 9.5;
    this.origin = place(x, streetY, lat0);
    const tip = place(x + rise, streetY + rise, lat0);
    const lat = place(x, streetY, lat0 + 1);
    const axis = tip.clone().sub(this.origin);
    this.length = axis.length();
    this.dir = axis.clone().normalize();
    this.side = lat.sub(this.origin).normalize();
    this.bin = new THREE.Vector3().crossVectors(this.dir, this.side).normalize();

    this.grate(place, x, streetY, lat0);
    const specs: RibbonSpec[] = [
      { rad0: 0.35, rad1: 1.15, width: 0.7, revs: 2.4, phase: 0.2 },
      { rad0: 0.55, rad1: 1.45, width: 0.62, revs: 2.1, phase: 2.2 },
      { rad0: 1.3, rad1: 2.8, width: 0.95, revs: 1.6, phase: 0.8 },
      { rad0: 1.7, rad1: 3.5, width: 1.05, revs: 1.35, phase: 2.6 },
      { rad0: 2.0, rad1: 3.3, width: 0.85, revs: 1.8, phase: 4.1 },
      { rad0: 1.15, rad1: 2.6, width: 0.78, revs: 2.6, phase: 5.2 },
    ];
    for (const spec of specs) this.addRibbon(spec, ribbons());
    this.addRibbon({ rad0: 0.2, rad1: 1.6, width: 2.5, revs: 0.35, phase: 0.4 }, haze());

    this.clouds.push(this.motes(leafShape(), 80, seed, LEAF, 'sky-tuft-motes', 0.4, 2.4, 1.7, 3.1, 1.8));
    this.clouds.push(this.motes(petalShape(), 48, seed + 90, PETAL, 'sky-tuft-petals', 0.25, 2.0, 1.5, 2.6, 2.2));

    this.dustMat = new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.RingGeometry(0.55, 2.15, 32);
    ring.rotateX(-Math.PI / 2);
    this.dust = new THREE.Mesh(ring, this.dustMat);
    this.dust.name = 'sky-tuft-dust';
    this.dust.position.copy(this.origin);
    this.dust.renderOrder = 2;
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.85, 20), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(place(x, streetY + 0.05, lat0));
    glow.renderOrder = 2;
    glow.name = 'sky-tuft-glow';
    this.group.add(glow);

    for (let i = 0; i < 4; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), starMat);
      star.name = 'sky-tuft-star';
      star.castShadow = true;
      this.stars.push(star);
      this.group.add(star);
    }
    this.update(0);
  }

  private grate(place: (x: number, y: number, lat: number) => THREE.Vector3, x: number, streetY: number, lat0: number): void {
    const gb = new GeoBuilder();
    const rot: [number, number, number] = [0, ROUTE_YAW, 0];
    const y = streetY + 0.025;
    gb.add(new THREE.BoxGeometry(3.1, 0.06, 1.25), place(x, y - 0.04, lat0), '#241c22', { rot });
    gb.add(new THREE.BoxGeometry(3.25, 0.08, 0.08), place(x, y, lat0 + 0.6), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(3.25, 0.08, 0.08), place(x, y, lat0 - 0.6), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(0.08, 0.08, 1.32), place(x - 1.55, y, lat0), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(0.08, 0.08, 1.32), place(x + 1.55, y, lat0), IRON, { rot, top: IRON_LIT });
    for (let i = -5; i <= 5; i++) gb.add(new THREE.BoxGeometry(0.05, 0.05, 1.15), place(x + i * 0.26, y + 0.02, lat0), IRON_LIT, { rot, top: '#8d8498' });
    for (let i = -1; i <= 1; i++) gb.add(new THREE.BoxGeometry(2.9, 0.04, 0.045), place(x, y + 0.03, lat0 + i * 0.32), IRON, { rot, top: IRON_LIT });
    const built = gb.build();
    if (!built) return;
    const mesh = new THREE.Mesh(built, ironMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'sky-tuft-grate';
    this.group.add(mesh);
  }

  private point(along: number, ang: number, rad: number, out: THREE.Vector3): THREE.Vector3 {
    const t = along / this.length;
    return out.copy(this.origin).addScaledVector(this.dir, along)
      .addScaledVector(this.side, Math.cos(ang) * rad)
      .addScaledVector(this.bin, Math.sin(ang) * rad * (0.65 + 0.35 * t));
  }

  private addRibbon(spec: RibbonSpec, material: THREE.Material): void {
    const steps = 64;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const a = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const tang = new THREE.Vector3();
    const across = new THREE.Vector3();
    let metres = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = t * this.length;
      const ang = spec.phase + t * spec.revs * Math.PI * 2;
      const rad = spec.rad0 + (spec.rad1 - spec.rad0) * t;
      this.point(along, ang, rad, a);
      if (i > 0) metres += a.distanceTo(prev);
      const ahead = Math.min(this.length, along + 0.3);
      this.point(ahead, spec.phase + ((ahead / this.length) * spec.revs * Math.PI * 2), spec.rad0 + (spec.rad1 - spec.rad0) * (ahead / this.length), tang);
      tang.sub(a).normalize();
      across.crossVectors(tang, this.dir).normalize();
      if (across.lengthSq() < 1e-6) across.copy(this.side);
      const half = spec.width * (0.82 + 0.18 * Math.sin(ang * 2));
      for (const s of [-1, 1]) {
        const p = a.clone().addScaledVector(across, s * half);
        pos.push(p.x, p.y, p.z);
        nrm.push(this.bin.x, this.bin.y, this.bin.z);
        uv.push(metres, s < 0 ? 0 : 1);
      }
      if (i > 0) {
        const v = i * 2;
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
      prev.copy(a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'sky-tuft-ribbon';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private motes(geo: THREE.BufferGeometry, n: number, seed: number, colors: string[], name: string, rad0: number, rad1: number, scale0: number, scale1: number, revs: number): { mesh: THREE.InstancedMesh; motes: Mote[] } {
    const mesh = new THREE.InstancedMesh(geo.clone(), leafMat, n);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.castShadow = true;
    const motes: Mote[] = [];
    for (let i = 0; i < n; i++) {
      motes.push({
        speed: 5.5 + hash(seed + i * 3) * 3.5,
        phase: hash(seed + i * 5) * this.length,
        spin: hash(seed + i * 11) * Math.PI * 2,
        scale: scale0 + hash(seed + i * 13) * (scale1 - scale0),
        rad0: rad0 * (0.75 + hash(seed + i * 17) * 0.5),
        rad1,
        revs,
      });
      this.color.set(colors[i % colors.length]);
      mesh.setColorAt(i, this.color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    return { mesh, motes };
  }

  update(time: number): void {
    for (const cloud of this.clouds) {
      const { mesh, motes } = cloud;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const along = (m.phase + time * m.speed) % (this.length + 1.4);
        if (along > this.length) {
          this.tmp.scale.set(0, 0, 0);
          this.tmp.updateMatrix();
          mesh.setMatrixAt(i, this.tmp.matrix);
          continue;
        }
        const t = along / this.length;
        const ang = t * m.revs * Math.PI * 2 + time * 0.7 + m.spin;
        const rad = m.rad0 + (m.rad1 - m.rad0) * t;
        this.point(along, ang, rad, this.p);
        this.tmp.position.copy(this.p);
        this.tmp.scale.setScalar(m.scale * (0.88 + 0.12 * Math.sin(time * 3 + m.spin)));
        this.tmp.rotation.set(m.spin + time * 1.3, ang, time * 0.5 + m.spin);
        this.tmp.updateMatrix();
        mesh.setMatrixAt(i, this.tmp.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const cycle = 0.7;
    const u = (time % cycle) / cycle;
    const s = 0.85 + u * 1.8;
    this.dust.scale.set(s, s, s);
    this.dustMat.opacity = 0.7 * (1 - u * 0.85);
    this.glowMat.opacity = 0.62 + 0.16 * Math.sin(time * 3.2);

    for (let i = 0; i < this.stars.length; i++) {
      const along = this.length * (0.55 + i * 0.1);
      const ang = time * 0.9 + i * 1.7;
      this.point(along, ang, 0.45 + i * 0.15, this.p);
      this.p.y += Math.sin(time * 2 + i) * 0.1;
      this.stars[i].position.copy(this.p);
      this.stars[i].rotation.y = time * 0.8 + i;
    }
  }

  dispose(): void {
    this.dustMat.dispose();
    this.glowMat.dispose();
  }
}
