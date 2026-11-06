/* Model bake: the scene's volume props, its walkers and critters, and any models an app asks for,
   voxelised for the ray-marched volume pass. Animated models are baked as flipbooks over the
   generator's own animation phase o.t. Volumes are laid out brick-aligned (8^3) in a virtual atlas that
   exists only as a brick map; the voxels of occupied bricks live in a dense brick pool. Static volumes
   are also splatted into the coarse occupancy so trees shade the sun volume. Frame counts, walkers,
   critters and glowing materials come from ME.content. */
(function () {
  const ME = window.ME;
  // registries asset packs add to (assets/asset-kit.js and friends), on top of the content pack's tables:
  // flipbook frames per model, emissive material -> point light [r, g, b, k(, radius)]
  ME.FRAMES = ME.FRAMES || {};
  ME.LIGHT_COL = ME.LIGHT_COL || {};

  // opts.walkers = false skips the content's walkers; opts.models = { key: [name, o, frames] } adds
  // flipbooks for an app's own instance layer (returned as extraFrames[key]). Model options o.scale
  // and o.remap (material name -> name) let an app reuse and recolour the content's models.
  // The brick pool: occupied 8^3 bricks in slabs of S x S bricks, stacked in z, S = POOL_SLAB (16) while the
  // bricks fit, else POOL_SLAB_MAX (32); the shader reads S from the pool's width (MB.adims[0] / 8). A 3D
  // texture's depth caps it: 2048 (WebGPU's default) gives 256 slabs, 262,144 bricks (512 MB) at 32 for every
  // model and frame of a scene (65,536 at 16, the ceiling before E6). ME.limits is the device's (gpu.js); before
  // a device exists the default stands. ME.poolSlab (or ?poolslab=16|32) forces S, for checks.
  ME.POOL_SLAB = 16;
  ME.POOL_SLAB_MAX = 32;
  ME.poolMaxDepth = (limits = ME.limits) => (limits && limits.maxTextureDimension3D) || 2048;
  ME.poolMaxBricks = (limits, S = ME.POOL_SLAB_MAX) => Math.floor(ME.poolMaxDepth(limits) / 8) * S * S;
  // The pool's budget on this device, under the ceiling: ME.POOL_PHONE (65,536 bricks, 128 MB, the ceiling before
  // E6) on a phone-like device (a mobile UA, an iPad, whose Safari says Macintosh but has a touch screen, or a
  // touch-only screen (coarse pointer, no fine one) whose short side is 1024 CSS px or less, such as a phone on
  // Chrome's Desktop site; or navigator.deviceMemory <= 4 GB), else the ceiling. The LOD drop (no 2x copies when
  // they don't fit), the bake's throw and MB.stats.fill read it, so a phone keeps the thresholds it had before E6.
  // ME.poolBudget (or ?poolbudget=) sets it.
  // ME.phone(): the phone-or-tablet part, the engine's and the games' one test. A phone on the desktop site says
  // X11 Linux or Macintosh (the user's flagship, 2026-11-02); a touch laptop has a fine pointer, so it stays a
  // desktop. Safe in a bake worker (no matchMedia or screen there).
  ME.POOL_PHONE = 65536;
  ME.phone = () => {
    const ua = navigator.userAgent || "", mq = (q) => typeof matchMedia === "function" && matchMedia(q).matches;
    return /Android|iPhone|iPad|Mobile/.test(ua) || (navigator.maxTouchPoints > 1 && (/Macintosh/.test(ua) ||
      (mq("(pointer: coarse)") && !mq("(any-pointer: fine)") && Math.min(screen.width, screen.height) <= 1024)));
  };
  ME.phoneLike = () => ME.phone() || (navigator.deviceMemory || 8) <= 4;
  ME.poolBricks = (limits) => Math.min(ME.poolMaxBricks(limits), ME.poolBudget || ME.qn("poolbudget", 0) || (ME.phoneLike() ? ME.POOL_PHONE : Infinity));
  // A model baked finer than POOL_HOLLOW voxels per tile edge (VS x fine) keeps only its surface bricks in the pool:
  // a brick whose 512 voxels are solid and whose 6 neighbours' facing layers are solid is never reached by a ray
  // from outside (each step of the walk crosses a face, and the voxel before it is solid), so the brick map marks
  // it empty and MB.inner keeps its materials for the CPU readers (MB.voxel, ME.sampleVoxels: shatter and bursts
  // see the whole model). Its 2x-down copy (halfOf) drops its own interior the same way. ME.poolHollow = false
  // (or ?hollow=0) keeps every brick.
  ME.POOL_HOLLOW = 32;
  // occupied 8^3 bricks of a volume { dims, rgba } (alpha = material id), counted from its origin as the bake
  // places it: its share of the pool
  ME.volumeBricks = (v) => {
    const [nx, ny, nz] = v.dims, rgba = v.rgba;
    let n = 0;
    for (let bz = 0; bz < nz; bz += 8) for (let by = 0; by < ny; by += 8) for (let bx = 0; bx < nx; bx += 8)
      search: for (let z = bz; z < Math.min(nz, bz + 8); z++) for (let y = by; y < Math.min(ny, by + 8); y++) for (let x = bx; x < Math.min(nx, bx + 8); x++) if (rgba[((z * ny + y) * nx + x) * 4 + 3]) { n++; break search; }
    return n;
  };

  // a volume's occupied 8^3 bricks: bmap (per brick of the volume padded to 8s, -1 or its index in chunks), the
  // chunks (8^3 rgba each, empty voxels 0) and its solid voxel count. The bake workers run it too.
  function bricksOf(dims, rgba) {
    const [nx, ny, nz] = dims, px = Math.ceil(nx / 8), py = Math.ceil(ny / 8), pz = Math.ceil(nz / 8);
    const bmap = new Int32Array(px * py * pz).fill(-1), chunks = [];
    let solid = 0;
    for (let iz = 0; iz < pz; iz++) for (let iy = 0; iy < py; iy++) for (let ix = 0; ix < px; ix++) {
      let b = null;
      for (let z = iz * 8; z < Math.min(nz, iz * 8 + 8); z++) for (let yy = iy * 8; yy < Math.min(ny, iy * 8 + 8); yy++)
        for (let xx = ix * 8; xx < Math.min(nx, ix * 8 + 8); xx++) {
          const s = ((z * ny + yy) * nx + xx) * 4;
          if (!rgba[s + 3]) continue;
          if (!b) { b = new Uint8Array(2048); bmap[(iz * py + iy) * px + ix] = chunks.length; chunks.push(b); }
          b.set(rgba.subarray(s, s + 4), (((z & 7) * 8 + (yy & 7)) * 8 + (xx & 7)) * 4);
          solid++;
        }
    }
    return { bmap, chunks, solid };
  }
  // v.mat(x, y, z): a voxel's material, read back through v.bmap and v.chunks
  const matOf = (v) => {
    const { bmap, chunks } = v, px = Math.ceil(v.dims[0] / 8), py = Math.ceil(v.dims[1] / 8);
    return (x, y, z) => { const b = bmap[((z >> 3) * py + (y >> 3)) * px + (x >> 3)]; return b < 0 ? 0 : chunks[b][(((z & 7) * 8 + (y & 7)) * 8 + (x & 7)) * 4 + 3]; };
  };

  // The voxel LOD: a volume's 2x-down copy, drawn in its place where its voxels come out under a pixel
  // (R.set.vlod, the volume shader). A half voxel is solid if any of its 8 voxels is. It takes from its surface
  // voxels (a face open) their averaged normal and AO, and a material of theirs (pick): the rarest on the volume's
  // whole surface among those emissive (emi[id]) or on 2+ of them, so eyes and glow survive without a big
  // many-material volume going speckled; else their most common (ties: the commoner on the surface). A half
  // voxel with none (all inside) keeps the interior normal. Ties between materials go to the lower rk[id] (rk
  // omitted: the lower id); a progressive bake (E4) passes the order the single-pass bake would have numbered them in.
  // Returns { dims, bmap, chunks, nsolid } (bricksOf's), built brick by brick: a half brick is 2^3 source bricks.
  // The interior bricks of a volume { dims, bmap, chunks } (ME.POOL_HOLLOW): is[chunk] 1 for a brick whose 512 voxels
  // are solid and whose 6 neighbours (inside the volume, occupied) are solid on the layer that faces it; n of them
  function innerOf(v) {
    const [nx, ny, nz] = v.dims, px = Math.ceil(nx / 8), py = Math.ceil(ny / 8), pz = Math.ceil(nz / 8), { bmap, chunks } = v;
    const is = new Uint8Array(chunks.length), full = new Int8Array(chunks.length).fill(-1);
    const isFull = (bi) => { if (full[bi] < 0) { const c = chunks[bi]; let f = 1; for (let j = 3; j < 2048; j += 4) if (!c[j]) { f = 0; break; } full[bi] = f; } return full[bi]; };
    // brick bi's layer at a = s (axis a: 0 x, 1 y, 2 z; s 0 or 7) all solid
    const layer = (bi, a, s) => {
      const c = chunks[bi];
      for (let u = 0; u < 8; u++) for (let w = 0; w < 8; w++) {
        const j = a === 0 ? (w * 8 + u) * 8 + s : a === 1 ? (w * 8 + s) * 8 + u : (s * 8 + w) * 8 + u;
        if (!c[j * 4 + 3]) return false;
      }
      return true;
    };
    let n = 0;
    for (let iz = 0; iz < pz; iz++) for (let iy = 0; iy < py; iy++) for (let ix = 0; ix < px; ix++) {
      const bi = bmap[(iz * py + iy) * px + ix];
      if (bi < 0 || !isFull(bi)) continue;
      const p = [ix, iy, iz], P = [px, py, pz];
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) for (const d of [-1, 1]) {
        const q = p.slice(); q[a] += d;
        if (q[a] < 0 || q[a] >= P[a]) { ok = false; break; }
        const nb = bmap[(q[2] * py + q[1]) * px + q[0]];
        if (nb < 0 || !(full[nb] === 1 || layer(nb, a, d > 0 ? 0 : 7))) { ok = false; break; }
      }
      if (ok) { is[bi] = 1; n++; }
    }
    return { is, n };
  }

  function halfOf(v, emi, rk) {
    const [nx, ny, nz] = v.dims, px = Math.ceil(nx / 8), py = Math.ceil(ny / 8), pz = Math.ceil(nz / 8), mat = v.mat, { bmap, chunks } = v;
    const R = rk || Uint16Array.from({ length: 256 }, (_, i) => i);
    const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mat(x, y, z) !== 0;
    const open = (x, y, z) => !at(x - 1, y, z) || !at(x + 1, y, z) || !at(x, y - 1, z) || !at(x, y + 1, z) || !at(x, y, z - 1) || !at(x, y, z + 1);
    // the surface's material counts
    const freq = new Uint32Array(256);
    for (let iz = 0; iz < pz; iz++) for (let iy = 0; iy < py; iy++) for (let ix = 0; ix < px; ix++) {
      const bi = bmap[(iz * py + iy) * px + ix];
      if (bi < 0) continue;
      const c = chunks[bi];
      for (let j = 0; j < 512; j++) if (c[j * 4 + 3] && open(ix * 8 + (j & 7), iy * 8 + ((j >> 3) & 7), iz * 8 + (j >> 6))) freq[c[j * 4 + 3]]++;
    }
    const pick = (C, o, n) => {
      let best = 0, most = 0, mc = 0;
      for (let i = 0; i < n; i++) {
        const m = C[o + i];
        let k = 0;
        for (let j = 0; j < n; j++) if (C[o + j] === m) k++;
        if ((emi[m] || k >= 2) && (!best || freq[m] < freq[best] || (freq[m] === freq[best] && R[m] < R[best]))) best = m;
        if (k > mc || (k === mc && (freq[m] > freq[most] || (freq[m] === freq[most] && R[m] < R[most])))) { most = m; mc = k; }
      }
      return best || most;
    };
    const dims = [Math.ceil(nx / 2), Math.ceil(ny / 2), Math.ceil(nz / 2)], hx = Math.ceil(dims[0] / 8), hy = Math.ceil(dims[1] / 8), hz = Math.ceil(dims[2] / 8);
    const hmap = new Int32Array(hx * hy * hz).fill(-1), out = [], N = new Float32Array(512 * 3), A = new Float32Array(512), S = new Uint8Array(512), C = new Uint8Array(512 * 8), I = new Uint8Array(512);
    let nsolid = 0;
    for (let iz = 0; iz < hz; iz++) for (let iy = 0; iy < hy; iy++) for (let ix = 0; ix < hx; ix++) {
      let any = false;
      N.fill(0); A.fill(0); S.fill(0); I.fill(0);
      for (let s = 0; s < 8; s++) {
        const sx = ix * 2 + (s & 1), sy = iy * 2 + ((s >> 1) & 1), sz = iz * 2 + (s >> 2);
        if (sx >= px || sy >= py || sz >= pz) continue;
        const bi = bmap[(sz * py + sy) * px + sx];
        if (bi < 0) continue;
        const c = chunks[bi];
        for (let j = 0; j < 512; j++) {
          const m = c[j * 4 + 3];
          if (!m) continue;
          any = true;
          const x = sx * 8 + (j & 7), y = sy * 8 + ((j >> 3) & 7), z = sz * 8 + (j >> 6), h = ((((z >> 1) & 7) * 8 + ((y >> 1) & 7)) * 8 + ((x >> 1) & 7));
          if (!open(x, y, z)) { if (!I[h] || R[m] < R[I[h]]) I[h] = m; continue; }
          // the oct normal back to a vector (src/sdf.js octEnc)
          let ox = (c[j * 4] / 255) * 2 - 1, oy = (c[j * 4 + 1] / 255) * 2 - 1;
          const oz = 1 - Math.abs(ox) - Math.abs(oy);
          if (oz < 0) { const tx = ox; ox = (1 - Math.abs(oy)) * (tx >= 0 ? 1 : -1); oy = (1 - Math.abs(tx)) * (oy >= 0 ? 1 : -1); }
          const l = Math.hypot(ox, oy, oz) || 1;
          N[h * 3] += ox / l; N[h * 3 + 1] += oy / l; N[h * 3 + 2] += oz / l; A[h] += c[j * 4 + 2]; C[h * 8 + S[h]++] = m;
        }
      }
      if (!any) continue;
      const b = new Uint8Array(2048);
      for (let h = 0; h < 512; h++) {
        if (S[h]) {
          const n = [N[h * 3], N[h * 3 + 1], N[h * 3 + 2]], l = Math.hypot(n[0], n[1], n[2]);
          const o = l > 1e-6 ? ME.octEnc(n) : [128, 128];
          b[h * 4] = o[0]; b[h * 4 + 1] = o[1]; b[h * 4 + 2] = Math.round(A[h] / S[h]); b[h * 4 + 3] = pick(C, h * 8, S[h]);
        } else if (I[h]) { b[h * 4] = 128; b[h * 4 + 1] = 128; b[h * 4 + 2] = 255; b[h * 4 + 3] = I[h]; }
        else continue;
        nsolid++;
      }
      hmap[(iz * hy + iy) * hx + ix] = out.length; out.push(b);
    }
    return { dims, bmap: hmap, chunks: out, nsolid };
  }

  // E2, the bake workers (docs/decisions/2026-10-20-bake-workers.md). This runs in a worker only (built from
  // ME.sdf.workerSrc(), bricksOf and this): a data-only model voxelised with a palette of its own and packed into
  // bricks. Its materials come back by name, in the order it met them; det's nearest materials as indices into
  // emNames (0: none).
  function workerJob(q) {
    // idle: the time since this worker last answered (its probe or a job), first: its first job (idle is then the
    // wait from its probe), ms: this job's, for stats.startMs, idleMs, busyMs
    const t0 = performance.now(), idle = t0 - (workerJob.end || t0), first = !workerJob.n, done = (r, tr) => { workerJob.n = 1; r.idle = idle; r.first = first; r.ms = (workerJob.end = performance.now()) - t0; postMessage(r, tr); };
    if (q.probe) { workerJob.end = performance.now(); postMessage({ probe: q.probe.map((p) => noise(p[0], p[1], p[2], p[3])) }); return; }
    if (q.finish) { try { const [r, tr] = finishOf(q); done(r, tr); } catch (e) { done({ id: q.id, error: e.message }, []); } return; }
    try {
      ME.sdf.cull = q.cull; ME.content = { defaultMaterial: q.def }; CS.calls = CS.prims = CS.kept = 0;
      const pal = { names: [null], ids: {}, id(n) { if (n === undefined) n = q.def; let i = this.ids[n]; if (i === undefined) { i = this.names.length; this.names.push(n); this.ids[n] = i; } return i; } };
      const vx = voxelCore(q.md, q.vs, pal, { detail: q.detail }, null), b = bricksOf(vx.dims, vx.rgba), buf = new Uint8Array(b.chunks.length * 2048);
      b.chunks.forEach((c, k) => buf.set(c, k * 2048));
      const r = { id: q.id, box: vx.box, dims: vx.dims, solid: vx.solid, surf: vx.surf, names: pal.names, bmap: b.bmap, nb: b.chunks.length, buf, nsolid: b.solid, cs: { calls: CS.calls, prims: CS.prims, kept: CS.kept } };
      const tr = [b.bmap.buffer, buf.buffer];
      if (q.fullK) {
        const [nx, ny] = vx.dims;
        r.full = tightBox(Object.assign({}, q.md, { k: q.fullK }), q.vs);
        r.est = estOf(vx.dims, (x, y, z) => vx.rgba[((z * ny + y) * nx + x) * 4 + 3], q.vf, [0, 1, 2].map((k) => vx.box[k] - r.full[k] / q.vf), r.full.slice(3), q.hollow);
      }
      if (vx.det) {
        const d = vx.det, emNames = [null], at = new Map([[null, 0]]);
        r.em = Uint16Array.from(d.m, (m) => { let k = at.get(m); if (k === undefined) { at.set(m, (k = emNames.length)); emNames.push(m); } return k; });
        r.idx = Int32Array.from(d.idx); r.n = Float64Array.from(d.n); r.emNames = emNames;
        tr.push(r.idx.buffer, r.em.buffer, r.n.buffer);
      }
      done(r, tr);
    } catch (e) { done({ id: q.id, error: e.message }, []); }
  }
  // E4's finish job, in a worker: a full-density volume the main thread has numbered and painted (q.buf, q.nb
  // chunks; q.bmap, q.dims) back with its interior bricks (q.hollow: innerOf) and its 2x-down copy (q.lod: halfOf,
  // ties by q.rk), each copy's interior too. The buffers go there and back by transfer.
  function finishOf(q) {
    const chunks = [];
    for (let k = 0; k < q.nb; k++) chunks.push(q.buf.subarray(k * 2048, k * 2048 + 2048));
    const v = { dims: q.dims, bmap: q.bmap, chunks };
    v.mat = matOf(v);
    const inner = q.hollow ? innerOf(v) : null, l = q.lod ? halfOf(v, q.emi, q.rk) : null;
    if (l && inner) l.inner = innerOf(l);
    const r = { id: q.id, buf: q.buf, bmap: q.bmap, inner: inner && inner.is, ninner: inner ? inner.n : 0 }, tr = [q.buf.buffer, q.bmap.buffer];
    if (inner) tr.push(inner.is.buffer);
    if (l) {
      const lb = new Uint8Array(l.chunks.length * 2048);
      l.chunks.forEach((c, k) => lb.set(c, k * 2048));
      r.lod = { dims: l.dims, bmap: l.bmap, nb: l.chunks.length, buf: lb, nsolid: l.nsolid, inner: l.inner && l.inner.is, ninner: l.inner ? l.inner.n : 0 };
      tr.push(lb.buffer, l.bmap.buffer);
      if (l.inner) tr.push(l.inner.is.buffer);
    }
    return [r, tr];
  }
  // E4: the pool bricks a progressive frame's full bake will take, [model, 2x-down copy], estimated from its fine-1
  // copy (cd its dims, at(x, y, z) a voxel's material) before the full bake exists: vf the density ratio, off the
  // fine-1 box's offset in its own voxels (a full voxel f is fine-1 voxel f / vf - off), fd the full dims, hollow
  // whether the full model keeps its interior out of the pool. A full brick counts if a fine-1 voxel within one of
  // its span is solid (a summed-volume table answers each brick in 8 reads); with hollow, not one away from the
  // volume's edge whose span two voxels out is all solid. 5% and 2 bricks over (a thin part the fine-1 copy lost).
  function estOf(cd, at, vf, off, fd, hollow) {
    const [cx, cy, cz] = cd, X = cx + 1, Y = cy + 1, sat = new Uint32Array(X * Y * (cz + 1));
    for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) {
      let row = 0;
      for (let x = 0; x < cx; x++) { if (at(x, y, z)) row++; const i = ((z + 1) * Y + y + 1) * X + x + 1; sat[i] = row + sat[i - X] + sat[i - X * Y] - sat[i - X - X * Y]; }
    }
    const s = (x, y, z) => sat[(z * Y + y) * X + x];
    const sum = (a, b) => s(b[0], b[1], b[2]) - s(a[0], b[1], b[2]) - s(b[0], a[1], b[2]) - s(b[0], b[1], a[2]) + s(a[0], a[1], b[2]) + s(a[0], b[1], a[2]) + s(b[0], a[1], a[2]) - s(a[0], a[1], a[2]);
    const est = (bs) => {
      const nb = fd.map((n) => Math.ceil(n / bs)), a = [0, 0, 0], b = [0, 0, 0], a2 = [0, 0, 0], b2 = [0, 0, 0], p = [0, 0, 0];
      let n = 0;
      for (p[2] = 0; p[2] < nb[2]; p[2]++) for (p[1] = 0; p[1] < nb[1]; p[1]++) for (p[0] = 0; p[0] < nb[0]; p[0]++) {
        let edge = false;
        for (let k = 0; k < 3; k++) {
          const lo = Math.floor((p[k] * bs) / vf - off[k]), hi = Math.ceil(Math.min(p[k] * bs + bs, fd[k]) / vf - off[k]);
          a[k] = Math.min(cd[k], Math.max(0, lo - 1)); b[k] = Math.min(cd[k], Math.max(0, hi + 1));
          a2[k] = lo - 2; b2[k] = hi + 2;
          if (p[k] === 0 || p[k] === nb[k] - 1 || a2[k] < 0 || b2[k] > cd[k]) edge = true;
        }
        if (b[0] <= a[0] || b[1] <= a[1] || b[2] <= a[2] || !sum(a, b)) continue;
        if (hollow && !edge && sum(a2, b2) === (b2[0] - a2[0]) * (b2[1] - a2[1]) * (b2[2] - a2[2])) continue;
        n++;
      }
      return Math.min(nb[0] * nb[1] * nb[2], Math.ceil(n * 1.05) + 2);
    };
    return [est(8), est(16)];
  }
  // n workers from a Blob of sources (the engine runs from file://, so not from a script file), each trusted once
  // its noise matches P.noise to the bit. Resolves to those that answered within 3 s: none without Worker or
  // under a CSP that refuses blob: workers, and the bake stays on the main thread.
  function startWorkers(n) {
    if (typeof Worker === "undefined") return Promise.resolve([]);
    let url;
    try { url = URL.createObjectURL(new Blob([ME.sdf.workerSrc(), "\n", String(bricksOf), "\nconst matOf = ", String(matOf), ";\n", String(innerOf), "\n", String(halfOf), "\n", String(finishOf), "\n", String(estOf), "\nME.octEnc = octEnc;\n", String(workerJob), "\nonmessage = (e) => workerJob(e.data);\n"], { type: "text/javascript" })); } catch (e) { return Promise.resolve([]); }
    const probe = [[0.37, 1.7, 2.2, 7], [-5.13, 3.3, 0.91, 7], [12.25, -8.5, 4.75, 3]], want = probe.map((p) => window.PX.noise(p[0], p[1], p[2], p[3]));
    const one = () => new Promise((res) => {
      let w = null;
      try { w = new Worker(url); } catch (e) { res(null); return; }
      const fail = () => { clearTimeout(t); w.terminate(); res(null); }, t = setTimeout(fail, 3000);
      w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); fail(); };
      w.onmessage = (e) => {
        if (!(e.data.probe && e.data.probe.every((v, i) => v === want[i]))) { ME.log("WARN BAKE worker noise differs from P.noise; models bake on the main thread"); fail(); return; }
        clearTimeout(t); res(w);
      };
      w.postMessage({ probe });
    });
    return Promise.all(Array.from({ length: n }, one)).then((ws) => { URL.revokeObjectURL(url); return ws.filter(Boolean); });
  }
  // jobs ({ id, name, q, tr? }) on the workers, posted in their order (q with the buffers tr transferred),
  // run.depth in hand on each worker: the next is posted from a worker's answer, which runs on the main thread, and
  // during the terrain bake only at its yields (ME.bakeModels.start, ~40 ms or more apart; a mean job is ~15 ms), so
  // a few jobs in hand keep a worker busy between them (ME.bakeJobDepth, 4 by default). out: id -> a promise of its
  // result, or of null where it failed (a prim that is not plain data, an error, a worker lost), and that variant
  // bakes on the main thread (a job's miss: what happens instead). The watchdog terminates a worker that holds jobs
  // and has sent nothing for ME.bakeJobMs (30 s by default; restarted on each answer, so it bounds one job), and
  // every job it held bakes here. startMs, idleMs, busyMs: the workers' summed time from the probe to their first
  // job, between jobs (waiting for a post; not after the last) and in them. add(jobs, front) queues more (E4: a
  // progressive bake's full bakes once its upgrade starts, its finishing jobs with front: before those waiting),
  // each null at once when stopped or no worker is left. stop() ends it. cache (E3: ME.bakeCache.modelCache's):
  // a job it holds an answer for resolves to it and is never posted, and each worker's answer is kept by it
  function runJobs(ws, jobs, depth = ME.bakeJobDepth || 4, cache = null) {
    const out = new Map(), queue = [], limit = ME.bakeJobMs || 30000, run = { out, depth, startMs: 0, idleMs: 0, busyMs: 0 };
    let alive = ws.length, stopped = false;
    const failed = (j, why) => { ME.log("WARN BAKE worker: " + j.name + ": " + why + "; " + (j.miss || "baked on the main thread")); j.res(null); };
    const quit = (w) => { clearTimeout(w.dog); w.dead = true; w.terminate(); w.onmessage = w.onerror = null; };
    const arm = (w) => { clearTimeout(w.dog); w.dog = w.held.length ? setTimeout(() => lose(w, "no answer in " + limit + " ms"), limit) : 0; };
    const lose = (w, why) => {
      quit(w);
      for (const j of w.held.splice(0)) failed(j, why);
      if (--alive === 0) while (queue.length) queue.shift().res(null);
    };
    const give = (w) => { const j = queue.shift(); try { w.postMessage(j.q, j.tr || []); w.held.push(j); } catch (e) { failed(j, e.message); } };
    const fill = (w) => { while (!w.dead && w.held.length < run.depth && queue.length) give(w); };
    // the queue dealt round the workers, one each per round (the least busy first), so a flipbook's frames (next to
    // each other, the same cost) start on different workers
    const deal = () => { for (let k = 1; k <= run.depth && queue.length; k++) for (const w of ws) if (!w.dead && w.held.length < k && queue.length) give(w); for (const w of ws) if (!w.dead) arm(w); };
    // a job the cache answers: out set, and not queued
    const hit = (j) => { const r = cache && cache.hit(j.q); if (r) out.set(j.id, Promise.resolve(r)); return !r; };
    run.add = (more, front = false) => {
      more = more.filter(hit);
      for (const j of more) out.set(j.id, new Promise((r) => { j.res = r; }));
      if (stopped || !alive) { for (const j of more) j.res(null); return; }
      if (front) queue.unshift(...more); else queue.push(...more);
      deal();
    };
    for (const w of ws) {
      w.held = [];
      w.onmessage = (e) => {
        const d = e.data, k = w.held.findIndex((j) => j.id === d.id), j = k < 0 ? null : w.held.splice(k, 1)[0];
        run[d.first ? "startMs" : "idleMs"] += d.idle || 0; run.busyMs += d.ms || 0;
        if (j) { if (d.error) failed(j, d.error); else { if (cache) cache.keep(j.q, d); j.res(d); } }
        fill(w); arm(w);
      };
      w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); lose(w, e.message || "worker error"); };
    }
    jobs = jobs.filter(hit);
    for (const j of jobs) out.set(j.id, new Promise((r) => { j.res = r; }));
    queue.push(...jobs);
    deal();
    // every job not yet answered resolves to null (bakes here), quietly: the bake is over or cancelled
    run.stop = () => { stopped = true; for (const w of ws) { quit(w); for (const j of w.held.splice(0)) j.res(null); } while (queue.length) queue.shift().res(null); };
    return run;
  }

  // the variant list of a bake: the static volumes' flipbooks (vols: [{ name, o }], T.volumes or
  // ME.volumeDecoOf(st)), the walkers', opts.models' and the critters', each variant once, in the order the bake
  // numbers them; statics[i] are vols[i]'s frames
  function listOf(vols, st, opts) {
    const CT = ME.content || {}, FRAMES = Object.assign({}, ME.FRAMES, CT.flipbookFrames), variants = [], byKey = new Map();
    const add = (name, o) => {
      const key = name + JSON.stringify(o);
      if (byKey.has(key)) return byKey.get(key);
      const idx = variants.length;
      variants.push({ name, o, key }); byKey.set(key, idx);
      return idx;
    };
    // flipbook frames for a model name, keeping the deco's own options
    const frames = (name, o) => { const n = FRAMES[name] || 1; if (n === 1) return [add(name, o)]; return Array.from({ length: n }, (_, i) => add(name, Object.assign({}, o, { t: i / n }))); };

    const statics = vols.map((v) => frames(v.name, v.o));
    // walkers on the route: the style's own list (st.walkers), else the content's; each is
    // { type, model?, o?, speed, rate, gait: hop | roll | fly, fly? (hover height) }
    const walkerTypes = opts.walkers === false ? [] : st.walkers || Object.entries(CT.walkers || {}).map(([type, w]) => Object.assign({ type }, w)), walkerFrames = {};
    for (const w of walkerTypes) walkerFrames[w.type] = frames(w.model || w.type, w.o || {});
    const extraFrames = {};
    for (const key in opts.models || {}) {
      const [name, o, n] = opts.models[key];
      extraFrames[key] = n > 1 ? Array.from({ length: n }, (_, i) => add(name, Object.assign({}, o, { t: i / n }))) : [add(name, o)];
    }
    // critter flipbooks, baked at `fine` x density (o.size overrides the model's own scale)
    const critterFrames = {}, CRITTERS = CT.critters || {};
    for (const key in CRITTERS) {
      const [name, o, n, fine] = CRITTERS[key];
      critterFrames[key] = Array.from({ length: n }, (_, i) => add(name, Object.assign({}, o, { t: i / n, fine })));
    }
    return { variants, statics, walkerTypes, walkerFrames, extraFrames, critterFrames };
  }
  // every variant's model: critters (o.fine set) are drawn content.critterScale x life size so they read
  // beside the chibi units; app models may set their own scale (o.scale) and recolour materials (o.remap:
  // name -> name)
  function modelsOf(variants) {
    const CT = ME.content || {};
    return variants.map((v) => {
      const md = ME.modelOf(v.name, v.o), fine = (v.o && v.o.fine) || 1;
      let vf = fine; // o.chunk: voxelise at 1/chunk density and draw scaled back up (the chunky "toy" look)
      if (v.o && v.o.scale) md.k = v.o.scale * fine;
      else if (fine !== 1) md.k = ((v.o && v.o.size) || md.k) * fine * (CT.critterScale ?? 1);
      if (v.o && v.o.chunk) { md.k /= v.o.chunk; vf = 1 / v.o.chunk; }
      if (v.o && v.o.remap) {
        const map = v.o.remap, d0 = md.detail;
        md.detail = (x, y, z, m, nx, ny, nz, tv) => { const r = d0 ? d0(x, y, z, m, nx, ny, nz, tv) || m : m; return map[r] || r; };
      }
      return { md, vf };
    });
  }
  const workersOn = (opts) => opts.worker !== false && ME.bakeWorkers !== false;
  // why a model stays here (stats.offWorker: name -> reason), or null for a data-only one (no function prim, no
  // contour, no focus to bake); the game never waits for a focus: opts.focus bakes it here
  const notData = (md, opts) => (md.contour ? "contour" : opts.focus && md.focus && md.focus.length ? "focus" : md.prims.some((p) => p.k === 5) ? "function prim"
    : md.prims.some((p) => Object.values(p).some((x) => typeof x === "function")) ? "function field" : null);
  const defOf = (pal) => (pal.defaultName ? pal.defaultName() : (ME.content || {}).defaultMaterial);
  // E4, progressive hero density: an app's flipbook (opts.models) baked finer than tile density (o.fine > 1) and
  // at ME.PROG_MIN voxels per tile edge or more (VS x fine) bakes at fine 1 first, the game starts on it, and a
  // worker bakes it at full density meanwhile; R.swapModel puts the full flipbook in its place (MB.prog below).
  // A critter's flipbook does too when its model is named in opts.progCritters (the small critters aren't worth a
  // swap each). Off with opts.progressive = false, ME.progressive = false or ?progressive=0, with a focus bake and
  // without the workers.
  ME.PROG_MIN = 32;
  // The full bakes start once the game's frames settle (its first frames after READY compile pipelines, and the
  // bakes' CPU would make that freeze longer): ME.PROG_SETTLE ms of frames, none longer than ME.PROG_HITCH ms, or
  // ME.PROG_SETTLE_MAX ms after R's first frame at the latest.
  ME.PROG_SETTLE = 1500; ME.PROG_HITCH = 100; ME.PROG_SETTLE_MAX = 10000;
  const progOn = (opts = {}) => opts.progressive !== false && ME.progressive !== false && ME.qn("progressive", 1) !== 0 && !opts.focus && workersOn(opts);
  const hollowOn = () => ME.poolHollow !== false && ME.qn("hollow", 1) !== 0;
  // the progressive flipbooks, [{ key, vs }] in variant order: every frame data-only, finer than tile density,
  // used by that flipbook only (a variant shared with a static, a walker or a critter keeps one bake), and the
  // frames numbered next to each other
  function progOf(L, mds, opts) {
    if (!progOn(opts)) return [];
    const uses = new Uint32Array(L.variants.length), count = (a) => { for (const i of a) uses[i]++; };
    L.statics.forEach(count);
    for (const m of [L.walkerFrames, L.extraFrames, L.critterFrames]) Object.values(m).forEach(count);
    const groups = [], crit = new Set(opts.progCritters || []);
    const each = (frames, on) => { for (const key in frames) {
      const vs = frames[key];
      if (!on(vs) || vs.some((i, j) => i !== vs[0] + j)) continue;
      if (vs.every((i) => { const { md, vf } = mds[i]; return vf > 1 && ME.VS * vf >= ME.PROG_MIN && !notData(md, opts) && uses[i] === 1; })) groups.push({ key, vs: vs.slice() });
    } };
    each(L.extraFrames, () => true);
    each(L.critterFrames, (vs) => crit.has(L.variants[vs[0]].name));
    return groups;
  }
  // E4: a progressive bake's MB as the bake cache stores it, a new pool and map beside MB's (the game goes on
  // playing MB): the upgrade's pool is sized for its peak and holds the freed slots of the coarse frames, MB.inner
  // their interiors. The bricks the map points at are numbered in map order into a pool of just their number (the
  // slab slabOf gives that number, as a single-pass bake's), and MB.inner cut down the same way.
  function compactOf(MB, slabOf) {
    const t0 = ME.now(), { prog: _p, voxel: _v, ...mb } = MB, [PX0, PY0, PZ0] = MB.adims, PB0 = PX0 / 8, map = MB.bricks.slice(), in0 = MB.inner ? MB.inner.mats : null;
    const nS = new Uint32Array((PB0 * PB0 * PZ0) / 8), nI = new Uint32Array(in0 ? in0.length / 512 : 0);
    let n = 0, m = 0;
    for (let i = 0; i < map.length; i++) {
      const e = map[i];
      if (e >>> 24) { const k = (e & 0xffffff) - 1; map[i] = ((e & 0xff000000) | (nS[k] || (nS[k] = ++n))) >>> 0; }
      else if (e) map[i] = nI[e - 1] || (nI[e - 1] = ++m);
    }
    const PB = slabOf(n), PX = PB * 8, PZ = Math.max(1, Math.ceil(n / (PB * PB))) * 8, atlas = new Uint8Array(PX * PX * PZ * 4), to = new Uint32Array(atlas.buffer), from = new Uint32Array(MB.atlas.buffer, MB.atlas.byteOffset, MB.atlas.length / 4);
    for (let k = 0; k < nS.length; k++) {
      if (!nS[k]) continue;
      const j = nS[k] - 1, a = ((Math.floor(k / (PB0 * PB0)) * 8) * PY0 * PX0) + ((Math.floor(k / PB0) % PB0) * 8) * PX0 + (k % PB0) * 8, b = ((Math.floor(j / (PB * PB)) * 8) * PX * PX) + ((Math.floor(j / PB) % PB) * 8) * PX + (j % PB) * 8;
      for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) {
        const p = a + z * PY0 * PX0 + y * PX0, q = b + z * PX * PX + y * PX;
        for (let x = 0; x < 8; x++) to[q + x] = from[p + x];
      }
    }
    const mats = in0 && new Uint8Array(m * 512);
    if (in0) for (let k = 0; k < nI.length; k++) if (nI[k]) mats.set(in0.subarray(k * 512, (k + 1) * 512), (nI[k] - 1) * 512);
    const stats = Object.assign({}, MB.stats, { slab: PB, pool: [PX, PX, PZ], poolMB: +(atlas.byteLength / 1048576).toFixed(1), hollow: Object.assign({}, MB.stats.hollow, { inner: m }), compact: { bricks: n, fromMB: +(MB.atlas.byteLength / 1048576).toFixed(1), staleInner: nI.length - m, ms: Math.round(ME.now() - t0) } });
    return Object.assign(mb, { atlas, adims: [PX, PX, PZ], bricks: map, inner: in0 ? { mats } : MB.inner, stats });
  }
  // rk[id]: the order the single-pass bake would have numbered the materials in, for halfOf's ties: the ids the
  // palette held before the bake (below n0) as they are, then the others by their first use over lists (one Set
  // of ids per variant, each in the order its bake met them, the variants in order), any left after them
  function rankOf(lists, n0) {
    const R = new Uint16Array(256);
    for (let i = 0; i < 256; i++) R[i] = i < n0 ? i : 256 + i;
    let k = n0;
    for (const s of lists) for (const id of s) if (R[id] >= 256) R[id] = k++;
    return R;
  }
  // all a bake's worker jobs depend on but the models' sources: the variants, in order, the density, the cull, the
  // default material, which variants go to the workers and whether flipbooks bake progressively
  const sigOf = (L, def, opts) => JSON.stringify([L.variants.map((v) => v.key), ME.VS, ME.sdf.cull, def, !!opts.focus, workersOn(opts), progOn(opts), opts.progCritters || []]);

  // A bake's models built and its data-only ones posted to the workers (opts.worker = false or ME.bakeWorkers =
  // false keeps them here), largest first, so a long job doesn't start last: h.mds, h.offWorker, h.ready
  // (resolved once the workers answer their probe, h.ws and h.res set), h.cancel() (safe twice: ends the workers,
  // every job not yet answered resolves to null). A progressive flipbook's frames (h.prog: progOf's) go as two jobs
  // each: id i its fine-1 copy, sized with the full bake's box (r.full), with the others; id nv + i the full bake, in
  // variant order, held back (h.full) till the upgrade starts them (once R's frames settle) or the fallback asks
  // for them, so the boot has the workers for its own jobs and the CPU to itself once they are done.
  // opts.cache (E3): the workers' answers read from and kept in the bake cache (ME.bakeCache.modelCache), read while
  // the workers start; a job it answers is not posted, and the workers end when it answers them all (and no
  // progressive flipbook needs them). Without workers, a progressive frame's stored fine-1 answer is not taken (the
  // frame then bakes here at full density).
  function launch(L, pal, opts) {
    const def = defOf(pal), mds = modelsOf(L.variants), offWorker = {}, jobs = [], on = workersOn(opts), nv = L.variants.length;
    const prog = progOf(L, mds, opts), pv = new Set(prog.flatMap((g) => g.vs)), full = [];
    mds.forEach(({ md, vf }, i) => {
      const name = L.variants[i].name, why = on ? notData(md, opts) : "off";
      if (why) { offWorker[name] = why; return; }
      const cost = md.prims.length * (md.r || 1) ** 2 * (md.h || 1) * md.k ** 3, q = { id: i, md: { prims: md.prims, k: md.k, r: md.r, h: md.h }, vs: ME.VS, cull: ME.sdf.cull, def, detail: !!md.detail };
      if (!pv.has(i)) { jobs.push({ id: i, name, cost, q }); return; }
      jobs.push({ id: i, name, cost: cost / vf ** 3, q: Object.assign({}, q, { md: Object.assign({}, q.md, { k: md.k / vf }), fullK: md.k, vf, hollow: hollowOn() && ME.VS * vf > ME.POOL_HOLLOW }) });
      full.push({ id: nv + i, name, cost, q: Object.assign({}, q, { id: nv + i }), miss: "kept the fine-1 model" });
    });
    jobs.sort((a, b) => b.cost - a.cost);
    const h = { sig: sigOf(L, def, opts), mds, offWorker, prog, nv, full, ws: [], res: new Map(), run: null, done: false };
    h.cancel = () => { if (h.done) return; h.done = true; if (h.run) h.run.stop(); };
    const mc = opts.cache && jobs.length && ME.bakeCache && ME.bakeCache.modelCache ? ME.bakeCache.modelCache() : null;
    const read = mc ? mc.load(jobs.concat(full).map((j) => j.q)) : Promise.resolve();
    const start = jobs.length ? startWorkers(Math.min(Math.max(1, Math.floor(ME.bakeWorkerMax || ME.qn("bakeworkers", 0) || 4)), Math.max(1, (navigator.hardwareConcurrency || 2) - 1), jobs.length)) : Promise.resolve([]);
    h.ready = Promise.all([start, read]).then(([ws]) => {
      if (h.done) { for (const w of ws) w.terminate(); return; }
      if (ws.length && mc && !full.length && jobs.every((j) => mc.has(j.q))) { for (const w of ws) w.terminate(); ws = []; }
      if (ws.length) { h.ws = ws; h.run = runJobs(ws, jobs, undefined, mc); h.res = h.run.out; return; }
      for (const j of jobs) { const r = mc && !pv.has(j.id) && mc.hit(j.q); if (r) h.res.set(j.id, Promise.resolve(r)); else offWorker[j.name] = "no workers"; }
    });
    return h;
  }

  ME.bakeModels = async function (T, st, pal, opts = {}, early = null) {
    const CT = ME.content || {}, LIGHT_COL = Object.assign({}, ME.LIGHT_COL, CT.primLights);
    const t0 = ME.now(), VS = ME.VS, L = listOf(T.volumes, st, opts), { variants, walkerTypes, walkerFrames, extraFrames, critterFrames } = L;
    const statics = T.volumes.map((v, i) => ({ place: v, frames: L.statics[i], phase: v.o && v.o.t !== undefined ? v.o.t : 0 }));
    // the workers ME.bakeModels.start started, if they were given this very bake; else started here
    let h = null, how;
    if (early) {
      if (!early.done && early.sig === sigOf(L, defOf(pal), opts)) { h = early; how = "used"; }
      else { const why = early.done ? "was already used or cancelled" : "doesn't match this bake (its st or opts changed)"; early.cancel(); how = "mismatch"; ME.log("WARN BAKE the early start " + why + ": baked without it"); }
    }
    if (!h) h = launch(L, pal, opts);

    // A voxelised volume is kept as its occupied 8^3 bricks only (8^3 rgba each, empty voxels 0) and its
    // dense rgba dropped at once, so the bake holds one dense volume at a time beside what it outputs (the
    // memory budget, #135): bricksOf below. A bake worker sends its volume back already in bricks.
    const sparse = (v) => { const b = bricksOf(v.dims, v.rgba); v.rgba = null; v.bmap = b.bmap; v.chunks = b.chunks; v.nsolid = b.solid; v.mat = matOf(v); return v; };
    // E4: fn() with the ids pal.id hands out recorded in list, each once, in the order first met: the order a
    // variant's bake met its materials, for rankOf
    const recIds = (list, fn) => {
      const seen = list.seen || (list.seen = new Uint8Array(256)), own = Object.prototype.hasOwnProperty.call(pal, "id"), id0 = pal.id;
      pal.id = function (n) { const i = id0.call(this, n); if (!seen[i]) { seen[i] = 1; list.push(i); } return i; };
      try { return fn(); } finally { if (own) pal.id = id0; else delete pal.id; }
    };
    // a worker's volume: its materials renumbered in this palette in the order the worker met them (the order
    // voxelizeModel here would have met them), then md.detail painted here, over the surface voxels it listed. A
    // generator that yields every 64 bricks and 512 painted voxels, so a progressive bake spreads it over frames
    // (paintDetail reads and writes one voxel per entry, so its slices paint what one call would); drive() runs it
    // through at once
    const S = ME.sdf.stats, takeIn = function* (r, md, list) {
      const map = recIds(list, () => r.names.map((n, k) => (k ? pal.id(n) : 0))), chunks = [];
      for (let k = 0; k < r.nb; k++) { const c = r.buf.subarray(k * 2048, k * 2048 + 2048); for (let j = 3; j < 2048; j += 4) c[j] = map[c[j]]; chunks.push(c); if ((k & 63) === 63) yield; }
      const v = { box: r.box, dims: r.dims, rgba: null, solid: r.solid, surf: r.surf, bmap: r.bmap, chunks, nsolid: r.nsolid };
      v.mat = matOf(v); S.calls += r.cs.calls; S.prims += r.cs.prims; S.kept += r.cs.kept;
      if (md.detail) {
        const [nx, ny] = v.dims, px = Math.ceil(nx / 8), py = Math.ceil(ny / 8);
        const at = (i) => { const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny)); return [chunks[v.bmap[((z >> 3) * py + (y >> 3)) * px + (x >> 3)]], (((z & 7) * 8 + (y & 7)) * 8 + (x & 7)) * 4 + 3]; };
        const get = (i) => { const [c, o] = at(i); return c[o]; }, set = (i, m) => { const [c, o] = at(i); c[o] = m; }, m = Array.from(r.em, (k) => r.emNames[k]);
        for (let a = 0; a < r.idx.length; a += 512) {
          const b = Math.min(r.idx.length, a + 512), det = { idx: r.idx.subarray(a, b), m: m.slice(a, b), n: r.n.subarray(a * 3, b * 3) };
          recIds(list, () => ME.sdf.paintDetail(md, VS, pal, { box: v.box, dims: v.dims, det }, 1 / (VS * md.k), get, set));
          yield;
        }
      }
      return v;
    };
    const drive = (g) => { let x; while (!(x = g.next()).done); return x.value; };

    // each kept in variant order, wherever it was voxelised: the palette numbers materials in the order the
    // single-thread bake meets them, so the pool is byte-identical to it (tools/worker-check.js)
    const vols = [], { mds, offWorker } = h;
    // the main thread's time (stats): waiting for the workers to start (readyMs), then on their jobs (waitMs),
    // voxelising here, taking in worker volumes (md.detail)
    let inWorkers = 0, readyMs = 0, waitMs = 0, hereMs = 0, takeMs = 0, ws, run, res;
    // E4: the palette's size before the bake (rankOf), the ids each variant's bake met (recIds), the progressive
    // flipbooks (h.prog; none without workers) and each of their frames' group. Such a frame bakes here at fine 1
    // (mdc) with kf = vf, the factor its voxels are drawn at (sim.put), and full, its full bake's box.
    const n0 = pal.names.length, nv = variants.length, lists = variants.map(() => []);
    let prog = null;
    const gOf = new Map();
    try {
      let t = ME.now();
      await h.ready;
      readyMs = ME.now() - t;
      res = h.res;
      ws = h.ws; run = h.run;
      if (h.prog && h.prog.length && ws.length) { prog = h.prog; for (const g of prog) for (const i of g.vs) gOf.set(i, g); }
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i], { md, vf } = mds[i], g = gOf.get(i), mdc = g ? Object.assign({}, md, { k: md.k / vf }) : md;
        if ((i & 1) === 0) { ME.progress("voxelising " + v.name + " (" + (i + 1) + "/" + variants.length + ")", 0.5 + 0.3 * (i / variants.length)); await ME.tick(); }
        t = ME.now();
        const r = res.has(i) ? await res.get(i) : null;
        if (res.has(i)) { waitMs += ME.now() - t; t = ME.now(); if (!r) offWorker[v.name] = "worker failed"; }
        const vx = r ? drive(takeIn(r, mdc, lists[i])) : sparse(recIds(lists[i], () => ME.voxelizeModel(mdc, VS, pal, { focus: !!opts.focus })));
        if (r) { inWorkers++; takeMs += ME.now() - t; } else hereMs += ME.now() - t;
        vx.md = md; vx.name = v.name; vx.fine = vf;
        if (g) {
          vx.kf = vf; vx.full = (r && r.full) || ME.sdf.tightBox(md, VS);
          vx.est = (r && r.est) || estOf(vx.dims, vx.mat, vf, [0, 1, 2].map((k) => vx.box[k] - vx.full[k] / vf), vx.full.slice(3), hollowOn() && VS * vf > ME.POOL_HOLLOW);
        }
        vols.push(vx);
      }
    } finally { if (!prog) h.cancel(); else h.done = true; } // a progressive bake keeps the workers (MB.prog), and an early.cancel() leaves them

    // every volume's 2x-down copy (halfOf), packed after them; none when the pool could not hold them all
    const tl = ME.now();
    // emi: the palette's emissive materials (src/palette.js: an em, or the class EMISSIVE); again (setEmi) once a
    // progressive bake's full models bring new materials
    const emi = new Uint8Array(256), byName = (ME.content && ME.content.materialClass) || {};
    const setEmi = () => { if (pal.mat) pal.names.forEach((n, i) => { if (i) { const M = pal.mat(n); emi[i] = M.em || M.cls === ME.CLS.EMISSIVE || byName[n] === "EMISSIVE" ? 1 : 0; } }); };
    setEmi();
    // the copies (halfOf, ties by rk), and the interior bricks of the fine models (ME.POOL_HOLLOW; a coarse model of
    // a progressive bake is VS x fine / kf to the tile edge) and of their copies, which stay out of the pool
    const hollow = hollowOn(), kept = (l) => l.chunks.length - (l.inner ? l.inner.n : 0);
    let lods, hollowMs = 0;
    const prep = (rk) => {
      lods = opts.lod === false ? [] : vols.map((v) => halfOf(v, emi, rk));
      const th = ME.now();
      vols.forEach((v, i) => { v.inner = hollow && (VS * v.fine) / (v.kf || 1) > ME.POOL_HOLLOW ? innerOf(v) : null; if (lods[i]) lods[i].inner = v.inner ? innerOf(lods[i]) : null; });
      hollowMs += ME.now() - th;
    };
    prep();
    // E4: a progressive bake's pool, sized once (no new texture while it upgrades) to its peak C: the models that
    // never change, then at group g's upgrade the full models up to g (estimated: vx.est) and the coarse ones from g
    // on (g's are drawn until its swap has faded). Its slots are reused (the upgrade: used, lw). The copies stay or
    // go as the single-pass bake's would, on the estimate. A peak the pool can't hold waits for the full models (the
    // single-pass bake, its material order ranked back: rankOf).
    const fs = ME.poolSlab || ME.qn("poolslab", 0), slabOf = (n) => (fs === ME.POOL_SLAB || fs === ME.POOL_SLAB_MAX ? fs : n <= ME.poolMaxBricks(undefined, ME.POOL_SLAB) ? ME.POOL_SLAB : ME.POOL_SLAB_MAX);
    let C = 0, sp = null;
    if (prog) {
      const est = (g, k) => g.vs.reduce((a, i) => a + vols[i].est[k], 0), rest = (L) => vols.reduce((a, v, i) => a + (gOf.has(i) ? 0 : kept(v) + (L && lods[i] ? kept(lods[i]) : 0)), 0);
      // (copies cut on the estimate: lodCut, a WARN; the single pass may have kept them)
      const cut = lods.length > 0 && rest(true) + prog.reduce((a, g) => a + est(g, 0) + est(g, 1), 0) > ME.poolBricks();
      if (cut) { lods = []; ME.log("WARN BAKE progressive: the copies are cut on the estimate of the full models' bricks"); }
      const L1 = lods.length > 0, base = rest(L1), F = prog.map((g) => est(g, 0) + (L1 ? est(g, 1) : 0)), Cc = prog.map((g) => g.vs.reduce((a, i) => a + kept(vols[i]) + (L1 ? kept(lods[i]) : 0), 0));
      for (let g = 0; g < prog.length; g++) { let n = base; for (let j = 0; j < prog.length; j++) n += (j <= g ? F[j] : 0) + (j >= g ? Cc[j] : 0); C = Math.max(C, n); }
      sp = { groups: prog.length, frames: gOf.size, C, est: F.reduce((a, b) => a + b, 0), coarse: Cc.reduce((a, b) => a + b, 0), swaps: [], failed: [], doneAt: 0, ...(cut ? { lodCut: true } : {}) };
      const lim = Math.min(ME.poolMaxBricks(undefined, slabOf(C)), ME.poolBricks());
      if (C > lim) {
        ME.log(`WARN BAKE progressive: its pool would peak at ${C} bricks, over the ${lim} it may hold: the full models are waited for`);
        run.add(h.full);
        for (const g of prog) for (const i of g.vs) {
          const r = await res.get(nv + i), { md, vf } = mds[i], list = (lists[i] = []);
          const vx = r ? drive(takeIn(r, md, list)) : sparse(recIds(list, () => ME.voxelizeModel(md, VS, pal, { focus: !!opts.focus })));
          vx.md = md; vx.name = variants[i].name; vx.fine = vf; vols[i] = vx;
        }
        run.stop(); prog = null; sp.fallback = true;
        setEmi(); prep(rankOf(lists, n0));
      }
    }
    if (!prog && vols.reduce((a, v) => a + kept(v), 0) + lods.reduce((a, l) => a + kept(l), 0) > ME.poolBricks()) lods = [];
    const lodMs = ME.now() - tl, lodBricks = lods.reduce((a, l) => a + kept(l), 0), all = vols.concat(lods), hollowN = all.reduce((a, l) => a + (l.inner ? l.inner.n : 0), 0);
    for (const l of lods) l.copy = true;

    // shelf-pack brick-aligned volumes into the atlas; short volumes stack in z inside a column whose
    // footprint fits them (critters and ferns would otherwise each reserve the full atlas depth). E4: a progressive
    // frame's full model and its copy get their place now, a proxy { dims } with no bricks yet (v.px)
    const proxies = [];
    if (prog) for (const g of prog) for (const i of g.vs) { const d = vols[i].full.slice(3); proxies.push((vols[i].px = { dims: d })); if (lods.length) proxies.push((lods[i].px = { dims: d.map((n) => Math.ceil(n / 2)) })); }
    const pad = (n) => Math.ceil(n / 8) * 8, W = 1024, AZ = Math.max(8, ...vols.concat(proxies).map((v) => pad(v.dims[2]))), cols = [];
    let x = 0, y = 0, rowH = 0;
    for (const v of all.concat(proxies)) {
      const [nx, ny, nz] = v.dims.map(pad);
      let c = cols.find((c) => c.w >= nx && c.h >= ny && c.w - nx <= 16 && c.h - ny <= 16 && c.z + nz <= AZ);
      if (!c) {
        if (x + nx > W) { x = 0; y += rowH; rowH = 0; }
        c = { x, y, w: nx, h: ny, z: 0 }; cols.push(c);
        x += nx; rowH = Math.max(rowH, ny);
      }
      v.base = [c.x, c.y, c.z]; v.pdims = [nx, ny, nz]; c.z += nz;
    }
    // brick map (one u32 per 8^3 brick of the layout above: bits 24..31 the occupied 4^3 octants, filled below, and
    // bits 0..23 1 + pool slot; 0 for empty; an interior brick (no octant) 1 + its index in MB.inner) and a dense
    // pool holding only the occupied bricks (the layout is ~1% solid, so the pool is a fraction of it)
    const AX = W, AY = pad(y + rowH), BX = AX / 8, BY = AY / 8, BZ = AZ / 8, bricks = new Uint32Array(BX * BY * BZ);
    let nb = 0, ni = 0, solid = 0;
    for (const v of all) {
      const [px, py, pz] = v.pdims.map((n) => n / 8), [bx, by, bz] = v.base.map((n) => n / 8);
      for (let iz = 0; iz < pz; iz++) for (let iy = 0; iy < py; iy++) for (let ix = 0; ix < px; ix++) {
        const bi = v.bmap[(iz * py + iy) * px + ix];
        if (bi < 0) continue;
        if (v.inner && v.inner.is[bi]) { if (!v.copy) ni++; } // (a copy's interior is dropped: no CPU reader)
        else bricks[((bz + iz) * BY + by + iy) * BX + bx + ix] = ++nb;
      }
    }
    // the slab: 16 x 16 while the bricks fit (the pool and its rounding as before E6), else 32 x 32; a progressive
    // bake's pool holds its peak
    const need = prog ? C : nb, PB = slabOf(need);
    const PX = PB * 8, PY = PB * 8, PZ = Math.max(1, Math.ceil(need / (PB * PB))) * 8;
    const cap = ME.poolMaxBricks(undefined, PB), budget = ME.poolBricks();
    if (need > Math.min(cap, budget)) throw new Error(`the volume pool needs ${need} bricks; ` + (budget < cap ? `this device's budget is ${budget} (ME.poolBudget)` : `the device allows ${cap} (a ${PX} x ${PY} x ${PZ} texture against maxTextureDimension3D ${ME.poolMaxDepth()})`) + ": fewer or smaller volumes, or fewer frames");
    const pool = new Uint8Array(PX * PY * PZ * 4);
    // the models' interior bricks (not their copies'): 512 material bytes each, found through the brick map
    let inner = ni ? { mats: new Uint8Array(ni * 512) } : null;
    ni = 0;
    // each occupied brick into its pool slot, 8 x 8 rows of 8 voxels. Its 4^3 octants that hold a voxel go into
    // the brick map's top byte (bit x + 2y + 4z), and each volume gets the bounds of its voxels, lo and hi (the
    // volume shader skips the empty octants and draws its proxy box over lo..hi, not the whole dims). putVol(v,
    // take): volume v's, take(bk) the pool slot of brick-map entry bk (by default the one the count above gave it);
    // a generator that yields every 64 bricks, run through at once here (drive) and over frames by an upgrade (E4)
    const putVol = function* (v, take = (bk) => bricks[bk] - 1) {
      const [px, py, pz] = v.pdims.map((n) => n / 8), [bx, by, bz] = v.base.map((n) => n / 8), lo = [1e9, 1e9, 1e9], hi = [0, 0, 0];
      let c = 0;
      for (let iz = 0; iz < pz; iz++) for (let iy = 0; iy < py; iy++) for (let ix = 0; ix < px; ix++) {
        const bi = v.bmap[(iz * py + iy) * px + ix];
        if (bi < 0) continue;
        const b = v.chunks[bi], bk = ((bz + iz) * BY + by + iy) * BX + bx + ix;
        // an interior brick: never extremal (solid neighbours on every side), so lo and hi don't need it. Its map
        // entry has no octant (the shader's empty) and 1 + its index in MB.inner below
        if (v.inner && v.inner.is[bi]) {
          if (!v.copy) { bricks[bk] = ni + 1; for (let j = 0; j < 512; j++) inner.mats[ni * 512 + j] = b[j * 4 + 3]; ni++; }
          continue;
        }
        const k = take(bk);
        let om = 0;
        for (let j = 0; j < 512; j++) {
          if (!b[j * 4 + 3]) continue;
          const x = j & 7, y = (j >> 3) & 7, z = j >> 6;
          om |= 1 << ((x >> 2) | ((y >> 2) << 1) | ((z >> 2) << 2));
          const p = [ix * 8 + x, iy * 8 + y, iz * 8 + z];
          for (let a = 0; a < 3; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] + 1 > hi[a]) hi[a] = p[a] + 1; }
        }
        bricks[bk] = ((k + 1) | (om << 24)) >>> 0;
        const qx = (k % PB) * 8, qy = (Math.floor(k / PB) % PB) * 8, qz = Math.floor(k / (PB * PB)) * 8;
        for (let z = 0; z < 8; z++) for (let yy = 0; yy < 8; yy++) pool.set(b.subarray((z * 8 + yy) * 32, (z * 8 + yy) * 32 + 32), ((qz + z) * PY + qy + yy) * PX * 4 + qx * 4);
        if ((++c & 63) === 0) yield;
      }
      if (lo[0] > hi[0]) lo.fill(0); // no voxel: an empty box
      v.lo = lo; v.hi = hi;
    };
    for (const v of all) { drive(putVol(v)); if (v.box) solid += v.nsolid; }
    // E4: the pool's slots as an upgrade takes and frees them: used[k] (one byte a slot; the pool is sized to the
    // peak, so a free list never has to grow it), lw the lowest slot that may be free, inUse their count, touched
    // the pool's z-layers written since the last upload
    const slots = (PZ / 8) * PB * PB, used = prog ? new Uint8Array(slots).fill(1, 0, nb) : null, touched = new Set();
    let lw = nb, inUse = nb;
    const take = () => { let k = lw; while (used[k]) k++; if (k >= slots) throw new Error("the progressive pool is full"); used[k] = 1; lw = k + 1; inUse++; touched.add(Math.floor(k / (PB * PB))); return k; };
    // the bricks of a volume's place in the layout (base, dims) out of the map, their slots freed: the box in bricks
    const clear = (base, dims) => {
      const b = base.map((n) => n / 8), e = dims.map((n, a) => b[a] + Math.ceil(n / 8));
      for (let z = b[2]; z < e[2]; z++) for (let y = b[1]; y < e[1]; y++) for (let x = b[0]; x < e[0]; x++) {
        const bk = (z * BY + y) * BX + x, w = bricks[bk];
        if (w >>> 24) { const k = (w & 0xffffff) - 1; used[k] = 0; if (k < lw) lw = k; inUse--; }
        bricks[bk] = 0;
      }
      return b.concat(e);
    };

    // static volumes shade the sun volume: splat their voxels into the coarse occupancy (foliage half weight),
    // at the size they are drawn (1 / fine of their voxel scale: fine heroes and critters, chunky toys)
    const [CX, CY, CZ] = T.cdims, CPU = T.CPU, acc = new Float32Array(CX * CY * CZ);
    const FOL = new Set((CT.sunShadeHalf || []).map((n) => pal.ids[n]).filter((i) => i !== undefined));
    for (const s of statics) {
      const v = vols[s.frames[0]], [nx, ny, nz] = v.dims, [ox, oy, oz] = v.box, p = s.place, U = VS * v.fine, w = (CPU / U) ** 3; // w: one drawn voxel's share of a cell
      for (let z = 0; z < nz; z++) for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) {
        const m = v.mat(xx, yy, z);
        if (!m) continue;
        let lx = (ox + xx + 0.5) / U, ly = (oy + yy + 0.5) / U;
        if (p.flip) [lx, ly] = [ly, lx];
        if (p.rot) [lx, ly] = ME.rotQ(lx, ly, p.rot);
        const cx = Math.floor((p.X + lx - T.O[0]) * CPU), cy = Math.floor((p.Y + ly - T.O[1]) * CPU), cz = Math.floor((p.Z + (oz + z + 0.5) / U - T.O[2]) * CPU);
        if (cx < 0 || cy < 0 || cz < 0 || cx >= CX || cy >= CY || cz >= CZ) continue;
        acc[(cz * CY + cy) * CX + cx] += FOL.has(m) ? 0.48 * w : w;
      }
    }
    // kept in T.splat so a carve's refill (ME.coarseFill) adds it back
    const splat = new Uint8Array(acc.length);
    for (let i = 0; i < acc.length; i++) if (acc[i]) { splat[i] = Math.min(255, Math.round(acc[i] * 255)); T.coarse[i] = Math.min(255, T.coarse[i] + splat[i]); }
    T.splat = splat;
    // (E4: the models after the first progressive one keep their volume, and their copy its interior, till the
    // upgrade's end: their copy is made again if the full bakes reorder its ties)
    const relod = [];
    if (prog && lods.length) { const i0 = Math.min(...gOf.keys()); vols.forEach((v, i) => { if (i > i0 && !gOf.has(i)) relod.push({ i, v: { dims: v.dims, bmap: v.bmap, chunks: v.chunks }, inner: lods[i].inner }); }); }
    for (const v of all) v.bmap = v.chunks = v.mat = v.inner = null;

    // point lights from emissive primitives of static volumes, at their drawn offsets (md.k / fine)
    const lights = [];
    for (const s of statics) {
      const md = vols[s.frames[0]].md, K = md.k / vols[s.frames[0]].fine, groups = {};
      for (const p of md.prims) if (LIGHT_COL[p.m]) (groups[p.m] = groups[p.m] || []).push(p);
      for (const m in groups) {
        const g = groups[m], c = [0, 0, 0];
        for (const p of g) { c[0] += p.x / g.length; c[1] += p.y / g.length; c[2] += p.z / g.length; }
        let lx = c[0] * K, ly = c[1] * K;
        if (s.place.flip) [lx, ly] = [ly, lx];
        if (s.place.rot) [lx, ly] = ME.rotQ(lx, ly, s.place.rot);
        const col = LIGHT_COL[m];
        lights.push({ p: [s.place.X + lx, s.place.Y + ly, s.place.Z + c[2] * K], r: col[4], col: col.slice(0, 3), k: col[3], mat: m });
      }
    }

    // h and r in world units (a fine model is drawn at 1/fine scale)
    // lod: model i's 2x-down copy in MB.lods (its base and dims in the atlas, lo and hi its voxels' bounds), -1 for none
    const models = vols.map((v, i) => ({ name: v.name, base: v.base, dims: v.dims, box: v.box, lo: v.lo, hi: v.hi, k: v.md.k, fine: v.fine, ...(v.kf ? { kf: v.kf } : {}), h: (v.md.h * v.md.k) / v.fine, r: (v.md.r * v.md.k) / v.fine, lod: lods.length ? i : -1 }));
    // bricks: the pool's; budget: ME.poolBricks(); fill: their share of it (%); hollow: the interior bricks kept out of it (models
    // and copies), the models' ones in MB.inner, the ms to find them; slab: S; mapMB: the brick map's texture
    const stats = { variants: vols.length, layout: [AX, AY, AZ], bricks: nb, budget, fill: +((nb / budget) * 100).toFixed(1), hollow: { bricks: hollowN, inner: inner ? inner.mats.length / 512 : 0, ms: Math.round(hollowMs) }, slab: PB, pool: [PX, PY, PZ], poolMB: +((pool.byteLength / 1048576).toFixed(1)), mapMB: +((bricks.byteLength / 1048576).toFixed(1)), solid, surface: vols.reduce((a, v) => a + v.surf, 0), lights: lights.length, lod: { models: lods.length, bricks: lodBricks }, lodMs: Math.round(lodMs), workers: ws.length, inWorkers, offWorker, early: how, startMs: run ? Math.round(run.startMs) : 0, idleMs: run ? Math.round(run.idleMs) : 0, busyMs: run ? Math.round(run.busyMs) : 0, readyMs: Math.round(readyMs), waitMs: Math.round(waitMs), hereMs: Math.round(hereMs), takeMs: Math.round(takeMs), ms: Math.round(ME.now() - t0), ...(sp ? { prog: sp } : {}) };
    const MB = { atlas: pool, adims: [PX, PY, PZ], bricks, bdims: [BX, BY, BZ], inner, models, lods: lods.map((l) => ({ base: l.base, dims: l.dims, lo: l.lo, hi: l.hi })), statics, walkerTypes, walkerFrames, critterFrames, extraFrames, lights, stats };
    MB.voxel = ME.brickVoxel(MB);
    if (prog) MB.prog = progOf2();
    return MB;

    // E4: MB.prog, a progressive bake's upgrade: { maxGroup (the most models one swap takes), started, stats (sp:
    // stats.prog), upgraded (a promise: true once every flipbook is swapped, false if one failed or it was
    // cancelled), cancel() (ends the workers; safe twice), gen(R), compact() (compactOf: MB for the bake cache) }. R.init
    // runs gen on R.addTask: for each
    // flipbook, in variant order, each frame's full bake taken in from its worker (numbered and painted here, a
    // slice a frame), sent back for its interior and its 2x-down copy (finishOf; here if no worker is left), put
    // into free slots and its proxy's place in the layout, then the touched pool layers and map boxes uploaded,
    // the palette too if it grew, and R.swapModel. Once the fade is done the coarse frames' places are cleared and
    // their slots freed. A frame that fails (its full bake lost, or no room) leaves that flipbook coarse.
    function progOf2() {
      let cancelled = false, finish;
      const upgraded = new Promise((r) => (finish = r)), maxGroup = Math.max(...prog.map((g) => g.vs.length));
      const cancel = () => { if (cancelled) return; cancelled = true; run.stop(); finish(false); };
      const gen = function* (R) {
        // palN: the materials R's tables hold (the app built them from pal after the bake)
        let ok = true, palN = pal.names.length;
        try {
          // the frames settle first (ME.PROG_SETTLE above; sp.settle: the ms it took)
          for (let t0 = ME.now(), last = t0, calm = 0; calm < ME.PROG_SETTLE && last - t0 < ME.PROG_SETTLE_MAX; ) {
            yield "frame";
            const n = ME.now(), d = n - last;
            last = n; calm = d > ME.PROG_HITCH ? 0 : calm + d; sp.settle = Math.round(n - t0);
          }
          if (cancelled) { ok = false; return; }
          // then the full bakes (launch), one a worker: a frame's finishing job, put first in the queue, then goes
          // to the first worker done, not behind the full bakes already posted (ME.bakeJobDepth of them)
          run.depth = 1;
          run.add(h.full);
          for (const g of prog) {
            if (cancelled) { ok = false; break; }
            const tg = ME.now(), cur = lists.slice(), recs = [], lrecs = [], put = [], boxes = [];
            let fail = null, wait = 0, got = 0;
            for (const i of g.vs) {
              const { md, vf } = mds[i], px = vols[i].px, lp = lods.length ? lods[i].px : null;
              let t = ME.now();
              const r = yield res.get(nv + i);
              wait += ME.now() - t;
              if (cancelled) { fail = "cancelled"; break; }
              if (!r) { fail = "its full bake failed"; break; }
              if (r.dims.some((n, a) => n !== px.dims[a])) { fail = `its full bake is ${r.dims} voxels, not the ${px.dims} it has room for`; break; }
              const list = [];
              yield* takeIn(r, md, list);
              cur[i] = list;
              setEmi();
              // its interior and its copy, in a worker (copies of the buffers go, so a lost worker loses nothing)
              const q = { finish: true, id: 2 * nv + i, buf: r.buf, nb: r.nb, bmap: r.bmap, dims: r.dims, hollow: hollow && VS * vf > ME.POOL_HOLLOW, lod: !!lp, emi, rk: rankOf(cur, n0) };
              let f = null;
              if (h.ws.length) {
                const qc = Object.assign({}, q, { buf: q.buf.slice(), bmap: q.bmap.slice() });
                run.add([{ id: q.id, name: variants[i].name, q: qc, tr: [qc.buf.buffer, qc.bmap.buffer], miss: "finished on the main thread" }], true);
                t = ME.now();
                f = yield run.out.get(q.id);
                wait += ME.now() - t;
                if (cancelled) { fail = "cancelled"; break; }
              }
              if (!f) f = finishOf(q)[0];
              const chunksOf = (buf, n) => Array.from({ length: n }, (_, k) => buf.subarray(k * 2048, k * 2048 + 2048));
              const fv = { base: px.base, pdims: px.pdims, bmap: f.bmap, chunks: chunksOf(f.buf, r.nb), inner: f.inner ? { is: f.inner, n: f.ninner } : null };
              const lv = lp && f.lod ? { base: lp.base, pdims: lp.pdims, bmap: f.lod.bmap, chunks: chunksOf(f.lod.buf, f.lod.nb), inner: f.lod.inner ? { is: f.lod.inner, n: f.lod.ninner } : null, copy: true } : null;
              const need = r.nb - f.ninner + (lv ? f.lod.nb - f.lod.ninner : 0);
              if (need > slots - inUse) { fail = `no room: ${need} bricks against the ${slots - inUse} free`; break; }
              // MB.inner grows by its interior bricks (doubling; trimmed at the end)
              if (f.ninner && (ni + f.ninner) * 512 > (inner ? inner.mats.length : 0)) {
                const m = new Uint8Array(Math.max(ni + f.ninner, ni * 2) * 512);
                if (inner) m.set(inner.mats.subarray(0, ni * 512));
                MB.inner = inner = { mats: m };
              }
              yield* putVol(fv, take);
              put.push([px.base, r.dims]);
              if (lv) { yield* putVol(lv, take); put.push([lp.base, f.lod.dims]); }
              recs.push({ name: variants[i].name, base: px.base, dims: r.dims, box: r.box, lo: fv.lo, hi: fv.hi, k: md.k, fine: vf, h: (md.h * md.k) / vf, r: (md.r * md.k) / vf, lod: MB.models[i].lod });
              lrecs.push(lv ? { base: lp.base, dims: f.lod.dims, lo: lv.lo, hi: lv.hi } : null);
              got += need;
            }
            if (cancelled) { ok = false; break; } // (the app is done with R: nothing more to upload)
            if (fail) {
              // the frames put so far out again; the flipbook stays coarse
              for (const [b, d] of put) boxes.push(clear(b, d));
              for (const b of boxes) R.uploadBricks(b);
              touched.clear();
              ok = false; sp.failed.push({ key: g.key, why: fail });
              if (!cancelled) ME.log(`WARN BAKE progressive ${g.key}: ${fail}; it stays at fine 1`);
              continue;
            }
            // up to the GPU: the pool layers written, the proxies' boxes of the map, the palette if it grew
            for (const bz of [...touched].sort((a, b) => a - b)) { R.uploadPool(bz); yield; }
            touched.clear();
            for (const [b, d] of put) { const o = b.map((n) => n / 8); R.uploadBricks(o.concat(d.map((n, a) => o[a] + Math.ceil(n / 8)))); }
            if (pal.names.length > palN) { R.refreshPalette(pal); palN = pal.names.length; }
            yield "frame";
            // the swap; the coarse frames' places (models and copies) are in use till its fade is done
            const old = g.vs.flatMap((i) => [[MB.models[i].base, MB.models[i].dims]].concat(lods.length ? [[MB.lods[i].base, MB.lods[i].dims]] : []));
            const at = ME.now();
            yield R.swapModel({ key: g.key, ids: g.vs, models: recs, lods: lrecs });
            for (const i of g.vs) lists[i] = cur[i];
            for (const [b, d] of old) boxes.push(clear(b, d));
            for (const b of boxes) R.uploadBricks(b);
            const s = { key: g.key, frames: g.vs.length, bricks: got, est: g.vs.reduce((a, i) => a + vols[i].est[0] + (lods.length ? vols[i].est[1] : 0), 0), wait: Math.round(wait), ms: Math.round(at - tg - wait), at: Math.round(at), done: Math.round(ME.now()) };
            sp.swaps.push(s);
            ME.log(`PROG ${g.key}: ${s.frames} frames at full density, ${got} bricks (est. ${s.est}), swapped at ${s.at} ms (${s.wait} ms waiting on the workers, ${s.ms} ms here)`);
          }
          if (cancelled) return;
          // the copies the full bakes' material order changes (halfOf's ties: rankOf) made again in their slots
          // (the same bricks: only a tie's material differs)
          const rkF = rankOf(lists, n0), same = (bk) => { const k = (bricks[bk] & 0xffffff) - 1; touched.add(Math.floor(k / (PB * PB))); return k; };
          // (none if a flipbook failed: the bake is no longer the single pass's)
          for (const { i, v, inner: li } of sp.failed.length ? [] : relod) {
            // its materials in id order (the order its copy was made in) against the single pass's (rkF)
            if (lists[i].slice().sort((a, b) => a - b).every((id, k, a) => !k || rkF[a[k - 1]] < rkF[id])) continue;
            v.mat = matOf(v);
            const l = halfOf(v, emi, rkF), L = MB.lods[i];
            l.inner = li; l.base = L.base; l.pdims = L.dims.map((n) => Math.ceil(n / 8) * 8); l.copy = true;
            yield* putVol(l, same);
            sp.relod = (sp.relod || 0) + 1;
          }
          relod.length = 0;
          for (const bz of [...touched].sort((a, b) => a - b)) { R.uploadPool(bz); yield; }
          touched.clear();
          if (inner && inner.mats.length > ni * 512) { MB.inner = inner = { mats: inner.mats.slice(0, ni * 512) }; MB.voxel = ME.brickVoxel(MB); }
          // the pool past its budget now (the copies kept on the estimate): no copies, as the single-pass bake
          if (lods.length && inUse > ME.poolBricks()) { for (const m of MB.models) m.lod = -1; R.refreshModels(); sp.lodDropped = true; ME.log(`WARN BAKE progressive: ${inUse} bricks, over the pool's budget: the 2x-down copies are dropped`); }
          // MB.stats.bricks and fill then tell the pool as it is (hollow, lod and the times stay the first bake's)
          stats.bricks = inUse; stats.fill = +((inUse / budget) * 100).toFixed(1);
          sp.doneAt = Math.round(ME.now());
        } catch (e) { ok = false; throw e; } finally { run.stop(); finish(ok && !cancelled); }
      };
      return { maxGroup, started: false, stats: sp, upgraded, cancel, gen, compact: () => compactOf(MB, slabOf) };
    }
  };

  // the private functions a model bake depends on, for the bake cache's key (src/cache.js)
  ME.bakeModels.parts = [bricksOf, matOf, innerOf, halfOf, workerJob, finishOf, estOf, runJobs, listOf, modelsOf, launch, workersOn, notData, defOf, sigOf, progOf, compactOf, rankOf, progOn, hollowOn];

  // Starts a bake's worker jobs before the terrain bake, so the workers run during it (#185): the variant list
  // from st (ME.volumeDecoOf, the props bakeTerrain bakes as volumes), the models built, the jobs posted. Returns
  // a handle for ME.bakeModels(T, st, pal, opts, early) at once, with the same st, pal and opts; a caller that
  // never reaches it calls early.cancel(). It reads pal only for its default material and numbers no material.
  ME.bakeModels.start = (st, pal, opts = {}) => launch(listOf(ME.volumeDecoOf(st), st, opts), pal, opts);

  // Material byte of voxel (x, y, z) of model mi (0 = empty), through the brick map into the pool (PB x PB
  // bricks per pool layer, PB = MB.adims[0] / 8), or into MB.inner for an interior brick (an entry with no octant
  // byte). It holds MB's arrays as they are now: a swap (R.swapModel) that replaces them sets a new MB.voxel.
  ME.brickVoxel = (MB) => {
    const { atlas: pool, bricks, models } = MB, [PX, PY] = MB.adims, [BX, BY] = MB.bdims, PB = PX / 8, mats = MB.inner && MB.inner.mats;
    return (mi, x, y, z) => {
      const [bx, by, bz] = models[mi].base, e = bricks[(((bz + z) >> 3) * BY + ((by + y) >> 3)) * BX + ((bx + x) >> 3)];
      if (!(e >>> 24)) return e ? mats[(e - 1) * 512 + ((z & 7) << 6) + ((y & 7) << 3) + (x & 7)] : 0;
      const k = (e & 0xffffff) - 1, qx = (k % PB) * 8 + (x & 7), qy = (Math.floor(k / PB) % PB) * 8 + (y & 7), qz = Math.floor(k / (PB * PB)) * 8 + (z & 7);
      return pool[((qz * PY + qy) * PX + qx) * 4 + 3];
    };
  };

  // Up to max of model mi's solid voxels, a uniform sample in random order: [x, y, z, material] at the voxel
  // centres in the model's frame (its box offset included), times s. It reads only the occupied bricks, so a
  // big model costs its bricks, not its whole box: a voxelsOf that scanned the box through MB.voxel took
  // 74 ms for the Heart Tree on a heart hit (Engine's boss-wave probe, 2026-10-24). A capped sample is drawn,
  // not scanned: a random cell of a random occupied brick, kept if solid and not drawn before, so it costs about
  // max / fill draws (the full scan of the Heart Tree's bricks still took 54 ms on a phone's first heart hit,
  // warm-up probe 2026-10-26). A model too sparse for that, or a cap near its size, is scanned as before.
  // (A seeded rnd draws differently since #335: the same seed picks other voxels than the old scan did.)
  ME.sampleVoxels = (MB, mi, max, s = 1, rnd = Math.random) => {
    const { atlas: pool, bricks, models } = MB, [PX, PY] = MB.adims, [BX, BY] = MB.bdims, PB = PX / 8;
    const m = models[mi], [bx, by, bz] = m.base, [nx, ny, nz] = m.dims, [ox, oy, oz] = m.box, out = [];
    if (m.kf) s *= m.kf; // a coarse model of a progressive bake (E4): its voxels are kf times bigger
    // the occupied bricks: [cx, cy, cz, qx, qy, qz, ii], ii >= 0 an interior brick in MB.inner (then q is unused)
    const occ = [], mats = MB.inner && MB.inner.mats;
    for (let cz = 0; cz < nz; cz += 8) for (let cy = 0; cy < ny; cy += 8) for (let cx = 0; cx < nx; cx += 8) {
      const e = bricks[(((bz + cz) >> 3) * BY + ((by + cy) >> 3)) * BX + ((bx + cx) >> 3)], k = (e & 0xffffff) - 1;
      if (e >>> 24) occ.push([cx, cy, cz, (k % PB) * 8, (Math.floor(k / PB) % PB) * 8, Math.floor(k / (PB * PB)) * 8, -1]);
      else if (e) occ.push([cx, cy, cz, 0, 0, 0, k]);
    }
    // the material at (x, y, z) & 7 of brick e
    const matOf = (e, lx, ly, lz) => e[6] >= 0 ? mats[e[6] * 512 + (lz << 6) + (ly << 3) + lx] : pool[(((e[5] + lz) * PY + e[4] + ly) * PX + e[3] + lx) * 4 + 3];
    if (max * 8 <= occ.length * 512) {
      const got = new Set();
      for (let tries = max * 64; out.length < max && tries > 0; tries--) {
        const b = Math.floor(rnd() * occ.length), i = Math.floor(rnd() * 512), e = occ[b], [cx, cy, cz] = e;
        const x = cx + (i & 7), y = cy + ((i >> 3) & 7), z = cz + (i >> 6);
        if (x >= nx || y >= ny || z >= nz || got.has(b * 512 + i)) continue;
        const mat = matOf(e, i & 7, (i >> 3) & 7, i >> 6);
        if (!mat) continue;
        got.add(b * 512 + i);
        out.push([(ox + x + 0.5) * s, (oy + y + 0.5) * s, (oz + z + 0.5) * s, mat]);
      }
      if (out.length === max) return out; // drawn in random order already
      out.length = 0;
    }
    let seen = 0;
    for (const e of occ) {
      const [cx, cy, cz] = e;
      for (let z = cz; z < Math.min(nz, cz + 8); z++) for (let y = cy; y < Math.min(ny, cy + 8); y++) for (let x = cx; x < Math.min(nx, cx + 8); x++) {
        const mat = matOf(e, x & 7, y & 7, z & 7);
        if (!mat) continue;
        // reservoir sampling: the i-th solid voxel takes a kept one's place with probability max / (i + 1)
        const j = seen < max ? seen : Math.floor(rnd() * (seen + 1));
        seen++;
        if (j < max) out[j] = [(ox + x + 0.5) * s, (oy + y + 0.5) * s, (oz + z + 0.5) * s, mat];
      }
    }
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
})();
