import * as THREE from 'three';
import { ART_UNIFORMS, toon } from '../materials';
import { GeoBuilder } from '../geo';
import { ROUTE_YAW } from '../space';

/**
 * Ground tuft: a cast-iron grate in the cobbles and a 45° forward column of
 * leaves, petals and dust. Readable from the chase camera well before the catch.
 */

const CREAM = new THREE.Color('#fff8ee');
const LAVENDER = new THREE.Color('#b9b3c9');
const LEAF = ['#86b05c', '#d9a441', '#f2b8c6', '#f7ecd4'];
const IRON = '#3b3440';
const IRON_LIT = '#6e6578';

const ironMat = toon('#ffffff', { vertexColors: true, rim: 0.55 });
const starMat = toon('#d9a441', { emissive: '#a86a18', emissiveIntensity: 0.35 });
const leafMat = toon('#ffffff', { side: THREE.DoubleSide, rim: 0.45 });

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
        float flutter = sin(uv.x * 1.7 + uTime * 2.4) * 0.045 * smoothstep(0.0, 0.25, uv.y);
        p += normal * flutter;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float scroll = vUv.x - uTime * 1.6;
        float band = fract(scroll / 3.0);
        float tone = step(0.5, band);
        vec3 cream = vec3(${CREAM.r.toFixed(4)}, ${CREAM.g.toFixed(4)}, ${CREAM.b.toFixed(4)});
        vec3 lav = vec3(${LAVENDER.r.toFixed(4)}, ${LAVENDER.g.toFixed(4)}, ${LAVENDER.b.toFixed(4)});
        vec3 col = mix(cream, lav, tone);
        float edge = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
        float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
        gl_FragColor = vec4(col, 0.52 * edge * ends);
      }`,
  });
  return ribbonMat;
}

let leafGeo: THREE.BufferGeometry | null = null;
function leafShape(): THREE.BufferGeometry {
  if (leafGeo) return leafGeo;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.16, 0.08, 0.14, 0.28, 0.02, 0.46);
  shape.bezierCurveTo(-0.12, 0.3, -0.14, 0.08, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 3);
  g.computeVertexNormals();
  leafGeo = g;
  return g;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Mote {
  speed: number;
  phase: number;
  swirl: number;
  spin: number;
  scale: number;
  ribbon: number;
}

/**
 * One grate and its column. `place` maps route metres into the parent chunk.
 * The column leans 45° forward: 8 m along the street and 8 m up.
 */
export class TuftFx {
  readonly group = new THREE.Group();
  private leaves: THREE.InstancedMesh;
  private motes: Mote[] = [];
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

  constructor(opts: { place: (x: number, y: number, lat: number) => THREE.Vector3; x: number; streetY: number; seed: number; lat?: number }) {
    this.group.name = 'sky-tuft';
    const { place, x, streetY, seed } = opts;
    const lat0 = opts.lat ?? 0;
    this.origin = place(x, streetY, lat0);
    const tip = place(x + 8, streetY + 8, lat0);
    const lat = place(x, streetY, lat0 + 1);
    const axis = tip.clone().sub(this.origin);
    this.length = axis.length();
    this.dir = axis.clone().normalize();
    this.side = lat.sub(this.origin).normalize();
    this.bin = new THREE.Vector3().crossVectors(this.dir, this.side).normalize();

    this.grate(place, x, streetY, lat0);
    this.addRibbons(seed);
    this.leaves = this.addLeaves(seed);
    this.dustMat = new THREE.MeshBasicMaterial({ color: '#f7ecd4', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.RingGeometry(0.35, 0.85, 28);
    ring.rotateX(-Math.PI / 2);
    this.dust = new THREE.Mesh(ring, this.dustMat);
    this.dust.name = 'sky-tuft-dust';
    this.dust.position.copy(this.origin);
    this.dust.renderOrder = 2;
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffb15a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(place(x, streetY + 0.04, lat0));
    glow.renderOrder = 2;
    this.group.add(glow);

    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), starMat);
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
    gb.add(new THREE.BoxGeometry(2.7, 0.06, 1.05), place(x, y - 0.04, lat0), '#241c22', { rot });
    gb.add(new THREE.BoxGeometry(2.85, 0.08, 0.08), place(x, y, lat0 + 0.52), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(2.85, 0.08, 0.08), place(x, y, lat0 - 0.52), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(0.08, 0.08, 1.12), place(x - 1.38, y, lat0), IRON, { rot, top: IRON_LIT });
    gb.add(new THREE.BoxGeometry(0.08, 0.08, 1.12), place(x + 1.38, y, lat0), IRON, { rot, top: IRON_LIT });
    for (let i = -4; i <= 4; i++) gb.add(new THREE.BoxGeometry(0.045, 0.05, 1.0), place(x + i * 0.28, y + 0.02, lat0), IRON_LIT, { rot, top: '#8d8498' });
    for (let i = -1; i <= 1; i++) gb.add(new THREE.BoxGeometry(2.6, 0.04, 0.04), place(x, y + 0.03, lat0 + i * 0.28), IRON, { rot, top: IRON_LIT });
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
      .addScaledVector(this.bin, Math.sin(ang) * rad * (0.55 + 0.45 * t));
  }

  private addRibbons(seed: number): void {
    const steps = 48;
    const width = 0.34;
    for (let r = 0; r < 3; r++) {
      const phase = (r / 3) * Math.PI * 2 + hash(seed + r) * 0.4;
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
        const ang = phase + (along / 3) * Math.PI * 2;
        const rad = 1.1 + 0.9 * t;
        this.point(along, ang, rad, a);
        if (i > 0) metres += a.distanceTo(prev);
        const ahead = Math.min(this.length, along + 0.25);
        this.point(ahead, ang + 0.12, rad, tang);
        tang.sub(a).normalize();
        across.crossVectors(tang, this.dir).normalize();
        if (across.lengthSq() < 1e-6) across.copy(this.side);
        const half = width * (0.75 + 0.25 * Math.sin(ang * 2));
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
      const mesh = new THREE.Mesh(g, ribbons());
      mesh.name = 'sky-tuft-ribbon';
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  private addLeaves(seed: number): THREE.InstancedMesh {
    const n = 60;
    const geo = leafShape().clone();
    const mesh = new THREE.InstancedMesh(geo, leafMat, n);
    mesh.name = 'sky-tuft-motes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.castShadow = true;
    for (let i = 0; i < n; i++) {
      const speed = 6 + hash(seed + i * 3) * 3;
      this.motes.push({
        speed,
        phase: hash(seed + i * 5) * this.length,
        swirl: 0.6 + hash(seed + i * 7) * 0.8,
        spin: hash(seed + i * 11) * Math.PI * 2,
        scale: 0.55 + hash(seed + i * 13) * 0.7,
        ribbon: i % 3,
      });
      this.color.set(LEAF[i % LEAF.length]);
      mesh.setColorAt(i, this.color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    return mesh;
  }

  update(time: number): void {
    const p = new THREE.Vector3();
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const along = (m.phase + time * m.speed * Math.SQRT2) % (this.length + 1.2);
      if (along > this.length) {
        this.tmp.scale.set(0, 0, 0);
        this.tmp.updateMatrix();
        this.leaves.setMatrixAt(i, this.tmp.matrix);
        continue;
      }
      const ang = (m.ribbon / 3) * Math.PI * 2 + (along / 3) * Math.PI * 2 + time * 0.8;
      const rad = 1.1 + 0.9 * (along / this.length) + Math.sin(time * 2 + m.spin) * m.swirl * 0.15;
      this.point(along, ang, rad, p);
      this.tmp.position.copy(p);
      this.tmp.scale.setScalar(m.scale * (0.85 + 0.15 * Math.sin(time * 3 + m.spin)));
      this.tmp.rotation.set(m.spin + time * 1.4, ang, time * 0.6 + m.spin);
      this.tmp.updateMatrix();
      this.leaves.setMatrixAt(i, this.tmp.matrix);
    }
    this.leaves.instanceMatrix.needsUpdate = true;

    const cycle = 0.8;
    const u = (time % cycle) / cycle;
    const s = 0.6 + u * 2.4;
    this.dust.scale.set(s, s, s);
    this.dustMat.opacity = 0.38 * (1 - u);

    for (let i = 0; i < this.stars.length; i++) {
      const along = this.length * (0.72 + i * 0.09);
      const ang = time * 0.7 + i * 2.1;
      this.point(along, ang, 0.35, p);
      p.y += Math.sin(time * 2 + i) * 0.08;
      this.stars[i].position.copy(p);
      this.stars[i].rotation.y = time * 0.8 + i;
    }
    this.glowMat.opacity = 0.42 + 0.12 * Math.sin(time * 3.2);
  }

  dispose(): void {
    this.dustMat.dispose();
    this.glowMat.dispose();
  }
}
