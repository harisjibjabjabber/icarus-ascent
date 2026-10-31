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

/**
 * Floating origin. The sim keeps absolute float64 route coordinates (exact enough for
 * any run length); the GPU works in float32, so the scene is always laid out relative
 * to ORIGIN, which is rebased in fixed steps as the rider travels. Every placement
 * goes through toScene, so a rebase only has to shift objects that persist.
 */
export const ORIGIN = { x: 0, y: 0 };
export const REBASE = { every: 1000, height: 300 };

/** New origin if the rider has moved far enough from the current one (null: keep it). */
export function rebaseTarget(x: number, y: number, o = ORIGIN): { x: number; y: number } | null {
  if (Math.abs(x - o.x) < REBASE.every && Math.abs(y - o.y) < REBASE.height) return null;
  return { x: Math.round(x / REBASE.every) * REBASE.every, y: Math.round(y / 100) * 100 };
}

/** Scene-space offset that moves an object placed under origin `from` to origin `to`. */
export function rebaseDelta(from: { x: number; y: number }, to: { x: number; y: number }, out = new THREE.Vector3()): THREE.Vector3 {
  return toSceneRaw(from.x - to.x, from.y - to.y, 0, out);
}

/** Route -> scene without the origin (local offsets inside a chunk). */
export function toSceneRaw(x: number, y: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(
    ROUTE_DIR.x * x + ROUTE_RIGHT.x * lateral,
    y,
    ROUTE_DIR.z * x + ROUTE_RIGHT.z * lateral,
  );
}

export function toScene(x: number, y: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
  x -= ORIGIN.x; y -= ORIGIN.y;
  return out.set(
    ROUTE_DIR.x * x + ROUTE_RIGHT.x * lateral,
    y,
    ROUTE_DIR.z * x + ROUTE_RIGHT.z * lateral,
  );
}
