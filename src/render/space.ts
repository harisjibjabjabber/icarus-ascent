import * as THREE from 'three';
import { TUNING } from '../tuning';

/**
 * The gameplay plane in 3D. Gameplay is 2D (x along route, y height). We lay that
 * plane into the scene at a fixed yaw so the route recedes from lower-right
 * foreground to upper-left distance, OlliOlli-World-style: side-on readability with
 * real depth. `lateral` is presentation-only depth across the route (+ = rider's
 * right = away from camera), used for rails/walls/scenery.
 */
const yaw = (TUNING.camera.routeYawDeg * Math.PI) / 180;
export const ROUTE_DIR = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw));
/** Rider's right-hand side (forward x up). */
export const ROUTE_RIGHT = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
/** Rotation (about Y) that turns local +X into ROUTE_DIR (local -Z becomes ROUTE_RIGHT... see riderView). */
export const ROUTE_YAW = Math.PI - yaw;

export function toScene(x: number, y: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(
    ROUTE_DIR.x * x + ROUTE_RIGHT.x * lateral,
    y,
    ROUTE_DIR.z * x + ROUTE_RIGHT.z * lateral,
  );
}
