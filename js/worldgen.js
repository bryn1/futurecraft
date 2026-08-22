// FutureCraft module: world-gen (js/worldgen.js) — C8.
// Deterministic procedural terrain for a seed over a bounded region.
//   generate(seed:string, {w,h,d}:Region): Layout
// MIT-style: authored by teddy for svarkor-ai/futurecraft.
// Contracts cited: C8 (DESIGN.md §3, module 206.2 rev-2).
import { BLOCKS } from './blocks.js';

// Buildable block ids only (air=0 excluded). Used for the id vocabulary only.
const BUILDABLE = (() => {
  const out = [];
  for (const [id, blk] of BLOCKS) {
    if (blk.solid && id !== 0) out.push(id);
  }
  return out;
})();
const AIR = 0;

// mulberry32 — small, fast, deterministic 32-bit PRNG from an integer seed.
// (No Math.random anywhere.) Returns a closure next() -> float in [0,1).
function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// String seed -> 32-bit integer seed deterministically (FNV-1a).
function hashSeed(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 2D value noise at a fixed frequency, read from a per-seed set of lattice
// gradients. gamma maps a grid cell. Simple + deterministic.
function makeNoise(rand, latticeStep = 4) {
  const cellW = latticeStep;
  const gradients = new Map();
  function latticeGrad(gx, gz) {
    const key = gx + ',' + gz;
    if (!gradients.has(key)) {
      const r = rand(); // one draw per lattice node, order stable per seed
      gradients.set(key, r);
    }
    return gradients.get(key);
  }
  function smooth(t) { return t * t * (3 - 2 * t); } // smootherstep-ish
  return function noise(x, z) {
    const gx = Math.floor(x / cellW);
    const gz = Math.floor(z / cellW);
    const fx = (x - gx * cellW) / cellW;
    const fz = (z - gz * cellW) / cellW;
    const sx = smooth(fx);
    const sz = smooth(fz);
    const v00 = latticeGrad(gx, gz);
    const v10 = latticeGrad(gx + 1, gz);
    const v01 = latticeGrad(gx, gz + 1);
    const v11 = latticeGrad(gx + 1, gz + 1);
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sz; // in [0,1)
  };
}

/**
 * C8. generate(seed, {w,h,d}) -> Layout.
 * Deterministic per seed (seeded PRNG, no Math.random), in-bounds, air=0 outside
 * placed terrain. Uses BLOCKS/byId for the id vocabulary only; no state mutated.
 */
export function generate(seed, { w, h, d }) {
  const rand = mulberry32(hashSeed(String(seed)));
  const heightNoise = makeNoise(rand, 4);
  const idNoise = makeNoise(rand, 8); // separate lattice from height randomness

  const blockIds = new Uint16Array(w * h * d); // 0 = air default

  // Height field: terrain surface at each (x,z) in [1, h-1). y==0 is bed kept solid.
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      // 2 octaves of value noise -> surface height
      const n = heightNoise(x, z) * 0.7 + heightNoise(x * 1.7 + 31, z * 1.7 + 17) * 0.3;
      // surface between 2 and h-1 (guarantees at least 1 air row above, keeps bed)
      const surface = 2 + Math.floor(n * (h - 3));
      // pick a buildable id deterministically from position (id vocabulary only)
      const pick = BUILDABLE[Math.floor(idNoise(x, z) * BUILDABLE.length) % BUILDABLE.length];
      for (let y = 0; y <= surface && y < h; y++) {
        blockIds[(y * d + z) * w + x] = pick;
      }
    }
  }

  const region = { width: w, height: h, depth: d };
  const data = { blockIds, strideW: w, depth: d };

  return {
    width: w,
    height: h,
    depth: d,
    get(x, y, z) {
      if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return AIR;
      return data.blockIds[(y * data.depth + z) * data.strideW + x];
    },
  };
}
