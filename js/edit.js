// FutureCraft — block-edit module (js/edit.js)
// Contracts C14 (Edit.create), C15 (edit math), C16 (input mapping).
// Crosshair raycast to the grid: break on left, place on the adjacent face on
// right, using the active palette block. Depends on world-store (C10 data API,
// injected), selection (C7, injected), camera (C13, injected), and a Raycaster
// (constructed from three by app.js at wiring and passed in — edit.js itself
// has NO three import, so the whole module, math AND create, is testable
// headlessly). NO hud dependency. Edits flow through C11->C12 refresh; never
// touch reset.
//
// The C15 math functions are pure (they only use the injected `world` object),
// so they are unit-testable headlessly with a mocked grid.

// Half-block push along the face normal — C15 place rule.
// Returns the world point used to derive the neighbor cell.
function placeOffsetPoint(p, faceNormal) {
  return {
    x: p.x + faceNormal.x * 0.5,
    y: p.y + faceNormal.y * 0.5,
    z: p.z + faceNormal.z * 0.5,
  };
}

// C15 break: ray hit point p -> worldToBlock(p) -> set(...,0). Returns target cell.
export function breakBlock(world, p) {
  const cell = world.worldToBlock(p);
  world.set(cell.x, cell.y, cell.z, 0);
  return cell;
}

// C15 place: adjacent cell = worldToBlock(p + faceNormal*0.5) -> set(cell, blockId).
// Returns the target cell. Uses the active palette block id (C7) when blockId
// is not given explicitly (i.e. at runtime, id = selection.activeId).
export function placeAt(world, p, faceNormal, blockId) {
  const q = placeOffsetPoint(p, faceNormal);
  const cell = world.worldToBlock(q);
  world.set(cell.x, cell.y, cell.z, blockId);
  return cell;
}

// C14. create(): registers a raycast+input handler active only while pointer-locked.
// `raycaster` is built by app.js from three and passed in (design: "passed at
// wiring by app.js, no import"). Returns { tick, dispose } — app.js (C1) calls
// registerTick(tick) via C2 and calls `dispose` to tear down (removes DOM
// listeners; the C2 unsubscribe handle is app-owned).
export function create({ world, scene, selection, camera, raycaster }) {
  const listeners = [];

  // C16 input mapping: pointer-locked only, left = break, right = place. No keys.
  function onPointerDown(e) {
    if (document.pointerLockElement === null) return; // not locked
    if (!raycaster) return; // cannot raycast without an injected raycaster

    // Crosshair-centered raycast along the camera's forward (render chunks are
    // added to `scene` by app.js/worldrender). If nothing hit, do nothing.
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(scene.children, false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const p = hit.point;
    const normal = hit.face ? hit.face.normal : { x: 0, y: 0, z: 0 };

    if (e.button === 0) {
      // LEFT = break: set the hit block to air (0)
      breakBlock(world, p);
    } else if (e.button === 2) {
      // RIGHT = place: adjacent face using the active palette block
      placeAt(world, p, normal, selection.activeId);
    }
  }

  function onContextMenu(e) { e.preventDefault(); } // keep right-click from opening menu

  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('contextmenu', onContextMenu);
  listeners.push([document, 'mousedown', onPointerDown], [document, 'contextmenu', onContextMenu]);

  // C2-registered by app.js: per-frame hook (reserved; nothing frame-critical yet).
  function tick() {}

  function dispose() {
    for (const [el, type, fn] of listeners) el.removeEventListener(type, fn);
    listeners.length = 0;
  }

  return { tick, dispose };
}

// C14 integration wrapper (MC 371.2). app.js consumes this module as
// `editMod.Edit.create({...})` (nicke 338.11 app-shell), so the module must expose
// the Edit namespace, not only the bare functions. This wrapper namespaces the
// C14 entry point and the C15 math under a single `Edit` object while keeping the
// bare exports intact for the 338.9 unit tests.
export const Edit = { create, breakBlock, placeAt };
