/* Mossheart asset format v1: voxel assets as data, registered as generator models.
   A document holds SDF primitives (the generator's S/E/C/B/Y with blend, carve, rotation, displacement,
   mirror and a looping motion), a voxel layer (cells added and erased by hand, or imported from .vox),
   per-voxel paint, material detail rules and its own materials. MossAsset.build(doc, o) turns it into an
   ordinary model { prims, r, h, k, detail } at animation phase o.t, so the engine voxeliser (src/sdf.js)
   bakes it like any MODELS entry. Voxel layers become one function primitive (k: 5, see src/sdf.js).
   Same conventions as the generator's models: tile units, Z up, facing +X, anchor at the ground centre,
   prims authored at scale 1 and drawn at doc.k. Needs PX (vendor/gen); ME is optional (volume deco,
   point-light colours). The studio (studio/) edits these documents; MossAsset.register(doc) loads one.

   doc = { format: "mossheart-asset", version: 1, name, label, k, r?, h?, frames, grid, fps?,
           prims: [prim], vox?: layer or [layer per frame], paint?: { mats, cells: [i, j, k, mi, ...] }, rules?: [rule],
           base?: { model, o }, inherit?: bool, mats?: { name: material } }
   prim  = { t: "S"|"E"|"C"|"B"|"Y", p: [x, y, z], m, name?, hide?,
             S: r · E: s (radii) · C: b (end point), ra, rb · B: s (half sizes), r (rounding) · Y: r, hh, rr,
             rot?: [x, y, z] degrees (not C), k2? (smooth blend), sub?, subm?, disp?, df?, mir? (mirror in y),
             mv?: [dx, dy, dz], mr?: [x, y, z] degrees, ph? (motion: offset * sin(2 pi (t + ph))) }
   layer = { o: [i, j, k], n: [nx, ny, nz], mats: [name], rle: [value, count, ...] } in cells of 1 / grid
           model units; value 0 = untouched, 1..254 = mats[value - 1], 255 = erased. vox as an array is a
           flipbook: frames = its length, phase t shows vox[floor(t * frames + 1e-6) % frames] (null: no cells),
           r / h come from the union of all its layers, and fps (optional) is the rate the studio plays at.
   rule  = { m?: material or "" (any), nz?: min normal z, n?: [freq, seed, threshold], to: material }
   material = { ramp: [hex, steps, darkL, lightL, hueShift?, sat?] or [hex, ...], em?, cls?, wrap?, bias?, light?: [r, g, b, k] } */
(function () {
  const P = window.PX, { S, E, C, B, Y } = P.prim, TAU = Math.PI * 2, D2R = Math.PI / 180;
  const AF = (window.MossAsset = { FORMAT: "mossheart-asset", VERSION: 1, docs: {}, ramps: {}, mats: {} });
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  // ---------------------------------------------------------------- rotation
  // rot (degrees) is the object rotation Rz * Ry * Rx (local to world); prims take world-to-local rows.
  AF.rotRows = (rot) => {
    const [a, b, g] = rot.map((v) => v * D2R), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    const Q = [cg * cb, cg * sb * sa - sg * ca, cg * sb * ca + sg * sa, sg * cb, sg * sb * sa + cg * ca, sg * sb * ca - cg * sa, -sb, cb * sa, cb * ca];
    return [Q[0], Q[3], Q[6], Q[1], Q[4], Q[7], Q[2], Q[5], Q[8]]; // transpose
  };
  AF.rotOf = (R) => {
    const Q = (i, j) => R[j * 3 + i], sb = -Q(2, 0);
    if (Math.abs(sb) > 0.99999) return [0, Math.sign(sb) * 90, Math.atan2(-Q(0, 1), Q(1, 1)) / D2R];
    return [Math.atan2(Q(2, 1), Q(2, 2)) / D2R, Math.asin(sb) / D2R, Math.atan2(Q(1, 0), Q(0, 0)) / D2R];
  };
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  const hasRot = (r) => r && (r[0] || r[1] || r[2]);
  const applyRows = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const applyCols = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

  // ---------------------------------------------------------------- prims
  // One document prim at phase t -> one or two generator prims (the mirror copy reflects y).
  function compilePrim(q, t, out, src) {
    const w = q.mv || q.mr ? Math.sin(TAU * (t + (q.ph || 0))) : 0;
    const p = q.mv ? add(q.p, mul(q.mv, w)) : q.p;
    const rot = q.mr ? [0, 1, 2].map((i) => ((q.rot && q.rot[i]) || 0) + q.mr[i] * w) : q.rot;
    const o = {};
    if (q.k2) o.k2 = q.k2;
    if (q.sub) { o.sub = true; if (q.subm) o.subm = q.subm; }
    if (q.disp) { o.disp = q.disp; o.df = q.df || 8; }
    let pr;
    if (q.t === "C") {
      // capsules are oriented by their end points; motion rotates the end about the start
      let b = q.mv ? add(q.b, mul(q.mv, w)) : q.b;
      if (hasRot(q.mr)) b = add(p, applyCols(AF.rotRows(q.mr.map((v) => v * w)), [b[0] - p[0], b[1] - p[1], b[2] - p[2]]));
      pr = C(p, b, q.ra, q.rb, q.m, o);
    } else {
      if (hasRot(rot)) o.R = AF.rotRows(rot);
      if (q.t === "S") pr = S(p, q.r, q.m, o);
      else if (q.t === "E") pr = E(p, q.s, q.m, o);
      else if (q.t === "B") pr = B(p, q.s, q.r || 0, q.m, o);
      else { if (q.rr) o.round = q.rr; pr = Y(p, q.r, q.hh, q.m, o); }
    }
    pr._src = src;
    out.push(pr);
    if (q.mir) {
      // d'(x) = d(Sx), S = diag(1, -1, 1): centre mirrored, R' = R S (rotated prims) or b mirrored (capsules)
      const m = Object.assign({}, pr, { y: -pr.y });
      if (pr.R) m.R = pr.R.map((v, i) => (i % 3 === 1 ? -v : v));
      if (q.t === "C") m.by = -pr.by;
      out.push(m);
    }
  }

  // Bounding radius of a document prim about its centre, motion included (for auto r / h).
  function primExtent(q) {
    let r;
    if (q.t === "S") r = q.r;
    else if (q.t === "E") r = Math.max(...q.s);
    else if (q.t === "B") r = Math.hypot(...q.s) + (q.r || 0);
    else if (q.t === "Y") r = Math.hypot(q.r, q.hh);
    else r = Math.max(q.ra, q.rb);
    return r + (q.disp || 0) * 0.5 + (q.mv ? Math.hypot(...q.mv) : 0);
  }

  // ---------------------------------------------------------------- voxel layers
  AF.rleEncode = (vals) => {
    const out = [];
    for (let i = 0; i < vals.length; ) { const v = vals[i]; let n = 1; while (i + n < vals.length && vals[i + n] === v) n++; out.push(v, n); i += n; }
    return out;
  };
  AF.rleDecode = (rle, N) => {
    const vals = new Uint8Array(N);
    let i = 0;
    for (let k = 0; k < rle.length; k += 2) { vals.fill(rle[k], i, i + rle[k + 1]); i += rle[k + 1]; }
    return vals;
  };
  // layer -> Map(cellKey -> value) and back (cell keys from AF.key)
  AF.key = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  AF.unkey = (c) => [Math.floor(c / 1048576) - 512, (Math.floor(c / 1024) % 1024) - 512, (c % 1024) - 512];
  AF.layerCells = (L) => {
    const cells = new Map();
    if (!L) return cells;
    const [nx, ny, nz] = L.n, vals = AF.rleDecode(L.rle, nx * ny * nz);
    for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) {
      const v = vals[i];
      if (v) cells.set(AF.key(L.o[0] + x, L.o[1] + y, L.o[2] + z), v === 255 ? 255 : L.mats[v - 1]);
    }
    return cells;
  };
  // cells: Map(key -> material name | 255 erased) -> layer (or null when empty)
  AF.cellsLayer = (cells) => {
    if (!cells.size) return null;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], mats = [], mi = {};
    for (const [c, v] of cells) {
      const q = AF.unkey(c);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], q[a]); mx[a] = Math.max(mx[a], q[a]); }
      if (v !== 255 && mi[v] === undefined) { if (mats.length >= 254) throw new Error("a voxel layer holds at most 254 materials"); mi[v] = mats.length; mats.push(v); }
    }
    const n = [0, 1, 2].map((a) => mx[a] - mn[a] + 1), vals = new Uint8Array(n[0] * n[1] * n[2]);
    for (const [c, v] of cells) { const q = AF.unkey(c); vals[((q[2] - mn[2]) * n[1] + q[1] - mn[1]) * n[0] + q[0] - mn[0]] = v === 255 ? 255 : mi[v] + 1; }
    return { o: mn, n, mats, rle: AF.rleEncode(vals) };
  };

  // Squared Euclidean distance transform (Felzenszwalb) along one line of the grid.
  function edt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  function edt3(feat, N) {
    const [nx, ny, nz] = N, g = new Float64Array(nx * ny * nz), m = Math.max(nx, ny, nz);
    const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    for (let i = 0; i < g.length; i++) g[i] = feat[i] ? 0 : 1e20;
    const pass = (n, stride, starts) => { for (const s0 of starts) { for (let q = 0; q < n; q++) f[q] = g[s0 + q * stride]; edt1(f, n, d, v, z); for (let q = 0; q < n; q++) g[s0 + q * stride] = d[q]; } };
    const lines = (fixA, nA, fixB, nB, sA, sB) => { const o = []; for (let b = 0; b < nB; b++) for (let a = 0; a < nA; a++) o.push(a * sA + b * sB); return o; };
    pass(nx, 1, lines(0, ny, 0, nz, nx, nx * ny));
    pass(ny, nx, lines(0, nx, 0, nz, 1, nx * ny));
    pass(nz, nx * ny, lines(0, nx, 0, ny, 1, nx));
    return g;
  }

  // A voxel layer's cells (value test sel) as a signed distance prim. The field is sampled at cell
  // centres (trilinear between them): -(distance to the nearest empty centre - 0.5) inside,
  // distance to the nearest solid centre - 0.5 near the surface, growing to the conservative
  // distance - 0.866 further out so the voxeliser's empty-brick test stays safe.
  const PAD = 3;
  function layerPrim(L, vals, g, sel, names) {
    const [nx, ny, nz] = L.n, NX = nx + 2 * PAD, NY = ny + 2 * PAD, NZ = nz + 2 * PAD, N = NX * NY * NZ;
    const solid = new Uint8Array(N), empty = new Uint8Array(N).fill(1), mat = new Uint8Array(N);
    let count = 0;
    for (let z = 0, i = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) {
      if (!sel(vals[i])) continue;
      const j = ((z + PAD) * NY + y + PAD) * NX + x + PAD;
      solid[j] = 1; empty[j] = 0; mat[j] = vals[i]; count++;
    }
    if (!count) return null;
    const dout = edt3(solid, [NX, NY, NZ]), din = edt3(empty, [NX, NY, NZ]), fld = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (solid[i]) { fld[i] = -(Math.sqrt(din[i]) - 0.5); continue; }
      const D = Math.sqrt(dout[i]);
      fld[i] = D - 0.5 - 0.366 * Math.min(1, Math.max(0, D - 1));
    }
    // material near each empty cell: any solid 26-neighbour (the voxeliser only asks near the surface)
    const near = mat.slice();
    for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
      const i = (z * NY + y) * NX + x;
      if (near[i]) continue;
      search: for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const m = mat[i + (c * NY + b) * NX + a]; if (m) { near[i] = m; break search; } }
    }
    const ox = L.o[0] - PAD + 0.5, oy = L.o[1] - PAD + 0.5, oz = L.o[2] - PAD + 0.5, ig = 1 / g, first = names(mat.find((m) => m));
    const pr = { k: 5, x: 0, y: 0, z: 0, m: first, cells: count };
    pr.f = (dx, dy, dz) => {
      const u = dx * g - ox, v = dy * g - oy, w = dz * g - oz;
      if (u < 0 || v < 0 || w < 0 || u > NX - 1 || v > NY - 1 || w > NZ - 1) {
        const ex = Math.max(-u, 0, u - NX + 1), ey = Math.max(-v, 0, v - NY + 1), ez = Math.max(-w, 0, w - NZ + 1);
        pr.m = first;
        return (Math.hypot(ex, ey, ez) + 1) * ig;
      }
      const x0 = Math.min(NX - 2, u | 0), y0 = Math.min(NY - 2, v | 0), z0 = Math.min(NZ - 2, w | 0), fx = u - x0, fy = v - y0, fz = w - z0;
      const i = (z0 * NY + y0) * NX + x0, sy = NX, sz = NX * NY;
      const c00 = fld[i] + (fld[i + 1] - fld[i]) * fx, c10 = fld[i + sy] + (fld[i + sy + 1] - fld[i + sy]) * fx;
      const c01 = fld[i + sz] + (fld[i + sz + 1] - fld[i + sz]) * fx, c11 = fld[i + sz + sy] + (fld[i + sz + sy + 1] - fld[i + sz + sy]) * fx;
      const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
      const m = near[((Math.round(w) * NY + Math.round(v)) * NX + Math.round(u))];
      pr.m = m ? names(m) : first;
      return (c0 + (c1 - c0) * fz) * ig;
    };
    return pr;
  }

  // Compiled voxel layer prims, cached on the layer object (the studio replaces the object on edit).
  const layerCache = new WeakMap();
  function layerPrims(L, g) {
    const hit = layerCache.get(L);
    if (hit && hit.g === g) return hit.prims;
    const vals = AF.rleDecode(L.rle, L.n[0] * L.n[1] * L.n[2]), prims = [];
    const erase = layerPrim(L, vals, g, (v) => v === 255, () => null);
    if (erase) { erase.sub = true; erase.m = null; erase._src = -2; prims.push(erase); }
    const solid = layerPrim(L, vals, g, (v) => v > 0 && v < 255, (v) => L.mats[v - 1]);
    if (solid) { solid._src = -1; prims.push(solid); }
    layerCache.set(L, { g, prims });
    return prims;
  }

  // ---------------------------------------------------------------- build
  // every voxel layer (all frames', so the scan box is the same at every t) and the one shown at phase t
  AF.voxLayers = (doc) => (Array.isArray(doc.vox) ? doc.vox : [doc.vox]).filter(Boolean);
  AF.voxAt = (doc, t = 0) => {
    const v = doc.vox, n = Array.isArray(v) ? v.length : 0;
    return (Array.isArray(v) ? (n ? v[((Math.floor(t * n + 1e-6) % n) + n) % n] : null) : v) || null; // t < 0 wraps too
  };
  AF.grid = (doc) => doc.grid || 16 * (doc.k || 1);
  AF.build = function (doc, o = {}) {
    const t = o.t ?? 0, prims = [], g = AF.grid(doc);
    doc.prims.forEach((q, i) => { if (!q.hide) compilePrim(q, t, prims, i); });
    const L = AF.voxAt(doc, t);
    if (L) prims.push(...layerPrims(L, g));
    // r / h: the voxeliser scans a box of 1.6 r x 1.45 h around the anchor, so derive them from the content
    let R = 0.05, H = 0.05;
    for (const q of doc.prims) {
      if (q.hide || q.sub) continue;
      const e = primExtent(q), pts = q.t === "C" ? [q.p, q.b] : [q.p];
      for (const pt of pts) { R = Math.max(R, Math.abs(pt[0]) + e, Math.abs(pt[1]) + e); H = Math.max(H, pt[2] + e); }
    }
    for (const L of AF.voxLayers(doc)) {
      const lo = L.o.map((v) => v / g), hi = L.o.map((v, a) => (v + L.n[a]) / g);
      R = Math.max(R, -lo[0], hi[0], -lo[1], hi[1]); H = Math.max(H, hi[2]);
    }
    // a set r / h (kept from a forked model: the game sizes proxies and cameras by them) grows only when the
    // content would leave the scanned box (1.6 r, 1.45 h)
    const md = { prims, r: doc.r ? Math.max(doc.r, R / 1.6) : R, h: doc.h ? Math.max(doc.h, H / 1.45) : H, k: doc.k || 1 };
    const detail = makeDetail(doc, g);
    if (detail) md.detail = detail;
    return md;
  };

  const pcache = new WeakMap();
  function paintMap(paint) {
    let m = pcache.get(paint);
    if (m) return m;
    m = new Map();
    const c = paint.cells;
    for (let i = 0; i < c.length; i += 4) m.set(AF.key(c[i], c[i + 1], c[i + 2]), paint.mats[c[i + 3]]);
    pcache.set(paint, m);
    return m;
  }
  function makeDetail(doc, g) {
    const paint = doc.paint && doc.paint.cells.length ? paintMap(doc.paint) : null;
    const rules = doc.rules && doc.rules.length ? doc.rules : null;
    let baseDetail = null;
    if (doc.inherit && doc.base && window.MODELS[doc.base.model]) {
      try { baseDetail = window.MODELS[doc.base.model](Object.assign({}, doc.base.o)).detail || null; } catch (e) { baseDetail = null; }
    }
    if (!paint && !rules && !baseDetail) return null;
    return (x, y, z, m, nx, ny, nz) => {
      if (paint) { const v = paint.get(AF.key(Math.floor(x * g), Math.floor(y * g), Math.floor(z * g))); if (v) return v; }
      if (rules) for (const r of rules) {
        if (r.m && r.m !== m) continue;
        if (r.nz !== undefined && r.nz !== null && nz <= r.nz) continue;
        if (r.n && P.noise(x * r.n[0], y * r.n[0], z * r.n[0], r.n[1]) <= r.n[2]) continue;
        return r.to;
      }
      return baseDetail ? baseDetail(x, y, z, m, nx, ny, nz) : m;
    };
  }

  // ---------------------------------------------------------------- import from a generator model
  // A model's prims (any MODELS entry at options o) as document prims. Detail functions are code: the
  // document keeps them by reference (base + inherit), and animation is baked at the given phase.
  AF.fromModel = function (name, o = {}, meta = {}) {
    const src = window.MODELS[name](Object.assign({}, o)), prims = [];
    for (const p of src.prims) {
      if (p.k === 5) continue;
      const q = { t: "SECBY"[p.k] || "Y", p: [p.x, p.y, p.z], m: p.m || ((window.ME || {}).content || {}).defaultMaterial };
      if (p.k === 0) q.r = p.r;
      else if (p.k === 1) q.s = [p.rx, p.ry, p.rz];
      else if (p.k === 2) {
        const bv = p.R ? applyCols(p.R, [p.bx, p.by, p.bz]) : [p.bx, p.by, p.bz];
        q.b = add(q.p, bv); q.ra = p.ra; q.rb = p.rb;
      } else if (p.k === 3) { q.s = [p.hx, p.hy, p.hz]; if (p.r) q.r = p.r; }
      else { q.r = p.r; q.hh = p.hh; if (p.rr) q.rr = p.rr; }
      if (p.R && p.k !== 2) q.rot = AF.rotOf(p.R);
      if (p.k2) q.k2 = p.k2;
      if (p.sub) { q.sub = true; if (p.subm) q.subm = p.subm; }
      if (p.disp) { q.disp = p.disp; q.df = p.df; }
      prims.push(q);
    }
    const k = meta.k ?? src.k ?? 1;
    return AF.normalize(Object.assign({ name: meta.name || name + "_edit", label: meta.label || name, k, r: src.r, h: src.h, frames: 1, prims, base: { model: name, o }, inherit: !!src.detail }, meta.extra || {}));
  };

  AF.normalize = (doc) => {
    const d = Object.assign({ format: AF.FORMAT, version: AF.VERSION, name: "asset", label: "", k: 1, frames: 1, prims: [] }, doc);
    if (!d.grid) d.grid = 16 * d.k;
    if (Array.isArray(d.vox)) { if (d.vox.length) d.frames = d.vox.length; else delete d.vox; } // a flipbook of layers: one frame per layer
    return d;
  };
  AF.validate = (doc) => {
    if (!doc || doc.format !== AF.FORMAT) throw new Error("not a Mossheart asset (format must be \"" + AF.FORMAT + "\")");
    if (doc.version > AF.VERSION) throw new Error("asset format v" + doc.version + " is newer than this runtime (v" + AF.VERSION + ")");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(doc.name)) throw new Error("asset name must be an identifier: " + doc.name);
    return doc;
  };

  // ---------------------------------------------------------------- register
  // The document's materials go into every loaded style (and AF.ramps / AF.mats for styles made later),
  // its model into MODELS, and with the engine loaded it becomes a volume deco with point lights.
  AF.installMaterials = (doc) => {
    for (const name in doc.mats || {}) {
      const mt = doc.mats[name], opt = {};
      for (const k of ["em", "cls", "wrap", "bias"]) if (mt[k] !== undefined) opt[k] = mt[k];
      if (opt.em) opt.flat = 1;
      AF.ramps[name] = mt.ramp; AF.mats[name] = opt;
      for (const st of window.STYLES || []) { if (st.ramps) st.ramps[name] = mt.ramp; if (st.mats) st.mats[name] = opt; }
      if (window.ME && ME.LIGHT_COL && mt.light) ME.LIGHT_COL[name] = mt.light;
    }
  };
  AF.register = function (doc) {
    doc = AF.validate(AF.normalize(doc));
    AF.docs[doc.name] = doc;
    AF.installMaterials(doc);
    window.MODELS[doc.name] = (o) => AF.build(AF.docs[doc.name], o || {});
    if (window.ME) {
      // as assets/asset-kit.js model(): a ray-marched volume with its flipbook, its source in the bake-cache key
      if (ME.VOLUME_DECO) ME.VOLUME_DECO.add(doc.name);
      if (ME.FRAMES) { if (doc.frames > 1) ME.FRAMES[doc.name] = doc.frames; else delete ME.FRAMES[doc.name]; }
      (ME.ASSET_BY = ME.ASSET_BY || {})[doc.name] = JSON.stringify(doc); // by name (src/cache.js); a re-registered doc leaves both in ME.ASSET_SRC, so keys take them all
      ME.ASSET_SRC = (ME.ASSET_SRC || "") + ME.ASSET_BY[doc.name];
    }
    return doc;
  };
  AF.list = () => Object.keys(AF.docs);

  // ?gallery=studio: the assets handed over by the studio's "Preview in engine" first, then every registered
  // studio asset, in the showroom of assets/asset-kit.js (rows of up to five, spaced by footprint).
  if (window.ME && ME.ASSET_THEMES) Object.defineProperty(ME.ASSET_THEMES, "studio", {
    enumerable: true, configurable: true,
    get() {
      const names = [...new Set([...AF.loadPreview(), ...AF.list()])], rows = [], cs = [-1.3, 1.7, 4.2, -3.8];
      for (let r = 0; r * 5 < names.length && r < cs.length; r++) {
        const ids = names.slice(r * 5, r * 5 + 5), w = ids.map((n) => { const md = window.MODELS[n]({}); return Math.max(1.3, 2 * md.r * md.k * 0.9 + 0.3); });
        const total = w.reduce((a, b) => a + b, 0), us = [];
        let u = -total / 2;
        for (const x of w) { us.push(u + x / 2); u += x; }
        rows.push([ids.map((n) => [n, {}, n]), cs[r], us]);
      }
      return { label: "Studio assets", rows };
    },
  });

  // The studio hands assets to the engine page through localStorage (?gallery=studio).
  AF.PREVIEW_KEY = "mossheart.studio.preview";
  AF.loadPreview = () => {
    try {
      const rec = JSON.parse(localStorage.getItem(AF.PREVIEW_KEY) || "null");
      if (!rec || !Array.isArray(rec.docs)) return [];
      return rec.docs.map((d) => AF.register(d).name);
    } catch (e) { return []; }
  };

  // An engine-loadable script for one or more documents (assets/*.js).
  AF.toScript = (docs) => {
    const list = Array.isArray(docs) ? docs : [docs];
    const head = "/* Mossheart assets (format v" + AF.VERSION + "): " + list.map((d) => d.name).join(", ") + ".\n   Made in the Mossheart Voxel Studio (studio/index.html). Load after vendor/gen and src/asset-format.js. */\n";
    return head + list.map((d) => "MossAsset.register(" + JSON.stringify(d) + ");\n").join("");
  };
})();
