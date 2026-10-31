import * as THREE from 'three';
import { TUNING } from '../tuning';
import { toScene } from './space';

/**
 * Fixed-orientation follow camera. Never orbits or rotates: it only translates
 * to follow progress. Look-ahead grows with speed so the visible approach time
 * stays roughly constant (visibility budget, brief §4).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private focus = new THREE.Vector2(); // (route x, height)
  private lead: number = TUNING.camera.lookAheadMin;
  private initialised = false;
  private forward: THREE.Vector3;
  private distance: number = TUNING.camera.distancePortrait;

  constructor() {
    const C = TUNING.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, 1, 0.5, 2000);
    const pitch = (C.pitchDeg * Math.PI) / 180;
    this.camera.rotation.set(-pitch, 0, 0, 'YXZ');
    this.forward = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  }

  resize(w: number, h: number): void {
    const C = TUNING.camera;
    this.camera.aspect = w / h;
    // portrait (aspect ~0.46) uses distancePortrait; landscape (>=1.4) uses distanceLandscape
    const t = Math.min(1, Math.max(0, (w / h - 0.46) / (1.4 - 0.46)));
    this.distance = C.distancePortrait + (C.distanceLandscape - C.distancePortrait) * t;
    this.camera.updateProjectionMatrix();
  }

  get progress(): number { return this.focus.x; }
  get height(): number { return this.focus.y; }

  update(dt: number, riderX: number, riderY: number, speed: number, snap = false): void {
    const C = TUNING.camera;
    const targetLead = C.lookAheadMin + C.lookAheadPerSpeed * speed;
    const tx = riderX, ty = riderY + C.focusHeight;
    if (!this.initialised || snap) {
      this.lead = targetLead; this.focus.set(tx, ty); this.initialised = true;
    } else {
      this.lead += (targetLead - this.lead) * (1 - Math.exp(-dt / C.leadLag));
      this.focus.x += (tx - this.focus.x) * (1 - Math.exp(-dt / C.followLag));
      this.focus.y += (ty - this.focus.y) * (1 - Math.exp(-dt / C.heightLag));
    }
    const f = toScene(this.focus.x + this.lead, this.focus.y);
    this.camera.position.copy(f).addScaledVector(this.forward, -this.distance);
  }
}
