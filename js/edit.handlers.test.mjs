// FutureCraft — MC 625.1 symptom #3: block break/place must FIRE through the
// pointer-lock input handlers (not just through the pure C15 math functions).
// Prior tests exercised breakBlock/placeAt directly; this one drives the REAL
// DOM path used in production: Edit.create registers mousedown(=break) and
// contextmenu(=place) on the injected `doc` and gates on
// `doc.pointerLockElement === null`. We simulate a lock, dispatch real events,
// a stubbed Raycaster that returns a hit, and assert the world grid mutates.
// Headless: edit.js imports no three; scene/camera/raycaster are injected stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Edit } from './edit.js'; // namespace export { Edit }? fallback below

// edit.js exports: export function create(...), and `export const Edit = { create }`
// (see edit.js tail). Import create directly to be robust to the export shape.
import { create as editCreate } from './edit.js';

const { create } = editCreate && editCreate.create
  ? { create: editCreate.create }            // if namespace wrapped
  : { create: editCreate };                  // direct function export

function fakeDoc() {
  const handlers = {};
  return {
    pointerLockElement: null, // null -> NOT pointer-locked
    addEventListener(ev, fn) { (handlers[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) {
      if (!handlers[ev]) return;
      handlers[ev] = handlers[ev].filter((h) => h !== fn);
    },
    _emit(ev, event) { (handlers[ev] || []).slice().forEach((fn) => fn(event)); },
    lock() { this.pointerLockElement = {}; }, // simulate pointer captured
    unlock() { this.pointerLockElement = null; },
  };
}

function fakeWorld() {
  const calls = [];
  return {
    calls,
    worldToBlock(p) {
      return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
    },
    set(x, y, z, id) { calls.push({ x, y, z, id }); },
  };
}

function fakeRaycaster(hitPoint, hitNormal) {
  return {
    lastOrigin: null,
    setFromCamera(origin, camera) { this.lastOrigin = origin; this.lastCamera = camera; },
    intersectObjects() {
      return [{
        point: hitPoint,
        face: { normal: hitNormal },
        object: {},
      }];
    },
  };
}

function makeScaffold({ hitPoint, hitNormal, locked = true }) {
  const doc = fakeDoc();
  const world = fakeWorld();
  const scene = { children: [] };
  const camera = { isCamera: true };
  const selection = { activeId: 3 };
  const raycaster = fakeRaycaster(hitPoint, hitNormal);
  const edit = create({ world, scene, selection, camera, raycaster, doc });
  if (locked) doc.lock();
  return { doc, world, edit, raycaster };
}

// --- mousedown while pointer-locked = BREAK (set hit block to 0) --------------
test('pointer-locked mousedown LEFT fires break (block set to air)', () => {
  const { doc, world } = makeScaffold({ hitPoint: { x: 2.1, y: 3.1, z: 4.1 }, hitNormal: { x: 0, y: 1, z: 0 } });
  doc._emit('mousedown', { button: 0 });
  assert.equal(world.calls.length, 1,
    `break must issue exactly one world.set, got ${world.calls.length}`);
  assert.deepEqual(world.calls[0], { x: 2, y: 3, z: 4, id: 0 },
    `break sets the hit block to air(0), got ${JSON.stringify(world.calls[0])}`);
});

// --- right-click (contextmenu) while pointer-locked = PLACE active block ------
test('pointer-locked right-click fires place (active id on adjacent face)', () => {
  const { doc, world } = makeScaffold({ hitPoint: { x: 5.2, y: 1.1, z: 5.2 }, hitNormal: { x: 0, y: 1, z: 0 } });
  doc._emit('contextmenu', { preventDefault() {} });
  doc._emit('mousedown', { button: 2 });
  assert.equal(world.calls.length, 1,
    `place must issue exactly one world.set, got ${world.calls.length}`);
  // hit y 1.1 + normal*0.5 => 1.6 -> cell y 2; id = selection.activeId = 3
  assert.deepEqual(world.calls[0], { x: 5, y: 2, z: 5, id: 3 },
    `place writes activeId 3 at the adjacent cell, got ${JSON.stringify(world.calls[0])}`);
});

// --- contextmenu is prevented so the browser menu never steals the pointer ----
test('contextmenu is preventDefault-ed (no native menu while flying)', () => {
  const { doc } = makeScaffold({ hitPoint: { x: 1, y: 1, z: 1 }, hitNormal: { x: 0, y: 1, z: 0 } });
  let prevented = false;
  doc._emit('contextmenu', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'contextmenu must be prevented');
});

// --- NOT pointer-locked => handlers are inert (no world mutation) -------------
test('handlers do NOTHING when the pointer is NOT locked', () => {
  const { doc, world } = makeScaffold({ hitPoint: { x: 2, y: 2, z: 2 }, hitNormal: { x: 0, y: 1, z: 0 }, locked: false });
  doc._emit('mousedown', { button: 0 });
  doc._emit('mousedown', { button: 2 });
  assert.equal(world.calls.length, 0,
    'break/place must not fire before pointer capture');
});

// --- raycaster must be aimed at crosshair centre through setFromCamera ---------
test('break/place raycasts from screen centre along the camera', () => {
  const { doc, raycaster } = makeScaffold({ hitPoint: { x: 0, y: 0, z: 0 }, hitNormal: { x: 1, y: 0, z: 0 } });
  doc._emit('mousedown', { button: 0 });
  assert.deepEqual(raycaster.lastOrigin, { x: 0, y: 0 },
    'raycast must originate at the crosshair (screen centre)');
  assert.equal(raycaster.lastCamera.isCamera, true, 'raycast must use the gameplay camera');
});

// --- dispose removes the listeners (teardown does not leak break/place) -------
test('dispose removes pointer-lock handlers (no edits after teardown)', () => {
  const { doc, world, edit } = makeScaffold({ hitPoint: { x: 9, y: 9, z: 9 }, hitNormal: { x: 0, y: 1, z: 0 } });
  edit.dispose();
  doc._emit('mousedown', { button: 0 });
  doc._emit('contextmenu', { preventDefault() {} });
  doc._emit('mousedown', { button: 2 });
  assert.equal(world.calls.length, 0, 'after dispose, no input may mutate the world');
});

// --- crosshair raycast is +Y-aligned with the view: camera forward is used -----
test('place uses face normal of the top-most hit (populates upward adjacent cell)', () => {
  const { doc, world } = makeScaffold({ hitPoint: { x: 0.1, y: 3.1, z: 0.1 }, hitNormal: { x: 0, y: 1, z: 0 } });
  doc._emit('mousedown', { button: 2 });
  // hit(0.1,3.1,0.1) + normal(0,1,0)*0.5 = (0.1, 3.6, 0.1) -> cell (0, 4, 0)
  assert.deepEqual(world.calls[0], { x: 0, y: 4, z: 0, id: 3 },
    `place above a top hit must target the cell above, got ${JSON.stringify(world.calls[0])}`);
});
