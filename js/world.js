// FutureCraft world-store DATA module: js/world.js (pure data, no THREE).
// Implements contracts C9, C10, C11, C18 from DESIGN.md §3 world-store.
// Headless-testable: no THREE import, no DOM. Layout is injected (C8 output) so
// this module never depends on worldgen.js directly (caller passes the layout).
// byId dependency contract (block-palette C5): id -> {id,name,color,emissive,solid},
// air-less accessor for missing ids. world.js MUST NOT hard-import blocks.js at
// module load (keeps it headless-loadable in isolation; real byId injected by
// app-shell wiring at create time per C9 signature). Default stub: only id 0 is a
// real 'air' block; any other integer is unknown unless overridden via deps.byId.
// This is the "uses byId/BLOCKS for the id vocabulary only" note — id validity.
function defaultById(id) {
  if (id === 0) return { id: 0, name: 'air', solid: false };
  // Unknown positive ids are NOT buildable until block-palette supplies BLOCKS.
  return undefined;
}

// C9/C10 coord mapping: one block == 1.0 world unit, origin (-w/2, 0, -d/2).
// Region in BLOCK counts: x in [0,w), y in [0,h), z in [0,d) — but blockToWorld /
// worldToBlock treat x/z as centred so block (0,0,0) is at x=-w/2, z=-d/2.
export const World = {
  /**
   * C9. Create a world.
   * @param {string} seed
   * @param {{width:number,height:number,depth:number}} region
   * @param {{width:number,height:number,depth:number,get:function}} layout — C8
   *   Layout: get(x,y,z) -> blockId, in-bounds index into this module's grid.
   *   NOTE: layout uses LOCAL indices [0,w)/[0,h)/[0,d); the world grid uses the
   *   SAME local indices (air = 0 outside placed terrain). The pinned world coords
   *   (C9) are a TRANSLATION for rendering, not a different index space.
   * @param {{byId?:function}} deps — byId from block-palette (C5) for id validity.
   */
  create(seed, region, layout, deps = {}) {
    const byId = deps.byId || defaultById;
    const { width: w, height: h, depth: d } = region;
    // Grid stored as flat Uint? we keep a flat Int32Ar—use a plain object grid for
    // clarity; cell key = (x + w) + w*? best as index y*w*d + z*w + x.
    // We store cells in local index space [0,w)x[0,h)x[0,d); get() maps input.
    const cells = new Int32Array(w * h * d);
    const idx = (x, y, z) => (y * d + z) * w + x;
    const inBounds = (x, y, z) => x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d;

    function loadLayout(l) {
      cells.fill(0);
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          for (let x = 0; x < w; x++) {
            const id = l.get(x, y, z) || 0;
            cells[idx(x, y, z)] = id;
          }
        }
      }
    }
    loadLayout(layout);

    const handlers = new Set();   // C11
    const resetHandlers = new Set(); // C18

    return {
      region: { width: w, height: h, depth: d },
      origin: { x: -w / 2, y: 0, z: -d / 2 },

      // C10 get — reads, OOB -> 0
      get(x, y, z) {
        if (!inBounds(x, y, z)) return 0;
        return cells[idx(x, y, z)];
      },

      // C10 set — writes, bounds-checked + valid-block checked; no-op otherwise; void return
      set(x, y, z, id) {
        if (!inBounds(x, y, z)) return undefined;
        const b = byId(id);
        if (!b || b.id !== id) return undefined; // invalid/unknown id -> no-op
        const i = idx(x, y, z);
        const oldId = cells[i];
        if (oldId === id) return undefined; // no-op, do not fire C11
        cells[i] = id;
        handlers.forEach((fn) => fn({ x, y, z, oldId, id }));
        return undefined;
      },

      // C10 neighbors — [ -x, +x, -y, +y, -z, +z ] blockIds, OOB reads 0
      neighbors(x, y, z) {
        return [
          this.get(x - 1, y, z),
          this.get(x + 1, y, z),
          this.get(x, y - 1, z),
          this.get(x, y + 1, z),
          this.get(x, y, z - 1),
          this.get(x, y, z + 1),
        ];
      },

      // C10 blockToWorld — { center:{x,y,z} } in world units (1 block == 1.0)
      blockToWorld(x, y, z) {
        return { center: { x: x - w / 2 + 0.5, y: y, z: z - d / 2 + 0.5 } };
      },

      // C10 worldToBlock — floor from C9 mapping (block coords)
      worldToBlock(p) {
        return {
          x: Math.floor(p.x + w / 2),
          y: Math.floor(p.y),
          z: Math.floor(p.z + d / 2),
        };
      },

      // C10 reset(seed) — rebuild data from a C8 layout for seed, then fire C18 once.
      // NOTE: layout passed by caller (app-shell C1, or tests). No fake C11 events.
      reset(seed, newLayout) {
        if (newLayout) loadLayout(newLayout);
        resetHandlers.forEach((fn) => fn(seed));
      },

      // C11 subscribe — after every set with {x,y,z,oldId,id}; returns unsubscribe
      subscribe(fn) {
        handlers.add(fn);
        return () => handlers.delete(fn);
      },

      // C18 onReset(cb:(seed:string)=>void) — fired once per reset after data rebuild; returns unsubscribe
      onReset(cb) {
        resetHandlers.add(cb);
        return () => resetHandlers.delete(cb);
      },
    };
  },
};
