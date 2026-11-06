/* Mossheart Voxel Studio: view any engine asset (generator models, critters, the asset-set mockups,
   studio assets) exactly as the engine voxelises it, and edit studio assets (src/asset-format.js):
   SDF shapes with handles, voxel add / erase / paint / fill, materials, detail rules, motion.
   The bake is the engine's own (ME.voxelizeModel through ME.Palette), so the preview matches the game.
   ?selftest=1 writes a JSON report into #result; ?shots=a,b renders named library models to PNG lines. */
(function () {
  const ME = window.ME, P = window.PX, AF = window.MossAsset, SV = window.SV, VS = ME.VS, TAU = Math.PI * 2;
  const $ = (s) => document.querySelector(s);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  // DOM helper: h("div.cls", { on: {click}, ...attrs }, ...children)
  function h(sel, attrs, ...kids) {
    const [tag, ...cls] = sel.split(".");
    const el = document.createElement(tag || "div");
    if (cls.length) el.className = cls.join(" ");
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === "on") for (const e in v) el.addEventListener(e, v[e]);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k in el && typeof v !== "string") el[k] = v;
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(3)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  // the content pack, the engine's flipbook frames as src/bake-models.js merges them, and look presets (src/passes.js)
  const CT = ME.content || {}, FRAMES = Object.assign({}, ME.FRAMES, CT.flipbookFrames);
  const PRESETS = {
    engine: {}, cosy: { shade: 0.47, pool: 0.6, amb: 0.21, sunAz: 10 }, morning: { shade: 0.46, amb: 0.22, sunEl: 8, sunAz: -20 }, clear: { shade: 0.4, pool: 0.55, amb: 0.2 },
  };
  const PRIM_TYPES = { S: "Sphere", E: "Ellipsoid", C: "Capsule", B: "Box", Y: "Cylinder" };
  const CLASSES = ["default", "moss", "foliage", "emissive", "water", "rock", "bark", "skin"];

  // ---------------------------------------------------------------- state
  const S = (SV.state = {
    mode: "lib", lib: null, doc: null, sel: -1, tool: "select", tab: "shape", mat: "moss", brush: 0, brushShape: "sphere",
    frame: 0, playing: false, styleId: "mf-valley", preset: "cosy", sunAz: 0, sunEl: 0, snap: true, version: 0,
    undo: [], redo: [], pending: false, vols: new Map(), bakeMs: 0, search: "", warn: "",
  });
  let view, overlay, octx, st, pal, palCount = 0, LIB = [];

  // ---------------------------------------------------------------- style and palette
  // The studio style: every loaded style's ramps (so any library model resolves), the asset-set mockup
  // ramps, critter materials and studio materials, with the chosen style's own ramps and light on top.
  function buildStyle() {
    // a game page (?game=, index.html): that game's own style, as its renderer builds it
    if (window.STUDIO_LOAD && STUDIO_LOAD.game) {
      const g = window.STUDIO_GAME.style(Object.fromEntries(new URLSearchParams(location.search)));
      st = Object.assign({}, g, { ramps: Object.assign({}, g.ramps), mats: Object.assign({}, g.mats) });
      Object.assign(st.ramps, AF.ramps); Object.assign(st.mats, AF.mats);
      if (S.doc) installDocMats(S.doc);
      return newPalette();
    }
    const base = window.STYLES.find((s) => s.id === S.styleId) || window.STYLES.find((s) => s.id === "mf-valley");
    const ramps = {}, mats = {};
    for (const s of window.STYLES) { Object.assign(ramps, s.ramps || {}); Object.assign(mats, s.mats || {}); }
    if (ME.assetKit) { Object.assign(ramps, ME.assetKit.RAMPS); Object.assign(mats, ME.assetKit.MATS); }
    Object.assign(ramps, base.ramps || {}); Object.assign(mats, base.mats || {});
    st = Object.assign({}, base, { ramps, mats });
    if (CT.addMaterials) CT.addMaterials(st);
    Object.assign(st.ramps, AF.ramps); Object.assign(st.mats, AF.mats);
    if (S.doc) installDocMats(S.doc);
    newPalette();
  }
  function installDocMats(doc) {
    AF.installMaterials(doc);
    for (const n in doc.mats || {}) { st.ramps[n] = AF.ramps[n]; st.mats[n] = AF.mats[n]; }
  }
  function newPalette() { pal = new ME.Palette(st); palCount = 0; S.vols.clear(); }
  function syncTables() {
    if (pal.names.length === palCount) return;
    palCount = pal.names.length;
    view.setTables(pal.build());
  }
  function applyLook() {
    const pr = PRESETS[S.preset] || {}, lt = st.light || {}, L = view.look;
    L.shade = pr.shade ?? lt.shade ?? 0.44; L.pool = pr.pool ?? lt.pool ?? 0.5; L.amb = pr.amb ?? st.amb ?? 0.22; L.aoK = st.aoK ?? 0.36; L.spriteK = lt.spriteK ?? 1;
    // the engine's Renderer.sunDir(): style sun plus azimuth / elevation offsets
    const [x, y, z] = st.L || [-0.45, 0.36, 0.82], az = (((pr.sunAz || 0) + S.sunAz) * Math.PI) / 180, el = Math.max(0.2, Math.min(1.45, Math.asin(z) + (((pr.sunEl || 0) + S.sunEl) * Math.PI) / 180)), a0 = Math.atan2(y, x) + az;
    view.L = [Math.cos(el) * Math.cos(a0), Math.cos(el) * Math.sin(a0), Math.sin(el)];
  }
  const ramp = (name) => { try { return P.makeRamp(st.ramps[name] || st.ramps.stone); } catch (e) { return [[128, 128, 128]]; } };
  const swatch = (name, n = 6) => {
    const r = ramp(name), el = h("span.sw");
    for (let i = 0; i < n; i++) { const c = r[Math.round((i / (n - 1)) * (r.length - 1))]; el.append(h("i", { style: { background: `rgb(${c})` } })); }
    return el;
  };
  const baseColor = (name) => { const r = ramp(name), M = (st.mats && st.mats[name]) || {}; return r[Math.round(Math.min(1, Math.max(0, 0.6 + (M.bias || 0))) * (r.length - 1))]; };

  // ---------------------------------------------------------------- library
  // groups recorded by index.html while the scripts load (SVK marks), plus studio assets
  function buildLibrary() {
    const ok = (n) => { try { const md = window.MODELS[n]({}); return md && Array.isArray(md.prims) && md.prims.length > 0; } catch (e) { return false; } };
    const marks = window.SVK || [], seen = new Set(), groups = [];
    const studio = Object.assign({}, AF.docs, SV.store.all());
    groups.push({ id: "studio", label: "Studio assets", items: Object.keys(studio).sort().map((n) => ({ kind: "doc", name: n, label: studio[n].label || n, doc: studio[n], saved: !!SV.store.all()[n] })) });
    for (const [label, keys] of marks) {
      if (label === "Asset models") {
        // the showrooms (assets/asset-kit.js ASSET_THEMES) list every variant the asset sets define: [id, o, cam]
        const covered = new Set();
        for (const id of Object.keys(ME.ASSET_THEMES || {}).filter((t) => t !== "studio")) {
          const th = ME.ASSET_THEMES[id], items = [], dup = new Set();
          for (const [row] of th.rows || []) for (const [m, o, cam] of row) {
            const key = m + JSON.stringify(o || {});
            if (dup.has(key) || !window.MODELS[m]) continue;
            dup.add(key); covered.add(m);
            items.push({ kind: "model", name: m, label: cam || m + (o && Object.keys(o).length ? " " + JSON.stringify(o) : ""), o: clone(o || {}), frames: FRAMES[m] || 1 });
          }
          if (items.length) groups.push({ id: "th-" + id, label: (/^set-/.test(id) ? "Asset set · " : "Mockups · ") + (th.label || id).replace(/^[A-E] · /, ""), items });
        }
        const rest = keys.filter((k) => !covered.has(k) && ok(k));
        if (rest.length) groups.push({ id: "assets-other", label: "Other asset models", items: rest.sort().map((k) => ({ kind: "model", name: k, label: k, o: {}, frames: FRAMES[k] || 1 })) });
      } else groups.push({ id: label, label, items: keys.filter((k) => !AF.docs[k] && ok(k)).sort().map((k) => ({ kind: "model", name: k, label: k, o: {}, frames: FRAMES[k] || 1 })) });
      keys.forEach((k) => seen.add(k));
    }
    // critter flipbooks as the engine bakes them (ME.content.critters: key -> [model, options, frames, fine])
    if (CT.critters) groups.splice(1, 0, { id: "critters", label: "Critter flipbooks", items: Object.keys(CT.critters).map((k) => { const [name, o, n, fine] = CT.critters[k]; return { kind: "model", name, label: k, o: clone(o || {}), frames: n, fine }; }) });
    // the Momiji Valley scene's own placements (deco options as the terrain bake uses them)
    const mf = window.STYLES.find((s) => s.id === "mf-valley"), scene = new Map();
    for (const d of (mf && mf.deco) || []) {
      if (!d || !window.MODELS[d[0]]) continue;
      const key = d[0] + JSON.stringify(d[1] || {});
      if (!scene.has(key)) scene.set(key, { kind: "model", name: d[0], label: d[0] + (Object.keys(d[1] || {}).length ? " " + JSON.stringify(d[1]).slice(0, 40) : ""), o: clone(d[1] || {}), frames: FRAMES[d[0]] || 1 });
    }
    groups.splice(2, 0, { id: "scene", label: "Placed in Momiji Valley", items: [...scene.values()] });
    const rank = (g) => (g.id === "studio" ? 0 : /^th-set/.test(g.id) ? 1 : /^th-/.test(g.id) ? 2 : g.id === "assets-other" ? 3 : g.id === "critters" ? 4 : g.id === "scene" ? 5 : 6);
    LIB = groups.map((g, i) => [g, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  }

  // ---------------------------------------------------------------- model and bake
  // the model for the current subject at phase t, with the engine's scale rules for critters (o.fine)
  // and the toy look (o.chunk); returns { md, scale } where scale is world units per voxel
  function subjectModel(t) {
    if (S.mode === "doc") return { md: AF.build(S.doc, { t }), scale: 1 / VS };
    const L = S.lib, o = Object.assign({}, L.o, L.frames > 1 ? { t } : {}), md = ME.modelOf(L.name, o);
    let fine = L.fine || 1, scale = 1 / VS;
    if (fine !== 1) { md.k = (o.size || md.k) * fine * CT.critterScale; scale = 1 / (VS * fine); }
    if (L.chunk && L.chunk > 1) { md.k /= L.chunk; scale = L.chunk / VS; }
    return { md, scale };
  }
  const frameCount = () => Math.max(1, (S.mode === "doc" ? S.doc.frames : S.lib && S.lib.frames) || 1);
  function bake(frame) {
    const key = S.version + ":" + frame, hit = S.vols.get(key);
    if (hit) return hit;
    const t0 = performance.now(), n = frameCount(), { md, scale } = subjectModel(frame / n);
    const vx = ME.voxelizeModel(md, VS, pal);
    const vol = { box: vx.box, dims: vx.dims, rgba: vx.rgba, solid: vx.solid, surf: vx.surf, scale, md, ms: performance.now() - t0 };
    // occupied 8^3 bricks: what this volume costs in the engine's brick pool
    let bricks = 0;
    const [nx, ny, nz] = vx.dims;
    for (let bz = 0; bz < nz; bz += 8) for (let by = 0; by < ny; by += 8) for (let bx = 0; bx < nx; bx += 8) {
      search: for (let z = bz; z < Math.min(nz, bz + 8); z++) for (let y = by; y < Math.min(ny, by + 8); y++) for (let x = bx; x < Math.min(nx, bx + 8); x++) if (vx.rgba[((z * ny + y) * nx + x) * 4 + 3]) { bricks++; break search; }
    }
    vol.bricks = bricks;
    if (S.vols.size > 48) S.vols.clear();
    S.vols.set(key, vol);
    return vol;
  }

  // Which document prim owns each surface voxel (the evalModel rule: nearest prim, carving prims that win
  // take over); drives click-to-select and the selection tint.
  function owners(vol) {
    const md = vol.md, prims = md.prims, K = md.k, dPrim = ME.sdf.dPrim, own = new Int16Array(vol.rgba.length / 4).fill(-9);
    if (S.mode !== "doc") return own;
    const [nx, ny] = vol.dims, [x0, y0, z0] = vol.box;
    for (const i of view.cells) {
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      const px = (x0 + x + 0.5) / VS / K, py = (y0 + y + 0.5) / VS / K, pz = (z0 + z + 0.5) / VS / K;
      let d = 1e9, best = 1e9, o = -9;
      for (let k = 0; k < prims.length; k++) {
        const p = prims[k];
        let e = dPrim(p, px, py, pz);
        if (p.disp) e += (P.noise(px * p.df, py * p.df, pz * p.df, 7) - 0.5) * p.disp;
        if (p.sub) { if (-e > d) { d = -e; o = p._src; } continue; }
        if (e < best) { best = e; o = p._src; }
        if (p.k2) { const hh = Math.min(1, Math.max(0, 0.5 + (0.5 * (e - d)) / p.k2)); d = e + (d - e) * hh - p.k2 * hh * (1 - hh); } else if (e < d) d = e;
      }
      own[i] = o;
    }
    return own;
  }

  let cur = null, own = null, hover = null, needsBake = true;
  const flagOf = (i) => (own && S.sel >= 0 && own[i] === S.sel ? 1 : 0) | (hover && hover.prev && hover.prev.has(i) ? 2 : 0);
  function refresh() {
    const t0 = performance.now();
    try { cur = bake(S.frame % frameCount()); S.warn = ""; } catch (e) { S.warn = "bake failed: " + e.message; ME.err("BAKE", e.stack || e.message); return; }
    syncTables();
    view.setVolume(cur, null);
    own = owners(cur);
    view.setFlags(flagOf);
    S.bakeMs = performance.now() - t0;
    const top = Math.max(cur.dims[2] * cur.scale + cur.box[2] * cur.scale, 1);
    view.groundR = Math.max(1.6, Math.hypot(cur.dims[0], cur.dims[1]) * cur.scale * 0.75 + 0.8);
    if (S.fitPending) { fit(); S.fitPending = false; }
    if (pal.missing.size) S.warn = "materials without ramps (drawn as stone): " + [...pal.missing].join(", ");
    renderStatus();
    return top;
  }
  function fit() {
    if (!cur) return;
    const s = cur.scale, lo = cur.box.map((b) => b * s), hi = cur.box.map((b, a) => (b + cur.dims[a]) * s);
    view.cam.target = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], (hi[2] - lo[2]) * 1.2, 0.3);
    view.cam.zoom = Math.min(view.cv.clientWidth, view.cv.clientHeight) / (ext * 1.3);
  }
  // any document change: new version, rebake on the next frame
  function changed(structural) {
    S.version++; needsBake = true;
    if (structural) renderRight();
    autosave();
  }
  let saveT = 0;
  function autosave() {
    clearTimeout(saveT);
    saveT = setTimeout(() => SV.store.setCurrent(S.mode === "doc" ? { mode: "doc", doc: S.doc } : { mode: "lib", lib: S.lib }), 400);
  }

  // ---------------------------------------------------------------- undo
  function snapshot() { return JSON.stringify({ doc: S.doc, sel: S.sel }); }
  // call before a change; continuous edits (scrubbing, dragging, strokes) take one snapshot per gesture
  function touch() {
    if (S.mode !== "doc" || S.pending) return;
    S.undo.push(snapshot()); if (S.undo.length > 120) S.undo.shift();
    S.redo.length = 0; S.pending = true;
  }
  const settle = () => { S.pending = false; };
  function undo(dir) {
    const from = dir < 0 ? S.undo : S.redo, to = dir < 0 ? S.redo : S.undo;
    if (!from.length || S.mode !== "doc") return;
    to.push(snapshot());
    const s = JSON.parse(from.pop());
    S.doc = s.doc; S.sel = Math.min(s.sel, S.doc.prims.length - 1); S.pending = false;
    installDocMats(S.doc); newPalette(); changed(true);
  }

  // ---------------------------------------------------------------- open subjects
  function openLib(item) {
    S.mode = "lib"; S.doc = null; S.sel = -1; S.undo = []; S.redo = []; S.frame = 0;
    S.lib = { name: item.name, label: item.label, o: clone(item.o || {}), frames: item.frames || 1, fine: item.fine || 1, chunk: 1 };
    if (S.tool !== "pick") S.tool = "select";
    S.fitPending = true; changed(true); renderLib(); renderTop();
  }
  function openDoc(doc, keepView) {
    S.mode = "doc"; S.doc = AF.normalize(clone(doc)); S.sel = -1; S.undo = []; S.redo = []; S.frame = 0; S.lib = null;
    installDocMats(S.doc); newPalette();
    if (!keepView) S.fitPending = true;
    changed(true); renderLib(); renderTop();
  }
  function fork() {
    if (S.mode !== "lib") return;
    const L = S.lib, isDoc = AF.docs[L.name];
    let doc;
    if (isDoc) doc = Object.assign(clone(isDoc), { name: uniqueName(L.name + "_copy") });
    else {
      const o = Object.assign({}, L.o, L.frames > 1 ? { t: S.frame / L.frames } : {}), md = subjectModel(S.frame / (L.frames || 1)).md;
      doc = AF.fromModel(L.name, o, { name: uniqueName(L.name.replace(/[^A-Za-z0-9_]/g, "_") + "_edit"), label: L.label + " (fork)", k: md.k });
    }
    openDoc(doc, true);
    toast("Forked " + L.label + " into " + doc.name + (doc.inherit ? " (keeps the model's detail painting)" : ""));
  }
  function uniqueName(n) {
    const taken = new Set([...Object.keys(window.MODELS), ...Object.keys(SV.store.all())]);
    if (!taken.has(n)) return n;
    for (let i = 2; ; i++) if (!taken.has(n + i)) return n + i;
  }
  function newDoc() {
    const doc = AF.normalize({
      name: uniqueName("asset"), label: "New asset", k: 1.6,
      prims: [{ t: "E", p: [0, 0, 0.02], s: [0.3, 0.3, 0.065], m: "moss", k2: 0.03, name: "moss pad" }, { t: "S", p: [0, 0, 0.26], r: 0.2, m: "stone", k2: 0.04, name: "body" }],
      rules: [],
    });
    openDoc(doc); S.sel = 1; S.tab = "shape"; renderRight();
  }

  // ---------------------------------------------------------------- prims
  const sel = () => (S.mode === "doc" && S.sel >= 0 ? S.doc.prims[S.sel] : null);
  function newPrim(t) {
    const c = view.cam.target, K = S.doc.k, p = [r4(c[0] / K), r4(c[1] / K), r4(Math.max(0.1, c[2] / K))];
    const base = { S: { r: 0.12 }, E: { s: [0.15, 0.1, 0.08] }, C: { b: [p[0], p[1], p[2] + 0.25], ra: 0.06, rb: 0.04 }, B: { s: [0.1, 0.1, 0.1], r: 0.01 }, Y: { r: 0.1, hh: 0.1 } }[t];
    touch();
    S.doc.prims.push(Object.assign({ t, p, m: S.mat }, clone(base)));
    S.sel = S.doc.prims.length - 1; settle(); changed(true);
  }
  function primOp(op) {
    const q = sel();
    if (!q) return;
    touch();
    const a = S.doc.prims, i = S.sel;
    if (op === "dup") { const c = clone(q); c.p = add3(c.p, [0.05, 0.05, 0]); if (c.b) c.b = add3(c.b, [0.05, 0.05, 0]); a.splice(i + 1, 0, c); S.sel = i + 1; }
    else if (op === "del") { a.splice(i, 1); S.sel = Math.min(i, a.length - 1); }
    else if (op === "up" && i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; S.sel = i - 1; }
    else if (op === "down" && i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; S.sel = i + 1; }
    settle(); changed(true);
  }

  // ---------------------------------------------------------------- voxel tools
  // document cell (1 / grid model units) for a world point; volume voxel centres map exactly when
  // grid = VS * k (the default)
  const grid = () => AF.grid(S.doc);
  const cellOfWorld = (w) => { const g = grid() / S.doc.k; return [Math.floor(w[0] * g + 1e-6), Math.floor(w[1] * g + 1e-6), Math.floor(w[2] * g + 1e-6)]; };
  const voxCenter = (c) => c.map((v, a) => (cur.box[a] + v + 0.5) * cur.scale);
  // target cell of a pick for a tool (add: the empty neighbour across the hit face)
  function toolTarget(pk, tool) {
    if (pk.cell) {
      const w = voxCenter(pk.cell);
      if (tool === "add") return cellOfWorld(add3(w, mul3(pk.face, cur.scale)));
      return cellOfWorld(w);
    }
    if (pk.ground && tool === "add") return cellOfWorld([pk.ground[0], pk.ground[1], 0.5 * cur.scale]);
    return null;
  }
  function brushCells(c) {
    const r = S.brush, out = [];
    for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (S.brushShape === "sphere" && x * x + y * y + z * z > r * r + 0.5) continue;
      out.push([c[0] + x, c[1] + y, c[2] + z]);
    }
    return out;
  }
  // volume index of a document cell (null when the grids do not line up or it is outside)
  function volIndex(c) {
    const g = grid() / S.doc.k, k = 1 / (cur.scale * g);
    const v = c.map((x, a) => Math.round((x + 0.5) * k - 0.5) - cur.box[a]);
    if (v.some((x, a) => x < 0 || x >= cur.dims[a])) return null;
    return (v[2] * cur.dims[1] + v[1]) * cur.dims[0] + v[0];
  }
  // the voxel layer the tools edit: vox, or the shown frame's vox[frame] when the layers are a flipbook
  const frameLayer = (d = S.doc) => (Array.isArray(d.vox) ? d.vox[S.frame % d.vox.length] || null : d.vox);
  function setFrameLayer(L) { if (Array.isArray(S.doc.vox)) S.doc.vox[S.frame % S.doc.vox.length] = L || null; else S.doc.vox = L || undefined; }
  const layerInfo = (d) => (Array.isArray(d.vox) ? `voxel layers: ${d.vox.length} frames, this one ${frameLayer(d) ? frameLayer(d).n.join("×") + " cells" : "empty"}` : d.vox ? `voxel layer ${d.vox.n.join("×")} cells` : "");
  let layer = null; // Map of the voxel layer being edited during a stroke
  function applyTool(pk, tool) {
    if (S.mode !== "doc") return;
    if (tool === "pick") { if (pk.cell) { const m = pal.names[cur.rgba[pk.index * 4 + 3]]; if (m) { S.mat = m; toast("Material " + m); renderRight(); } } return; }
    const c = toolTarget(pk, tool);
    if (!c) return;
    touch();
    if (tool === "add" || tool === "erase") {
      // the stroke's cells are the layer of the frame it writes to, re-read when the frame changes
      if (!layer || layer.frame !== S.frame) { layer = AF.layerCells(frameLayer()); layer.frame = S.frame; }
      for (const q of brushCells(c)) layer.set(AF.key(...q), tool === "add" ? S.mat : 255);
      setFrameLayer(AF.cellsLayer(layer));
    } else if (tool === "paint" || tool === "fill") {
      const cells = tool === "fill" ? fillCells(pk) : brushCells(c).filter((q) => { const i = volIndex(q); return i === null || cur.rgba[i * 4 + 3]; });
      paintCells(cells, S.mat);
    }
    changed(false);
  }
  function paintCells(cells, m) {
    const p = S.doc.paint ? { mats: S.doc.paint.mats.slice(), cells: S.doc.paint.cells.slice() } : { mats: [], cells: [] };
    let mi = p.mats.indexOf(m);
    if (mi < 0 && m) { mi = p.mats.length; p.mats.push(m); }
    const idx = new Map();
    for (let i = 0; i < p.cells.length; i += 4) idx.set(AF.key(p.cells[i], p.cells[i + 1], p.cells[i + 2]), i);
    for (const q of cells) {
      const k = AF.key(...q), at = idx.get(k);
      if (at !== undefined) p.cells[at + 3] = mi;
      else { idx.set(k, p.cells.length); p.cells.push(q[0], q[1], q[2], mi); }
    }
    S.doc.paint = p;
  }
  // bucket fill: surface voxels connected to the hit voxel with its material
  function fillCells(pk) {
    if (!pk.cell) return [];
    const [nx, ny, nz] = cur.dims, rgba = cur.rgba, m0 = rgba[pk.index * 4 + 3], surf = new Set(view.cells), seen = new Set([pk.index]), q = [pk.index], out = [];
    while (q.length && out.length < 60000) {
      const i = q.pop(), x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      out.push(cellOfWorld(voxCenter([x, y, z])));
      for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const X = x + a, Y = y + b, Z = z + c;
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
        const j = (Z * ny + Y) * nx + X;
        if (seen.has(j) || !surf.has(j) || rgba[j * 4 + 3] !== m0) continue;
        seen.add(j); q.push(j);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- handles
  // Draggable points of the selected prim, in world units (model units x k).
  function handles() {
    const q = sel();
    if (!q || S.tool !== "select") return [];
    const K = S.doc.k, W = (v) => mul3(v, K), c = W(q.p), out = [], R = q.rot && q.t !== "C" ? AF.rotRows(q.rot) : null;
    const axis = (i) => { const e = [0, 0, 0]; e[i] = 1; return R ? [R[i], R[3 + i], R[6 + i]] : e; }; // local axis i in world (columns of R^T = rows of R)
    const len = 34 / view.cam.zoom;
    out.push({ kind: "move", pos: c, color: "#f2e6c8" });
    ["#e8664a", "#7cc35a", "#5aa0e8"].forEach((col, i) => { const e = [0, 0, 0]; e[i] = 1; out.push({ kind: "axis", axis: e, pos: add3(c, mul3(e, len)), from: c, color: col }); });
    const size = (val, i, set) => out.push({ kind: "size", axis: axis(i), pos: add3(c, mul3(axis(i), val * K)), color: "#e0b25c", set });
    if (q.t === "S") out.push({ kind: "radius", pos: add3(c, mul3(view.cam.basis().rx, q.r * K)), color: "#e0b25c", set: (d) => (q.r = d) });
    if (q.t === "E" || q.t === "B") for (let i = 0; i < 3; i++) size(q.s[i], i, (d) => (q.s[i] = d));
    if (q.t === "Y") { size(q.r, 0, (d) => (q.r = d)); size(q.hh, 2, (d) => (q.hh = d)); }
    if (q.t === "C") out.push({ kind: "end", pos: W(q.b), color: "#d890f0" });
    return out;
  }
  let drag = null;
  function startDrag(hd, e) {
    touch();
    drag = { hd, start: hd.pos.slice(), p0: S.doc.prims[S.sel].p.slice(), b0: (S.doc.prims[S.sel].b || []).slice(), n: view.cam.basis().dp, ox: e.offsetX, oy: e.offsetY };
  }
  function dragTo(e) {
    const q = sel(), K = S.doc.k, hd = drag.hd, r = view.ray(e.offsetX, e.offsetY);
    // point under the cursor on the view plane through the handle
    const t = dot3(sub3(drag.start, r.o), drag.n) / dot3(r.d, drag.n), m = add3(r.o, mul3(r.d, t));
    let dw = sub3(m, drag.start);
    const snapV = (v) => (S.snap ? Math.round(v * grid()) / grid() : r4(v));
    if (hd.kind === "axis") dw = mul3(hd.axis, dot3(dw, hd.axis));
    if (hd.kind === "move" || hd.kind === "axis") {
      const d = mul3(dw, 1 / K);
      q.p = drag.p0.map((v, a) => snapV(v + d[a]));
      if (q.t === "C") { const moved = sub3(q.p, drag.p0); q.b = drag.b0.map((v, a) => r4(v + moved[a])); }
    } else if (hd.kind === "end") q.b = drag.b0.map((v, a) => snapV(v + dw[a] / K));
    else if (hd.kind === "size") hd.set(Math.max(0.004, snapV(dot3(sub3(m, mul3(q.p, K)), hd.axis) / K)));
    else if (hd.kind === "radius") hd.set(Math.max(0.004, snapV(Math.hypot(...sub3(m, mul3(q.p, K))) / K)));
    S.version++; needsBake = true; S.dragging = true;
  }

  // ---------------------------------------------------------------- viewport input
  function bindViewport() {
    const cv = view.cv;
    let mode = null, last = null, stroke = null;
    const pointers = new Map();
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointerdown", (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers (self-test) */ }
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      last = [e.offsetX, e.offsetY];
      if (pointers.size === 2) { mode = "pinch"; stroke = null; return; }
      const tool = e.altKey ? "pick" : S.tool;
      if (e.button === 2 || e.button === 1 || (e.button === 0 && (e.shiftKey || S.space))) { mode = e.button === 1 || e.shiftKey ? "pan" : "orbit"; return; }
      if (tool === "select") {
        const hd = handles().find((hd) => { const s = view.project(hd.pos); return Math.hypot(s[0] - e.offsetX, s[1] - e.offsetY) < 10; });
        if (hd && S.mode === "doc") { startDrag(hd, e); mode = "drag"; return; }
        mode = "select?"; return;
      }
      if (S.mode !== "doc" && tool !== "pick") { mode = "orbit"; return; }
      mode = "tool"; stroke = { tool, done: new Set() };
      if (S.playing) { S.playing = false; renderStatus(); } // a stroke stays on the frame it started on
      strokeAt(stroke, e.offsetX, e.offsetY);
    });
    const strokeAt = (sk, x, y) => {
      const pk = view.pick(x, y), c = pk.cell ? pk.cell.join() : pk.ground ? "g" + cellOfWorld(pk.ground).join() : null;
      if (!c || sk.done.has(c)) return;
      sk.done.add(c);
      applyTool(pk, sk.tool);
    };
    cv.addEventListener("pointermove", (e) => {
      const p = [e.offsetX, e.offsetY];
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (mode === "pinch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last.pd) { zoomAt(c[0], c[1], d / last.pd); pan(c[0] - last.c[0], c[1] - last.c[1]); }
        last = Object.assign([], p, { pd: d, c }); return;
      }
      if (!mode || mode === "select?") {
        if (mode === "select?" && Math.hypot(p[0] - last[0], p[1] - last[1]) > 4) mode = "orbit";
        else { hoverAt(e); return; }
      }
      const dx = p[0] - last[0], dy = p[1] - last[1];
      last = p;
      if (mode === "orbit") { view.cam.yaw -= dx * 0.008; if (!view.cam.engine) view.cam.pitch = Math.max(-85, Math.min(89, view.cam.pitch + dy * 0.4)); }
      else if (mode === "pan") pan(dx, dy);
      else if (mode === "drag") dragTo(e);
      else if (mode === "tool" && S.tool !== "fill") strokeAt(stroke, p[0], p[1]);
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (mode === "select?") {
        const pk = view.pick(e.offsetX, e.offsetY);
        if (S.mode === "doc") { S.sel = pk.cell && own ? own[pk.index] : -1; if (S.sel < 0) S.sel = -1; view.setFlags(flagOf); renderRight(); }
      }
      if (mode === "drag" || mode === "tool") { settle(); layer = null; S.dragging = false; renderRight(); }
      mode = pointers.size ? mode : null; stroke = null;
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", () => { hover = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }
  function pan(dx, dy) {
    const { rx, up } = view.cam.basis(), z = view.cam.zoom;
    view.cam.target = add3(view.cam.target, add3(mul3(rx, -dx / z), mul3(up, dy / z / Math.max(0.3, dot3(up, up)))));
  }
  function zoomAt(x, y, f) {
    const before = view.ray(x, y).o;
    view.cam.zoom = Math.max(8, Math.min(6000, view.cam.zoom * f));
    const after = view.ray(x, y).o, { dp } = view.cam.basis(), d = sub3(before, after);
    view.cam.target = add3(view.cam.target, sub3(d, mul3(dp, dot3(d, dp))));
  }
  function hoverAt(e) {
    if (S.tool === "select" || !cur) { hover = null; return; }
    const pk = view.pick(e.offsetX, e.offsetY), prev = new Set();
    if (S.mode === "doc" && pk.cell && (S.tool === "paint" || S.tool === "erase")) {
      const c = toolTarget(pk, S.tool);
      if (c) for (const q of brushCells(c)) { const i = volIndex(q); if (i !== null && cur.rgba[i * 4 + 3]) prev.add(i); }
    }
    hover = { pk, prev };
    view.setFlags(flagOf);
  }

  // ---------------------------------------------------------------- overlay
  function drawOverlay() {
    const w = overlay.clientWidth, hh = overlay.clientHeight, dpr = view.dpr || 1;
    if (overlay.width !== Math.round(w * dpr)) { overlay.width = Math.round(w * dpr); overlay.height = Math.round(hh * dpr); }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, w, hh);
    // add-tool ghost: the cell that would be filled
    if (hover && S.mode === "doc" && S.tool === "add") {
      const c = toolTarget(hover.pk, "add");
      if (c) cubeOutline(c.map((v) => v / (grid() / S.doc.k)), S.doc.k / grid(), "rgba(120,220,255,0.95)");
    }
    if (hover && hover.pk.cell && (S.tool === "pick" || S.tool === "fill")) cubeOutline(voxCenter(hover.pk.cell).map((v) => v - cur.scale / 2), cur.scale, "rgba(255,240,200,0.9)");
    for (const hd of handles()) {
      const s = view.project(hd.pos);
      if (hd.kind === "axis") { const f = view.project(hd.from); octx.strokeStyle = hd.color; octx.lineWidth = 2; octx.beginPath(); octx.moveTo(f[0], f[1]); octx.lineTo(s[0], s[1]); octx.stroke(); }
      octx.fillStyle = hd.color; octx.strokeStyle = "rgba(0,0,0,0.7)"; octx.lineWidth = 1.5;
      octx.beginPath();
      if (hd.kind === "move") octx.rect(s[0] - 5, s[1] - 5, 10, 10); else octx.arc(s[0], s[1], hd.kind === "axis" ? 5 : 4.5, 0, TAU);
      octx.fill(); octx.stroke();
    }
    // axis triad
    const { rx, up } = view.cam.basis(), o = [36, hh - 36];
    [["x", [1, 0, 0], "#e8664a"], ["y", [0, 1, 0], "#7cc35a"], ["z", [0, 0, 1], "#5aa0e8"]].forEach(([n, a, col]) => {
      const e = [o[0] + dot3(a, rx) * 22, o[1] - dot3(a, up) * 22];
      octx.strokeStyle = col; octx.lineWidth = 2; octx.beginPath(); octx.moveTo(o[0], o[1]); octx.lineTo(e[0], e[1]); octx.stroke();
      octx.fillStyle = col; octx.font = "11px ui-monospace, Consolas, monospace"; octx.fillText(n, e[0] + 2, e[1] - 2);
    });
  }
  function cubeOutline(lo, s, col) {
    const C = [];
    for (let i = 0; i < 8; i++) C.push(view.project([lo[0] + (i & 1) * s, lo[1] + ((i >> 1) & 1) * s, lo[2] + ((i >> 2) & 1) * s]));
    octx.strokeStyle = col; octx.lineWidth = 1.5; octx.beginPath();
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) { octx.moveTo(C[a][0], C[a][1]); octx.lineTo(C[b][0], C[b][1]); }
    octx.stroke();
  }

  // ---------------------------------------------------------------- panel widgets
  // numeric field with a drag-to-scrub label; set() runs on every change, one undo step per gesture
  function num(label, get, set, o = {}) {
    const step = o.step ?? 0.005, inp = h("input", { type: "number", step, value: r4(get()) });
    const apply = (v) => { if (!Number.isFinite(v)) return; if (o.min !== undefined) v = Math.max(o.min, v); if (o.max !== undefined) v = Math.min(o.max, v); touch(); set(r4(v)); inp.value = r4(v); changed(!!o.structural); };
    inp.addEventListener("input", () => apply(parseFloat(inp.value)));
    inp.addEventListener("change", settle);
    const lab = h("label.scrub", { title: "drag to scrub" }, label);
    lab.addEventListener("pointerdown", (e) => {
      const x0 = e.clientX, v0 = get(); lab.setPointerCapture(e.pointerId);
      const mv = (ev) => apply(v0 + Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1));
      const end = () => { lab.removeEventListener("pointermove", mv); lab.removeEventListener("pointerup", end); settle(); };
      lab.addEventListener("pointermove", mv); lab.addEventListener("pointerup", end);
    });
    return h("div.f", {}, lab, inp);
  }
  const vec = (label, arr, o = {}) => h("div.vec", {}, h("span.vl", {}, label), ["x", "y", "z"].map((a, i) => num(a, () => arr()[i], (v) => (arr()[i] = v), o)));
  function matField(get, set, o = {}) {
    const sw = h("span.swh", {}, get() ? swatch(get(), 4) : "");
    const inp = h("input", { list: "matlist", value: get() || "", placeholder: o.placeholder || "material" });
    inp.addEventListener("change", () => { const v = inp.value.trim(); touch(); set(v || null); settle(); sw.replaceChildren(v ? swatch(v, 4) : ""); changed(false); });
    return h("div.f.mat", {}, h("label", {}, o.label || "material"), sw, inp);
  }
  const check = (label, get, set, structural) => h("label.chk", {}, h("input", { type: "checkbox", checked: !!get(), on: { change: (e) => { touch(); set(e.target.checked); settle(); changed(structural); } } }), label);
  const btn = (label, fn, o = {}) => h("button" + (o.cls ? "." + o.cls : ""), { title: o.title || "", disabled: !!o.disabled, on: { click: fn } }, label);
  const section = (title, ...kids) => h("section", {}, h("h3", {}, title), ...kids);

  // ---------------------------------------------------------------- panels
  function renderTop() {
    const t = $("#title");
    t.textContent = S.mode === "doc" ? S.doc.label || S.doc.name : S.lib ? S.lib.label : "";
    $("#subtitle").textContent = S.mode === "doc" ? "studio asset · " + S.doc.name + (SV.store.all()[S.doc.name] ? "" : " · unsaved") : "library model (read-only)";
    for (const b of document.querySelectorAll("[data-doc]")) b.disabled = S.mode !== "doc";
    $("#b-undo").disabled = !S.undo.length; $("#b-redo").disabled = !S.redo.length;
  }
  function renderLib() {
    const box = $("#lib"), q = S.search.toLowerCase();
    box.replaceChildren();
    for (const g of LIB) {
      const items = g.items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.name.toLowerCase().includes(q));
      if (!items.length && g.id !== "studio") continue;
      const open = S.closed ? !S.closed.has(g.id) : true;
      const head = h("div.gh", { on: { click: () => { S.closed = S.closed || new Set(); S.closed.has(g.id) ? S.closed.delete(g.id) : S.closed.add(g.id); renderLib(); } } }, h("span", {}, open ? "▾" : "▸"), " ", g.label, h("em", {}, items.length));
      box.append(head);
      if (!open) continue;
      if (g.id === "studio" && !items.length) box.append(h("div.empty", {}, "Save or import an asset to list it here."));
      for (const it of items) {
        const active = (S.mode === "doc" && it.kind === "doc" && S.doc.name === it.name) || (S.mode === "lib" && S.lib && it.kind === "model" && S.lib.name === it.name && S.lib.label === it.label);
        box.append(h("div.it" + (active ? ".on" : ""), { title: it.name, on: { click: () => (it.kind === "doc" ? openDoc(it.doc) : openLib(it)) } }, it.label, it.kind === "doc" && !it.saved ? h("em", {}, "pack") : null, it.frames > 1 ? h("em", {}, it.frames + "f") : null));
      }
    }
  }
  function renderRight() {
    const tabs = $("#tabs"), body = $("#panel");
    const T = [["shape", "Shape"], ["voxel", "Voxel"], ["mats", "Materials"], ["asset", "Asset"], ["view", "View"]];
    tabs.replaceChildren(...T.map(([id, l]) => h("button" + (S.tab === id ? ".on" : ""), { on: { click: () => { S.tab = id; renderRight(); } } }, l)));
    body.replaceChildren(...({ shape: panelShape, voxel: panelVoxel, mats: panelMats, asset: panelAsset, view: panelView }[S.tab] || panelShape)());
    renderTop(); renderTools();
  }
  function libBanner() {
    if (S.mode === "doc") return null;
    const L = S.lib;
    return section("Library model",
      h("p.dim", {}, "Read-only, baked exactly as the engine bakes it. Fork it to edit a copy: its shapes become editable, its detail painting (code) is kept by reference, and the current frame is frozen."),
      h("div.f", {}, h("label", {}, "options"), h("input", { value: JSON.stringify(L.o), on: { change: (e) => { try { L.o = JSON.parse(e.target.value || "{}"); changed(false); } catch (err) { toast("options must be JSON"); } } } })),
      num("frames", () => L.frames, (v) => { L.frames = Math.max(1, Math.round(v)); S.frame = 0; }, { step: 1, min: 1, max: 16 }),
      h("div.f", {}, h("label", {}, "toy look"), h("select", { on: { change: (e) => { L.chunk = +e.target.value; changed(false); } } }, [1, 2, 3].map((c) => h("option", { value: c, selected: L.chunk === c }, c === 1 ? "off" : "1/" + c + " density")))),
      h("div.row", {}, btn("Fork to edit", fork, { cls: "pri" })));
  }
  function panelShape() {
    if (S.mode !== "doc") return [libBanner()];
    const d = S.doc, q = sel();
    const list = h("div.prims", {}, d.prims.map((p, i) => h("div.pr" + (i === S.sel ? ".on" : "") + (p.hide ? ".off" : ""), { on: { click: () => { S.sel = i; view.setFlags(flagOf); renderRight(); } } },
      swatch(p.m, 3), h("b", {}, p.t), " ", p.name || PRIM_TYPES[p.t].toLowerCase(), p.sub ? h("em", {}, "carve") : null, p.mir ? h("em", {}, "mirror") : null, p.mv || p.mr ? h("em", {}, "motion") : null,
      h("span.eye", { title: "hide", on: { click: (e) => { e.stopPropagation(); touch(); p.hide = !p.hide; settle(); changed(true); } } }, p.hide ? "○" : "●"))));
    const add = h("div.row.wrap", {}, Object.keys(PRIM_TYPES).map((t) => btn("+ " + PRIM_TYPES[t], () => newPrim(t))));
    const out = [section("Shapes", add, list, d.vox ? h("p.dim", {}, layerInfo(d) + " (Voxel tab)") : null)];
    if (q) {
      const f = [];
      f.push(h("div.f", {}, h("label", {}, "name"), h("input", { value: q.name || "", on: { change: (e) => { touch(); q.name = e.target.value; settle(); changed(true); } } })));
      f.push(h("div.f", {}, h("label", {}, "type"), h("select", { on: { change: (e) => { touch(); convertPrim(q, e.target.value); settle(); changed(true); } } }, Object.keys(PRIM_TYPES).map((t) => h("option", { value: t, selected: q.t === t }, PRIM_TYPES[t])))));
      f.push(matField(() => q.m, (v) => (q.m = v || "stone")));
      f.push(vec(q.t === "C" ? "start" : "centre", () => q.p));
      if (q.t === "S") f.push(num("radius", () => q.r, (v) => (q.r = v), { min: 0.002 }));
      if (q.t === "E") f.push(vec("radii", () => q.s, { min: 0.002 }));
      if (q.t === "B") { f.push(vec("half size", () => q.s, { min: 0.001 })); f.push(num("rounding", () => q.r || 0, (v) => (q.r = v), { min: 0 })); }
      if (q.t === "Y") { f.push(num("radius", () => q.r, (v) => (q.r = v), { min: 0.002 })); f.push(num("half height", () => q.hh, (v) => (q.hh = v), { min: 0.002 })); f.push(num("rounding", () => q.rr || 0, (v) => (q.rr = v), { min: 0 })); }
      if (q.t === "C") { f.push(vec("end", () => q.b)); f.push(num("radius a", () => q.ra, (v) => (q.ra = v), { min: 0.001 })); f.push(num("radius b", () => q.rb, (v) => (q.rb = v), { min: 0.001 })); }
      if (q.t !== "C") f.push(vec("rotation°", () => (q.rot = q.rot || [0, 0, 0]), { step: 1 }));
      f.push(num("smooth blend", () => q.k2 || 0, (v) => (q.k2 = v || undefined), { min: 0 }));
      f.push(h("div.row.wrap", {}, check("carve (subtract)", () => q.sub, (v) => (q.sub = v || undefined), true), check("mirror in y", () => q.mir, (v) => (q.mir = v || undefined), true)));
      if (q.sub) f.push(matField(() => q.subm, (v) => (q.subm = v || undefined), { label: "cut material", placeholder: "keep" }));
      f.push(num("displace", () => q.disp || 0, (v) => (q.disp = v || undefined), { min: 0 }), num("disp. freq", () => q.df || 8, (v) => (q.df = v), { min: 0.1, step: 0.5 }));
      const mo = [vec("move", () => (q.mv = q.mv || [0, 0, 0])), q.t !== "C" || true ? vec("swing°", () => (q.mr = q.mr || [0, 0, 0]), { step: 1 }) : null, num("phase", () => q.ph || 0, (v) => (q.ph = v), { step: 0.05 })];
      out.push(section(PRIM_TYPES[q.t] + " " + (S.sel + 1), ...f, h("details", { open: !!(q.mv || q.mr) }, h("summary", {}, "Motion (loops over the asset's frames)"), ...mo),
        h("div.row.wrap", {}, btn("Duplicate", () => primOp("dup"), { title: "Ctrl+D" }), btn("↑", () => primOp("up"), { title: "earlier (carves affect earlier shapes)" }), btn("↓", () => primOp("down")), btn("Delete", () => primOp("del"), { cls: "warn", title: "Del" }))));
    } else out.push(h("p.dim", {}, "Click a shape in the viewport or the list to edit it. Drag its handles: square = move, coloured dots = move along an axis, gold = size."));
    return out;
  }
  // keep position and rough size when switching a prim's type
  function convertPrim(q, t) {
    const sz = q.t === "S" ? q.r : q.t === "C" ? Math.max(q.ra, q.rb) : q.t === "Y" ? q.r : Math.max(...q.s);
    for (const k of ["r", "s", "b", "ra", "rb", "hh", "rr"]) delete q[k];
    q.t = t;
    if (t === "S") q.r = sz; else if (t === "E" || t === "B") q.s = [sz, sz, sz]; else if (t === "Y") { q.r = sz; q.hh = sz; } else { q.b = add3(q.p, [0, 0, sz * 2]); q.ra = sz * 0.5; q.rb = sz * 0.4; delete q.rot; }
  }
  function panelVoxel() {
    if (S.mode !== "doc") return [libBanner()];
    const d = S.doc, g = grid(), aligned = Math.abs(g - VS * d.k) < 1e-6;
    const tools = [["add", "Add", "KeyA"], ["erase", "Erase", "KeyX"], ["paint", "Paint", "KeyP"], ["fill", "Fill", "KeyF"], ["pick", "Pick", "KeyI"]], L = ME.keys.label;
    return [
      section("Voxel tools", h("div.row.wrap", {}, tools.map(([id, l, k]) => btn(l + " (" + L(k) + ")", () => setTool(id), { cls: S.tool === id ? "on" : "" }))),
        num("brush radius", () => S.brush, (v) => (S.brush = Math.round(v)), { step: 1, min: 0, max: 12 }),
        h("div.f", {}, h("label", {}, "brush"), h("select", { on: { change: (e) => (S.brushShape = e.target.value) } }, ["sphere", "cube"].map((s) => h("option", { selected: S.brushShape === s }, s)))),
        matField(() => S.mat, (v) => (S.mat = v || "stone"), { label: "material" }),
        h("p.dim", {}, "Left click / drag applies the tool, Alt+click picks a material, right drag orbits, middle or Shift drag pans. Add works on the ground too.")),
      section("Layers",
        h("p.dim", {}, frameLayer(d) ? `${layerInfo(d)}, ${frameLayer(d).mats.length} materials` : d.vox ? layerInfo(d) : "no voxel layer yet", " · ", d.paint ? `${d.paint.cells.length / 4} painted cells` : "no paint"),
        h("p.dim", {}, `grid: ${r4(g)} cells per model unit = ${r4(g / d.k)} per tile` + (aligned ? " (aligned with the engine's 16 voxels per tile)" : " — not aligned with the engine grid (k changed): cells are resampled")),
        h("div.row.wrap", {}, btn(Array.isArray(d.vox) ? "Clear this frame's layer" : "Clear voxel layer", () => { touch(); if (Array.isArray(d.vox)) setFrameLayer(null); else delete d.vox; settle(); changed(true); }, { cls: "warn" }), btn("Clear paint", () => { touch(); delete d.paint; settle(); changed(true); }, { cls: "warn" }),
          !aligned ? btn("Re-align grid to k", () => { touch(); d.grid = VS * d.k; settle(); changed(true); }, { title: "cells keep their indices and change size" }) : null)),
    ];
  }
  function panelMats() {
    const used = new Set(), d = S.doc;
    if (d) { d.prims.forEach((p) => { used.add(p.m); if (p.subm) used.add(p.subm); }); AF.voxLayers(d).forEach((L) => L.mats.forEach((m) => used.add(m))); if (d.paint) d.paint.mats.forEach((m) => used.add(m)); (d.rules || []).forEach((r) => used.add(r.to)); }
    if (cur) for (const i of view.cells || []) used.add(pal.names[cur.rgba[i * 4 + 3]]);
    used.delete(undefined); used.delete(null);
    const q = (S.matSearch || "").toLowerCase(), all = Object.keys(st.ramps).filter((n) => !q || n.toLowerCase().includes(q)).sort();
    const row = (n) => h("div.mrow" + (n === S.mat ? ".on" : ""), { title: JSON.stringify(st.ramps[n]), on: { click: () => { S.mat = n; renderRight(); } } }, swatch(n, 8), h("span", {}, n), d && d.mats && d.mats[n] ? h("em", {}, "asset") : null);
    const sp = sel();
    const out = [
      section("Current: " + S.mat, h("div.big", {}, swatch(S.mat, 16)), sp ? btn("Apply to selected shape", () => { touch(); sp.m = S.mat; settle(); changed(true); }) : null),
      section("In this model", h("div.mlist", {}, [...used].sort().map(row))),
      section("All materials", h("input", { placeholder: "search " + Object.keys(st.ramps).length + " materials", value: S.matSearch || "", on: { input: (e) => { S.matSearch = e.target.value; const l = $("#allmats"); l.replaceChildren(...Object.keys(st.ramps).filter((n) => n.toLowerCase().includes(e.target.value.toLowerCase())).sort().map(row)); } } }), h("div.mlist#allmats", {}, all.map(row))),
    ];
    if (d) out.splice(1, 0, matEditor());
    return out;
  }
  // custom materials: the generator's ramp spec [hex, steps, darkL, lightL, hueShift, sat] plus lighting class
  function matEditor() {
    const d = S.doc, ed = (S.matEd = S.matEd || { name: "", hex: "#7aa860", n: 6, lo: 0.15, hi: 0.8, shift: 0.3, sat: 1, cls: 0, em: 0, light: 1 });
    const prev = h("div.big");
    const draw = () => { try { const r = P.makeRamp([ed.hex, ed.n, ed.lo, ed.hi, ed.shift, ed.sat]); prev.replaceChildren(h("span.sw", {}, r.map((c) => h("i", { style: { background: `rgb(${c})` } })))); } catch (e) {} };
    const f = (label, key, o) => { const inp = h("input", Object.assign({ value: ed[key], on: { input: (e) => { ed[key] = e.target.type === "number" || e.target.type === "range" ? parseFloat(e.target.value) : e.target.value; draw(); } } }, o)); return h("div.f", {}, h("label", {}, label), inp); };
    draw();
    const own = Object.keys(d.mats || {});
    return section("Asset materials",
      own.length ? h("div.row.wrap", {}, own.map((n) => btn(n, () => { const m = d.mats[n], r = m.ramp; Object.assign(ed, { name: n, hex: r[0], n: r[1] || 6, lo: r[2] ?? 0.15, hi: r[3] ?? 0.8, shift: r[4] ?? 0.3, sat: r[5] ?? 1, cls: m.cls || 0, em: m.em === true ? 1 : Math.max(0, +m.em || 0), light: m.light ? m.light[3] : 1 }); renderRight(); }))) : h("p.dim", {}, "Materials made here travel with the asset."),
      f("name", "name", { placeholder: "e.g. frogGreen" }), f("base colour", "hex", { type: "color" }), f("steps", "n", { type: "number", min: 2, max: 16, step: 1 }),
      f("dark L", "lo", { type: "range", min: 0, max: 1, step: 0.01 }), f("light L", "hi", { type: "range", min: 0, max: 1, step: 0.01 }), f("hue shift", "shift", { type: "range", min: 0, max: 1, step: 0.01 }), f("saturation", "sat", { type: "range", min: 0, max: 2, step: 0.01 }),
      h("div.f", {}, h("label", {}, "class"), h("select", { on: { change: (e) => (ed.cls = +e.target.value) } }, CLASSES.map((c, i) => h("option", { value: i, selected: ed.cls === i }, c)))),
      f("glow (0: none; 1: full; about 0.5 keeps a pale neon's hue; casts a point light in scenes)", "em", { type: "number", min: 0, max: 2, step: 0.05 }),
      prev,
      h("div.row", {}, btn("Save material", () => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ed.name)) { toast("material name must be an identifier"); return; }
        touch();
        d.mats = d.mats || {};
        const m = { ramp: [ed.hex, ed.n, ed.lo, ed.hi, ed.shift, ed.sat] };
        if (ed.cls) m.cls = ed.cls;
        if (ed.em > 0) { m.em = ed.em; const c = P.hex(ed.hex); m.light = [c[0] / 255, c[1] / 255, c[2] / 255, ed.light]; }
        d.mats[ed.name] = m; S.mat = ed.name; settle();
        installDocMats(d); newPalette(); changed(true);
      }, { cls: "pri" }), ed.name && d.mats && d.mats[ed.name] ? btn("Remove", () => { touch(); delete d.mats[ed.name]; settle(); newPalette(); changed(true); }, { cls: "warn" }) : null));
  }
  function panelAsset() {
    if (S.mode !== "doc") return [libBanner(), section("Export", h("div.row.wrap", {}, btn("PNG", exportPng), btn(".vox", exportVox)))];
    const d = S.doc, md = cur && cur.md;
    const rules = (d.rules = d.rules || []);
    const ruleRow = (r, i) => h("div.rule", {},
      h("div.row", {}, h("span.dim", {}, "if"), matField(() => r.m || "", (v) => (r.m = v || ""), { label: "material", placeholder: "any" })),
      h("div.row", {}, num("normal z >", () => r.nz ?? -1, (v) => (r.nz = v <= -1 ? undefined : v), { min: -1, max: 1, step: 0.05 }), check("noise", () => !!r.n, (v) => (r.n = v ? [9, 3, 0.5] : undefined), true)),
      r.n ? h("div.row", {}, num("freq", () => r.n[0], (v) => (r.n[0] = v), { step: 0.5 }), num("seed", () => r.n[1], (v) => (r.n[1] = Math.round(v)), { step: 1 }), num("above", () => r.n[2], (v) => (r.n[2] = v), { step: 0.02 })) : null,
      h("div.row", {}, h("span.dim", {}, "then"), matField(() => r.to, (v) => (r.to = v || "moss"), { label: "becomes" }), btn("✕", () => { touch(); rules.splice(i, 1); settle(); changed(true); }, { cls: "warn" })));
    return [
      section("Asset",
        h("div.f", {}, h("label", {}, "name (id)"), h("input", { value: d.name, on: { change: (e) => { const v = e.target.value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { toast("the id must be an identifier (letters, digits, _)"); e.target.value = d.name; return; } touch(); d.name = v; settle(); changed(true); } } })),
        h("div.f", {}, h("label", {}, "label"), h("input", { value: d.label || "", on: { change: (e) => { touch(); d.label = e.target.value; settle(); changed(true); } } })),
        num("scale k", () => d.k, (v) => (d.k = v), { min: 0.05, step: 0.05, structural: true }),
        // a flipbook of layers has one frame per layer: more frames copy the last one, fewer drop the end
        num("frames", () => d.frames, (v) => { d.frames = Math.max(1, Math.round(v)); if (Array.isArray(d.vox)) { while (d.vox.length < d.frames) d.vox.push(clone(d.vox[d.vox.length - 1] ?? null)); d.vox.length = d.frames; } S.frame = 0; }, { step: 1, min: 1, max: Array.isArray(d.vox) ? 64 : 16, structural: true }),
        h("p.dim", {}, `footprint r ${md ? r4(md.r) : "?"} · height h ${md ? r4(md.h) : "?"} (model units, derived from the content) · ${md ? r4(md.h * md.k) : "?"} tiles tall`),
        d.base ? check("keep " + d.base.model + "'s detail painting", () => d.inherit, (v) => (d.inherit = v), true) : null),
      section("Detail rules", h("p.dim", {}, "Repaint surface voxels by material, facing and noise (as the generator's detail functions do, e.g. moss on upward faces). First match wins; hand paint wins over rules."),
        ...rules.map(ruleRow), btn("+ Rule", () => { touch(); rules.push({ m: sel() ? sel().m : "", nz: 0.4, n: [9, 3, 0.5], to: "moss" }); settle(); changed(true); })),
      section("Save & export",
        h("div.row.wrap", {}, btn("Save to library", saveDoc, { cls: "pri", title: "Ctrl+S" }), btn("Preview in engine", previewEngine, { title: "opens the engine's ?gallery=studio lineup with this asset" })),
        h("div.row.wrap", {}, btn("Asset .json", () => SV.download(d.name + ".json", JSON.stringify(d, null, 1), "application/json")), btn("Engine script .js", () => SV.download(d.name + ".js", AF.toScript(d), "text/javascript")),
          btn("Pack of all studio assets", exportPack, { title: "assets/pack.js: every saved studio asset in one script" }), btn("MagicaVoxel .vox", exportVox), btn("PNG", exportPng)),
        h("p.dim", {}, "Engine use: put the .js in assets/ and load it after src/asset-format.js (index.html loads assets/pack.js). The model then exists as MODELS." + d.name + ", is baked as a volume and can be placed in a style's deco list."),
        SV.store.all()[d.name] ? btn("Delete from library", () => { if (confirm("Delete " + d.name + " from the studio library?")) { SV.store.remove(d.name); buildLibrary(); renderLib(); renderTop(); } }, { cls: "warn" }) : null),
    ];
  }
  function panelView() {
    const L = view.look, c = view.cam;
    const sl = (label, get, set, min, max, step) => h("div.f", {}, h("label", {}, label), h("input", { type: "range", min, max, step, value: get(), on: { input: (e) => { set(parseFloat(e.target.value)); applyLook(); } } }));
    return [
      section("Light (engine model lighting)",
        h("div.f", {}, h("label", {}, "preset"), h("select", { on: { change: (e) => { S.preset = e.target.value; applyLook(); } } }, Object.keys(PRESETS).map((p) => h("option", { selected: S.preset === p }, p)))),
        h("div.f", {}, h("label", {}, "style"), h("select", { on: { change: (e) => { S.styleId = e.target.value; buildStyle(); applyLook(); changed(true); } } }, window.STYLES.map((s) => h("option", { value: s.id, selected: S.styleId === s.id }, s.name || s.id)))),
        sl("canopy light", () => L.cook, (v) => (L.cook = v), 0, 1, 0.01), sl("sun azimuth", () => S.sunAz, (v) => (S.sunAz = v), -180, 180, 1), sl("sun elevation", () => S.sunEl, (v) => (S.sunEl = v), -30, 40, 1),
        sl("exposure", () => L.exposure, (v) => (L.exposure = v), 0.5, 1.8, 0.01),
        h("p.dim", {}, "Canopy light: 0 = deep canopy shade, 1 = standing in a sun pool (the engine's lightMod); 0.45 is neutral.")),
      section("Display",
        h("div.f", {}, h("label", {}, "show"), h("select", { on: { change: (e) => (L.mode = +e.target.value) } }, ["lit", "albedo", "normals", "AO", "material ids"].map((m, i) => h("option", { value: i, selected: L.mode === i }, m)))),
        sl("cube edges", () => L.faces, (v) => (L.faces = v), 0, 1, 0.05),
        h("label.chk", {}, h("input", { type: "checkbox", checked: L.ground, on: { change: (e) => (L.ground = e.target.checked) } }), "ground grid (tiles, 1 tile footprint)"),
        h("label.chk", {}, h("input", { type: "checkbox", checked: c.engine, on: { change: (e) => { c.engine = e.target.checked; renderRight(); } } }), "engine 2:1 projection (off: free orbit)"),
        !c.engine ? sl("pitch", () => c.pitch, (v) => (c.pitch = v), -85, 89, 1) : null,
        h("label.chk", {}, h("input", { type: "checkbox", checked: S.snap, on: { change: (e) => (S.snap = e.target.checked) } }), "snap handle drags to the voxel grid"),
        h("div.row.wrap", {}, btn("Frame (" + ME.keys.label("KeyF") + ")", fit), btn("⟲ 90° (" + ME.keys.label("Comma") + ")", () => view.cam.snap(-1)), btn("90° ⟳ (" + ME.keys.label("Period") + ")", () => view.cam.snap(1)))),
    ];
  }
  function renderTools() {
    const tb = $("#tools"), list = [["select", "Select", "KeyV"], ["add", "Add", "KeyA"], ["erase", "Erase", "KeyX"], ["paint", "Paint", "KeyP"], ["fill", "Fill", "KeyF"], ["pick", "Pick", "KeyI"]];
    tb.replaceChildren(...list.map(([id, l, k]) => h("button" + (S.tool === id ? ".on" : ""), { title: l + " (" + ME.keys.label(k) + ")", disabled: S.mode !== "doc" && id !== "select" && id !== "pick", on: { click: () => setTool(id) } }, l)),
      h("span.sep"), h("span.cur", { title: "current material" }, swatch(S.mat, 4), S.mat));
  }
  function setTool(t) { S.tool = t; hover = null; if (t !== "select" && S.tab === "shape" && S.mode === "doc") S.tab = "voxel"; renderRight(); }
  function renderStatus() {
    const s = $("#status"), n = frameCount();
    const tl = $("#timeline");
    tl.style.display = n > 1 ? "flex" : "none";
    if (n > 1) { $("#frame").max = n - 1; $("#frame").value = S.frame % n; $("#flabel").textContent = `frame ${(S.frame % n) + 1}/${n}`; $("#play").textContent = S.playing ? "❚❚" : "▶"; }
    if (!cur) return;
    s.replaceChildren(
      h("span", {}, `${cur.dims.join("×")} voxels`), h("span", {}, `${cur.solid.toLocaleString()} solid · ${cur.surf.toLocaleString()} surface`),
      h("span", { title: "occupied 8³ bricks: the asset's share of the engine's brick pool" }, `${cur.bricks} bricks (${Math.round((cur.bricks * 2048) / 1024)} KB)`),
      h("span", {}, `bake ${Math.round(cur.ms)} ms`), h("span", {}, `${pal.names.length - 1} materials`),
      ...(S.warn ? [h("span.warn", {}, S.warn)] : []));
  }
  let toastT = 0;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

  // ---------------------------------------------------------------- save / export / import
  function saveDoc() {
    if (S.mode !== "doc") return;
    try { AF.validate(S.doc); } catch (e) { toast(e.message); return; }
    if (!SV.store.save(clone(S.doc))) { toast("could not save (browser storage unavailable): use Asset .json"); return; }
    AF.register(clone(S.doc));
    buildLibrary(); renderLib(); renderTop(); toast("Saved " + S.doc.name + " to the studio library");
  }
  function exportPack() {
    const docs = Object.values(Object.assign({}, AF.docs, SV.store.all(), S.mode === "doc" ? { [S.doc.name]: S.doc } : {}));
    SV.download("pack.js", AF.toScript(docs), "text/javascript");
    toast(docs.length + " assets in pack.js: copy it to MossheartEngine/assets/");
  }
  function previewEngine() {
    if (!SV.store.preview([clone(S.doc)], S.doc.name)) { toast("browser storage unavailable: export the .js instead"); return; }
    window.open("../index.html?gallery=studio&units=0&preset=cosy&nocache=1", "_blank");
  }
  function exportPng() { view.render(performance.now() / 1000); view.cv.toBlob((b) => SV.download(((S.doc && S.doc.name) || (S.lib && S.lib.name) || "asset") + ".png", b), "image/png"); }
  function exportVox() {
    if (!cur) return;
    const [nx, ny, nz] = cur.dims, map = new Map(), palette = [], voxels = [];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const m = cur.rgba[((z * ny + y) * nx + x) * 4 + 3];
      if (!m) continue;
      if (!map.has(m)) { if (map.size >= 255) continue; map.set(m, map.size + 1); palette[map.size - 1] = [...baseColor(pal.names[m]), 255]; }
      voxels.push([x, y, z, map.get(m)]);
    }
    try { SV.download(((S.doc && S.doc.name) || S.lib.name) + ".vox", SV.writeVox(cur.dims, voxels, palette)); } catch (e) { toast(e.message); }
  }
  // .vox -> a studio asset whose voxel layer holds the model, one material per colour, centred on the tile
  function docFromVox(name, vx, vpt = 16) {
    const cells = new Map(), mats = {}, used = new Map();
    for (const [x, y, z, ci] of vx.voxels) {
      let m = used.get(ci);
      if (!m) { const c = vx.palette[ci - 1] || [200, 200, 200], hex = P.toHex(c.slice(0, 3)).slice(1); m = "v" + hex; used.set(ci, m); mats[m] = { ramp: SV.rampFor(c.slice(0, 3)) }; }
      cells.set(AF.key(x - Math.floor(vx.size[0] / 2), y - Math.floor(vx.size[1] / 2), z), m);
    }
    const k = 1;
    return AF.normalize({ name, label: name, k, grid: vpt * k, prims: [], vox: AF.cellsLayer(cells), mats, frames: 1 });
  }
  async function importFile() {
    const f = await SV.pickFile(".json,.js,.vox");
    if (!f) return;
    try {
      if (/\.vox$/i.test(f.name)) {
        const vx = SV.readVox(await f.arrayBuffer()), name = uniqueName(f.name.replace(/\.vox$/i, "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") || "vox");
        openDoc(docFromVox(name, vx));
        toast(`Imported ${vx.voxels.length.toLocaleString()} voxels (${vx.size.join("×")}) as ${name}`);
        return;
      }
      const text = await f.text();
      let docs = [];
      if (/\.js$/i.test(f.name)) { const re = /MossAsset\.register\((\{[\s\S]*?\})\);\s*$/gm; let m; while ((m = re.exec(text))) docs.push(JSON.parse(m[1])); }
      else docs = [JSON.parse(text)];
      if (!docs.length) throw new Error("no MossAsset.register(...) calls found");
      docs.forEach((d) => AF.validate(AF.normalize(d)));
      if (docs.length > 1) { docs.forEach((d) => SV.store.save(AF.normalize(d))); buildLibrary(); renderLib(); toast(docs.length + " assets added to the studio library"); }
      openDoc(docs[0]);
    } catch (e) { toast("import failed: " + e.message); }
  }

  // ---------------------------------------------------------------- keys and loop
  function bindKeys() {
    ME.keys.onChange(() => renderRight()); // the buttons show the keys in the user's layout
    window.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === "z") { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; }
      if (ctrl && k === "y") { e.preventDefault(); undo(1); return; }
      if (ctrl && k === "s") { e.preventDefault(); saveDoc(); return; }
      if (ctrl && k === "d") { e.preventDefault(); primOp("dup"); return; }
      if (ctrl) return;
      // the rest by position (ME.keys: the labels follow the user's layout); named keys by name
      const c = ME.keys.code(e);
      if (k === " ") { e.preventDefault(); if (frameCount() > 1) { S.playing = !S.playing; renderStatus(); } else S.space = true; return; }
      const tools = { KeyV: "select", KeyA: "add", KeyX: "erase", KeyP: "paint", KeyF: S.mode === "doc" && S.tool !== "select" ? "fill" : null, KeyI: "pick" };
      if (c === "KeyF" && !tools.KeyF) { fit(); return; }
      if (tools[c] && (S.mode === "doc" || c === "KeyV" || c === "KeyI")) { setTool(tools[c]); return; }
      if (k === "home") fit();
      if (c === "Comma" || c === "KeyQ") view.cam.snap(-1);
      if (c === "Period" || c === "KeyE") view.cam.snap(1);
      if (k === "delete" || k === "backspace") primOp("del");
      if (c === "BracketLeft") { S.brush = Math.max(0, S.brush - 1); renderRight(); }
      if (c === "BracketRight") { S.brush = Math.min(12, S.brush + 1); renderRight(); }
      if (k === "escape") { S.sel = -1; view.setFlags(flagOf); renderRight(); }
    });
    window.addEventListener("keyup", (e) => { if (e.key === " ") S.space = false; });
  }
  let lastFrameT = 0, lastBakeT = 0;
  function loop(now) {
    view.resize();
    view.cam.update(now);
    if (S.playing && now - lastFrameT > 1000 / 6) { S.frame = (S.frame + 1) % frameCount(); lastFrameT = now; needsBake = true; }
    // while dragging a slow model, rebake at most every 80 ms
    if (needsBake && (!S.dragging || now - lastBakeT > Math.min(250, 40 + S.bakeMs))) { needsBake = false; lastBakeT = now; refresh(); if (S.dragging) renderStatus(); }
    view.render(now / 1000);
    drawOverlay();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    view = new SV.View($("#cv"));
    overlay = $("#ov"); octx = overlay.getContext("2d");
    buildStyle(); buildLibrary();
    const dl = h("datalist#matlist"); dl.id = "matlist";
    dl.append(...Object.keys(st.ramps).sort().map((n) => h("option", { value: n })));
    document.body.append(dl);
    applyLook();
    bindViewport(); bindKeys();
    $("#search").addEventListener("input", (e) => { S.search = e.target.value; renderLib(); });
    $("#b-new").onclick = newDoc; $("#b-open").onclick = importFile; $("#b-undo").onclick = () => undo(-1); $("#b-redo").onclick = () => undo(1);
    $("#b-save").onclick = saveDoc; $("#b-preview").onclick = previewEngine; $("#b-fork").onclick = fork;
    $("#play").onclick = () => { S.playing = !S.playing; renderStatus(); };
    $("#frame").oninput = (e) => { S.frame = +e.target.value; S.playing = false; needsBake = true; };
    ME.app = { S, view, AF, get pal() { return pal; }, get st() { return st; }, get cur() { return cur; }, refresh, step: () => { refresh(); renderRight(); view.resize(); view.render(1); drawOverlay(); }, openLib, openDoc, fork, newDoc, applyTool, docFromVox, bake, owners, buildLibrary, changed, syncTables, newPalette, installDocMats, toast };
    // ?live=1: live mode (studio/live.js) takes the viewport, with its own loop and its own ?selftest=1
    if (ME.qn("live", 0)) return SV.live.boot(ME.app);
    // restore the last session, else open the Koke Garden Heart Tree
    const last = SV.store.current(), q = ME.q("model", "");
    try {
      if (q) openLib({ name: q, label: q, o: JSON.parse(ME.q("o", "{}")), frames: +ME.q("frames", FRAMES[q] || 1) });
      else if (last && last.mode === "doc" && last.doc) openDoc(last.doc);
      else if (last && last.lib && window.MODELS[last.lib.name]) openLib(last.lib);
      else openLib({ name: window.MODELS.ms_heart ? "ms_heart" : "kg_heart", label: "heart", o: {}, frames: FRAMES.ms_heart || 1 });
    } catch (e) { openLib({ name: window.MODELS.ms_heart ? "ms_heart" : "kg_heart", label: "heart", o: {}, frames: FRAMES.ms_heart || 1 }); }
    if (ME.qn("selftest", 0)) return selftest();
    if (ME.params.has("shots")) return shots();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- headless checks (tools/run.ps1 -Page studio/index.html)
  async function selftest() {
    const R = { ok: true, checks: {}, errors: ME.errors };
    const check = (name, cond, info) => { R.checks[name] = cond ? (info ?? true) : { fail: info ?? false }; if (!cond) R.ok = false; };
    // same voxels (material, normal, AO) at the same absolute positions, whatever the boxes
    const voxSet = (v) => { const m = new Map(), [nx, ny, nz] = v.dims; for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) if (v.rgba[i * 4 + 3]) m.set(AF.key(v.box[0] + x, v.box[1] + y, v.box[2] + z), v.rgba.slice(i * 4, i * 4 + 4).join()); return m; };
    const sameGrid = (a, b) => { const A = voxSet(a), B = voxSet(b); if (A.size !== B.size) return false; for (const [k, v] of A) if (B.get(k) !== v) return false; return true; };
    try {
      // 1. every library model bakes
      const t0 = performance.now(), fails = [];
      let n = 0;
      for (const g of LIB) for (const it of g.items) {
        if (it.kind !== "model") continue;
        try { S.mode = "lib"; S.lib = { name: it.name, o: it.o, frames: 1, fine: it.fine || 1, chunk: 1 }; S.version++; const v = bake(0); if (!v.solid) fails.push(it.label + ": empty"); n++; } catch (e) { fails.push(it.label + ": " + e.message); }
      }
      check("library_bakes", fails.length === 0, { models: n, ms: Math.round(performance.now() - t0), fails });
      // 2. a forked model bakes voxel-identical to the original (prims + inherited detail)
      for (const name of ["kg_puff", "sc_thorn", "hs_moth", "ms_thorn", "ms_spirit", "squirrel", "lantern"]) {
        if (!window.MODELS[name]) continue;
        const md = ME.modelOf(name, {}), a = ME.voxelizeModel(md, VS, pal), doc = AF.fromModel(name, {}, { name: "t_" + name, k: md.k }), b = ME.voxelizeModel(AF.build(doc), VS, pal);
        check("fork_identical_" + name, sameGrid(a, b), { prims: doc.prims.length, solid: [a.solid, b.solid] });
      }
      // 3. voxel layer: added cells appear, erased cells vanish, paint recolours (grid aligned)
      const doc = AF.normalize({ name: "t_layer", k: 1, prims: [{ t: "B", p: [0, 0, 0.25], s: [0.25, 0.25, 0.25], m: "stone" }] });
      const cells = new Map();
      for (let x = 0; x < 3; x++) cells.set(AF.key(x, 0, 10), "moss");
      cells.set(AF.key(0, 0, 3), 255);
      doc.vox = AF.cellsLayer(cells);
      doc.paint = { mats: ["maple"], cells: [-1, -1, 7, 0] };
      const v = ME.voxelizeModel(AF.build(doc), VS, pal), at = (i, j, k) => { const x = i - v.box[0], y = j - v.box[1], z = k - v.box[2]; return x < 0 || y < 0 || z < 0 || x >= v.dims[0] || y >= v.dims[1] || z >= v.dims[2] ? 0 : v.rgba[((z * v.dims[1] + y) * v.dims[0] + x) * 4 + 3]; };
      check("layer_add", [0, 1, 2].every((x) => pal.names[at(x, 0, 10)] === "moss") && !at(3, 0, 10) && !at(0, 0, 11), [0, 1, 2, 3].map((x) => pal.names[at(x, 0, 10)]));
      check("layer_erase", at(0, 0, 3) === 0 && at(1, 0, 3) !== 0);
      check("paint", pal.names[at(-1, -1, 7)] === "maple", pal.names[at(-1, -1, 7)]);
      // 4. mirror and motion
      const dm = AF.normalize({ name: "t_mir", k: 1, frames: 4, prims: [{ t: "S", p: [0, 0.2, 0.3], r: 0.08, m: "stone", mir: true, mv: [0, 0, 0.1] }] });
      const m0 = AF.build(dm, { t: 0 }), m1 = AF.build(dm, { t: 0.25 });
      check("mirror", m0.prims.length === 2 && m0.prims[1].y === -0.2);
      check("motion", Math.abs(m1.prims[0].z - 0.4) < 1e-9, m1.prims[0].z);
      // 5. rotation round trip
      const rot = [20, -35, 70], back = AF.rotOf(AF.rotRows(rot));
      check("rotation_roundtrip", back.every((a, i) => Math.abs(a - rot[i]) < 1e-3), back);
      // 6. .vox round trip and import
      const vx = { size: [4, 3, 2], voxels: [[0, 0, 0, 1], [3, 2, 1, 2], [1, 1, 0, 1]], palette: Array.from({ length: 256 }, (_, i) => [i, 255 - i, 128, 255]) };
      const rd = SV.readVox(SV.writeVox(vx.size, vx.voxels, vx.palette));
      check("vox_roundtrip", rd.size.join() === "4,3,2" && JSON.stringify(rd.voxels) === JSON.stringify(vx.voxels) && rd.palette[1].join() === "1,254,128,255");
      const vd = docFromVox("t_vox", rd), vv = ME.voxelizeModel(AF.build(vd), VS, pal);
      check("vox_import", vv.solid === 3, { solid: vv.solid, mats: Object.keys(vd.mats) });
      // 7. engine script round trip
      const d2 = AF.normalize(clone(doc));
      d2.name = "t_script";
      const code = AF.toScript(d2);
      new Function(code)();
      check("script_register", !!window.MODELS.t_script && sameGrid(ME.voxelizeModel(window.MODELS.t_script({}), VS, pal), v));
      // 7b. a flipbook of voxel layers (vox as an array): each frame bakes to exactly its layer's cells and
      //     materials at vs = grid, r / h are the same at every t, register makes it a 3-frame flipbook
      const FG = 32, flips = [];
      for (let f = 0; f < 3; f++) {
        const cs = new Map();
        for (let z = 0; z < 4 + 3 * f; z++) for (let y = -2; y < 2; y++) for (let x = f - 3; x < 3; x++) cs.set(AF.key(x, y, z), (x + y + z) % 3 ? "stone" : "moss");
        cs.set(AF.key(5, 5, 9 * f), "maple"); // a lone cell that moves up
        flips.push(cs);
      }
      const fd = AF.normalize({ name: "t_flip", k: 1, grid: FG, prims: [], vox: flips.map(AF.cellsLayer), fps: 8 });
      check("flip_frames", fd.frames === 3, fd.frames);
      const flipBakes = flips.map((cs, f) => {
        const fv = ME.voxelizeModel(AF.build(fd, { t: f / 3 }), FG, pal), [nx, ny, nz] = fv.dims;
        let bad = 0;
        for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) if (fv.rgba[i * 4 + 3] && pal.names[fv.rgba[i * 4 + 3]] !== cs.get(AF.key(fv.box[0] + x, fv.box[1] + y, fv.box[2] + z))) bad++;
        return { solid: fv.solid, cells: cs.size, bad };
      });
      check("flip_layers_exact", flipBakes.every((b) => b.solid === b.cells && !b.bad), flipBakes);
      const fb = [0, 1, 2].map((f) => AF.build(fd, { t: f / 3 }));
      check("flip_union_bounds", fb.every((m) => m.r === fb[0].r && m.h === fb[0].h), fb.map((m) => [r4(m.r), r4(m.h)]));
      AF.register(clone(fd));
      check("flip_register", !!window.MODELS.t_flip && ME.FRAMES.t_flip === 3, ME.FRAMES.t_flip);
      // 8. the editor round: open, edit through the tools, undo, render
      openDoc(doc); refresh();
      const before = cur.solid;
      const pk = { cell: null, ground: [0.6, 0.6, 0] };
      S.mat = "maple"; applyTool(pk, "add"); settle(); refresh();
      check("tool_add_on_ground", cur.solid === before + 1, [before, cur.solid]);
      undo(-1); refresh();
      check("undo", cur.solid === before, cur.solid);
      view.resize(); view.render(1);
      const gl = view.gl;
      check("webgl", gl.getError() === 0);
      S.sel = 0; refresh();
      check("owners", view.cells.some((i) => own[i] === 0));
      // the voxel tools edit the shown frame's layer of a flipbook, and only that one; a stroke that
      // crosses a frame tick writes only its own cell into the new frame (not the old frame's cells)
      openDoc(fd); S.frame = 1; refresh(); layer = null;
      const was = clone(S.doc.vox);
      applyTool({ cell: null, ground: [0.6, 0.6, 0] }, "add");
      S.frame = 2;
      applyTool({ cell: null, ground: [-0.6, -0.6, 0] }, "add"); settle(); layer = null;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), keys = (l) => new Set(AF.layerCells(l).keys());
      const k1 = keys(S.doc.vox[1]), k2 = keys(S.doc.vox[2]), w1 = keys(was[1]), w2 = keys(was[2]);
      check("flip_edit_frame", same(S.doc.vox[0], was[0]) && k1.size === w1.size + 1 && [...w1].every((k) => k1.has(k)) && k2.size === w2.size + 1 && [...w2].every((k) => k2.has(k)), { frame1: [w1.size, k1.size], frame2: [w2.size, k2.size] });
      // a stroke pauses playback
      S.playing = true; setTool("add"); refresh(); fit();
      const rc = view.cv.getBoundingClientRect(), pt = view.project([0.6, 0.6, 0]);
      for (const type of ["pointerdown", "pointerup"]) view.cv.dispatchEvent(new PointerEvent(type, { clientX: rc.left + pt[0], clientY: rc.top + pt[1], bubbles: true, pointerId: 8, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true }));
      check("stroke_pauses_playback", !S.playing);
      setTool("select"); S.frame = 0;
      // 9. pointer flow on the real canvas: click a shape to select it, drag its move handle, add a voxel
      //    with the add tool, undo with Ctrl+Z
      newDoc(); refresh(); fit();
      const rect = view.cv.getBoundingClientRect(), K = S.doc.k;
      const fire = (type, x, y) => view.cv.dispatchEvent(new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, pointerId: 7, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true }));
      const click = (s) => { fire("pointerdown", s[0], s[1]); fire("pointerup", s[0], s[1]); };
      setTool("select"); S.sel = -1;
      click(view.project(add3(mul3(S.doc.prims[1].p, K), [0, 0, S.doc.prims[1].r * K * 0.5])));
      check("ui_click_select", S.sel === 1, S.sel);
      const hs = view.project(handles()[0].pos), p0 = S.doc.prims[1].p.slice();
      fire("pointerdown", hs[0], hs[1]); fire("pointermove", hs[0] + 40, hs[1]); fire("pointerup", hs[0] + 40, hs[1]);
      check("ui_drag_handle", Math.abs(S.doc.prims[1].p[0] - p0[0]) + Math.abs(S.doc.prims[1].p[1] - p0[1]) > 0.02, S.doc.prims[1].p);
      refresh();
      const solid0 = cur.solid;
      setTool("add");
      click(view.project(add3(mul3(S.doc.prims[1].p, K), [0, 0, S.doc.prims[1].r * K * 0.97])));
      refresh();
      check("ui_add_voxel", !!S.doc.vox && cur.solid > solid0, [solid0, cur.solid]);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
      refresh();
      check("ui_undo_key", !S.doc.vox && cur.solid === solid0, cur.solid);
      renderRight();
      check("ui_panels", ["shape", "voxel", "mats", "asset", "view"].every((t) => { S.tab = t; renderRight(); return $("#panel").children.length > 0; }));
    } catch (e) { R.ok = false; R.error = e.stack || e.message; }
    R.ok = R.ok && ME.errors.length === 0;
    $("#result").textContent = JSON.stringify(R, null, 1);
    document.title = "SELFTEST DONE";
  }
  // ?shots=model[@o-json],... or doc:<name>: one viewport PNG each (deterministic, no animation)
  async function shots() {
    const out = [];
    for (const name of ME.q("shots").split(",")) {
      if (name === "ui") { out.push("NOTE use -Snap for page screenshots"); continue; }
      if (name.startsWith("doc:")) openDoc(AF.docs[name.slice(4)] || SV.store.all()[name.slice(4)]);
      else openLib({ name, label: name, o: {}, frames: 1 });
      refresh(); fit(); view.resize(); fit(); view.render(1);
      out.push("FILE studio-" + name.replace(/[^a-z0-9_.-]+/gi, "_") + ".png " + view.cv.toDataURL("image/png").split(",")[1]);
    }
    $("#result").textContent = out.join("\n") + "\nERRORS " + ME.errors.length + "\n" + ME.errors.join("\n") + "\nDONE";
  }

  window.addEventListener("load", () => { try { boot(); } catch (e) { ME.err("BOOT", e.stack || e.message); $("#result").textContent = JSON.stringify({ ok: false, error: e.stack || e.message }); document.body.classList.add("failed"); $("#fail").textContent = e.message; } });
})();
