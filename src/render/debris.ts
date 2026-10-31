import * as THREE from 'three';
import type { Course } from '../course/course';
import { toScene } from './space';
import { toon } from './materials';
import { COURSE_STYLE } from './courseView';

interface Shard { mesh: THREE.Mesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: THREE.Vector3; life: number; max: number; size: number }

/**
 * Break fragments. Simulated in route space (x forward, y up, z lateral) so they
 * travel *with* the collision (inheriting the rider's velocity), bounce on the
 * actual ground and leave the route readable quickly.
 */
export class Debris {
  readonly group = new THREE.Group();
  private shards: Shard[] = [];
  private course: Course | null = null;
  private mats: Record<string, THREE.Material> = {};

  constructor(size = 90) {
    const geos = [new THREE.TetrahedronGeometry(1, 0), new THREE.BoxGeometry(1, 0.6, 0.8), new THREE.DodecahedronGeometry(0.7, 0)];
    this.mats = { pot: toon(COURSE_STYLE.pot), potBand: toon(COURSE_STYLE.potBand), pillar: toon(COURSE_STYLE.pillar), pillarAlt: toon(COURSE_STYLE.pillarAlt) };
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geos[i % geos.length], this.mats.pot);
      m.visible = false; m.castShadow = true;
      this.group.add(m);
      this.shards.push({ mesh: m, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: new THREE.Vector3(), life: 0, max: 1, size: 0.1 });
    }
  }

  setCourse(c: Course): void { this.course = c; this.clear(); }

  clear(): void { for (const s of this.shards) { s.life = 0; s.mesh.visible = false; } }

  burst(kind: 'pot' | 'pillar', x: number, baseY: number, height: number, riderVx: number, riderVy: number, n: number): void {
    const free = this.shards.filter((s) => s.life <= 0);
    for (let i = 0; i < n && i < free.length; i++) {
      const s = free[i];
      const big = kind === 'pillar';
      s.x = x + (Math.random() - 0.5) * 0.4;
      s.y = baseY + Math.random() * height;
      s.z = (Math.random() - 0.5) * (big ? 1.0 : 0.6);
      // directional: carried forward by the collision, fanned up and outward
      s.vx = riderVx * (0.75 + Math.random() * 0.45);
      s.vy = Math.max(0, riderVy) * 0.5 + 1.5 + Math.random() * (big ? 5 : 4);
      s.vz = (Math.random() - 0.5) * (big ? 7 : 6.5);
      s.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      s.size = big ? 0.12 + Math.random() * 0.22 : 0.1 + Math.random() * 0.14;
      s.max = s.life = 0.9 + Math.random() * 0.6;
      const m = s.mesh;
      m.material = kind === 'pot' ? (i % 4 === 0 ? this.mats.potBand : this.mats.pot) : (i % 2 ? this.mats.pillarAlt : this.mats.pillar);
      m.scale.setScalar(s.size);
      m.visible = true;
    }
  }

  update(dt: number): void {
    for (const s of this.shards) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vy -= 24 * dt;
      s.vx *= 1 - 0.6 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const g = this.course?.groundBelow(s.x, s.y + 0.5);
      if (g && s.y < g.sample.y + s.size * 0.5 && Math.abs(s.z) < 1.7) {
        s.y = g.sample.y + s.size * 0.5;
        if (s.vy < 0) s.vy = -s.vy * 0.3;
        s.vx *= 0.7; s.vz *= 0.7; s.spin.multiplyScalar(0.6);
      }
      toScene(s.x, s.y, s.z, s.mesh.position);
      s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt; s.mesh.rotation.z += s.spin.z * dt;
      const k = Math.min(1, s.life / 0.25);
      s.mesh.scale.setScalar(s.size * k);
    }
  }
}
