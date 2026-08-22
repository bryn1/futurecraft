// FutureCraft — block-palette module (C4,C5,C6,C7).
// Pure-data block-type registry + active-selection singleton. No THREE, no DOM.
// Contracts cited from DESIGN.md §3 block-palette (206.2 rev2):
//   C4 BLOCKS (frozen registry, air=id 0 solid:false never placed)
//   C5 byId(id) undefined-safe
//   C6 PALETTE_ORDER (default selection = PALETTE_ORDER[0])
//   C7 selection singleton (hud writes it, edit reads it)

// ---- C4: frozen registry map id->{id,name,color,emissive,solid} ----
// Palette colors are build-time taste (DESIGN §8 ASSUMED). Futuristic/space theme.
function buildRegistry() {
  const defs = [
    { id: 0,  name: 'air',   color: '#000000', emissive: false, solid: false },
    { id: 1,  name: 'stone', color: '#8a8f9c', emissive: false, solid: true },
    { id: 2,  name: 'metal', color: '#c0c7d6', emissive: false, solid: true },
    { id: 3,  name: 'turf',  color: '#2f7d5b', emissive: false, solid: true },
    { id: 4,  name: 'glass', color: '#bfe8ff', emissive: true,  solid: true },
    { id: 5,  name: 'plasma',color: '#ff5b8f', emissive: true,  solid: true },
    { id: 6,  name: 'solar', color: '#ffd54f', emissive: true,  solid: true },
    { id: 7,  name: 'hull',  color: '#4a5260', emissive: false, solid: true },
    { id: 8,  name: 'core',  color: '#7fffd4', emissive: true,  solid: true },
    { id: 9,  name: 'void',  color: '#2a2b33', emissive: false, solid: true },
  ];
  const m = new Map();
  for (const d of defs) {
    // freeze the value object so callers can't mutate registry entries
    m.set(d.id, Object.freeze(d));
  }
  return Object.freeze(m);
}
export const BLOCKS = buildRegistry();

// ---- C5: undefined-safe accessor (air for missing ids) ----
const AIR = BLOCKS.get(0);
export function byId(id) {
  return BLOCKS.get(id) ?? AIR;
}

// ---- C6: 1-9 slot->block-id order; default selection = slot 0 ----
export const PALETTE_ORDER = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((id) => BLOCKS.has(id) && BLOCKS.get(id).solid)
);

// ---- C7: active-selection singleton (hud writes, edit reads) ----
const state = { activeId: PALETTE_ORDER[0], listeners: new Set() };
export const selection = {
  get activeId() {
    return state.activeId;
  },
  set(id) {
    // air (0) and unknown ids are never selectable (buildable only)
    if (!BLOCKS.has(id) || id === 0) return;
    if (id === state.activeId) return;
    state.activeId = id;
    for (const cb of state.listeners) cb(id);
  },
  onActiveChange(cb) {
    state.listeners.add(cb);
    return () => state.listeners.delete(cb);
  },
};
