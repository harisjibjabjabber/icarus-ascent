import * as THREE from 'three';
import { TUNING } from '../tuning';
import { toScene } from './space';

/**
 * Fixed-orientation chase camera. It sits behind and above the rider and looks
 * ahead down the route at a fixed pitch. It never orbits or rotates: it only
 * translates to follow progress (x) and, with more lag, height (y).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private fx = 0; // followed route x
  private fy = 0; // followed height
  private pull = 0; // smoothed speed-based pull-back
  private initialised = false;
  private scale = 1;

  constructor() {
    const C = TUNING.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, 1, 0.3, 2400);
    const pitch = (C.pitchDeg * Math.PI) / 180;
    // camera looks along the route direction (scene -Z for yaw 90) pitched down
    const yaw = ((C.routeYawDeg - 90) * Math.PI) / 180;
    this.camera.rotation.set(-pitch, -yaw, 0, 'YXZ');
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.scale = w / h > 1 ? TUNING.camera.landscapeScale : 1;
    this.camera.updateProjectionMatrix();
  }

  get progress(): number { return this.fx; }
  get height(): number { return this.fy; }

  update(dt: number, riderX: number, riderY: number, speed: number, snap = false, aheadMaxY = -Infinity): void {
    const C = TUNING.camera;
    // raise the follow height to see over an upcoming crest/lip
    const targetY = Math.max(riderY, Math.min(aheadMaxY + C.lookOverClearance - C.height, riderY + C.lookOverMaxLift));
    if (!this.initialised || snap) {
      this.fx = riderX; this.fy = targetY; this.pull = speed; this.initialised = true;
    } else {
      this.fx += (riderX - this.fx) * (1 - Math.exp(-dt / C.followLag));
      this.fy += (targetY - this.fy) * (1 - Math.exp(-dt / C.heightLag));
      this.pull += (speed - this.pull) * (1 - Math.exp(-dt / C.pullLag));
    }
    const behind = (C.behind + C.behindPerSpeed * this.pull) * this.scale;
    const height = (C.height + C.heightPerSpeed * this.pull) * this.scale;
    toScene(this.fx - behind, this.fy + height, 0, this.camera.position);
  }
}
