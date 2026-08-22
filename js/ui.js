// FutureCraft hud module (C17) — overlay DOM only.
// Independent leaf: no world/render/edit logic. Reads/writes selection (C7),
// renders crosshair/readout/palette, maps Digit1-9 + wheel to selection.set,
// wires a reset key/button to onReset (app.js calls world.reset).
// palette injected by app-shell composition root (block-palette data), so this
// module stays decoupled from blocks.js and fully headless-testable.

// Data shapes (mirror C4/C6 from block-palette; DI'd in, not imported):
//   selection = { get activeId, set(id), onActiveChange(cb):unsub }   (C7)
//   palette   = { order: readonly number[], byId(id): Block }         (C4/C6)

export const RESET_KEY = 'KeyR'; // 1-9 + wheel select palette; R resets to seed

// Namespace object so callers can use Hud.create({...}) per the design doc.
export const Hud = { create };

/**
 * @param {object} deps
 * @param {ReturnType<typeof selection>} deps.selection   — C7 active-block selection
 * @param {() => void} deps.onReset                       — called on reset key/button
 * @param {object} deps.palette                           — block-palette data for readout
 * @param {readonly number[]} deps.palette.order          — C6 slot order (index 0..8 = keys 1..9)
 * @param {(id:number)=>{name:string,color:string}} deps.palette.byId — C4 lookup
 * @returns {{ destroy(): void, element: HTMLElement }}
 */
export function create({ selection, onReset, palette }) {
  const order = palette?.order ?? [];           // slot -> block id
  const byId = palette?.byId ?? (() => null);   // block id -> block meta

  // ---- build the overlay DOM (once) ----
  const overlay = document.createElement('div');
  overlay.className = 'hud';
  overlay.setAttribute('data-hud', '');
  overlay.innerHTML = `
    <div class="hud__crosshair" data-hud-crosshair></div>
    <div class="hud__readout" data-hud-readout aria-live="polite"></div>
    <div class="hud__palette" data-hud-palette>
      ${order.map((_id, i) => `<button type="button" class="hud__palette-slot" data-index="${i}" data-hud-palette-slot aria-label="block slot ${i + 1}"></button>`).join('')}
    </div>
    <button type="button" class="hud__reset" data-hud-reset>Återställ (R)</button>
  `;
  document.body.appendChild(overlay);

  const readout = overlay.querySelector('[data-hud-readout]');
  const slots = [...overlay.querySelectorAll('[data-hud-palette-slot]')];
  const resetBtn = overlay.querySelector('[data-hud-reset]');

  function currentIndex() {
    const id = selection.activeId;
    const i = order.indexOf(id);
    return i < 0 ? 0 : i;
  }

  function renderFrom(activeId) {
    const i = order.indexOf(activeId);
    const j = i < 0 ? 0 : i; // fallback to first slot when activeId isn't in order
    slots.forEach((s, k) => s.classList.toggle('active', k === j));
    const block = byId ? byId(activeId) : null;
    readout.textContent = block ? `${block.name} — slot ${j + 1}` : `slot ${j + 1}`;
  }

  function selectIndex(k) {
    if (k >= 0 && k < order.length) selection.set(order[k]);
  }

  // ---- selection subscription (C7) ----
  const unsub = selection.onActiveChange((activeId) => renderFrom(activeId));
  renderFrom(selection.activeId);

  // ---- keyboard: Digit1-9 select palette slot; wheel scrolls; R resets ----
  function onKey(e) {
    if (e.code) {
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) { selectIndex(Number(m[1]) - 1); return; }
      if (e.code === RESET_KEY) { onReset(); return; }
    }
  }
  document.addEventListener('keydown', onKey);

  function onWheel(e) {
    const cur = currentIndex();
    const delta = e.deltaY < 0 ? 1 : -1; // scroll up = next slot (toward higher index)
    selectIndex(cur + delta);
  }
  document.addEventListener('wheel', onWheel, { passive: true });

  function onSlotClick(e) {
    const slot = e.currentTarget;
    selectIndex(Number(slot.dataset.index));
  }
  slots.forEach((s) => s.addEventListener('click', onSlotClick));
  resetBtn.addEventListener('click', onReset);

  return {
    element: overlay,
    destroy() {
      unsub();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('wheel', onWheel);
      overlay.remove();
    },
  };
}
