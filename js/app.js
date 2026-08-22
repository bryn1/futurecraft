// app.js — FutureCraft app-shell module.
// Contracts: C1 (main + composition root), C2 (registerTick registry),
//            C3 (index.html importmap - see index.html), C18->C19 reset wire.
//
// Design: this file must be headless-loadable in node (for unit tests) WITHOUT
// resolving 'three' or the sibling modules (world.js, worldrender.js, player.js,
// edit.js, ui.js) at import time. Those are only guaranteed present at integration
// time in the browser. So the pure wiring (`createTickRegistry`, `readSeed`,
// `boot`) never touches THREE or the siblings — it operates on injected factories.
// `main()` is the browser entry and does the dynamic imports at runtime.

export const DEFAULT_SEED = 'futurecraft';

// --- C1: read seed from the URL --------------------------------------------
export function readSeed(search = window.location.search) {
  const p = new URLSearchParams(search);
  return p.get('seed') || DEFAULT_SEED;
}

// --- C2: registerTick global tick registry ----------------------------------
export function createTickRegistry() {
  const fns = [];
  return {
    size() { return fns.length; },
    registerTick(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('registerTick expects a function');
      }
      fns.push(fn);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const i = fns.indexOf(fn);
        if (i !== -1) fns.splice(i, 1);
      };
    },
    // Snapshot first so unsubscribing a handler mid-run doesn't skip siblings.
    run(dt) {
      fns.slice().forEach((fn) => fn(dt));
    },
  };
}

// C1 helper: gather the per-frame hooks of the modules that animate.
// Player exposes `update(dt)` (C13); block-edit exposes `tick(dt)` (C14,
// documented: "app.js calls registerTick(tick) via C2"). Every such hook is
// registered into the registry so the single loop drives it.
export function collectUpdates(...modules) {
  const fns = [];
  for (const m of modules) {
    if (!m) continue;
    const h = m.update || m.tick;
    if (typeof h === 'function') fns.push(h.bind(m));
  }
  return fns;
}

// --- FIX 402.1: safe spawn height -------------------------------------------
// Blocks are a solid grid. A hardcoded camera Y can land INSIDE terrain — the old
// camera.position.set(0, 6, 14) sat ~9 blocks UNDER the surface at that column for
// the default seed, so the viewport was inside solid blocks: a blank screen
// (esp. on phone, the card's symptom). Instead, pick a fixed spawn COLUMN and
// derive the camera Y from the actual generated terrain: top of the column's
// surface plus a headroom of open air, clamped into the world height band.
// Worlds are deterministic per seed, so the layout at boot IS the layout the
// camera sees. This is pure / headless-importable, so it is unit-testable.
export const SPAWN = { x: 2, z: 2 };  // low-relief corner of the region (see worldgen)
export const SPAWN_HEADROOM = 4;      // blocks of clear air above the surface
export const SPAWN_MIN_Y = 2;         // never put the camera below this band

// layout must expose get(x, y, z) -> block id (0 = air). Returns the camera Y
// that places the camera in open air just above the local terrain surface.
export function computeSpawnY(
  layout,
  { x, z, headroom = SPAWN_HEADROOM, minY = SPAWN_MIN_Y, maxY },
) {
  if (!maxY) throw new TypeError('computeSpawnY requires maxY (world height)');
  let surface = -1; // top-most solid y under the column, -1 if all air
  for (let y = 0; y < maxY; y++) {
    if (layout.get(x, y, z) !== 0) surface = y;
  }
  const raw = surface >= 0 ? surface + headroom : headroom;
  return Math.max(minY, Math.min(raw, maxY - 1));
}

// --- FIX 404.1: spawn-camera look-down ---------------------------------------
// The player-fly contract (player.js) defaults the look direction to straight
// down `{x:0, y:-1, z:0}` "until facing known", but the composed camera booted
// with rotation (0,0,0) — level pitch, pointing off the region edge from the
// corner spawn (SPAWN at x=2,z=2; facing -Z leaves the 64x64 region immediately).
// The owner directed a fix on the app-shell: pitch the SPAWN camera DOWN at the
// terrain so the voxel world fills the frame at boot, before the player locks the
// pointer. This stays pure / headless-importable (layout math only), so it is
// unit-testable exactly like computeSpawnY.
export const SPAWN_LOOK_AHEAD = 1; // aim one block ahead of the feet along facing

// cameraY : the spawn camera Y (open air above the terrain, from computeSpawnY).
// layout  : must expose get(x,y,z) -> block id (0 = air).
// Returns a downward camera pitch in radians (negative = looking down, THREE YXZ
// euler -> set camera.rotation.x). Aims at the terrain surface below the spawn so
// a spawned camera always frames real voxel earth, for any seed / world height.
export function computeSpawnLookPitch(
  cameraY,
  layout,
  { x, z, maxY, ahead = SPAWN_LOOK_AHEAD },
) {
  if (!Number.isFinite(cameraY) || !maxY || !layout) {
    throw new TypeError('computeSpawnLookPitch(cameraY, layout, {x,z,maxY,ahead})');
  }
  const surfaceAt = (cx, cz) => {
    let s = -1;
    for (let y = 0; y < maxY; y++) if (layout.get(cx, y, cz) !== 0) s = y;
    return s;
  };
  // Aim at the terrain just ahead of the feet ALONG THE FACING (-Z), so the
  // ground fills the lower frame as you spawn looking down the -Z axis; never
  // aim at air. If that ahead column is empty (region edge — the default corner
  // spawn faces straight out of the 64x64 region), fall back to aiming straight
  // down at the ground under the spawn column instead. Either way the spawned
  // camera frames real voxel earth, never the void.
  let sx = x;
  let sz = z - ahead;
  let horiz = ahead;
  if (surfaceAt(sx, sz) < 0) {
    sz = z;
    horiz = 1;
  }
  const surfaceY = surfaceAt(sx, sz);
  const targetY = surfaceY >= 0 ? surfaceY + 1 : 1;
  const drop = Math.max(cameraY - targetY, 0.25);
  return -Math.atan2(drop, horiz);
}

// --- C1: lock overlay --------------------------------------------------------
// Present the "Click to play" overlay first (I5). Takes DOM handles so it is
// unit-testable headless. The overlay is hidden once pointer lock engages, and
// re-shown when it is lost so the player can resume. Returns a dispose().
export function prepareLockOverlay({ overlay, playBtn, onPlay }) {
  if (!overlay || !playBtn) return () => {};
  const show = () => { overlay.hidden = false; };
  const hide = () => { overlay.hidden = true; };
  const onPointerLockChange = () => {
    if (document.pointerLockElement) hide();
    else show();
  };
  const onClick = async () => {
    try {
      if (onPlay) await onPlay();
      // If the engine did not lock synchronously, wait for the lockchange event.
    } catch (err) {
      console.error('[futurecraft] play failed', err);
      show();
    }
  };
  playBtn.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  show();
  return () => {
    playBtn.removeEventListener('click', onClick);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
  };
}

// --- C1: composition root ----------------------------------------------------
// deps =
//   seed           : string
//   registry       : createTickRegistry()
//   scene          : THREE.Scene handle
//   setAnimationLoop(fn) : single rAF hook (renderer.setAnimationLoop)
//   makeWorld(seed)      : world-store data (C9/C10/C18)
//   makeRenderer(world, scene) : worldrender adapter (C12/C19)
//   makePlayer(deps)     : player-fly (C13)
//   makeEdit(deps)       : block-edit (C14)
//   makeHud(deps)        : hud (C17)
export function boot({
  seed,
  registry,
  scene,
  setAnimationLoop,
  makeWorld,
  makeRenderer,
  makePlayer,
  makeEdit,
  makeHud,
}) {
  // ESM graph note: we do NOT import the sibling modules here. The caller passes
  // factories that (in main()) overcome the real modules (three + siblings).

  const world = makeWorld(seed);
  const worldRenderer = makeRenderer(world, scene);

  // C18 -> C19 wire: a reset reverts DATA (world.reset rebuilds the grid and fires
  // C18) AND RENDER together (worldRenderer.rebuildAll reconstructs the scene from
  // the current grid). One subscription, one consumer.
  const offReset = world.onReset((s) => worldRenderer.rebuildAll(s));

  // Draw the starting world immediately at boot. rebuildAll is otherwise only
  // wired to world.onReset, so without this call the initial grid is never
  // rendered (a blank world) until the player triggers a reset.
  if (typeof worldRenderer.rebuildAll === 'function') {
    worldRenderer.rebuildAll(seed);
  } else if (typeof worldRenderer.refresh === 'function') {
    worldRenderer.refresh(seed);
  }

  // Build the other modules with the shared handles (C1 seam).
  const shared = { world, scene, worldRenderer, registry };
  const player = makePlayer ? makePlayer(shared) : null;
  const edit = makeEdit ? makeEdit(shared) : null;
  const hud = makeHud ? makeHud(shared) : null;

  // Every animation-updating module registers its tick via C2; app.js owns the
  // single loop (renderer.setAnimationLoop) that drives all of them.
  for (const fn of collectUpdates(player, edit)) {
    registry.registerTick(fn);
  }

  // Single rAF loop. time is ms since start; our ticks expect dt in ms-equivalent.
  setAnimationLoop((time) => registry.run(typeof time === 'number' ? time : 0));

  return {
    world,
    worldRenderer,
    player,
    edit,
    hud,
    registry,
    dispose() {
      offReset();
    },
  };
}

// --- C1: browser entry --------------------------------------------------------
// Dynamic imports only: 'three' and the sibling modules are resolved by the
// browser's importmap (C3 in index.html) at runtime, never at app.js load time.
export async function main() {
  const seed = readSeed();

  const [
    THREE,
    blocksMod,
    worldgenMod,
    worldMod,
    worldRenderMod,
    playerMod,
    editMod,
    hudMod,
  ] = await Promise.all([
    import('three'),
    import('./blocks.js'),
    import('./worldgen.js'),
    import('./world.js'),
    import('./worldrender.js'),
    import('./player.js'),
    import('./edit.js'),
    import('./ui.js'),
  ]);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);

  // Scene lighting (FIX 386.1): blocks use MeshLambertMaterial (worldrender.js),
  // which REQUIRES a light to be lit — with zero lights every block renders pure
  // black. Add a soft ambient floor light so no face is pure black, and one
  // directional key light for visible shading/depth. Lights are owned by the
  // app-shell (C1) here, the browser entry where THREE is in scope, so boot()
  // stays headless-importable.
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  // FIX 402.1: region + layout must exist BEFORE the camera so the spawn can be
  // placed above the actually-generated terrain (see computeSpawnY). The layout
  // is deterministic per seed and is reused by makeWorld() below (no double gen).
  const region = { width: 64, height: 24, depth: 64 };
  const genRegion = { w: region.width, h: region.height, d: region.depth };
  const seedLayout = worldgenMod.generate(seed, genRegion);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  // FIX 402.1: spawn in OPEN AIR above the terrain, not buried inside it. The old
  // hardcoded (0, 6, 14) sat inside solid terrain for the default seed -> blank.
  camera.position.set(
    SPAWN.x,
    computeSpawnY(seedLayout, { x: SPAWN.x, z: SPAWN.z, maxY: region.height }),
    SPAWN.z,
  );
  // FIX 404.1: pitch the SPAWN camera DOWN at the terrain. The player-fly contract
  // defaults the look straight down until facing is known, but the camera booted
  // level (rotation 0,0,0) — from the corner spawn that is the void past the
  // region edge, compounding the blank. Look-down at the real terrain instead.
  // Pure layout math (see computeSpawnLookPitch), applied once at boot.
  const spawnPitch = computeSpawnLookPitch(
    camera.position.y,
    seedLayout,
    { x: SPAWN.x, z: SPAWN.z, maxY: region.height },
  );
  camera.rotation.set(spawnPitch, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('app').appendChild(renderer.domElement);

  const registry = createTickRegistry();

  // Region + layout come from worldgen (C8); byId/BLOCKS/selection from
  // block-palette (C5/C7). app-shell C1 assembles these into the world-store
  // and render adapter, then wires player/edit/hud onto the shared handles.
  // worldgen.generate reads {w,h,d}; world.js World.create reads {width,height,depth}.
  const { BLOCKS, byId, selection } = blocksMod;
  const raycaster = new THREE.Raycaster();

  const app = boot({
    seed,
    registry,
    scene,
    renderer,
    camera,
    setAnimationLoop: (fn) => renderer.setAnimationLoop(fn),
    // FIX 402.1: reuse the already-generated boot layout when asked for the
    // boot seed (deterministic -> identical world, no double generation); for
    // any other seed, generate on demand exactly as before.
    makeWorld: (s) => worldMod.World.create(
      s,
      region,
      s === seed ? seedLayout : worldgenMod.generate(s, genRegion),
      { byId },
    ),
    makeRenderer: (w) =>
      worldRenderMod.WorldRenderer.create(scene, w, { three: THREE, BLOCKS, byId }),
    makePlayer: () => playerMod.Player.create({ camera, domEl: renderer.domElement }),
    makeEdit: (shared) =>
      editMod.Edit.create({ world: shared.world, scene, selection, camera, raycaster }),
    makeHud: (shared) =>
      hudMod.Hud.create({
        selection,
        onReset: (seedStr) =>
          shared.world.reset(seedStr, worldgenMod.generate(seedStr, genRegion)),
      }),
  });

  // Show the "Click to play" overlay first; on click, lock the pointer via player.
  const overlay = document.getElementById('lock-overlay');
  const playBtn = document.getElementById('play-btn');
  const disposeOverlay = prepareLockOverlay({
    overlay,
    playBtn,
    onPlay: () => (app.player && app.player.lock ? app.player.lock() : Promise.resolve()),
  });

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Expose for HUD / debugging without a global store.
  window.__futurecraft = { app, scene, camera, renderer, three: THREE, disposeOverlay };

  return app;
}
