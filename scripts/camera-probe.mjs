import * as THREE from 'three';
const aspect = Number(process.env.ASPECT ?? 390/844);
function test(yawDeg, pitchDeg, dist, fov, lead, fh) {
  const yaw = yawDeg*Math.PI/180, pitch = pitchDeg*Math.PI/180;
  const dir = new THREE.Vector3(-Math.cos(yaw),0,-Math.sin(yaw));
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.5, 2000);
  cam.rotation.set(-pitch,0,0,'YXZ');
  const fwd = new THREE.Vector3(0,-Math.sin(pitch),-Math.cos(pitch));
  const focus = dir.clone().multiplyScalar(lead).add(new THREE.Vector3(0,fh,0));
  cam.position.copy(focus).addScaledVector(fwd,-dist);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const p = (s, y=0) => { const v = dir.clone().multiplyScalar(s); v.y=y; v.project(cam); return `(${v.x.toFixed(2)},${v.y.toFixed(2)})`; };
  const head = (() => { const a=new THREE.Vector3(0,0,0).project(cam), b=new THREE.Vector3(0,1.7,0).project(cam); return ((b.y-a.y)/2*100).toFixed(1)+'%'; })();
  console.log(`yaw${yawDeg} pitch${pitchDeg} d${dist} fov${fov} lead${lead}: rider ${p(0)} h=${head} +15 ${p(15)} +30 ${p(30)} +45 ${p(45)} -10 ${p(-10)}`);
}
for (const [y,p,d,f,l,fh] of JSON.parse(process.argv[2])) test(y,p,d,f,l,fh);
