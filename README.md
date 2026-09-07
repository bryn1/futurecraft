# FutureCraft

A small, from-scratch **browser voxel sandbox** built with [Three.js](https://threejs.org/)
(r0.160.0, loaded via CDN import map — **zero build step**). Open `index.html` and you are
dropped into a deterministic 64×24×64 block world you can fly around, look at, and edit.

Live demo: https://sibbamala.com/futurecraft/

## What it is

- **Deterministic worldgen** — a seeded value-noise terrain (`js/worldgen.js`); the same
  `?seed=` always generates the same world.
- **Instanced voxel rendering** — one `InstancedMesh` per block type (`js/worldrender.js`),
  9 solid block types on a 10-slot palette (`js/blocks.js`).
- **First-person creative fly** — pointer-locked mouse-look + WASD flight (`js/player.js`),
  with a terrain floor clamp so the camera rests on the ground instead of sinking through it.
- **Raycast build/break** — break and place blocks under the crosshair (`js/edit.js`).
- **Clean, testable architecture** — pure, headless-importable modules wired by a single
  composition root (`js/app.js`); the movement, physics, ground-probe and edit-input paths
  ship with `node:test` suites in `js/*.test.mjs`.

## Controls

| Input | Action |
|---|---|
| Click ("Klicka för att spela") | Lock the pointer and start playing |
| Move the mouse | Look around |
| **W / A / S / D** | Fly forward / left / back / right |
| **Space / Shift** | Fly up / down |
| **Left mouse** | Break the targeted block |
| **Right mouse** | Place a block on the targeted face |
| **1 – 9** or **mouse wheel** | Select the active block from the palette |
| **R** | Reset the world |
| **Esc** | Release the pointer |

The world is a fixed 64×24×64 region; fly past its edge and you are in open sky above the
void. Press **R** to regenerate. Add `?seed=<anything>` to the URL for a different world.

## Running locally

It is a static site with no build step — serve the folder over HTTP (ES modules need a
server, not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Tests

The full headless `node:test` suite (run from the repo root — the domain modules are
pure/headless-importable, no browser needed):

```sh
node --test js/*.test.mjs
```

The suites cover:

- **`js/app.movement.test.mjs`** — WASD / Space / Shift are wired to the player's
  creative-fly input API (true toggle, no sticky keys); forward travel is
  **camera/view-relative** (turn 180° and W flies the other way); the animation loop feeds
  **per-second** deltas so movement uses the correct units (no constant sink / runaway);
  `dispose()` removes the listeners. (MC 586.1 / 625.1)
- **`js/player.ground.test.mjs`** — creative-fly kinematics and the terrain floor clamp:
  the camera can never sink below the ground surface. (MC 586.1)
- **`js/probe.ground.test.mjs`** — the ground-probe physics helper (column height lookup,
  out-of-region handling, fail-fast misuse).
- **`js/edit.handlers.test.mjs`** — raycast build/break input handlers under pointer lock
  (left-click break, right-click place, face-normal placement). Testable headlessly via the
  injected `doc` (defaults to the browser `document`; shipped behaviour unchanged).
- **`js/app.pointerlock.test.mjs`** — pointer-lock release on blur / hidden / pagehide so the
  cursor is never trapped after tab-switch or context loss. (MC 543.1)

## Hosting

`hosting.yaml` at the repo root declares this as a `static` app for the fleet portfolio host
(see `agents/_shared/skills/web-app-hosting`). No server process — the files are served as-is.
