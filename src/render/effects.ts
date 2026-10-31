import * as THREE from 'three';
import { ROUTE_DIR, toScene } from './space';
import { TUNING } from '../tuning';

interface P { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vel: THREE.Vector3; life: number; max: number; size: number; grow: number; drag: number }

/** Tiny particle pool for placeholder feedback (wind tufts, landing puffs, speed streaks). */
export class Effects {
  readonly group = new THREE.Group();
  private pool: P[] = [];
  private next = 0;
  private geo = new THREE.IcosahedronGeometry(1, 0);

  constructor(size = 260) {
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

  /** Small forward air-cutting wisps right at the rider (restrained). */
  speedStreak(x: number, y: number, speed: number): void {
    const p = toScene(x + 1.2 + Math.random() * 1.5, y + 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2);
    const v = ROUTE_DIR.clone().multiplyScalar(-speed * 0.25);
    this.spawn(p, v, 0.18, 0.035, '#ffffff', 0.3, 0);
  }

  /** Sparks exactly at the board-rail contact, thrown back and up. */
  sparks(x: number, y: number, lateral: number, speed: number, n = 2): void {
    const base = toScene(x, y + 0.05, lateral);
    for (let i = 0; i < n; i++) {
      const v = ROUTE_DIR.clone().multiplyScalar(-(1 + Math.random() * 3) + speed * 0.3);
      v.y = 1 + Math.random() * 3;
      v.x += (Math.random() - 0.5) * 2; v.z += (Math.random() - 0.5) * 2;
      this.spawn(base.clone(), v, 0.2 + Math.random() * 0.2, 0.06 + Math.random() * 0.05, Math.random() < 0.5 ? '#ffd36b' : '#ff9a3c', 0.2, 1);
    }
  }

  /** Friction smoke where the board meets the wall; trails behind the contact. */
  wallSmoke(x: number, y: number, lateral: number, speed: number): void {
    const p = toScene(x - 0.3, y + 0.3 + Math.random() * 0.4, lateral);
    const v = ROUTE_DIR.clone().multiplyScalar(speed * 0.35);
    v.y = 0.2 + Math.random() * 0.5;
    v.x -= 0.4 + Math.random() * 0.6; // drift off the wall toward the route
    this.spawn(p, v, 0.5 + Math.random() * 0.3, 0.12 + Math.random() * 0.08, '#efe6ea', 3, 2.5);
  }

  /** Dust from the tail during a heel skim. */
  skimDust(x: number, y: number, speed: number): void {
    const p = toScene(x - 0.6, y + 0.05, (Math.random() - 0.5) * 0.4);
    const v = ROUTE_DIR.clone().multiplyScalar(speed * 0.4);
    v.y = 0.3 + Math.random() * 0.6;
    v.x += (Math.random() - 0.5) * 1.2;
    this.spawn(p, v, 0.35 + Math.random() * 0.2, 0.08 + Math.random() * 0.05, '#e6d2bd', 2.5, 4);
  }

  /** Small ring of air when a flip completes / big events. */
  ring(x: number, y: number, lateral: number, color = '#ffffff'): void {
    const base = toScene(x, y + 0.8, lateral);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0);
      this.spawn(base.clone(), v, 0.3, 0.06, color, 1, 4);
    }
  }

  clear(): void { for (const p of this.pool) { p.life = 0; p.mesh.visible = false; p.mat.opacity = 0; } }

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

/**
 * Speed lines: thin world-space streaks beside (never over) the route that the
 * rider rushes past. Count, length and opacity scale with actual speed, so they
 * only appear when the player has earned speed. Pure presentation.
 */
export class SpeedLines {
  readonly group = new THREE.Group();
  private lines: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number }[] = [];
  private next = 0;
  private acc = 0;

  constructor(count = 70) {
    const geo = new THREE.BoxGeometry(1, 0.035, 0.035);
    geo.translate(0.5, 0, 0);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.rotation.y = Math.atan2(-ROUTE_DIR.z, ROUTE_DIR.x); // align local +X with the route
      this.group.add(mesh);
      this.lines.push({ mesh, mat, life: 0, max: 1 });
    }
  }

  /** 0 below the start threshold, 1 at the hard cap. */
  static intensity(speed: number): number {
    const F = TUNING.speedFx, M = TUNING.movement;
    const start = F.linesStart * M.softCap;
    return Math.min(1, Math.max(0, (speed - start) / (M.hardCap - start)));
  }

  update(dt: number, x: number, y: number, speed: number): void {
    const F = TUNING.speedFx;
    const k = SpeedLines.intensity(speed);
    this.acc += dt * F.linesRate * k;
    while (this.acc >= 1) {
      this.acc -= 1;
      const l = this.lines[this.next];
      this.next = (this.next + 1) % this.lines.length;
      const side = Math.random() < 0.5 ? -1 : 1;
      const lateral = side * (F.linesInner + Math.random() * (F.linesOuter - F.linesInner));
      const len = 0.6 + speed * F.linesLengthPerSpeed * (0.6 + Math.random() * 0.8);
      toScene(x + 6 + Math.random() * 30, y + 0.3 + Math.random() * 4.5, lateral, l.mesh.position);
      l.mesh.scale.set(len, 1, 1);
      l.max = l.life = 0.35 + Math.random() * 0.25;
      l.mesh.visible = true;
      l.mat.userData.peak = F.linesMaxOpacity * (0.5 + 0.5 * k);
    }
    for (const l of this.lines) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.mesh.visible = false; continue; }
      const t = 1 - l.life / l.max;
      l.mat.opacity = (l.mat.userData.peak as number) * Math.sin(Math.PI * t);
    }
  }
}

/**
 * Drifting petals and stray feathers (one instanced draw call). They live in route
 * space beside the corridor (|lateral| >= 3.5 m) and drift gently, so they add life
 * without ever crossing the route ahead of the rider.
 */
export class Petals {
  readonly mesh: THREE.InstancedMesh;
  private items: { x: number; y: number; lat: number; ph: number; spin: number; s: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private t = 0;
  private placed = false;

  constructor(max = 48) {
    const g = new THREE.PlaneGeometry(1, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.frustumCulled = false;
    const palette = ['#ffd3dc', '#ffe8ee', '#fff6e8', '#f7c6d4', '#fffaf2'];
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) {
      this.mesh.setColorAt(i, c.set(palette[i % palette.length]));
      this.items.push({ x: 0, y: 0, lat: 0, ph: Math.random() * 6.28, spin: 0.8 + Math.random() * 2, s: i % 7 === 0 ? 0.34 : 0.16 + Math.random() * 0.08 });
    }
  }

  set count(n: number) { this.mesh.count = Math.min(n, this.items.length); this.mesh.visible = n > 0; }

  private place(p: Petals['items'][number], x: number, y: number, fresh: boolean): void {
    const side = Math.random() < 0.7 ? 1 : -1; // mostly behind the route (away from the camera)
    p.lat = side * (3.5 + Math.random() * (side > 0 ? 22 : 6));
    p.x = x + (fresh ? -15 + Math.random() * 75 : 45 + Math.random() * 20);
    p.y = y + 1 + Math.random() * 9;
  }

  update(dt: number, x: number, y: number): void {
    if (!this.mesh.visible) return;
    this.t += dt;
    const n = this.mesh.count;
    for (let i = 0; i < n; i++) {
      const p = this.items[i];
      if (!this.placed || p.x < x - 20 || p.x > x + 90 || Math.abs(p.y - y) > 25) this.place(p, x, y, !this.placed);
      p.x -= dt * (1.2 + Math.sin(this.t * 0.7 + p.ph)); // breeze down the route
      p.y -= dt * 0.35;
      p.lat += Math.sin(this.t * 0.9 + p.ph) * dt * 0.3;
      if (Math.abs(p.lat) < 3.5) p.lat = Math.sign(p.lat || 1) * 3.5;
      toScene(p.x, p.y + Math.sin(this.t * 1.3 + p.ph) * 0.4, p.lat, this.v);
      this.q.setFromEuler(this.e.set(this.t * p.spin + p.ph, this.t * p.spin * 0.6, p.ph));
      this.m.compose(this.v, this.q, this.sc.setScalar(p.s));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.placed = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Re-place everything (new course / origin rebase handled by route-space storage). */
  reset(): void { this.placed = false; }
}
