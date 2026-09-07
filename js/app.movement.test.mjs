// FutureCraft — MC 586.1 / 625.1 movement-controls & view-relative fly tests.
// Two regressions under one composition root cause (the app-shell never WIRED the
// keyboard to the player-fly input API, and the rAF delta was fed in milliseconds
// against per-second constants):
//   (1) installMovementControls binds W/S/A/D + Space/Shift to player.press/release;
//   (2) applyFly computes the horizontal wish-vector from state.yaw (~ the camera's
//       facing), so holding W moves ALONG the view direction, not world-fixed —
//       i.e. WASD follows the mouse-look, exactly what the owner reported missing.
// Headless: app.js is importable without THREE/siblings; edit/pure fns imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMovementControls, MOVE_KEYS } from './app.js';
import { applyFly, directionFrom } from './player.js';

const EPS = 1e-9;

// --- tiny event-emitter stand-in for the injected `doc` ----------------------
function fakeDoc() {
  const handlers = {};
  return {
    addEventListener(ev, fn) { (handlers[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) {
      if (!handlers[ev]) return;
      handlers[ev] = handlers[ev].filter((h) => h !== fn);
    },
    _emit(ev, event) { (handlers[ev] || []).slice().forEach((fn) => fn(event)); },
  };
}

function recordingPlayer() {
  const pressed = [];
  const released = [];
  return {
    press(k) { pressed.push(k); },
    release(k) { released.push(k); },
    pressed, released,
  };
}

// --- (1) keyboard → press/release wiring --------------------------------------
test('installMovementControls maps WASD/Space/Shift to player.press on keydown', () => {
  const doc = fakeDoc();
  const p = recordingPlayer();
  const dispose = installMovementControls({ player: p, doc });

  for (const [code, expect] of [
    ['KeyW', 'forward'], ['KeyA', 'left'], ['KeyS', 'backward'], ['KeyD', 'right'],
    ['Space', 'up'], ['ShiftLeft', 'down'], ['ShiftRight', 'down'],
  ]) {
    doc._emit('keydown', { code, preventDefault() {} });
  }
  assert.deepEqual(p.pressed, ['forward', 'left', 'backward', 'right', 'up', 'down', 'down'],
    'every mapped code must press the right fly direction');
  dispose();
});

test('installMovementControls releases on keyup (WASD truly toggled, not sticky)', () => {
  const doc = fakeDoc();
  const p = recordingPlayer();
  installMovementControls({ player: p, doc });

  doc._emit('keydown', { code: 'KeyW', preventDefault() {} });
  doc._emit('keyup', { code: 'KeyW' });
  doc._emit('keydown', { code: 'KeyW', preventDefault() {} });
  doc._emit('keyup', { code: 'KeyW' });
  assert.deepEqual(p.pressed, ['forward', 'forward']);
  assert.deepEqual(p.released, ['forward', 'forward'],
    'each keydown must pair with a keyup release so the fly state never sticks');
});

test('installMovementControls ignores unmapped keys (does not press anything)', () => {
  const doc = fakeDoc();
  const p = recordingPlayer();
  installMovementControls({ player: p, doc });
  doc._emit('keydown', { code: 'KeyQ', preventDefault() {} }); // unbound
  doc._emit('keydown', { code: 'Digit1', preventDefault() {} }); // HUD-owned
  assert.deepEqual(p.pressed, [], 'unmapped codes must not reach the player');
});

test('installMovementControls Space preventDefaults (no page scroll / button click)', () => {
  const doc = fakeDoc();
  const p = recordingPlayer();
  installMovementControls({ player: p, doc });
  let prevented = false;
  doc._emit('keydown', { code: 'Space', preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'Space keydown must call preventDefault');
});

test('installMovementControls Dispose removes all listeners (no leak on teardown)', () => {
  const doc = fakeDoc();
  const p = recordingPlayer();
  const dispose = installMovementControls({ player: p, doc });
  dispose();
  doc._emit('keydown', { code: 'KeyW', preventDefault() {} });
  assert.deepEqual(p.pressed, [], 'after dispose, NO keys reach the player');
});

test('installMovementControls throws without a real player (cannot silently no-op)', () => {
  assert.throws(() => installMovementControls({ player: null, doc: fakeDoc() }),
    /requires a player with press\/release/);
  assert.throws(() => installMovementControls({ player: {}, doc: fakeDoc() }),
    /requires a player with press\/release/);
});

test('MOVE_KEYS covers the canonical bindings and nothing surprising', () => {
  assert.equal(MOVE_KEYS.KeyW, 'forward');
  assert.equal(MOVE_KEYS.KeyS, 'backward');
  assert.equal(MOVE_KEYS.KeyA, 'left');
  assert.equal(MOVE_KEYS.KeyD, 'right');
  assert.equal(MOVE_KEYS.Space, 'up');
  assert.ok(MOVE_KEYS.ShiftLeft === 'down' && MOVE_KEYS.ShiftRight === 'down');
});

// --- (2) WASD follows the view (yaw-relative wish-vector) ----------------------
function stateAt(y = 0, x = 0, z = 0, yaw = 0, pitch = 0) {
  return {
    position: { x, y, z },
    direction: { x: 0, y: 0, z: 0 },
    yaw, pitch,
  };
}
function key(flag) { return { forward: flag, backward: false, left: false, right: false, up: false, down: false }; }

test('forward wish-vector matches the view-facing direction (directionFrom yaw)', () => {
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const s = stateAt(0, 0, 0, yaw, 0);
    applyFly(s, key(true), { speed: 8, gravityFeel: 0.35 }, 1);
    const dir = directionFrom(yaw, 0);
    // After 1s at speed 8, displacement (x,z) must be positive-multiple of dir(x,z)
    assert.ok(Math.abs(s.position.x) > 1e-6 || Math.abs(s.position.z) > 1e-6,
      `moving at yaw=${yaw} must produce displacement`);
    // Normalize and compare direction componentwise (within float tolerance)
    const len = Math.hypot(s.position.x, s.position.z);
    assert.ok(Math.abs((s.position.x / len) - (dir.x || 0)) < 1e-6 &&
              Math.abs((s.position.z / len) - (dir.z || 0)) < 1e-6,
      `forward must equal facing dir at yaw=${yaw}; got dx=${s.position.x},dz=${s.position.z}, expected dir=${dir.x},${dir.z}`);
  }
});

test('turning 180 degrees inverts the forward motion (WASD genuinely view-relative)', () => {
  const a = stateAt(0, 0, 0, 0, 0);
  const b = stateAt(0, 0, 0, Math.PI, 0);
  applyFly(a, key(true), { speed: 8, gravityFeel: 0.35 }, 1);
  applyFly(b, key(true), { speed: 8, gravityFeel: 0.35 }, 1);
  // Facing +Z vs -Z: displacements along z must be exact opposites
  assert.ok(Math.abs((a.position.z) + (b.position.z)) < 1e-6,
    `turning 180° must flip z travel; got z=${a.position.z} vs ${b.position.z}`);
  assert.ok(Math.abs(a.position.x - b.position.x) < 1e-6,
    `turning 180° keeps x travel identical, got ${a.position.x} vs ${b.position.x}`);
});

test('ms-delta would fly 1000x too far — the fixed loop feeds PER-SECOND dt', () => {
  // speed is per-second. If the loop fed a raw 16.7ms delta, one frame would move
  // speed*16.7 ~= 134 u (destructive); feeding dt=0.0167 s moves speed*0.0167 = 0.134u.
  const s = stateAt(0, 0, 0, 0, 0);
  applyFly(s, key(true), { speed: 8, gravityFeel: 0.35 }, 0.0167); // ~ one 60fps frame, seconds
  assert.ok(Math.abs(s.position.z + 8 * 0.0167) < 1e-6,
    `one 60fps frame must move speed*0.0167 = ${(8 * 0.0167).toFixed(4)} u, got z=${s.position.z}`);
  // And the sink in one frame is 0.35*0.0167 = 0.0058 u (not ~6 u/ frame from raw ms)
  const s2 = stateAt(0, 0, 0, 0, 0);
  applyFly(s2, { forward: false, backward: false, left: false, right: false, up: false, down: false },
    { speed: 8, gravityFeel: 0.35 }, 0.0167);
  assert.ok(Math.abs(s2.position.y + 0.35 * 0.0167) < 1e-6,
    `one-frame sink must stay tiny (0.35*0.0167), got y=${s2.position.y}`);
});
