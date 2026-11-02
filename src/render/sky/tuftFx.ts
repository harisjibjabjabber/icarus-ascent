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
        float d = min(vUv.y, 1.0 - vUv.y);
        vec3 ink = vec3(0.34, 0.18, 0.11);
        vec3 cream = vec3(${CREAM.r.toFixed(4)}, ${CREAM.g.toFixed(4)}, ${CREAM.b.toFixed(4)});
        vec3 white = vec3(${WHITE.r.toFixed(4)}, ${WHITE.g.toFixed(4)}, ${WHITE.b.toFixed(4)});
        vec3 col = mix(ink, cream, smoothstep(0.0, 0.14, d));
        col = mix(col, white, smoothstep(0.14, 0.42, d));
        float scroll = fract(vUv.x * 4.0 - uTime * 0.55);
        float gleam = smoothstep(0.46, 0.5, scroll) * smoothstep(0.58, 0.5, scroll);
        col += vec3(0.16) * gleam * smoothstep(0.18, 0.4, d);
        float edge = smoothstep(0.0, 0.035, d);
        float ends = smoothstep(0.0, 0.02, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
        gl_FragColor = vec4(col, 0.4 * edge * ends);
      }`,
  });
  return ribbonMat;
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
 * One grate and its column. The column rises 10 m and leans a few metres
 * forward, so it stacks as a column down the street and still wraps Ao
 * while the gust lifts her.
 */
export class TuftFx {
  readonly group = new THREE.Group();
  private clouds: { mesh: THREE.InstancedMesh; motes: Mote[] }[] = [];
  private dust: THREE.Mesh;
  private dustB: THREE.Mesh;
  private dustMat: THREE.MeshBasicMaterial;
  private dustMatB: THREE.MeshBasicMaterial;
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
    const rise = 10;
    this.origin = place(x, streetY, lat0);
    const tip = place(x + 4.2, streetY + rise, lat0);
    const lat = place(x, streetY, lat0 + 1);
    const axis = tip.clone().sub(this.origin);
    this.length = axis.length();
    this.dir = axis.clone().normalize();
    this.side = lat.sub(this.origin).normalize();
    this.bin = new THREE.Vector3().crossVectors(this.dir, this.side).normalize();

    this.grate(place, x, streetY, lat0);
    // Five thin streaks. The column stays inside about 2 m so the street still reads.
    const specs: RibbonSpec[] = [
      { rad0: 0.12, rad1: 1.15, width: 0.07, revs: 0.55, phase: 0.4 },
      { rad0: 0.28, rad1: 1.55, width: 0.055, revs: 0.9, phase: 1.8 },
      { rad0: 0.18, rad1: 1.85, width: 0.08, revs: 1.2, phase: 3.1 },
      { rad0: 0.4, rad1: 1.4, width: 0.06, revs: 0.7, phase: 4.5 },
      { rad0: 0.22, rad1: 1.7, width: 0.075, revs: 1.45, phase: 5.6 },
    ];
    for (const spec of specs) this.addRibbon(spec, ribbons());

    this.clouds.push(this.motes(leafShape(), 6, seed, LEAF, 'sky-tuft-motes', 0.2, 1.55, 0.32, 0.52, 1.3));
    this.clouds.push(this.motes(petalShape(), 5, seed + 90, PETAL, 'sky-tuft-petals', 0.15, 1.35, 0.22, 0.38, 1.6));

    this.dustMat = new THREE.MeshBasicMaterial({ color: '#e4d2b0', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.dustMatB = new THREE.MeshBasicMaterial({ color: '#efe0c4', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.RingGeometry(0.38, 0.52, 28);
    ring.rotateX(-Math.PI / 2);
    this.dust = new THREE.Mesh(ring, this.dustMat);
    this.dust.name = 'sky-tuft-dust';
    this.dust.position.copy(this.origin);
    this.dust.renderOrder = 2;
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    const ringB = new THREE.RingGeometry(0.72, 0.84, 32);
    ringB.rotateX(-Math.PI / 2);
    this.dustB = new THREE.Mesh(ringB, this.dustMatB);
    this.dustB.name = 'sky-tuft-dust';
    this.dustB.position.copy(place(x, streetY + 0.04, lat0));
    this.dustB.renderOrder = 2;
    this.dustB.frustumCulled = false;
    this.group.add(this.dustB);

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
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = t * this.length;
      const ang = spec.phase + t * spec.revs * Math.PI * 2;
      const rad = spec.rad0 + (spec.rad1 - spec.rad0) * t;
      this.point(along, ang, rad, a);
      const ahead = Math.min(this.length, along + 0.3);
      this.point(ahead, spec.phase + ((ahead / this.length) * spec.revs * Math.PI * 2), spec.rad0 + (spec.rad1 - spec.rad0) * (ahead / this.length), tang);
      tang.sub(a);
      if (tang.lengthSq() < 1e-8) tang.copy(this.dir);
      tang.normalize();
      // Width stays across the street, so the chase camera sees the face of the streak
      // and not its edge. Drop any component along the streak itself.
      across.copy(this.side).addScaledVector(tang, -this.side.dot(tang));
      if (across.lengthSq() < 1e-6) across.copy(this.side);
      across.normalize();
      const half = spec.width * (0.82 + 0.18 * Math.sin(ang * 2));
      for (const s of [-1, 1]) {
        const p = a.clone().addScaledVector(across, s * half);
        pos.push(p.x, p.y, p.z);
        nrm.push(this.bin.x, this.bin.y, this.bin.z);
        uv.push(t, s < 0 ? 0 : 1);
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

    this.dust.rotation.y = time * 0.8;
    this.dustB.rotation.y = -time * 0.55;
    this.dustMat.opacity = 0.16 + 0.08 * Math.sin(time * 1.4);
    this.dustMatB.opacity = 0.1 + 0.06 * Math.sin(time * 1.1 + 1);
  }

  dispose(): void {
    this.dustMat.dispose();
    this.dustMatB.dispose();
  }
}
