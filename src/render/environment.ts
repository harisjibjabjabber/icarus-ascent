import * as THREE from 'three';
import { mulberry32 } from '../rng';
import { toon } from './materials';
import { toScene } from './space';

/**
 * 3D environment scaffold: gradient sky dome, warm sun + soft shadows, gentle fog,
 * a sea of clouds far below and low-poly distant scenery (islands, peaks,
 * columns) placed in the world so real perspective provides the parallax.
 * All placeholder — the art pass replaces ENV_STYLE and the scenery builders.
 */
export const ENV_STYLE = {
  skyTop: '#6fa3d8',
  skyHorizon: '#ffd9b3',
  skyBelow: '#e4def0',
  fog: '#f0dcd2',
  fogNear: 70,
  fogFar: 1200,
  hemiSky: '#fff1dc',
  hemiGround: '#a8a6d6',
  hemiIntensity: 1.5,
  sun: '#ffe2b8',
  sunIntensity: 2.4,
  /** Direction the sunlight comes FROM (scene space, normalised in code). Low, warm, from upper-left-behind. */
  sunFrom: new THREE.Vector3(-0.6, 0.75, 0.35),
  cloudSea: '#cfcaee',
  cloudSeaY: -45,
  island: '#e9c9a7',
  islandGrass: '#a9c98a',
  peak: '#c6b4d6',
  column: '#f1e6da',
};

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(ENV_STYLE.skyTop) },
      horizon: { value: new THREE.Color(ENV_STYLE.skyHorizon) },
      below: { value: new THREE.Color(ENV_STYLE.skyBelow) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, below, smoothstep(0.0, 0.25, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private sunOffset: THREE.Vector3;

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.Fog(ENV_STYLE.fog, ENV_STYLE.fogNear, ENV_STYLE.fogFar);
    this.dome = skyDome();
    scene.add(this.dome);
    scene.add(new THREE.HemisphereLight(ENV_STYLE.hemiSky, ENV_STYLE.hemiGround, ENV_STYLE.hemiIntensity));
    this.sun = new THREE.DirectionalLight(ENV_STYLE.sun, ENV_STYLE.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    this.sunOffset = ENV_STYLE.sunFrom.clone().normalize().multiplyScalar(60);
    scene.add(this.sun, this.sun.target);
    scene.add(this.group);
  }

  /** Distant low-poly scenery around the course (seeded, static). */
  buildScenery(seed: number, length: number): void {
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const rng = mulberry32(seed ^ 0x5eed);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), toon(ENV_STYLE.cloudSea));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, ENV_STYLE.cloudSeaY, 0);
    sea.receiveShadow = false;
    this.group.add(sea);
    const islandMat = toon(ENV_STYLE.island), grassMat = toon(ENV_STYLE.islandGrass), peakMat = toon(ENV_STYLE.peak), colMat = toon(ENV_STYLE.column);
    for (let x = -150; x < length + 500; x += 18 + rng() * 22) {
      // either side of the route, never in front of it near the camera
      const lateral = (rng() < 0.5 ? 1 : -1) * (55 + rng() * 380); // both sides of the route, never on it
      const y = -15 - rng() * 35;
      const p = toScene(x, y, lateral);
      const kind = rng();
      if (kind < 0.55) {
        // floating island: inverted cone + grassy cap
        const r = 6 + rng() * 14;
        const H = r * (1.2 + rng());
        const body = new THREE.Mesh(new THREE.ConeGeometry(r, H, 7, 1), islandMat);
        body.rotation.x = Math.PI;
        body.position.copy(p);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r, 1.6, 7), grassMat);
        cap.position.copy(p);
        cap.position.y += H / 2 + 0.8;
        this.group.add(body, cap);
        if (rng() < 0.5) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 6 + rng() * 6, 8), colMat);
          col.position.copy(cap.position).add(new THREE.Vector3((rng() - 0.5) * r, 4, (rng() - 0.5) * r));
          this.group.add(col);
        }
      } else if (kind < 0.85) {
        const h = 60 + rng() * 120;
        const peak = new THREE.Mesh(new THREE.ConeGeometry(h * 0.55, h, 6, 1), peakMat);
        peak.position.set(p.x, ENV_STYLE.cloudSeaY + h / 2 - 5, p.z);
        peak.rotation.y = rng() * Math.PI;
        this.group.add(peak);
      } else {
        const h = 18 + rng() * 25;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, h, 8), colMat);
        col.position.set(p.x, ENV_STYLE.cloudSeaY + h / 2, p.z);
        this.group.add(col);
      }
    }
  }

  /** Keep the shadow frustum and sky centred on the action. */
  follow(focus: THREE.Vector3, cameraPos: THREE.Vector3): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
    this.dome.position.copy(cameraPos);
  }
}
