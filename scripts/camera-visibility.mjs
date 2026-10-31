// Visibility check for the chase camera on a portrait phone.
// Usage: node scripts/camera-visibility.mjs '[[behind,height,pitchDeg,fov], ...]' [screenW screenH]
import * as THREE from 'three';
const W = Number(process.argv[3] ?? 390), H = Number(process.argv[4] ?? 844);
const SOFT = 16, HARD = 22;
for (const [behind, height, pitchDeg, fov] of JSON.parse(process.argv[2])) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.3, 2000);
  cam.rotation.set((-pitchDeg * Math.PI) / 180, 0, 0, 'YXZ');
  cam.position.set(0, height, behind);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const P = (ahead, y = 0, x = 0) => new THREE.Vector3(x, y, -ahead).project(cam);
  const px = (ndcY) => ((1 - ndcY) / 2) * H;
  const r = P(0), rt = P(0, 1.7);
  const riderPct = ((rt.y - r.y) / 2) * 100;
  // farthest distance at which a 7 m gap still spans >= 10 px vertically
  let gapVis = 0;
  for (let d = 2; d < 300; d += 0.5) if (px(P(d).y) - px(P(d + 7).y) >= 10) gapVis = d;
  // farthest distance at which a 1 m tall obstacle is >= 10 px tall
  let objVis = 0;
  for (let d = 2; d < 400; d += 0.5) if (px(P(d).y) - px(P(d, 1).y) >= 10) objVis = d;
  const rail = P(10, 1.7, 2.3), wall = P(15, 4, 2.6), drop = P(25, -8), climb = P(30, 5);
  const horizon = Math.tan((pitchDeg * Math.PI) / 180) / Math.tan((fov * Math.PI) / 360);
  const look = Math.min(gapVis, objVis);
  console.log(JSON.stringify({
    behind, height, pitchDeg, fov,
    riderFeetPx: Math.round(px(r.y)), riderHeightPct: +riderPct.toFixed(1), riderPx: Math.round((riderPct / 100) * H),
    horizonPx: Math.round(px(horizon)),
    gapReadableToM: gapVis, obstacleReadableToM: objVis,
    secondsAtSoftCap: +(look / SOFT).toFixed(2), secondsAtHardCap: +(look / HARD).toFixed(2),
    rail10mRightPx: [Math.round(((rail.x + 1) / 2) * W), Math.round(px(rail.y))],
    wall15mRightTopPx: [Math.round(((wall.x + 1) / 2) * W), Math.round(px(wall.y))],
    drop8mAt25mPx: Math.round(px(drop.y)), climb5mAt30mPx: Math.round(px(climb.y)),
  }));
}
