/* Voxel Studio live mode (studio/index.html?live=1, docs/decisions/2026-10-22-voxel-live.md): one space of
   voxel cells that the page and an agent edit through window.live, shown in the studio's viewport with the
   engine's lighting. The canvas is a Uint8Array of slots (0 empty, 1..254 the space's materials in order of
   first use), x fastest, then y, then z. Every call reshades its changed box plus a 7-cell margin (normals
   from the 26 neighbours, AO from occupancy at the voxeliser's radii); 250 ms after the last call, and for
   every committed frame, the engine's own bake (MossAsset.build + ME.voxelizeModel at vs = grid) replaces
   that shading. Committed frames save as a flipbook of voxel layers (src/asset-format.js). The page draws
   only after a change, while the camera moves or while playing. tools/voxel-live.ps1 drives it over the
   DevTools protocol (live.run); ?selftest=1 writes a JSON report into #result. */
(function () {
  const SV = (window.SV = window.SV || {}), ME = window.ME, AF = window.MossAsset, P = window.PX;
  const MAX_AXIS = 256, MAX_CELLS = 1 << 23, MAX_GRID = 128, MAX_FRAMES = 64, MAX_FRAME_BYTES = 256 << 20, EXACT_MAX_SOLID = 1 << 20, MAX_SLOTS = 254, UNDO_STEPS = 100, UNDO_BYTES = 64 << 20, IDLE_MS = 250, MARGIN = 7, MAX_SCAN = 1 << 26, MAX_SHOT = 2048, HOLD_BYTES = 64 << 20;
  const AO = [[1.5, 0.45], [3.5, 0.35], [7, 0.25]]; // the voxeliser's AO radii and weights (src/sdf.js)
  const NB = []; // the 26 neighbours: offset and unit direction
  for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b || c) { const l = Math.hypot(a, b, c); NB.push([a, b, c, a / l, b / l, c / l]); }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  let app = null, view = null;
  // the space: dims, grid (cells per tile), org (anchor coordinates of cell [0, 0, 0]: the anchor is the
  // ground centre), the canvas and its live shading (rgba as ME.voxelizeModel makes it), kind per cell
  // (0 empty, 1 interior, 2 surface), solid cells per 8^3 brick
  const L = {
    dims: null, grid: 64, tile: false, h: 1, org: [0, 0, 0], name: "live", label: "", canvas: null, rgba: null, kind: null, brick: null, bdims: [0, 0, 0],
    solid: 0, surf: 0, bricks: 0, slots: [null], slotOf: new Map(), slotPal: new Uint8Array(256), own: {},
    frames: [], fps: 12, playing: false, playT0: 0, shown: -1, undo: [], redo: [], group: null,
    exact: null, exactSet: null, exactMs: 0, exactT: 0, bakeQ: [], bakeT: 0, dirty: true, statsDirty: true, last: null, callT: [], uploadMs: 0, vol: null, saved: null,
    drawWanted: false, drawnN: 0, drawnWait: [], error: null, owner: "", dirtyBoxes: null, poolWarned: false, exactSkipped: false,
  };

  // ---------------------------------------------------------------- arguments
  const fail = (call, arg, msg) => { throw new Error(call + ": " + arg + " " + msg); };
  const int = (call, arg, v) => (Number.isInteger(v) ? v : fail(call, arg, "must be an integer (got " + JSON.stringify(v) + ")"));
  const num = (call, arg, v) => (typeof v === "number" && Number.isFinite(v) ? v : fail(call, arg, "must be a number (got " + JSON.stringify(v) + ")"));
  const cellArg = (call, arg, v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isInteger) ? v : fail(call, arg, "must be [x, y, z] integers (got " + JSON.stringify(v) + ")"));
  // the cell budget: at most MAX_AXIS per axis and MAX_CELLS in all (256 × 256 × 128, 192³, or a tall 96 × 96 × 256)
  const budget = (call, arg, dims, more = "") => {
    const cells = dims[0] * dims[1] * dims[2];
    if (dims.some((n) => n < 1 || n > MAX_AXIS) || cells > MAX_CELLS) fail(call, arg, "gives " + dims.join("×") + " = " + cells + " cells: each axis must be 1.." + MAX_AXIS + " and the space at most " + MAX_CELLS + " cells (256×256×128, 192³ or 96×96×256)" + more);
    return dims;
  };
  const ptArg = (call, arg, v) => (Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c)) ? v : fail(call, arg, "must be [x, y, z] numbers (got " + JSON.stringify(v) + ")"));
  const known = (m) => !!L.own[m] || !!app.st.ramps[m];
  // material name -> slot (null -> 0); a new name takes the next slot
  function slotArg(call, arg, m) {
    if (m === null || m === undefined) return 0;
    if (typeof m !== "string" || !known(m)) fail(call, arg, "is not a material: " + JSON.stringify(m) + " (live.mats() lists them)");
    let s = L.slotOf.get(m);
    if (s !== undefined) return s;
    if (L.slots.length > MAX_SLOTS) fail(call, arg, "would be material " + (MAX_SLOTS + 1) + " in this space (at most " + MAX_SLOTS + ")");
    s = L.slots.length; L.slots.push(m); L.slotOf.set(m, s); L.slotPal[s] = app.pal.id(m);
    return s;
  }

  // ---------------------------------------------------------------- space helpers
  const idx = (x, y, z) => (z * L.dims[1] + y) * L.dims[0] + x;
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < L.dims[0] && y < L.dims[1] && z < L.dims[2];
  // [lo, hi] (inclusive, any order) clipped to the space -> [x0, y0, z0, x1, y1, z1] or null
  function clip(a, b) {
    const out = [];
    for (let k = 0; k < 3; k++) { const lo = Math.max(0, Math.min(a[k], b[k])), hi = Math.min(L.dims[k] - 1, Math.max(a[k], b[k])); if (lo > hi) return null; out[k] = lo; out[k + 3] = hi; }
    return out;
  }
  const boxVol = (b) => (b ? (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1) : 0);
  // a box's slots (x fastest) out of a grid of dims d, and back
  function crop(src, d, b) {
    const w = b[3] - b[0] + 1, out = new Uint8Array(boxVol(b));
    for (let z = b[2], o = 0; z <= b[5]; z++) for (let y = b[1]; y <= b[4]; y++, o += w) { const i = (z * d[1] + y) * d[0] + b[0]; out.set(src.subarray(i, i + w), o); }
    return out;
  }
  function paste(dst, d, b, data) {
    const w = b[3] - b[0] + 1;
    for (let z = b[2], o = 0; z <= b[5]; z++) for (let y = b[1]; y <= b[4]; y++, o += w) dst.set(data.subarray(o, o + w), (z * d[1] + y) * d[0] + b[0]);
  }
  // the tight box of the non-empty cells of a grid, or null
  function tight(data, d) {
    const mn = [1e9, 1e9, 1e9], mx = [-1, -1, -1];
    for (let z = 0, i = 0; z < d[2]; z++) for (let y = 0; y < d[1]; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < d[0]; x++, i++) if (data[i]) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 < 0) continue;
      if (x0 < mn[0]) mn[0] = x0; if (x1 > mx[0]) mx[0] = x1;
      if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
      if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
    }
    return mx[0] < 0 ? null : [mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]];
  }

  // ---------------------------------------------------------------- hash
  // FNV-1a 32 of a grid's tight box: its min corner in anchor coordinates and its size (int32 LE), each
  // cell (x, y, z order) as 0 or 1 + the rank of its material among the sorted names in use, then those
  // names joined by "\n". Slot order, the space's size and where the anchor sits in it don't change it.
  function hashGrid(data, d, org) {
    let h = 0x811c9dc5;
    const byte = (v) => { h ^= v & 255; h = Math.imul(h, 16777619) >>> 0; };
    const i32 = (v) => { byte(v); byte(v >> 8); byte(v >> 16); byte(v >> 24); };
    const b = tight(data, d);
    const used = new Set();
    if (b) for (let i = 0; i < data.length; i++) if (data[i]) used.add(data[i]);
    const names = [...used].map((s) => L.slots[s]).sort(), rank = new Uint8Array(256);
    for (const s of used) rank[s] = names.indexOf(L.slots[s]) + 1;
    if (b) {
      for (let k = 0; k < 3; k++) i32(org[k] + b[k]);
      for (let k = 0; k < 3; k++) i32(b[k + 3] - b[k] + 1);
      for (let z = b[2]; z <= b[5]; z++) for (let y = b[1]; y <= b[4]; y++) for (let x = b[0], i = (z * d[1] + y) * d[0] + x; x <= b[3]; x++, i++) byte(data[i] ? rank[data[i]] : 0);
    }
    for (const c of new TextEncoder().encode(names.join("\n"))) byte(c);
    return h.toString(16).padStart(8, "0");
  }

  // ---------------------------------------------------------------- shading
  // Live shading of the region b (space cells) plus the margin, from occupancy alone; keeps the solid,
  // surface and brick counts.
  function reshade(b) {
    const [nx, ny, nz] = L.dims, cv = L.canvas, rgba = L.rgba, kind = L.kind, pal = L.slotPal, [bx, by] = L.bdims;
    const x0 = Math.max(0, b[0] - MARGIN), y0 = Math.max(0, b[1] - MARGIN), z0 = Math.max(0, b[2] - MARGIN);
    const x1 = Math.min(nx - 1, b[3] + MARGIN), y1 = Math.min(ny - 1, b[4] + MARGIN), z1 = Math.min(nz - 1, b[5] + MARGIN);
    // the box reshaded, out to the AO reach, is what the next upload re-sends (null: everything)
    if (L.dirtyBoxes) {
      const d = L.dirtyBoxes;
      d.push([x0, y0, z0, x1, y1, z1]);
      if (d.length > 32) { const u = d.reduce((a, q) => [0, 1, 2].map((k) => Math.min(a[k], q[k])).concat([3, 4, 5].map((k) => Math.max(a[k], q[k])))); d.length = 0; d.push(u); }
    }
    const occ = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && cv[(z * ny + y) * nx + x] ? 1 : 0);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0, i = (z * ny + y) * nx + x0; x <= x1; x++, i++) {
      const s = cv[i], old = kind[i];
      let k = 0;
      if (!s) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = rgba[i * 4 + 3] = 0; }
      else if (occ(x - 1, y, z) && occ(x + 1, y, z) && occ(x, y - 1, z) && occ(x, y + 1, z) && occ(x, y, z - 1) && occ(x, y, z + 1)) { k = 1; rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = pal[s]; }
      else {
        k = 2;
        let n0 = 0, n1 = 0, n2 = 0;
        for (const d of NB) if (occ(x + d[0], y + d[1], z + d[2])) { n0 -= d[3]; n1 -= d[4]; n2 -= d[5]; }
        const l = Math.hypot(n0, n1, n2);
        if (l < 1e-6) { n0 = 0; n1 = 0; n2 = 1; } else { n0 /= l; n1 /= l; n2 /= l; }
        let o = 0;
        for (const [r, w] of AO) o += w * occ(Math.floor(x + 0.5 + n0 * r), Math.floor(y + 0.5 + n1 * r), Math.floor(z + 0.5 + n2 * r));
        const e = ME.octEnc([n0, n1, n2]);
        rgba[i * 4] = e[0]; rgba[i * 4 + 1] = e[1]; rgba[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, 1 - o))); rgba[i * 4 + 3] = pal[s];
      }
      if (k === old) continue;
      kind[i] = k;
      L.solid += (k > 0) - (old > 0); L.surf += (k === 2) - (old === 2);
      if ((k > 0) !== (old > 0)) {
        const bi = ((z >> 3) * by + (y >> 3)) * bx + (x >> 3), was = L.brick[bi];
        L.brick[bi] += k > 0 ? 1 : -1;
        if (!was) L.bricks++; else if (!L.brick[bi]) L.bricks--;
      }
    }
  }

  // The engine's own bake of a layer (anchor coordinates) at vs = grid: what the user settles on.
  function bakeExact(layer) {
    const doc = { format: AF.FORMAT, version: AF.VERSION, name: "live_bake", k: 1, grid: L.grid, frames: 1, prims: [], vox: layer };
    const vx = ME.voxelizeModel(AF.build(doc), L.grid, app.pal);
    return { box: vx.box, dims: vx.dims, rgba: vx.rgba, solid: vx.solid, surf: vx.surf, scale: 1 / L.grid };
  }
  // a grid (dims d, cell [0, 0, 0] at anchor coordinates org) as an asset-format layer of its tight box,
  // values 1..254 in order of first use, or null when empty
  function layerOf(data, d, org) {
    const b = tight(data, d);
    if (!b) return null;
    const vals = crop(data, d, b), lut = new Uint8Array(256), mats = [];
    for (let i = 0; i < vals.length; i++) { const s = vals[i]; if (!s) continue; if (!lut[s]) { mats.push(L.slots[s]); lut[s] = mats.length; } vals[i] = lut[s]; }
    return { o: [org[0] + b[0], org[1] + b[1], org[2] + b[2]], n: [b[3] - b[0] + 1, b[4] - b[1] + 1, b[5] - b[2] + 1], mats, rle: AF.rleEncode(vals) };
  }
  const boxCells = (b) => (b ? (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1) : 0);
  function scheduleExact() {
    clearTimeout(L.exactT);
    L.exactT = setTimeout(() => {
      L.exactT = 0;
      if (!L.solid) return;
      // the exact bake voxelises the whole space on the main thread (1.5 s for 4.2 M solid in an 8.4 M box), and
      // ME.voxelizeModel walks the model's whole box: above EXACT_MAX_SOLID solid cells, or a tight box of more
      // than twice that (a hollow room), the live shading stays, and stats().exactSkipped says so
      L.exactSkipped = L.solid > EXACT_MAX_SOLID || boxCells(tight(L.canvas, L.dims)) > 2 * EXACT_MAX_SOLID; L.statsDirty = true;
      if (L.exactSkipped) return;
      const t0 = performance.now();
      try { L.exact = bakeExact(layerOf(L.canvas, L.dims, L.org)); } catch (e) { ME.err("LIVE", "exact bake: " + (e.stack || e.message)); return; }
      L.exactMs = performance.now() - t0; L.dirty = true; L.statsDirty = true;
    }, IDLE_MS);
  }
  // committed frames get the exact bake one by one, between calls
  function queueBake(f) { L.bakeQ.push(f); if (!L.bakeT) L.bakeT = setTimeout(drainBakes, 0); }
  function drainBakes() {
    L.bakeT = 0;
    const f = L.bakeQ.shift();
    if (f && !f.exact && f.solid && f.solid <= EXACT_MAX_SOLID && f.data.length <= 2 * EXACT_MAX_SOLID && L.frames.includes(f)) { const v = bakeExact(f.layer); f.set = view.buildSet(v); f.exact = true; f.bytes = frameBytes(f); f.bricks = ME.volumeBricks(v); if (L.playing) L.shown = -1; }
    if (L.bakeQ.length) L.bakeT = setTimeout(drainBakes, 0);
  }
  // a material was redefined after use: a new palette, every volume's ids remapped by name
  function regenPalette() {
    const old = app.pal.names.slice();
    app.newPalette();
    const map = old.map((n) => (n === null ? 0 : app.pal.id(n)));
    const remap = (v) => { if (v) for (let i = 3; i < v.rgba.length; i += 4) v.rgba[i] = map[v.rgba[i]]; };
    remap(L.vol); remap(L.exact);
    // a frame's set keeps the palette id in each instance's low byte
    for (const f of L.frames) if (f.set) { const inst = f.set.B.inst; for (let k = 3; k < inst.length; k += 4) inst[k] = (inst[k] & 0xff00) | map[inst[k] & 255]; }
    for (let s = 1; s < L.slots.length; s++) L.slotPal[s] = app.pal.id(L.slots[s]);
    L.dirtyBoxes = null; // every id in the live volume changed: the next upload is whole
    L.shown = -1; L.dirty = true;
  }
  // an own material from "#rrggbb" or the format's (and the palette's own) material object; any ramp the
  // palette takes: a generator spec or a list of colours of any length
  function ownMat(call, nameArg, specArg, name, spec) {
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(call, nameArg, "must be an identifier (got " + JSON.stringify(name) + ")");
    let mt;
    if (typeof spec === "string") { if (!/^#[0-9a-fA-F]{6}$/.test(spec)) fail(call, specArg, "must be \"#rrggbb\" or { ramp, em?, cls? }"); mt = { ramp: SV.rampFor(P.hex(spec)) }; }
    else if (spec && typeof spec === "object" && Array.isArray(spec.ramp)) {
      mt = { ramp: spec.ramp.slice() };
      for (const k of ["em", "cls", "wrap", "bias", "light"]) if (spec[k] !== undefined) mt[k] = spec[k];
      if (mt.em !== undefined && mt.em !== true && mt.em !== false && !(typeof mt.em === "number" && Number.isFinite(mt.em) && mt.em >= 0)) fail(call, specArg + ".em", "must be a glow gain >= 0 (1 or true the full glow, about 0.5 keeps a pale neon's hue, 0 none; got " + JSON.stringify(mt.em) + ")");
      if (mt.em && !mt.light) { const c = P.hex(mt.ramp[0]); mt.light = [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }
    } else fail(call, specArg, "must be \"#rrggbb\" or { ramp, em?, cls? }");
    try { P.makeRamp(mt.ramp); } catch (e) { fail(call, specArg + ".ramp", "is not a ramp: " + e.message); }
    return mt;
  }
  function installOwn(mts) {
    let regen = false;
    for (const n in mts) { L.own[n] = mts[n]; if (app.pal.ids[n] !== undefined) regen = true; }
    app.installDocMats({ mats: mts });
    if (regen) regenPalette();
  }

  // ---------------------------------------------------------------- edits and undo
  // An editing call on box b (space cells, clipped; null when nothing of it is in the space): keeps the
  // before-image for undo, writes, counts the changed cells and reshades.
  function edit(b, write) {
    if (!b) return 0;
    const before = crop(L.canvas, L.dims, b);
    write();
    const after = crop(L.canvas, L.dims, b);
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    if (!changed) return 0;
    pushUndo({ b, data: before });
    touched(b);
    return changed;
  }
  function touched(b) { reshade(b); L.exact = null; L.exactSet = null; L.dirty = true; L.statsDirty = true; scheduleExact(); }
  const stepBytes = (st) => st.recs.reduce((s, r) => s + r.data.length, 0);
  function pushUndo(rec) {
    if (L.noUndo) return; // animate() keeps its own single record
    if (L.group) { L.group.recs.push(rec); return; }
    L.undo.push({ label: null, recs: [rec] }); L.redo.length = 0; trimUndo();
  }
  function trimUndo() {
    let bytes = L.undo.reduce((s, st) => s + stepBytes(st), 0);
    while (L.undo.length > UNDO_STEPS || (bytes > UNDO_BYTES && L.undo.length > 1)) bytes -= stepBytes(L.undo.shift());
  }
  // undo and redo swap a step's images with the canvas, so the same step serves both ways
  function swapStep(st, order) {
    let changed = 0;
    for (const r of order < 0 ? st.recs.slice().reverse() : st.recs) {
      const cur = crop(L.canvas, L.dims, r.b);
      for (let i = 0; i < cur.length; i++) if (cur[i] !== r.data[i]) changed++;
      paste(L.canvas, L.dims, r.b, r.data); r.data = cur;
      touched(r.b);
    }
    return changed;
  }

  // ---------------------------------------------------------------- models
  // How a voxelised volume { dims, rgba, names, box? } stands: box[0..2] is its min corner relative to the
  // cell it stands on (by default it stands centred on it); clip [z0, z1] keeps the cells z0..z1 above its
  // lowest solid cell, standing on that cell. -> { box, z0, z1, lo, hi } (lo, hi: the kept solid cells'
  // extents relative to that cell), or null when nothing is kept.
  function standing(vol, clipZ) {
    const [nx, ny, nz] = vol.dims, a = vol.rgba, box = vol.box ? [vol.box[0], vol.box[1], vol.box[2]] : [-Math.floor(nx / 2), -Math.floor(ny / 2), 0];
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) if (a[i * 4 + 3]) {
      if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x; if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y; if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
    }
    if (lo[0] > hi[0]) return null;
    let z0 = 0, z1 = nz - 1;
    if (clipZ) { z0 = lo[2] + clipZ[0]; z1 = Math.min(hi[2], lo[2] + clipZ[1]); if (z0 > z1) return null; box[2] = -z0; lo[2] = z0; hi[2] = z1; }
    return { box, z0, z1, lo: lo.map((v, k) => v + box[k]), hi: hi.map((v, k) => v + box[k]) };
  }
  // write a volume's solid cells (each id as the material names[id]) standing on cell at: one undo step;
  // boxOut, when given, gets the canvas box written (empty when all of it is clipped)
  function place(call, vol, at, stand, boxOut) {
    const [nx, ny] = vol.dims, a = vol.rgba, { box, z0, z1 } = stand, lut = new Uint8Array(256), used = new Set(), missing = [];
    for (let i = 3; i < a.length; i += 4) {
      const id = a[i];
      if (!id || lut[id]) continue;
      const m = vol.names[id];
      if (typeof m !== "string") fail(call, "vol.names", "has no material for id " + id);
      // a material the page doesn't know is drawn as stone, as load does
      if (!known(m)) { missing.push(m); L.own[m] = { ramp: app.st.ramps.stone }; app.installDocMats({ mats: { [m]: L.own[m] } }); }
      lut[id] = slotArg(call, "vol.names[" + id + "]", m); used.add(m);
    }
    const o = [0, 1, 2].map((k) => at[k] + box[k]);
    let clipped = 0, solid = 0;
    const cb = clip([o[0], o[1], o[2] + z0], [o[0] + nx - 1, o[1] + vol.dims[1] - 1, o[2] + z1]);
    for (let z = z0; z <= z1; z++) for (let y = 0; y < ny; y++) for (let x = 0, i = (z * ny + y) * nx; x < nx; x++, i++) if (a[i * 4 + 3]) { solid++; if (!inside(o[0] + x, o[1] + y, o[2] + z)) clipped++; }
    const changed = edit(cb, () => {
      for (let z = Math.max(z0, cb[2] - o[2]); z <= Math.min(z1, cb[5] - o[2]); z++) for (let y = cb[1] - o[1]; y <= cb[4] - o[1]; y++) {
        let i = (z * ny + y) * nx + cb[0] - o[0], j = idx(cb[0], o[1] + y, o[2] + z);
        for (let x = cb[0]; x <= cb[3]; x++, i++, j++) { const id = a[i * 4 + 3]; if (id) L.canvas[j] = lut[id]; }
      }
    });
    if (boxOut && cb) boxOut.push(...cb);
    return { changed, clipped, solid, mats: [...used].sort(), missing };
  }
  const anchorCell = () => L.org.map((v) => -v);
  // the solid cells' height of a voxelised volume
  function solidHeight(vx) {
    const [nx, ny, nz] = vx.dims, n = nx * ny;
    let z0 = -1, z1 = -1;
    for (let z = 0; z < nz; z++) for (let i = z * n; i < (z + 1) * n; i++) if (vx.rgba[i * 4 + 3]) { if (z0 < 0) z0 = z; z1 = z; break; }
    return z0 < 0 ? 0 : z1 - z0 + 1;
  }
  // a library model from (name, o) or a [name, o] pair: { name, o, md } (md with its scale, md.k, as the
  // engine bakes it)
  function modelSpec(call, arg, oArg, name, o) {
    if (Array.isArray(name)) { if (name.length !== 2) fail(call, arg, "as a pair must be [name, o]"); o = name[1] || {}; name = name[0]; }
    const MODELS = window.MODELS || {};
    if (typeof name !== "string" || typeof MODELS[name] !== "function") fail(call, arg, "is not a model: " + JSON.stringify(name) + " (Object.keys(MODELS) lists them)");
    if (!o || typeof o !== "object") fail(call, oArg, "must be the model's options object");
    return { name, o, md: ME.modelOf(name, o) };
  }
  // tall | vs, clip and open from opts -> { tall, vs (null: from tall, else the space's grid), clipZ, open }
  function modelOpts(call, opts, keys) {
    if (!opts || typeof opts !== "object") fail(call, "opts", "must be { " + keys + " }");
    if (opts.tall !== undefined && opts.vs !== undefined) fail(call, "opts", "takes tall or vs, not both");
    const clipZ = opts.clip === undefined ? null : Array.isArray(opts.clip) && opts.clip.length === 2 && opts.clip.every(Number.isInteger) && opts.clip[0] >= 0 && opts.clip[1] >= opts.clip[0] ? opts.clip : fail(call, "clip", "must be [z0, z1] integers with 0 <= z0 <= z1 (cells above the model's lowest)");
    let tall = 0;
    if (opts.tall !== undefined) {
      tall = int(call, "tall", opts.tall);
      if (tall < 1 || tall > MAX_AXIS) fail(call, "tall", "must be 1.." + MAX_AXIS);
    }
    return { tall, vs: opts.vs === undefined ? null : num(call, "vs", opts.vs), clipZ, open: !!opts.open };
  }
  // the density for a model: vs, else tall cells high (a coarse probe, then one correction from the height it
  // gives), else the space's grid. It is rounded as returned, so a space opened at grid vs has exactly that
  // grid; an opened space's grid is at most MAX_GRID (the decision), a space of one's own takes any vs up to
  // twice that. -> { vs, vx } (vx: the model voxelised at vs)
  function density(call, spec, mo) {
    const ok = (vs) => {
      const top = mo.open ? MAX_GRID : 2 * MAX_GRID;
      if (vs <= 0 || vs > top) fail(call, mo.tall ? "tall" : "vs", "gives vs " + vs + (mo.tall ? " for this model (" + mo.tall + " cells tall)" : "") + "; at most " + top + (mo.open ? " with open, the grid's limit: a smaller tall, or put it in a space opened with live.open" : ""));
      return vs;
    };
    let vs = mo.vs === null ? L.grid : mo.vs;
    if (mo.tall) {
      const h = solidHeight(ME.voxelizeModel(spec.md, 24, app.pal));
      if (!h) fail(call, "name", JSON.stringify(spec.name) + " draws no voxels");
      vs = r3((mo.tall * 24) / h);
    }
    let vx = ME.voxelizeModel(spec.md, ok(vs), app.pal);
    if (mo.tall) { const h = solidHeight(vx); if (h && h !== mo.tall) { vs = ok(r3((vs * mo.tall) / h)); vx = ME.voxelizeModel(spec.md, vs, app.pal); } }
    return { vs, vx };
  }
  const volOf = (vx) => ({ dims: vx.dims, rgba: vx.rgba, box: vx.box, names: app.pal.names });
  // open: a space fitted to the stands with a margin, centred on the anchor; one reaching below its ground is
  // lifted so that all of it fits -> the lift
  function openFor(call, stands, vs, name) {
    const M = 2, lo = [0, 1, 2].map((k) => Math.min(...stands.map((s) => s.lo[k]))), hi = [0, 1, 2].map((k) => Math.max(...stands.map((s) => s.hi[k])));
    const lift = Math.max(0, -lo[2]);
    const dims = [0, 1].map((k) => 2 * Math.max(-lo[k], hi[k] + 1) + 2 * M).concat(Math.max(1, hi[2] + lift + 1) + M);
    budget(call, "open", dims, " at vs " + r3(vs) + ": a smaller tall or vs");
    live.open({ dims, grid: vs, name: /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : undefined });
    return lift;
  }
  const standAt = (call, opts, lift) => (opts.at === undefined || opts.at === null ? anchorCell().map((v, k) => (k === 2 ? v + lift : v)) : cellArg(call, "at", opts.at));
  // tween's easings, on 0..1
  const EASE = { linear: (u) => u, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), inOut: (u) => u * u * (3 - 2 * u) };
  // a pose from a to b at e: numbers lerped, also in nested objects and arrays; anything else is a's
  function lerpPose(a, b, e) {
    if (typeof a === "number") return typeof b === "number" ? a + (b - a) * e : a;
    if (Array.isArray(a)) return a.map((v, i) => lerpPose(v, Array.isArray(b) ? b[i] : undefined, e));
    if (a && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype) {
      const out = {}, bo = b && typeof b === "object" ? b : {};
      for (const k in a) out[k] = lerpPose(a[k], bo[k], e);
      return out;
    }
    return a;
  }

  // the space a document's layers span about their anchor (the ground centre), as load opens it
  function docSpace(layers) {
    const mn = [0, 0, 0], mx = [1, 1, 1];
    for (const l of layers) if (l) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], l.o[k]); mx[k] = Math.max(mx[k], l.o[k] + l.n[k]); }
    const dims = [2 * Math.max(-mn[0], mx[0]), 2 * Math.max(-mn[1], mx[1]), mx[2] - mn[2]];
    return { dims, org: [-dims[0] / 2, -dims[1] / 2, mn[2]] };
  }
  // ---------------------------------------------------------------- frames
  // a committed frame: its tight box of slots (1 byte a cell), its layer, its hash, and the view's set of its
  // surface (12 bytes a surface cell: live shading first, then the exact bake's). Its colours are not kept.
  function snapshot() {
    const b = tight(L.canvas, L.dims), hash = hashGrid(L.canvas, L.dims, L.org);
    if (!b) return { b: null, data: new Uint8Array(0), solid: 0, hash, layer: null, set: null, exact: true, bytes: 0, bricks: 0 };
    const data = crop(L.canvas, L.dims, b), d = [b[3] - b[0] + 1, b[4] - b[1] + 1, b[5] - b[2] + 1];
    const rgba = new Uint8Array(data.length * 4);
    for (let z = 0, o = 0; z < d[2]; z++) for (let y = 0; y < d[1]; y++) { const i = idx(b[0], b[1] + y, b[2] + z); rgba.set(L.rgba.subarray(i * 4, (i + d[0]) * 4), o * 4); o += d[0]; }
    const solid = data.reduce((s, v) => s + (v ? 1 : 0), 0), vol = { box: [L.org[0] + b[0], L.org[1] + b[1], L.org[2] + b[2]], dims: d, rgba, scale: 1 / L.grid };
    const f = { b, data, solid, hash, layer: layerOf(L.canvas, L.dims, L.org), set: view.buildSet(vol), exact: false };
    return Object.assign(f, { bytes: frameBytes(f), bricks: ME.volumeBricks(vol) });
  }
  // what a frame holds: its slots and its layer (1 byte a cell of its box each) and its set (12 a surface cell)
  const frameBytes = (f) => f.data.length * 2 + (f.set ? f.set.B.inst.byteLength + f.set.B.nao.byteLength : 0);
  const framesBytes = (skip) => L.frames.reduce((s, f) => s + (f === skip ? 0 : f.bytes || 0), 0);
  const mb = (n) => Math.round((n / 1048576) * 10) / 10;
  const EMPTY = { box: [0, 0, 0], dims: [1, 1, 1], rgba: new Uint8Array(4), scale: 1 };
  // a frame to the view: its set, uploaded whole (the live space's runs are kept meanwhile)
  function showFrame(f) {
    const t0 = performance.now();
    app.syncTables();
    if (f.set) view.useSet(f.set); else view.setVolume(Object.assign({}, EMPTY, { scale: 1 / L.grid }), null);
    L.uploadMs = performance.now() - t0;
  }
  // what the page shows when nothing plays: a shown exact frame's set, else the exact bake, else the live space
  function present() { if (L.exactSet) showFrame({ set: L.exactSet }); else upload(L.exact || L.vol); }

  // ---------------------------------------------------------------- the space
  function newSpace(dims, grid, org, o = {}) {
    const N = dims[0] * dims[1] * dims[2];
    L.dims = dims; L.grid = grid; L.org = org; L.tile = !!o.tile; L.h = o.h || 1;
    if (o.name !== undefined) L.name = o.name;
    if (o.label !== undefined) L.label = o.label;
    L.canvas = new Uint8Array(N); L.rgba = new Uint8Array(N * 4); L.kind = new Uint8Array(N); L.dirtyBoxes = null;
    L.bdims = dims.map((n) => Math.ceil(n / 8)); L.brick = new Uint16Array(L.bdims[0] * L.bdims[1] * L.bdims[2]);
    L.solid = L.surf = L.bricks = 0;
    L.slots = [null]; L.slotOf = new Map(); L.slotPal.fill(0);
    L.frames = []; L.playing = false; L.shown = -1; L.undo = []; L.redo = []; L.group = null;
    L.exact = null; L.exactSet = null; clearTimeout(L.exactT); L.exactT = 0; L.bakeQ = []; clearTimeout(L.bakeT); L.bakeT = 0;
    L.vol = { box: org, dims, rgba: L.rgba, scale: 1 / grid, keep: true }; // keep: the view keeps its runs while a bake or a frame shows
    L.dirty = true; L.statsDirty = true;
    setTitle();
    buildLines(); fit();
  }
  const setTitle = () => { document.title = "Voxel Live · " + L.name + (L.owner ? " · " + L.owner : ""); };
  // the camera as live.view gives it
  function camNow() {
    const c = view.cam;
    return { yaw: r3(c.yaw / (Math.PI / 180)), pitch: c.engine ? 30 : r3(c.pitch), zoom: r3(c.zoom / L.grid), target: c.target.map((v, k) => r3(v * L.grid - L.org[k] - 0.5)), engine: c.engine };
  }
  // target and zoom so that the cell box b (inclusive) takes fill of the view, as seen at the camera's angles
  function frameBox(b, fill) {
    const c = view.cam, s = 1 / L.grid, lo = [0, 1, 2].map((k) => (L.org[k] + b[k]) * s), hi = [0, 1, 2].map((k) => (L.org[k] + b[k + 3] + 1) * s);
    c.target = lo.map((v, k) => (v + hi[k]) / 2);
    const { rx, up } = c.basis();
    let ex = 1e-6, ey = 1e-6;
    for (let i = 0; i < 8; i++) {
      const d = [0, 1, 2].map((k) => ((i >> k) & 1 ? hi[k] : lo[k]) - c.target[k]);
      ex = Math.max(ex, Math.abs(d[0] * rx[0] + d[1] * rx[1] + d[2] * rx[2])); ey = Math.max(ey, Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]));
    }
    c.zoom = fill * Math.min(view.cv.width / (2 * ex), view.cv.height / (2 * ey));
  }
  function fit() {
    const s = 1 / L.grid, lo = L.org.map((v) => v * s), hi = L.org.map((v, a) => (v + L.dims[a]) * s);
    view.cam.target = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], (hi[2] - lo[2]) * 1.2, 0.3);
    view.cam.zoom = Math.min(view.cv.clientWidth || 800, view.cv.clientHeight || 600) / (ext * 1.3);
  }
  // the space's wire box and its floor: a faint line per cell, brick edges every 8 cells, tile edges
  function buildLines() {
    const v = [], s = 1 / L.grid, [nx, ny, nz] = L.dims, [ox, oy, oz] = L.org;
    const seg = (a, b, c) => v.push(a[0] * s, a[1] * s, a[2] * s, ...c, b[0] * s, b[1] * s, b[2] * s, ...c);
    const tileEdge = (X) => { const u = X / L.grid - 0.5; return Math.abs(u - Math.round(u)) < 1e-9; };
    const col = (i, X) => (tileEdge(X) ? (L.tile ? [1, 0.82, 0.45, 0.95] : [0.92, 0.78, 0.48, 0.8]) : i % 8 === 0 ? [0.62, 0.68, 0.5, 0.5] : [0.62, 0.68, 0.5, 0.13]);
    for (let x = 0; x <= nx; x++) seg([ox + x, oy, oz], [ox + x, oy + ny, oz], col(x, ox + x));
    for (let y = 0; y <= ny; y++) seg([ox, oy + y, oz], [ox + nx, oy + y, oz], col(y, oy + y));
    const C = [0.86, 0.82, 0.62, 0.45], hi = [ox + nx, oy + ny, oz + nz];
    const p = (k) => [k & 1 ? hi[0] : ox, k & 2 ? hi[1] : oy];
    for (const [a, b] of [[0, 1], [0, 2], [1, 3], [2, 3]]) seg([...p(a), hi[2]], [...p(b), hi[2]], C);
    for (let k = 0; k < 4; k++) seg([...p(k), oz], [...p(k), hi[2]], C);
    view.setLines(new Float32Array(v));
  }

  // ---------------------------------------------------------------- the API
  // Every call is synchronous, returns a small JSON value and is timed for the overlay; edits return
  // { changed, clipped, ms } and make one undo step when they change something.
  function call(name, fn) {
    const t0 = performance.now();
    if (!L.canvas && name !== "open" && name !== "load") throw new Error(name + ": no space yet (live.open first)");
    const r = fn(), ms = performance.now() - t0;
    L.last = { name, ms }; L.callT.push(t0); L.statsDirty = true;
    if (r && typeof r === "object" && "changed" in r) r.ms = r3(ms);
    return r;
  }
  function boxCall(name, a, b, m) {
    const s = slotArg(name, "m", m), cb = clip(a, b), total = [0, 1, 2].reduce((p, k) => p * (Math.abs(b[k] - a[k]) + 1), 1);
    const changed = edit(cb, () => { const w = cb[3] - cb[0] + 1; for (let z = cb[2]; z <= cb[5]; z++) for (let y = cb[1]; y <= cb[4]; y++) { const i = idx(cb[0], y, z); L.canvas.fill(s, i, i + w); } });
    return { changed, clipped: total - boxVol(cb) };
  }
  // cells of a list (space coordinates) set to slot s
  function cellsCall(cells, s) {
    let clipped = 0;
    const mn = [1e9, 1e9, 1e9], mx = [-1, -1, -1], ins = [];
    for (const c of cells) {
      if (!inside(c[0], c[1], c[2])) { clipped++; continue; }
      ins.push(idx(c[0], c[1], c[2]));
      for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k]; }
    }
    const changed = ins.length ? edit([...mn, ...mx], () => { for (const i of ins) L.canvas[i] = s; }) : 0;
    return { changed, clipped };
  }
  // what the overlay shows
  function statsNow() {
    const now = performance.now();
    while (L.callT.length && now - L.callT[0] > 1000) L.callT.shift();
    // the engine's brick pool holds every frame of a saved asset (or the canvas): past a quarter of the device's
    // ceiling, a scene of a few such assets would not fit, so it is said once
    const pool = L.frames.length ? L.frames.reduce((s, f) => s + (f.bricks || 0), 0) : L.bricks, poolMax = ME.poolMaxBricks(), poolWarn = pool > poolMax / 4;
    if (poolWarn && !L.poolWarned) ME.log("WARN", "live: " + pool + " of the brick pool's " + poolMax + " bricks (more than a quarter) for this asset's frames");
    L.poolWarned = poolWarn;
    return {
      dims: L.dims.slice(), grid: L.grid, tile: L.tile, cells: L.dims[0] * L.dims[1] * L.dims[2], cellsMax: MAX_CELLS, solid: L.solid, surface: L.surf, bricks: L.bricks, brickKB: L.bricks * 2,
      pool: { bricks: pool, max: poolMax, warn: poolWarn }, frameMB: mb(framesBytes(null)), frameMBMax: mb(MAX_FRAME_BYTES),
      frame: L.playing ? L.shown : null, frames: L.frames.length, fps: L.fps, playing: L.playing,
      last: L.last && { name: L.last.name, ms: r3(L.last.ms) }, cps: L.callT.length,
      undo: L.undo.length, redo: L.redo.length, shading: L.exact || L.exactSet ? "exact" : "live", exactMs: r3(L.exactMs), exactSkipped: L.exactSkipped, uploadMs: r3(L.uploadMs), materials: L.slots.length - 1, saved: L.saved,
      drawn: L.drawnN, error: L.error && { ...L.error },
    };
  }
  function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(call, arg, str) {
    let s;
    try { s = atob(str); } catch (e) { fail(call, arg, "is not base64"); }
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const live = (window.live = {
    ready: false,
    // the game whose art the page shows (index.html?game=), or "" for the studio's own
    game: (window.STUDIO_LOAD && STUDIO_LOAD.game) || "",
    open(o = {}) {
      return call("open", () => {
        if (typeof o !== "object" || o === null) fail("open", "options", "must be an object");
        const grid = o.grid === undefined ? 64 : num("open", "grid", o.grid);
        if (grid <= 0 || grid > MAX_GRID) fail("open", "grid", "must be in (0, " + MAX_GRID + "]");
        let dims;
        if (o.tile) { const h = o.h === undefined ? 1 : int("open", "h", o.h); if (!Number.isInteger(grid)) fail("open", "grid", "must be an integer for a tile"); dims = [grid, grid, grid * h]; }
        else dims = o.dims === undefined ? [64, 64, 64] : cellArg("open", "dims", o.dims);
        budget("open", o.tile ? "h" : "dims", dims);
        if (o.name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) fail("open", "name", "must be an identifier");
        newSpace(dims, grid, [-Math.floor(dims[0] / 2), -Math.floor(dims[1] / 2), 0], { tile: o.tile, h: o.h, name: o.name, label: o.label });
        return { dims, grid, tile: !!o.tile };
      });
    },
    set(x, y, z, m) {
      return call("set", () => {
        const c = [int("set", "x", x), int("set", "y", y), int("set", "z", z)], s = slotArg("set", "m", m);
        if (!inside(...c)) return { changed: 0, clipped: 1 };
        const i = idx(...c);
        return { changed: edit([...c, ...c], () => { L.canvas[i] = s; }), clipped: 0 };
      });
    },
    clear(x, y, z) {
      return call("clear", () => {
        const c = [int("clear", "x", x), int("clear", "y", y), int("clear", "z", z)];
        if (!inside(...c)) return { changed: 0, clipped: 1 };
        const i = idx(...c);
        return { changed: edit([...c, ...c], () => { L.canvas[i] = 0; }), clipped: 0 };
      });
    },
    box(a, b, m) { return call("box", () => boxCall("box", cellArg("box", "a", a), cellArg("box", "b", b), m)); },
    fill(m, a, b) {
      return call("fill", () => boxCall("fill", a === undefined ? [0, 0, 0] : cellArg("fill", "a", a), b === undefined ? L.dims.map((n) => n - 1) : cellArg("fill", "b", b), m));
    },
    // cells whose centre (the integer cell coordinates) lies within r of c
    sphere(c, r, m) {
      return call("sphere", () => {
        ptArg("sphere", "c", c); num("sphere", "r", r);
        if (r < 0 || r > 4 * MAX_AXIS) fail("sphere", "r", "must be in [0, " + 4 * MAX_AXIS + "]");
        const s = slotArg("sphere", "m", m), lo = c.map((v) => Math.ceil(v - r)), hi = c.map((v) => Math.floor(v + r)), cb = clip(lo, hi), rr = r * r + 1e-9;
        let total = 0;
        const rows = (write) => {
          for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) {
            const q = rr - (y - c[1]) ** 2 - (z - c[2]) ** 2;
            if (q < 0) continue;
            const w = Math.sqrt(q), xa = Math.ceil(c[0] - w), xb = Math.floor(c[0] + w);
            if (xb < xa) continue;
            if (!write) { total += xb - xa + 1; continue; }
            if (y < 0 || z < 0 || y >= L.dims[1] || z >= L.dims[2]) continue;
            const x0 = Math.max(0, xa), x1 = Math.min(L.dims[0] - 1, xb);
            if (x0 <= x1) L.canvas.fill(s, idx(x0, y, z), idx(x1, y, z) + 1);
          }
        };
        rows(false);
        let inCells = 0;
        if (cb) for (let z = cb[2]; z <= cb[5]; z++) for (let y = cb[1]; y <= cb[4]; y++) {
          const q = rr - (y - c[1]) ** 2 - (z - c[2]) ** 2;
          if (q < 0) continue;
          const w = Math.sqrt(q), x0 = Math.max(cb[0], Math.ceil(c[0] - w)), x1 = Math.min(cb[3], Math.floor(c[0] + w));
          if (x1 >= x0) inCells += x1 - x0 + 1;
        }
        const changed = edit(cb, () => rows(true));
        return { changed, clipped: total - inCells };
      });
    },
    // a 3D DDA from a to b; with r > 0, the capsule of cells within r of the segment
    line(a, b, m, r = 0) {
      return call("line", () => {
        // a and b may be fractional, as sphere's c: the DDA rounds the points along the exact segment (on
        // integer ends that is the cells it always drew), the capsule measures to the exact segment
        ptArg("line", "a", a); ptArg("line", "b", b); num("line", "r", r);
        if (r < 0) fail("line", "r", "must be >= 0");
        const s = slotArg("line", "m", m), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], cells = [];
        if (!r) {
          const n = Math.ceil(Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])) - 1e-9);
          if (n > MAX_SCAN) fail("line", "b", "is more than " + MAX_SCAN + " cells from a");
          const seen = new Set();
          for (let i = 0; i <= n; i++) {
            const c = a.map((v, k) => Math.round(v + (n ? (d[k] * i) / n : 0))), key = c.join();
            if (!seen.has(key)) { seen.add(key); cells.push(c); }
          }
          return cellsCall(cells, s);
        }
        const lo = a.map((v, k) => Math.ceil(Math.min(v, b[k]) - r)), hi = a.map((v, k) => Math.floor(Math.max(v, b[k]) + r));
        if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > MAX_SCAN) fail("line", "r", "with this segment spans more than " + MAX_SCAN + " cells");
        const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], rr = r * r + 1e-9;
        for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
          const px = x - a[0], py = y - a[1], pz = z - a[2], t = dd ? Math.min(1, Math.max(0, (px * d[0] + py * d[1] + pz * d[2]) / dd)) : 0;
          const ex = px - d[0] * t, ey = py - d[1] * t, ez = pz - d[2] * t;
          if (ex * ex + ey * ey + ez * ez <= rr) cells.push([x, y, z]);
        }
        return cellsCall(cells, s);
      });
    },
    // a 6-connected bucket fill of the region of the cell's material (empty is a region too)
    flood(x, y, z, m) {
      return call("flood", () => {
        const c = [int("flood", "x", x), int("flood", "y", y), int("flood", "z", z)], s = slotArg("flood", "m", m);
        if (!inside(...c)) return { changed: 0, clipped: 1 };
        const [nx, ny, nz] = L.dims, cv = L.canvas, i0 = idx(...c), s0 = cv[i0];
        if (s0 === s) return { changed: 0, clipped: 0 };
        const seen = new Uint8Array(cv.length), list = new Int32Array(cv.length), mn = [...c], mx = [...c];
        let n = 0, head = 0;
        list[n++] = i0; seen[i0] = 1;
        while (head < n) {
          const i = list[head++], px = i % nx, py = Math.floor(i / nx) % ny, pz = Math.floor(i / (nx * ny));
          if (px < mn[0]) mn[0] = px; if (px > mx[0]) mx[0] = px; if (py < mn[1]) mn[1] = py; if (py > mx[1]) mx[1] = py; if (pz < mn[2]) mn[2] = pz; if (pz > mx[2]) mx[2] = pz;
          const nb = [px > 0 ? i - 1 : -1, px < nx - 1 ? i + 1 : -1, py > 0 ? i - nx : -1, py < ny - 1 ? i + nx : -1, pz > 0 ? i - nx * ny : -1, pz < nz - 1 ? i + nx * ny : -1];
          for (const j of nb) if (j >= 0 && !seen[j] && cv[j] === s0) { seen[j] = 1; list[n++] = j; }
        }
        return { changed: edit([...mn, ...mx], () => { for (let k = 0; k < n; k++) cv[list[k]] = s; }), clipped: 0 };
      });
    },
    // the batch: an asset-format layer { o, n, mats, rle } or { o, n, mats, b64 } in space cells; 0 leaves a
    // cell, 1..254 set mats[v - 1], 255 clears
    patch(layer) {
      return call("patch", () => {
        if (!layer || typeof layer !== "object") fail("patch", "layer", "must be { o, n, mats, rle | b64 }");
        const o = cellArg("patch", "layer.o", layer.o), n = cellArg("patch", "layer.n", layer.n);
        if (n.some((v) => v < 1) || n[0] * n[1] * n[2] > MAX_SCAN) fail("patch", "layer.n", "must be positive and at most " + MAX_SCAN + " cells");
        if (!Array.isArray(layer.mats) || layer.mats.length > MAX_SLOTS) fail("patch", "layer.mats", "must be an array of at most " + MAX_SLOTS + " material names");
        const N = n[0] * n[1] * n[2];
        let vals;
        if (typeof layer.b64 === "string") vals = unb64("patch", "layer.b64", layer.b64);
        else if (Array.isArray(layer.rle)) { let k = 0; for (let i = 1; i < layer.rle.length; i += 2) k += layer.rle[i]; if (k !== N || layer.rle.length % 2) fail("patch", "layer.rle", "covers " + k + " cells, not " + N); vals = AF.rleDecode(layer.rle, N); }
        else fail("patch", "layer", "needs rle or b64");
        if (vals.length !== N) fail("patch", "layer.b64", "holds " + vals.length + " bytes, not " + N);
        const lut = new Uint8Array(256), has = new Uint8Array(256);
        has[0] = 1; has[255] = 1;
        layer.mats.forEach((m, k) => { lut[k + 1] = slotArg("patch", "layer.mats[" + k + "]", m); has[k + 1] = 1; });
        let clipped = 0;
        const seen = new Uint8Array(256);
        for (let i = 0; i < N; i++) { if (!has[vals[i]]) fail("patch", "layer", "value " + vals[i] + " has no material (mats has " + layer.mats.length + ")"); seen[vals[i]] = 1; }
        const unused = layer.mats.filter((m, k) => !seen[k + 1]);
        // values written 0-based (empty as 255) leave a cell where the first material belongs, draw each
        // material as the one before it and never use the last: values are 1-based
        const warn = seen[0] && seen[255] && layer.mats.length && !seen[layer.mats.length] ? "values 0 and 255 both occur and the last material, " + JSON.stringify(layer.mats[layer.mats.length - 1]) + ", is unused: were they written 0-based? 0 leaves a cell, v sets mats[v - 1], 255 clears" : null;
        if (warn) ME.log("WARN", "live.patch:", warn);
        for (let z = 0, i = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++, i++) if (vals[i] && !inside(o[0] + x, o[1] + y, o[2] + z)) clipped++;
        const cb = clip(o, [o[0] + n[0] - 1, o[1] + n[1] - 1, o[2] + n[2] - 1]);
        const changed = edit(cb, () => {
          for (let z = cb[2]; z <= cb[5]; z++) for (let y = cb[1]; y <= cb[4]; y++) {
            let i = ((z - o[2]) * n[1] + y - o[1]) * n[0] + cb[0] - o[0], j = idx(cb[0], y, z);
            for (let x = cb[0]; x <= cb[3]; x++, i++, j++) { const v = vals[i]; if (v) L.canvas[j] = v === 255 ? 0 : lut[v]; }
          }
        });
        return warn ? { changed, clipped, unused, warn } : { changed, clipped, unused };
      });
    },
    // a box (the whole space by default) as such a layer; empty cells are 255, so patch(read(a, b)) restores it
    read(a, b, enc = "rle") {
      return call("read", () => {
        const A = a === undefined || a === null ? [0, 0, 0] : cellArg("read", "a", a), B = b === undefined || b === null ? L.dims.map((n) => n - 1) : cellArg("read", "b", b);
        if (enc !== "rle" && enc !== "b64") fail("read", "enc", "must be \"rle\" or \"b64\"");
        const cb = clip(A, B);
        if (!cb) fail("read", "a", "and b hold no cell of the space");
        const vals = crop(L.canvas, L.dims, cb), lut = new Uint8Array(256), mats = [];
        for (let i = 0; i < vals.length; i++) { const s = vals[i]; if (!s) { vals[i] = 255; continue; } if (!lut[s]) { mats.push(L.slots[s]); lut[s] = mats.length; } vals[i] = lut[s]; }
        const out = { o: cb.slice(0, 3), n: [cb[3] - cb[0] + 1, cb[4] - cb[1] + 1, cb[5] - cb[2] + 1], mats };
        if (enc === "b64") out.b64 = b64(vals); else out.rle = AF.rleEncode(vals);
        return out;
      });
    },
    get(x, y, z) {
      return call("get", () => {
        const c = [int("get", "x", x), int("get", "y", y), int("get", "z", z)];
        return inside(...c) ? L.slots[L.canvas[idx(...c)]] || null : null;
      });
    },
    // an own material: the asset format's { ramp, em?, cls? }, or "#rrggbb" for a default ramp of that colour
    material(name, spec) {
      return call("material", () => {
        installOwn({ [name]: ownMat("material", "name", "spec", name, spec) });
        return { name, own: Object.keys(L.own).length };
      });
    },
    // many own materials at once, e.g. a style's palette: { name: spec, ... }; each takes a palette id only
    // when a cell first uses it
    materials(specs) {
      return call("materials", () => {
        if (!specs || typeof specs !== "object" || Array.isArray(specs)) fail("materials", "specs", "must be { name: spec, ... }");
        const mts = {};
        for (const n in specs) mts[n] = ownMat("materials", "name " + JSON.stringify(n), "specs." + n, n, specs[n]);
        installOwn(mts);
        return { names: Object.keys(mts), own: Object.keys(L.own).length };
      });
    },
    mats() { return call("mats", () => [...Object.keys(L.own), ...Object.keys(app.st.ramps).filter((n) => !L.own[n]).sort()]); },
    commit(i) {
      return call("commit", () => {
        const at = i === undefined ? L.frames.length : int("commit", "i", i);
        if (at < 0 || at > L.frames.length) fail("commit", "i", "must be 0.." + L.frames.length);
        if (at === L.frames.length && at >= MAX_FRAMES) fail("commit", "i", "would be frame " + (at + 1) + " (at most " + MAX_FRAMES + ")");
        const f = snapshot(), total = framesBytes(L.frames[at]) + f.bytes;
        if (total > MAX_FRAME_BYTES) fail("commit", "i", "would bring the stored frames to " + mb(total) + " MB (at most " + mb(MAX_FRAME_BYTES) + " MB): fewer frames, a smaller box, or live.drop(i)");
        L.frames[at] = f;
        if (!f.exact) queueBake(f);
        if (L.playing) L.shown = -1;
        return { frame: at, frames: L.frames.length, hash: f.hash };
      });
    },
    show(i) {
      return call("show", () => {
        const k = int("show", "i", i);
        if (k < 0 || k >= L.frames.length) fail("show", "i", "must be 0.." + (L.frames.length - 1));
        L.playing = false;
        const f = L.frames[k], all = [0, 0, 0, L.dims[0] - 1, L.dims[1] - 1, L.dims[2] - 1];
        const changed = edit(all, () => { L.canvas.fill(0); if (f.b) paste(L.canvas, L.dims, f.b, f.data); });
        // an exact frame shows its own set until the next edit (the live space's runs are kept meanwhile)
        if (f.exact && f.set) { clearTimeout(L.exactT); L.exactT = 0; L.exactSet = f.set; }
        L.shown = k; L.dirty = true;
        return { frame: k, changed, clipped: 0, hash: f.hash };
      });
    },
    drop(i) {
      return call("drop", () => {
        const k = int("drop", "i", i);
        if (k < 0 || k >= L.frames.length) fail("drop", "i", "must be 0.." + (L.frames.length - 1));
        L.frames.splice(k, 1);
        if (!L.frames.length) L.playing = false;
        L.shown = -1; L.dirty = true;
        return { frames: L.frames.length };
      });
    },
    frames() { return call("frames", () => L.frames.map((f, i) => ({ i, solid: f.solid, hash: f.hash }))); },
    // a volume already voxelised, { dims, rgba, names, box? } (ME.voxelizeModel's output, names[id] the
    // material of id: a palette's names), standing on cell at (the space's anchor by default): one undo step
    put(vol, at) {
      return call("put", () => {
        if (!vol || typeof vol !== "object") fail("put", "vol", "must be { dims, rgba, names, box? }");
        const d = cellArg("put", "vol.dims", vol.dims);
        if (d.some((n) => n < 1) || d[0] * d[1] * d[2] > MAX_SCAN) fail("put", "vol.dims", "must be positive and at most " + MAX_SCAN + " cells");
        if (!vol.rgba || vol.rgba.length !== d[0] * d[1] * d[2] * 4) fail("put", "vol.rgba", "must hold 4 bytes per cell (" + d[0] * d[1] * d[2] * 4 + ")");
        if (!Array.isArray(vol.names)) fail("put", "vol.names", "must be an array: names[id] is the material of id");
        if (vol.box !== undefined && !(Array.isArray(vol.box) && vol.box.length >= 3 && vol.box.slice(0, 3).every(Number.isInteger))) fail("put", "vol.box", "must start with the volume's min corner [x, y, z] integers");
        const c = at === undefined || at === null ? anchorCell() : cellArg("put", "at", at), stand = standing(vol, null);
        if (!stand) return { changed: 0, clipped: 0, solid: 0, mats: [], missing: [] };
        return place("put", vol, c, stand);
      });
    },
    // ME.modelOf(name, o) (window.MODELS[name](o) with its scale), voxelised through the page's palette and put standing on cell at. tall: its
    // height in cells (else vs, its voxels per tile; else the space's grid). open: first open a space fitted
    // to it (grid vs). clip [z0, z1]: only the cells z0..z1 above its lowest, standing on at (a bust).
    // name may also be a [name, o] pair, with opts second: live.model([name, { pose }], { tall: 120 })
    model(name, o = {}, opts = {}) {
      return call("model", () => {
        const pair = Array.isArray(name);
        if (pair) opts = o;
        const mo = modelOpts("model", opts, "tall | vs, at, open, clip"), spec = modelSpec("model", "name", "o", name, pair ? undefined : o);
        const { vs, vx } = density("model", spec, mo), vol = volOf(vx), stand = standing(vol, mo.clipZ);
        if (!stand) fail("model", mo.clipZ ? "clip" : "name", mo.clipZ ? "keeps no cells" : JSON.stringify(spec.name) + " draws no voxels at vs " + r3(vs));
        const lift = mo.open ? openFor("model", [stand], vs, spec.name) : 0;
        const r = place("model", vol, standAt("model", opts, lift), stand);
        return Object.assign(r, { name: spec.name, vs, dims: stand.hi.map((v, k) => v - stand.lo[k] + 1), hash: hashGrid(L.canvas, L.dims, L.org) });
      });
    },
    // a flipbook of poses: fn(t, i) gives frame i's model, { name, o } or [name, o], with t = i / frames (so a
    // loop's last frame leads back to the first; loop: false gives i / (frames - 1), ending on t = 1). Each
    // frame is voxelised as model() does, all at one density (tall: frame 0's height), drawn over the canvas as
    // it was, and committed as frame i; committed frames are replaced only with replace: true (undo does not
    // bring them back). open fits a space to all of them. The canvas is left on the last frame, and one undo
    // takes it back. Frames are voxelised one at a time as they are placed (with open, first to measure them,
    // keeping those that fit HOLD_BYTES). -> { frames, fps, vs, at, hashes, clipped, missing, ms, msPerFrame }
    animate(opts, fn) {
      return call("animate", () => {
        const keys = "frames, fps, loop, replace, tall | vs, at, open, clip";
        if (!opts || typeof opts !== "object") fail("animate", "opts", "must be { " + keys + " }");
        if (typeof fn !== "function") fail("animate", "fn", "must be (t, i) => ({ name, o }) or [name, o]");
        if (L.group) fail("animate", "opts", "comes inside begin(" + JSON.stringify(L.group.label) + "): end() it first");
        const n = int("animate", "frames", opts.frames);
        if (n < 1 || n > MAX_FRAMES) fail("animate", "frames", "must be 1.." + MAX_FRAMES);
        if (L.frames.length && !opts.replace) fail("animate", "opts", "would replace the " + L.frames.length + " committed frames, which undo does not bring back: pass replace: true");
        const fps = opts.fps === undefined ? L.fps : num("animate", "fps", opts.fps);
        if (fps <= 0 || fps > 60) fail("animate", "fps", "must be in (0, 60]");
        const loop = opts.loop === undefined ? true : !!opts.loop, mo = modelOpts("animate", opts, keys), t0 = performance.now(), specs = [];
        for (let i = 0; i < n; i++) {
          const t = loop ? i / n : n > 1 ? i / (n - 1) : 0, arg = "fn(" + r3(t) + ", " + i + ")";
          let p;
          try { p = fn(t, i); } catch (e) { fail("animate", arg, "threw: " + e.message); }
          if (!p || typeof p !== "object") fail("animate", arg, "must return { name, o } or [name, o]");
          specs.push(modelSpec("animate", arg, arg + ".o", Array.isArray(p) ? p : [p.name, p.o || {}]));
        }
        const { vs, vx } = density("animate", specs[0], mo);
        const frame = (i) => {
          const v = volOf(i ? ME.voxelizeModel(specs[i].md, vs, app.pal) : vx), s = standing(v, mo.clipZ);
          return s ? { v, s } : fail("animate", "fn", "frame " + i + " (" + specs[i].name + ") " + (mo.clipZ ? "keeps no cells with this clip" : "draws no voxels at vs " + r3(vs)));
        };
        // open needs every frame's extent first: those within HOLD_BYTES are kept, the rest voxelised again
        const held = new Array(n).fill(null);
        let lift = 0;
        if (mo.open) {
          const stands = [];
          for (let i = 0, bytes = 0; i < n; i++) { const f = frame(i); stands.push(f.s); if (bytes + f.v.rgba.length <= HOLD_BYTES) { held[i] = f; bytes += f.v.rgba.length; } }
          lift = openFor("animate", stands, vs, specs[0].name);
        }
        const at = standAt("animate", opts, lift);
        // each frame over the canvas as it was: the last frame's box is set back to it first. The undo step is
        // one record, the canvas as it was over the union of the boxes written
        const base = L.canvas.slice(), hashes = [], missing = new Set(), uni = [1e9, 1e9, 1e9, -1, -1, -1];
        let clipped = 0, prev = null;
        L.frames = []; L.playing = false; L.shown = -1; L.noUndo = true;
        try {
          for (let i = 0; i < n; i++) {
            const pb = prev;
            if (pb) edit(pb, () => { for (let z = pb[2]; z <= pb[5]; z++) for (let y = pb[1]; y <= pb[4]; y++) { const j = idx(pb[0], y, z); L.canvas.set(base.subarray(j, j + pb[3] - pb[0] + 1), j); } });
            const f = held[i] || frame(i), box = [];
            held[i] = null;
            const r = place("animate", f.v, at, f.s, box);
            clipped += r.clipped; for (const m of r.missing) missing.add(m);
            prev = box.length ? box : null;
            if (prev) for (let k = 0; k < 3; k++) { uni[k] = Math.min(uni[k], prev[k]); uni[k + 3] = Math.max(uni[k + 3], prev[k + 3]); }
            hashes.push(live.commit().hash);
          }
        } finally {
          L.noUndo = false;
          if (uni[3] >= 0) {
            const data = crop(base, L.dims, uni), cur = crop(L.canvas, L.dims, uni);
            if (cur.some((v, k) => v !== data[k])) { L.undo.push({ label: "animate", recs: [{ b: uni, data }] }); L.redo.length = 0; trimUndo(); }
          }
        }
        L.fps = fps;
        const ms = performance.now() - t0;
        return { frames: n, fps, vs, at, hashes, clipped, missing: [...missing].sort(), ms: r3(ms), msPerFrame: r3(ms / n) };
      });
    },
    // a pose between keys [{ t, pose }] (t rising): the numbers of the key before t, also in nested objects and
    // arrays, go towards the key after it along ease ("linear", "in", "out", "inOut", or a function on 0..1);
    // anything else is the earlier key's. Before the first key or after the last: that key's pose. For a loop
    // over t in 0..1, give the last key (t: 1) the first one's pose. Needs no space.
    tween(keys, t, ease = "inOut") {
      if (!Array.isArray(keys) || !keys.length || keys.some((k) => !k || typeof k.t !== "number" || !Number.isFinite(k.t) || !k.pose || typeof k.pose !== "object")) fail("tween", "keys", "must be [{ t, pose }]: numbers t, pose objects");
      for (let i = 1; i < keys.length; i++) if (keys[i].t < keys[i - 1].t) fail("tween", "keys", "must rise in t (key " + i + ")");
      num("tween", "t", t);
      const E = typeof ease === "function" ? ease : EASE[ease] || fail("tween", "ease", "must be " + Object.keys(EASE).join(", ") + " or a function on 0..1");
      const last = keys[keys.length - 1];
      if (t <= keys[0].t) return lerpPose(keys[0].pose, keys[0].pose, 0);
      if (t >= last.t) return lerpPose(last.pose, last.pose, 0);
      let i = 0;
      while (keys[i + 1].t <= t) i++;
      const a = keys[i], b = keys[i + 1];
      return lerpPose(a.pose, b.pose, num("tween", "ease", E((t - a.t) / (b.t - a.t))));
    },
    play(fps = 12) {
      return call("play", () => {
        num("play", "fps", fps);
        if (fps <= 0 || fps > 60) fail("play", "fps", "must be in (0, 60]");
        if (!L.frames.length) fail("play", "frames", "none committed yet (live.commit())");
        L.fps = fps; L.playing = true; L.playT0 = performance.now(); L.shown = -1;
        return { frames: L.frames.length, fps };
      });
    },
    stop() { return call("stop", () => { L.playing = false; L.shown = -1; L.dirty = true; return { frames: L.frames.length }; }); },
    begin(label) {
      return call("begin", () => {
        if (L.group) fail("begin", "label", "comes inside begin(" + JSON.stringify(L.group.label) + "): end() it first");
        L.group = { label: label === undefined ? null : String(label), recs: [] };
        return { label: L.group.label };
      });
    },
    end() {
      return call("end", () => {
        const g = L.group;
        if (!g) throw new Error("end: no begin() to end");
        L.group = null;
        if (g.recs.length) { L.undo.push(g); L.redo.length = 0; trimUndo(); }
        return { label: g.label, calls: g.recs.length, undo: L.undo.length };
      });
    },
    undo() {
      return call("undo", () => {
        if (L.group) throw new Error("undo: inside begin(" + JSON.stringify(L.group.label) + "): end() it first");
        const st = L.undo.pop();
        const changed = st ? swapStep(st, -1) : 0;
        if (st) L.redo.push(st);
        return { changed, clipped: 0, undo: L.undo.length, redo: L.redo.length };
      });
    },
    redo() {
      return call("redo", () => {
        if (L.group) throw new Error("redo: inside begin(" + JSON.stringify(L.group.label) + "): end() it first");
        const st = L.redo.pop();
        const changed = st ? swapStep(st, 1) : 0;
        if (st) L.undo.push(st);
        return { changed, clipped: 0, undo: L.undo.length, redo: L.redo.length };
      });
    },
    hash() { return call("hash", () => hashGrid(L.canvas, L.dims, L.org)); },
    // the exact bake of the canvas now, whatever its size (the idle one skips big spaces): for the exact look
    // of a big scene before a shot. It blocks while it bakes (about 1.5 s for 4 M solid cells). -> { ms, solid }
    exact() {
      return call("exact", () => {
        clearTimeout(L.exactT); L.exactT = 0;
        if (!L.solid) return { ms: 0, solid: 0 };
        const t0 = performance.now();
        L.exact = bakeExact(layerOf(L.canvas, L.dims, L.org)); L.exactSet = null;
        L.exactMs = performance.now() - t0; L.exactSkipped = false; L.dirty = true; L.statsDirty = true;
        return { ms: r3(L.exactMs), solid: L.solid };
      });
    },
    // resolves after the next frame the page draws with nothing left to upload, so a page shot taken then
    // shows the latest edit (tools/voxel-live.ps1 -Shot awaits it): { frame: frames drawn so far, ms }
    drawn() {
      const t0 = performance.now();
      L.drawWanted = true;
      return new Promise((res, rej) => {
        const done = () => { clearTimeout(timer); res({ frame: L.drawnN, ms: r3(performance.now() - t0) }); };
        const timer = setTimeout(() => {
          L.drawnWait = L.drawnWait.filter((f) => f !== done);
          rej(new Error("drawn: the viewer is not drawing (hidden without the backgrounding flags? tools\\voxel-live.ps1 -Close, then -Open)"));
        }, 2000);
        L.drawnWait.push(done);
      });
    },
    // the camera, at once (no snap animation): angles in degrees, target in space cells, zoom in device pixels
    // per cell; fit "solid" frames the solid cells' tight box, "space" the whole space, so that it takes
    // fill of the view. With no argument it only reads the camera.
    view(o = {}) {
      return call("view", () => {
        if (typeof o !== "object" || o === null) fail("view", "options", "must be an object");
        const c = view.cam, deg = Math.PI / 180;
        if (o.engine !== undefined && typeof o.engine !== "boolean") fail("view", "engine", "must be true or false");
        if (o.fit !== undefined && o.fit !== "solid" && o.fit !== "space") fail("view", "fit", "must be \"solid\" or \"space\" (got " + JSON.stringify(o.fit) + ")");
        const fill = o.fill === undefined ? 0.85 : num("view", "fill", o.fill);
        if (fill <= 0 || fill > 1) fail("view", "fill", "must be in (0, 1]");
        if (o.pitch !== undefined && (num("view", "pitch", o.pitch) < -90 || o.pitch > 90)) fail("view", "pitch", "must be in [-90, 90]");
        if (o.zoom !== undefined && num("view", "zoom", o.zoom) <= 0) fail("view", "zoom", "must be positive");
        const tgt = o.target === undefined ? null : ptArg("view", "target", o.target), yaw = o.yaw === undefined ? null : num("view", "yaw", o.yaw);
        c.anim = null;
        if (yaw !== null) c.yaw = yaw * deg;
        if (o.pitch !== undefined) { c.pitch = o.pitch; if (o.engine === undefined) c.engine = false; }
        if (o.engine !== undefined) c.engine = o.engine;
        if (o.fit) {
          const b = (o.fit === "solid" && tight(L.canvas, L.dims)) || [0, 0, 0, L.dims[0] - 1, L.dims[1] - 1, L.dims[2] - 1];
          frameBox(b, fill);
        }
        if (tgt) c.target = tgt.map((v, k) => (L.org[k] + v + 0.5) / L.grid);
        if (o.zoom !== undefined) c.zoom = o.zoom * L.grid;
        return camNow();
      });
    },
    // a PNG of the viewport alone, drawn now with the latest edit: w x h pixels (the canvas's size by
    // default, at most 2048 each) framed as the view is, transparent with alpha, the box and floor lines
    // only with lines
    shot(o = {}) {
      return call("shot", () => {
        if (typeof o !== "object" || o === null) fail("shot", "options", "must be an object");
        const cv = view.cv, W0 = cv.width, H0 = cv.height;
        const size = (k, d) => { const v = o[k] === undefined ? d : int("shot", k, o[k]); if (v < 16 || v > MAX_SHOT) fail("shot", k, "must be in 16.." + MAX_SHOT); return v; };
        const w = size("w", Math.min(W0, MAX_SHOT)), h = size("h", Math.min(H0, MAX_SHOT));
        if (!L.playing && L.dirty) { L.dirty = false; present(); }
        const c = view.cam, z0 = c.zoom, lc = view.lines ? view.lines.count : 0;
        let url;
        try {
          cv.width = w; cv.height = h; c.zoom = (z0 * h) / H0;
          if (!o.lines && view.lines) view.lines.count = 0;
          view.render(performance.now() / 1000, { alpha: !!o.alpha });
          url = cv.toDataURL("image/png");
        } finally {
          c.zoom = z0; if (view.lines) view.lines.count = lc;
          cv.width = W0; cv.height = H0; L.drawWanted = true;
        }
        return url;
      });
    },
    // who holds the viewer (tools/voxel-live.ps1 sets it from its lease); the page title shows it
    owner(name) {
      if (name !== undefined) { L.owner = String(name); setTitle(); }
      return L.owner;
    },
    stats() { return call("stats", statsNow); },
    // the live document: a flipbook of the committed frames (or the canvas when none), kept in the library
    save(o = {}) {
      return call("save", () => {
        const name = o.name === undefined ? L.name : o.name;
        if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail("save", "name", "must be an identifier (got " + JSON.stringify(name) + ")");
        const layers = L.frames.length ? L.frames.map((f) => f.layer) : [layerOf(L.canvas, L.dims, L.org)];
        const used = new Set(layers.flatMap((l) => (l ? l.mats : []))), mats = {};
        for (const n in L.own) if (used.has(n)) mats[n] = JSON.parse(JSON.stringify(L.own[n]));
        const doc = { format: AF.FORMAT, version: AF.VERSION, name, label: o.label === undefined ? L.label || name : String(o.label), k: 1, grid: L.grid, frames: layers.length, fps: L.fps, prims: [], vox: JSON.parse(JSON.stringify(layers)), mats };
        // a large flipbook may not fit the browser's storage quota: stats().saved says whether the library kept it
        L.saved = { name, stored: SV.store.save(JSON.parse(JSON.stringify(doc))) };
        return doc;
      });
    },
    // a live document back: its frames, materials and fps. The space is the union of the frames' layers,
    // widened to keep the anchor (the ground centre) where it was.
    load(doc) {
      return call("load", () => {
        if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch (e) { fail("load", "doc", "is not JSON: " + e.message); } }
        if (!doc || doc.format !== AF.FORMAT) fail("load", "doc", "is not a " + AF.FORMAT + " document");
        const layers = Array.isArray(doc.vox) ? doc.vox : doc.vox ? [doc.vox] : fail("load", "doc.vox", "is missing");
        if (!layers.length || layers.length > MAX_FRAMES) fail("load", "doc.vox", "must hold 1.." + MAX_FRAMES + " frames");
        // a frame keeps 2 bytes a cell of its box and 12 a surface cell: about twice its box's hull, for an estimate
        const est = layers.reduce((s, l) => { if (!l) return s; const [a, b, c] = l.n; return s + a * b * c * 2 + 24 * (a * b + b * c + a * c); }, 0);
        if (est > MAX_FRAME_BYTES) fail("load", "doc.vox", "would store about " + mb(est) + " MB of frames (at most " + mb(MAX_FRAME_BYTES) + " MB)");
        const grid = AF.grid(doc), { dims, org } = docSpace(layers);
        budget("load", "doc.vox", dims, " (the space its layers span about their anchor)");
        for (const n in doc.mats || {}) { L.own[n] = doc.mats[n]; app.installDocMats({ mats: { [n]: doc.mats[n] } }); if (app.pal.ids[n] !== undefined) regenPalette(); }
        newSpace(dims, grid, org, { name: doc.name, label: doc.label || "" });
        const frames = [];
        layers.forEach((l, fi) => {
          L.canvas.fill(0);
          if (l) {
            // a material neither the palette nor the document defines is drawn as stone, as the studio does
            const lut = l.mats.map((m, k) => { if (typeof m === "string" && !known(m)) { L.own[m] = { ramp: app.st.ramps.stone }; app.installDocMats({ mats: { [m]: L.own[m] } }); } return slotArg("load", "doc.vox[" + fi + "].mats[" + k + "]", m); });
            const vals = AF.rleDecode(l.rle, l.n[0] * l.n[1] * l.n[2]);
            for (let z = 0, i = 0; z < l.n[2]; z++) for (let y = 0; y < l.n[1]; y++) for (let x = 0; x < l.n[0]; x++, i++) { const v = vals[i]; if (v && v !== 255) L.canvas[idx(l.o[0] - org[0] + x, l.o[1] - org[1] + y, l.o[2] - org[2] + z)] = lut[v - 1]; }
          }
          reshade([0, 0, 0, dims[0] - 1, dims[1] - 1, dims[2] - 1]);
          frames.push(snapshot());
        });
        L.frames = frames; L.fps = doc.fps || 12;
        for (const f of frames) if (!f.exact) queueBake(f);
        // the canvas shows frame 0, with no undo history
        L.canvas.fill(0);
        if (frames[0].b) paste(L.canvas, L.dims, frames[0].b, frames[0].data);
        touched([0, 0, 0, dims[0] - 1, dims[1] - 1, dims[2] - 1]);
        return { name: L.name, dims, grid, frames: frames.length, fps: L.fps };
      });
    },
    // the bridge's entry (tools/voxel-live.ps1 -Eval and -File): code runs with live in scope, as an
    // expression or as a function body (await works); "ok <value as JSON>" or "error <message>"
    async run(code) {
      try {
        let fn;
        const expr = String(code).trim().replace(/;+$/, "");
        try { fn = new AsyncFunction("live", "return (" + expr + "\n);"); } catch (e) { fn = new AsyncFunction("live", code); }
        const v = await fn(live);
        return "ok " + (v === undefined ? "null" : JSON.stringify(v));
      } catch (e) { return "error " + (e && e.message ? e.message : String(e)); }
    },
  });

  // ---------------------------------------------------------------- saved models, on disk
  // A saved model is NAME.json (the document live.save returns) in the models folder: the folder is the source
  // of truth, and the studio library in localStorage only a cache. The page reads the folder by fetch of
  // file:/// (the viewer runs with --allow-file-access-from-files) and lists it from the directory's listing
  // page. It writes and deletes through a folder handle (the File System Access API) chosen once from the
  // picker and kept in IndexedDB; without one the folder is read-only here, and tools/voxel-live.ps1 -Save
  // and -Delete write it. ?models= names the folder (the ps1 passes its -ModelsDir).
  const MODELS_DIR = String(ME.q("models", "C:/ClaudeWorkspace/voxel-live-models")).replace(/\\/g, "/").replace(/\/+$/, "");
  const MODEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const MS = { handle: undefined, test: null, note: "" }; // test: the self-test's folder, used in place of the handle
  // deleting saved models is off for now (the user, 2026-10-24): no Delete in the picker, deleteModel and the
  // ps1's -Delete refuse. Only the self-test's temp folder still deletes, for its round trip.
  const DELETE_OFF = true;
  const dirUrl = () => "file:///" + encodeURI(MODELS_DIR.replace(/^\/+/, "")) + "/";
  const nameArg = (call, name) => { if (typeof name !== "string" || !MODEL_NAME.test(name)) fail(call, "name", "must be an identifier (got " + JSON.stringify(name) + ")"); return name; };
  // one request on the page's IndexedDB store "kv": its result
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open("voxel-live", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const db = rq.result, tx = db.transaction("kv", mode), r = fn(tx.objectStore("kv"));
        tx.oncomplete = () => { db.close(); res(r.result); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      };
    });
  }
  // the folder handle with write permission, or null: the self-test's, else the one chosen before. With ask
  // (from a click) it asks for the permission again, or for a folder when there is none.
  async function folder(ask) {
    if (MS.test) return MS.test;
    if (MS.handle === undefined) { try { MS.handle = (await idb("readonly", (s) => s.get("models"))) || null; } catch (e) { MS.handle = null; } }
    let h = MS.handle;
    try { if (h && (await h.queryPermission({ mode: "readwrite" })) === "granted") return h; } catch (e) { h = null; }
    if (!ask) return null;
    try { if (h && (await h.requestPermission({ mode: "readwrite" })) === "granted") return h; } catch (e) {}
    if (!window.showDirectoryPicker) throw new Error("this browser can't write a folder (no File System Access): use .\\tools\\voxel-live.ps1 -Save NAME");
    h = await window.showDirectoryPicker({ id: "voxel-live-models", mode: "readwrite" });
    MS.handle = h; MS.note = "";
    try { await idb("readwrite", (s) => s.put(h, "models")); } catch (e) { MS.note = "kept for this session only (IndexedDB refused the folder)"; }
    return h;
  }
  async function folderState() {
    const h = await folder(false), base = MODELS_DIR.split("/").pop();
    return { dir: MODELS_DIR, chosen: h ? (h === MS.test ? "(self-test)" : h.name) : MS.handle ? MS.handle.name : null, write: !!h,
      other: !!(h && h !== MS.test && h.name !== base), note: MS.note };
  }
  async function readUrl(u, what) {
    let r;
    try { r = await fetch(u); } catch (e) { throw new Error("can't read " + what + ": it is missing, or the page has no file access (a file:// page with --allow-file-access-from-files)"); }
    // a file:// directory listing answers with status 0 (a file with 200); a missing file is a rejected fetch
    if (!r.ok && r.status !== 0) throw new Error("can't read " + what + " (" + r.status + ")");
    return r.text();
  }
  async function readModel(h, name) {
    if (!h) { try { return await readUrl(dirUrl() + name + ".json", name + ".json"); } catch (e) { throw new Error("no model " + name + " in " + MODELS_DIR + " (" + e.message + ")"); } }
    try { return await (await (await h.getFileHandle(name + ".json")).getFile()).text(); } catch (e) { throw new Error("no model " + name + " in the folder " + h.name + " (" + e.message + ")"); }
  }
  // one list entry from a model file's text
  function modelEntry(name, text, modified) {
    const e = { name, label: "", frames: 0, dims: null, grid: null, kb: Math.round(text.length / 1024), modified };
    try {
      const d = JSON.parse(text), ls = Array.isArray(d.vox) ? d.vox : d.vox ? [d.vox] : [];
      Object.assign(e, { label: d.label || "", frames: ls.length, dims: ls.length ? docSpace(ls).dims : null, grid: AF.grid(d) });
    } catch (err) { e.error = "not a live document: " + err.message; }
    return e;
  }
  // the folder's models, newest first: from the handle, else from the directory's listing page (Chromium's,
  // a script of addRow(name, url, isdir, size, size text, modified s, modified text) calls)
  async function listModels(h) {
    const out = [], isModel = (n) => n.endsWith(".json") && MODEL_NAME.test(n.slice(0, -5));
    if (h) {
      for await (const [n, e] of h.entries()) if (e.kind === "file" && isModel(n)) { const f = await e.getFile(); out.push(modelEntry(n.slice(0, -5), await f.text(), f.lastModified)); }
    } else {
      const page = await readUrl(dirUrl(), "the models folder " + MODELS_DIR);
      const rows = [...page.matchAll(/addRow\("((?:[^"\\]|\\.)*)","(?:[^"\\]|\\.)*",0,\d+,"[^"]*",(\d+),/g)];
      if (!rows.length && !/addRow|start\(/.test(page)) throw new Error("can't list " + MODELS_DIR + ": the page got no directory listing");
      for (const [, n, t] of rows) if (isModel(n)) out.push(modelEntry(n.slice(0, -5), await readUrl(dirUrl() + n, n), +t * 1000));
    }
    return out.sort((a, b) => b.modified - a.modified || (a.name < b.name ? -1 : 1));
  }
  // live.save written to the folder as NAME.json, replacing it (createWritable swaps the file in on close)
  async function saveModel(o, ask) {
    const doc = live.save(o), text = JSON.stringify(doc);
    L.saved.file = null; L.statsDirty = true;
    let h;
    try { h = await folder(ask); } catch (e) { L.saved.error = e.message; throw new Error("saveModel: " + e.message); }
    if (!h) { L.saved.error = "no folder chosen"; fail("saveModel", "folder", "is read-only here (no folder chosen in the picker): .\\tools\\voxel-live.ps1 -Save " + doc.name); }
    try { const w = await (await h.getFileHandle(doc.name + ".json", { create: true })).createWritable(); await w.write(text); await w.close(); }
    catch (e) { L.saved.error = e.message; fail("saveModel", doc.name + ".json", "could not be written: " + e.message); }
    L.saved.file = doc.name + ".json"; L.saved.error = null; L.statsDirty = true;
    return { name: doc.name, file: (h === MS.test ? "(self-test)" : h.name) + "/" + doc.name + ".json", frames: doc.frames, kb: Math.round(text.length / 1024) };
  }
  async function deleteModel(name, ask) {
    nameArg("deleteModel", name);
    const h = await folder(ask);
    if (DELETE_OFF && h !== MS.test) fail("deleteModel", "name", "can't be deleted: deleting saved models is turned off for now");
    if (!h) fail("deleteModel", "folder", "is read-only here (no folder chosen in the picker): .\\tools\\voxel-live.ps1 -Delete " + name);
    try { await h.removeEntry(name + ".json"); } catch (e) { fail("deleteModel", name + ".json", "could not be removed: " + e.message); }
    return { deleted: name };
  }
  // the self-test's temp folder: a fresh one in the origin's private file system (the same handle API as a
  // folder on disk), else one in memory with that API's few calls
  async function testFolder() {
    try {
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry("live-selftest", { recursive: true }); } catch (e) {}
      return Object.assign(await root.getDirectoryHandle("live-selftest", { create: true }), { via: "opfs" });
    } catch (e) {
      const files = new Map();
      const fh = (n) => ({ kind: "file", name: n, getFile: async () => new File([files.get(n).text], n, { lastModified: files.get(n).t }),
        createWritable: async () => { let buf = ""; return { write: async (t) => { buf += t; }, close: async () => { files.set(n, { text: buf, t: Date.now() }); } }; } });
      return { via: "memory (" + e.message + ")", kind: "directory", name: "live-selftest",
        async *entries() { for (const n of [...files.keys()]) yield [n, fh(n)]; },
        async getFileHandle(n, o = {}) { if (!files.has(n)) { if (!o.create) throw new Error(n + " not found"); files.set(n, { text: "", t: Date.now() }); } return fh(n); },
        async removeEntry(n) { if (!files.delete(n)) throw new Error(n + " not found"); } };
    }
  }
  Object.assign(live, {
    // the saved models in the folder, newest first: [{ name, label, frames, dims, grid, kb, modified (ms) }]
    async models() { return listModels(await folder(false)); },
    // a saved model by name, loaded (live.load) and framed: live.load's result
    async loadSaved(name) {
      nameArg("loadSaved", name);
      const r = live.load(await readModel(await folder(false), name));
      live.view({ fit: "solid" });
      return r;
    },
    // live.save, written to the folder as NAME.json: { name, file, frames, kb }. It needs the folder handle,
    // which the picker asks for; without one it fails, naming the ps1 command that writes the folder.
    saveModel(o = {}) { return saveModel(o, false); },
    // a saved model's file removed: { deleted }
    deleteModel(name) { return deleteModel(name, false); },
    // the folder: { dir, chosen (the handle's folder name, or null), write, other (the handle is another folder), note }
    modelsFolder() { return folderState(); },
  });

  // ---------------------------------------------------------------- page: overlay, strip, keys, loop
  const CSS = `
  body.live #app { grid-template-columns: 1fr; grid-template-rows: 1fr; height: 100vh; min-height: 0; }
  body.live header, body.live aside, body.live #side, body.live #tools, body.live #timeline, body.live #status, body.live #ov { display: none; }
  #live-stats { position: absolute; left: 10px; top: 10px; font: 11px/1.55 ui-monospace, Consolas, monospace; color: var(--dim); background: rgba(18, 21, 15, 0.82); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; pointer-events: none; white-space: pre; }
  #live-stats b { color: var(--fg); font-weight: 600; }
  #live-stats .t { color: var(--acc); }
  #live-help { position: absolute; right: 10px; top: 10px; font: 11px/1.5 ui-monospace, Consolas, monospace; color: var(--dim); background: rgba(18, 21, 15, 0.7); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; pointer-events: none; white-space: pre; }
  #live-strip { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  #live-strip button { min-width: 28px; padding: 2px 6px; font: 11px ui-monospace, Consolas, monospace; }
  #live-strip span { font: 11px ui-monospace, Consolas, monospace; color: var(--dim); margin-right: 4px; }
  #live-bar { position: absolute; right: 10px; top: 76px; display: flex; gap: 4px; }
  #live-bar button, #live-pick button { padding: 3px 9px; font: 11px ui-monospace, Consolas, monospace; }
  #live-pick { position: absolute; right: 10px; top: 104px; width: 380px; max-width: calc(100vw - 20px); max-height: calc(100vh - 160px); display: flex; flex-direction: column; gap: 6px; box-sizing: border-box;
    font: 11px/1.5 ui-monospace, Consolas, monospace; color: var(--dim); background: rgba(18, 21, 15, 0.94); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  #live-pick[hidden] { display: none; }
  #live-pick .hd { display: flex; gap: 6px; align-items: center; } #live-pick .hd b { color: var(--fg); flex: 1; }
  #live-pick .dir { overflow-wrap: anywhere; } #live-pick .warn { color: var(--acc); }
  #live-pick form { display: flex; flex-wrap: wrap; gap: 4px; } #live-pick input { flex: 1 1 120px; min-width: 0; font: 11px ui-monospace, Consolas, monospace; padding: 3px 6px; }
  #live-pick .list { overflow-y: auto; display: flex; flex-direction: column; gap: 3px; min-height: 0; }
  #live-pick .row { display: flex; gap: 4px; align-items: stretch; }
  #live-pick .row > button:first-child { flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; }
  #live-pick .row b { color: var(--fg); } #live-pick .row span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 480px) { #live-help { display: none; } #live-bar { top: 10px; } #live-pick { top: 40px; left: 10px; right: 10px; width: auto; max-height: calc(100vh - 100px); } }`;
  let statsEl, stripEl, stripKey = "", pickEl, pickMode = "", pickMsg = "", pickConfirm = "";
  function renderStats() {
    const s = statsNow(), f = s.frames ? (s.playing ? `frame <b>${s.frame + 1}</b> / ${s.frames} · ▶ ${s.fps} fps` : `canvas · ${s.frames} frame${s.frames > 1 ? "s" : ""} · ${s.fps} fps`) : "canvas · no frames yet";
    statsEl.innerHTML = `<span class="t">VOXEL LIVE</span> · ${L.name}\n` +
      `<b>${s.dims.join("×")}</b> cells · grid ${s.grid}${s.tile ? " · tile ×" + L.h : ""}\n` +
      `<b>${s.solid.toLocaleString()}</b> solid · ${s.surface.toLocaleString()} surface\n` +
      `<b>${s.bricks}</b> bricks (${s.brickKB} KB of the engine's pool)\n${f}\n` +
      `last ${s.last ? `<b>${s.last.name}</b> ${s.last.ms} ms` : "—"} · ${s.cps} calls/s\n` +
      `undo ${s.undo} · redo ${s.redo} · shading ${s.shading}${s.shading === "exact" ? ` (${Math.round(s.exactMs)} ms)` : ""}` +
      (L.saved ? `\nsaved <b>${L.saved.name}</b> · ${L.saved.file ? "on disk" : "<b>not on disk</b>" + (L.saved.error ? ": " + esc(L.saved.error) : "")}${L.saved.stored ? "" : " · the browser cache refused it"}` : "") +
      (s.error ? `\n<b>draw error</b> ×${s.error.count}: ${esc(s.error.message)}` : "");
    const key = L.frames.length + ":" + (L.playing ? L.shown : -1) + ":" + L.frames.map((x) => x.hash).join();
    if (key === stripKey) return;
    stripKey = key;
    stripEl.replaceChildren(...(L.frames.length ? [Object.assign(document.createElement("span"), { textContent: "frames" })] : []), ...L.frames.map((x, i) => {
      const b = document.createElement("button");
      b.textContent = i + 1; b.title = "show frame " + (i + 1) + " (" + x.solid + " solid, " + x.hash + ")";
      if (L.playing && L.shown === i) b.className = "on";
      b.onclick = () => live.show(i);
      return b;
    }));
  }
  const esc = (t) => String(t).replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
  // the model picker: the folder's models, newest first (a click loads one and frames it), Save (a name, by
  // default the space's) and Delete (asked again in place). Its keys stay its own: the viewer's go on as
  // before while it is closed, and Escape closes it.
  const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k !== null)); return e; };
  function togglePicker(mode) {
    if (!pickEl.hidden && pickMode === mode) return closePicker();
    pickMode = mode; pickMsg = ""; pickConfirm = ""; pickEl.hidden = false;
    renderPicker();
  }
  function closePicker() { pickEl.hidden = true; pickMode = ""; }
  async function pickerDo(what, fn) {
    pickMsg = what + "…"; renderPicker(true);
    try { pickMsg = await fn(); } catch (e) { pickMsg = "! " + e.message; }
    await renderPicker();
  }
  // keep: redraw with the list as it was (while a call is under way)
  let pickList = [], pickErr = "", pickState = null;
  async function renderPicker(keep) {
    if (pickEl.hidden) return;
    if (!keep || !pickState) {
      pickState = await folderState();
      try { pickList = await live.models(); pickErr = ""; } catch (e) { pickList = []; pickErr = e.message; }
    }
    const st = pickState, btn = (text, title, on) => el("button", { type: "button", textContent: text, title, onclick: (e) => { e.currentTarget.blur(); on(); } });
    const where = st.write ? `${st.chosen} (chosen: save and delete here)` : st.chosen ? `${st.dir} (read-only: Folder… to allow writing to ${st.chosen} again)` : `${st.dir} (read-only: Folder… to choose it, for Save and Delete)`;
    const kids = [
      el("div", { className: "hd" }, el("b", { textContent: pickMode === "save" ? "Save model" : "Models" }),
        btn("Folder…", "choose the models folder (" + st.dir + ") for saving and deleting", () => pickerDo("choosing the folder", async () => { const h = await folder(true); return "the folder is " + h.name; })),
        btn("×", "close (Esc)", closePicker)),
      el("div", { className: "dir", textContent: where }),
      st.other ? el("div", { className: "warn", textContent: `the chosen folder is ${st.chosen}, not ${st.dir.split("/").pop()}: Folder… to choose ${st.dir}` }) : null,
      st.note ? el("div", { className: "warn", textContent: st.note }) : null,
    ];
    if (pickMode === "save") {
      const name = el("input", { name: "name", value: L.name, placeholder: "name (an identifier)", spellcheck: false, title: "the file is NAME.json; an existing one is replaced" });
      const label = el("input", { name: "label", value: L.label || "", placeholder: "label (optional)" });
      const form = el("form", { onsubmit: (e) => { e.preventDefault(); pickerDo("saving " + name.value, async () => { const r = await saveModel({ name: name.value.trim(), label: label.value.trim() || undefined }, true); return `saved ${r.file} (${r.frames} frame${r.frames > 1 ? "s" : ""}, ${r.kb} KB)`; }); } },
        name, label, el("button", { type: "submit", textContent: "Save" }));
      kids.push(form);
    }
    if (pickMsg) kids.push(el("div", { className: pickMsg.startsWith("! ") ? "warn" : "", textContent: pickMsg.replace(/^! /, "") }));
    if (pickErr) kids.push(el("div", { className: "warn", textContent: pickErr }));
    else if (!pickList.length) kids.push(el("div", { textContent: "no saved models in the folder yet" }));
    kids.push(el("div", { className: "list" }, ...pickList.map((m) => {
      const meta = m.error ? m.error : `${m.frames} frame${m.frames > 1 ? "s" : ""} · ${m.dims ? m.dims.join("×") : "?"} · ${m.kb} KB · ${new Date(m.modified).toLocaleString()}`;
      const load = el("button", { type: "button", title: "load " + m.name + " and frame it", disabled: !!m.error, onclick: (e) => { e.currentTarget.blur(); pickerDo("loading " + m.name, async () => { const r = await live.loadSaved(m.name); return `loaded ${m.name}: ${r.frames} frame${r.frames > 1 ? "s" : ""}, ${r.dims.join("×")}`; }); } },
        el("span", {}, el("b", { textContent: m.name }), m.label && m.label !== m.name ? " · " + m.label : ""), el("span", { textContent: meta }));
      const del = DELETE_OFF ? [] : pickConfirm === m.name
        ? [btn("Delete?", "remove " + m.name + ".json from the folder", () => { pickConfirm = ""; pickerDo("deleting " + m.name, async () => { await deleteModel(m.name, true); return "deleted " + m.name + ".json"; }); }), btn("Keep", "keep it", () => { pickConfirm = ""; renderPicker(true); })]
        : [btn("Delete", st.write ? "delete " + m.name + ".json" : "the folder is read-only here: Folder… first, or .\\tools\\voxel-live.ps1 -Delete " + m.name, () => { pickConfirm = m.name; renderPicker(true); })];
      return el("div", { className: "row" }, load, ...del);
    })));
    pickEl.replaceChildren(...kids.filter((k) => k !== null));
  }
  // the live volume re-sends only the boxes reshaded since its last upload (view.setVolume rebuilds everything
  // for another volume, or when they are null); an exact bake or a frame is sent whole
  function upload(vol) {
    const t0 = performance.now(), boxes = vol === L.vol ? L.dirtyBoxes : null;
    if (vol === L.vol) L.dirtyBoxes = [];
    app.syncTables(); view.setVolume(vol, null, boxes); L.uploadMs = performance.now() - t0;
  }
  let lastCam = "", lastSize = "", statsAt = 0;
  // the next frame is asked for first, so an error in the body can't stop the loop: it shows in the overlay
  // and in stats().error, and is logged once
  function loop(now) {
    requestAnimationFrame(loop);
    try {
      view.resize();
      let draw = view.cam.update(now) || L.drawWanted;
      const c = view.cam, ck = [c.yaw, c.pitch, c.zoom, c.engine, ...c.target].join(), sk = view.cv.width + "x" + view.cv.height;
      if (ck !== lastCam || sk !== lastSize) { lastCam = ck; lastSize = sk; draw = true; }
      if (L.playing && L.frames.length) {
        // the frame's start time can be before play() set playT0 at the end of a long task
        const n = L.frames.length, k = ((Math.floor((Math.max(0, now - L.playT0) * L.fps) / 1000) % n) + n) % n;
        if (k !== L.shown) { L.shown = k; showFrame(L.frames[k]); draw = true; L.statsDirty = true; }
      } else if (L.dirty) { L.dirty = false; present(); draw = true; }
      if (draw) { view.render(now / 1000); L.drawWanted = false; L.drawnN++; }
      if (L.statsDirty || now - statsAt > 500) { statsAt = now; L.statsDirty = false; renderStats(); }
      if (draw && L.drawnWait.length && (L.playing || !L.dirty)) { const w = L.drawnWait; L.drawnWait = []; for (const f of w) f(); }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (!L.error) ME.err("live: the draw loop caught: " + msg);
      L.error = { message: msg, count: (L.error ? L.error.count : 0) + 1 };
      try { renderStats(); } catch (e2) {}
    }
  }
  // keys go to live mode only (the studio's editing keys have nothing to edit here)
  function onKey(e) {
    if (e.key === "Escape" && pickEl && !pickEl.hidden) { e.preventDefault(); closePicker(); return; }
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    e.stopImmediatePropagation();
    const k = e.key, code = ME.keys.code(e), ctrl = e.ctrlKey || e.metaKey;
    const step = (d) => { if (L.frames.length) live.show((((L.shown < 0 ? 0 : L.shown) + d) % L.frames.length + L.frames.length) % L.frames.length); };
    if (ctrl && (k === "z" || k === "Z")) { e.preventDefault(); e.shiftKey ? live.redo() : live.undo(); }
    else if (ctrl && (k === "y" || k === "Y")) { e.preventDefault(); live.redo(); }
    else if (ctrl) return;
    else if (k === " ") { e.preventDefault(); if (L.playing) live.stop(); else if (L.frames.length) live.play(L.fps); }
    else if (k === "ArrowRight") step(1);
    else if (k === "ArrowLeft") step(-1);
    else if (code === "KeyF" || k === "Home") fit();
    else if (code === "Comma" || code === "KeyQ") view.cam.snap(-1);
    else if (code === "Period" || code === "KeyE") view.cam.snap(1);
  }

  SV.live = {
    boot(a) {
      app = a; view = a.view;
      const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
      document.body.classList.add("live");
      const main = document.querySelector("main");
      statsEl = Object.assign(document.createElement("div"), { id: "live-stats" });
      stripEl = Object.assign(document.createElement("div"), { id: "live-strip" });
      const help = Object.assign(document.createElement("div"), { id: "live-help" });
      const K = ME.keys.label;
      help.textContent = `drag: orbit · shift drag: pan · wheel: zoom\n${K("Comma")} ${K("Period")}: turn 90° · ${K("KeyF")}: frame the space\nspace: play / stop · ← →: frames · ctrl+Z / Y: undo / redo`;
      const bar = el("div", { id: "live-bar" },
        el("button", { type: "button", textContent: "Models", title: "the saved models (" + MODELS_DIR + ")", onclick: (e) => { e.currentTarget.blur(); togglePicker("list"); } }),
        el("button", { type: "button", textContent: "Save", title: "save the frames (or the canvas) to the models folder", onclick: (e) => { e.currentTarget.blur(); togglePicker("save"); } }));
      pickEl = el("div", { id: "live-pick", hidden: true });
      main.append(statsEl, help, stripEl, bar, pickEl);
      folder(false).catch(() => {}); // the kept folder handle, read now so a click needs no wait before asking
      // the studio's viewport input orbits, pans and zooms; nothing is selected or edited by the mouse here
      a.S.mode = "lib"; a.S.tool = "select"; a.S.lib = { name: "", label: "Voxel live", o: {}, frames: 1, fine: 1, chunk: 1 };
      view.look.ground = false;
      window.addEventListener("keydown", onKey, true);
      view.resize();
      live.open({});
      L.undo = []; L.callT = []; L.last = null;
      live.ready = true;
      requestAnimationFrame(loop);
      if (ME.qn("selftest", 0)) selftest();
    },
    state: L,
  };

  // ---------------------------------------------------------------- self-test (tools/run.ps1 -Page studio/index.html -Extra "live=1&selftest=1")
  // The fixed script's hash, written down: a change to what the calls draw or to hash() shows up here.
  const SCRIPT_HASH = "6524a17c";
  function script() {
    const H = [live.hash()], R = [];
    const step = (r) => { R.push(r); H.push(live.hash()); };
    step(live.box([2, 2, 0], [29, 29, 1], "stone"));
    step(live.sphere([16, 16, 9.5], 6.5, "moss"));
    step(live.line([3, 3, 2], [28, 20, 14], "maple"));
    step(live.line([28, 3, 2], [4, 27, 12], "liveRust", 1.5));
    step(live.set(16, 16, 20, "liveRust"));
    step(live.clear(16, 16, 15));
    step(live.fill("stone", [0, 0, 28], [5, 5, 31]));
    step(live.flood(0, 0, 31, "maple"));
    step(live.fill(null, [20, 20, 0], [31, 31, 1]));
    step(live.patch({ o: [10, 24, 3], n: [3, 2, 1], mats: ["moss", "liveRust"], rle: [1, 2, 0, 1, 2, 2, 255, 1] }));
    return { H, R };
  }
  // a game page (?game=): every model the game's files define is voxelised by live.model through the game's
  // palette, with no material missing; a model that needs options and draws nothing with {} is only listed
  async function selftestGame() {
    const R = { ok: true, game: live.game, checks: {}, empty: [], big: [], errors: ME.errors };
    const check = (name, cond, info) => { R.checks[name] = cond ? (info ?? true) : { fail: info ?? false }; if (!cond) R.ok = false; };
    try {
      const keys = ((window.SVK || []).find(([label]) => label === "Game models") || [null, []])[1], bad = {}, t0 = performance.now();
      let drawn = 0;
      for (const n of keys) {
        try { const r = live.model(n, {}, { vs: 24, open: true }); drawn++; if (r.missing.length || r.clipped) bad[n] = { missing: r.missing, clipped: r.clipped }; }
        catch (e) { if (/draws no voxels/.test(e.message)) R.empty.push(n); else if (/^model: open gives/.test(e.message)) R.big.push(n); else bad[n] = e.message; }
      }
      check("game_models", keys.length > 0 && drawn > 0, { models: keys.length, drawn, ms: Math.round(performance.now() - t0) });
      check("game_models_clean", !Object.keys(bad).length, bad);
      check("game_palette", !!app.st.ramps && app.pal.names.length > 1, { ramps: Object.keys(app.st.ramps).length });
    } catch (e) { R.ok = false; R.error = e.stack || e.message; }
    R.ok = R.ok && ME.errors.length === 0;
    document.getElementById("result").textContent = JSON.stringify(R, null, 1);
    document.title = "SELFTEST DONE";
  }
  async function selftest() {
    if (live.game) return selftestGame();
    const R = { ok: true, checks: {}, targets: {}, errors: ME.errors };
    const check = (name, cond, info) => { R.checks[name] = cond ? (info ?? true) : { fail: info ?? false }; if (!cond) R.ok = false; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const frameNow = () => new Promise((r) => requestAnimationFrame(() => r()));
    try {
      // 1. the fixed script of every shape call on a 32^3 space at grid 32
      live.open({ dims: [32, 32, 32], grid: 32, name: "t_live" });
      live.material("liveRust", "#b4532a");
      const { H, R: res } = script(), last = H[H.length - 1], depth = L.undo.length;
      check("script_hash", last === SCRIPT_HASH, { hash: last, calls: res.map((r) => r.changed) });
      check("script_changes", res.every((r) => r.changed > 0), res.map((r) => r.changed));
      check("bad_input_names_argument", ["set:x", "sphere:r", "box:m", "patch:layer.n"].every((t) => {
        const [fn, arg] = t.split(":");
        try { ({ set: () => live.set(1.5, 0, 0, "stone"), sphere: () => live.sphere([1, 1, 1], -1, "stone"), box: () => live.box([0, 0, 0], [1, 1, 1], "no_such_mat"), patch: () => live.patch({ o: [0, 0, 0], n: [0, 1, 1], mats: [], rle: [] }) })[fn](); return false; }
        catch (e) { return e.message.startsWith(fn + ": " + arg); }
      }));
      check("hash_unchanged_by_errors", live.hash() === last);
      // 2. read / patch round trips, rle and b64, whole space and a box
      const rle = live.read(), rb64 = live.read(null, null, "b64"), part = live.read([4, 4, 0], [20, 20, 12]);
      live.fill(null);
      const emptyHash = live.hash();
      live.patch(rle); const h1 = live.hash();
      live.fill(null); live.patch(rb64); const h2 = live.hash();
      live.fill("moss", [4, 4, 0], [20, 20, 12]); live.patch(part); const h3 = live.hash();
      check("read_patch_rle", h1 === last, h1);
      check("read_patch_b64", h2 === last, h2);
      check("read_patch_box", h3 === last, h3);
      check("empty_differs", emptyHash !== last);
      check("patch_zero_leaves", (() => { live.patch({ o: [0, 0, 5], n: [2, 1, 1], mats: ["moss"], rle: [0, 1, 1, 1] }); const ok = live.get(0, 0, 5) === null && live.get(1, 0, 5) === "moss"; live.undo(); return ok && live.hash() === last; })());
      // 3. undo back to each earlier hash, redo forward again (the read/patch calls above first)
      while (L.undo.length > depth) live.undo();
      check("undo_read_patch_calls", live.hash() === last && depth === H.length - 1, { depth });
      L.redo.length = 0;
      const back = [], fwd = [];
      for (let k = H.length - 2; k >= 0; k--) { live.undo(); back.push(live.hash() === H[k]); }
      for (let k = 1; k < H.length; k++) { live.redo(); fwd.push(live.hash() === H[k]); }
      check("undo_each_step", back.every(Boolean), back);
      check("redo_each_step", fwd.every(Boolean), fwd);
      live.begin("pair"); live.set(0, 31, 31, "moss"); live.set(1, 31, 31, "moss"); live.end();
      const grouped = live.hash();
      live.undo(); const ungrouped = live.hash() === last; live.redo();
      check("begin_end_one_step", ungrouped && live.hash() === grouped);
      // 4. clipping: cells outside the space are counted, never written
      live.open({ dims: [32, 32, 32], grid: 32 });
      const c1 = live.box([-2, -2, -2], [1, 1, 1], "stone"), c2 = live.set(40, 0, 0, "stone"), c3 = live.sphere([31, 31, 31], 2, "moss");
      const c4 = live.patch({ o: [30, 0, 30], n: [4, 4, 4], mats: ["maple"], rle: [1, 64] }), c5 = live.line([-5, 16, 16], [5, 16, 16], "maple"), c6 = live.flood(-1, 0, 0, "moss");
      const s4 = live.stats().solid;
      check("clip_box", c1.changed === 8 && c1.clipped === 56, c1);
      check("clip_set", c2.changed === 0 && c2.clipped === 1 && live.get(40, 0, 0) === null, c2);
      check("clip_sphere", c3.changed > 0 && c3.clipped > c3.changed, c3);
      check("clip_patch", c4.changed === 16 && c4.clipped === 48, c4);
      check("clip_line", c5.changed === 6 && c5.clipped === 5, c5);
      check("clip_flood", c6.changed === 0 && c6.clipped === 1, c6);
      check("clip_counts", s4 === c1.changed + c3.changed + c4.changed + c5.changed, { solid: s4 });
      // fractional line ends: the DDA rounds the points along the exact segment (one cell per x step, from
      // the cell nearest a to the cell nearest b); the capsule measures to the exact segment
      live.open({ dims: [32, 32, 32], grid: 32 });
      const fl1 = live.line([0.4, 0.6, 2.2], [9.6, 0.4, 2.4], "stone"), ys = [];
      for (let x = 0; x <= 10; x++) ys.push([0, 1].find((y) => live.get(x, y, 2)) ?? -1);
      check("line_fractional", fl1.changed === 11 && live.get(0, 1, 2) === "stone" && live.get(10, 0, 2) === "stone" && ys.every((y) => y >= 0), { r: fl1, ys });
      const fl2 = live.line([20.5, 20.5, 4.5], [20.5, 20.5, 10.5], "moss", 1); // x, y in 20..21, z in 4..11
      check("capsule_fractional", fl2.changed === 32 && fl2.clipped === 0, fl2);
      check("line_bad_end", (() => { try { live.line([0, 0, "x"], [1, 1, 1], "stone"); return false; } catch (e) { return e.message.startsWith("line: a"); } })());
      // 5. three commits, save, open, load: the same three frame hashes
      live.open({ dims: [32, 32, 32], grid: 32, name: "t_live" });
      const fh = [];
      for (let f = 0; f < 3; f++) {
        live.fill(null);
        live.box([8, 8, 0], [23, 23, 1], "stone");
        live.sphere([16, 16, 8 + 2 * f], 4 + f, f === 1 ? "liveRust" : "moss");
        fh.push(live.commit().hash);
      }
      const doc = live.save({ name: "t_live", label: "live self-test" });
      check("save_doc", doc.frames === 3 && doc.vox.length === 3 && doc.fps === 12 && !!doc.mats.liveRust && !!SV.store.all().t_live, { frames: doc.frames, mats: Object.keys(doc.mats) });
      live.open({ dims: [16, 16, 16], grid: 32 });
      const ld = live.load(JSON.parse(JSON.stringify(doc))), lh = live.frames().map((f) => f.hash);
      check("load_frame_hashes", JSON.stringify(lh) === JSON.stringify(fh), { saved: fh, loaded: lh, dims: ld.dims });
      check("load_shows_frame0", live.hash() === fh[0]);
      // 6. the format round trip: each saved frame through AF.build and ME.voxelizeModel(vs = grid)
      const exact = doc.vox.map((layer, f) => {
        const want = AF.layerCells(layer), vx = ME.voxelizeModel(AF.build(doc, { t: f / 3 }), doc.grid, app.pal), [nx, ny, nz] = vx.dims;
        let bad = 0;
        for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) if (vx.rgba[i * 4 + 3] && app.pal.names[vx.rgba[i * 4 + 3]] !== want.get(AF.key(vx.box[0] + x, vx.box[1] + y, vx.box[2] + z))) bad++;
        return { solid: vx.solid, cells: want.size, bad };
      });
      check("format_roundtrip_exact", exact.every((e) => e.solid === e.cells && !e.bad), exact);
      AF.register(JSON.parse(JSON.stringify(doc)));
      check("register_flipbook", !!window.MODELS.t_live && ME.FRAMES.t_live === 3, ME.FRAMES.t_live);
      // 7. the page draws: lines, volumes, no GL error
      await frameNow(); await frameNow();
      view.render(1);
      check("webgl", view.gl.getError() === 0 && view.lines.count > 0 && view.count > 0, { lines: view.lines.count / 2, instances: view.count });
      // 8. a 64^3 space: a full replace, a single set and the exact bake, timed (section 1's targets)
      live.open({ dims: [64, 64, 64], grid: 64 });
      const N = 64 * 64 * 64, full = new Uint8Array(N);
      for (let z = 0, i = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++, i++) { const d = Math.hypot(x - 31.5, y - 31.5, z - 26); full[i] = d < 24 ? (z > 30 ? 1 : 2) : z < 2 ? 3 : 255; }
      const fl = { o: [0, 0, 0], n: [64, 64, 64], mats: ["moss", "stone", "maple"], b64: b64(full) };
      const rep = live.patch(fl); upload(L.vol); const repUp = L.uploadMs;
      const one = live.set(10, 10, 50, "liveRust"); upload(L.vol); const oneUp = L.uploadMs;
      const t0 = performance.now(), ex = bakeExact(layerOf(L.canvas, L.dims, L.org)), exMs = performance.now() - t0;
      R.targets = { replace64_ms: rep.ms, replace64_upload_ms: r3(repUp), set_ms: one.ms, set_upload_ms: r3(oneUp), exact64_ms: r3(exMs), solid: L.solid, surface: L.surf, bricks: L.bricks };
      check("perf_case", rep.changed > 0 && one.changed === 1 && ex.solid === L.solid, { exactSolid: ex.solid, liveSolid: L.solid });
      // 9. the demo (studio/live-demo.js, as the bridge runs it) and playback of its frames
      const code = await fetch("live-demo.js").then((r) => r.text()).catch(() => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", "live-demo.js"); x.onload = () => res(x.responseText); x.onerror = rej; x.send(); }));
      const out = await live.run(code);
      check("demo_runs", out.startsWith("ok "), out.slice(0, 200));
      R.demo = { hash: out.startsWith("ok ") ? JSON.parse(out.slice(3)) : null, frames: live.frames().map((f) => f.hash) };
      while (L.bakeQ.length || L.bakeT) await wait(50);
      live.play(30);
      let shown = 0, prev = -1;
      const p0 = performance.now();
      while (performance.now() - p0 < 1000) { await frameNow(); if (L.shown !== prev) { shown++; prev = L.shown; } }
      live.stop();
      R.targets.playback_fps = shown;
      // 10. play() whose start is after the next frame's time (as at the end of a long task) still plays,
      // an error in the loop's body doesn't stop it, and drawn() resolves once an edit is on screen
      live.play(30); L.playT0 = performance.now() + 200;
      const seen = new Set(), d0 = L.drawnN, p1 = performance.now();
      while (performance.now() - p1 < 600) { await frameNow(); if (L.shown >= 0) seen.add(L.shown); }
      check("play_early_start", seen.size > 1 && [...seen].every((k) => k < L.frames.length) && L.drawnN > d0 && !L.error, { shown: [...seen], drawn: L.drawnN - d0, error: L.error });
      const render = view.render, errs = ME.errors.length;
      let thrown = 0;
      view.render = function (t) { if (!thrown++) throw new Error("selftest: one render throws"); return render.call(this, t); };
      L.drawWanted = true;
      for (let i = 0; i < 6; i++) await frameNow();
      view.render = render;
      const st = live.stats(), d1 = L.drawnN;
      L.drawWanted = true;
      await frameNow(); await frameNow();
      check("loop_survives_error", thrown > 1 && st.error && st.error.message === "selftest: one render throws" && L.drawnN > d1 && ME.errors.length === errs + 1, { thrown, error: st.error, logged: ME.errors.length - errs });
      ME.errors.splice(errs, 1); L.error = null;
      live.stop();
      live.set(0, 0, 0, "moss");
      const dr1 = await live.drawn(), dirty1 = L.dirty, dr2 = await live.drawn();
      check("drawn_after_edit", !dirty1 && dr1.frame > 0 && dr2.frame > dr1.frame, { dr1, dr2 });
      // 11. view() frames the solid box at fill and reads back what it set; shot() draws the latest edit at
      // its own size and puts the canvas back
      live.open({ dims: [32, 32, 32], grid: 32 });
      const bx = [12, 12, 0, 19, 19, 15];
      live.box(bx.slice(0, 3), bx.slice(3), "stone");
      const v1 = live.view({ fit: "solid", yaw: 90, engine: true }), v2 = live.view();
      check("view_reads_back", v2.yaw === 90 && v2.engine === true && JSON.stringify(v1) === JSON.stringify(v2), { v1, v2 });
      check("view_fit_target", Math.abs(v1.target[0] - 15.5) < 1e-3 && Math.abs(v1.target[1] - 15.5) < 1e-3 && Math.abs(v1.target[2] - 7.5) < 1e-3, v1);
      const pj = [];
      for (let i = 0; i < 8; i++) pj.push(view.project([0, 1, 2].map((k) => (L.org[k] + ((i >> k) & 1 ? bx[k + 3] + 1 : bx[k])) / L.grid)));
      const ext = (a) => Math.max(...pj.map((p) => p[a])) - Math.min(...pj.map((p) => p[a]));
      const sx = ext(0) / view.cv.clientWidth, sy = ext(1) / view.cv.clientHeight;
      check("view_fill", Math.abs(Math.max(sx, sy) - 0.85) < 0.01, { sx: r3(sx), sy: r3(sy) });
      const v3 = live.view({ pitch: 60, zoom: 8, target: [16, 16, 4] });
      check("view_free", v3.engine === false && v3.pitch === 60 && v3.zoom === 8 && v3.target.join() === "16,16,4", v3);
      check("view_bad_fit", (() => { try { live.view({ fit: "box" }); return false; } catch (e) { return e.message.startsWith("view: fit"); } })());
      live.view({ fit: "solid", engine: true });
      const W0 = view.cv.width, H0 = view.cv.height, s1 = live.shot({ w: 64, h: 48, alpha: true });
      live.set(16, 16, 16, "moss");
      const s2 = live.shot({ w: 64, h: 48, alpha: true }), dirtyAfter = L.dirty;
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("shot: not a PNG")); im.src = s2; });
      const cv2 = Object.assign(document.createElement("canvas"), { width: 64, height: 48 }), g2 = cv2.getContext("2d");
      g2.drawImage(img, 0, 0);
      const px = g2.getImageData(0, 0, 64, 48).data;
      check("shot_size_alpha", img.width === 64 && img.height === 48 && px[3] === 0 && px[(24 * 64 + 32) * 4 + 3] === 255 && view.cv.width === W0 && view.cv.height === H0, { w: img.width, h: img.height, corner: px[3], centre: px[(24 * 64 + 32) * 4 + 3] });
      check("shot_fresh", s1 !== s2 && !dirtyAfter);
      check("shot_bad_size", (() => { try { live.shot({ w: 4096 }); return false; } catch (e) { return e.message.startsWith("shot: w"); } })());
      // 12. patch reports unused materials and warns on the 0-based pattern; materials() installs many
      live.open({ dims: [8, 8, 8], grid: 32 });
      const pw = live.patch({ o: [0, 0, 0], n: [4, 1, 1], mats: ["moss", "stone", "maple"], rle: [0, 1, 1, 1, 2, 1, 255, 1] });
      check("patch_warns_0_based", !!pw.warn && JSON.stringify(pw.unused) === "[\"maple\"]", pw);
      const pr = live.patch(live.read());
      check("patch_read_quiet", !pr.warn && pr.unused.length === 0, pr);
      const mm = live.materials({ liveA: "#336699", liveB: { ramp: ["#101418", "#506070", "#a0c0e0", "#e0f0ff"], em: 1, wrap: 0.3 } });
      check("materials_many", mm.names.join() === "liveA,liveB" && live.mats().includes("liveB") && L.own.liveB.wrap === 0.3 && live.box([0, 0, 2], [1, 1, 3], "liveB").changed === 8, mm);
      check("materials_bad_name", (() => { try { live.materials({ "bad name": "#000000" }); return false; } catch (e) { return e.message.startsWith("materials: name \"bad name\""); } })());
      // em is a gain: the material table carries it to the shaders (m0.w), and a bad one is refused
      live.material("liveNeon", { ramp: ["#ffd0e6", 6, 0.4, 0.95, 0.1, 1], em: 0.45 });
      live.box([0, 0, 4], [0, 0, 4], "liveNeon");
      const gid = app.pal.ids.liveNeon, bid = app.pal.ids.liveB, gm = gid === undefined || bid === undefined ? null : app.pal.build().mats;
      const badEm = (() => { try { live.material("liveBad", { ramp: ["#ffffff", 6, 0.2, 0.9, 0.1, 1], em: -1 }); return false; } catch (e) { return e.message.startsWith("material: spec.em"); } })();
      check("material_em_gain", gm !== null && Math.abs(gm[gid * 8 + 3] - 0.45) < 1e-6 && gm[bid * 8 + 3] === 1 && badEm, { gid, bid, gain: gm ? gm[gid * 8 + 3] : null, badEm });
      // 13. model() voxelises a library model into the space (tall, open, clip), as one undo step; put()
      // of the same voxeliser output gives the same cells
      const brief = (r) => ({ changed: r.changed, clipped: r.clipped, solid: r.solid, dims: r.dims, vs: r.vs, mats: r.mats, missing: r.missing });
      live.open({ dims: [48, 48, 48], grid: 32 });
      // stood 8 cells up: a model stands on its origin, as the engine places it, and the mushroom reaches below it
      const up = anchorCell().map((v, k) => (k === 2 ? 8 : v)), m1 = live.model("mushroom", {}, { tall: 30, at: up }), tb1 = tight(L.canvas, L.dims);
      check("model_tall", Math.abs(m1.dims[2] - 30) <= 1 && m1.changed === m1.solid && m1.solid > 0 && !m1.clipped && !m1.missing.length && live.hash() === m1.hash && tb1[5] - tb1[2] + 1 === m1.dims[2] && tb1[2] <= 8 && tb1[5] > 8, brief(m1));
      live.undo();
      check("model_one_undo", live.stats().solid === 0);
      const m2 = live.model("mushroom", {}, { tall: 30, open: true });
      check("model_open", !m2.clipped && L.grid === m2.vs && L.dims[2] === m2.dims[2] + 2 && L.undo.length === 1, { r: brief(m2), dims: L.dims, grid: L.grid });
      const m3 = live.model("mushroom", {}, { tall: 30, open: true, clip: [10, 19] }), tb3 = tight(L.canvas, L.dims);
      check("model_clip", m3.dims[2] === 10 && tb3[2] === 0 && tb3[5] === 9, { r: brief(m3), tight: tb3 });
      live.open({ dims: [48, 48, 48], grid: 32 });
      const vx = ME.voxelizeModel(ME.modelOf("mushroom", {}), 32, app.pal), pu = live.put({ dims: vx.dims, rgba: vx.rgba, box: vx.box, names: app.pal.names }), hp = live.hash();
      live.fill(null);
      const m4 = live.model("mushroom", {}, { vs: 32 });
      check("put_matches_model", hp === m4.hash && pu.changed === m4.changed && pu.changed > 0, { put: pu.changed, model: m4.changed });
      check("model_bad_name", (() => { try { live.model("no_such_model"); return false; } catch (e) { return e.message.startsWith("model: name"); } })());
      // 14. animate() commits a frame per pose through model()'s path, over the canvas as it was, one undo
      // step; tween() lerps a pose's numbers. The mushroom moves with t, so its four looping frames all differ
      const an = live.animate({ frames: 4, fps: 8, tall: 30, open: true }, (t) => ["mushroom", { t }]), fh4 = live.frames().map((f) => f.hash);
      check("animate_frames", an.frames === 4 && an.hashes.join() === fh4.join() && new Set(an.hashes).size === 4 && !an.clipped && !an.missing.length && L.grid === an.vs && L.fps === 8 && L.undo.length === 1, Object.assign({}, an, { hashes: undefined, fh4 }));
      live.undo();
      check("animate_one_undo", live.stats().solid === 0 && live.frames().length === 4);
      const ma = live.model("mushroom", { t: 0.25 }, { vs: an.vs, at: an.at });
      check("animate_matches_model", ma.hash === an.hashes[1], { model: ma.hash, frame1: an.hashes[1] });
      const keep = (() => { try { live.animate({ frames: 2, vs: an.vs }, (t) => ["mushroom", { t }]); return false; } catch (e) { return e.message.startsWith("animate: opts would replace the 4 committed frames"); } })();
      const an3 = live.animate({ frames: 2, vs: an.vs, replace: true }, (t) => ["mushroom", { t }]);
      check("animate_replace", keep && an3.frames === 2 && live.frames().length === 2);
      live.open({ dims: [48, 48, 48], grid: 32 });
      live.box([0, 0, 0], [3, 3, 0], "stone");
      const hb = live.hash(), an2 = live.animate({ frames: 2, vs: 32, loop: false }, (t) => ({ name: "mushroom", o: { t: t / 4 } })), tb4 = tight(L.canvas, L.dims);
      live.undo();
      check("animate_over_canvas", tb4[0] === 0 && an2.hashes[0] !== an2.hashes[1] && an2.hashes.every((h) => h !== hb) && live.hash() === hb, { tight: tb4 });
      check("animate_bad_fn", (() => { try { live.animate({ frames: 2, replace: true }, () => 3); return false; } catch (e) { return e.message.startsWith("animate: fn(0, 0) must return"); } })());
      const K = [{ t: 0, pose: { a: 0, arm: [0, 10], tag: "x", sub: { b: 2 } } }, { t: 1, pose: { a: 10, arm: [10, 30], tag: "y", sub: { b: 4 } } }];
      const w1 = live.tween(K, 0.5, "linear"), w2 = live.tween(K, 0.25), w3 = live.tween(K, -1), w4 = live.tween(K, 2);
      check("tween", w1.a === 5 && w1.arm[1] === 20 && w1.tag === "x" && w1.sub.b === 3 && Math.abs(w2.a - 1.5625) < 1e-9 && w3.a === 0 && w3 !== K[0].pose && w4.a === 10 && w4.tag === "y", { w1, w2: w2.a });
      // 15. the cell budget (256 per axis, 2^23 cells, grid at most 128); an edit re-sends only the bricks it
      // reshaded, and draws what a full upload draws; frames counted in bytes; the brick pool's ceiling
      const tooBig = (o, arg) => { try { live.open(o); return false; } catch (e) { return e.message.startsWith("open: " + arg); } };
      live.open({ dims: [256, 256, 128], grid: 64 });
      const sb = live.stats();
      check("cell_budget", sb.cells === 1 << 23 && sb.cellsMax === 1 << 23 && tooBig({ dims: [256, 256, 129] }, "dims gives") && tooBig({ dims: [257, 8, 8] }, "dims gives") && tooBig({ dims: [64, 64, 64], grid: 129 }, "grid must"), { cells: sb.cells });
      live.open({ dims: [96, 96, 96], grid: 32 });
      live.sphere([48, 48, 40], 30, "stone");
      upload(L.vol);
      const full0 = view.count;
      live.set(48, 48, 71, "liveRust");
      upload(L.vol);
      const upPart = view.uploaded, partSurf = view.surface;
      view.setVolume(L.vol, null);
      check("upload_incremental", upPart > 0 && upPart < full0 / 4 && partSurf === view.surface, { part: upPart, full: full0, partSurf, fullSurf: view.surface, ms: r3(L.uploadMs) });
      L.dirtyBoxes = [];
      const fb0 = live.stats().frameMB;
      live.commit();
      const fbOne = L.frames[0].bytes, fb1 = live.stats().frameMB;
      L.frames.push({ b: null, data: new Uint8Array(0), solid: 0, hash: "x", layer: null, set: null, exact: true, bytes: MAX_FRAME_BYTES, bricks: 0 });
      const overBudget = (() => { try { live.commit(); return false; } catch (e) { return e.message.startsWith("commit: i would bring the stored frames to"); } })();
      L.frames.pop();
      check("frame_bytes", fb0 === 0 && fbOne === L.frames[0].data.length * 2 + L.frames[0].set.B.inst.byteLength + L.frames[0].set.B.nao.byteLength && fb1 === Math.round((fbOne / 1048576) * 10) / 10 && overBudget && L.frames.length === 1, { fbOne, fb1, overBudget });
      const sp = live.stats().pool;
      check("pool_ceiling", sp.max === ME.poolMaxBricks() && sp.bricks === L.frames[0].bricks && sp.bricks > 0 && sp.warn === false, sp);
      // 16. a frame keeps its slots and the view's set of its surface, not its colours; the live space's runs
      // stay in the view while a frame or an exact bake shows, so the next edit rescans only its bricks
      const fr = L.frames[0];
      check("frame_set", !!fr.set && fr.vol === undefined && fr.set.B.used > 0 && fr.bytes < fr.data.length * 3, { bytes: fr.bytes, cells: fr.data.length, surface: fr.set.B.used });
      upload(L.vol);
      const nb = L.bdims[0] * L.bdims[1] * L.bdims[2];
      showFrame(fr);
      const onFrame = view.vol === fr.set.vol && view.count === fr.set.B.used;
      live.set(48, 48, 72, "liveRust");
      upload(L.vol);
      const backScan = view.scanned, backSurf = view.surface;
      view.setVolume(L.vol, null);
      check("live_set_kept", onFrame && backScan > 0 && backScan < nb / 4 && backSurf === view.surface, { onFrame, scanned: backScan, bricks: nb, surf: backSurf, full: view.surface });
      L.dirtyBoxes = [];
      const exNow = live.exact();
      upload(L.exact);
      const onExact = view.vol === L.exact;
      live.set(48, 48, 73, "liveRust");
      upload(L.vol);
      check("exact_now", exNow.ms > 0 && exNow.solid === L.solid - 1 && onExact && view.scanned < nb / 4 && live.stats().exactSkipped === false, { exNow, scanned: view.scanned });
      check("put_bad_rgba", (() => { try { live.put({ dims: [2, 2, 2], rgba: new Uint8Array(8), names: [] }); return false; } catch (e) { return e.message.startsWith("put: vol.rgba"); } })());
      // 17. saved models on disk: saveModel, models(), loadSaved and deleteModel through a folder handle (a temp
      // folder in the origin's private file system, else in memory), the frame hashes kept; the picker lists
      // them, and Escape closes it
      MS.test = await testFolder();
      try {
        live.open({ dims: [24, 24, 24], grid: 32 });
        live.sphere([12, 12, 8], 6, "moss"); live.commit();
        live.box([4, 4, 0], [19, 19, 1], "stone"); live.commit();
        const mdHash = L.frames.map((f) => f.hash);
        const mdSave = await live.saveModel({ name: "t_disk", label: "disk test" }), mdFile = L.saved.file;
        const mdList = await live.models(), mdOne = mdList.find((m) => m.name === "t_disk");
        live.open({});
        const mdLoad = await live.loadSaved("t_disk"), mdHash2 = L.frames.map((f) => f.hash);
        togglePicker("list"); await renderPicker();
        const mdRows = [...pickEl.querySelectorAll(".row b")].map((b) => b.textContent);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const mdClosed = pickEl.hidden;
        await live.deleteModel("t_disk");
        const mdGone = !(await live.models()).some((m) => m.name === "t_disk");
        const mdMissing = await live.loadSaved("no_such_model").then(() => false, (e) => /no model no_such_model/.test(e.message));
        const mdBadName = await live.saveModel({ name: "bad name" }).then(() => false, (e) => e.message.startsWith("save: name"));
        check("models_disk", mdSave.kb > 0 && mdSave.frames === 2 && mdFile === "t_disk.json" && !!mdOne && mdOne.frames === 2 && mdOne.label === "disk test" && mdOne.dims.join() === mdLoad.dims.join() &&
          mdLoad.frames === 2 && mdHash2.join() === mdHash.join() && mdGone && mdMissing && mdBadName, { via: MS.test.via, mdSave, mdOne, mdHash, mdHash2, mdGone, mdMissing, mdBadName });
        check("models_picker", mdRows.includes("t_disk") && mdClosed, { rows: mdRows, closed: mdClosed });
      } finally { MS.test = null; closePicker(); }
    } catch (e) { R.ok = false; R.error = e.stack || e.message; }
    R.ok = R.ok && ME.errors.length === 0;
    document.getElementById("result").textContent = JSON.stringify(R, null, 1);
    document.title = "SELFTEST DONE";
  }
})();
