import * as THREE from 'three';

/**
 * Course props baked by art/pipeline/bake_props.py: the high-line rail panel
 * and the choice-point beacon. Vertex colours are the witch-town palette; `tuv` + `tl` sample the
 * same painted detail array as the town (rock / wood), so they pick up that grain at runtime.
 * One download, shared geometries. Callers that stamp a piece into a chunk must copy the geometry —
 * chunk disposal frees whatever it owns.
 */
export interface PropPiece {
  /** Iron / frame. Attributes: position, normal, color, tuv, tl. */
  body: THREE.BufferGeometry;
  /** Candle / lamp head. Same attributes; render with the warm glow material. Null if this piece has none. */
  glow: THREE.BufferGeometry | null;
}

interface Entry { v: number; i: number; g: number; pos: number; nrm: number; col: number; uv: number; tl: number; idx: number; gidx: number }

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || './';

function geo(bin: ArrayBuffer, e: Entry, idxOff: number, count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, e.pos, e.v * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, e.nrm, e.v * 3), 3));
  const src = new Uint8Array(bin, e.col, e.v * 3);
  const col = new Float32Array(e.v * 3);
  for (let i = 0; i < col.length; i++) col[i] = src[i] / 255;
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tuv', new THREE.BufferAttribute(new Float32Array(bin, e.uv, e.v * 2), 2));
  g.setAttribute('tl', new THREE.BufferAttribute(new Float32Array(bin, e.tl, e.v), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin.slice(idxOff, idxOff + count * 4)), 1));
  return g;
}

export class PropSet {
  constructor(readonly pieces: Map<string, PropPiece>) {}
  piece(name: string): PropPiece | undefined { return this.pieces.get(name); }
}

let ready: Promise<PropSet | null> | null = null;

/** Starts the fetch on first call. Resolves null if the files are missing (rails fall back to nothing). */
export function loadProps(): Promise<PropSet | null> {
  if (!ready) ready = fetchProps();
  return ready;
}

async function fetchProps(): Promise<PropSet | null> {
  try {
    const [index, bin] = await Promise.all([
      fetch(BASE + 'props/props.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
      fetch(BASE + 'props/props.bin').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }),
    ]);
    const pieces = new Map<string, PropPiece>();
    for (const [name, e] of Object.entries(index.pieces as Record<string, Entry>)) {
      const body = e.i ? geo(bin, e, e.idx, e.i) : new THREE.BufferGeometry();
      const glow = e.g ? geo(bin, e, e.gidx, e.g) : null;
      pieces.set(name, { body, glow });
    }
    return new PropSet(pieces);
  } catch (err) {
    console.warn('course props failed to load', err);
    return null;
  }
}
