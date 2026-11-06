/* Simulation: the route the app gives (cellsOf ported from styles5.js), walkers that follow it over
   stairs and the bridge using the voxel ground height, props playing their flipbooks and swaying in the
   wind. Produces the per-frame instance table (affine local-voxel -> world and its inverse).
   Everything else that moves is an instance layer (sim.layers, written in order after the walkers):
   an object with writeInstances(time, sim, i, opts) that put()s its instances from index i and returns
   the next free index. The ambient critters are one; a game is another.
   avoid(x, y) marks a point the critters shy away from; wiltAt(x, y) 0..1, if set, makes props droop. */
(function () {
  const ME = window.ME;
  const INST_FLOATS = 28; // 6 x vec4 matrices + vec4u info
  const content = () => ME.content || {}, NONE = {};
  // 3x3 products into a scratch matrix (row-major, the same sums in the same order as before E9)
  const mul3 = (A, B, O) => { for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) O[r * 3 + k] = A[r * 3] * B[k] + A[r * 3 + 1] * B[3 + k] + A[r * 3 + 2] * B[6 + k]; return O; };
  const set9 = (O, a, b, c, d, e, f, g, h, i) => { O[0] = a; O[1] = b; O[2] = c; O[3] = d; O[4] = e; O[5] = f; O[6] = g; O[7] = h; O[8] = i; return O; };

  // Path cells in walking order, from polylines of cell corners (styles5.js cellsOf).
  const cellsOf = (pts) => {
    const out = [pts[0].slice()];
    for (let k = 0; k + 1 < pts.length; k++) {
      let [x, y] = pts[k]; const [x1, y1] = pts[k + 1];
      while (x !== x1 || y !== y1) { if (x !== x1) x += Math.sign(x1 - x); else y += Math.sign(y1 - y); out.push([x, y]); }
    }
    return out;
  };

  class Sim {
    // opts.capacity = instances beyond the static props
    // opts.route = the walkers' route, a polyline of tile corners ([[x, y], ...]); a generator map's
    //   default is its map.path[0]. No route: no walkers.
    // opts.routes = several routes ([route, ...]), one road each in sim.roads (in place of opts.route); the walkers take the first
    // opts.walkers = how many walkers (default ?units=, else 36)
    constructor(T, st, MB, opts = {}) {
      this.T = T; this.MB = MB; this.VS = T.VS;
      const map = st.map, routes = opts.routes && opts.routes.length ? opts.routes : [opts.route ?? (map.path && map.path[0])];
      this.roads = routes.map((r) => this.road(r));
      // the first road is the sim's own: its route, length and tiles, and at()
      const r0 = this.roads[0];
      this.route = r0.route; this.len = r0.len; this.cells = r0.cells;
      this.walkers = [];
      this.setCount(opts.walkers ?? ME.qn("units", 36));
      const cap = (this.capacity = opts.capacity ?? 640);
      this.inst = new Float32Array((MB.statics.length + cap) * INST_FLOATS);
      this.instU = new Uint32Array(this.inst.buffer);
      this.count = 0;
      this.wpos = new Float32Array(cap * 2);
      this.wn = 0;
      this.layers = [];
      this.wiltAt = null;
      // who wrote each instance, for pick: the static (index into MB.statics) per instance, the layers' runs
      this.sIdx = new Int32Array(MB.statics.length); this.spanL = []; this.spanA = []; this.spanB = []; this.spanN = 0; // each layer's instances this frame, [spanA, spanB) (no allocation per frame)
      // E9: put()'s scratch matrices, update()'s scratch vectors, and the statics update() rewrote this frame
      // ([dirty[0], dirty[1]); a static that stands still is neither rewritten nor uploaded). The still stamps are
      // this Sim's (the slot, model and place each static was last written with; slot -1: none), not the baked
      // statics', so a second Sim over the same MB writes everything once; stillN counts the skipped statics
      const NS = MB.statics.length;
      this.stillAt = new Int32Array(NS).fill(-1); this.stillMi = new Int32Array(NS); this.stillP = new Float64Array(NS * 5); this.stillN = 0;
      this.mx = { R: new Float64Array(9), P: new Float64Array(9), F: new Float64Array(9), S: new Float64Array(9), H: new Float64Array(9), A: new Float64Array(9), B: new Float64Array(9), C: new Float64Array(9), L: new Float64Array(9) };
      this.sh2 = [0, 0]; this.sc3 = [0, 0, 0]; this.at5 = [0, 0, 0, 0, 0]; this.dirty = [0, 0];
    }
    // A road from a route (a polyline of tile corners) on this sim's terrain: { cells, route, len, at(s, o) }.
    // cells: its tiles in walking order; route: the ground line at voxel spacing, smoothed; len: its length in
    // tiles; at(s, o): the point s tiles along it, as sim.at. It reads the terrain and changes nothing.
    road(route) {
      const T = this.T, VS = this.VS, cells = route && route.length ? cellsOf(route) : [];
      const TL = T.tiles, tz = (c) => TL.z[c[1] * TL.W + c[0]], isW = (c) => TL.recipe[c[1] * TL.W + c[0]] === "water" || (TL.wet && TL.wet[c[1] * TL.W + c[0]] === 1);
      // nominal height per cell; water cells take the higher bank around their crossing plus the bridge rise
      const zc = cells.map((c, i) => {
        if (!isW(c)) return tz(c);
        let a = i, b = i;
        while (a > 0 && isW(cells[a])) a--;
        while (b < cells.length - 1 && isW(cells[b])) b++;
        return Math.max(tz(cells[a]), tz(cells[b])) + 0.45;
      });
      // dense polyline at voxel spacing, ground from the voxel grid, then smoothed
      const pts = [];
      for (let i = 0; i + 1 < cells.length; i++) {
        const [x0, y0] = cells[i], [x1, y1] = cells[i + 1], n = VS;
        for (let s = 0; s < n; s++) {
          const u = s / n, X = x0 + 0.5 + (x1 - x0) * u, Y = y0 + 0.5 + (y1 - y0) * u;
          pts.push([X, Y, T.groundAt(X, Y, Math.max(zc[i], zc[i + 1]) + 0.6)]);
        }
      }
      const last = cells[cells.length - 1];
      if (last) pts.push([last[0] + 0.5, last[1] + 0.5, T.groundAt(last[0] + 0.5, last[1] + 0.5, zc[zc.length - 1] + 0.6)]);
      const sz = pts.map((_, i) => { let s = 0, w = 0; for (let k = -5; k <= 5; k++) { const p = pts[Math.min(pts.length - 1, Math.max(0, i + k))]; s += p[2]; w++; } return s / w; });
      // never sink below the raw ground (stair noses)
      const line = pts.map((p, i) => [p[0], p[1], Math.max(p[2], sz[i])]);
      // the road at arc length s: [x, y, z, dx, dy], into o if given (no allocation)
      const at = (s, o = [0, 0, 0, 0, 0]) => {
        const f = Math.max(0, Math.min(line.length - 1.001, s * VS)), i = Math.floor(f), u = f - i, a = line[i], b = line[i + 1];
        o[0] = a[0] + (b[0] - a[0]) * u; o[1] = a[1] + (b[1] - a[1]) * u; o[2] = a[2] + (b[2] - a[2]) * u; o[3] = b[0] - a[0]; o[4] = b[1] - a[1];
        return o;
      };
      return { cells, route: line, len: Math.max(0, line.length - 1) / VS, at };
    }
    // demo walkers, cycling through the content's walker kinds (ME.content.walkers)
    setCount(n) {
      n = Math.max(0, Math.min(500, n | 0));
      const H = window.PX.hash, WT = this.MB.walkerTypes || [];
      if (!WT.length || !this.route.length) n = 0;
      this.walkers = Array.from({ length: n }, (_, i) => ({
        type: WT[i % WT.length].type, w: WT[i % WT.length],
        s0: (i / Math.max(1, n)) * this.len,
        speed: WT[i % WT.length].speed * (0.85 + 0.3 * H(i, 1, 0, 3)),
        lat: (H(i, 2, 0, 3) - 0.5) * 0.34,
        ph: H(i, 3, 0, 3),
      }));
    }
    // a point the critters shy away from this frame
    avoid(x, y) { if (this.wn >= this.capacity) return; this.wpos[this.wn * 2] = x; this.wpos[this.wn * 2 + 1] = y; this.wn++; }
    // the first road at arc length s: [x, y, z, dx, dy], into o if given (no allocation)
    at(s, o) { return this.roads[0].at(s, o); }

    // Write one instance: model m, placement, yaw, flip, scale [sx,sy,sz], shear [hx,hy] (x += hx*z), flags,
    // and an optional pitch (raises the model's +x end; climbing squirrels, leaping koi).
    // mark (bits) and markV (a float) are the app's marks: a marked instance is shaded by the hookMark
    // shader hook (see ME.SHADER_HOOKS).
    // (E9: scalar math on scratch matrices, no allocation; the same arithmetic as before, so the same bytes)
    put(i, mi, X, Y, Z, yaw, flip, sc, sh, flags, pitch = 0, mark = 0, markV = 0) {
      const m = this.MB.models[mi], vs = this.VS / (m.kf || 1), c = Math.cos(yaw), s = Math.sin(yaw), M = this.mx;
      // L = R * F * S * H / vs ; t = L * box + [X,Y,Z] (vs: a coarse model of a progressive bake, m.kf, has voxels kf times bigger)
      set9(M.H, 1, 0, sh[0], 0, 1, sh[1], 0, 0, 1);
      set9(M.S, sc[0], 0, 0, 0, sc[1], 0, 0, 0, sc[2]);
      if (flip) set9(M.F, 0, 1, 0, 1, 0, 0, 0, 0, 1); else set9(M.F, 1, 0, 0, 0, 1, 0, 0, 0, 1);
      let R = set9(M.R, c, -s, 0, s, c, 0, 0, 0, 1);
      if (pitch) { const cp = Math.cos(pitch), sp = Math.sin(pitch); R = mul3(R, set9(M.P, cp, 0, -sp, 0, 1, 0, sp, 0, cp), M.A); }
      const L = mul3(mul3(mul3(R, M.F, M.B), M.S, M.C), M.H, M.L);
      for (let k = 0; k < 9; k++) L[k] = L[k] / vs;
      const b = m.box;
      const t0 = L[0] * b[0] + L[1] * b[1] + L[2] * b[2] + X, t1 = L[3] * b[0] + L[4] * b[1] + L[5] * b[2] + Y, t2 = L[6] * b[0] + L[7] * b[1] + L[8] * b[2] + Z;
      // inverse of the 3x3
      const a0 = L[0], a1 = L[1], a2 = L[2], a3 = L[3], a4 = L[4], a5 = L[5], a6 = L[6], a7 = L[7], a8 = L[8];
      const det = a0 * (a4 * a8 - a5 * a7) - a1 * (a3 * a8 - a5 * a6) + a2 * (a3 * a7 - a4 * a6), id = 1 / det;
      const i0 = (a4 * a8 - a5 * a7) * id, i1 = (a2 * a7 - a1 * a8) * id, i2 = (a1 * a5 - a2 * a4) * id, i3 = (a5 * a6 - a3 * a8) * id, i4 = (a0 * a8 - a2 * a6) * id;
      const i5 = (a2 * a3 - a0 * a5) * id, i6 = (a3 * a7 - a4 * a6) * id, i7 = (a1 * a6 - a0 * a7) * id, i8 = (a0 * a4 - a1 * a3) * id;
      const o = i * INST_FLOATS, f = this.inst;
      f[o] = a0; f[o + 1] = a1; f[o + 2] = a2; f[o + 3] = t0; f[o + 4] = a3; f[o + 5] = a4; f[o + 6] = a5; f[o + 7] = t1; f[o + 8] = a6; f[o + 9] = a7; f[o + 10] = a8; f[o + 11] = t2;
      f[o + 12] = i0; f[o + 13] = i1; f[o + 14] = i2; f[o + 15] = -(i0 * t0 + i1 * t1 + i2 * t2);
      f[o + 16] = i3; f[o + 17] = i4; f[o + 18] = i5; f[o + 19] = -(i3 * t0 + i4 * t1 + i5 * t2);
      f[o + 20] = i6; f[o + 21] = i7; f[o + 22] = i8; f[o + 23] = -(i6 * t0 + i7 * t1 + i8 * t2);
      const u = this.instU; u[o + 24] = mi; u[o + 25] = flags; u[o + 26] = mark; f[o + 27] = markV;
    }

    // the water a prop's anchor stands under (its tile's T.water quad, above the anchor), else null
    waterAt(p) {
      if (!this.wat) this.wat = new Map((this.T.water || []).map((w) => [w.x + "," + w.y, w]));
      const w = this.wat.get(Math.floor(p.X) + "," + Math.floor(p.Y));
      return w && w.z > p.Z + 0.02 ? w : null;
    }

    // wind: this frame's [strength, gust share] (R.windNow: the weather's on R.set's), else read from opts
    update(time, opts, wind = null) {
      const MB = this.MB, wk = wind ? wind[0] : opts.wind ? opts.windK ?? 1 : 0, gs = wind ? wind[1] : ME.gustOf(opts), [wx, wy] = ME.WIND_DIR, SWAY = content().sway || NONE;
      let i = 0, si = -1, lo = Infinity, hi = -1;
      const we = this.windE || (this.windE = [0, 0.5]); we[0] = wk; we[1] = gs; // (sim.windE: the layers' wind this frame)
      this.stillN = 0;
      const sh = this.sh2, sc = this.sc3;
      for (const s of MB.statics) {
        si++;
        if (s.hidden) { this.stillAt[si] = -1; continue; } // shattered into loose voxels (ME.VoxelPhysics.shatter); shown again, it is rewritten
        this.sIdx[i] = si;
        const p = s.place, n = s.frames.length, mi = s.frames[Math.floor(((time * 1.1 + s.phase) % 1) * n) % n];
        // lean downwind with the gust passing over, plus a faster flutter across it
        // (sway per prop: [lean per unit of gust, flutter, flutter rate]; shear = top shift / height)
        const sw = SWAY[p.name], wet = sw ? (s.wet === undefined ? (s.wet = this.waterAt(p)) : s.wet) : null;
        s.wsh = null;
        // a static standing still (one frame, no sway, kick or wilt), written last frame in the same slot with
        // the same model and place, keeps its instance: no rewrite, no upload
        const still = n === 1 && !wet && !(sw && wk) && !s.kick && !(sw && this.wiltAt);
        const SP = this.stillP, o5 = si * 5, rot = p.rot | 0, flip = p.flip ? 1 : 0;
        if (still && this.stillAt[si] === i && this.stillMi[si] === mi && SP[o5] === p.X && SP[o5 + 1] === p.Y && SP[o5 + 2] === p.Z && SP[o5 + 3] === rot && SP[o5 + 4] === flip) { this.stillN++; i++; continue; }
        sh[0] = 0; sh[1] = 0;
        if (wet || (sw && wk)) {
          const ph = p.X * 1.7 + p.Y * 1.1;
          let hx, hy;
          if (wet) {
            // under the water: the current, no gusts: a steady lean along the flow (a slow drift in still
            // water) and a slow sideways sway
            const fm = Math.hypot(wet.fx, wet.fy), an = fm > 0.01 ? Math.atan2(wet.fy, wet.fx) : ph + time * 0.07, cx = Math.cos(an), cy = Math.sin(an);
            const a = sw[0] * (0.45 + 0.35 * Math.sin(time * sw[2] * 0.3 + ph)), b = Math.sin(time * sw[2] * 0.45 + ph * 2.3) * (sw[1] + sw[0] * 0.3);
            hx = cx * a - cy * b; hy = cy * a + cx * b;
          } else {
            const g = ME.gust(p.X, p.Y, time, wk, gs);
            const a = g * sw[0] + Math.sin(time * sw[2] + ph) * sw[1] * wk, b = Math.sin(time * sw[2] * 1.37 + ph * 2.3) * sw[1] * 0.6 * wk;
            hx = wx * a - wy * b; hy = wy * a + wx * b;
          }
          // the shear is in the model's frame: undo the turn (ME.rotQ by 4 - rot, inline), then the mirror
          const q = p.rot ? (4 - p.rot) & 3 : 0, ux = q === 0 ? hx : q === 1 ? -hy : q === 2 ? -hx : hy, uy = q === 0 ? hy : q === 1 ? hx : q === 2 ? -hy : -hx;
          if (p.flip) { sh[0] = uy; sh[1] = ux; } else { sh[0] = ux; sh[1] = uy; }
          s.wsh = s.wshV || (s.wshV = [0, 0]); s.wsh[0] = hx; s.wsh[1] = hy; // world shift per unit height, for critters perched in the crown
        }
        // an app may shake a prop (s.kick = extra shear), and swaying plants wilt where wiltAt says
        if (s.kick) { sh[0] = sh[0] + s.kick[0]; sh[1] = sh[1] + s.kick[1]; }
        const k = 1 / MB.models[mi].fine; // 1 except chunky (low-density) volumes
        sc[0] = k; sc[1] = k; sc[2] = k;
        if (sw && this.wiltAt) {
          const b = this.wiltAt(p.X, p.Y);
          if (b > 0.01) { sc[0] = k * (1 + 0.06 * b); sc[1] = k * (1 + 0.06 * b); sc[2] = k * (1 - 0.2 * b); sh[0] = sh[0] + 0.07 * b; sh[1] = sh[1] - 0.05 * b; }
        }
        this.put(i, mi, p.X, p.Y, p.Z, p.rot ? (p.rot * Math.PI) / 2 : 0, p.flip, sc, sh, 0); // at.rot: the same turn as a stamp
        if (still) { this.stillAt[si] = i; this.stillMi[si] = mi; SP[o5] = p.X; SP[o5 + 1] = p.Y; SP[o5 + 2] = p.Z; SP[o5 + 3] = rot; SP[o5 + 4] = flip; } else this.stillAt[si] = -1;
        lo = Math.min(lo, i); hi = Math.max(hi, i); i++;
      }
      this.staticCount = i;
      this.dirty[0] = hi < 0 ? 0 : lo; this.dirty[1] = hi + 1;
      const A5 = this.at5;
      for (let w = 0; w < this.walkers.length; w++) {
        const u = this.walkers[w], s = (u.s0 + u.speed * time) % this.len, A = this.at(s, A5), X = A[0], Y = A[1], Z = A[2], dx = A[3], dy = A[4];
        const yaw = Math.atan2(dy, dx), nx = -Math.sin(yaw), ny = Math.cos(yaw);
        const fr = MB.walkerFrames[u.type], g = u.w.gait, ph = s * u.w.rate + u.ph, k = Math.floor((ph % 1) * fr.length);
        let hop = 0, sq = 0;
        if (g === "hop") { const a = Math.abs(Math.sin(ph * Math.PI * 2)); hop = a * 0.06; sq = (0.5 - a) * 0.12; }
        else if (g === "fly") hop = u.w.fly + Math.sin(time * 2.1 + u.ph * 6.3) * 0.05; // hover with a slow bob
        else sq = Math.sin(ph * Math.PI * 4) * 0.03;
        const px = X + nx * u.lat, py = Y + ny * u.lat, pz = Z + hop;
        sc[0] = 1 + sq * 0.5; sc[1] = 1 + sq * 0.5; sc[2] = 1 - sq; sh[0] = 0; sh[1] = 0;
        this.put(i++, fr[k], px, py, pz, yaw, false, sc, sh, 1);
        this.wpos[w * 2] = px; this.wpos[w * 2 + 1] = py;
      }
      this.wn = this.walkers.length;
      let ns = 0;
      for (const L of this.layers) { this.spanL[ns] = L; this.spanA[ns] = i; i = L.writeInstances(time, this, i, opts); this.spanB[ns++] = i; }
      this.spanN = ns;
      this.count = i;
      return i;
    }

    // The nearest instance a view ray ({ a, dir, L }: cam.ray) meets before tMax, by its model's voxel box
    // under the instance's affine as update() last wrote it: { t, p, n, layer, index } or null. layer is
    // "static" (index: into MB.statics), "walker" (into the route walkers) or the sim layer that wrote it
    // (index: from the first instance it wrote this frame). accept(layer, index), if given, skips an
    // instance it says false to (a cursor that wants units, not the lamp in front of them).
    pick(ray, tMax = ray.L, accept = null) {
      const f = this.inst, U = this.instU, { a, dir } = ray;
      let bt = tMax, bi = -1, bn = null;
      for (let i = 0; i < this.count; i++) {
        const o = i * INST_FLOATS + 12, d = this.MB.models[U[i * INST_FLOATS + 24]].dims;
        // the ray in the instance's local voxel space (the inverse affine; t is unchanged)
        const q = [0, 1, 2].map((r) => f[o + r * 4] * a[0] + f[o + r * 4 + 1] * a[1] + f[o + r * 4 + 2] * a[2] + f[o + r * 4 + 3]);
        const e = [0, 1, 2].map((r) => f[o + r * 4] * dir[0] + f[o + r * 4 + 1] * dir[1] + f[o + r * 4 + 2] * dir[2]);
        let t0 = 0, t1 = bt, ax = -1;
        for (let k = 0; k < 3 && t0 <= t1; k++) {
          if (Math.abs(e[k]) < 1e-12) { if (q[k] < 0 || q[k] > d[k]) t0 = Infinity; continue; }
          let ta = -q[k] / e[k], tb = (d[k] - q[k]) / e[k];
          if (ta > tb) [ta, tb] = [tb, ta];
          if (ta > t0) { t0 = ta; ax = k; }
          t1 = Math.min(t1, tb);
        }
        if (!(t0 <= t1) || t0 >= bt) continue; // NaN (a non-finite inverse) never hits
        if (accept) { const [L, k] = this.who(i); if (!accept(L, k)) continue; }
        // the face's world normal: row ax of the inverse (its transpose maps local normals to world)
        const sg = ax >= 0 ? -Math.sign(e[ax]) : 0, n = ax >= 0 ? [f[o + ax * 4] * sg, f[o + ax * 4 + 1] * sg, f[o + ax * 4 + 2] * sg] : [0, 0, 1], nl = Math.hypot(n[0], n[1], n[2]) || 1;
        bt = t0; bi = i; bn = [n[0] / nl, n[1] / nl, n[2] / nl];
      }
      if (bi < 0) return null;
      const [layer, index] = this.who(bi);
      return { t: bt, p: [a[0] + dir[0] * bt, a[1] + dir[1] * bt, a[2] + dir[2] * bt], n: bn, layer, index };
    }
    // which layer instance i belongs to and its index there: ["static", i in MB.statics], ["walker", i], [L, i]
    who(i) {
      if (i < this.staticCount) return ["static", this.sIdx[i]];
      if (i < this.staticCount + this.wn) return ["walker", i - this.staticCount];
      for (let k = 0; k < this.spanN; k++) if (i >= this.spanA[k] && i < this.spanB[k]) return [this.spanL[k], i - this.spanA[k]];
      return [null, -1];
    }
  }
  ME.Sim = Sim;
  ME.INST_FLOATS = INST_FLOATS;
})();
