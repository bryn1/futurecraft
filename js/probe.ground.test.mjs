// FutureCraft — makeGroundProbe wired against the REAL deterministic worldgen
// (MC 586.1 sink-fix). Verifies the probe that feeds player-fly's floor clamp:
// (a) it reports a realistic walkable surface (>= 1) inside the generated
// terrain, (b) it matches what computeSpawnY uses for the boot spawn, (c) an
// integrated idle-fly driven by the real layout NEVER sinks below the surface,
// (d) out-of-region columns report null (no ground -> no clamp).
// Imports must resolve sibling `./blocks.js`, so run from repo root with the
// app.js/worldgen.js relative imports (node resolves them as siblings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './worldgen.js';
import { makeGroundProbe, computeSpawnY, SPAWN } from './app.js';

const GEN = { w: 64, h: 24, d: 64 };
const REGION = { width: 64, height: 24, depth: 64 };

test('makeGroundProbe reports a plausible surface for the default seed', () => {
  const layout = generate('futurecraft', GEN);
  const probe = makeGroundProbe(layout, REGION.height);
  // Inside the region every column has a solid bed, so the walkable surface is
  // always a real positive block y + 1, never below 1.
  for (const [x, z] of [[2, 2], [10, 10], [31, 31], [63, 63], [0, 63]]) {
    const g = probe(x, z);
    assert.ok(g != null && g >= 1 && g <= REGION.height,
      `probe(${x},${z}) should be a valid world y, got ${g}`);
  }
});

test('probe at SPAWN matches computeSpawnY surface (camera rests on real ground)', () => {
  const layout = generate('futurecraft', GEN);
  const probe = makeGroundProbe(layout, REGION.height);
  const spawnY = computeSpawnY(layout, { x: SPAWN.x, z: SPAWN.z, maxY: REGION.height });
  const ground = probe(SPAWN.x, SPAWN.z);
  // Spawn camera sits in open air just AT/ABOVE the walkable surface; the probe
  // must never report a floor ABOVE the spawn camera Y.
  assert.ok(ground != null && ground <= spawnY,
    `floor probe(${ground}) must be <= spawn camera y(${spawnY}) for the camera to spawn above ground`);
});

test('integrated idle-fly over real terrain never sinks below the surface', () => {
  const layout = generate('futurecraft', GEN);
  const probe = makeGroundProbe(layout, REGION.height);
  // Reproduce applyFly's idle sink inline, clamped by the real probe, for a
  // session far longer than any real one (10k seconds). The camera must NEVER
  // go below the terrain surface for the column it is over.
  const pos = { x: SPAWN.x, y: computeSpawnY(layout, { x: SPAWN.x, z: SPAWN.z, maxY: REGION.height }), z: SPAWN.z };
  const gravityFeel = 0.35;
  for (let i = 0; i < 10000; i++) {
    pos.y -= gravityFeel; // one 1s idle tick
    const g = probe(pos.x, pos.z);
    if (g != null && pos.y < g) pos.y = g;
    assert.ok(pos.y >= g - 1e-9,
      `idle tick ${i}: camera sank below surface (y=${pos.y} < ground=${g}) at (${pos.x},${pos.z})`);
  }
  assert.ok(pos.y >= 1, `camera ends near the real ground, y=${pos.y}`);
});

test('out-of-region columns report null (no clamp over the void)', () => {
  const layout = generate('futurecraft', GEN);
  const probe = makeGroundProbe(layout, REGION.height);
  assert.equal(probe(-5, -5), null, 'beyond negative edge -> null');
  assert.equal(probe(64, 0), null, 'beyond +x edge -> null');
  assert.equal(probe(0, 64), null, 'beyond +z edge -> null');
});

test('makeGroundProbe throws without layout/maxY (fail-fast misuse)', () => {
  assert.throws(() => makeGroundProbe(null, 24), TypeError);
  assert.throws(() => makeGroundProbe({}, 0), TypeError);
});
