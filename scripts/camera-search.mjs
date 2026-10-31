// Brute-force camera framing search for the portrait visibility budget.
import * as THREE from 'three';
const aspect = Number(process.env.ASPECT ?? 390 / 844);
const AHEAD = Number(process.env.AHEAD ?? 34);
const res = [];
for (let yawDeg = 30; yawDeg <= Number(process.env.MAXYAW ?? 80); yawDeg += 2.5)
for (let pitchDeg = 14; pitchDeg <= 46; pitchDeg += 2)
for (let fov of [40, 46, 52])
for (let dist = 20; dist <= 70; dist += 2.5)
for (let lead = 0; lead <= 24; lead += 1.5) {
  const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
  const dir = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw));
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.5, 2000);
  cam.rotation.set(-pitch, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const focus = dir.clone().multiplyScalar(lead); focus.y = 2;
  cam.position.copy(focus).addScaledVector(fwd, -dist);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const P = (s, y = 0) => { const v = dir.clone().multiplyScalar(s); v.y = y; return v.project(cam); };
  const r = P(0), r2 = P(0, 1.7), a = P(AHEAD), a2 = P(AHEAD, 4), b = P(-6);
  if (r.x > 0.8 || r.x < 0.2 || r.y > -0.35 || r.y < -0.8) continue;
  if (a.x < -0.9 || a2.y > 0.9 || a.y < r.y) continue;
  if (b.y < -1.2 && b.x > 1.2) {} // behind can be off-screen
  const h = (r2.y - r.y) / 2;
  const side = 90 - yawDeg; // larger = more side-on
  const score = h * 100 + side * 0.04;
  res.push({ score: +score.toFixed(2), yawDeg, pitchDeg, fov, dist, lead, h: +(h * 100).toFixed(1), rider: [r.x.toFixed(2), r.y.toFixed(2)], ahead: [a.x.toFixed(2), a.y.toFixed(2)] });
}
res.sort((p, q) => q.score - p.score);
console.log(res.slice(0, 15).map((x) => JSON.stringify(x)).join('\n'));
