// FutureCraft world-store RENDER ADAPTER: js/worldrender.js.
// Implements C12 (create -> {refresh,rebuildAll,getObjects}), C19 (rebuildAll,
// idempotent full rebuild from current world state), C20 (pre-register all non-air
// block types up front, each InstancedMesh sized to region max cell count).
//
// THREE is NOT hard-imported: this module runs headlessly against an injected
// THREELike object (three.js API surface: BoxGeometry, MeshLambertMaterial,
// InstancedMesh, Matrix4), and against the real three.js at app wiring (C1).
// Same DI pattern as world.js: BLOCKS/byId come from block-palette at caller.
export const WorldRenderer = {
  /**
   * C12. Create the render adapter.
   * @param {THREE.Scene} scene — scene to add meshes to (must have .add)
   * @param {import('./world.js').World} world — World with .region and .get
   * @param {{three:object, BLOCKS:object, byId:function}} deps
   * @returns {{refresh:function, rebuildAll:function, getObjects:function}}
   */
  create(scene, world, deps) {
    const THREE = deps.three;
    const BLOCKS = deps.BLOCKS;
    const byId = deps.byId;
    const { BoxGeometry, MeshLambertMaterial, InstancedMesh, Matrix4 } = THREE;

    const { width: w, height: h, depth: d } = world.region;
    const maxCells = w * h * d; // C20: size each mesh to region max cell count

    // BUG-382.1: real THREE.Matrix4.compose(position, quaternion, scale) REQUIRES
    // all three args (it reads quaternion._x and scale.x). Passing a lone position
    // crashed rebuildAll with "Cannot read properties of undefined (reading '_x')".
    // Build DI-safe compose args: real Quaternion/Vector3 when THREE provides them
    // (identity quaternion + unit scale = pure translation), plain-object fallback
    // for the THREELike test harness (which ignores quaternion/scale).
    const mkQ = () => (typeof THREE.Quaternion === 'function'
      ? new THREE.Quaternion() : { x: 0, y: 0, z: 0, w: 1 });
    const mkS = () => (typeof THREE.Vector3 === 'function'
      ? new THREE.Vector3(1, 1, 1) : { x: 1, y: 1, z: 1 });
    const mkP = (v) => (typeof THREE.Vector3 === 'function'
      ? new THREE.Vector3(v.x, v.y, v.z) : { x: v.x, y: v.y, z: v.z });
    const composeAt = (pos) => new Matrix4().compose(mkP(pos), mkQ(), mkS());

    // Collect all NON-AIR block types from the registry (C20): id !== 0.
    // BLOCKS is a frozen Map (blocks.js C4) — but support both shapes: a Map
    // exposes .values(); a plain object must go through Object.values(). The
    // old Object.values(BLOCKS) returned [] for a Map (renders empty).
    const records = typeof BLOCKS.values === 'function' ? BLOCKS.values() : Object.values(BLOCKS);
    const seen = new Set();
    const uniqueTypes = [];
    for (const raw of records) {
      const t = raw || {};
      const id = typeof t.id === 'string' ? Number(t.id) : t.id;
      if (!(Number.isInteger(id) && id > 0)) continue; // skip 0 (air) and unknowns
      if (seen.has(id)) continue;
      seen.add(id);
      uniqueTypes.push({ ...t, id });
    }

    // Pre-register one InstancedMesh per non-air type, sized to maxCells.
    const meshes = {}; // id -> InstancedMesh
    for (const t of uniqueTypes) {
      const geo = new BoxGeometry(1, 1, 1); // one block == 1.0 unit (C9)
      const mat = new MeshLambertMaterial({ color: t.color, emissive: t.emissive || 0 });
      const mesh = new InstancedMesh(geo, mat, maxCells);
      mesh.count = 0;          // no instances yet
      mesh.visible = true;
      mesh.matrixAutoUpdate = false;
      meshes[t.id] = mesh;
      if (scene && typeof scene.add === 'function') scene.add(mesh);
    }

    // C19: rebuild all meshes from the current world state. Idempotent: clears each
    // mesh's instanceMatrix before repopulating (so re-run !== duplication).
    function rebuildAll() {
      const max = maxCells;
      for (const t of uniqueTypes) {
        const mesh = meshes[t.id];
        // reset to empty; count will be rewritten below
        let n = 0;
        // iterate every cell; air & OOB skipped (get returns 0 for matching)
        for (let y = 0; y < h; y++) {
          for (let z = 0; z < d; z++) {
            for (let x = 0; x < w; x++) {
              if (world.get(x, y, z) !== t.id) continue;
              if (n >= max) continue; // safety: never exceed pre-registered size
              const c = world.blockToWorld(x, y, z);
              const m = composeAt(c.center);
              mesh.setMatrixAt(n, m);
              n++;
            }
          }
        }
        mesh.count = n;
        if (mesh.instanceMatrix && 'needsUpdate' in mesh.instanceMatrix) {
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }

    return {
      // C12 refresh: re-read current world and repopulate (calls rebuildAll).
      refresh: rebuildAll,
      // C19 alias per design naming (getObjects is for test/introspection).
      rebuildAll,
      // Expose meshes keyed by block id (getObjects adapter for tests/introspection).
      getObjects: () => meshes,
    };
  },
};
