/* SDF evaluation and voxelisation of generator models.
   dPrim / evalModel are copied verbatim from vendor/gen/px.js (private there), plus a function prim (k: 5);
   the voxeliser samples them on a grid, skipping 4^3 bricks whose centre distance proves them all-empty or all-solid,
   and in the others evaluating only the prims that can matter there (cull). */
(function () {
  const ME = window.ME, P = window.PX, noise = P.noise, clamp = P.clamp;

  // ---- verbatim port of px.js dPrim / evalModel (EV_M = material of the nearest primitive)
  function dPrim(p, x, y, z) {
    let dx = x - p.x, dy = y - p.y, dz = z - p.z;
    if (p.R) { const R = p.R, lx = R[0] * dx + R[1] * dy + R[2] * dz, ly = R[3] * dx + R[4] * dy + R[5] * dz; dz = R[6] * dx + R[7] * dy + R[8] * dz; dx = lx; dy = ly; }
    switch (p.k) {
      case 0: return Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r;
      case 1: {
        const ax = dx / p.rx, ay = dy / p.ry, az = dz / p.rz;
        const k0 = Math.sqrt(ax * ax + ay * ay + az * az), k1 = Math.sqrt(ax * ax / (p.rx * p.rx) + ay * ay / (p.ry * p.ry) + az * az / (p.rz * p.rz));
        return k1 < 1e-9 ? -Math.min(p.rx, p.ry, p.rz) : (k0 * (k0 - 1)) / k1;
      }
      case 2: {
        let h = (dx * p.bx + dy * p.by + dz * p.bz) / p.bb; h = h < 0 ? 0 : h > 1 ? 1 : h;
        const qx = dx - p.bx * h, qy = dy - p.by * h, qz = dz - p.bz * h;
        return Math.sqrt(qx * qx + qy * qy + qz * qz) - (p.ra + (p.rb - p.ra) * h);
      }
      case 3: {
        const qx = Math.abs(dx) - p.hx, qy = Math.abs(dy) - p.hy, qz = Math.abs(dz) - p.hz;
        const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - p.r;
      }
      // engine extension (px.js has no such prim): a distance function in local coordinates that may set
      // p.m to the material at that point, e.g. a studio voxel layer (src/asset-format.js)
      case 5: return p.f(dx, dy, dz);
      default: {
        const a = Math.sqrt(dx * dx + dy * dy) - p.r + p.rr, b = Math.abs(dz) - p.hh + p.rr;
        const oa = a > 0 ? a : 0, ob = b > 0 ? b : 0;
        return Math.min(Math.max(a, b), 0) + Math.sqrt(oa * oa + ob * ob) - p.rr;
      }
    }
  }
  let EV_M = null;
  function evalModel(prims, x, y, z) {
    let d = 1e9, best = 1e9; EV_M = null;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      let e = dPrim(p, x, y, z);
      if (p.disp) e += (noise(x * p.df, y * p.df, z * p.df, 7) - 0.5) * p.disp;
      if (p.sub) { if (-e > d) { d = -e; if (p.subm) EV_M = p.subm; } continue; }
      if (e < best) { best = e; EV_M = p.m; }
      if (p.k2) { const h = clamp(0.5 + (0.5 * (e - d)) / p.k2, 0, 1); d = e + (d - e) * h - p.k2 * h * (1 - h); }
      else if (e < d) d = e;
    }
    return d;
  }

  // ---- prim culling: the prims that can change the distance (or also the nearest material) anywhere in a
  // ball of radius r (model units) around a point where all of them were just evaluated (evalRaw).
  // Over the ball each prim's distance stays in an interval around its value at the centre: its Lipschitz
  // bound times r, plus disp/2 for the displacement noise (in [0, 1)). The ellipsoid's estimate is not
  // Lipschitz near its centre, but it is g * (k0 - 1) with g = k0/k1 in [rmin, rmax] and k0 = |p / radii|
  // (1/rmin)-Lipschitz, which bounds it. Then evalModel's loop is walked with bounds: [Lo, U] on the running
  // distance d, B above the nearest distance. A union prim is dropped when it cannot lower d (e >= d, or
  // e - d >= k2 for a smooth one, whose blend weight is then 1) and, with MAT, cannot be the nearest; a
  // carving prim when it cannot raise d. Function prims (k: 5) have no bound and stay.
  // The kept prims run the same operations in the same order. Dropping a non-smooth or carving prim leaves
  // every bit as it was; dropping a smooth one at weight 1 skips d = e + (d - e), which can move d's last
  // bit. That is allowed only with SMOOTH: where a value is compared with a threshold (inside or not, AO),
  // never for normals (a difference of nearly equal distances: a component that is exactly 0 by symmetry
  // would flip the octahedral encoding). tools/cull-check.js compares the library byte for byte.
  const MAT = 1, SMOOTH = 2, INFO = new WeakMap();
  // per-prim constants, recomputed for every model at every bake (a studio edits prims in place)
  function setInfo(prims) {
    for (const p of prims) {
      let sc = 1, L, ell = null;
      if (p.R) { // a rotation keeps distances; any other linear map stretches them by at most its Frobenius norm
        const R = p.R;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2] - (i === j ? 1 : 0)) > 1e-9) sc = Math.hypot(...R);
      }
      switch (p.k) {
        case 0: case 3: L = 1; break; // exact distances
        case 1: { const a = Math.max(p.rx, p.ry, p.rz), b = Math.min(p.rx, p.ry, p.rz); L = b > 0 ? 0 : Infinity; ell = { a, b, kL: sc / b }; break; }
        case 2: L = p.bb > 0 ? 1 + Math.abs(p.rb - p.ra) / Math.sqrt(p.bb) : Infinity; break; // the radius changes along the axis
        case 5: L = Infinity; break;
        default: L = 1; // the rounded cylinder
      }
      if (p.k2 && !(p.k2 > 0)) L = Infinity;
      INFO.set(p, { L: L * sc, ell: L === Infinity ? null : ell, pad: (p.disp ? Math.abs(p.disp) / 2 : 0) + 1e-7 }); // pad: the noise, and rounding slack
    }
  }
  let RAW = new Float64Array(64);
  const CS = { calls: 0, prims: 0, kept: 0 }; // cull calls, the prims they saw and the ones they kept (ME.sdf.stats)
  // evalModel with the same operations, keeping each prim's distance before displacement in RAW
  function evalRaw(prims, x, y, z) {
    if (RAW.length < prims.length) RAW = new Float64Array(prims.length * 2);
    let d = 1e9, best = 1e9; EV_M = null;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      let e = (RAW[i] = dPrim(p, x, y, z));
      if (p.disp) e += (noise(x * p.df, y * p.df, z * p.df, 7) - 0.5) * p.disp;
      if (p.sub) { if (-e > d) { d = -e; if (p.subm) EV_M = p.subm; } continue; }
      if (e < best) { best = e; EV_M = p.m; }
      if (p.k2) { const h = clamp(0.5 + (0.5 * (e - d)) / p.k2, 0, 1); d = e + (d - e) * h - p.k2 * h * (1 - h); }
      else if (e < d) d = e;
    }
    return d;
  }
  // after evalRaw(prims, x, y, z): the prims that matter within r of (x, y, z) for mode (MAT, SMOOTH);
  // prims itself when all of them do
  function cull(prims, r, x, y, z, mode) {
    const keep = [], mat = mode & MAT, smooth = mode & SMOOTH;
    let U = 1e9, Lo = 1e9, B = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i], f = INFO.get(p);
      let lo, hi;
      if (f.ell) { // g * (k0 - 1), g in [b, a], k0 within kL * r of its value at the centre
        let dx = x - p.x, dy = y - p.y, dz = z - p.z;
        if (p.R) { const R = p.R, lx = R[0] * dx + R[1] * dy + R[2] * dz, ly = R[3] * dx + R[4] * dy + R[5] * dz; dz = R[6] * dx + R[7] * dy + R[8] * dz; dx = lx; dy = ly; }
        const { a, b, kL } = f.ell, k0 = Math.sqrt((dx / p.rx) ** 2 + (dy / p.ry) ** 2 + (dz / p.rz) ** 2), kl = Math.max(0, k0 - kL * r) - 1, kh = k0 + kL * r - 1;
        lo = kl >= 0 ? b * kl : a * kl; hi = kh <= 0 ? b * kh : a * kh;
      } else { const w = f.L * r; lo = RAW[i] - w; hi = RAW[i] + w; }
      lo -= f.pad; hi += f.pad;
      if (!(lo <= hi && hi - lo < Infinity)) { // unbounded: kept, and d may now be anything on the side it can move
        keep.push(p);
        if (p.sub || (p.k2 && !(p.k2 > 0))) U = Infinity;
        if (!p.sub) Lo = -Infinity;
        continue;
      }
      if (p.sub) {
        if (-lo <= Lo) continue; // -e <= -lo <= Lo <= d: never carves
        keep.push(p); U = Math.max(U, -lo); Lo = Math.max(Lo, -hi);
      } else {
        const lowers = p.k2 ? !smooth || lo - U < p.k2 : lo < U;
        if (!lowers && !(mat && lo < B)) continue; // never lowers d, never the nearest (or no material wanted)
        keep.push(p); B = Math.min(B, hi); U = Math.min(U, hi); Lo = Math.min(Lo, lo) - (p.k2 ? p.k2 / 4 : 0); // smin(d, e) is in [min - k2/4, min]
      }
    }
    CS.calls++; CS.prims += prims.length; CS.kept += keep.length;
    CUT_LO = Lo; // d >= Lo all over the ball
    return keep.length === prims.length ? prims : keep;
  }
  let CUT_LO = 0;

  // A model of the art set (window.MODELS) at its size: its own k, else the content's modelScale, else 1.
  // (x, y) turned by rot quarter turns counter-clockwise (from +x towards +y): a prop's at.rot. A placed
  // model is mirrored first (flip swaps x and y), then turned: world = rotQ(flip(local), rot).
  ME.rotQ = (x, y, rot) => { const r = rot & 3; return r === 0 ? [x, y] : r === 1 ? [-y, x] : r === 2 ? [-x, -y] : [y, -x]; };
  ME.modelOf = (name, o) => { const md = window.MODELS[name](o || {}); md.k = md.k ?? ((ME.content || {}).modelScale || {})[name] ?? 1; return md; };

  // Sample a model on a voxel grid.
  //   md: model, vs: voxels per world unit, box: [x0,y0,z0, nx,ny,nz] in voxels relative to the model origin,
  //   pal: palette (material name -> id), thr: solid if d < thr (keeps sub-voxel rails and lines).
  // Returns { n:[nx,ny,nz], mat:Uint8Array, d:Float32Array } with d sampled at voxel centres, and with culling
  // on, lists: per 4^3 brick sampled, the prims that set its voxels' distance and material.
  function sampleModel(md, vs, box, pal, thr) {
    const K = md.k, iK = 1 / K, prims = md.prims, [x0, y0, z0, nx, ny, nz] = box;
    const ev = (x, y, z) => evalModel(prims, x * iK, y * iK, z * iK) * K, evOf = (kp) => (kp === prims ? ev : (x, y, z) => evalModel(kp, x * iK, y * iK, z * iK) * K);
    const N = nx * ny * nz, mat = new Uint8Array(N), d = new Float32Array(N).fill(1e3);
    const B = 4, hd = ((B / vs) * Math.sqrt(3)) / 2 + 1e-4, hd2 = ((2 / vs) * Math.sqrt(3)) / 2 + 1e-4;
    // culling radii: a brick's voxel and sub-brick centres lie within 1.5 sqrt(3) voxels of its centre, a
    // sub-brick's voxel centres within sqrt(3)/2 of its own
    const on = ME.sdf.cull, rB = ((1.5 * Math.sqrt(3)) / vs + 1e-4) * iK, rS = ((0.5 * Math.sqrt(3)) / vs + 1e-4) * iK, lists = on ? new Map() : null, nbx = Math.ceil(nx / B), nby = Math.ceil(ny / B);
    const matId = (m) => pal.id(m || (ME.content || {}).defaultMaterial);
    if (on) setInfo(prims);
    // one brick; ks: the prims that matter over it (all of them, or its super-brick's list)
    const brick = (bx, by, bz, ks) => {
      const cx = (x0 + bx + B / 2) / vs, cy = (y0 + by + B / 2) / vs, cz = (z0 + bz + B / 2) / vs;
      const dc = on ? evalRaw(ks, cx * iK, cy * iK, cz * iK) * K : ev(cx, cy, cz);
      if (dc > hd + thr) return; // all empty
      const full = dc < -hd, mfull = full ? matId(EV_M) : 0;
      // the brick's sub-bricks evaluate only the prims that matter within it, and their voxels only those
      // that matter within the sub-brick
      const kp = on && !full ? cull(ks, rB, cx * iK, cy * iK, cz * iK, MAT | SMOOTH) : ks;
      if (on) lists.set(((bz / B) * nby + by / B) * nbx + bx / B, kp);
      // surface bricks: 2^3 sub-bricks proven empty are skipped (only empty: materials stay per voxel)
      for (let sz = bz; sz < Math.min(nz, bz + B); sz += 2) for (let sy = by; sy < Math.min(ny, by + B); sy += 2) for (let sx = bx; sx < Math.min(nx, bx + B); sx += 2) {
        let evs = ev;
        if (!full) {
          const qx = (x0 + sx + 1) / vs, qy = (y0 + sy + 1) / vs, qz = (z0 + sz + 1) / vs;
          if ((on ? evalRaw(kp, qx * iK, qy * iK, qz * iK) * K : ev(qx, qy, qz)) > hd2 + thr) continue;
          if (on) evs = evOf(cull(kp, rS, qx * iK, qy * iK, qz * iK, MAT | SMOOTH));
        }
        for (let z = sz; z < Math.min(nz, sz + 2); z++) for (let y = sy; y < Math.min(ny, sy + 2); y++) for (let x = sx; x < Math.min(nx, sx + 2); x++) {
          const i = (z * ny + y) * nx + x;
          if (full) { d[i] = -1e3; mat[i] = mfull; continue; }
          const e = evs((x0 + x + 0.5) / vs, (y0 + y + 0.5) / vs, (z0 + z + 0.5) / vs);
          d[i] = e;
          if (e < thr) mat[i] = matId(EV_M);
        }
      }
    };
    if (!on) { for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < ny; by += B) for (let bx = 0; bx < nx; bx += B) brick(bx, by, bz, prims); }
    else superBricks(prims, vs, iK, [x0, y0, z0], [nx, ny, nz], ((7.5 * Math.sqrt(3)) / vs + 1e-4) * iK, MAT | SMOOTH, (hd + thr) * iK, brick);
    return { n: [nx, ny, nz], mat, d, ev, evOf, lists };
  }

  // With culling, 4^3 bricks get their prims from their 16^3 super-brick: one whose distance is proven above
  // skip (model units) everywhere within r of its centre (CUT_LO) is skipped whole, the others hand their
  // bricks the super-brick's list. r must cover what each visit evaluates from that list. The bricks are
  // still visited in raster order: the palette numbers materials as it first meets them.
  function superBricks(prims, vs, iK, o, n, r, mode, skip, visit) {
    const SB = 16, B = 4, sx = Math.ceil(n[0] / SB), sy = Math.ceil(n[1] / SB), sz = Math.ceil(n[2] / SB), lists = new Array(sx * sy * sz);
    for (let qz = 0; qz < sz; qz++) for (let qy = 0; qy < sy; qy++) for (let qx = 0; qx < sx; qx++) {
      const cx = ((o[0] + qx * SB + SB / 2) / vs) * iK, cy = ((o[1] + qy * SB + SB / 2) / vs) * iK, cz = ((o[2] + qz * SB + SB / 2) / vs) * iK;
      evalRaw(prims, cx, cy, cz);
      const ks = cull(prims, r, cx, cy, cz, mode);
      lists[(qz * sy + qy) * sx + qx] = CUT_LO > skip ? null : ks; // null: every brick centre in it reads empty
    }
    for (let bz = 0; bz < n[2]; bz += B) for (let by = 0; by < n[1]; by += B) for (let bx = 0; bx < n[0]; bx += B) {
      const ks = lists[(Math.floor(bz / SB) * sy + Math.floor(by / SB)) * sx + Math.floor(bx / SB)];
      if (ks) visit(bx, by, bz, ks);
    }
  }

  // Find a tight voxel box for a model by scanning coarse bricks in a generous bound.
  function tightBox(md, vs) {
    const K = md.k, R = md.r * K * 1.6 + 0.15, H = md.h * K * 1.45 + 0.2, zlo = -0.45;
    const x0 = Math.floor(-R * vs), z0 = Math.floor(zlo * vs), nx = Math.ceil(2 * R * vs), nz = Math.ceil((H - zlo) * vs);
    const B = 4, hd = ((B / vs) * Math.sqrt(3)) / 2, iK = 1 / K, prims = md.prims;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const visit = (bx, by, bz, ks) => {
      const c = [(x0 + bx + B / 2) / vs, (x0 + by + B / 2) / vs, (z0 + bz + B / 2) / vs];
      if (evalModel(ks, c[0] * iK, c[1] * iK, c[2] * iK) * K > hd) return;
      const lo = [x0 + bx, x0 + by, z0 + bz];
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], lo[a]); mx[a] = Math.max(mx[a], lo[a] + B); }
    };
    if (!ME.sdf.cull) { for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < nx; by += B) for (let bx = 0; bx < nx; bx += B) visit(bx, by, bz, prims); }
    else { setInfo(prims); superBricks(prims, vs, iK, [x0, x0, z0], [nx, nx, nz], ((6 * Math.sqrt(3)) / vs + 1e-4) * iK, SMOOTH, hd * iK, visit); } // only brick centres: within 6 sqrt(3) voxels
    if (mn[0] > mx[0]) return [0, 0, 0, 1, 1, 1];
    return [mn[0] - 1, mn[1] - 1, mn[2] - 1, mx[0] - mn[0] + 2, mx[1] - mn[1] + 2, mx[2] - mn[2] + 2];
  }

  // A box in model units ([x0, y0, z0, x1, y1, z1]) as sampleModel's voxel box: the voxels whose centres it holds.
  function modelBox(md, vs, b) {
    const s = md.k * vs, lo = [0, 1, 2].map((a) => Math.round(b[a] * s)), hi = [0, 1, 2].map((a) => Math.max(lo[a] + 1, Math.round(b[a + 3] * s)));
    return [lo[0], lo[1], lo[2], hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  }

  // Normal (tetrahedral differences: 4 evaluations instead of 6) at a world-scaled point of a sampled model.
  function normalAt(ev, x, y, z, h) {
    const a = ev(x + h, y - h, z - h), b = ev(x - h, y - h, z + h), c = ev(x - h, y + h, z - h), d = ev(x + h, y + h, z + h);
    const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  // Voxelise a model for the ray-marched atlas: material, oct-encoded normal and baked AO per surface voxel.
  // o.box: [x0, y0, z0, x1, y1, z1] in model units, voxelised instead of the model's tight box (a bust, a focus
  // region); o.tv: the voxel size md.detail is told (model units; the voxel's own by default); o.focus: false
  // leaves out md.focus. md.contour(vx, pal) runs last, once, at this density. Normals and AO are the whole
  // model's SDF at each voxel's centre, focus or not.
  ME.voxelizeModel = function (md, vs, pal, o = {}) {
    // focus regions: their materials merged over the rest, and the cells they painted
    // (a page without src/reduce.js bakes plain, with one warning)
    if (md.focus && md.focus.length && o.focus !== false && !ME.reduce && !ME.reduceMissing) { ME.reduceMissing = true; (ME.log || console.warn)("WARN FOCUS: md.focus needs src/reduce.js on this page; baking without focus"); }
    const vx = voxelCore(md, vs, pal, { box: o.box, detail: !!md.detail }, md.focus && md.focus.length && o.focus !== false && ME.reduce ? focusRegions : null), F = vx.F;
    if (md.detail) paintDetail(md, vs, pal, vx, o.tv ?? 1 / (vs * md.k));
    delete vx.det; delete vx.F;
    if (F) vx.focus = F.reports;
    if (md.contour) md.contour(vx, pal);
    return vx;
  };

  // The closure-free part of voxelizeModel, which the bake workers run too (src/bake-models.js): the box, the
  // samples, focus regions (focus: focusRegions, on the main thread only), normals and AO. With o.detail, det
  // lists the surface voxels md.detail paints: their index, nearest material (by the sampling's prims, so null
  // where none is) and normal. md.detail itself runs after, in paintDetail, in the same raster order: the
  // palette numbers the materials it returns as it first meets them.
  function voxelCore(md, vs, pal, o, focus) {
    const box = o.box ? modelBox(md, vs, o.box) : tightBox(md, vs), S = sampleModel(md, vs, box, pal, 0.3 / vs), [nx, ny, nz] = S.n, [x0, y0, z0] = box;
    const N = nx * ny * nz, rgba = new Uint8Array(N * 4), K = md.k, h = 0.5 / vs;
    const F = focus ? focus(md, vs, pal, box, S) : null, MAT = F ? F.mat : S.mat, det = o.detail ? { idx: [], m: [], n: [] } : null;
    let solid = 0, surf = 0;
    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : MAT[(z * ny + y) * nx + x]);
    // with culling, per 4^3 brick that has surface voxels: the prims for its normals (exact: no smooth prim
    // dropped), narrowed again per 2^3 sub-brick; for its AO rays (out to 7 voxels, distance only); and the
    // sampling's list, for the material handed to md.detail
    const prims = md.prims, iK = 1 / K, on = ME.sdf.cull, nbx = Math.ceil(nx / 4), nby = Math.ceil(ny / 4), bricks = new Map();
    const s3 = Math.sqrt(3), rN = ((2 * s3) / vs + 1e-4) * iK, rNs = (s3 / vs + 1e-4) * iK, AO = [[1.5, 0.45], [3.5, 0.35], [7, 0.25]];
    const rF = AO.map(([t]) => ((1.5 * s3 + t) / vs + 1e-4) * iK); // a voxel of the brick, then out t voxels along its normal
    const brick = (x, y, z) => {
      const ib = ((z >> 2) * nby + (y >> 2)) * nbx + (x >> 2);
      let E = bricks.get(ib);
      if (!E) {
        const cx = ((x0 + (x & ~3) + 2) / vs) * iK, cy = ((y0 + (y & ~3) + 2) / vs) * iK, cz = ((z0 + (z & ~3) + 2) / vs) * iK;
        evalRaw(prims, cx, cy, cz);
        const near = cull(prims, rN, cx, cy, cz, 0), far = rF.map((r) => S.evOf(cull(prims, r, cx, cy, cz, SMOOTH)));
        bricks.set(ib, (E = { near, sub: [], far, mat: S.evOf(S.lists.get(ib) || prims) }));
      }
      return E;
    };
    const normalEv = (x, y, z) => { // the sub-brick's normal evaluator: its voxels and their tetrahedra lie within sqrt(3) voxels of its centre
      if (!on) return S.ev;
      const E = brick(x, y, z), si = ((z >> 1) & 1) * 4 + ((y >> 1) & 1) * 2 + ((x >> 1) & 1);
      if (!E.sub[si]) {
        const qx = ((x0 + (x & ~1) + 1) / vs) * iK, qy = ((y0 + (y & ~1) + 1) / vs) * iK, qz = ((z0 + (z & ~1) + 1) / vs) * iK;
        evalRaw(E.near, qx, qy, qz);
        E.sub[si] = S.evOf(cull(E.near, rNs, qx, qy, qz, 0));
      }
      return E.sub[si];
    };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x, m = MAT[i];
      if (!m) continue;
      solid++;
      rgba[i * 4 + 3] = m;
      if (at(x - 1, y, z) && at(x + 1, y, z) && at(x, y - 1, z) && at(x, y + 1, z) && at(x, y, z - 1) && at(x, y, z + 1)) { rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 255; continue; }
      surf++;
      const px = (x0 + x + 0.5) / vs, py = (y0 + y + 0.5) / vs, pz = (z0 + z + 0.5) / vs;
      const n = normalAt(normalEv(x, y, z), px, py, pz, h);
      if (det && !(F && F.done[i])) { (on ? brick(x, y, z).mat : S.ev)(px, py, pz); det.idx.push(i); det.m.push(EV_M); det.n.push(n[0], n[1], n[2]); }
      const o = octEnc(n); rgba[i * 4] = o[0]; rgba[i * 4 + 1] = o[1];
      // SDF ambient occlusion along the normal
      let occ = 0;
      const far = on && brick(x, y, z).far;
      for (let a = 0; a < 3; a++) { const [r, w] = AO[a], t = r / vs, dd = (on ? far[a] : S.ev)(px + n[0] * t, py + n[1] * t, pz + n[2] * t); occ += w * Math.max(0, (t - dd) / t); }
      rgba[i * 4 + 2] = Math.round(255 * clamp(1 - occ, 0, 1));
    }
    return { box, dims: [nx, ny, nz], rgba, solid, surf, det, F };
  }

  // md.detail over voxelCore's det, told the voxel size tv; get(i) and set(i, id) read and write voxel i's
  // material (the dense rgba by default; the bake workers' volumes come back as bricks)
  function paintDetail(md, vs, pal, vx, tv, get = (i) => vx.rgba[i * 4 + 3], set = (i, m) => { vx.rgba[i * 4 + 3] = m; }) {
    const K = md.k, [x0, y0, z0] = vx.box, [nx, ny] = vx.dims, { idx, m: em, n } = vx.det;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      const px = (x0 + x + 0.5) / vs, py = (y0 + y + 0.5) / vs, pz = (z0 + z + 0.5) / vs;
      const m2 = md.detail(px / K, py / K, pz / K, em[j] || pal.names[get(i)], n[j * 3], n[j * 3 + 1], n[j * 3 + 2], tv);
      if (m2) set(i, pal.id(m2));
    }
  }

  // md.focus = [{ zone | box, scale, rules }] (docs/decisions/2026-10-22-detail-tool.md, section 3): each region
  // voxelised alone at vs x scale, painted on its fine surface with tv the target voxel, reduced (ME.reduce) and
  // merged. A zone is the prims tagged p.zone with its name, merged over the model's untagged prims: each solid
  // zone cell replaces the cell under it. A box (model units) takes every prim and replaces its cells. Rules name
  // materials (weights { name: w }, keep [names]); a mirror plane is in model units. The coarse grid is fixed, so
  // nudge is off here (asym still reports). The scale is an integer 2-4 (clamped, with a FOCUS warning); a
  // region over ME.FOCUS_CELLS fine cells (2^24: about 10 bytes each while it is reduced) is skipped, its cells
  // left plain, with a FOCUS warning and skipped: true in its report. Returns { mat, done, reports }.
  function focusRegions(md, vs, pal, box, S) {
    const [x0, y0, z0, nx, ny, nz] = box, K = md.k, zones = new Set(md.focus.filter((f) => f.zone).map((f) => f.zone)), reports = [];
    const rest = zones.size ? md.prims.filter((p) => !zones.has(p.zone)) : null;
    const mat = !rest ? S.mat.slice() : rest.length ? sampleModel(Object.assign({}, md, { prims: rest }), vs, box, pal, 0.3 / vs).mat : new Uint8Array(S.mat.length), done = new Uint8Array(mat.length);
    const id = (n) => (typeof n === "number" ? n : pal.ids[n]), now = () => (ME.now ? ME.now() : performance.now());
    for (const f of md.focus) {
      const t0 = now(), s0 = f.scale ?? 2, s = Math.min(4, Math.max(2, Math.round(+s0) || 2)), prims = f.zone ? md.prims.filter((p) => p.zone === f.zone) : md.prims;
      if (s !== s0) (ME.log || console.warn)("FOCUS", { model: md.name || "", warn: "scale " + s0 + " is not an integer 2-4; using " + s });
      if (!prims.length) { reports.push({ zone: f.zone, box: f.box, scale: s, empty: true }); continue; }
      const zmd = Object.assign({}, md, { prims }), rb = f.zone ? tightBox(zmd, vs) : modelBox(md, vs, f.box);
      // the region within the model's box, in the model's voxels
      const lo = [0, 1, 2].map((a) => Math.max(rb[a], box[a])), hi = [0, 1, 2].map((a) => Math.min(rb[a] + rb[a + 3], box[a] + box[a + 3]));
      if (hi.some((v, a) => v <= lo[a])) { reports.push({ zone: f.zone, box: f.box, scale: s, empty: true }); continue; }
      const cn = [0, 1, 2].map((a) => hi[a] - lo[a]), vsf = vs * s, fb = [lo[0] * s, lo[1] * s, lo[2] * s, cn[0] * s, cn[1] * s, cn[2] * s];
      const fineN = fb[3] * fb[4] * fb[5], budget = ME.FOCUS_CELLS ?? 1 << 24;
      if (fineN > budget) {
        // too big to sample at scale: the plain bake's cells (the whole model's) under the region
        (ME.log || console.warn)("FOCUS", { model: md.name || "", warn: (f.zone ? "zone " + f.zone : "box") + " needs " + fineN + " fine cells (over " + budget + "); skipped, plain cells" });
        for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++) {
          const i = ((z - z0) * ny + (y - y0)) * nx + (x - x0);
          if (!done[i]) mat[i] = S.mat[i];
        }
        reports.push({ zone: f.zone, box: f.box, scale: s, cells: cn, fine: fineN, skipped: true, ms: Math.round(now() - t0) });
        continue;
      }
      // a subtractive prim of another zone, or of none, that reaches into this zone cuts only its own part
      const warn = [];
      if (f.zone) for (const p of md.prims) {
        if (!p.sub || p.zone === f.zone || warn.length >= 4) continue;
        search: for (let z = lo[2]; z < hi[2]; z++) for (let y = lo[1]; y < hi[1]; y++) for (let x = lo[0]; x < hi[0]; x++)
          if (dPrim(p, (x + 0.5) / vs / K, (y + 0.5) / vs / K, (z + 0.5) / vs / K) < 0) { warn.push("a subtractive prim" + (p.zone ? " of zone " + p.zone : "") + " reaches into zone " + f.zone + " without being in it"); break search; }
      }
      for (const w of warn) (ME.log || console.warn)("FOCUS", { model: md.name || "", warn: w });
      const FS = sampleModel(zmd, vsf, fb, pal, 0.3 / vsf), fine = FS.mat, [fx, fy, fz] = FS.n;
      // paint the fine surface (cells beside the region's edge count as inside), told the target voxel
      if (md.detail) {
        const hf = 0.5 / vsf, tv = 1 / (vs * K), solidAt = (x, y, z) => x < 0 || y < 0 || z < 0 || x >= fx || y >= fy || z >= fz || fine[(z * fy + y) * fx + x] !== 0;
        const paint = new Uint8Array(fine.length);
        for (let z = 0, i = 0; z < fz; z++) for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++, i++) {
          const m = fine[i];
          if (!m || (solidAt(x - 1, y, z) && solidAt(x + 1, y, z) && solidAt(x, y - 1, z) && solidAt(x, y + 1, z) && solidAt(x, y, z - 1) && solidAt(x, y, z + 1))) continue;
          const px = (fb[0] + x + 0.5) / vsf, py = (fb[1] + y + 0.5) / vsf, pz = (fb[2] + z + 0.5) / vsf, n = normalAt(FS.ev, px, py, pz, hf);
          FS.ev(px, py, pz);
          const m2 = md.detail(px / K, py / K, pz / K, EV_M || pal.names[m], n[0], n[1], n[2], tv);
          if (m2) paint[i] = pal.id(m2);
        }
        for (let i = 0; i < fine.length; i++) if (paint[i]) fine[i] = paint[i];
      }
      // a box's cut faces lie inside the model: outside its grid counts as solid, so they don't vote as surface
      const r = f.rules || {}, rules = { occ: r.occ, keep: (r.keep || []).map(id).filter((v) => v !== undefined), weights: {}, edge: f.zone ? "empty" : "solid" };
      for (const k in r.weights || {}) if (id(k) !== undefined) rules.weights[id(k)] = r.weights[k];
      if (r.mirror) rules.mirror = { p: r.mirror.p.map((v, a) => v * K * vsf - fb[a]), n: r.mirror.n };
      const R = ME.reduce(fine, { dims: FS.n, scale: s }, rules);
      for (let z = 0; z < cn[2]; z++) for (let y = 0; y < cn[1]; y++) for (let x = 0; x < cn[0]; x++) {
        const c = R.cells[(z * cn[1] + y) * cn[0] + x], i = ((lo[2] - z0 + z) * ny + (lo[1] - y0 + y)) * nx + (lo[0] - x0 + x);
        if (f.zone && !c) continue;
        mat[i] = c; done[i] = 1;
      }
      reports.push({ zone: f.zone, box: f.box, scale: s, cells: cn, fine: fine.length, changed: R.changed, lost: R.lost, merged: R.merged, asym: R.asym, warn, ms: Math.round(now() - t0) });
    }
    return { mat, done, reports };
  }

  // Stamp a placed model into a material grid (terrain bake). place: {X,Y,Z,flip}; grid: {vox,NX,NY,NZ,O,vs}, or
  // {bricks,NX,NY,NZ,O,vs} with bricks a ME.BrickGrid (the terrain bake: T.grid).
  ME.stampModel = function (md, place, grid, pal) {
    const { vs, O, NX, NY, NZ, vox, bricks } = grid, K = md.k, R = md.r * K * 1.6 + 0.2, H = md.h * K * 1.45 + 0.2;
    const ix0 = Math.max(0, Math.floor((place.X - R - O[0]) * vs)), ix1 = Math.min(NX, Math.ceil((place.X + R - O[0]) * vs));
    const iy0 = Math.max(0, Math.floor((place.Y - R - O[1]) * vs)), iy1 = Math.min(NY, Math.ceil((place.Y + R - O[1]) * vs));
    const foot = Math.max(0, Math.floor((place.Z - 0.45 - O[2]) * vs)), iz1 = Math.min(NZ, Math.ceil((place.Z + H - O[2]) * vs));
    const iK = 1 / K, prims = md.prims, ev = (x, y, z) => evalModel(prims, x * iK, y * iK, z * iK) * K;
    // local model coords for a world voxel centre (flip swaps the model's x and y, as P.flip does for sprites)
    const loc = (ix, iy, iz) => {
      const wx = O[0] + (ix + 0.5) / vs - place.X, wy = O[1] + (iy + 0.5) / vs - place.Y, wz = O[2] + (iz + 0.5) / vs - place.Z;
      const [rx, ry] = place.rot ? ME.rotQ(wx, wy, 4 - place.rot) : [wx, wy]; // undo the turn, then the mirror
      return place.flip ? [ry, rx, wz] : [rx, ry, wz];
    };
    // with culling, a brick's voxels evaluate the prims that matter within 1.5 sqrt(3) voxels of its centre
    const B = 4, hd = ((B / vs) * Math.sqrt(3)) / 2 + 1e-4, thr = 0.3 / vs, h = 0.5 / vs, on = ME.sdf.cull, rB = ((1.5 * Math.sqrt(3)) / vs + 1e-4) * iK;
    if (on) setInfo(prims);
    // Stamps reach down to the column under them (map format, M3): below the foot (0.45 tiles under the
    // prop), a column is stamped down to the top of what is under it, so a facade over a step or a ledge
    // meets the ground. On its own ground nothing changes. The blocks keep their places above the foot.
    const FX = ix1 - ix0, low = new Int32Array(Math.max(0, FX * (iy1 - iy0)));
    let lo = foot;
    for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) {
      let k = foot;
      while (k > 0 && !(bricks ? bricks.get(x, y, k - 1) : vox[((k - 1) * NY + y) * NX + x])) k--;
      low[(y - iy0) * FX + x - ix0] = k; lo = Math.min(lo, k);
    }
    const iz0 = foot - B * Math.ceil((foot - lo) / B);
    // per brick column, the lowest reach under it: a brick wholly below that is skipped before any SDF work
    const BX = Math.ceil(FX / B), lowB = new Int32Array(BX * Math.ceil((iy1 - iy0) / B)).fill(foot);
    for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) {
      const b = Math.floor((y - iy0) / B) * BX + Math.floor((x - ix0) / B);
      lowB[b] = Math.min(lowB[b], low[(y - iy0) * FX + x - ix0]);
    }
    let n = 0;
    for (let bz = iz0; bz < iz1; bz += B) for (let by = iy0; by < iy1; by += B) for (let bx = ix0; bx < ix1; bx += B) {
      if (bz + B <= lowB[((by - iy0) / B) * BX + (bx - ix0) / B]) continue;
      const c = loc(bx + B / 2 - 0.5, by + B / 2 - 0.5, bz + B / 2 - 0.5), dc = on ? evalRaw(prims, c[0] * iK, c[1] * iK, c[2] * iK) * K : ev(c[0], c[1], c[2]);
      if (dc > hd + thr) continue;
      const kp = on ? cull(prims, rB, c[0] * iK, c[1] * iK, c[2] * iK, MAT | SMOOTH) : prims, evb = kp === prims ? ev : (x, y, z) => evalModel(kp, x * iK, y * iK, z * iK) * K;
      for (let z = bz; z < Math.min(iz1, bz + B); z++) for (let y = by; y < Math.min(iy1, by + B); y++) for (let x = bx; x < Math.min(ix1, bx + B); x++) {
        if (z < low[(y - iy0) * FX + x - ix0]) continue;
        const [lx, ly, lz] = loc(x, y, z), e = evb(lx, ly, lz);
        if (e >= thr) continue;
        let m = EV_M;
        if (md.detail && e > -2 / vs) {
          const nn = normalAt(ev, lx, ly, lz, h); ev(lx, ly, lz);
          m = md.detail(lx / K, ly / K, lz / K, EV_M, nn[0], nn[1], nn[2], 1 / (vs * K)) || m;
        }
        const id = pal.id(m || (ME.content || {}).defaultMaterial);
        if (bricks) bricks.put(x, y, z, id); else vox[(z * NY + y) * NX + x] = id;
        n++;
      }
    }
    return n;
  };

  // Octahedral normal encoding to two bytes.
  function octEnc(n) {
    const s = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
    let x = n[0] / s, y = n[1] / s;
    if (n[2] < 0) { const ox = x, oy = y; x = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1); }
    return [Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255)];
  }
  ME.octEnc = octEnc;

  // what a bake worker runs voxelCore from (src/bake-models.js): px.js's clamp, hash and noise, this file's state
  // and the functions voxelCore calls. fade is px.js's own, copied (it is private there): the pool compares the
  // worker's noise with P.noise before it trusts it.
  const WORKER_FNS = [dPrim, evalModel, setInfo, evalRaw, cull, sampleModel, superBricks, tightBox, modelBox, normalAt, octEnc, voxelCore];
  const workerSrc = () => [
    "const clamp = " + P.clamp + ";", "const hash = " + P.hash + ";", "const fade = (t) => t * t * (3 - 2 * t);", "const noise = " + P.noise + ";",
    "let EV_M = null, RAW = new Float64Array(64), CUT_LO = 0;", "const MAT = 1, SMOOTH = 2, INFO = new WeakMap(), CS = { calls: 0, prims: 0, kept: 0 };",
    "const ME = { sdf: { cull: true }, content: {} };",
    ...WORKER_FNS.map(String),
  ].join("\n");

  // the private functions a voxelised model depends on, for the bake cache's key (src/cache.js), as
  // ME.bakeTerrain.parts
  ME.voxelizeModel.parts = [dPrim, evalModel, setInfo, evalRaw, cull, sampleModel, superBricks, tightBox, modelBox, normalAt, focusRegions, voxelCore, paintDetail, octEnc, workerSrc];

  // cull: false turns prim culling off (tools/cull-check.js compares the two)
  ME.sdf = { dPrim, evalModel, mat: () => EV_M, cull: true, setInfo, evalRaw, cullPrims: cull, MAT, SMOOTH, stats: CS, paintDetail, workerSrc, tightBox };
})();
