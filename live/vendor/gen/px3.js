/* Round three: HD terrarium tools. Beam lighting (sun pools + shade), soil strata, solid
   plinths, ray-traced glass, and a supersampled finish with volumetric shafts and tilt-shift. */
(function () {
  const P = window.PX, clamp = P.clamp, sm = P.smooth, SQ3 = Math.sqrt(3);

  // ------------------------------------------------------------------ beam light
  // Each beam is a cylinder along the light direction through a ground point. Inside it the
  // world is sunlit (broken up by leaf holes); outside it sits in canopy shade with sun flecks.
  function basis(st) {
    if (st._basis) return st._basis;
    const L = st.L, l1 = Math.hypot(L[1], L[0]) || 1, e1 = [L[1] / l1, -L[0] / l1, 0];
    const e2 = [L[1] * e1[2] - L[2] * e1[1], L[2] * e1[0] - L[0] * e1[2], L[0] * e1[1] - L[1] * e1[0]];
    return (st._basis = [e1, e2]);
  }
  const perp = (st, x, y, z) => { const [e1, e2] = basis(st); return [x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2]]; };

  P.lightAt = function (st, X, Y, Z) {
    const g = st.light, L = st.L; let best = 0;
    for (const bm of g.beams) {
      const dx = X - bm.x, dy = Y - bm.y, dz = Z - bm.z, t = dx * L[0] + dy * L[1] + dz * L[2];
      const d = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t)) / bm.r;
      if (d >= 1) continue;
      let val = sm(1, 1 - (g.soft ?? 0.35), d) * (bm.k ?? 1);
      if (g.leaf) { const [u, w] = perp(st, dx, dy, dz); val *= 1 - g.leaf + g.leaf * sm(g.leafLo ?? 0.4, g.leafHi ?? 0.56, P.fbm(u * (g.leafF ?? 2.4) + 7.1 * bm.x, w * (g.leafF ?? 2.4) + 3.3 * bm.y, 0, 91)); }
      if (val > best) best = val;
    }
    // Dappled komorebi: irregular soft patches of light projected along the beam direction.
    if (g.dapple) { const [u, w] = perp(st, X, Y, Z), f = g.dappleF ?? 1.3; best = Math.max(best, sm(g.dapple, g.dapple + 0.07, P.fbm(u * f, w * f, 0, 97, 3)) * (g.dappleK ?? 0.6)); }
    if (g.flecks) {
      const [u, w] = perp(st, X, Y, Z), f = g.fleckF ?? 2.6, c = P.cell2(u * f, w * f, 97);
      if (c.id < g.flecks) best = Math.max(best, sm(0.2, 0.1, c.f1) * (g.fleckK ?? 0.8));
    }
    return best;
  };
  // Shade offset for a surface point: -shade in canopy shadow, up to +pool in a sun pool.
  P.lightMod = function (st, X, Y, Z, shd, k = 1) {
    const g = st.light, shade = g.shade ?? 0.15, lt = k > 0 ? P.lightAt(st, X, Y, Z) * (1 - shd) * Math.min(1, k) : 0;
    P._lt = lt; // remembered so the renderer can record a per-pixel sun-pool mask
    return -shade + (shade + (g.pool ?? 0.25)) * lt;
  };

  // ------------------------------------------------------------------ soil strata (seen through glass)
  // st.strata: [{ top, ramp, tex: pebbles|fiber|grain, ramp2, gap, f, wob }] sorted bottom-up.
  P.strataAt = function (st, U, Z, face) {
    for (const Ly of st.strata) {
      const top = Ly.top + (P.fbm(U * 1.3, Ly.top * 7, face, 81) - 0.5) * (Ly.wob ?? 0.1);
      if (Z > top) continue;
      if (Ly.tex === "pebbles") {
        const f = Ly.f ?? 7, c = P.cell2(U * f, Z * f, 83), gap = c.f2 - c.f1;
        if (gap < 0.1) return { ramp: Ly.gap || Ly.ramp, s: -0.32 + gap * 2 };
        const qx = U * f - c.x, qy = Z * f - c.y;
        return { ramp: c.id > 0.62 && Ly.ramp2 ? Ly.ramp2 : Ly.ramp, s: (c.id - 0.5) * 0.24 + qy * 0.55 - qx * 0.2 + (gap < 0.2 ? -0.08 : 0.08) };
      }
      let s = Ly.tex === "fiber" ? (P.noise(U * 24, Z * 6, face, 85) - 0.5) * 0.5 + (P.noise(U * 60, Z * 14, face, 86) - 0.5) * 0.24 : (P.noise(U * 40, Z * 40, face, 87) - 0.5) * 0.3;
      if (top - Z < 0.02) s -= 0.14;
      return { ramp: Ly.ramp, s };
    }
    return null;
  };

  // ------------------------------------------------------------------ rays, solids, glass
  // A pixel's view ray: R(t) = (X0 + t, Y0 + t, t); depth X+Y+Z grows toward the viewer.
  const ray = (v, px, py) => { const XmY = (px + 0.5 - v.ox) / v.a, XpY = (py + 0.5 - v.oy) / v.b; return [(XpY + XmY) / 2, (XpY - XmY) / 2]; };
  // Entry (tn, nn) and exit (tf, nf) of a box, or of a capped cylinder with an optional dome.
  function hitShape(sh, X0, Y0) {
    if (sh.type === "box") {
      const lo = [sh.x0 - X0, sh.y0 - Y0, sh.zb], hi = [sh.x1 - X0, sh.y1 - Y0, sh.zt];
      let tn = -1e9, tf = 1e9, kn = 0, kf = 0;
      for (let k = 0; k < 3; k++) { if (lo[k] > tn) { tn = lo[k]; kn = k; } if (hi[k] < tf) { tf = hi[k]; kf = k; } }
      if (tn >= tf) return null;
      const N = (k, s) => [k === 0 ? s : 0, k === 1 ? s : 0, k === 2 ? s : 0];
      return { tn, tf, nn: N(kn, -1), nf: N(kf, 1), kf, kn };
    }
    const dx = X0 - sh.cx, dy = Y0 - sh.cy, R = sh.R, p = dx + dy, disc = p * p - 2 * (dx * dx + dy * dy - R * R);
    let tn = 1e9, tf = -1e9, nn = null, nf = null;
    if (disc > 0) {
      const r = Math.sqrt(disc), a = Math.max((-p - r) / 2, sh.zb), b = Math.min((-p + r) / 2, sh.zt);
      if (a < b) { tn = a; nn = a === sh.zb ? [0, 0, -1] : [(dx + a) / R, (dy + a) / R, 0]; tf = b; nf = b === sh.zt ? [0, 0, 1] : [(dx + b) / R, (dy + b) / R, 0]; }
    }
    if (sh.dome) {
      // dome: ellipsoid with horizontal radius R and vertical radius domeH (bell jars run tall)
      const q2 = (R / (sh.domeH ?? R)) ** 2, A = 2 + q2, B = dx + dy - q2 * sh.zt, C = dx * dx + dy * dy + q2 * sh.zt * sh.zt - R * R, d2 = B * B - A * C;
      if (d2 > 0) {
        const r = Math.sqrt(d2), a = Math.max((-B - r) / A, sh.zt), b = (-B + r) / A, nrm = (t) => { const n = [dx + t, dy + t, q2 * (t - sh.zt)], l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
        if (a < b) { if (a < tn) { tn = a; nn = nrm(a); } if (b > tf) { tf = b; nf = nrm(b); } }
      }
    }
    return tn < tf ? { tn, tf, nn, nf } : null;
  }
  P.hitShape = hitShape;
  function shapeBounds(v, sh, W, H) {
    const xs = sh.type === "box" ? [sh.x0, sh.x1] : [sh.cx - sh.R, sh.cx + sh.R], ys = sh.type === "box" ? [sh.y0, sh.y1] : [sh.cy - sh.R, sh.cy + sh.R];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const X of xs) for (const Y of ys) for (const Z of [sh.zb, sh.zt + (sh.dome ? sh.domeH ?? sh.R : 0)]) {
      const [sx, sy] = P.proj(v, X, Y, Z); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return [Math.max(0, Math.floor(x0) - 2), Math.min(W, Math.ceil(x1) + 2), Math.max(0, Math.floor(y0) - 2), Math.min(H, Math.ceil(y1) + 2)];
  }
  // Rasterise the viewer-facing surface of a solid (plinth, soil drum) into the palette buffer.
  P.solid = function (buf, st, v, sh, shade) {
    const [x0, x1, y0, y1] = shapeBounds(v, sh, buf.w, buf.h);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const [X0, Y0] = ray(v, px, py), h = hitShape(sh, X0, Y0); if (!h) continue;
      const t = h.tf, X = X0 + t, Y = Y0 + t, n = h.nf, r = shade(X, Y, t, n, px, py); if (!r) continue;
      const ri = st.pal.id[r.ramp]; if (ri === undefined) throw new Error("ramp missing " + r.ramp);
      buf.put(px, py, ri, P.quant(r.s, st.pal.list[ri].length, px, py, st.dither), X + Y + t, 0, n[2] > 0.5 ? 1 : 2);
      if (buf.lt) buf.lt[py * buf.w + px] = P._lt || 0;
      P._lt = 0;
    }
  };

  // ------------------------------------------------------------------ finish
  function blur(arr, w, h, r) {
    const tmp = new Float32Array(arr.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let acc = 0; for (let x = -r; x <= r; x++) acc += arr[(y * w + clamp(x, 0, w - 1)) * 3 + c]; for (let x = 0; x < w; x++) { tmp[(y * w + x) * 3 + c] = acc / (2 * r + 1); acc += arr[(y * w + Math.min(x + r + 1, w - 1)) * 3 + c] - arr[(y * w + Math.max(x - r, 0)) * 3 + c]; } }
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[(clamp(y, 0, h - 1) * w + x) * 3 + c]; for (let y = 0; y < h; y++) { arr[(y * w + x) * 3 + c] = acc / (2 * r + 1); acc += tmp[(Math.min(y + r + 1, h - 1) * w + x) * 3 + c] - tmp[(Math.max(y - r, 0) * w + x) * 3 + c]; } }
    }
  }
  P.downsample = function (rgba, w, h, k) {
    const W = Math.floor(w / k), H = Math.floor(h / k), out = new Uint8ClampedArray(W * H * 4), n = k * k;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
      let acc = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) acc += rgba[((y * k + j) * w + x * k + i) * 4 + c];
      out[(y * W + x) * 4 + c] = acc / n;
    }
    return { rgba: out, w: W, h: H };
  };

  // o: bloom, threshold, radius, haze, fog, vignette, ss, v, L, beams, beamK, beamW, beamCol, motes,
  //    glass {shape + tint, tintA, f0, fk, sky, col, edgePx, edgeK, bands, bandSlope, windows, fogTop, drops}, dof {focus, band, ramp, r, k}
  P.hdFinish2 = function (buf, pal, o) {
    const W = buf.w, H = buf.h, N = W * H, ss = o.ss || 1, base = P.resolve(buf, pal), img = new Float32Array(N * 3), glow = new Float32Array(N * 3);
    let zlo = 0, zhi = 1;
    { const zs = new Float32Array(N); let n = 0; for (let i = 0; i < N; i++) if (buf.tag[i] !== 4 && buf.ri[i] >= 0) zs[n++] = buf.z[i]; const s = zs.subarray(0, n).sort(); zlo = s[Math.floor(n * 0.05)] ?? 0; zhi = s[Math.floor(n * 0.95)] ?? 1; }
    for (let i = 0; i < N; i++) {
      const lum = (base[i * 4] * 0.3 + base[i * 4 + 1] * 0.59 + base[i * 4 + 2] * 0.11) / 255, th = o.threshold ?? 0.8;
      const k = buf.em[i] ? o.bloom : lum > th ? (lum - th) * 2 * o.bloom : 0;
      for (let c = 0; c < 3; c++) glow[i * 3 + c] = base[i * 4 + c] * k;
    }
    const wide = glow.slice(), R = Math.round((o.radius ?? 3) * ss);
    blur(glow, W, H, R); blur(wide, W, H, R * 4);
    const fog = o.fog || [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const bg = buf.tag[i] === 4, depth = bg ? 0 : clamp((buf.z[i] - zlo) / (zhi - zlo || 1), 0, 1), haze = bg ? 0 : (o.haze ?? 0) * (1 - depth);
      for (let c = 0; c < 3; c++) { let col = base[i * 4 + c]; col += (fog[c] - col) * haze; img[i * 3 + c] = col + glow[i * 3 + c] * 0.9 + wide[i * 3 + c] * 0.7; }
    }
    const screenTo = (arr, i, col, k) => { for (let c = 0; c < 3; c++) { const v0 = clamp(arr[i * 3 + c], 0, 255); arr[i * 3 + c] = v0 + (255 - v0) * clamp(k * col[c] / 255, 0, 1); } };
    const screen = (i, col, k) => screenTo(img, i, col, k);
    // layers: shafts go to their own black-backed image (screen-blended over the scene by the page).
    const bimg = o.layers ? new Float32Array(N * 3) : null, beamScreen = bimg ? (i, col, k) => screenTo(bimg, i, col, k) : screen;

    // Volumetric shafts: soft-edged beams from each sun pool back up toward the light, with dust.
    if (o.beams && o.v) {
      const v = o.v, L = o.L, bc = o.beamCol || [255, 238, 196];
      const dsx = (L[0] - L[1]) * v.a, dsy = (L[0] + L[1]) * v.b - L[2] * v.hz, dl = Math.hypot(dsx, dsy), ux = dsx / dl, uy = dsy / dl, wx = -uy, wy = ux, Ls = L[0] + L[1] + L[2];
      const rnd = P.rng(77);
      for (const bm of o.beams) {
        const [sx, sy] = P.proj(v, bm.x, bm.y, bm.z), w = bm.r * v.a * (o.beamW ?? 1.15), len = (bm.len ?? 30) * dl, k = (bm.k ?? 1) * (o.beamK ?? 0.3);
        const ex = sx + ux * len, ey = sy + uy * len;
        const bx0 = Math.max(0, Math.floor(Math.min(sx, ex) - w * 1.5)), bx1 = Math.min(W, Math.ceil(Math.max(sx, ex) + w * 1.5)), by0 = Math.max(0, Math.floor(Math.min(sy, ey) - w * 1.5)), by1 = Math.min(H, Math.ceil(Math.max(sy, ey) + w * 1.5));
        const z0 = bm.x + bm.y + bm.z;
        for (let py = by0; py < by1; py++) for (let px = bx0; px < bx1; px++) {
          const dx = px - sx, dy = py - sy, al = dx * ux + dy * uy, ac = dx * wx + dy * wy;
          if (al < -w * 0.4 || al > len || Math.abs(ac) > w) continue;
          const i = py * W + px;
          let I = k * sm(w, w * 0.3, Math.abs(ac)) * sm(-w * 0.4, w * 1.2, al) * Math.max(0, 1 - al / len) * (0.55 + 0.9 * (P.fbm(ac / (w * 0.2), al / (w * 3), 0, 107 + bm.x) - 0.5) + 0.45);
          if (buf.tag[i] !== 4 && buf.z[i] > z0 + (al / dl) * Ls + 0.4) I *= 0.15;
          if (I > 0.003) beamScreen(i, bc, I);
        }
        for (let m = 0; m < (o.motes ?? 0); m++) {
          const al = (0.04 + rnd() * 0.5) * Math.min(len, 1800 * ss), ac = (rnd() * 2 - 1) * w * 0.8, rr = (0.8 + rnd() * 1.6) * ss, br = (0.35 + rnd() * 0.65) * sm(w, w * 0.4, Math.abs(ac));
          const cx = sx + ux * al + wx * ac, cy = sy + uy * al + wy * ac;
          for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d < rr + 1) beamScreen(y * W + x, bc, br * sm(rr + 1, rr * 0.3, d));
          }
        }
      }
    }

    // Glass: shade the back and front surfaces wherever the scene lies behind them.
    if (o.glass && o.v) {
      const G = o.glass, v = o.v, [gx0, gx1, gy0, gy1] = shapeBounds(v, G, W, H), tint = G.tint || [200, 235, 220], gcol = G.col || [240, 252, 246];
      const edgePx = (G.edgePx ?? 2.5) * ss, wins = G.windows || [];
      const faceUV = (G2, X, Y, Z, n) => {
        if (G2.type !== "box") { const ang = Math.atan2(Y - G2.cy, X - G2.cx); return [ang / (2 * Math.PI) + 0.5, (Z - G2.zb) / (G2.zt - G2.zb), Math.min(Z - G2.zb, n[2] > 0.05 ? 9 : 9) * v.a]; }
        const sx2 = G2.x1 - G2.x0, sy2 = G2.y1 - G2.y0, sz2 = G2.zt - G2.zb;
        if (Math.abs(n[0]) > 0.5) return [(Y - G2.y0) / sy2, (Z - G2.zb) / sz2, Math.min(Y - G2.y0, G2.y1 - Y, Z - G2.zb, G2.zt - Z) * v.a];
        if (Math.abs(n[1]) > 0.5) return [(X - G2.x0) / sx2, (Z - G2.zb) / sz2, Math.min(X - G2.x0, G2.x1 - X, Z - G2.zb, G2.zt - Z) * v.a];
        return [(X - G2.x0) / sx2, (Y - G2.y0) / sy2, Math.min(X - G2.x0, G2.x1 - X, Y - G2.y0, G2.y1 - Y) * v.a];
      };
      const shadeAt = (i, X0, Y0, t, n, back) => {
        const X = X0 + t, Y = Y0 + t, Z = t, nv = (n[0] + n[1] + n[2]) / SQ3, c = Math.abs(nv), sg = nv >= 0 ? 1 : -1;
        const fres = (G.f0 ?? 0.04) + (G.fk ?? 0.85) * Math.pow(1 - c, 3);
        const r = [-1 / SQ3 + 2 * c * n[0] * sg, -1 / SQ3 + 2 * c * n[1] * sg, -1 / SQ3 + 2 * c * n[2] * sg], rh = Math.hypot(r[0], r[1]) || 1;
        let env = (G.sky ?? 0.25) * sm(-0.4, 0.9, r[2]);
        for (const wd of wins) env += wd.k * sm(wd.w0, wd.w1, (r[0] * wd.d[0] + r[1] * wd.d[1]) / rh);
        const [u, w, dEdge] = faceUV(G, X, Y, Z, n);
        if (G.type === "box" && Math.abs(n[2]) < 0.5) for (const [c0, wid, kk] of G.bands || []) env += kk * sm(wid, wid * 0.35, Math.abs(u + w * (G.bandSlope ?? 0.4) - c0)) * sm(0, 0.25, w);
        let add = env * fres * (back ? 0.55 : 1);
        // glass edges and the bright rim where two panes meet (or where the jar meets the base)
        const ed = G.type === "box" ? dEdge : (Z - G.zb) * v.a;
        add += (back ? 0.4 : 1) * (G.edgeK ?? 0.5) * (sm(edgePx, edgePx * 0.25, ed) + 0.35 * sm(edgePx * 0.9, 0, Math.abs(ed - edgePx * 2.4)));
        // condensation: a fogged band near the top and droplets on the front panes
        if (!back && G.fogTop) add += G.fogTop * sm(0.55, 1, w) * (0.6 + 0.4 * P.fbm(u * 9, w * 4, 0, 131));
        if (!back && G.drops && Math.abs(n[2]) < 0.5) {
          const f = G.dropF ?? 60, cl = P.cell2(u * f * (G.type === "box" ? 1 : 3), w * f * 0.8, 133), rad = 0.1 + 0.22 * cl.id;
          if (cl.id < G.drops * sm(0.15, 0.9, w) && cl.f1 < rad) { const q = cl.f1 / rad; add += q > 0.75 ? 0.22 : 0.04; if (q < 0.3 && (u * f - cl.x) < 0 && (w * f * 0.8 - cl.y) > 0) add += 0.5; }
        }
        const a = (G.tintA ?? 0.05) * (back ? 0.8 : 1);
        for (let ch = 0; ch < 3; ch++) img[i * 3 + ch] = img[i * 3 + ch] * (1 - a) + tint[ch] * a;
        if (add > 0.002) screen(i, gcol, add);
      };
      for (let py = gy0; py < gy1; py++) for (let px = gx0; px < gx1; px++) {
        const [X0, Y0] = ray(v, px, py), h = hitShape(G, X0, Y0); if (!h) continue;
        const i = py * W + px, zc = buf.tag[i] === 4 || buf.ri[i] < 0 ? -1e9 : buf.z[i];
        if (h.nn && zc < X0 + Y0 + 3 * h.tn && h.nn[2] > -0.5) shadeAt(i, X0, Y0, h.tn, h.nn, true);
        if (h.nf && zc < X0 + Y0 + 3 * h.tf) shadeAt(i, X0, Y0, h.tf, h.nf, false);
      }
    }

    // Tilt-shift: blur away from a horizontal focus band (miniature look).
    if (o.dof) {
      const d = o.dof, bl = img.slice(); blur(bl, W, H, Math.round((d.r ?? 4) * ss));
      for (let y = 0; y < H; y++) { const m = (d.k ?? 1) * sm(d.band ?? 0.2, (d.band ?? 0.2) + (d.ramp ?? 0.3), Math.abs(y / H - (d.focus ?? 0.55))); if (m <= 0) continue; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; for (let c = 0; c < 3; c++) img[i + c] += (bl[i + c] - img[i + c]) * m; } }
    }
    const rgba = new Uint8ClampedArray(N * 4), brgba = bimg ? new Uint8ClampedArray(N * 4) : null, still = bimg ? new Uint8ClampedArray(N * 4) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, vx = x / W - 0.5, vy = y / H - 0.5, vig = 1 - (o.vignette ?? 0) * (vx * vx + vy * vy) * 2.2;
      for (let c = 0; c < 3; c++) {
        const s = clamp(img[i * 3 + c] * vig, 0, 255); rgba[i * 4 + c] = s;
        if (bimg) { const b = clamp(bimg[i * 3 + c], 0, 255) * vig; brgba[i * 4 + c] = b; still[i * 4 + c] = s + (255 - s) * b / 255; }
      }
      rgba[i * 4 + 3] = 255; if (bimg) brgba[i * 4 + 3] = still[i * 4 + 3] = 255;
    }
    const fin = (a) => (ss > 1 ? P.downsample(a, W, H, ss) : { rgba: a, w: W, h: H });
    // With layers the main image is the still (shafts baked in); "base" is the same without shafts.
    const res = fin(still || rgba);
    if (o.layers) {
      // beams (opaque, black = no light), and alpha masks for sun pools, moss tops and background
      const mk = (f) => { const a = new Uint8ClampedArray(N * 4); for (let i = 0; i < N; i++) f(i, a); return fin(a).rgba; };
      const mossIds = new Set(o.mossIds || []), leafIds = new Set(o.leafIds || []);
      res.layers = {
        base: fin(rgba).rgba,
        beams: fin(brgba).rgba,
        leaf: mk((i, a) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = leafIds.has(buf.ri[i]) ? 255 : 0; }),
        pool: mk((i, a) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = buf.lt ? clamp(buf.lt[i] * 1.6, 0, 1) * 255 : 0; }),
        moss: mk((i, a) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = mossIds.has(buf.ri[i]) && buf.tag[i] !== 4 ? 255 : 0; }),
        bg: mk((i, a) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = buf.tag[i] === 4 ? 255 : 0; }),
      };
      // waterfalls and their foam, for the falling-water animation
      if ((o.fallIds || []).length) { const fallIds = new Set(o.fallIds); res.layers.falls = mk((i, a) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = fallIds.has(buf.ri[i]) ? 255 : 0; }); }
    }
    return res;
  };
})();
