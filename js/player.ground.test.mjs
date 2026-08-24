// FutureCraft — player-fly terrain floor clamp tests (MC 586.1).
// The camera used to sink forever through the terrain into the void (black
// screen) because applyFly's idle gravity feel had no ground/collision. This
// fix adds an OPTIONAL getGroundY(xWorld,zWorld) dep: when present, pos.y is
// clamped to never drop below the walkable surface of the terrain column under
// the camera. Headless — pure applyFly + Player.create with injected deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFly, Player } from './player.js';

const EPS = 1e-9;

function baseState(y = 0, x = 0, z = 0) {
  return { position: { x, y, z }, direction: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
}
function noKeys() {
  return { forward: false, backward: false, left: false, right: false, up: false, down: false };
}

// A flat terrain: surface at groundY 5 for every (x,z) in range. getGroundY is
// the dep the app wires; returning a plain number here keeps the test about the
// CLAMP, not about world/worldgen.
const flatGround = (groundY) => () => groundY;

// --- MC 586.1 core: idle for a LONG dt / infinite frames never sinks below
// the terrain surface (the regression the card filed). ----------------------
test('idle sinks toward but NEVER below the terrain floor (long single dt)', () => {
  const s = baseState(0, 0, 0); // camera starts at 0, far above ground 2
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: flatGround(2) };
  // One gigantic dt (as if the session ran an enormous number of frames):
  applyFly(s, noKeys(), opts, 1000000);
  assert.ok(s.position.y >= 2 - EPS,
    `idle (no up/down) must clamp at ground, got y=${s.position.y}`);
  assert.ok(Math.abs(s.position.y - 2) < 1e-6,
    `idle clamps exactly at groundY, got y=${s.position.y}`);
});

test('idle stays at ground across MANY frames (infinite-frames bound)', () => {
  const s = baseState(0, 0, 0);
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: flatGround(2) };
  for (let i = 0; i < 100000; i++) applyFly(s, noKeys(), opts, 100); // 10k s of frames
  assert.ok(s.position.y >= 2 - EPS,
    `after 100k frames y must never drop below ground, got y=${s.position.y}`);
});

// --- backwards compatibility: no getGroundY -> existing gentle-sink preserved
test('no getGroundY: idle still sinks by gravityFeel*dt (back-compat)', () => {
  const s = baseState(0, 0, 0);
  applyFly(s, noKeys(), { speed: 8, gravityFeel: 0.35 }, 2);
  assert.ok(Math.abs(s.position.y + 0.7) < 1e-6,
    `without a ground the old low-gravity feel is unchanged, got y=${s.position.y}`);
});

// --- hold down: descends at speed but clamps at the floor, never through it
test('holding down descends but clamps at the terrain floor', () => {
  const s = baseState(50, 0, 0); // high above ground 5
  const inp = noKeys(); inp.down = true;
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: flatGround(5) };
  applyFly(s, inp, opts, 10); // would descend 80 units -> should stop at 5
  assert.ok(s.position.y >= 5 - EPS,
    `down-hold must clamp at ground never go through, got y=${s.position.y}`);
  assert.ok(Math.abs(s.position.y - 5) < 1e-6, `clamps exactly at 5, got y=${s.position.y}`);
});

// --- holding up (ascend) is unaffected by the floor clamp
test('holding up ascends freely above the clamp floor', () => {
  const s = baseState(5, 0, 0); // already at ground 5
  const inp = noKeys(); inp.up = true;
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: flatGround(5) };
  applyFly(s, inp, opts, 2);
  assert.ok(Math.abs(s.position.y - (5 + 16)) < 1e-6,
    `up must lift above the ground, got y=${s.position.y}`);
});

// --- getGroundY returning null/undefined (no terrain) -> no clamp applied
test('getGroundY yielding null (void beyond region) applies no clamp', () => {
  const s = baseState(500, 0, 0);
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: () => null };
  applyFly(s, noKeys(), opts, 100);
  assert.ok(s.position.y < 500 - EPS, 'no terrain -> gentle sink continues (unchanged)');
});

// --- ground clamp also corrects a camera already sunk into the void
test('clamp recovers a camera already below the ground back to the floor', () => {
  const s = baseState(-58000, 0, 0); // the observed runaway depth from the card
  const opts = { speed: 8, gravityFeel: 0.35, getGroundY: flatGround(4) };
  applyFly(s, noKeys(), opts, 16);
  assert.ok(Math.abs(s.position.y - 4) < 1e-6,
    `already-sunk camera must clamp back to ground, got y=${s.position.y}`);
});

// --- Player.create wires getGroundY through update() so the LIVE loop clamps
test('Player.create passes getGroundY into update() so camera never sinks', () => {
  const camera = { position: { x: 0, y: 0, z: 0 } };
  const controls = {
    isLocked: true,
    getObject: () => ({ rotation: { order: 'YXZ', y: 0, x: 0 } }),
  };
  const player = Player.create({
    camera, domEl: {}, speed: 8, gravityFeel: 0.35,
    getGroundY: flatGround(3), controls,
  });
  for (let i = 0; i < 5000; i++) player.update(16); // push through many frames
  assert.ok(camera.position.y >= 3 - EPS,
    `camera must stay at/below-clamped ground through update loop, got camera.y=${camera.position.y}`);
});
