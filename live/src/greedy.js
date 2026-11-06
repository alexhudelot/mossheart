/* Greedy mesher: exposed voxel faces merged into quads by material (per-voxel variation is
   restored in the shader from the voxel coordinate). Faces pointing down are never visible from the
   isometric camera and are dropped. Vertices are 8 bytes: uint16 x,y,z (voxel units) + dir|mat<<3.
   For each 90-degree camera snap the visible quads (up and two sides) are sorted front to back into
   their own index range, so a snapped view is one draw call with good early-Z. */
(function () {
  const ME = window.ME;

  ME.greedyMesh = async function (T) {
    const t0 = ME.now(), { grid, NX, NY, NZ } = T, PLANE = NX * NY;
    // the voxels are read a plane or a row at a time from T.grid (pa, pb: two planes; rb: a row)
    const pa = new Uint8Array(PLANE), pb = new Uint8Array(PLANE), rb = new Uint8Array(NX);
    // the layers with terrain (each plane sampled every third cell); a layer of air bricks is skipped whole
    const air = (k) => { const t = grid.table, b = (k >> 4) * grid.BXY; for (let c = 0; c < grid.BXY; c++) if (t[b + c]) return false; return true; };
    const hit = (k) => { if (air(k)) return false; grid.plane(k, pa); for (let c = 0; c < PLANE; c += 3) if (pa[c]) return true; return false; };
    let kLo = NZ, kHi = 0;
    for (let k = 0; k < NZ; k++) if (hit(k)) { kLo = k; break; }
    for (let k = NZ - 1; k >= kLo; k--) if (hit(k)) { kHi = k; break; }
    kLo = Math.max(0, kLo - 1); kHi = Math.min(NZ - 1, kHi + 1);
    const ZN = kHi - kLo + 1;

    let cap = 1 << 18, nq = 0, V = new Uint16Array(cap * 16), CEN = new Float32Array(cap * 3), DIR = new Uint8Array(cap);
    const grow = () => {
      cap *= 2;
      const v2 = new Uint16Array(cap * 16); v2.set(V); V = v2;
      const c2 = new Float32Array(cap * 3); c2.set(CEN); CEN = c2;
      const d2 = new Uint8Array(cap); d2.set(DIR); DIR = d2;
    };
    const emit = (dir, mat, p0, p1, p2, p3) => {
      if (nq >= cap) grow();
      const w = dir | (mat << 3), o = nq * 16;
      V[o] = p0[0]; V[o + 1] = p0[1]; V[o + 2] = p0[2]; V[o + 3] = w;
      V[o + 4] = p1[0]; V[o + 5] = p1[1]; V[o + 6] = p1[2]; V[o + 7] = w;
      V[o + 8] = p2[0]; V[o + 9] = p2[1]; V[o + 10] = p2[2]; V[o + 11] = w;
      V[o + 12] = p3[0]; V[o + 13] = p3[1]; V[o + 14] = p3[2]; V[o + 15] = w;
      CEN[nq * 3] = (p0[0] + p2[0]) / 2; CEN[nq * 3 + 1] = (p0[1] + p2[1]) / 2; CEN[nq * 3 + 2] = (p0[2] + p2[2]) / 2;
      DIR[nq] = dir; nq++;
    };
    // Greedy merge of a W x H mask; quad(i, j, w, h, value) receives each rectangle.
    const merge = (mask, W, H, quad) => {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; ) {
        const n = i + j * W, c = mask[n];
        if (!c) { i++; continue; }
        let w = 1; while (i + w < W && mask[n + w] === c) w++;
        let h = 1;
        outer: for (; j + h < H; h++) for (let k = 0; k < w; k++) if (mask[n + k + h * W] !== c) break outer;
        quad(i, j, w, h, c);
        for (let l = 0; l < h; l++) mask.fill(0, n + l * W, n + l * W + w);
        i += w;
      }
    };

    // Each brick's occupancy: 0 all air, 1 all solid (whatever the materials), 2 both. Between two bricks of
    // class 0, or two of class 1, there is no face, so the masks below are only computed (and their rows only
    // read) over the rest; outside the grid is air. A skipped stretch of a mask stays zero: merge clears what it takes
    const { table, pool, BX, BY } = grid, cls = new Uint8Array(table.length);
    for (let b = 0; b < table.length; b++) {
      const e = table[b];
      if (e < 256) { cls[b] = e ? 1 : 0; continue; }
      const I = b % BX, J = Math.floor(b / BX) % BY, K = Math.floor(b / grid.BXY), s = (e - 256) * 4096;
      const n0 = Math.min(16, NX - I * 16), n1 = Math.min(16, NY - J * 16), n2 = Math.min(16, NZ - K * 16);
      let a = 0, f = 0;
      for (let z = 0; z < n2 && !(a && f); z++) for (let y = 0; y < n1 && !(a && f); y++) {
        const o = s + (z << 8) + (y << 4);
        for (let x = 0; x < n0; x++) if (pool[o + x]) f = 1; else a = 1;
      }
      cls[b] = a && f ? 2 : f;
    }
    const clsAt = (I, J, K) => (J < 0 || J >= BY || K < 0 || K >= grid.BZ ? 0 : cls[(K * BY + J) * BX + I]);
    const none = (a, b) => a === b && a !== 2; // no face between two bricks of these classes

    // +z faces: slice planes between z = s-1 and s
    let mask = new Int16Array(PLANE), below = pa, cur = pb;
    if (kLo > 0) grid.plane(kLo - 1, below); else below.fill(0);
    for (let s = kLo; s <= kHi + 1; s++) {
      if ((s & 15) === 0) { ME.progress("meshing tops " + s, 0.36 + 0.04 * ((s - kLo) / ZN)); await ME.tick(); }
      if (s < NZ) grid.plane(s, cur); else cur.fill(0);
      let any = false;
      const Ka = s > 0 ? (s - 1) >> 4 : -1, Kb = s < NZ ? s >> 4 : -1;
      for (let J = 0; J < BY; J++) for (let I = 0; I < BX; I++) {
        if (none(clsAt(I, J, Ka), clsAt(I, J, Kb))) continue;
        const i0 = I * 16, i1 = Math.min(NX, i0 + 16), j1 = Math.min(NY, J * 16 + 16);
        for (let j = J * 16; j < j1; j++) for (let c = j * NX + i0, c1 = j * NX + i1; c < c1; c++) { const va = below[c], vb = cur[c]; const m = va && !vb ? va : 0; mask[c] = m; any = any || m !== 0; }
      }
      [below, cur] = [cur, below];
      if (any) merge(mask, NX, NY, (i, j, w, h, c) => emit(4, c, [i, j, s], [i + w, j, s], [i + w, j + h, s], [i, j + h, s]));
    }
    // x faces: mask over (y, z) per slice s. A slab of XS slices is filled in one pass along the voxel rows
    // (reading the grid column-wise per slice was cache-hostile), then merged slice by slice; the slab's
    // masks are reused (merge leaves them zero). All NX + 1 slices at once was 2 bytes a voxel (~600 MB at vs40).
    ME.progress("meshing x sides", 0.4); await ME.tick();
    const XS = 32, SL = NY * ZN, xm = new Int16Array(XS * SL), xany = new Uint8Array(XS);
    for (let s0 = 0; s0 <= NX; s0 += XS) {
      ME.progress("meshing x sides " + s0, 0.4 + 0.04 * (s0 / NX)); await ME.tick();
      const s1 = Math.min(NX, s0 + XS - 1), r0 = Math.max(0, s0 - 1), r1 = Math.min(NX, s1 + 1);
      xany.fill(0);
      // a row of bricks all air, or all solid away from the grid's x ends, has no x face in this slab
      const I0 = r0 >> 4, I1 = (r1 - 1) >> 4, inner = s0 > 0 && s1 < NX;
      for (let z = 0; z < ZN; z++) for (let J = 0; J < BY; J++) {
        const b0 = (((z + kLo) >> 4) * BY + J) * BX;
        let c0 = 0, c1 = 0;
        for (let I = I0; I <= I1; I++) { const c = cls[b0 + I]; if (c === 0) c0++; else if (c === 1) c1++; }
        if (c0 === I1 - I0 + 1 || (inner && c1 === I1 - I0 + 1)) continue;
        for (let y = J * 16, y1 = Math.min(NY, y + 16); y < y1; y++) {
          const mo = y + z * NY;
          grid.row(y, z + kLo, r0, r1, rb);
          let va = s0 > 0 ? rb[s0 - 1 - r0] : 0;
          for (let s = s0; s <= s1; s++) {
            const vb = s < NX ? rb[s - r0] : 0;
            if (va !== vb && !(va && vb)) { xm[(s - s0) * SL + mo] = va ? va : -vb; xany[s - s0] = 1; }
            va = vb;
          }
        }
      }
      for (let s = s0; s <= s1; s++) {
        mask = xm.subarray((s - s0) * SL, (s - s0 + 1) * SL);
        if (xany[s - s0]) merge(mask, NY, ZN, (i, j, w, h, c) => {
          const z0 = j + kLo, z1 = z0 + h;
          if (c > 0) emit(0, c, [s, i, z0], [s, i + w, z0], [s, i + w, z1], [s, i, z1]);
          else emit(1, -c, [s, i, z0], [s, i + w, z0], [s, i + w, z1], [s, i, z1]);
        });
      }
    }
    // y faces: mask over (x, z). Rows s - 1 and s of every z are kept (ya, yb) and swapped, so each row is read once
    mask = new Int16Array(NX * ZN);
    let ya = new Uint8Array(NX * ZN), yb = new Uint8Array(NX * ZN);
    // a brick's stretch of row s is read where a face may lie on either side of it (sk: none between rows
    // s - 1 and s, sn: none between s and s + 1), and the mask computed where sk allows; what isn't read isn't used
    const KL = kLo >> 4, KN = (kHi >> 4) - KL + 1, sk = new Uint8Array(BX * KN), sn = new Uint8Array(BX * KN);
    const skips = (s, out) => {
      const Ja = s > 0 ? (s - 1) >> 4 : -1, Jb = s < NY ? s >> 4 : -1; // a row past the grid is air, even inside a brick
      for (let K = 0; K < KN; K++) for (let I = 0; I < BX; I++) out[K * BX + I] = s > NY || none(clsAt(I, Ja, K + KL), clsAt(I, Jb, K + KL)) ? 1 : 0;
    };
    for (let s = 0; s <= NY; s++) {
      if ((s & 31) === 0) { ME.progress("meshing y sides " + s, 0.44 + 0.04 * (s / NY)); await ME.tick(); }
      let any = false;
      skips(s, sk); skips(s + 1, sn);
      if (s < NY) for (let z = 0; z < ZN; z++) {
        const q = (((z + kLo) >> 4) - KL) * BX;
        for (let I = 0; I < BX; ) {
          if (sk[q + I] && sn[q + I]) { I++; continue; }
          let I1 = I + 1;
          while (I1 < BX && !(sk[q + I1] && sn[q + I1])) I1++;
          grid.row(s, z + kLo, I * 16, Math.min(NX, I1 * 16), yb, z * NX + I * 16);
          I = I1;
        }
      } else yb.fill(0);
      for (let z = 0; z < ZN; z++) {
        const q = (((z + kLo) >> 4) - KL) * BX;
        for (let I = 0; I < BX; I++) {
          if (sk[q + I]) continue;
          for (let c = z * NX + I * 16, c1 = z * NX + Math.min(NX, I * 16 + 16); c < c1; c++) {
            const va = ya[c], vb = yb[c];
            const m = va && !vb ? va : !va && vb ? -vb : 0;
            mask[c] = m; any = any || m !== 0;
          }
        }
      }
      [ya, yb] = [yb, ya];
      if (any) merge(mask, NX, ZN, (i, j, w, h, c) => {
        const z0 = j + kLo, z1 = z0 + h;
        if (c > 0) emit(2, c, [i, s, z0], [i + w, s, z0], [i + w, s, z1], [i, s, z1]);
        else emit(3, -c, [i, s, z0], [i + w, s, z0], [i + w, s, z1], [i, s, z1]);
      });
    }

    // Per-snap visible quads, sorted front to back by rotated depth (X'+Y'+Z).
    ME.progress("sorting quads per snap", 0.49); await ME.tick();
    const snaps = [], lists = [];
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2, c = Math.round(Math.cos(th)), s = Math.round(Math.sin(th));
      const vis = [c + s > 0, c + s < 0, c - s > 0, c - s < 0, true];
      const ids = [];
      for (let q = 0; q < nq; q++) if (vis[DIR[q]]) ids.push(q);
      const key = new Float32Array(nq);
      for (const q of ids) key[q] = (c + s) * CEN[q * 3] + (c - s) * CEN[q * 3 + 1] + CEN[q * 3 + 2];
      const arr = Uint32Array.from(ids).sort((a, b) => key[b] - key[a]);
      lists.push(arr); total += arr.length;
    }
    const IDX = new Uint32Array(total * 6);
    let o = 0;
    for (let k = 0; k < 4; k++) {
      snaps.push({ first: o, count: lists[k].length * 6 });
      for (const q of lists[k]) { const b = q * 4; IDX[o++] = b; IDX[o++] = b + 1; IDX[o++] = b + 2; IDX[o++] = b; IDX[o++] = b + 2; IDX[o++] = b + 3; }
    }
    return { verts: V.subarray(0, nq * 16), index: IDX, snaps, quads: nq, ms: Math.round(ME.now() - t0) };
  };
})();
