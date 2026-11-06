/* SDF models in world cell units (anchor at ground centre, Z up). Each takes
   { seed, t (0..1 animation phase), ... } and returns { prims, r, h, occ?, detail? }. */
(function () {
  const P = window.PX, { S, E, C, B, Y } = P.prim, TAU = Math.PI * 2;
  const M = (window.MODELS = {});
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const VF = [0.577, 0.577, 0.577], VR = [0.707, -0.707, 0], VU = [-0.408, -0.408, 0.816];

  // Paints a face (two eyes, mouth) on a head facing the viewer.
  function face(q, hr, tilt, eyes, mouth) {
    if (q[0] * VF[0] + q[1] * VF[1] + q[2] * VF[2] < 0.25 * hr) return false;
    let u = (q[0] * VR[0] + q[1] * VR[1]) / hr, v = (q[0] * VU[0] + q[1] * VU[1] + q[2] * VU[2]) / hr;
    const c = Math.cos(tilt), s = Math.sin(tilt); [u, v] = [u * c + v * s, -u * s + v * c];
    for (const [ex, ey, er] of eyes) if ((u - ex) ** 2 + (v - ey) ** 2 < er * er) return true;
    if (mouth && (u - mouth[0]) ** 2 + ((v - mouth[1]) * 1.3) ** 2 < mouth[2] ** 2) return true;
    return false;
  }

  // ---------------------------------------------------------------- flora
  M.cedar = (o = {}) => {
    const r = P.rng(o.seed || 1), H = o.H ?? 2.4, g = o.girth ?? 1, p = [], occ = [];
    const lx = (r() - 0.5) * 0.16, ly = (r() - 0.5) * 0.16;
    p.push(C([0, 0, -0.1], [lx, ly, H * 0.95], 0.17 * g, 0.045, "bark"));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + r() * 0.8;
      p.push(C([0, 0, 0.3 * g], [Math.cos(a) * 0.4 * g, Math.sin(a) * 0.4 * g, -0.04], 0.085 * g, 0.035, "bark", { k2: 0.08 }));
    }
    const tiers = o.tiers ?? 6, start = o.start ?? 0.32;
    for (let i = 0; i < tiers; i++) {
      const u = i / (tiers - 1), z = H * (start + (0.98 - start) * u), R = (o.spread ?? 0.56) * (1 - u * 0.86) + 0.06;
      const cx = (lx * z) / H, cy = (ly * z) / H, n = Math.max(3, Math.round(7 - u * 4));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + i * 1.3 + r() * 0.5;
        p.push(S([cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66, z - 0.08 - r() * 0.05], R * (0.4 + r() * 0.14), "leaf", { k2: 0.05 }));
      }
      p.push(S([cx, cy, z], R * 0.5, "leaf", { k2: 0.05 }));
      occ.push({ x: cx, y: cy, z, r: R * 0.9 });
    }
    occ.push({ x: 0, y: 0, z: H * 0.3, r: 0.12 * g });
    return {
      prims: p, r: (o.spread ?? 0.62) + 0.4, h: H + 0.45, occ,
      detail: (x, y, z, m, nx, ny, nz) => (m === "bark" && z < H * 0.5 && P.noise(x * 7, y * 7, z * 5, 4) > 0.58 - nz * 0.3 ? "moss" : m),
    };
  };

  M.pine = (o = {}) => {
    const r = P.rng(o.seed || 2), p = [], occ = [], sz = o.sz ?? 1;
    const pts = [[0, 0, 0], [0.13 * sz, -0.05 * sz, 0.42 * sz], [-0.08 * sz, 0.1 * sz, 0.8 * sz], [0.05 * sz, 0.02 * sz, 1.12 * sz]];
    for (let i = 0; i < 3; i++) p.push(C(pts[i], pts[i + 1], (0.1 - i * 0.022) * sz, (0.078 - i * 0.022) * sz, "bark", { k2: 0.04 }));
    const pads = [[1, 0.6 + r(), 0.42], [2, 3.3 + r(), 0.38], [1, 4.6 + r(), 0.3], [3, 0, 0]];
    for (const [pi, a, len] of pads) {
      const base = pts[pi], c = add(base, [Math.cos(a) * len * sz, Math.sin(a) * len * sz, 0.1 * sz]);
      if (len) p.push(C(base, c, 0.04 * sz, 0.025 * sz, "bark", { k2: 0.03 }));
      const R = (len ? 0.3 : 0.26) * sz;
      p.push(E(add(c, [0, 0, 0.02]), [R, R, R * 0.38], "pine", { k2: 0.05 }));
      for (let k = 0; k < 6; k++) { const b = (k / 6) * TAU + r(); p.push(S(add(c, [Math.cos(b) * R * 0.62, Math.sin(b) * R * 0.62, R * 0.2]), R * 0.4, "pine", { k2: 0.05 })); }
      p.push(S(add(c, [0, 0, R * 0.32]), R * 0.45, "pine", { k2: 0.05 }));
      occ.push({ x: c[0], y: c[1], z: c[2] + 0.04, r: R * 0.95 });
    }
    return { prims: p, r: 0.85 * sz, h: 1.5 * sz, occ };
  };

  M.maple = (o = {}) => {
    const r = P.rng(o.seed || 3), p = [], sz = o.sz ?? 1, top = [0.04 * sz, 0.03 * sz, 0.95 * sz];
    p.push(C([0, 0, -0.05], [0.05 * sz, 0.03 * sz, 0.75 * sz], 0.08 * sz, 0.045 * sz, "bark"));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + r(); p.push(C([0.04 * sz, 0.02 * sz, 0.6 * sz], add(top, [Math.cos(a) * 0.3 * sz, Math.sin(a) * 0.3 * sz, 0.05]), 0.035 * sz, 0.02 * sz, "bark")); }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU * 2.3 + r(), el = (r() - 0.3) * 1.1, R = 0.38 * sz;
      p.push(S(add(top, [Math.cos(a) * Math.cos(el) * R, Math.sin(a) * Math.cos(el) * R, Math.sin(el) * R * 0.75]), (0.17 + r() * 0.08) * sz, o.mat || "maple", { k2: 0.05 }));
    }
    p.push(S(top, 0.36 * sz, o.mat || "maple", { k2: 0.05 }));
    return { prims: p, r: 0.75 * sz, h: 1.5 * sz, occ: [{ x: top[0], y: top[1], z: top[2], r: 0.5 * sz }] };
  };

  M.bush = (o = {}) => {
    const r = P.rng(o.seed || 4), p = [], sz = o.sz ?? 1, m = o.mat || "leaf2";
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + r(); p.push(S([Math.cos(a) * 0.17 * sz, Math.sin(a) * 0.17 * sz, (0.1 + r() * 0.08) * sz], (0.13 + r() * 0.06) * sz, m, { k2: 0.04 })); }
    p.push(S([0, 0, 0.2 * sz], 0.19 * sz, m, { k2: 0.04 }));
    return {
      prims: p, r: 0.42 * sz, h: 0.5 * sz,
      detail: (x, y, z, mm, nx, ny, nz) => (o.bloom && P.noise(x * 16, y * 16, z * 16, 5) > 0.64 && nz > -0.2 ? o.bloom : mm),
    };
  };

  M.fern = (o = {}) => {
    const r = P.rng(o.seed || 9), p = [], sz = o.sz ?? 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + r() * 0.4, mid = [Math.cos(a) * 0.16 * sz, Math.sin(a) * 0.16 * sz, 0.2 * sz], tip = [Math.cos(a) * 0.32 * sz, Math.sin(a) * 0.32 * sz, 0.1 * sz];
      p.push(C([0, 0, 0.02], mid, 0.035 * sz, 0.05 * sz, "leaf2", { k2: 0.03 }), C(mid, tip, 0.05 * sz, 0.012 * sz, "leaf2", { k2: 0.03 }));
    }
    return { prims: p, r: 0.4 * sz, h: 0.35 * sz };
  };

  M.rock = (o = {}) => {
    const sz = o.sz ?? 1;
    return {
      prims: [E([0, 0, 0.1 * sz], [0.3 * sz, 0.24 * sz, 0.2 * sz], "stone", { disp: 0.05 * sz, df: 6 / sz }), S([0.1 * sz, -0.07 * sz, 0.2 * sz], 0.15 * sz, "stone", { k2: 0.06, disp: 0.04 * sz, df: 6 / sz })],
      r: 0.42 * sz, h: 0.45 * sz, occ: [{ x: 0, y: 0, z: 0.12 * sz, r: 0.22 * sz }],
      detail: (x, y, z, m, nx, ny, nz) => (o.moss !== false && nz > 0.45 + (P.noise(x * 9, y * 9, z * 9, 2) - 0.5) * 0.7 ? "moss" : m),
    };
  };

  M.mushroomTree = (o = {}) => {
    const r = P.rng(o.seed || 5), H = o.H ?? 2.2, p = [], occ = [];
    let prev = [0, 0, -0.05]; const pts = [prev];
    for (let i = 1; i <= 5; i++) { const q = [Math.sin(i * 1.3 + r()) * 0.12, Math.cos(i * 0.9 + r()) * 0.12, (H * i) / 5]; p.push(C(prev, q, 0.15 - i * 0.017, 0.13 - i * 0.017, "stalk", { k2: 0.06 })); pts.push(q); prev = q; }
    p.push(E(add(prev, [0, 0, 0.05]), [0.62, 0.62, 0.16], "cap", { k2: 0.04 }), E(add(prev, [0, 0, -0.02]), [0.56, 0.56, 0.05], "gill"));
    occ.push({ x: prev[0], y: prev[1], z: prev[2] + 0.05, r: 0.6 });
    for (let i = 0; i < 9; i++) { const a = r() * TAU, d = r() * 0.42; p.push(S(add(prev, [Math.cos(a) * d, Math.sin(a) * d, 0.17 - d * 0.25]), 0.035 + r() * 0.02, "capspot")); }
    for (let i = 1; i < 4; i++) { const q = pts[i + 1], a = r() * TAU, c = add(q, [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0]); p.push(E(c, [0.2, 0.2, 0.05], "cap", { k2: 0.05 })); occ.push({ x: c[0], y: c[1], z: c[2], r: 0.18 }); }
    for (let i = 0; i < 6; i++) { const a = r() * TAU, d = 0.35 + r() * 0.2, top = add(prev, [Math.cos(a) * d, Math.sin(a) * d, -0.05]); p.push(C(top, add(top, [0, 0, -0.18 - r() * 0.2]), 0.006, 0.006, "stalk"), S(add(top, [0, 0, -0.2 - r() * 0.2]), 0.035, "spore")); }
    return { prims: p, r: 0.85, h: H + 0.3, occ };
  };

  M.sporeReeds = (o = {}) => {
    const r = P.rng(o.seed || 6), p = [];
    for (let i = 0; i < 5; i++) { const a = r() * TAU, d = r() * 0.18, h = 0.35 + r() * 0.45, b = [Math.cos(a) * d, Math.sin(a) * d, 0], tp = add(b, [(r() - 0.5) * 0.12, (r() - 0.5) * 0.12, h]); p.push(C(b, tp, 0.045, 0.02, "stalk", { k2: 0.02 }), S(tp, 0.045, "spore")); }
    return { prims: p, r: 0.32, h: 0.9 };
  };

  M.lily = () => ({ prims: [E([0, 0, 0.01], [0.17, 0.15, 0.015], "leaf2")], r: 0.22, h: 0.06 });

  // ---------------------------------------------------------------- built things
  M.lantern = (o = {}) => {
    const t = o.t ?? 0, p = [
      B([0, 0, 0.04], [0.17, 0.17, 0.04], 0.015, "stone"),
      Y([0, 0, 0.26], 0.06, 0.2, "stone", { round: 0.01 }),
      B([0, 0, 0.49], [0.15, 0.15, 0.03], 0.015, "stone"),
      B([0, 0, 0.6], [0.105, 0.105, 0.08], 0.01, "stone"),
      B([0.104, 0, 0.6], [0.012, 0.05, 0.048], 0, "glow"),
      B([0, 0.104, 0.6], [0.05, 0.012, 0.048], 0, "glow"),
      B([0, 0, 0.71], [0.21, 0.21, 0.02], 0.02, "stone"),
      C([0, 0, 0.72], [0, 0, 0.84], 0.19, 0.025, "stone"),
      S([0, 0, 0.87], 0.04, "stone"),
    ];
    if (o.wisps !== false) for (let k = 0; k < 3; k++) { const a = (t + k / 3) * TAU; p.push(S([Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.62 + Math.sin(a * 2) * 0.06], 0.035, "wisp")); }
    return { prims: p, r: 0.42, h: 1.0, occ: [{ x: 0, y: 0, z: 0.5, r: 0.12 }], detail: (x, y, z, m, nx, ny, nz) => (m === "stone" && nz > 0.6 && P.noise(x * 11, y * 11, z * 11, 3) > 0.42 ? "moss" : m) };
  };

  M.torii = () => ({
    prims: [
      Y([0, -0.42, 0.5], 0.045, 0.5, "lacq"), Y([0, 0.42, 0.5], 0.045, 0.5, "lacq"),
      Y([0, -0.42, 0.05], 0.055, 0.05, "ink"), Y([0, 0.42, 0.05], 0.055, 0.05, "ink"),
      B([0, 0, 0.82], [0.03, 0.5, 0.025], 0, "lacq"),
      B([0, 0, 0.97], [0.05, 0.56, 0.03], 0.005, "lacq"),
      B([0, 0, 1.04], [0.06, 0.64, 0.03], 0.01, "ink", { R: P.rot("x", 0) }),
      B([0, -0.66, 1.07], [0.06, 0.06, 0.03], 0.01, "ink", { R: P.rot("x", 0.4) }), B([0, 0.66, 1.07], [0.06, 0.06, 0.03], 0.01, "ink", { R: P.rot("x", -0.4) }),
    ],
    r: 0.78, h: 1.2,
  });

  // ---------------------------------------------------------------- spirits & guardians
  M.mossling = (o = {}) => {
    const t = o.t ?? 0, sz = o.sz ?? 1, tilt = Math.sin(t * TAU) * (o.rattle ? 0.45 : 0.15), hc = [0, 0, 0.27 * sz], hr = 0.1 * sz;
    const lean = Math.sin(t * TAU) * (o.rattle ? 0.03 : 0.01);
    const p = [
      C([0, 0, 0.02], [0, 0, 0.16 * sz], 0.07 * sz, 0.05 * sz, "spirit", { k2: 0.02 }),
      C([0.02 * sz, 0.06 * sz, 0.14 * sz], [0.05 * sz, 0.09 * sz, 0.07 * sz], 0.018 * sz, 0.014 * sz, "spirit"),
      C([0.06 * sz, 0.02 * sz, 0.14 * sz], [0.09 * sz, 0.05 * sz, 0.07 * sz], 0.018 * sz, 0.014 * sz, "spirit"),
      E(add(hc, [lean, -lean, 0]), [0.095 * sz, 0.095 * sz, 0.11 * sz], "spirit", { k2: 0.03 }),
      C(add(hc, [lean, -lean, 0.1 * sz]), add(hc, [0.02 * sz + lean * 2, -lean * 2, 0.17 * sz]), 0.012 * sz, 0.008 * sz, "leaf2"),
      E(add(hc, [0.06 * sz + lean * 2, -lean * 2, 0.18 * sz]), [0.045 * sz, 0.025 * sz, 0.012 * sz], "leaf2", { R: P.rot("y", 0.5) }),
    ];
    return {
      prims: p, r: 0.2 * sz, h: 0.5 * sz,
      detail: (x, y, z, m) => (m === "spirit" && z > hc[2] - 0.06 * sz && face([x - hc[0] - lean, y - hc[1] + lean, z - hc[2]], hr, tilt, [[-0.36, 0.12, 0.17], [0.36, 0.12, 0.17]], [0.02, -0.36, 0.13]) ? "void" : m),
    };
  };

  // White wolf guardian sitting on a plinth, facing +Y (screen down-left).
  M.wolf = (o = {}) => {
    const t = o.t ?? 0, br = Math.sin(t * TAU) * 0.012, hd = Math.sin(t * TAU + 1) * 0.015, F = (f, s, z) => [s, f, z];
    const p = [
      B([0, 0, 0.09], [0.25, 0.25, 0.09], 0.02, "stone"),
      E(F(-0.06, 0, 0.32), [0.15, 0.17, 0.14], "fur", { k2: 0.06 }),
      E(F(0.06, 0, 0.45 + br), [0.12, 0.12, 0.17 + br], "fur", { k2: 0.07 }),
      E(F(0.09, 0, 0.56 + br), [0.13, 0.12, 0.1], "fur", { k2: 0.06 }),
      S(F(0.15, 0, 0.66 + hd), 0.085, "fur", { k2: 0.05 }),
      C(F(0.19, 0, 0.645 + hd), F(0.31, 0, 0.615 + hd), 0.048, 0.028, "fur", { k2: 0.03 }),
      S(F(0.322, 0, 0.62 + hd), 0.018, "ink"),
      C(F(0.13, 0.05, 0.72 + hd), F(0.11, 0.065, 0.83 + hd), 0.03, 0.006, "fur"), C(F(0.13, -0.05, 0.72 + hd), F(0.11, -0.065, 0.83 + hd), 0.03, 0.006, "fur"),
      C(F(0.13, 0.065, 0.4), F(0.16, 0.065, 0.19), 0.036, 0.03, "fur", { k2: 0.02 }), C(F(0.13, -0.065, 0.4), F(0.16, -0.065, 0.19), 0.036, 0.03, "fur", { k2: 0.02 }),
      C(F(-0.18, 0.06, 0.22), add(F(-0.12, 0.2, 0.2), [Math.sin(t * TAU) * 0.03, 0, 0]), 0.05, 0.028, "fur", { k2: 0.03 }),
      S(F(0.2, 0.045, 0.68 + hd), 0.014, "eye"), S(F(0.2, -0.045, 0.68 + hd), 0.014, "eye"),
    ];
    return { prims: p, r: 0.42, h: 0.95, occ: [{ x: 0, y: 0, z: 0.45, r: 0.18 }], detail: (x, y, z, m, nx, ny, nz) => (m === "stone" && nz > 0.5 && P.noise(x * 10, y * 10, 0, 1) > 0.5 ? "moss" : m) };
  };

  M.mushroom = (o = {}) => {
    const t = o.t ?? 0, sq = Math.max(0, Math.sin(t * TAU)) * 0.04, p = [
      S([0, 0, 0.06], 0.12, "stalk", { k2: 0.06 }),
      C([0, 0, 0], [0.03, 0, 0.42 - sq], 0.095, 0.065, "stalk", { k2: 0.05 }),
      E([0.03, 0, 0.5 - sq], [0.31 + sq, 0.31 + sq, 0.15 - sq], "cap", { k2: 0.03 }),
      E([0.03, 0, 0.445 - sq], [0.28, 0.28, 0.05], "gill"),
      S([-0.2, 0.17, 0.05], 0.05, "cap", { k2: 0.02 }), C([-0.2, 0.17, 0], [-0.2, 0.17, 0.04], 0.025, 0.02, "stalk"),
    ];
    for (let i = 0; i < 7; i++) { const a = i * 2.4 + 0.5, d = 0.08 + (i % 3) * 0.07; p.push(S([0.03 + Math.cos(a) * d, Math.sin(a) * d, 0.62 - sq - d * 0.3], 0.03, "capspot")); }
    for (let k = 0; k < 3; k++) { const u = (t + k / 3) % 1; p.push(S([0.03 + Math.sin(k * 2 + u * 4) * 0.08, Math.cos(k * 3) * 0.08, 0.72 + u * 0.45], 0.05 * (1 - u) + 0.015, "spore")); }
    return { prims: p, r: 0.4, h: 1.3, occ: [{ x: 0, y: 0, z: 0.5, r: 0.3 }] };
  };

  // ---------------------------------------------------------------- enemies (face +X)
  M.boar = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.sin(ph)) * 0.025, sz = o.sz ?? 1, p = [];
    const s3 = (v) => [v[0] * sz, v[1] * sz, v[2] * sz];
    p.push(
      E(s3([0, 0, 0.3 + bob]), s3([0.36, 0.21, 0.2]), "hide", { k2: 0.08 * sz }),
      S(s3([-0.06, 0, 0.42 + bob]), 0.17 * sz, "hide", { k2: 0.1 * sz }),
      E(s3([0.33, 0, 0.27 + bob]), s3([0.15, 0.13, 0.13]), "hide", { k2: 0.07 * sz }),
      C(s3([0.4, 0, 0.25 + bob]), s3([0.52, 0, 0.2 + bob]), 0.08 * sz, 0.06 * sz, "hide", { k2: 0.03 * sz }),
      S(s3([0.535, 0, 0.2 + bob]), 0.045 * sz, "snout"),
    );
    for (const sd of [-1, 1]) {
      p.push(C(s3([0.46, sd * 0.06, 0.17 + bob]), s3([0.56, sd * 0.1, 0.27 + bob]), 0.024 * sz, 0.007 * sz, "tusk"));
      p.push(C(s3([0.29, sd * 0.08, 0.37 + bob]), s3([0.24, sd * 0.13, 0.46 + bob]), 0.035 * sz, 0.01 * sz, "hide"));
      p.push(S(s3([0.43, sd * 0.075, 0.31 + bob]), 0.022 * sz, "eyeRed"));
      for (const fr of [1, -1]) {
        const lp = ph + (fr * sd > 0 ? 0 : Math.PI), sw = Math.sin(lp) * 0.08, lift = Math.max(0, Math.cos(lp)) * 0.05;
        p.push(C(s3([fr * 0.2, sd * 0.11, 0.22 + bob]), s3([fr * 0.2 + sw, sd * 0.12, 0.03 + lift]), 0.055 * sz, 0.035 * sz, "hide", { k2: 0.02 * sz }));
      }
    }
    const r = P.rng(o.seed || 7);
    for (let i = 0; i < (o.tendrils ?? 9); i++) {
      let pt = [-0.22 + r() * 0.36, (r() - 0.5) * 0.26, 0.42 + bob], dir = [r() - 0.6, (r() - 0.5) * 1.2, 1.1];
      for (let sgm = 0; sgm < 3; sgm++) {
        const wig = Math.sin(ph + i * 1.7 + sgm * 1.1) * 0.6, len = 0.1 - sgm * 0.015;
        const d = [dir[0] + wig * 0.6, dir[1] + Math.cos(ph + i + sgm) * 0.5, dir[2] - sgm * 0.45], dl = Math.hypot(...d);
        const nx = add(pt, [(d[0] / dl) * len, (d[1] / dl) * len, (d[2] / dl) * len]);
        p.push(C(s3(pt), s3(nx), (0.032 - sgm * 0.008) * sz, (0.024 - sgm * 0.008) * sz, "curse", { k2: 0.02 * sz }));
        pt = nx; dir = d;
      }
    }
    return {
      prims: p, r: 0.75 * sz, h: 1.0 * sz,
      detail: (x, y, z, m, nx, ny, nz) => (m === "hide" && nz > 0.35 && P.noise(x * 9 / sz, y * 9 / sz, z * 9 / sz, 8) > 0.6 ? "curse" : m),
    };
  };

  M.shellback = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, sz = o.sz ?? 1, p = [], s3 = (v) => [v[0] * sz, v[1] * sz, v[2] * sz];
    for (let k = 0; k < 6; k++) {
      const x = -0.42 + k * 0.145, w = 0.75 + 0.25 * Math.sin((k / 5) * Math.PI), wave = Math.sin(ph - k * 0.9) * 0.018;
      p.push(E(s3([x, 0, 0.2 + wave]), s3([0.1, 0.25 * w, 0.21 * w]), "shell", { k2: 0.012 * sz }));
    }
    p.push(E(s3([0.4, 0, 0.17]), s3([0.11, 0.21, 0.14]), "shell", { k2: 0.02 * sz }));
    for (let k = 0; k < 7; k++) p.push(S(s3([0.47 + (3 - Math.abs(k - 3)) * 0.006, (k - 3) * 0.052, 0.24 - Math.abs(k - 3) * 0.014]), 0.024 * sz, o.angry ? "eyeRed" : "eyeBlue"));
    for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) { const lp = ph + k * 1.4 + (sd > 0 ? 0 : Math.PI); p.push(C(s3([-0.3 + k * 0.2, sd * 0.18, 0.08]), s3([-0.3 + k * 0.2 + Math.sin(lp) * 0.05, sd * 0.27, 0.01 + Math.max(0, Math.cos(lp)) * 0.03]), 0.022 * sz, 0.014 * sz, "shellDark")); }
    return { prims: p, r: 0.7 * sz, h: 0.55 * sz };
  };

  M.moth = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, z0 = 0.72 + Math.sin(ph) * 0.04, fl = 0.15 + 0.95 * (0.5 + 0.5 * Math.sin(ph)), p = [];
    p.push(C([-0.12, 0, z0 - 0.01], [0.1, 0, z0 + 0.02], 0.045, 0.035, "mothBody"), S([0.13, 0, z0 + 0.035], 0.042, "mothBody"));
    p.push(C([0.16, 0.02, z0 + 0.06], [0.22, 0.07, z0 + 0.14], 0.006, 0.004, "mothBody"), C([0.16, -0.02, z0 + 0.06], [0.22, -0.07, z0 + 0.14], 0.006, 0.004, "mothBody"));
    for (const sd of [-1, 1]) {
      const ang = sd * fl, span = 0.24, c = [0.0, sd * Math.cos(fl) * span, z0 + Math.sin(fl) * span];
      p.push(E(c, [0.17, span, 0.012], "wing", { R: P.rot("x", ang) }));
      p.push(E(add(c, [-0.16, -sd * Math.cos(fl) * 0.1, -Math.sin(fl) * 0.1]), [0.1, 0.14, 0.01], "wing", { R: P.rot("x", ang) }));
    }
    return {
      prims: p, r: 0.55, h: 1.15,
      detail: (x, y, z, m) => {
        if (m !== "wing") return m;
        const dy = Math.abs(y), dz = z - z0, rr = Math.sqrt(dy * dy + dz * dz);
        if (rr > 0.38) return "wingTip";
        if (Math.abs(rr - 0.24) < 0.035 && x > -0.05 && x < 0.08) return "wingEye";
        return m;
      },
    };
  };

  M.ironclad = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.cos(ph)) * 0.02, p = [];
    for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + (sd > 0 ? 0 : Math.PI)) * 0.09, lift = Math.max(0, Math.cos(ph + (sd > 0 ? 0 : Math.PI))) * 0.04, hip = [0, sd * 0.06, 0.3 + bob], foot = [sw, sd * 0.065, 0.035 + lift];
      p.push(C(hip, foot, 0.042, 0.036, "cloth"), E(add(foot, [0.02, 0, -0.005]), [0.05, 0.035, 0.03], "iron"));
      p.push(C([0, sd * 0.13, 0.55 + bob], [0.06 - sw * 0.4, sd * 0.15, 0.4 + bob], 0.034, 0.03, "cloth", { k2: 0.02 }));
    }
    p.push(
      B([0, 0, 0.45 + bob], [0.07, 0.1, 0.12], 0.04, "cloth", { k2: 0.02 }),
      B([0.025, 0, 0.47 + bob], [0.07, 0.115, 0.085], 0.02, "iron", { k2: 0.01 }),
      B([0, 0, 0.32 + bob], [0.09, 0.125, 0.045], 0.02, "iron"),
      B([0.06, 0, 0.42 + bob], [0.01, 0.1, 0.012], 0, "sash"),
      S([0.01, 0, 0.66 + bob], 0.062, "skin"),
      C([0, 0, 0.69 + bob], [0, 0, 0.8 + bob], 0.22, 0.012, "straw"),
      C([0.08, 0.15, 0.28 + bob], [0.16, 0.15, 0.98 + bob], 0.012, 0.012, "wood"),
      C([0.16, 0.15, 0.98 + bob], [0.175, 0.15, 1.08 + bob], 0.022, 0.003, "iron"),
    );
    return { prims: p, r: 0.42, h: 1.15 };
  };

  M.roster = [
    ["Spirit Lantern", "lantern", {}],
    ["Wolf Guardian", "wolf", {}],
    ["Spore Mortar", "mushroom", {}],
    ["Mossling", "mossling", { rattle: true }],
    ["Blight Boar", "boar", {}],
    ["Shellback", "shellback", {}],
    ["Ash Moth", "moth", {}],
    ["Ironclad", "ironclad", {}],
  ];
})();
