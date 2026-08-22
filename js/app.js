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

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 6, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('app').appendChild(renderer.domElement);

  const registry = createTickRegistry();

  // Region + layout come from worldgen (C8); byId/BLOCKS/selection from
  // block-palette (C5/C7). app-shell C1 assembles these into the world-store
  // and render adapter, then wires player/edit/hud onto the shared handles.
  // worldgen.generate reads {w,h,d}; world.js World.create reads {width,height,depth}.
  const region = { width: 64, height: 24, depth: 64 };
  const genRegion = { w: region.width, h: region.height, d: region.depth };
  const { BLOCKS, byId, selection } = blocksMod;
  const raycaster = new THREE.Raycaster();

  const app = boot({
    seed,
    registry,
    scene,
    renderer,
    camera,
    setAnimationLoop: (fn) => renderer.setAnimationLoop(fn),
    makeWorld: (s) => {
      const layout = worldgenMod.generate(s, genRegion);
      return worldMod.World.create(s, region, layout, { byId });
    },
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
