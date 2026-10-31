// Chase-camera framing search for a 390x844 portrait screen.
// Route runs along -Z (away from camera). Camera = focus - forward*dist, with
// focus = rider + lead (along route) + focusHeight. Fixed pitch, never rotates.
// Constraints: rider low in frame and reasonably big; AHEAD m of route visible
// even when it is DROP m lower (descents) or RISE m higher (climbs); camera low.
import * as THREE from 'three';
const aspect = Number(process.env.ASPECT ?? 390 / 844);
const AHEAD = Number(process.env.AHEAD ?? 45);
const DROP = Number(process.env.DROP ?? 8);
const RISE = Number(process.env.RISE ?? 5);
const res = [];
for (let pitchDeg = 6; pitchDeg <= 30; pitchDeg += 1)
for (const fov of [50, 55, 60, 65])
for (let dist = 6; dist <= 30; dist += 1)
for (let lead = 0; lead <= 20; lead += 1)
for (let fh = 0; fh <= 3; fh += 0.5) {
  const pitch = (pitchDeg * Math.PI) / 180;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.3, 2000);
  cam.rotation.set(-pitch, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const focus = new THREE.Vector3(0, fh, -lead);
  cam.position.copy(focus).addScaledVector(fwd, -dist);
  if (cam.position.z < 6) continue; // camera must be clearly behind the rider
  if (cam.position.y > 5.5 || cam.position.y < 1.8) continue; // "low and slightly above"
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const P = (s, y = 0, x = 0) => new THREE.Vector3(x, y, -s).project(cam);
  const r = P(0), rTop = P(0, 1.7);
  const h = (rTop.y - r.y) / 2;
  if (r.y > -0.45 || r.y < -0.85) continue; // rider low in frame
  if (h < 0.09 || h > 0.15) continue; // rider 9-15% of screen height: readable, not a wall
  if (P(8).y < rTop.y) continue; // rider must not hide the route 8 m ahead
  const far = P(AHEAD), farTop = P(AHEAD, RISE + 1.7), farDrop = P(AHEAD * 0.6, -DROP);
  if (farTop.y > 0.92 || farDrop.y < -0.95 || farDrop.y < r.y + 0.05) continue; // ahead visible, descent not hidden behind rider
  const rail = P(10, 1.7, 2.3); // optional rail on the right, 10 m ahead
  if (rail.x > 0.92) continue;
  const near = P(4); // route just ahead of the rider shouldn't be hidden by the rider
  const spread = far.y - r.y; // vertical screen space given to the route ahead
  const score = spread * 2 - Math.abs(h - 0.12) * 10 - Math.abs(r.y + 0.62) * 2 - Math.max(0, cam.position.y - 4) * 0.3;
  res.push({ score: +score.toFixed(3), pitchDeg, fov, dist, lead, fh, camY: +cam.position.y.toFixed(2), camBehind: +cam.position.z.toFixed(2), riderNdcY: +r.y.toFixed(2), riderH: +(h * 100).toFixed(1), aheadNdcY: +far.y.toFixed(2), near4Y: +near.y.toFixed(2) });
}
res.sort((a, b) => b.score - a.score);
console.log(res.slice(0, 12).map((x) => JSON.stringify(x)).join('\n'));
console.log('candidates', res.length);
