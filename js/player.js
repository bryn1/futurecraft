// FutureCraft — player-fly module (C13).
// First-person creative fly camera: PointerLock + mouse-look + WASD/space/shift
// + low-gravity feel. Emits state.position/state.direction for block-edit's
// raycast origin. No world-store dependency (I3), no collision (creative only).
// Contracts cited from DESIGN.md §3 player-fly (206.2 rev2):
//   C13 Player.create({camera,domEl,speed?,gravityFeel?}) -> {lock,unlock,update,state}
//       state = {position, direction}; update() wired via C2 registerTick (app-shell).

// ---------------------------------------------------------------------------
// Pure fly kinematics — independent of THREE so it is headless-unit-testable.
// state: {position:{x,y,z}, yaw, pitch}. input: {forward,backward,left,right,up,down}.
// Applies a speed-scaled horizontal wish-vector (from WASD vs yaw) plus a
// vertical component: space/up ascends, shift/down descends at speed; when
// neither up nor down is held, a gentle low-gravity sink (gravityFeel) applies.
// ---------------------------------------------------------------------------
export function applyFly(state, input, { speed, gravityFeel }, dt) {
  const yaw = state.yaw || 0;
  // horizontal wish-vector from WASD relative to facing (yaw about +Y, forward -Z)
  let wx = 0;
  let wz = 0;
  if (input.forward) { wx -= Math.sin(yaw); wz -= Math.cos(yaw); }
  if (input.backward) { wx += Math.sin(yaw); wz += Math.cos(yaw); }
  if (input.right) { wx += Math.cos(yaw); wz -= Math.sin(yaw); }
  if (input.left) { wx -= Math.cos(yaw); wz += Math.sin(yaw); }
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  const pos = state.position;
  pos.x += wx * speed * dt;
  pos.z += wz * speed * dt;

  // vertical: explicit up/down wins; otherwise low-gravity feel sinks
  if (input.up) pos.y += speed * dt;
  else if (input.down) pos.y -= speed * dt;
  else pos.y -= gravityFeel * dt;

  return state;
}

// Facing direction (unit) from yaw/pitch, used as raycast origin by block-edit.
export function directionFrom(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

// ---------------------------------------------------------------------------
// C13 factory. `controls` may be injected (tests / stubbing); when omitted the
// real PointerLockControls is loaded lazily from the three/addons import map on
// the first lock(), keeping the module loadable headless (no top-level bare
// THREE import) and matching the CDN-no-build project setup.
// ---------------------------------------------------------------------------
function createPlayer({ camera, domEl, speed = 8, gravityFeel = 0.35, controls = null } = {}) {
  const state = {
    position: camera.position,
    direction: { x: 0, y: -1, z: 0 }, // default look straight down until facing known
    yaw: 0,
    pitch: 0,
  };

  // keyboard/look input the update() loop reads (wired by the host app or tests)
  const input = {
    forward: false, backward: false, left: false, right: false,
    up: false, down: false,
  };

  let _controls = controls;
  let _controlsPromise = null;

  async function ensureControls() {
    if (_controls) return _controls;
    if (!_controlsPromise) {
      // C3 addons import map: three/addons maps to CDN; resolved only at runtime.
      const mod = await import('three/addons/controls/PointerLockControls.js');
      _controls = new mod.PointerLockControls(camera, domEl);
    }
    return _controls;
  }

  function syncFacing() {
    // pull yaw/pitch from the controls' camera rotation (YXZ euler) when available
    if (_controls && typeof _controls.getObject === 'function') {
      const rot = _controls.getObject().rotation;
      state.yaw = rot.y || 0;
      state.pitch = rot.x || 0;
    }
  }

  return {
    state,
    // ---- input API (real app wires keydown/keyup here; tests drive directly) ----
    press(key) { if (key in input) input[key] = true; },
    release(key) { if (key in input) input[key] = false; },

    // ---- C13 lock/unlock ----
    async lock() {
      const c = await ensureControls();
      if (!c.isLocked) c.lock(); // request pointer lock
    },
    // C13 unlock(): void — synchronous. lock() is async and always runs first in
    // the browser (awaiting it guarantees controls exist), so unlock needs no
    // pending load; it is a no-op if the controls were never created.
    unlock() {
      if (_controls && _controls.isLocked) _controls.unlock();
    },

    // ---- C13 update(dt): called each tick via C2 registerTick ----
    update(dt) {
      syncFacing();
      applyFly(state, input, { speed, gravityFeel }, dt);
      // write integrated position back to the camera so raycasts originate there
      camera.position.x = state.position.x;
      camera.position.y = state.position.y;
      camera.position.z = state.position.z;
      // emit facing for block-edit's raycast origin
      const d = directionFrom(state.yaw, state.pitch);
      state.direction.x = d.x;
      state.direction.y = d.y;
      state.direction.z = d.z;
      return state;
    },
  };
}

// C13 contract shape: Player.create({camera,domEl,speed?,gravityFeel?}) -> Player
// Note: exported object (namespace) so `Player.create(...)` reads as the contract.
export const create = createPlayer;
export const Player = { create: createPlayer };
