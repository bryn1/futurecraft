// FutureCraft — pointer-lock release-on-focus-loss tests (MC 543.1).
// Headless: stubs document/window (no DOM) and injects onRelease so we assert the
// app releases the mouse on EVERY loss-of-focus path, not just Esc-in-canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPointerLockRelease } from './app.js';

// --- tiny event-emitter stub for window/document -----------------------------
function makeTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
    emit(type, ev) { const fn = handlers.get(type); if (fn) fn(ev || {}); },
    has(type) { return handlers.has(type); },
  };
}

test('releases pointer lock on window blur', () => {
  const win = makeTarget();
  const doc = makeTarget();
  let released = 0;
  const dispose = installPointerLockRelease({ win, doc, onRelease: () => released++ });
  win.emit('blur');
  assert.equal(released, 1, 'blur must release the pointer');
  dispose();
});

test('releases pointer lock on visibilitychange->hidden', () => {
  const win = makeTarget();
  const doc = makeTarget();
  let released = 0;
  installPointerLockRelease({ win, doc, onRelease: () => released++ });
  // hidden -> must release
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  assert.equal(released, 1, 'visibilitychange->hidden must release the pointer');
  // visible -> must NOT release
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  assert.equal(released, 1, 'visibilitychange->visible must NOT release the pointer');
});

test('releases pointer lock on pagehide', () => {
  const win = makeTarget();
  const doc = makeTarget();
  let released = 0;
  installPointerLockRelease({ win, doc, onRelease: () => released++ });
  win.emit('pagehide');
  assert.equal(released, 1, 'pagehide must release the pointer');
});

test('defensive: onRelease must not throw when pointer already released', () => {
  const win = makeTarget();
  const doc = makeTarget();
  let released = 0;
  installPointerLockRelease({
    win, doc,
    onRelease: () => { released++; if (released === 1) throw new Error('guard: nothing locked'); },
  });
  // Simulate first release throwing (nothing locked) -> no uncaught error, always safe.
  win.emit('blur');
  assert.equal(released, 1);
  win.emit('pagehide');
  assert.equal(released, 2, 'release must be attempted again safely even after a throw');
});

test('dispose removes all three listeners', () => {
  const win = makeTarget();
  const doc = makeTarget();
  let released = 0;
  const dispose = installPointerLockRelease({ win, doc, onRelease: () => released++ });
  assert.ok(win.has('blur') && win.has('pagehide'), 'windown listeners registered');
  assert.ok(doc.has('visibilitychange'), 'document listener registered');
  dispose();
  assert.ok(!win.has('blur') && !win.has('pagehide'), 'window listeners removed');
  assert.ok(!doc.has('visibilitychange'), 'document listener removed');
  win.emit('blur');
  assert.equal(released, 0, 'no release after dispose');
});
