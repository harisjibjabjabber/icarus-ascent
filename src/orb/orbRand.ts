/** Deterministic 0..1 from orb id + salt (replays / FX stay stable). */
export function orbRand(id: number, salt: number): number {
  let h = (id * 374761393 + salt * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
