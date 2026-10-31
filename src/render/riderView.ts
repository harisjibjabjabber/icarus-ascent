import * as THREE from 'three';
import { ROUTE_YAW, toScene } from './space';
import { TUNING } from '../tuning';
import { toon } from './materials';
import { GeoBuilder, jitter } from './geo';
import { mulberry32 } from '../rng';
import type { Snapshot } from './view';

/** Rider palette: a terracotta-red chiton keeps Icarus readable against white marble and cloud. */
export const RIDER_STYLE = {
  skin: '#f0c49c', skinShade: '#d89e7a', hair: '#4a3328', tunic: '#d4513a', tunicShade: '#a83a2c', chiton: '#fbf3e6',
  gold: '#f0b94a', board: '#3d3556', boardEdge: '#2a2440', feather: '#fffaf0', featherShade: '#e9dccb', featherTip: '#f2c46a', laurel: '#8fae5a',
};

/**
 * Procedural low-poly Icarus: chiton and tunic, curly hair and laurel, wax-and-feather
 * wings that fold along the back on the ground and spread (and beat) in the air.
 * Hierarchy: root (route yaw, position) -> roll (wall lean about the travel axis)
 *   -> pivot (pitch: slope + heel lift + flip) -> stance (yaw: grind boardslide) -> parts.
 * Local axes after root yaw: +X forward, +Y up, +Z rider's right. The rider faces the
 * camera side (-Z), so the wings on his back open against the sky.
 */
export class RiderView {
  readonly root = new THREE.Group();
  private roll = new THREE.Group();
  private pivot = new THREE.Group();
  private stance = new THREE.Group();
  private board: THREE.Mesh;
  private body: THREE.Group;
  private head: THREE.Mesh;
  private arms: THREE.Group[] = [];
  private wings: THREE.Group[] = [];
  private spread = 0;
  private t = 0;
  private squash = 0;
  private squashVel = 0;
  private boardAngle = 0;
  private lateral = 0;
  private rollAngle = 0;
  private stanceAngle = 0;
  private heel = 0;
  private grab = 0; // -1 left .. +1 right

  constructor() {
    const R = RIDER_STYLE;
    const vmat = toon('#ffffff', { vertexColors: true, rim: 1.3 });
    const wmat = toon('#ffffff', { vertexColors: true, rim: 1.6, side: THREE.DoubleSide });
    this.root.rotation.y = ROUTE_YAW;
    this.root.add(this.roll);
    this.roll.add(this.pivot);
    this.pivot.add(this.stance);
    // board: deck, darker rails, gold nose fin and trim stripe
    const bb = new GeoBuilder()
      .add(new THREE.BoxGeometry(1.25, 0.07, 0.42), [0, 0, 0], R.boardEdge, { top: R.board })
      .add(new THREE.BoxGeometry(1.1, 0.012, 0.06), [0, 0.04, 0], R.gold)
      .add(new THREE.BoxGeometry(0.25, 0.08, 0.44), [0.56, 0.05, 0], R.gold, { rot: [0, 0, 0.35] })
      .add(new THREE.BoxGeometry(0.22, 0.08, 0.44), [-0.56, 0.04, 0], R.boardEdge, { rot: [0, 0, -0.3] });
    this.board = new THREE.Mesh(bb.build()!, vmat);
    this.board.position.y = 0.06;
    this.stance.add(this.board);
    // body (scaled for squash): legs, chiton skirt, red tunic, gold belt. Faces +X (down the
    // route), so the chase camera sees his back and the wings open sideways against the sky.
    const body = new GeoBuilder();
    for (const sz of [-1, 1]) {
      body.add(new THREE.CylinderGeometry(0.065, 0.055, 0.4, 7), [0, 0.2, sz * 0.15], R.skinShade, { top: R.skin, rot: [-sz * 0.14, 0, 0] });
      body.add(new THREE.BoxGeometry(0.16, 0.06, 0.12), [0.03, 0.03, sz * 0.18], R.hair); // sandals
    }
    body.add(new THREE.CylinderGeometry(0.2, 0.3, 0.3, 10), [0, 0.5, 0], R.chiton);
    body.add(new THREE.CylinderGeometry(0.17, 0.21, 0.42, 10), [0, 0.82, 0], R.tunicShade, { top: R.tunic });
    body.add(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 10), [0, 0.64, 0], R.gold);
    body.add(new THREE.BoxGeometry(0.4, 0.46, 0.06), [0, 0.86, 0.02], R.chiton, { rot: [0.5, 0, 0], scale: [1.02, 1, 1] }); // diagonal drape
    body.add(new THREE.SphereGeometry(0.17, 10, 6), [0, 1.03, 0], R.tunic, { scale: [1.05, 0.5, 1.3] }); // shoulders
    this.body = new THREE.Group();
    this.body.add(new THREE.Mesh(body.build()!, vmat));
    this.body.position.y = 0.12;
    this.stance.add(this.body);
    // arms hang from the shoulders (along -Y) and swing out sideways for balance
    for (const sz of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0, 1.0, sz * 0.24);
      const ag = new GeoBuilder()
        .add(new THREE.CylinderGeometry(0.055, 0.05, 0.5, 7), [0, -0.25, 0], R.skinShade, { top: R.skin })
        .add(new THREE.SphereGeometry(0.06, 7, 5), [0, -0.52, 0], R.skin)
        .add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 7), [0, -0.4, 0], R.gold);
      arm.add(new THREE.Mesh(ag.build()!, vmat));
      this.body.add(arm);
      this.arms.push(arm);
    }
    // wings on the back: a wax spar along +Z with a fan of feathers hanging from it; mirrored for the left
    for (const sz of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(-0.17, 0.98, sz * 0.08);
      const wg = new GeoBuilder();
      wg.add(new THREE.CylinderGeometry(0.03, 0.02, 0.9, 5), [0, 0, 0.45], R.featherTip, { rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 7; i++) {
        const len = 0.95 - i * 0.09, z = 0.12 + i * 0.13;
        wg.add(new THREE.BoxGeometry(0.02, len, 0.14), [0, -len / 2 + 0.02, z], R.featherTip, { top: R.feather, rot: [-(0.35 - i * 0.09), 0, 0] });
      }
      wg.add(new THREE.BoxGeometry(0.025, 0.24, 0.8), [0.005, -0.09, 0.45], R.featherShade, { top: R.feather });
      const wm = new THREE.Mesh(wg.build()!, wmat);
      wm.scale.z = sz;
      wing.add(wm);
      this.body.add(wing);
      this.wings.push(wing);
    }
    // head: face, curly hair (back), laurel band, nose forward
    const hg = new GeoBuilder()
      .add(new THREE.SphereGeometry(0.2, 12, 9), [0, 0, 0], R.skinShade, { top: R.skin })
      .add(jitter(new THREE.IcosahedronGeometry(0.205, 1), 0.04, mulberry32(3)), [-0.035, 0.06, 0], R.hair, { scale: [1, 0.85, 1.02] })
      .add(new THREE.TorusGeometry(0.2, 0.025, 4, 14), [0, 0.07, 0], R.laurel, { rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.ConeGeometry(0.035, 0.07, 4), [0.2, -0.01, 0], R.skinShade, { rot: [0, 0, -Math.PI / 2] });
    this.head = new THREE.Mesh(hg.build()!, vmat);
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
    this.head.rotation.z = lean * 0.5;

    // arms: balance on the ground, raised in flight, reaching for the board on a grab
    this.t += dt;
    const air = airborne ? 1 : 0;
    const reach = Math.abs(this.grab);
    for (let i = 0; i < 2; i++) {
      const sz = i === 0 ? -1 : 1;
      const base = 0.45 + air * 0.7 + (s.mode === 'grinding' ? 0.5 : 0);
      this.arms[i].rotation.x = -sz * (base * (1 - reach) + 0.15 * reach) + Math.sin(this.t * 3 + i) * 0.05;
      this.arms[i].rotation.z = reach * 0.9; // reach down toward the board
    }
    // wings fold along the back on the ground, spread and beat slowly in the air
    const open = airborne ? (flip > 0 ? 1 : 0.85) : s.mode === 'grinding' || s.mode === 'wallRiding' ? 0.45 : 0.05;
    this.spread += (open - this.spread) * ease(airborne ? 7 : 5);
    const beat = airborne && flip === 0 ? Math.sin(this.t * 7) * 0.22 : Math.sin(this.t * 2.2) * 0.03;
    for (let i = 0; i < 2; i++) {
      const sz = i === 0 ? -1 : 1;
      const fold = 1.35 - this.spread * 1.75 - beat * this.spread; // + = folded down
      this.wings[i].rotation.set(sz * fold, sz * (0.5 - this.spread * 0.35), -0.15);
    }
  }

  kick(amount: number): void { this.squash = Math.max(this.squash, amount); this.squashVel = 0; }

  get currentLateral(): number { return this.lateral; }
}
