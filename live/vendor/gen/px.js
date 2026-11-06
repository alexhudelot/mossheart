/* Pixel-art engine: palette-indexed buffers with depth, iso cube terrain,
   SDF models ray-marched straight to quantised pixels, pixel-space post. */
(function () {
  const P = (window.PX = {});
  const SQ3 = Math.sqrt(3);

  P.hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  P.ramp = (s) => s.trim().split(/\s+/).map(P.hex);
  P.rng = (seed) => { let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  P.clamp = clamp;
  P.smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ noise
  function hash(x, y, z, s) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x61c88647) ^ Math.imul((s | 0) + 1, 0x3c6ef372);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  P.hash = hash;
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y, z = 0, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const c = (a, b, d) => hash(xi + a, yi + b, zi + d, s);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
  }
  P.noise = noise;
  P.fbm = (x, y, z = 0, s = 0, o = 3) => { let a = 0, f = 1, amp = 0.5, n = 0; for (let i = 0; i < o; i++) { a += noise(x * f, y * f, z * f, s + i * 17) * amp; n += amp; f *= 2.03; amp *= 0.5; } return a / n; };
  // Nearest jittered feature point; returns a shared object (copy what you need).
  const CELL = { f1: 0, f2: 0, x: 0, y: 0, z: 0, id: 0 };
  P.cell = function (x, y, z, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let f1 = 9, f2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const px = cx + hash(cx, cy, cz, s), py = cy + hash(cx, cy, cz, s + 1), pz = cz + hash(cx, cy, cz, s + 2);
      const d = (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
      if (d < f1) { f2 = f1; f1 = d; CELL.x = px; CELL.y = py; CELL.z = pz; CELL.id = hash(cx, cy, cz, s + 3); } else if (d < f2) f2 = d;
    }
    CELL.f1 = Math.sqrt(f1); CELL.f2 = Math.sqrt(f2); return CELL;
  };
  P.cell2 = function (x, y, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const px = cx + 0.15 + 0.7 * hash(cx, cy, 0, s), py = cy + 0.15 + 0.7 * hash(cx, cy, 0, s + 1);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < f1) { f2 = f1; f1 = d; CELL.x = px; CELL.y = py; CELL.id = hash(cx, cy, 0, s + 3); } else if (d < f2) f2 = d;
    }
    CELL.f1 = Math.sqrt(f1); CELL.f2 = Math.sqrt(f2); return CELL;
  };
  // HD moss: shade a soft height field of cushions (no cells), darker in the hollows. Ln: light direction.
  P.velvetAt = function (td, X, Y, base, Ln) {
    const f = td.scale ?? 1.6, e = 0.02, sd = td.seed ?? 13;
    const hf = (x, y) => P.fbm(x * f, y * f, 0, sd, 3) + 0.4 * P.fbm(x * f * 3.3, y * f * 3.3, 0, sd + 50, 2);
    const h0 = hf(X, Y), gx = (hf(X + e, Y) - h0) / e, gy = (hf(X, Y + e) - h0) / e, amp = td.amp ?? 0.22;
    const nx = -gx * amp, ny = -gy * amp, nl = Math.sqrt(nx * nx + ny * ny + 1);
    let s = base + ((nx * Ln[0] + ny * Ln[1] + Ln[2]) / nl - Ln[2]) * (td.k ?? 1.1) + (h0 - 0.7) * (td.hk ?? 0.35);
    if (td.fuzz) s += (noise(X * 46, Y * 46, 0, 41) - 0.5) * td.fuzz + (noise(X * 110, Y * 110, 0, 42) - 0.5) * td.fuzz * 0.3;
    if (td.flowers && hash(Math.floor(X * 9), Math.floor(Y * 9), 0, 44) > 1 - td.flowers && Math.hypot((X * 9 % 1) - 0.5, (Y * 9 % 1) - 0.5) < 0.16) return { ramp: td.flowerRamp, s: 0.75 + (0.5 - (Y * 9 % 1)) * 0.6 };
    return { ramp: td.top2 && P.fbm(X * 0.45, Y * 0.45, 0, 29) > 1 - (td.mix ?? 0.3) ? td.top2 : td.top, s };
  };

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  P.bayer = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  // Shade 0..1 -> ramp index. "band" dithers only in a narrow band between two tones (hand-placed look).
  P.quant = function (s, n, x, y, mode) {
    const g = clamp(s, 0, 1) * (n - 1);
    let i = Math.floor(g); const r = g - i;
    if (mode === "bayer") { if (r > P.bayer(x, y)) i++; }
    else if (mode === "band") { if (r > 0.64 || (r > 0.36 && ((x + y) & 1))) i++; }
    else if (r >= 0.5) i++;
    return i > n - 1 ? n - 1 : i;
  };

  // ------------------------------------------------------------------ buffers
  class Buf {
    constructor(w, h) {
      this.w = w; this.h = h; const n = w * h;
      this.ri = new Int16Array(n).fill(-1); this.lv = new Int8Array(n); this.z = new Float32Array(n).fill(-1e9);
      this.em = new Uint8Array(n); this.tag = new Uint8Array(n);
    }
    put(x, y, ri, lv, z, em = 0, tag = 0) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      const i = y * this.w + x; if (z < this.z[i]) return false;
      this.ri[i] = ri; this.lv[i] = lv; this.z[i] = z; this.em[i] = em; this.tag[i] = tag; return true;
    }
  }
  P.Buf = Buf;

  P.palette = function (ramps) {
    const names = Object.keys(ramps), list = names.map((n) => ramps[n]), id = {};
    names.forEach((n, i) => (id[n] = i));
    return { names, list, id };
  };
  P.resolve = function (buf, pal) {
    const out = new Uint8ClampedArray(buf.w * buf.h * 4);
    for (let i = 0; i < buf.w * buf.h; i++) {
      const r = buf.ri[i]; if (r < 0) continue;
      const ramp = pal.list[r]; const c = ramp[clamp(buf.lv[i], 0, ramp.length - 1)];
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    }
    return out;
  };
  P.colorsUsed = function (buf, pal) {
    const set = new Set();
    for (let i = 0; i < buf.w * buf.h; i++) if (buf.ri[i] >= 0) set.add(pal.list[buf.ri[i]][clamp(buf.lv[i], 0, pal.list[buf.ri[i]].length - 1)].join(","));
    return set.size;
  };
  P.toURL = function (rgba, w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    return cv.toDataURL("image/png");
  };

  // ------------------------------------------------------------------ projection
  // Cell (cx, cy) spans world [cx, cx+1] x [cy, cy+1]; Z in cell units (one step = 0.5).
  P.view = (tw, ox, oy) => ({ tw, a: tw / 2, b: tw / 4, hz: tw / 2, ox, oy });
  P.proj = (v, X, Y, Z) => [v.ox + (X - Y) * v.a, v.oy + (X + Y) * v.b - Z * v.hz];

  // ------------------------------------------------------------------ SDF models
  P.prim = {
    S: (c, r, m, o) => Object.assign({ k: 0, x: c[0], y: c[1], z: c[2], r, m }, o),
    E: (c, rr, m, o) => Object.assign({ k: 1, x: c[0], y: c[1], z: c[2], rx: rr[0], ry: rr[1], rz: rr[2], m }, o),
    C: (a, b, ra, rb, m, o) => { const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2]; return Object.assign({ k: 2, x: a[0], y: a[1], z: a[2], bx, by, bz, bb: bx * bx + by * by + bz * bz || 1e-6, ra, rb, m }, o); },
    B: (c, h, r, m, o) => Object.assign({ k: 3, x: c[0], y: c[1], z: c[2], hx: h[0], hy: h[1], hz: h[2], r, m }, o),
    Y: (c, r, hh, m, o) => Object.assign({ k: 4, x: c[0], y: c[1], z: c[2], r, hh, rr: (o && o.round) || 0, m }, o),
  };
  // World-to-local matrix for an object rotated by `ang` about axis "x" | "y" | "z".
  P.rot = function (axis, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    if (axis === "x") return [1, 0, 0, 0, c, s, 0, -s, c];
    if (axis === "y") return [c, 0, -s, 0, 1, 0, s, 0, c];
    return [c, s, 0, -s, c, 0, 0, 0, 1];
  };
  P.rotMul = (A, B) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
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

  // Ray-march a model into its own pixel buffer. Anchor = world origin (0,0,0).
  P.renderModel = function (model, st, tw) {
    const v = P.view(tw, 0, 0), a = v.a, b = v.b, hz = v.hz;
    const K = model.k ?? 1, iK = 1 / K, R = model.r * K, H = model.h * K, prims = model.prims, pal = st.pal;
    const ev = (x, y, z) => evalModel(prims, x * iK, y * iK, z * iK) * K;
    const w = Math.ceil(2 * R * 1.42 * a) + 6, h = Math.ceil(H * hz + 2 * R * 1.42 * b) + 6;
    const ax = Math.floor(w / 2), ay = Math.ceil(H * hz + R * 1.42 * b) + 3;
    const buf = new Buf(w, h); buf.ax = ax; buf.ay = ay;
    const eps = 0.18 / a, ne = 0.45 / a;
    const L = st.L, Lx = L[0], Ly = L[1], Lz = L[2];
    const Z0 = H + 0.25;
    const matCache = {};
    const mat = (name) => matCache[name] || (matCache[name] = Object.assign({ ramp: name }, st.mats[name] || {}, { ri: pal.id[(st.mats[name] && st.mats[name].ramp) || name] }));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i + 0.5 - ax, vv = j + 0.5 - ay;
      const XmY = u / a, XpY = (vv + Z0 * hz) / b;
      let X = (XpY + XmY) / 2, Y = (XpY - XmY) / 2, Z = Z0;
      // Reject rays that never pass within R of the vertical axis.
      if (Math.abs(XmY) > R * 1.45) continue;
      let hit = false;
      for (let s = 0; s < 140; s++) {
        const d = ev(X, Y, Z);
        if (d < eps) { hit = true; break; }
        const st2 = Math.max(d * 0.85, eps * 0.6) / SQ3; X -= st2; Y -= st2; Z -= st2;
        if (Z < -0.3) break;
      }
      if (!hit) continue;
      const m0 = EV_M;
      let nx = ev(X + ne, Y, Z) - ev(X - ne, Y, Z);
      let ny = ev(X, Y + ne, Z) - ev(X, Y - ne, Z);
      let nz = ev(X, Y, Z + ne) - ev(X, Y, Z - ne);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let mname = model.detail ? model.detail(X * iK, Y * iK, Z * iK, m0, nx, ny, nz) : m0;
      const M = mat(mname);
      if (M.ri === undefined) throw new Error("ramp missing for material " + mname);
      const ramp = pal.list[M.ri];
      if (M.em) {
        const lv = M.flat ? ramp.length - 1 : clamp(ramp.length - 1 - (nz < 0.2 ? 1 : 0), 0, ramp.length - 1);
        buf.put(i, j, M.ri, lv, X + Y + Z, 1, 3); continue;
      }
      // Clumped surfaces (foliage, moss): bend the normal toward the nearest cluster centre.
      let cl = 0;
      if (M.clump) {
        const f = M.clump, c = P.cell(X * f, Y * f, Z * f, 3);
        let qx = X * f - c.x, qy = Y * f - c.y, qz = Z * f - c.z; const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
        const k = M.clumpK ?? 0.6;
        nx = nx * (1 - k) + (qx / ql) * k; ny = ny * (1 - k) + (qy / ql) * k; nz = nz * (1 - k) + (qz / ql) * k;
        const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l2; ny /= l2; nz /= l2;
        cl = 1 - P.smooth(0.02, 0.16, c.f2 - c.f1);
      }
      // Soft self-shadow toward the light.
      let sh = 1;
      if (st.selfShadow !== false) {
        let t = 3 * eps + 0.02;
        for (let s = 0; s < 22 && t < 1.6; s++) {
          const d = ev(X + nx * eps * 2 + Lx * t, Y + ny * eps * 2 + Ly * t, Z + nz * eps * 2 + Lz * t);
          sh = Math.min(sh, (6 * d) / t); if (sh < 0.02) break; t += Math.max(d, 0.03);
        }
        sh = clamp(sh, 0, 1);
      }
      const dif = nx * Lx + ny * Ly + nz * Lz, wrap = M.wrap ?? 0.25;
      const lit = Math.max(0, (dif + wrap) / (1 + wrap)) * (0.35 + 0.65 * sh);
      let s = (st.amb ?? 0.22) * (0.6 + 0.4 * nz) + (1 - (st.amb ?? 0.22)) * lit;
      s += (M.bias ?? 0) - cl * 0.18;
      if (M.rim) s += M.rim * Math.max(0, 1 - Math.abs(nx + ny + nz) / SQ3 * 1.6) * 0.6;
      const lv = P.quant(s, ramp.length, i, j, M.dither ?? st.spriteDither ?? "none");
      buf.put(i, j, M.ri, lv, X + Y + Z, 0, 3);
    }
    P.spritePost(buf, st);
    return buf;
  };

  // Clean stray pixels, add inner contour lines on depth breaks, then the outer outline.
  P.spritePost = function (buf, st) {
    const { w, h } = buf, ri = buf.ri, lv = buf.lv, z = buf.z;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
    // 1. lone pixels adopt their neighbours' tone
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (ri[i] < 0 || buf.em[i]) continue;
      const n = [i - 1, i + 1, i - w, i + w];
      if (n.every((k) => ri[k] === ri[i] && lv[k] === lv[n[0]] && lv[k] !== lv[i])) lv[i] = lv[n[0]];
    }
    // 2. inner lines where a nearer part overlaps a farther one
    const th = st.innerLine ?? 0.3;
    if (th > 0) {
      const mark = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (ri[i] < 0 || buf.em[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = at(x + dx, y + dy);
          if (k >= 0 && ri[k] >= 0 && z[k] - z[i] > th) { mark.push(i); break; }
        }
      }
      for (const i of mark) lv[i] = Math.max(0, Math.min(lv[i] - 2, 1));
    }
    // 3. outline
    const mode = st.outline || "none";
    if (mode === "none") return;
    for (let pass = 0; pass < (mode === "ink" ? st.outlineW ?? 1 : 1); pass++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (ri[i] >= 0) continue;
      let src = -1, lit = false;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const k = at(x + dx, y + dy);
        if (k >= 0 && ri[k] >= 0 && (buf.tag[k] !== 9 || pass > 0)) { if (src < 0 || z[k] > z[src]) { src = k; lit = dx > 0 || dy > 0; } }
      }
      if (src >= 0) add.push([i, src, lit]);
    }
    for (const [i, src, lit] of add) {
      if (mode === "ink") { ri[i] = st.pal.id.ink; lv[i] = 0; }
      else { ri[i] = buf.em[src] ? ri[src] : ri[src]; lv[i] = buf.em[src] ? Math.max(0, lv[src] - 2) : lit && (mode === "selout" || mode === "soft") ? 1 : 0; if (mode === "selout" && !lit && st.pal.id.ink !== undefined && !buf.em[src]) { ri[i] = st.pal.id.ink; lv[i] = 0; } }
      z[i] = z[src]; buf.tag[i] = 9;
    }
    }
  };

  P.flip = function (spr) {
    const o = new Buf(spr.w, spr.h); o.ax = spr.w - 1 - spr.ax + 1; o.ay = spr.ay;
    for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
      const i = y * spr.w + x, k = y * spr.w + (spr.w - 1 - x);
      o.ri[k] = spr.ri[i]; o.lv[k] = spr.lv[i]; o.z[k] = spr.z[i]; o.em[k] = spr.em[i]; o.tag[k] = spr.tag[i];
    }
    return o;
  };

  P.blit = function (buf, spr, sx, sy, zb, onPut) {
    const x0 = Math.round(sx) - spr.ax, y0 = Math.round(sy) - spr.ay;
    for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
      const i = y * spr.w + x; if (spr.ri[i] < 0) continue;
      if (buf.put(x0 + x, y0 + y, spr.ri[i], spr.lv[i], zb + spr.z[i], spr.em[i], 3) && onPut && !spr.em[i]) onPut((y0 + y) * buf.w + x0 + x, x0 + x, y0 + y);
    }
  };

  // Palette-correct drop shadow: terrain pixels in an iso ellipse drop two tones.
  P.dropShadow = function (buf, v, X, Y, Z, r, st) {
    const [sx, sy] = P.proj(v, X, Y, Z); const rx = r * 1.42 * v.a, ry = r * 1.42 * v.b, zb = X + Y + Z;
    for (let y = Math.floor(sy - ry); y <= sy + ry; y++) for (let x = Math.floor(sx - rx); x <= sx + rx; x++) {
      if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
      const i = y * buf.w + x; if (buf.tag[i] !== 1 && buf.tag[i] !== 7) continue;
      if (Math.abs(buf.z[i] - zb) > 0.7) continue;
      const q = ((x + 0.5 - sx) / rx) ** 2 + ((y + 0.5 - sy) / ry) ** 2; if (q > 1) continue;
      if (buf.tag[i] === 7) continue;
      // HD styles: a smooth falloff over many fine tones instead of a dithered two-tone ring.
      if (st.softShadow) { const kk = Math.round(st.softShadow * Math.pow(1 - q, 0.8)); if (kk > 0) { buf.lv[i] = Math.max(0, buf.lv[i] - kk); buf.tag[i] = 7; } continue; }
      const k = q > 0.6 ? (((x + y) & 1) ? 1 : 0) : 2;
      if (k) { buf.lv[i] = Math.max(0, buf.lv[i] - k); buf.tag[i] = 7; }
    }
  };

  // ------------------------------------------------------------------ terrain
  // map: { W, H, hgt[y][x] (steps), typ[y][x] (char), floor (steps), rings: [{x,y,R}] }
  P.renderMap = function (buf, map, st, v, occ) {
    const { a, b, hz, ox, oy } = v, pal = st.pal, T = st.terrain;
    const W = map.W, Hh = map.H;
    const H = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh || map.typ[y][x] === "_" ? -99 : map.hgt[y][x]);
    const ty = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh ? null : map.typ[y][x]);
    const zf = (map.floor ?? -2) * 0.5;
    const Ln = st.L, maxH = Math.max(...map.hgt.flat()) * 0.5 + 0.1;
    const waterDrop = Math.round((st.waterDrop ?? 0.14) * hz) / hz;
    const PK = v.tw / 32;
    occ = occ || [];
    function shadowAt(X, Y, Z) {
      let t = 0.06;
      for (let k = 0; k < 80; k++) {
        const x = X + Ln[0] * t, y = Y + Ln[1] * t, z = Z + Ln[2] * t;
        if (z > maxH) break;
        const hh = H(Math.floor(x), Math.floor(y));
        if (hh > -99 && hh * 0.5 > z + 0.01) return 1;
        t += 0.07;
      }
      let amt = 0;
      for (const o of occ) {
        const cx = o.x - X, cy = o.y - Y, cz = o.z - Z;
        const tca = cx * Ln[0] + cy * Ln[1] + cz * Ln[2]; if (tca < 0) continue;
        const d = Math.sqrt(Math.max(0, cx * cx + cy * cy + cz * cz - tca * tca));
        if (d < o.r) amt = Math.max(amt, P.smooth(o.r, o.r * 0.7, d));
        if (amt >= 1) break;
      }
      return amt;
    }
    const isW = (x, y) => ty(x, y) === "w";
    for (let cy = 0; cy < Hh; cy++) for (let cx = 0; cx < W; cx++) {
      const hs = H(cx, cy), t = ty(cx, cy), td = T[t] || T.m;
      if (t === "_") continue;
      const Zt = hs * 0.5 - (t === "w" ? waterDrop : 0);
      const sx = ox + (cx - cy) * a, sy = oy + (cx + cy) * b - Zt * hz;
      const x0 = Math.floor(sx - a), x1 = Math.ceil(sx + a), y0 = Math.floor(sy), y1 = Math.ceil(sy + 2 * b + (Zt - zf) * hz);
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        if (px < 0 || py < 0 || px >= buf.w || py >= buf.h) continue;
        const fx = px + 0.5 - ox, fy = py + 0.5 - oy, XmY = fx / a;
        let X, Y, Z, face = -1;
        const XpY = (fy + Zt * hz) / b;
        X = (XpY + XmY) / 2; Y = (XpY - XmY) / 2;
        if (X >= cx && X < cx + 1 && Y >= cy && Y < cy + 1) { face = 0; Z = Zt; }
        else {
          X = XmY + cy + 1; Y = cy + 1;
          if (X >= cx && X < cx + 1) { Z = ((X + Y) * b - fy) / hz; if (Z >= zf && Z <= Zt) face = 1; }
          if (face < 0) { X = cx + 1; Y = cx + 1 - XmY; if (Y >= cy && Y < cy + 1) { Z = ((X + Y) * b - fy) / hz; if (Z >= zf && Z <= Zt) face = 2; } }
        }
        if (face < 0) continue;
        let wallN = null;
        if (st.clip && Math.hypot(X - st.clip.x, Y - st.clip.y) > st.clip.r) {
          // round island: trim the cube staircase to a circle and draw the curved outer wall instead, up to
          // this cell's height (the nearest hit of the view ray R(t) = (X0 + t, Y0 + t, t) on the cylinder)
          const K = st.clip, X0 = (fy / b + XmY) / 2, Y0 = (fy / b - XmY) / 2, ex = X0 - K.x, ey = Y0 - K.y, p = ex + ey, disc = p * p - 2 * (ex * ex + ey * ey - K.r * K.r);
          if (disc <= 0) continue;
          const tw = (-p + Math.sqrt(disc)) / 2;
          X = X0 + tw; Y = Y0 + tw; Z = tw;
          if (Math.floor(X) !== cx || Math.floor(Y) !== cy || Z > Zt || Z < zf) continue;
          face = 3; wallN = [(X - K.x) / K.r, (Y - K.y) / K.r];
        }
        const depth = X + Y + Z, idx = py * buf.w + px;
        if (depth < buf.z[idx]) continue;
        let ramp = td.top, s, em = 0;
        if (face === 0) {
          const lx = X - cx, ly = Y - cy;
          const r = topTexture(td, X, Y, px, py, lx, ly, cx, cy, t);
          ramp = r.ramp; s = r.s; em = r.em || 0;
          if (!em) {
            // contact AO under taller neighbours
            const aoW = st.aoW ?? 0.16, aoK = st.aoK ?? 0.2;
            for (const [dx, dy, dist] of [[-1, 0, lx], [1, 0, 1 - lx], [0, -1, ly], [0, 1, 1 - ly]]) {
              const nh = H(cx + dx, cy + dy);
              if (nh > hs) s -= aoK * Math.max(0, 1 - dist / aoW) ** 1.5 * Math.min(1, (nh - hs) / 2);
            }
            if (st.bevel) {
              // rounded moss shoulders: near an edge that drops away, tilt the normal outward
              for (const [dx, dy, dist] of [[-1, 0, lx], [1, 0, 1 - lx], [0, -1, ly], [0, 1, 1 - ly]]) {
                if (H(cx + dx, cy + dy) >= hs || dist > st.bevel) continue;
                const q = 1 - dist / st.bevel;
                s += q * q * ((dx * Ln[0] + dy * Ln[1]) * 0.55 - 0.08);
              }
            } else {
              // lit lips on exposed front edges, faint rim on back edges
              if (H(cx, cy + 1) < hs && (1 - ly) * 2 * b < PK) s += st.lip ?? 0.16;
              if (H(cx + 1, cy) < hs && (1 - lx) * 2 * b < PK) s += (st.lip ?? 0.16) * 0.5;
              if (H(cx - 1, cy) < hs - 1 && lx * 2 * b < 1) s += 0.08;
              if (H(cx, cy - 1) < hs - 1 && ly * 2 * b < 1) s += 0.08;
            }
            const shd = shadowAt(X, Y, Z + 0.001);
            s -= shd * (st.shadowK ?? 0.3);
            if (st.light) s += P.lightMod(st, X, Y, Z, shd, 1);
            if (st.edgeInk && t !== "w") { const w = st.edgeInk / (2 * b); if ((H(cx, cy + 1) !== hs && 1 - ly < w) || (H(cx + 1, cy) !== hs && 1 - lx < w) || (H(cx - 1, cy) !== hs && lx < w) || (H(cx, cy - 1) !== hs && ly < w)) { ramp = "ink"; s = 0; } }
          }
        } else {
          const U = face === 1 ? X - cx : face === 2 ? Y - cy : Math.atan2(Y - st.clip.y, X - st.clip.x) * st.clip.r, dpx = (Zt - Z) * hz / PK;
          s = face === 1 ? st.sideL ?? 0.52 : face === 2 ? st.sideR ?? 0.28 : 0.4 + 0.45 * (wallN[0] * Ln[0] + wallN[1] * Ln[1]);
          ramp = td.side;
          // Water stepping down into lower water: a waterfall with foam where it lands.
          // With map.waterD only the part of the face under the actual stream falls (same wobble as the top).
          const wv = t !== "w" ? -1 : map.waterD ? map.waterD(X, Y) + (P.fbm(X * 1.3, Y * 1.3, 0, 61) - 0.5) * 0.3 : 1, wet = wv > 0;
          const fall = wet && face !== 3 && (face === 1 ? isW(cx, cy + 1) : isW(cx + 1, cy));
          if (wet && dpx < 2.5) { ramp = "water"; s -= 0.12; }
          const drip = !fall && td.drip && dpx < 1.5 + 4.5 * noise(U * a / 2.2 + (face === 1 ? cx : cy) * 9.3, face * 13 + (face === 1 ? cy : cx) * 3.1, 0, 5) * (td.dripK ?? 1);
          if (fall) {
            // A curtain of white water: long strands over darker water, a glassy lip, thinner at the
            // sides of the stream, churning white where it meets the pool below. With a "fall" ramp the
            // pixels also feed the falls layer the live board animates.
            const nb = (face === 1 ? H(cx, cy + 1) : H(cx + 1, cy)) * 0.5 - waterDrop, cid = face === 1 ? cx : cy, uu = U + cid, dz = Zt - Z;
            ramp = pal.id.fall !== undefined ? "fall" : "water";
            const str = noise(uu * 9, dz * 0.22 + uu * 0.15, face, 61) * 0.6 + noise(uu * 23, dz * 0.5, face, 63) * 0.4;
            s = (st.fallBase ?? 0.74) + 0.56 * (str - 0.5) - 1.2 * Math.max(0, 0.08 - wv) + (noise(uu * 4, dz * 1.6, face, 68) - 0.5) * 0.1;
            if (dpx < 2.6) s = Math.max(s, 0.88 + (noise(uu * 12, 0.5, face, 67) - 0.5) * 0.1);
            if (Z - nb < 0.12 + 0.1 * noise(uu * 18, 0.5, face, 62)) s = 0.86 + noise(uu * 40, Z * 40, face, 64) * 0.14;
          } else if (drip) {
            ramp = td.drip; s -= 0.04;
            if (dpx < 1) s += 0.1;
            const dl = 1.5 + 4.5 * noise(U * a / 2.2 + (face === 1 ? cx : cy) * 9.3, face * 13 + (face === 1 ? cy : cx) * 3.1, 0, 5) * (td.dripK ?? 1);
            if (dpx > dl - 1.2) s -= 0.14;
          } else {
            const sr = st.strata && P.strataAt(st, U + (face === 1 ? cx : cy), Z, face);
            if (sr) { ramp = sr.ramp; s += sr.s; }
            else s += sideTexture(td, U, Z, Zt, dpx, px, py, cx, cy, face, (rr) => (ramp = rr), () => (em = 1));
          }
          if ((Z - zf) * hz < 1.2) s -= 0.35;
          if (st.cubeSeams !== false && !drip && (((dpx * PK) % hz) < PK && dpx > 1)) s -= 0.07;
          if (face === 1 && (1 - U) * a < 1) s += 0.06;
          const on = face === 1 ? [0, 1] : face === 2 ? [1, 0] : wallN; // outward normal of this wall
          if ((face === 1 || face === 3) && !drip) s -= shadowAt(X + on[0] * 0.002, Y + on[1] * 0.002, Z) * (st.shadowK ?? 0.3) * 0.7;
          if (st.light && !em) {
            const nd = on[0] * Ln[0] + on[1] * Ln[1];
            s += P.lightMod(st, X, Y, Z, nd > 0 ? shadowAt(X + on[0] * 0.002, Y + on[1] * 0.002, Z) : 1, Math.max(0, nd) * (st.light.sideK ?? 1.3));
          }
          if (st.edgeInk) { const w = st.edgeInk / a; const lo = face === 1 ? [H(cx - 1, cy), H(cx + 1, cy)] : [H(cx, cy - 1), H(cx, cy + 1)]; if ((U < w && lo[0] * 0.5 < Z) || (1 - U < w && lo[1] * 0.5 < Z) || dpx * PK < st.edgeInk) { ramp = "ink"; s = 0; } }
        }
        const ri = pal.id[ramp];
        if (ri === undefined) throw new Error("ramp missing " + ramp);
        const lv = P.quant(s, pal.list[ri].length, px, py, td.dither ?? st.dither);
        buf.put(px, py, ri, lv, depth, em, face === 0 ? 1 : 2);
        if (buf.lt) buf.lt[idx] = P._lt || 0;
        P._lt = 0;
      }
    }

    function clumpShade(X, Y, sc, seed, base, k) {
      const gx = X * sc, gy = Y * sc;
      let best = -1e9, bx = 0, by = 0, bv = 0;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy;
        const px = cx + hash(cx, cy, 0, seed), py = cy + hash(cx, cy, 0, seed + 1), rr = 0.62 + 0.28 * hash(cx, cy, 0, seed + 2);
        const qx = gx - px, qy = gy - py;
        if (qx * qx + qy * qy < rr * rr && px + py > best) { best = px + py; bx = qx / rr; by = qy / rr; bv = hash(cx, cy, 0, seed + 3); }
      }
      if (best === -1e9) return { s: base - 0.3, v: 0, gap: true };
      const nz = Math.sqrt(Math.max(0, 1 - bx * bx - by * by));
      const nx = bx * 0.8, ny = by * 0.8, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const dot = (nx * Ln[0] + ny * Ln[1] + nz * Ln[2]) / nl;
      return { s: base + (dot - Ln[2]) * k + (bv - 0.5) * 0.1, v: bv, gap: false, edge: bx * bx + by * by };
    }
    function edgeDistTo(lx, ly, cx, cy, pred) {
      let d = 9;
      if (pred(cx - 1, cy)) d = Math.min(d, lx); if (pred(cx + 1, cy)) d = Math.min(d, 1 - lx);
      if (pred(cx, cy - 1)) d = Math.min(d, ly); if (pred(cx, cy + 1)) d = Math.min(d, 1 - ly);
      return d;
    }
    function velvet(td, X, Y, base) { return P.velvetAt(td, X, Y, base, Ln); }
    function topTexture(td, X, Y, px, py, lx, ly, cx, cy, t) {
      const base = td.base ?? 0.6;
      switch (td.tex) {
        case "clump": case "fungus": case "blight": {
          const c = clumpShade(X, Y, td.scale ?? 5.5, td.seed ?? 11, base, td.k ?? 0.55);
          if (td.tex === "fungus" && !c.gap && c.v > 0.93 && c.edge < 0.25) return { ramp: td.glow, s: 1, em: 1 };
          if (td.tex === "blight" && c.gap && noise(X * 4, Y * 4, 0, 3) > 0.55) return { ramp: td.glow, s: 0.7, em: 1 };
          if (td.flowers && !c.gap && c.v > 1 - td.flowers && c.edge < 0.12) return { ramp: td.flowerRamp, s: 0.8 };
          // HD moss: shallow crevices, velvet fuzz, and patches of a second moss species.
          let s = c.gap && td.gapK !== undefined ? base - td.gapK : c.s;
          if (td.fuzz) s += (noise(X * 38, Y * 38, 0, 41) - 0.5) * td.fuzz;
          return { ramp: td.top2 && P.fbm(X * 0.45, Y * 0.45, 0, 29) > 1 - (td.mix ?? 0.3) ? td.top2 : td.top, s };
        }
        case "velvet": return velvet(td, X, Y, base);
        case "tobi": {
          // Stepping stones set into moss (or raked gravel): rounded flat slabs with a lit bevel and a
          // contact shadow. A stone belongs to the path tile under its centre and never crosses its edge.
          const f = td.f ?? 1.6, c = P.cell2(X * f, Y * f, td.seed ?? 47), id = c.id, scx = c.x / f, scy = c.y / f;
          const qx = X - scx, qy = Y - scy, d = Math.hypot(qx, qy), ang = Math.atan2(qy, qx);
          const tcx = Math.floor(scx), tcy = Math.floor(scy);
          let rad = 0;
          if (ty(tcx, tcy) === t) {
            rad = ((td.rad ?? 0.21) * (0.8 + 0.4 * id)) * (1 + 0.1 * Math.sin(ang * 3 + id * 9) + 0.05 * Math.sin(ang * 5 + id * 4));
            const room = edgeDistTo(scx - tcx, scy - tcy, tcx, tcy, (x, y) => ty(x, y) !== t);
            rad = Math.min(rad, room - 0.05);
          }
          if (d < rad) {
            const rim = rad - d;
            if (rim < 0.1 && P.fbm(X * 6, Y * 6, 0, 48) > 0.66) return velvet(td, X, Y, base);
            let s = (td.stoneBase ?? 0.6) + (id - 0.5) * 0.18 + (P.fbm(X * 8, Y * 8, 0, 49) - 0.5) * 0.16;
            if (rim < 0.03) s += ((qx * Ln[0] + qy * Ln[1]) / (d || 1)) * 0.3 + 0.05;
            return { ramp: td.stone || "stone", s };
          }
          const r = td.fill === "water" ? topTexture(T.w, X, Y, px, py, lx, ly, cx, cy, t) : td.fill === "gravel" ? topTexture(T.g || td.rakeTd || (td.rakeTd = Object.assign({}, td, { tex: "rake", top: td.fillRamp || "gravel", base: td.fillBase ?? 0.62 })), X, Y, px, py, lx, ly, cx, cy, t) : velvet(td, X, Y, base);
          if (rad > 0 && d < rad + 0.05) r.s -= 0.22 * (1 - (d - rad) / 0.05);
          return r;
        }
        case "panel": {
          if (td.overgrow && P.fbm(X * 1.2, Y * 1.2, 0, td.seed ?? 5) > 1 - td.overgrow) { const c = clumpShade(X, Y, 5.5, 11, T.m.base ?? 0.6, 0.55); return { ramp: td.moss || T.m.top, s: c.s }; }
          if (td.puddle && P.fbm(X * 0.8, Y * 0.8, 0, 19) > 1 - td.puddle) { const g = hash(Math.floor((px + (py & 1) * 2) / 4), py, 0, 9) > 0.9; return { ramp: td.puddleRamp || "water", s: g ? 0.95 : 0.3 + 0.25 * P.fbm(X * 3, Y * 3, 0, 4) }; }
          const sc = td.scale ?? 2, gx = X * sc, gy = Y * sc, fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
          let s = base + (P.fbm(X * 3, Y * 3, 0, 7) - 0.5) * 0.3 + (hash(Math.floor(gx), Math.floor(gy), 0, 2) - 0.5) * 0.1;
          if (td.seams !== false) {
            if (fx < 0.09 || fy < 0.09) return { ramp: td.top, s: base - 0.32 };
            if (fx < 0.18 || fy < 0.18) s += 0.12;
            if (td.rivets !== false && fx > 0.78 && fx < 0.88 && fy > 0.78 && fy < 0.88) s += 0.25;
          }
          if (td.lines && Math.abs((td.lineAxis === "y" ? fx : fy) - 0.55) < (td.lineW ?? 0.07) && hash(Math.floor(gx), Math.floor(gy), 0, 3) > 1 - (td.lineP ?? 0.35)) return { ramp: td.lines, s: 1, em: 1 };
          if (td.cracks && Math.abs(P.fbm(X * 2.2, Y * 2.2, 0, 23) - 0.5) < td.cracks) return { ramp: td.moss || T.m.top, s: 0.45 };
          return { ramp: td.top, s };
        }
        case "rake": {
          let coord = td.axis === "x" ? X : Y, ring = false;
          for (const r of map.rings || []) { const d = Math.hypot(X - r.x, Y - r.y); if (d < r.R) { coord = d; ring = true; break; } }
          if (td.wave && !ring) coord += Math.sin((td.axis === "x" ? Y : X) * td.wave + P.fbm(X * 0.7, Y * 0.7, 0, 3) * 4) * 0.12;
          if (td.hd) {
            // HD rake: soft round grooves, fine grain, and moss creeping over the edge from moss tiles
            let s = base + (td.grooveK ?? 0.09) * Math.cos(coord * (td.freq ?? 5) * Math.PI * 2) + (noise(X * 70, Y * 70, 0, 5) - 0.5) * 0.06;
            if (map.gravelD) {
              const d = map.gravelD(X, Y) + (P.fbm(X * 1.3, Y * 1.3, 0, 63) - 0.5) * 0.3;
              if (d < 0) return velvet(T.m, X, Y, T.m.base ?? 0.6);
              s -= 0.14 * P.smooth(0.16, 0, d); // the moss edge sits a little proud and shades the gravel
            } else if (td.mossEdge) {
              const md = edgeDistTo(lx, ly, cx, cy, (x, y) => { const q = ty(x, y); return q === "m" || q === "t"; }), m = td.mossEdge * (0.45 + 1.1 * P.fbm(X * 1.3, Y * 1.3, 0, 63));
              if (md < m) return velvet(T.m, X, Y, T.m.base ?? 0.6);
              s -= 0.12 * P.smooth(m + 0.12, m, md);
            }
            return { ramp: td.top, s };
          }
          const f = (coord * (td.freq ?? 5)) % 1;
          let s = base;
          if (f < 0.28) s -= 0.26; else if (f < 0.5) s += 0.12;
          if (hash(px, py, 1, 4) > 0.94) s += hash(px, py, 2, 4) > 0.5 ? 0.15 : -0.15;
          const md = edgeDistTo(lx, ly, cx, cy, (x, y) => { const q = ty(x, y); return q && q !== t && q !== "w"; });
          if (md < 0.08) s -= 0.12;
          return { ramp: td.top, s };
        }
        case "dirt": {
          const md = edgeDistTo(lx, ly, cx, cy, (x, y) => { const q = ty(x, y); return q && (T[q] || {}).tex === "clump"; });
          if (md < 0.1 + 0.28 * P.fbm(X * 3, Y * 3, 0, 21)) { const c = clumpShade(X, Y, 5.5, 11, (T.m.base ?? 0.6) - 0.04, 0.55); return { ramp: T.m.top, s: c.s }; }
          const pc = P.cell2(X * 7, Y * 7, 31);
          if (pc.f1 < 0.2 + pc.id * 0.08) { const qx = X * 7 - pc.x, qy = Y * 7 - pc.y; return { ramp: td.pebble, s: 0.55 - (qx * Ln[0] + qy * Ln[1]) * -1.4 }; }
          let s = base + (P.fbm(X * 2.5, Y * 2.5, 0, 9) - 0.5) * 0.35;
          if (hash(px, py, 3, 5) > 0.95) s += 0.14;
          return { ramp: td.top, s };
        }
        case "flag": {
          const c = P.cell2(X * (td.scale ?? 2.4), Y * (td.scale ?? 2.4), 41);
          if (c.f2 - c.f1 < 0.14) return { ramp: td.gap ?? T.m.top, s: 0.32 + (c.f2 - c.f1) * 2 };
          const qx = X * 2.4 - c.x, qy = Y * 2.4 - c.y;
          return { ramp: td.top, s: base + (c.id - 0.5) * 0.18 + (qx * Ln[0] + qy * Ln[1]) * 0.25 + (c.f2 - c.f1 < 0.22 ? 0.1 : 0) };
        }
        case "plank": {
          const f = (X * 5) % 1, pk = Math.floor(X * 5);
          if (f < 0.13) return { ramp: td.top, s: 0.18 };
          return { ramp: td.top, s: base + (hash(pk, cy, 0, 6) - 0.5) * 0.14 + (noise(X * 30, Y * 3 + pk * 7, 0, 3) - 0.5) * 0.2 };
        }
        case "water": {
          const sd = edgeDistTo(lx, ly, cx, cy, (x, y) => !isW(x, y));
          if (td.calm) {
            // HD pond: lighter shallows, deep middle, slow ripple bands; glints only where the sun lands.
            // With map.waterD (signed distance, + inside) the shore is a smooth wobbly curve, not tile edges.
            let wd = sd;
            if (map.waterD) {
              wd = map.waterD(X, Y) + (P.fbm(X * 1.3, Y * 1.3, 0, 61) - 0.5) * 0.3;
              if (wd < 0) { const r = velvet(T.m, X, Y, T.m.base ?? 0.6); r.s -= 0.16 * P.smooth(-0.14, 0, wd); return r; }
            }
            // foam where a fall lands: churning white along the edge under a higher stream cell
            if (pal.id.fall !== undefined) for (const [dx, dy, dist] of [[0, -1, ly], [-1, 0, lx]]) {
              if (!isW(cx + dx, cy + dy) || H(cx + dx, cy + dy) <= H(cx, cy)) continue;
              const ex = dx ? cx - 0.02 : X, ey = dy ? cy - 0.02 : Y; // the lip above: is the stream really falling here?
              if (map.waterD && map.waterD(ex, ey) + (P.fbm(ex * 1.3, ey * 1.3, 0, 61) - 0.5) * 0.3 < 0.04) continue;
              const f = 0.3 + 0.34 * P.fbm(X * 3.6, Y * 3.6, 0, 65) - dist;
              if (f > 0) return { ramp: "fall", s: 0.58 + Math.min(0.36, f * 1.4) + (noise(X * 26, Y * 26, 0, 66) - 0.5) * 0.26 };
            }
            let s = base + (td.shallow ?? 0.22) * Math.max(0, 1 - wd / 0.3) - (td.deep ?? 0.16) * P.smooth(0.15, 1.1, wd) + (P.fbm(X * 1.2 + Y * 0.4, Y * 4.2 - X * 0.6, 0, 4) - 0.5) * (td.ripple ?? 0.16);
            if (st.light) {
              const g = P.lightAt(st, X, Y, H(cx, cy) * 0.5 - waterDrop), c = P.cell2(X * 7, Y * 16, 9);
              if (g > 0.35 && c.id > 1 - (td.glints ?? 0.25) && c.f1 < 0.16) s = 0.98;
            }
            if (td.shore && !map.waterD) {
              // organic shoreline: moss creeps over the tile edge, darker where it meets the water
              const sh = td.shore * (0.45 + 1.1 * P.fbm(X * 1.3, Y * 1.3, 0, 61));
              if (sd < sh) { const r = velvet(T.m, X, Y, T.m.base ?? 0.6); r.s -= 0.14 * P.smooth(sh - 0.1, sh, sd); return r; }
              s -= 0.12 * P.smooth(sh + 0.14, sh, sd);
            }
            if (sd < (td.rimW ?? 0)) s = td.rim ?? 0.9;
            return { ramp: td.top, s };
          }
          let s = base + 0.28 * Math.max(0, 1 - sd / 0.45);
          s -= 0.12 * P.fbm(X * 2, Y * 2, 0, 4);
          const gx = Math.floor((px + (py & 1) * 2) / 5);
          if (hash(gx, py, 0, 9) > 0.93 && (px + (py & 1) * 2) % 5 < 3) s = 0.9;
          if (sd < (td.rimW ?? 0.06)) s = td.rim ?? 1;
          return { ramp: td.top, s };
        }
        case "roots": {
          const r = Math.abs(P.fbm(X * 1.7, Y * 1.7, 0, 13) - 0.5);
          if (r < 0.04) return { ramp: td.root, s: 0.7 - r * 9 + (r < 0.015 ? 0.1 : 0) };
          const c = clumpShade(X, Y, td.scale ?? 5.5, 11, base, 0.55);
          return { ramp: td.top, s: c.s - (r < 0.06 ? 0.15 : 0) };
        }
        default: return { ramp: td.top, s: base };
      }
    }
    function sideTexture(td, U, Z, Zt, dpx, px, py, cx, cy, face, setRamp, setEm) {
      const cid = face === 1 ? cx : face === 2 ? cy : 0;
      if (td.sideTex === "cliff") {
        // Tall faces: the same moss lip as "drape", then mossy rock below: irregular blocks with dark
        // joints, moss on every ledge, dark wet streaks under the lip, moss creeping up from the foot.
        const dz = Zt - Z, uu = U + cid, mr = td.mossRamp || "moss";
        const lobe = 0.5 + 0.5 * Math.cos((uu * (td.lobes ?? 3.2) + P.fbm(uu * 0.7, cid * 0.3, face, 76) * 2) * Math.PI * 2);
        const edge = (td.drapeD ?? 0.14) + (td.drapeK ?? 0.2) * P.fbm(uu * 1.6, face * 3.3 + cid * 0.37, 0, 77) + 0.08 * Math.sqrt(lobe);
        if (dz < edge) { setRamp(mr); const q = dz / edge; return 0.08 - q * q * 0.32 + (noise(uu * 46, Z * 46, face, 75) - 0.5) * 0.06; }
        const sx = Math.floor(uu * 40);
        if (hash(sx, cid, face, 72) > 0.84 && dz < edge + 0.06 + 0.5 * hash(sx, cid, face, 73) ** 2 && Math.abs((uu * 40 % 1) - 0.5) < 0.3) { setRamp(mr); return -0.28; }
        const nb = face === 3 ? st.clip.foot ?? -99 : (face === 1 ? H(cx, cy + 1) : H(cx + 1, cy)) * 0.5, up = Z - nb;
        if (nb > -40 && up < 0.05 + 0.16 * P.fbm(uu * 2.4, 0.3, face, 78)) { setRamp(mr); return -0.22 + up * 0.7; }
        const sy = td.rockY ?? 3.2, c = P.cell2(uu * (td.rockX ?? 1.9), Z * sy, 81 + face), joint = c.f2 - c.f1, above = Z * sy - c.y, id = c.id;
        if (joint < 0.06) { setRamp(td.rock || "stone"); return -0.34; }
        if (joint < 0.07 + 0.16 * P.fbm(uu * 5, Z * 5, face, 82) && above > 0.05) { setRamp(mr); return -0.1 + above * 0.2 + (noise(uu * 40, Z * 40, face, 83) - 0.5) * 0.1; }
        setRamp(td.rock || "stone");
        let s = (id - 0.5) * 0.22 + above * 0.18 + (noise(uu * 14, Z * 14, face, 84) - 0.5) * 0.1 - 0.06;
        if (hash(Math.floor(uu * 9), cid, face, 85) > 0.8) s -= 0.16 * P.smooth(0.9, 0.2, dz); // wet streak
        return s - 0.28 * P.smooth(edge + 0.16, edge, dz); // shadow under the moss lip
      }
      if (td.sideTex === "drape") {
        // HD moss rolling over the lip: a sheet whose lower edge hangs in rounded lobes and darkens as it
        // turns under, a soft shadow beneath it, fine hanging strands, and moss creeping up from the foot.
        const dz = Zt - Z, uu = U + cid, mr = td.mossRamp || "moss";
        const lobe = 0.5 + 0.5 * Math.cos((uu * (td.lobes ?? 3.2) + P.fbm(uu * 0.7, cid * 0.3, face, 76) * 2) * Math.PI * 2);
        const edge = (td.drapeD ?? 0.14) + (td.drapeK ?? 0.2) * P.fbm(uu * 1.6, face * 3.3 + cid * 0.37, 0, 77) + 0.08 * Math.sqrt(lobe);
        if (dz < edge) { setRamp(mr); const q = dz / edge; return 0.08 - q * q * 0.32 + (noise(uu * 46, Z * 46, face, 75) - 0.5) * 0.06; }
        const sx = Math.floor(uu * 40);
        if (hash(sx, cid, face, 72) > 0.86 && dz < edge + 0.05 + 0.25 * hash(sx, cid, face, 73) && Math.abs((uu * 40 % 1) - 0.5) < 0.3) { setRamp(mr); return -0.3; }
        const nb = face === 3 ? st.clip.foot ?? -99 : (face === 1 ? H(cx, cy + 1) : H(cx + 1, cy)) * 0.5, up = Z - nb;
        if (nb > -40 && up < 0.04 + 0.12 * P.fbm(uu * 2.4, 0.3, face, 78)) { setRamp(mr); return -0.2 + up * 0.6; }
        let s = (noise(uu * 6, Z * 5, face, 2) - 0.5) * 0.12 + (P.fbm(uu * 3, Z * 3, face, 79) - 0.5) * 0.14 - 0.08;
        return s - 0.26 * P.smooth(edge + 0.14, edge, dz); // shadow under the moss lip
      }
      if (td.sideTex === "moss") {
        // Moss sheets draping over the lip, thinning with depth, with hanging strands.
        const dz = Zt - Z, uu = U + cid;
        const cov = P.fbm(uu * 2.2, Z * 2.2, face * 7, 71) + (td.mossCover ?? 0.55) - dz * (td.mossFall ?? 0.45);
        const sx = Math.floor(uu * 22), strand = hash(sx, cid, face, 72);
        const hang = strand > 0.8 && dz < 0.12 + 0.55 * hash(sx, cid, face, 73) && Math.abs((uu * 22 % 1) - 0.5) < 0.38;
        if (cov > 0.62 || hang) {
          setRamp(td.mossRamp || "moss");
          return 0.04 - dz * 0.12 + (cov > 0.62 ? Math.min(0.12, (cov - 0.62) * 0.8) : -0.1) + (noise(uu * 34, Z * 34, face, 75) - 0.5) * 0.16;
        }
        return (noise(uu * 6, Z * 5, face, 2) - 0.5) * 0.14 - 0.06 + (cov > 0.56 ? -0.1 : 0);
      }
      if (td.sideTex === "windows") {
        const rowH = td.rowH ?? 0.25, rf = (Zt - Z) / rowH, row = Math.floor(rf), fr = rf - row, cols = td.cols ?? 3, cf = U * cols, col = Math.floor(cf), fc = cf - col;
        if (fr > 0.3 && fr < 0.8 && fc > 0.2 && fc < 0.8) {
          const hh = hash(row, col + cid * 7, face, 11), lit = td.lit ?? 0.35;
          if (hh > 1 - lit) { setRamp(td.win2 && hh > 1 - lit * 0.35 ? td.win2 : td.win); setEm(); return 2; }
          setRamp(td.glass || td.side); return fr < 0.45 ? 0.12 : -0.04;
        }
        return (hash(row, cid, face, 12) - 0.5) * 0.06 + (fr < 0.12 ? -0.1 : 0);
      }
      if (td.sideTex === "stone") {
        const rowH = td.rowH ?? 0.25, rf = (Zt - Z) / rowH, row = Math.floor(rf), off = (row & 1) * 0.5;
        const cf = U * 2 + off, col = Math.floor(cf);
        if ((rf - row) * rowH * hz < 1 || ((cf - col) / 2) * a < 1) return -0.24;
        let s = (hash(row, col + cid * 4, face, 7) - 0.5) * 0.16;
        if ((rf - row) * rowH * hz < 2) s += 0.1;
        return s;
      }
      // earth: strata, pebbles, dangling roots
      let s = (hash(Math.floor((Zt - Z) * hz / 3), cid, face, 8) - 0.5) * 0.1 + (noise(U * 6 + cid * 6, Z * 5, face, 2) - 0.5) * 0.12;
      const pc = P.cell2(U * 4.5 + cid * 4.5, Z * 4.5, 51 + face);
      if (pc.f1 < 0.2) { setRamp(td.pebble || td.side); return (Z * 4.5 - pc.y) * 1.2 - 0.05; }
      const rootX = U * 3 + cid * 3 + Math.sin(Z * 9 + cid) * 0.12;
      if (td.roots && Math.abs((rootX % 1) - 0.5) < 0.05 && hash(Math.floor(rootX), cid, face, 2) > 0.55 && dpx < 4 + 10 * hash(Math.floor(rootX), cid, face, 3)) { setRamp(td.roots); return 0.1; }
      return s;
    }
  };

  // Grass tufts and tiny flowers, drawn as hand-placed pixel strokes on top faces.
  P.tufts = function (buf, map, st, v) {
    const pal = st.pal;
    for (let cy = 0; cy < map.H; cy++) for (let cx = 0; cx < map.W; cx++) {
      const td = st.terrain[map.typ[cy][cx]]; if (!td || !td.tufts) continue;
      const Z = map.hgt[cy][cx] * 0.5;
      const n = Math.round(td.tufts * (0.6 + hash(cx, cy, 0, 77) * 0.8));
      for (let k = 0; k < n; k++) {
        const X = cx + 0.12 + 0.76 * hash(cx, cy, k, 1), Y = cy + 0.12 + 0.76 * hash(cx, cy, k, 2);
        const [sx, sy] = P.proj(v, X, Y, Z); const x = Math.round(sx), y = Math.round(sy);
        const base = y * buf.w + x; if (x < 1 || y < 4 || x >= buf.w - 1 || y >= buf.h || buf.tag[base] !== 1 || Math.abs(buf.z[base] - (X + Y + Z)) > 0.15) continue;
        const ri = pal.id[td.tuftRamp || td.top], n2 = pal.list[ri].length, zz = X + Y + Z + 0.03;
        const tall = Math.max(2, Math.round((td.tuftH ?? 3) * v.tw / 32 * (0.7 + 0.6 * hash(cx, cy, k, 3))));
        const flower = td.tuftFlower && hash(cx, cy, k, 4) < td.tuftFlower;
        for (const [dx, hh] of [[-1, tall - 1], [0, tall], [1, tall - 2]]) {
          for (let j = 0; j < hh; j++) buf.put(x + dx + (j === hh - 1 && dx !== 0 ? dx : 0), y - j, ri, Math.min(n2 - 1, n2 - 3 + Math.round((j / hh) * 2) + (dx < 0 ? 1 : 0)), zz, 0, 5);
        }
        if (flower) { const fr = pal.id[td.flowerRamp]; buf.put(x, y - tall, fr, pal.list[fr].length - 1, zz + 0.01, 0, 5); buf.put(x, y - tall + 1, fr, Math.max(0, pal.list[fr].length - 3), zz + 0.01, 0, 5); }
      }
    }
  };

  // ------------------------------------------------------------------ backgrounds & post
  P.background = function (buf, st, fn) {
    const ri = st.pal.id.sky, n = st.pal.list[ri].length;
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const s = fn ? fn(x / buf.w, y / buf.h, x, y) : 1 - y / buf.h;
      buf.put(x, y, ri, P.quant(s, n, x, y, st.bgDither ?? "bayer"), -1e8, 0, 4);
    }
  };
  // Diagonal light shafts: raise one tone inside, dithered edges. Palette stays exact.
  P.shafts = function (buf, opts) {
    const { period = 90, width = 26, slope = 0.55, offset = 0, strength = 1, tags = [1, 2, 3, 5] } = opts;
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const i = y * buf.w + x; if (buf.ri[i] < 0 || buf.em[i] || !tags.includes(buf.tag[i])) continue;
      const q = ((x + y * slope + offset) % period + period) % period;
      if (q > width) continue;
      const e = Math.min(q, width - q) / 5;
      if (e < 1 && P.bayer(x, y) > e) continue;
      buf.lv[i] += strength;
    }
  };
  // Mist: replace pixels with a fog ramp tone through an ordered-dither mask.
  P.mist = function (buf, st, fn) {
    const ri = st.pal.id.fog, n = st.pal.list[ri].length;
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const i = y * buf.w + x; if (buf.ri[i] < 0 || buf.em[i]) continue;
      const a = fn(x, y, buf.z[i], buf.tag[i]);
      if (a > 0 && P.bayer(x, y) < a) { buf.ri[i] = ri; buf.lv[i] = clamp(Math.round(buf.lv[i] * 0 + (n - 1) * (0.4 + 0.6 * (1 - y / buf.h))), 0, n - 1); buf.tag[i] = 6; }
    }
  };
  // Emissive pixels light their neighbours by a tone or two: pixel-space bloom.
  P.pixelBloom = function (buf, r = 2) {
    const src = []; for (let i = 0; i < buf.w * buf.h; i++) if (buf.em[i]) src.push(i);
    const done = new Uint8Array(buf.w * buf.h);
    for (const i of src) {
      const x0 = i % buf.w, y0 = (i / buf.w) | 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
        const k = y * buf.w + x; if (buf.em[k] || done[k] || buf.ri[k] < 0) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= 1 || (d <= r && P.bayer(x, y) < 0.5 / d)) { buf.lv[k] = Math.min(buf.lv[k] + (d <= 1 ? 2 : 1), 99); done[k] = 1; }
      }
    }
  };
  P.spark = function (buf, st, x, y, ramp, z = 1e7, big = false) {
    const ri = st.pal.id[ramp], n = st.pal.list[ri].length;
    buf.put(x, y, ri, n - 1, z, 1, 8);
    if (big) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) buf.put(x + dx, y + dy, ri, n - 2, z, 1, 8);
  };

  // Short diagonal pixel strokes over everything: rain, snow, falling leaves.
  P.streaks = function (buf, st, o) {
    const ri = st.pal.id[o.ramp], n = st.pal.list[ri].length, rnd = P.rng(o.seed || 3);
    for (let k = 0; k < o.n; k++) {
      const x = Math.floor(rnd() * buf.w), y = Math.floor(rnd() * buf.h), len = Math.max(1, Math.round((o.len ?? 4) * (0.6 + rnd() * 0.8)));
      const lv = o.lv ?? n - 1 - (rnd() < 0.4 ? 1 : 0);
      for (let i = 0; i < len; i++) buf.put(x + Math.round(i * (o.slope ?? 0)), y + i, ri, Math.max(0, lv - (i === len - 1 && len > 2 ? 1 : 0)), 1e7, o.em ? 1 : 0, 8);
    }
  };
  // A disc (moon, sun) painted only onto background pixels, with a dithered halo.
  P.disc = function (buf, st, cx, cy, r, ramp, halo = 1.7) {
    const ri = st.pal.id[ramp], n = st.pal.list[ri].length;
    for (let y = Math.floor(cy - r * halo); y <= cy + r * halo; y++) for (let x = Math.floor(cx - r * halo); x <= cx + r * halo; x++) {
      if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
      const i = y * buf.w + x; if (buf.tag[i] !== 4) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r) { const s = 0.75 + 0.25 * (1 - d / r) - (P.fbm(x / 5, y / 5, 0, 31) > 0.6 ? 0.3 : 0); buf.ri[i] = ri; buf.lv[i] = P.quant(s, n, x, y, "bayer"); buf.em[i] = 1; }
      else if (P.bayer(x, y) < 0.9 * (1 - (d - r) / (r * (halo - 1)))) buf.lv[i] += 1;
    }
  };

  // HD-2D finish at an integer upscale: smooth bloom from emissive pixels, depth haze, vignette.
  P.hdFinish = function (buf, pal, scale, o) {
    const W = buf.w * scale, H = buf.h * scale, base = P.resolve(buf, pal);
    const out = new Float32Array(W * H * 3), glow = new Float32Array(buf.w * buf.h * 3);
    const zs = []; for (let i = 0; i < buf.w * buf.h; i++) if (buf.tag[i] !== 4 && buf.ri[i] >= 0) zs.push(buf.z[i]);
    zs.sort((a, b) => a - b); const zlo = zs[Math.floor(zs.length * 0.05)] ?? 0, zhi = zs[Math.floor(zs.length * 0.95)] ?? 1;
    for (let i = 0; i < buf.w * buf.h; i++) {
      const lum = (base[i * 4] * 0.3 + base[i * 4 + 1] * 0.59 + base[i * 4 + 2] * 0.11) / 255;
      const k = buf.em[i] ? o.bloom : lum > (o.threshold ?? 0.8) ? (lum - (o.threshold ?? 0.8)) * 2 * o.bloom : 0;
      glow[i * 3] = base[i * 4] * k; glow[i * 3 + 1] = base[i * 4 + 1] * k; glow[i * 3 + 2] = base[i * 4 + 2] * k;
    }
    // blur glow at low res (three box passes ~ gaussian), then sample bilinearly
    const blur = (arr, w, h, r) => {
      const tmp = new Float32Array(arr.length);
      for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let acc = 0; for (let x = -r; x <= r; x++) acc += arr[(y * w + clamp(x, 0, w - 1)) * 3 + c]; for (let x = 0; x < w; x++) { tmp[(y * w + x) * 3 + c] = acc / (2 * r + 1); acc += arr[(y * w + clamp(x + r + 1, 0, w - 1)) * 3 + c] - arr[(y * w + clamp(x - r, 0, w - 1)) * 3 + c]; } }
        for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[(clamp(y, 0, h - 1) * w + x) * 3 + c]; for (let y = 0; y < h; y++) { arr[(y * w + x) * 3 + c] = acc / (2 * r + 1); acc += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 3 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 3 + c]; } }
      }
    };
    const wide = glow.slice(); blur(glow, buf.w, buf.h, o.radius ?? 2); blur(wide, buf.w, buf.h, (o.radius ?? 2) * 4);
    const fog = o.fog || [0, 0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / scale), sy = Math.floor(y / scale), si = sy * buf.w + sx, oi = (y * W + x) * 3;
      const fx = clamp(x / scale - 0.5, 0, buf.w - 1), fy = clamp(y / scale - 0.5, 0, buf.h - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(buf.w - 1, x0 + 1), y1 = Math.min(buf.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const samp = (arr, c) => (arr[(y0 * buf.w + x0) * 3 + c] * (1 - tx) + arr[(y0 * buf.w + x1) * 3 + c] * tx) * (1 - ty) + (arr[(y1 * buf.w + x0) * 3 + c] * (1 - tx) + arr[(y1 * buf.w + x1) * 3 + c] * tx) * ty;
      const depth = buf.tag[si] === 4 ? 0 : clamp((buf.z[si] - zlo) / (zhi - zlo || 1), 0, 1);
      const haze = (o.haze ?? 0) * (1 - depth) * (buf.tag[si] === 4 ? 0 : 1);
      const vx = x / W - 0.5, vy = y / H - 0.5, vig = 1 - (o.vignette ?? 0) * (vx * vx + vy * vy) * 2.2;
      for (let c = 0; c < 3; c++) {
        let col = base[si * 4 + c];
        col = col + (fog[c] - col) * haze;
        col += samp(glow, c) * 0.9 + samp(wide, c) * 0.7;
        out[oi + c] = col * vig;
      }
    }
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    return { rgba, w: W, h: H };
  };
})();
