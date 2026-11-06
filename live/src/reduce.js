/* The feature-keeping reduction (docs/decisions/2026-10-22-detail-tool.md, section 1, as amended after
   Art-Tactics' hand trial): a fine grid of material ids to a coarser one, keeping what was authored. Plain
   functions on typed arrays, no DOM, so it runs in workers and in the studio.
     ME.reduce(fine, { dims, scale } | { dims, to: { dims, map } }, rules)
       -> { cells, dims, changed, lost: [{ mat, at, size }], merged: [{ mat, at, parts }], asym: [{ mat, at }], phase }
   fine: Uint8Array of material ids (0 empty), x fastest, then y, then z. With scale s, s^3 blocks become one cell;
   with to.map(cx, cy, cz) -> [tx, ty, tz] (a fine cell's centre, in fine cells, to target cell units; floored),
   each fine cell goes to the target cell holding its centre.
   rules: { occ = 0.5, weights: { id: w }, keep: [ids], nudge = false, mirror: { p: [x, y, z], n: [x, y, z] },
     edge: "empty" | "solid" (what lies outside the grid: "solid" for a region cut out of a larger solid) }.
     1. materials, never colours: a cell takes one of the materials present;
     2. occupancy: solid when at least occ of its fine cells are;
     3. the material is what shows: the block's surface fine cells (a solid cell with an empty 6-neighbour) vote
        with their material's weight (1 by default); a block without surface cells takes the plurality of all;
     4. features that must stay: each 6-connected component of a keep material keeps a cell, the one holding most
        of it; one whose best cell another kept component holds goes to lost;
     5. reports: lost; merged, components of one kept material that were apart and touch after; asym;
     6. phase (scale only): nudge tries the block phases, at most s^3, for the fewest lost plus asym (then the
        fewest lost, then the first). mirror, a plane in fine cells, pairs each kept component with the one
        nearest its mirror image; a pair whose cells don't reduce to mirrored cells is listed in asym.
   changed counts the cells rule 4 set. Scans run in a fixed order and ties go to the lower material id: the same
   input gives the same bytes. With scale it allocates 5 bytes per fine cell (the input and a label); with to.map,
   8 more (each cell's target and the cells grouped by target).
   ME.modelHash(md, pal) is an FNV-1a of what a model's voxels depend on. */
(function () {
  const ME = (typeof window !== "undefined" ? window : self).ME || (self.ME = {});

  // 6-connected components of the cells where keep(i) holds, joined where same(i, j): label per cell (-1 off),
  // the cells grouped by component (order), each component's start in it
  function components(dims, keep, same) {
    const [nx, ny, nz] = dims, N = nx * ny * nz, label = new Int32Array(N).fill(-1);
    let K = 0;
    for (let i = 0; i < N; i++) if (keep(i)) K++;
    const order = new Int32Array(K), start = [0];
    let q = 0;
    for (let s = 0; s < N && q < K; s++) {
      if (label[s] >= 0 || !keep(s)) continue;
      const c = start.length - 1;
      label[s] = c; order[q++] = s;
      for (let h = start[c]; h < q; h++) {
        const i = order[h], x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
        const nb = (j) => { if (label[j] < 0 && keep(j) && same(i, j)) { label[j] = c; order[q++] = j; } };
        if (x > 0) nb(i - 1); if (x < nx - 1) nb(i + 1);
        if (y > 0) nb(i - nx); if (y < ny - 1) nb(i + nx);
        if (z > 0) nb(i - nx * ny); if (z < nz - 1) nb(i + nx * ny);
      }
      start.push(q);
    }
    return { label, order, start, count: start.length - 1 };
  }

  function reduceOnce(fine, spec, rules, phase) {
    const [fx, fy, fz] = spec.dims, FN = fx * fy * fz, occ = rules.occ ?? 0.5, W = new Float64Array(256).fill(1), keep = new Set(rules.keep || []);
    for (const k in rules.weights || {}) W[+k] = rules.weights[k];
    const xyz = (i) => [i % fx, ((i / fx) | 0) % fy, (i / (fx * fy)) | 0];
    // the targets: dims, each fine cell's target, and the fine cells of a target
    let dims, tgtOf, eachIn;
    if (spec.to) {
      dims = spec.to.dims.slice();
      const [tx, ty, tz] = dims, tgt = new Int32Array(FN), tStart = new Int32Array(tx * ty * tz + 1);
      for (let z = 0, i = 0; z < fz; z++) for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++, i++) {
        const t = spec.to.map(x + 0.5, y + 0.5, z + 0.5), a = Math.floor(t[0]), b = Math.floor(t[1]), c = Math.floor(t[2]);
        tgt[i] = a < 0 || b < 0 || c < 0 || a >= tx || b >= ty || c >= tz ? -1 : (c * ty + b) * tx + a;
        if (tgt[i] >= 0) tStart[tgt[i] + 1]++;
      }
      for (let t = 0; t < tx * ty * tz; t++) tStart[t + 1] += tStart[t];
      const tList = new Int32Array(tStart[tx * ty * tz]), fill = tStart.slice();
      for (let i = 0; i < FN; i++) if (tgt[i] >= 0) tList[fill[tgt[i]]++] = i;
      tgtOf = (i) => tgt[i];
      eachIn = (t, f) => { for (let k = tStart[t]; k < tStart[t + 1]; k++) f(tList[k]); };
    } else {
      const s = spec.scale;
      dims = [0, 1, 2].map((a) => Math.ceil((spec.dims[a] + phase[a]) / s));
      const [tx, ty] = dims;
      tgtOf = (i) => { const [x, y, z] = xyz(i); return (((z + phase[2]) / s | 0) * ty + ((y + phase[1]) / s | 0)) * tx + ((x + phase[0]) / s | 0); };
      eachIn = (t, f) => {
        const bx = t % tx, by = ((t / tx) | 0) % ty, bz = (t / (tx * ty)) | 0;
        const x0 = Math.max(0, bx * s - phase[0]), x1 = Math.min(fx, (bx + 1) * s - phase[0]), y0 = Math.max(0, by * s - phase[1]), y1 = Math.min(fy, (by + 1) * s - phase[1]);
        for (let z = Math.max(0, bz * s - phase[2]); z < Math.min(fz, (bz + 1) * s - phase[2]); z++) for (let y = y0; y < y1; y++) for (let x = x0, i = (z * fy + y) * fx + x0; x < x1; x++, i++) f(i);
      };
    }
    const [tx, ty, tz] = dims, TN = tx * ty * tz;
    const eS = rules.edge === "solid", surf = (i) => {
      const x = i % fx, y = ((i / fx) | 0) % fy, z = (i / (fx * fy)) | 0;
      if (eS) return (x > 0 && !fine[i - 1]) || (x < fx - 1 && !fine[i + 1]) || (y > 0 && !fine[i - fx]) || (y < fy - 1 && !fine[i + fx]) || (z > 0 && !fine[i - fx * fy]) || (z < fz - 1 && !fine[i + fx * fy]);
      return x === 0 || x === fx - 1 || y === 0 || y === fy - 1 || z === 0 || z === fz - 1 || !fine[i - 1] || !fine[i + 1] || !fine[i - fx] || !fine[i + fx] || !fine[i - fx * fy] || !fine[i + fx * fy];
    };
    // rules 2 and 3, per target cell
    const cells = new Uint8Array(TN), vote = new Float64Array(256), all = new Int32Array(256), seen = [];
    let n = 0, solid = 0, ns = 0;
    const visit = (i) => {
      n++;
      const m = fine[i];
      if (!m) return;
      solid++;
      if (!all[m] && !vote[m]) seen.push(m);
      all[m]++;
      if (surf(i)) { vote[m] += W[m]; ns++; }
    };
    for (let t = 0; t < TN; t++) {
      n = solid = ns = 0; seen.length = 0;
      eachIn(t, visit);
      if (solid > 0 && solid >= occ * n) {
        const score = ns ? vote : all;
        let best = 0;
        for (const m of seen) if (score[m] > score[best] || (score[m] === score[best] && m < best) || !best) best = m;
        cells[t] = best;
      }
      for (const m of seen) { vote[m] = 0; all[m] = 0; }
    }
    // rule 4: each component of a keep material keeps a cell (larger components first, then scan order)
    const lost = [], merged = [], asym = [], claimed = new Uint8Array(TN);
    let changed = 0;
    const C = keep.size ? components(spec.dims, (i) => keep.has(fine[i]), (i, j) => fine[i] === fine[j]) : { count: 0 };
    const comps = [];
    for (let c = 0; c < C.count; c++) {
      let sx = 0, sy = 0, sz = 0;
      const size = C.start[c + 1] - C.start[c];
      for (let k = C.start[c]; k < C.start[c + 1]; k++) { const [x, y, z] = xyz(C.order[k]); sx += x; sy += y; sz += z; }
      comps.push({ c, m: fine[C.order[C.start[c]]], size, at: [sx / size + 0.5, sy / size + 0.5, sz / size + 0.5], held: null });
    }
    const byRank = comps.slice().sort((p, q) => q.size - p.size || p.c - q.c);
    for (const K of byRank) {
      const held = new Set(), cnt = new Map();
      let best = -1, bn = 0;
      for (let k = C.start[K.c]; k < C.start[K.c + 1]; k++) {
        const t = tgtOf(C.order[k]);
        if (t < 0) continue;
        if (cells[t] === K.m && !claimed[t]) held.add(t); // a cell another kept component holds isn't this one's
        const v = (cnt.get(t) || 0) + 1; cnt.set(t, v);
        if (v > bn || (v === bn && t < best)) { best = t; bn = v; }
      }
      if (!held.size && best >= 0) {
        if (claimed[best]) { lost.push({ mat: K.m, at: K.at.map((v) => +v.toFixed(2)), size: K.size }); K.held = held; continue; }
        cells[best] = K.m; held.add(best); changed++;
      }
      for (const t of held) claimed[t] = 1;
      K.held = held;
    }
    // merged: target components of one kept material that hold two or more of its fine components
    if (comps.length) {
      const T = components(dims, (t) => claimed[t] === 1 && keep.has(cells[t]), (a, b) => cells[a] === cells[b]), parts = new Map();
      for (const K of comps) for (const g of new Set([...K.held].map((t) => T.label[t]).filter((g) => g >= 0))) parts.set(g, (parts.get(g) || 0) + 1);
      for (const g of [...parts.keys()].sort((a, b) => a - b)) if (parts.get(g) >= 2) { const t = T.order[T.start[g]]; merged.push({ mat: cells[t], at: [t % tx, ((t / tx) | 0) % ty, (t / (tx * ty)) | 0], parts: parts.get(g) }); }
    }
    // asym: each kept component against the one nearest its mirror image (scale only)
    if (rules.mirror && !spec.to && comps.length) {
      const s = spec.scale, p = rules.mirror.p, l = Math.hypot(...rules.mirror.n), nn = rules.mirror.n.map((v) => v / l);
      const flip = (q) => { const d = (q[0] - p[0]) * nn[0] + (q[1] - p[1]) * nn[1] + (q[2] - p[2]) * nn[2]; return [q[0] - 2 * d * nn[0], q[1] - 2 * d * nn[1], q[2] - 2 * d * nn[2]]; };
      const flipT = (t) => {
        const c = [(t % tx + 0.5) * s - phase[0], ((((t / tx) | 0) % ty) + 0.5) * s - phase[1], (((t / (tx * ty)) | 0) + 0.5) * s - phase[2]], f = flip(c);
        const a = Math.floor((f[0] + phase[0]) / s), b = Math.floor((f[1] + phase[1]) / s), e = Math.floor((f[2] + phase[2]) / s);
        return a < 0 || b < 0 || e < 0 || a >= tx || b >= ty || e >= tz ? -1 : (e * ty + b) * tx + a;
      };
      for (const A of comps) {
        const fa = flip(A.at);
        let B = null, bd = 1.5 * s;
        for (const K of comps) { if (K.m !== A.m) continue; const d = Math.hypot(K.at[0] - fa[0], K.at[1] - fa[1], K.at[2] - fa[2]); if (d < bd || (d === bd && B && K.c < B.c)) { B = K; bd = d; } }
        if (!B || B.c < A.c) continue; // no partner, or the pair was judged from B
        const img = new Set([...A.held].map(flipT));
        if (img.size !== B.held.size || [...B.held].some((t) => !img.has(t))) asym.push({ mat: A.m, at: A.at.map((v) => +v.toFixed(2)) });
      }
    }
    return { cells, dims, changed, lost, merged, asym, phase };
  }

  ME.reduce = function (fine, spec, rules = {}) {
    if (!spec.to && !(spec.scale >= 1)) throw new Error("ME.reduce: give { dims, scale } or { dims, to: { dims, map } }");
    if (fine.length !== spec.dims[0] * spec.dims[1] * spec.dims[2]) throw new Error("ME.reduce: fine has " + fine.length + " cells, dims say " + spec.dims.join("x"));
    if (!rules.nudge || spec.to || spec.scale === 1) return reduceOnce(fine, spec, rules, [0, 0, 0]);
    const s = spec.scale, score = (r) => r.lost.length + r.asym.length;
    let best = null;
    for (let pz = 0; pz < s; pz++) for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      const r = reduceOnce(fine, spec, rules, [px, py, pz]);
      if (!best || score(r) < score(best) || (score(r) === score(best) && r.lost.length < best.lost.length)) best = r;
      if (!score(best)) return best;
    }
    return best;
  };

  ME.reduce.parts = [components, reduceOnce]; // for the bake cache's key (src/cache.js)

  // FNV-1a of a model's prims, focus (with its rules), k, the source of md.detail and md.contour, and the palette
  // specs of the materials its prims and rules name (pal: an ME.Palette; without it the specs are left out)
  ME.modelHash = function (md, pal) {
    let h = 0x811c9dc5;
    const add = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } h ^= 0x2c; h = Math.imul(h, 0x01000193); };
    add(JSON.stringify(md.prims || [])); add(JSON.stringify(md.focus || null)); add(String(md.k ?? 1));
    add(md.detail ? String(md.detail) : ""); add(md.contour ? String(md.contour) : "");
    if (pal) {
      const names = new Set();
      for (const p of md.prims || []) { if (p.m) names.add(p.m); if (p.subm) names.add(p.subm); }
      for (const f of md.focus || []) { const r = f.rules || {}; for (const m of [...(r.keep || []), ...Object.keys(r.weights || {})]) if (isNaN(+m)) names.add(m); }
      for (const n of [...names].sort()) add(n + "=" + JSON.stringify(pal.mat(n)) + JSON.stringify(pal.ramp(n)));
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
})();
