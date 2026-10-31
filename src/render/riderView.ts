import * as THREE from 'three';
import { ROUTE_YAW, toScene } from './space';
import { TUNING } from '../tuning';
import { toon } from './materials';
import type { Snapshot } from './view';

/**
 * Placeholder rider: board + body + head with procedural posing.
 * Hierarchy: root (route yaw, position) -> roll (wall lean about the travel axis)
 *   -> pivot (pitch: slope + heel lift + flip) -> stance (yaw: grind boardslide) -> parts.
 * Local axes after root yaw: +X forward, +Y up, +Z rider's right.
 */
export class RiderView {
  readonly root = new THREE.Group();
  private roll = new THREE.Group();
  private pivot = new THREE.Group();
  private stance = new THREE.Group();
  private board: THREE.Mesh;
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private squash = 0;
  private squashVel = 0;
  private boardAngle = 0;
  private lateral = 0;
  private rollAngle = 0;
  private stanceAngle = 0;
  private heel = 0;
  private grab = 0; // -1 left .. +1 right

  constructor() {
    this.root.rotation.y = ROUTE_YAW;
    this.root.add(this.roll);
    this.roll.add(this.pivot);
    this.pivot.add(this.stance);
    this.board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 0.42), toon('#3b3552'));
    this.board.position.y = 0.06;
    this.stance.add(this.board);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.09, 0.44), toon('#e0b04a'));
    fin.position.set(0.5, 0.12, 0); fin.rotation.z = 0.35;
    this.board.add(fin);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.34), toon('#d2563c'));
    this.body.geometry.translate(0, 0.475, 0);
    this.body.position.y = 0.12;
    this.stance.add(this.body);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), toon('#f2d0a9'));
    this.stance.add(this.head);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** Called every frame with interpolated sim values. */
  update(dt: number, s: Snapshot, x: number, y: number, angle: number, flip: number, targetLateral: number): void {
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    // lateral: snap onto rails/walls quickly, drift back to the route centre gently
    this.lateral += (targetLateral - this.lateral) * ease(targetLateral !== 0 ? 14 : 4);
    toScene(x, y, this.lateral, this.root.position);

    const airborne = s.mode === 'airborne';
    // board pitch: follow the contact on the ground/rail, ease toward a gentle flight attitude in the air
    const target = airborne ? Math.max(-0.6, Math.min(0.6, Math.atan2(s.vy, Math.max(4, s.speed)) * 0.6)) : angle;
    this.boardAngle += (target - this.boardAngle) * ease(airborne ? 6 : 25);
    // heel skim: nose lifts, rider leans back
    this.heel += ((s.mode === 'heelSkim' ? 1 : 0) - this.heel) * ease(18);
    // backflip: full rotation about the rider's lateral axis (nose up and over backwards)
    this.pivot.rotation.z = this.boardAngle + this.heel * 0.42 + flip * Math.PI * 2;
    this.pivot.position.x = -this.heel * 0.5; // rotate about the tail
    // wall ride: lean the whole rider away from the wall (board flat against it)
    this.rollAngle += ((s.mode === 'wallRiding' ? -1.15 : 0) - this.rollAngle) * ease(14);
    this.roll.rotation.x = this.rollAngle;
    // grind: boardslide stance (board across the rail)
    this.stanceAngle += ((s.mode === 'grinding' ? Math.PI / 2 * 0.85 : 0) - this.stanceAngle) * ease(20);
    this.stance.rotation.y = this.stanceAngle;
    // grabs: crouch and reach to the side
    const g = s.air === 'grabLeft' ? -1 : s.air === 'grabRight' ? 1 : 0;
    this.grab += (g - this.grab) * ease(20);
    this.board.rotation.x = this.grab * 0.35;

    // squash spring
    const F = TUNING.feedback;
    this.squashVel += (-this.squash * F.squashRecover * F.squashRecover - this.squashVel * 2 * F.squashRecover * 0.7) * dt;
    this.squash += this.squashVel * dt;
    const crouch = Math.abs(this.grab) * 0.28 + (s.mode === 'grinding' ? 0.12 : 0) + (flip > 0 ? 0.2 : 0);
    const sq = Math.max(-0.25, Math.min(0.5, this.squash + crouch));
    this.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.3);
    const lean = -Math.min(0.35, s.speed * 0.013) - (airborne ? 0.12 : 0) + this.heel * 0.45;
    this.body.rotation.z = lean;
    this.body.rotation.x = this.grab * 0.4;
    const h = 0.12 + 0.95 * (1 - sq);
    this.head.position.set(Math.sin(-lean) * h + 0.02, Math.cos(lean) * h + 0.2, this.grab * 0.25);
  }

  kick(amount: number): void { this.squash = Math.max(this.squash, amount); this.squashVel = 0; }

  get currentLateral(): number { return this.lateral; }
}
