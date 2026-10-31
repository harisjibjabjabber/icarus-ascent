import * as THREE from 'three';
import { ROUTE_DIR, toScene } from './space';

interface P { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vel: THREE.Vector3; life: number; max: number; size: number; grow: number; drag: number }

/** Tiny particle pool for placeholder feedback (wind tufts, landing puffs, speed streaks). */
export class Effects {
  readonly group = new THREE.Group();
  private pool: P[] = [];
  private next = 0;
  private geo = new THREE.IcosahedronGeometry(1, 0);

  constructor(size = 160) {
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, mat, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.1, grow: 0, drag: 0 });
    }
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: string, grow = 1, drag = 3): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.mesh.position.copy(pos); p.vel.copy(vel); p.life = life; p.max = life; p.size = size; p.grow = grow; p.drag = drag;
    p.mat.color.set(color);
    p.mesh.visible = true;
  }

  /** Backward tuft of wind behind the rider; scales with impulse. */
  pushTuft(x: number, y: number, impulse: number, speed: number): void {
    const n = 4 + Math.round(impulse * 1.2);
    const base = toScene(x - 0.7, y + 0.25, 0);
    for (let i = 0; i < n; i++) {
      const back = ROUTE_DIR.clone().multiplyScalar(-(2 + impulse * 0.8 + Math.random() * 2) + speed * 0.6);
      back.y = 0.4 + Math.random() * 1.2;
      back.x += (Math.random() - 0.5) * 0.8; back.z += (Math.random() - 0.5) * 0.8;
      this.spawn(base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)), back, 0.35 + Math.random() * 0.2, 0.09 + Math.random() * 0.06, '#ffffff', 2.2, 4);
    }
  }

  /** Puff from the contact point; cloud = fluff, stone = dust. */
  landPuff(x: number, y: number, impact: number, material: string, speed: number): void {
    const n = Math.min(14, 3 + Math.round(impact * 0.9));
    const color = material === 'cloud' ? '#ffffff' : '#d8c6b4';
    const base = toScene(x, y + 0.05, 0);
    for (let i = 0; i < n; i++) {
      const side = (Math.random() - 0.5) * 2;
      const v = ROUTE_DIR.clone().multiplyScalar(speed * 0.5 + side * 2.5);
      v.y = 0.5 + Math.random() * impact * 0.15;
      this.spawn(base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.8)), v, 0.35 + Math.random() * 0.25, 0.12 + Math.random() * 0.08, color, 2.5, 5);
    }
  }

  /** Restrained forward air-cutting streaks at high speed. */
  speedStreak(x: number, y: number, speed: number): void {
    const p = toScene(x + 1.5 + Math.random() * 2, y + 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 2);
    const v = ROUTE_DIR.clone().multiplyScalar(speed * 0.55);
    this.spawn(p, v, 0.22, 0.04, '#ffffff', 0.5, 0);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; p.mat.opacity = 0; continue; }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.max;
      p.mesh.scale.setScalar(p.size * (1 + p.grow * t));
      p.mat.opacity = 0.85 * (1 - t);
    }
  }
}
