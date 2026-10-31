import * as THREE from 'three';
import { ROUTE_YAW, toScene } from './space';
import { TUNING } from '../tuning';
import { toon } from './materials';

/** Placeholder rider: board + body + head with procedural squash/lean. */
export class RiderView {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private squash = 0;
  private squashVel = 0;
  private boardAngle = 0;

  constructor() {
    this.root.rotation.y = ROUTE_YAW;
    this.root.add(this.pivot);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 0.42), toon('#3b3552'));
    board.position.y = 0.06;
    this.pivot.add(board);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.09, 0.44), toon('#e0b04a'));
    fin.position.set(0.5, 0.12, 0); fin.rotation.z = 0.35;
    this.pivot.add(fin);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.34), toon('#d2563c'));
    this.body.geometry.translate(0, 0.475, 0);
    this.body.position.y = 0.12;
    this.pivot.add(this.body);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), toon('#f2d0a9'));
    this.pivot.add(this.head);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** Called every frame with interpolated sim values. */
  update(dt: number, x: number, y: number, angle: number, speed: number, airborne: boolean, vy: number): void {
    toScene(x, y, 0, this.root.position);
    // board angle: follow the surface on the ground, ease toward a gentle flight attitude in the air
    const target = airborne ? Math.max(-0.6, Math.min(0.6, Math.atan2(vy, Math.max(4, speed)) * 0.6)) : angle;
    const k = 1 - Math.exp(-dt * (airborne ? 6 : 25));
    this.boardAngle += (target - this.boardAngle) * k;
    this.pivot.rotation.z = this.boardAngle;
    // squash spring
    const F = TUNING.feedback;
    this.squashVel += (-this.squash * F.squashRecover * F.squashRecover - this.squashVel * 2 * F.squashRecover * 0.7) * dt;
    this.squash += this.squashVel * dt;
    const sq = Math.max(-0.25, Math.min(0.45, this.squash));
    this.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.3);
    // lean forward with speed, crouch slightly in the air
    const lean = -Math.min(0.35, speed * 0.016) - (airborne ? 0.12 : 0);
    this.body.rotation.z = lean;
    const h = 0.12 + 0.95 * (1 - sq);
    this.head.position.set(Math.sin(-lean) * h + 0.02, Math.cos(lean) * h + 0.2, 0);
  }

  kick(amount: number): void { this.squash = Math.max(this.squash, amount); this.squashVel = 0; }
}
