/* Second model set: a chibi "cozy" roster for Cedar Deep, and units/props for the themed tilesets.
   Same conventions as models.js: world cell units, anchor at ground centre, Z up, enemies face +X. */
(function () {
  const P = window.PX, { S, E, C, B, Y } = P.prim, TAU = Math.PI * 2;
  const M = window.MODELS;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const VF = [0.577, 0.577, 0.577], VR = [0.707, -0.707, 0], VU = [-0.408, -0.408, 0.816], UP = [0, 0, 1];
  const FW = [0.707, 0.707, 0]; // horizontal "toward the viewer"
  const len = (q) => Math.hypot(q[0], q[1], q[2]);
  // Rotation rows for a box whose local x runs along d and local z along n.
  function frame(d, n) {
    const w = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
    return [...d, ...w, ...n];
  }

  // Chibi face painted toward the viewer: big eyes with a highlight, optional blush, mouth, angry brows.
  function cface(q, hr, o = {}) {
    if (q[0] * VF[0] + q[1] * VF[1] + q[2] * VF[2] < 0.15 * hr) return null;
    let u = (q[0] * VR[0] + q[1] * VR[1]) / hr, v = (q[0] * VU[0] + q[1] * VU[1] + q[2] * VU[2]) / hr;
    if (o.tilt) { const c = Math.cos(o.tilt), s = Math.sin(o.tilt); [u, v] = [u * c + v * s, -u * s + v * c]; }
    const ex = o.ex ?? 0.36, ey = o.ey ?? 0.05, er = o.er ?? 0.2, sq = o.squint ?? 1;
    for (const sx of o.one ? [0] : [-1, 1]) {
      const du = u - sx * ex, dv = (v - ey) * sq;
      if (du * du + dv * dv < er * er) {
        if (o.angry && dv > er * 0.3 - -sx * du * 1.0 * (sx ? 1 : 0)) return null;
        if (o.pupil && du * du + dv * dv > (er * o.pupil) ** 2) return o.white || "eyeWhite";
        if (o.hi !== false && (du + er * 0.3) ** 2 + (dv - er * 0.32) ** 2 < (er * 0.42) ** 2) return "eyeHi";
        return o.eye || "void";
      }
      if (o.blush && sx && (u - sx * (ex + 0.16)) ** 2 + ((v - ey + 0.3) * 1.8) ** 2 < 0.16 ** 2) return "blush";
    }
    if (o.mouth) { const [mx, my, mr] = o.mouth; if ((u - mx) ** 2 + ((v - my) * (o.mouthSq ?? 1.5)) ** 2 < mr * mr) return o.mouthM || "void"; }
    return null;
  }
  const near = (x, y, z, c, r) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < r * r;
  const mossTop = (k = 10, th = 0.5) => (x, y, z, m, nx, ny, nz) => (nz > th && P.noise(x * k, y * k, z * k, 3) > 0.5 ? "moss" : m);
  const orbit = (t, n, R, z, r, mat, wob = 0.05) => Array.from({ length: n }, (_, k) => { const a = (t + k / n) * TAU; return S([Math.cos(a) * R, Math.sin(a) * R, z + Math.sin(a * 2) * wob], r, mat); });

  // ================================================================ cozy roster
  M.hotaru = (o = {}) => {
    const t = o.t ?? 0, bob = Math.sin(t * TAU) * 0.015, hc = [0, 0, 0.47 + bob], p = [
      B([0, 0, 0.035], [0.12, 0.12, 0.035], 0.02, "stone"),
      C([0, 0, 0.06], [0, 0, 0.3], 0.03, 0.025, "wood"),
      E(hc, [0.17, 0.17, 0.18], "paper", { k2: 0.02 }),
      Y(add(hc, [0, 0, -0.18]), 0.09, 0.022, "lacq", { round: 0.01 }),
      Y(add(hc, [0, 0, 0.18]), 0.09, 0.022, "lacq", { round: 0.01 }),
      C(add(hc, [0, 0, 0.2]), add(hc, [0, 0, 0.27]), 0.014, 0.014, "lacq"),
    ];
    if (o.wisps !== false) p.push(...orbit(t, 3, 0.3, hc[2], 0.03, "firefly", 0.08));
    return {
      prims: p, r: 0.34, h: 0.8, k: o.k ?? 1.9, occ: [{ x: 0, y: 0, z: hc[2], r: 0.15 }],
      detail: (x, y, z, m) => {
        if (m !== "paper") return m;
        const f = cface([x - hc[0], y - hc[1], z - hc[2]], 0.17, { ex: 0.36, ey: 0.04, er: 0.22, blush: true, mouth: [0, -0.34, 0.08] });
        if (f) return f;
        return ((((z - hc[2]) * 7) % 1) + 1) % 1 < 0.2 ? "paperRib" : m;
      },
    };
  };

  M.pup = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, hd = Math.sin(ph) * 0.012, wag = Math.sin(ph * 2) * 0.06, hc = [0, 0, 0.44 + hd], hr = 0.15, p = [
      B([0, 0, 0.04], [0.17, 0.17, 0.04], 0.03, "stone"),
      E([-0.03, -0.03, 0.21], [0.13, 0.13, 0.13], "fur", { k2: 0.04 }),
      S(hc, hr, "fur", { k2: 0.04 }),
      E(add(hc, [0.09, 0.09, -0.06]), [0.065, 0.065, 0.05], "fur", { k2: 0.02 }),
      S(add(hc, [0.14, 0.14, -0.045]), 0.024, "ink"),
      C([-0.12, -0.12, 0.13], [-0.17 + wag * 0.5, -0.09 - wag, 0.3], 0.045, 0.028, "fur", { k2: 0.02 }),
    ];
    for (const sd of [-1, 1]) {
      const base = add(hc, [sd * 0.064 - 0.02, -sd * 0.064 - 0.02, 0.09]);
      p.push(C(base, add(base, [sd * 0.03, -sd * 0.03, 0.12]), 0.05, 0.008, "fur"));
      p.push(C([0.05 + sd * 0.05, 0.05 - sd * 0.05, 0.17], [0.08 + sd * 0.05, 0.08 - sd * 0.05, 0.1], 0.035, 0.034, "fur", { k2: 0.02 }));
    }
    return {
      prims: p, r: 0.3, h: 0.72, k: 2.0, occ: [{ x: 0, y: 0, z: 0.35, r: 0.15 }],
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "fur" && near(x, y, z, hc, hr * 1.08)) return cface([x - hc[0], y - hc[1], z - hc[2]], hr, { ex: 0.4, ey: 0.16, er: 0.24, blush: true }) || m;
        return m === "stone" ? mossTop(10, 0.5)(x, y, z, m, nx, ny, nz) : m;
      },
    };
  };

  M.puffcap = (o = {}) => {
    const t = o.t ?? 0, sq = Math.max(0, Math.sin(t * TAU)) * 0.03, hc = [0, 0, 0.15], p = [
      E([0, 0, 0.16], [0.13 + sq * 0.5, 0.13 + sq * 0.5, 0.16 - sq * 0.5], "stalk", { k2: 0.03 }),
      E([0, 0, 0.42 - sq], [0.28 + sq, 0.28 + sq, 0.14], "cap", { k2: 0.04 }),
      E([0, 0, 0.36 - sq], [0.24, 0.24, 0.04], "gill"),
    ];
    for (let i = 0; i < 6; i++) { const a = i * 2.4 + 0.4, d = 0.06 + (i % 3) * 0.07; p.push(S([Math.cos(a) * d, Math.sin(a) * d, 0.54 - sq - d * 0.4], 0.035, "capspot")); }
    for (let k = 0; k < 3; k++) { const u = (t + k / 3) % 1; p.push(S([Math.sin(k * 2 + u * 4) * 0.08, Math.cos(k * 3) * 0.08, 0.62 + u * 0.35], 0.045 * (1 - u) + 0.015, "spore")); }
    return {
      prims: p, r: 0.36, h: 1.0, k: 1.8, occ: [{ x: 0, y: 0, z: 0.42, r: 0.26 }],
      detail: (x, y, z, m) => (m === "stalk" ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.13, { ex: 0.4, ey: 0.0, er: 0.27, blush: true, mouth: [0, -0.4, 0.1] }) || m : m),
    };
  };

  M.sprout = (o = {}) => {
    const t = o.t ?? 0, tilt = Math.sin(t * TAU) * (o.rattle ? 0.4 : 0.15), lean = Math.sin(t * TAU) * 0.02, hc = [lean, -lean, 0.27], p = [
      E([0, 0, 0.09], [0.075, 0.075, 0.09], "spirit", { k2: 0.03 }),
      C([0.03, 0.07, 0.13], [0.05, 0.11, 0.07], 0.02, 0.016, "spirit"),
      C([0.07, 0.03, 0.13], [0.11, 0.05, 0.07], 0.02, 0.016, "spirit"),
      E(hc, [0.15, 0.15, 0.135], "spirit", { k2: 0.03 }),
      C(add(hc, [0, 0, 0.12]), add(hc, [0.02 + lean * 2, -lean * 2, 0.2]), 0.013, 0.009, "leaf2"),
      E(add(hc, [0.07 + lean * 2, -lean * 2, 0.21]), [0.06, 0.028, 0.012], "leaf2", { R: P.rot("y", 0.5) }),
      E(add(hc, [-0.01 + lean * 2, 0.06 - lean * 2, 0.215]), [0.025, 0.05, 0.012], "leaf2", { R: P.rot("x", -0.5) }),
    ];
    return {
      prims: p, r: 0.22, h: 0.55, k: 2.2,
      detail: (x, y, z, m) => (m === "spirit" && z > hc[2] - 0.11 ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.15, { ex: 0.38, ey: 0.08, er: 0.23, tilt, hi: false, mouth: [0.02, -0.38, 0.11] }) || m : m),
    };
  };

  M.piglet = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.sin(ph)) * 0.02, hc = [0.19, 0.03, 0.3 + bob], hr = 0.15, p = [
      E([0, 0, 0.23 + bob], [0.24, 0.19, 0.17], "hide", { k2: 0.06 }),
      S(hc, hr, "hide", { k2: 0.06 }),
      C(add(hc, [0.09, 0.07, -0.05]), add(hc, [0.14, 0.1, -0.06]), 0.058, 0.058, "snout"),
    ];
    for (const sd of [-1, 1]) {
      const side = mul(VR, sd);
      p.push(C(add(add(hc, mul(side, 0.06)), [0.08, 0.06, -0.1]), add(add(hc, mul(side, 0.075)), [0.1, 0.08, -0.03]), 0.016, 0.006, "tusk"));
      p.push(C(add(add(hc, mul(side, 0.08)), [-0.04, -0.02, 0.1]), add(add(hc, mul(side, 0.13)), [-0.05, -0.03, 0.18]), 0.04, 0.008, "hide"));
      for (const fr of [1, -1]) {
        const lp = ph + (fr * sd > 0 ? 0 : Math.PI), sw = Math.sin(lp) * 0.06, lift = Math.max(0, Math.cos(lp)) * 0.04;
        p.push(C([fr * 0.12, sd * 0.1, 0.15 + bob], [fr * 0.12 + sw, sd * 0.1, 0.035 + lift], 0.05, 0.04, "hide", { k2: 0.02 }));
      }
    }
    const r = P.rng(o.seed || 7);
    for (let i = 0; i < 4; i++) {
      let pt = [-0.12 + r() * 0.2, (r() - 0.5) * 0.2, 0.36 + bob], dir = [r() - 0.6, (r() - 0.5), 1.1];
      for (let sg = 0; sg < 2; sg++) {
        const wig = Math.sin(ph + i * 1.7 + sg) * 0.6, d = [dir[0] + wig * 0.6, dir[1], dir[2] - sg * 0.5], dl = len(d), nx = add(pt, mul(d, 0.09 / dl));
        p.push(C(pt, nx, 0.028 - sg * 0.008, 0.02 - sg * 0.008, "curse", { k2: 0.02 })); pt = nx; dir = d;
      }
    }
    return {
      prims: p, r: 0.5, h: 0.62, k: 1.7,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "hide" && near(x, y, z, hc, hr * 1.1)) { const f = cface(sub([x, y, z], hc), hr, { ex: 0.4, ey: 0.2, er: 0.26, eye: "eyeRed", angry: true }); if (f) return f; }
        return m === "hide" && nz > 0.5 && P.noise(x * 9, y * 9, z * 9, 8) > 0.66 ? "curse" : m;
      },
    };
  };

  M.pillbug = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, hc = [0.3, 0.02, 0.14], p = [];
    for (let k = 0; k < 5; k++) {
      const x = -0.24 + k * 0.11, w = 0.8 + 0.2 * Math.sin((k / 4) * Math.PI), wave = Math.sin(ph - k * 0.9) * 0.015;
      p.push(E([x, 0, 0.16 + wave], [0.08, 0.2 * w, 0.17 * w], k & 1 ? "shell" : "shell", { k2: 0.015 }));
    }
    p.push(E(hc, [0.12, 0.16, 0.14], "shell", { k2: 0.03 }));
    for (const sd of [-1, 1]) {
      const a = add(hc, [0.04, sd * 0.07, 0.08]), b = add(hc, [0.12, sd * 0.14, 0.2 + Math.sin(ph + sd) * 0.02]);
      p.push(C(a, b, 0.012, 0.008, "shellDark"), S(b, 0.025, "eyeBlue"));
      for (let k = 0; k < 3; k++) { const lp = ph + k * 1.6 + (sd > 0 ? 0 : Math.PI); p.push(C([-0.15 + k * 0.15, sd * 0.13, 0.06], [-0.15 + k * 0.15 + Math.sin(lp) * 0.04, sd * 0.19, 0.01 + Math.max(0, Math.cos(lp)) * 0.02], 0.02, 0.014, "shellDark")); }
    }
    return {
      prims: p, r: 0.55, h: 0.48, k: 1.6,
      detail: (x, y, z, m) => {
        if (near(x, y, z, hc, 0.19) && x > 0.22) return cface(sub([x, y, z], hc), 0.15, { ex: 0.42, ey: 0.12, er: 0.3, eye: "eyeBlue", blush: true }) || m;
        return m === "shell" && Math.abs(((x + 0.29) / 0.11) % 1 - 0.5) > 0.42 ? "shellDark" : m;
      },
    };
  };

  M.fluffmoth = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, z0 = 0.5 + Math.sin(ph) * 0.04, fl = 0.2 + 0.9 * (0.5 + 0.5 * Math.sin(ph)), bc = [0.02, 0.02, z0], p = [
      S(bc, 0.13, "fluff", { k2: 0.03 }),
      E([-0.13, -0.05, z0 - 0.04], [0.11, 0.08, 0.08], "mothBody", { k2: 0.05 }),
    ];
    for (const sd of [-1, 1]) {
      const side = mul(VR, sd), a = add(add(bc, mul(side, 0.05)), [-0.02, -0.02, 0.1]), b = add(add(bc, mul(side, 0.12)), [-0.04, -0.04, 0.24]);
      p.push(C(a, b, 0.008, 0.006, "mothBody"), E(b, [0.025, 0.025, 0.05], "wingTip"));
      const ang = sd * fl, span = 0.2, c = [-0.06, sd * Math.cos(fl) * span, z0 + Math.sin(fl) * span];
      p.push(E(c, [0.14, span, 0.012], "wing2", { R: P.rot("x", ang) }));
      p.push(E(add(c, [-0.12, -sd * Math.cos(fl) * 0.08, -Math.sin(fl) * 0.08]), [0.08, 0.11, 0.01], "wing2", { R: P.rot("x", ang) }));
    }
    return {
      prims: p, r: 0.5, h: 0.8, k: 1.8,
      detail: (x, y, z, m) => {
        if (m === "fluff") return cface(sub([x, y, z], bc), 0.13, { ex: 0.38, ey: 0.06, er: 0.3, blush: true }) || m;
        if (m === "wing2") { const dy = Math.abs(y), dz = z - z0; return Math.sqrt(dy * dy + dz * dz) > 0.31 ? "wingTip" : m; }
        return m;
      },
    };
  };

  M.ashigaru = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.cos(ph)) * 0.02, hc = [0.01, 0, 0.42 + bob], p = [];
    for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + (sd > 0 ? 0 : Math.PI)) * 0.06, lift = Math.max(0, Math.cos(ph + (sd > 0 ? 0 : Math.PI))) * 0.03;
      p.push(C([0, sd * 0.05, 0.16 + bob], [sw, sd * 0.055, 0.04 + lift], 0.035, 0.032, "cloth"), E([sw + 0.015, sd * 0.055, 0.03 + lift], [0.045, 0.032, 0.026], "iron"));
    }
    p.push(
      B([0, 0, 0.23 + bob], [0.07, 0.09, 0.08], 0.04, "cloth", { k2: 0.02 }),
      B([0.03, 0, 0.24 + bob], [0.06, 0.1, 0.06], 0.02, "iron", { k2: 0.01 }),
      B([0.07, 0, 0.19 + bob], [0.01, 0.09, 0.012], 0, "sash"),
      S(hc, 0.13, "skin", { k2: 0.02 }),
      E(add(hc, [0, 0, 0.11]), [0.19, 0.19, 0.022], "straw"), C(add(hc, [0, 0, 0.12]), add(hc, [0, 0, 0.2]), 0.07, 0.01, "straw"),
      C([0.04, 0.1, 0.28 + bob], [0.09, 0.13, 0.2 + bob], 0.026, 0.024, "cloth"),
      C([0.04, -0.1, 0.28 + bob], [0.1, -0.14, 0.24 + bob], 0.026, 0.024, "cloth"),
      C([0.1, -0.15, 0.06 + bob], [0.12, -0.16, 0.86 + bob], 0.012, 0.012, "wood"),
      C([0.12, -0.16, 0.86 + bob], [0.125, -0.162, 0.96 + bob], 0.022, 0.003, "iron"),
    );
    return {
      prims: p, r: 0.35, h: 0.95, k: 1.9,
      detail: (x, y, z, m) => (m === "skin" ? cface(sub([x, y, z], hc), 0.13, { ex: 0.4, ey: -0.08, er: 0.25, blush: true, angry: true, mouth: [0, -0.5, 0.08] }) || m : m),
    };
  };

  M.cute = [
    ["Hotaru Lantern", "hotaru", {}],
    ["Wolf Pup", "pup", {}],
    ["Puffcap", "puffcap", {}],
    ["Sprout", "sprout", { rattle: true }],
    ["Blight Piglet", "piglet", {}],
    ["Pill Bug", "pillbug", {}],
    ["Fluff Moth", "fluffmoth", {}],
    ["Little Ashigaru", "ashigaru", {}],
  ];

  // ================================================================ sci-fi: Sky Ruin
  M.pylon = (o = {}) => {
    const t = o.t ?? 0, p = [
      B([0, 0, 0.05], [0.16, 0.16, 0.05], 0.02, "metal"), Y([0, 0, 0.32], 0.045, 0.27, "metal"),
      E([0, 0, 0.22], [0.11, 0.11, 0.022], "metalDark"), E([0, 0, 0.36], [0.09, 0.09, 0.022], "metalDark"), E([0, 0, 0.5], [0.07, 0.07, 0.022], "metalDark"),
      S([0, 0, 0.68], 0.075, "cyan"),
    ];
    const r = P.rng(Math.floor(t * 4) + 3);
    for (let k = 0; k < 4; k++) { const a = r() * TAU, d = 0.11 + r() * 0.08; p.push(S([Math.cos(a) * d, Math.sin(a) * d, 0.62 + r() * 0.14], 0.018, "cyan")); }
    return { prims: p, r: 0.3, h: 0.8, k: 1.9, occ: [{ x: 0, y: 0, z: 0.4, r: 0.08 }], detail: (x, y, z, m, nx, ny, nz) => (m === "metal" ? mossTop(10, 0.55)(x, y, z, m, nx, ny, nz) : m) };
  };

  M.beamTurret = (o = {}) => {
    const t = o.t ?? 0, a = 0.75 + Math.sin(t * TAU) * 0.4, d = [Math.cos(a), Math.sin(a), 0], rc = Math.max(0, Math.cos(t * TAU * 2)) * 0.03, p = [
      Y([0, 0, 0.08], 0.17, 0.08, "metalDark", { round: 0.02 }),
      S([0, 0, 0.18], 0.15, "metal", { k2: 0.02 }),
      C(add(mul(d, 0.05), [0, 0, 0.24]), add(mul(d, 0.32 - rc), [0, 0, 0.27]), 0.04, 0.03, "metalDark"),
      S(add(mul(d, 0.33 - rc), [0, 0, 0.272]), 0.024, "cyan"),
      S(add(mul([Math.cos(a - 1.1), Math.sin(a - 1.1), 0], 0.12), [0, 0, 0.26]), 0.032, "cyan"),
    ];
    return {
      prims: p, r: 0.34, h: 0.42, k: 2.0,
      detail: (x, y, z, m, nx, ny, nz) => (m === "metal" && Math.abs(((z * 18) % 1) - 0.5) > 0.42 ? "metalDark" : m === "metal" ? mossTop(9, 0.7)(x, y, z, m, nx, ny, nz) : m),
    };
  };

  M.crawler = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.sin(ph * 2)) * 0.015, p = [
      E([0, 0, 0.2 + bob], [0.18, 0.15, 0.07], "metal", { k2: 0.03 }),
      S([-0.03, 0, 0.24 + bob], 0.1, "metal", { k2: 0.03 }),
      S([0.16, 0, 0.21 + bob], 0.045, "eyeRed"),
    ];
    for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
      const lp = ph + i * 2.1 + (sd > 0 ? 0 : Math.PI), sw = Math.sin(lp) * 0.06, lift = Math.max(0, Math.cos(lp)) * 0.04, hx = -0.1 + i * 0.1;
      const hip = [hx, sd * 0.12, 0.2 + bob], knee = [hx + sw * 0.6, sd * 0.25, 0.31], foot = [hx + sw, sd * 0.33, 0.015 + lift];
      p.push(C(hip, knee, 0.024, 0.02, "metalDark"), C(knee, foot, 0.02, 0.012, "metalDark"));
    }
    return { prims: p, r: 0.45, h: 0.42, k: 1.8, detail: (x, y, z, m, nx, ny, nz) => (m === "metal" ? mossTop(11, 0.45)(x, y, z, m, nx, ny, nz) : m) };
  };

  M.drone = (o = {}) => {
    const t = o.t ?? 0, z0 = 0.6 + Math.sin(t * TAU) * 0.04, L = o.light || "eyeRed", p = [
      S([0, 0, z0], 0.1, o.body || "metal", { k2: 0.02 }), E([0, 0, z0 - 0.05], [0.08, 0.08, 0.05], "metalDark"),
      S([0.07, 0.07, z0], 0.035, L), S([0, 0, z0 - 0.1], 0.02, L),
    ];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      p.push(C([0, 0, z0], [dx * 0.22, dy * 0.22, z0 + 0.02], 0.018, 0.018, "metalDark"), E([dx * 0.22, dy * 0.22, z0 + 0.05], [0.085, 0.085, 0.008], "metalDark"), S([dx * 0.22, dy * 0.22, z0 + 0.04], 0.022, o.body || "metal"));
    }
    return { prims: p, r: 0.35, h: 0.75, k: 1.7 };
  };

  M.golem = (o = {}) => {
    const p = [
      E([0, 0, 0.45], [0.28, 0.24, 0.32], "metal", { k2: 0.08 }),
      S([0.07, 0.07, 0.86], 0.17, "metal", { k2: 0.05 }),
      S([0.17, 0.12, 0.88], 0.04, "cyan"), S([0.12, 0.17, 0.88], 0.04, "cyan"),
    ];
    for (const sd of [-1, 1]) {
      const side = mul(VR, sd);
      p.push(C(add(mul(side, 0.27), [0, 0, 0.62]), add(mul(side, 0.33), [0.18, 0.18, 0.06]), 0.075, 0.06, "metal", { k2: 0.03 }));
      p.push(S(add(mul(side, 0.33), [0.2, 0.2, 0.05]), 0.08, "metal"));
      p.push(E(add(mul(side, 0.14), [0.2, 0.2, 0.09]), [0.2, 0.2, 0.09], "metal", { k2: 0.04 }));
    }
    return {
      prims: p, r: 0.6, h: 1.1, k: 1.8, occ: [{ x: 0, y: 0, z: 0.5, r: 0.3 }, { x: 0.07, y: 0.07, z: 0.86, r: 0.17 }],
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m !== "metal") return m;
        if (nz > 0.1 && P.noise(x * 7, y * 7, z * 7, 4) > 0.42) return P.noise(x * 23, y * 23, z * 23, 5) > 0.78 ? "bloom" : "moss";
        return Math.abs(((z * 9) % 1) - 0.5) > 0.45 ? "metalDark" : m;
      },
    };
  };

  M.dish = (o = {}) => ({
    prims: [
      B([0, 0, 0.04], [0.12, 0.12, 0.04], 0.02, "metalDark"), Y([0, 0, 0.32], 0.035, 0.3, "metal"),
      E([0.03, 0.03, 0.66], [0.22, 0.22, 0.035], "metal", { R: P.rotMul(P.rot("z", -Math.PI / 4), P.rot("y", 0.7)) }),
      C([0.03, 0.03, 0.66], [0.14, 0.14, 0.8], 0.012, 0.012, "metalDark"), S([0.14, 0.14, 0.8], 0.025, "cyan"),
    ],
    r: 0.35, h: 0.9, occ: [{ x: 0.03, y: 0.03, z: 0.66, r: 0.2 }], detail: mossTop(9, 0.55),
  });

  M.pod = (o = {}) => ({
    prims: [S([0, 0, -0.06], 0.44, "metal", { k2: 0.02 }), Y([0, 0, 0.36], 0.05, 0.04, "metalDark")],
    r: 0.5, h: 0.42, occ: [{ x: 0, y: 0, z: 0.1, r: 0.36 }],
    detail: (x, y, z, m, nx, ny, nz) => {
      if (m !== "metal") return m;
      if (Math.abs(z - 0.17) < 0.035 && Math.sin(Math.atan2(y, x) * 8) > -0.2) return "cyan";
      if (Math.abs(z - 0.17) < 0.05) return "metalDark";
      return mossTop(8, 0.6)(x, y, z, m, nx, ny, nz);
    },
  });

  M.pipe = (o = {}) => ({
    prims: [C([-0.42, 0, 0.09], [0.42, 0, 0.09], 0.08, 0.08, "metal"), Y([-0.25, 0, 0.09], 0.1, 0.02, "metalDark", { R: P.rot("y", Math.PI / 2) }), Y([0.25, 0, 0.09], 0.1, 0.02, "metalDark", { R: P.rot("y", Math.PI / 2) })],
    r: 0.5, h: 0.2, detail: mossTop(9, 0.4),
  });

  // ================================================================ horror: Hollow Moon
  M.deadTree = (o = {}) => {
    const r = P.rng(o.seed || 21), H = o.H ?? 1.9, p = [], occ = [];
    const top = [(r() - 0.5) * 0.15, (r() - 0.5) * 0.15, H * 0.55];
    p.push(C([0, 0, -0.1], top, 0.13, 0.07, "deadBark", { k2: 0.04 }));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + r(); p.push(C([0, 0, 0.12], [Math.cos(a) * 0.32, Math.sin(a) * 0.32, -0.03], 0.06, 0.02, "deadBark", { k2: 0.06 })); }
    const br = (a, dir, L, rad, depth) => {
      const b = add(a, mul(dir, L)); p.push(C(a, b, rad, rad * 0.6, "deadBark")); if (depth === 1) occ.push({ x: b[0], y: b[1], z: b[2], r: 0.12 });
      if (!depth) return;
      for (let k = 0; k < 2; k++) {
        const az = Math.atan2(dir[1], dir[0]) + (k ? 1 : -1) * (0.5 + r() * 0.6), el = 0.35 + r() * 0.6;
        br(b, [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)], L * 0.68, rad * 0.6, depth - 1);
      }
    };
    for (let i = 0; i < 3; i++) { const az = (i / 3) * TAU + r(), el = 0.55 + r() * 0.4; br(top, [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)], H * 0.32, 0.06, 2); }
    return { prims: p, r: 0.8, h: H + 0.3, occ, detail: (x, y, z, m, nx, ny, nz) => (z < 0.5 && nz > 0.2 && P.noise(x * 8, y * 8, z * 8, 2) > 0.6 ? "moss" : m) };
  };

  M.grave = (o = {}) => ({
    prims: [
      B([0, 0, 0.03], [0.1, 0.16, 0.03], 0.01, "stone"),
      B([0, 0, 0.22], [0.045, 0.12, 0.19], 0.03, "stone", { R: P.rot("x", o.tilt ?? 0.08) }),
      C([0.12, 0.1, 0.0], [0.12, 0.1, 0.07], 0.018, 0.018, "paper"), S([0.12, 0.1, 0.095], 0.018, "candle"),
    ],
    r: 0.25, h: 0.48, detail: (x, y, z, m, nx, ny, nz) => (m === "stone" && (nz > 0.5 || z < 0.12) && P.noise(x * 11, y * 11, z * 11, 6) > 0.5 ? "moss" : m),
  });

  M.jizo = (o = {}) => {
    const t = o.t ?? 0, hc = [0, 0, 0.41], p = [
      B([0, 0, 0.04], [0.14, 0.14, 0.04], 0.02, "stone"),
      E([0, 0, 0.22], [0.11, 0.1, 0.16], "stone", { k2: 0.04 }),
      S(hc, 0.095, "stone", { k2: 0.03 }),
      E(add(hc, [-0.01, -0.01, 0.05]), [0.088, 0.088, 0.06], "bib"),
      E([0.03, 0.03, 0.3], [0.1, 0.1, 0.065], "bib", { k2: 0.01 }),
      S([0.08, 0.08, 0.22], 0.035, "stone"),
      C([0.17, 0.12, 0.0], [0.17, 0.12, 0.08], 0.018, 0.018, "paper"), S([0.17, 0.12, 0.105], 0.02, "candle"),
    ];
    if (o.wisps !== false) p.push(...orbit(t, 2, 0.27, 0.45, 0.03, "onibi", 0.08));
    return {
      prims: p, r: 0.3, h: 0.62, k: o.k ?? 1.9,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "stone" && near(x, y, z, hc, 0.105)) return cface(sub([x, y, z], hc), 0.095, { ex: 0.32, ey: -0.05, er: 0.16, squint: 3, hi: false }) || m;
        return m === "stone" && nz > 0.4 && P.noise(x * 12, y * 12, z * 12, 6) > 0.62 ? "moss" : m;
      },
    };
  };

  M.hokora = (o = {}) => {
    const t = o.t ?? 0, p = [
      B([0, 0, 0.05], [0.17, 0.17, 0.05], 0.02, "stone"),
      B([0, 0, 0.21], [0.12, 0.12, 0.11], 0.01, "darkWood"),
      B([0, -0.08, 0.39], [0.17, 0.12, 0.015], 0.005, "roofDark", { R: P.rot("x", 0.55) }),
      B([0, 0.08, 0.39], [0.17, 0.12, 0.015], 0.005, "roofDark", { R: P.rot("x", -0.55) }),
      C([-0.18, 0, 0.45], [0.18, 0, 0.45], 0.02, 0.02, "roofDark"),
      B([0.122, 0, 0.18], [0.004, 0.035, 0.05], 0, "candle"),
      B([0.124, -0.075, 0.22], [0.004, 0.022, 0.07], 0, "paper"), B([0.124, 0.075, 0.22], [0.004, 0.022, 0.07], 0, "paper"),
      B([-0.06, 0.124, 0.22], [0.022, 0.004, 0.07], 0, "paper"), B([0.06, 0.124, 0.22], [0.022, 0.004, 0.07], 0, "paper"),
      C([0.16, -0.2, 0.32], [0.16, 0.2, 0.32], 0.008, 0.008, "straw"),
    ];
    if (o.wisps !== false) p.push(...orbit(t, 3, 0.3, 0.42, 0.028, "onibi", 0.07));
    return { prims: p, r: 0.34, h: 0.55, k: 1.9, detail: (x, y, z, m, nx, ny, nz) => (m === "paper" && Math.abs(((z * 30) % 1) - 0.5) < 0.12 ? "bib" : m === "stone" ? mossTop(11, 0.5)(x, y, z, m, nx, ny, nz) : m) };
  };

  M.chochin = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, hop = Math.abs(Math.sin(ph)) * 0.08, hc = [0, 0, 0.3 + hop], p = [
      E(hc, [0.15, 0.15, 0.2], "paperOld", { k2: 0.02 }),
      Y(add(hc, [0, 0, -0.2]), 0.08, 0.022, "ink", { round: 0.01 }), Y(add(hc, [0, 0, 0.2]), 0.08, 0.022, "ink", { round: 0.01 }),
      C(add(hc, [0.08, 0.08, -0.09]), add(hc, [0.16, 0.16, -0.2 + Math.sin(ph * 2) * 0.03]), 0.035, 0.028, "tongue"),
    ];
    return {
      prims: p, r: 0.3, h: 0.7, k: 1.8,
      detail: (x, y, z, m) => {
        if (m !== "paperOld") return m;
        const f = cface(sub([x, y, z], hc), 0.16, { one: true, ey: 0.28, er: 0.34, pupil: 0.45, mouth: [0, -0.38, 0.5], mouthSq: 2.2 });
        if (f) return f;
        if (P.noise(x * 14, y * 14, z * 14, 9) > 0.7) return "paperTorn";
        return ((((z - hc[2]) * 7) % 1) + 1) % 1 < 0.2 ? "paperRib" : m;
      },
    };
  };

  M.wraith = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, fl = 0.12 + Math.sin(ph) * 0.04, hc = [0.02, 0.02, 0.74 + fl], p = [
      C([0, 0, 0.1 + fl], [0, 0, 0.6 + fl], 0.17, 0.07, "ghost", { k2: 0.04 }),
      S(hc, 0.085, "ghost"),
      E(add(hc, [-0.02, -0.02, 0.02]), [0.1, 0.1, 0.11], "hair"),
      S([0.085, 0.07, 0.72 + fl], 0.016, "eyeRed"),
    ];
    for (let i = 0; i < 6; i++) { const a = -0.6 + i * 0.5, dir = [Math.cos(a + 0.785), Math.sin(a + 0.785), 0]; p.push(C(add(hc, mul(dir, 0.07)), add(add(hc, mul(dir, 0.1 + (i % 2) * 0.02)), [0, 0, -0.3 - (i % 3) * 0.06]), 0.03, 0.012, "hair")); }
    for (const sd of [-1, 1]) { const side = mul(VR, sd); p.push(C(add(mul(side, 0.12), [0, 0, 0.55 + fl]), add(mul(side, 0.14), [0.16, 0.16, 0.42 + fl + Math.sin(ph + sd) * 0.02]), 0.032, 0.02, "ghost")); }
    return { prims: p, r: 0.32, h: 1.0, k: 1.6, detail: (x, y, z, m) => (m === "ghost" && z < 0.18 + fl && Math.sin(Math.atan2(y, x) * 9 + ph) > 0.2 ? "ghostDark" : m) };
  };

  // ================================================================ fantasy: Crystal Keep
  M.spire = (o = {}) => {
    const t = o.t ?? 0, bob = Math.sin(t * TAU) * 0.03, p = [
      Y([0, 0, 0.26], 0.13, 0.26, "castle", { round: 0.01 }),
      Y([0, 0, 0.53], 0.155, 0.025, "castle", { round: 0.01 }),
      E([0, 0, 0.57], [0.19, 0.19, 0.03], "roofBlue"), C([0, 0, 0.58], [0, 0, 0.9], 0.11, 0.006, "roofBlue"),
      B([0.093, 0.093, 0.34], [0.012, 0.03, 0.05], 0, "arcane", { R: P.rot("z", Math.PI / 4) }),
      E([0, 0, 1.02 + bob], [0.045, 0.045, 0.09], "crystalEm"),
      ...orbit(t, 2, 0.12, 1.0 + bob, 0.016, "arcane", 0.04),
    ];
    return { prims: p, r: 0.3, h: 1.15, k: 1.6, occ: [{ x: 0, y: 0, z: 0.4, r: 0.13 }], detail: (x, y, z, m, nx, ny, nz) => (m === "castle" && z < 0.18 && P.noise(x * 10, y * 10, z * 10, 4) > 0.5 ? "moss" : m === "castle" && Math.abs(((z * 12) % 1) - 0.5) > 0.44 ? "castleDark" : m) };
  };

  M.ballista = (o = {}) => {
    const t = o.t ?? 0, a = 0.5 + Math.sin(t * TAU) * 0.15, d = [Math.cos(a), Math.sin(a), 0], s = [-Math.sin(a), Math.cos(a), 0], c = [0, 0, 0.28];
    const pull = 0.05 + Math.max(0, Math.sin(t * TAU)) * 0.06, p = [
      Y([0, 0, 0.06], 0.15, 0.06, o.base || "wood", { round: 0.02 }), C([0, 0, 0.1], [0, 0, 0.26], 0.04, 0.04, "wood"),
      C(sub(c, mul(d, 0.16)), add(c, mul(d, 0.22)), 0.035, 0.03, "wood"),
    ];
    for (const sd of [-1, 1]) {
      const tip = add(add(c, mul(d, 0.1)), add(mul(s, sd * 0.24), [0, 0, 0.02]));
      p.push(C(add(c, mul(d, 0.18)), tip, 0.025, 0.012, "wood"), C(tip, sub(c, mul(d, pull)), 0.006, 0.006, "straw"));
    }
    p.push(C(add(sub(c, mul(d, pull)), [0, 0, 0.035]), add(add(c, mul(d, 0.3)), [0, 0, 0.035]), 0.012, 0.012, "wood"), C(add(add(c, mul(d, 0.3)), [0, 0, 0.035]), add(add(c, mul(d, 0.38)), [0, 0, 0.035]), 0.022, 0.002, "iron"));
    return { prims: p, r: 0.38, h: 0.42, k: 1.9 };
  };

  M.slime = (o = {}) => {
    const t = o.t ?? 0, sq = Math.sin(t * TAU) * 0.035, bc = [0, 0, 0.16 - sq], p = [
      E(bc, [0.22 + sq, 0.22 + sq, 0.16 - sq * 1.2], o.mat || "slime", { k2: 0.02 }),
      S([-0.03, -0.03, 0.29 - sq * 2], 0.065, o.mat || "slime", { k2: 0.07 }),
    ];
    return {
      prims: p, r: 0.32, h: 0.42, k: 1.7,
      detail: (x, y, z, m, nx, ny, nz) => {
        const f = cface(sub([x, y, z], bc), 0.2, { ex: 0.36, ey: 0.22, er: 0.21, blush: true, mouth: [0, -0.14, 0.1] });
        if (f) return f;
        return nz > 0.7 && nx + ny < -0.25 ? "eyeHi" : m;
      },
    };
  };

  M.goblin = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.cos(ph)) * 0.02, hc = [0.03, 0.02, 0.52 + bob], swing = Math.sin(ph) * 0.5, p = [];
    for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + (sd > 0 ? 0 : Math.PI)) * 0.07, lift = Math.max(0, Math.cos(ph + (sd > 0 ? 0 : Math.PI))) * 0.04;
      p.push(C([0, sd * 0.05, 0.25 + bob], [sw, sd * 0.06, 0.04 + lift], 0.032, 0.028, "skinG"), E([sw + 0.02, sd * 0.06, 0.03 + lift], [0.05, 0.03, 0.025], "leather"));
      const side = mul(VR, sd);
      p.push(C(add(hc, mul(side, 0.08)), add(add(hc, mul(side, 0.24)), [-0.03, -0.03, 0.06]), 0.035, 0.006, "skinG"));
    }
    const hand = [0.12, -0.15, 0.32 + bob], club = add(hand, [0.06 + Math.sin(swing) * 0.1, -0.04, 0.26 * Math.cos(swing * 0.5)]);
    p.push(
      E([0, 0, 0.33 + bob], [0.09, 0.1, 0.11], "skinG", { k2: 0.03 }),
      B([0.02, 0, 0.24 + bob], [0.09, 0.11, 0.05], 0.02, "leather"),
      S(hc, 0.12, "skinG", { k2: 0.02 }),
      S(add(hc, [0.09, 0.09, -0.02]), 0.032, "skinG"),
      C([0, -0.11, 0.42 + bob], hand, 0.028, 0.024, "skinG"), C([0, 0.11, 0.42 + bob], [0.1, 0.15, 0.3 + bob], 0.028, 0.024, "skinG"),
      C(hand, club, 0.022, 0.055, "wood"),
    );
    return {
      prims: p, r: 0.38, h: 0.85, k: 1.7,
      detail: (x, y, z, m) => (m === "skinG" && near(x, y, z, hc, 0.135) ? cface(sub([x, y, z], hc), 0.12, { ex: 0.4, ey: 0.15, er: 0.26, eye: "eye", angry: true, mouth: [0, -0.48, 0.18], mouthSq: 2.5 }) || m : m),
    };
  };

  M.crystals = (o = {}) => {
    const r = P.rng(o.seed || 31), p = [], sz = o.sz ?? 1;
    for (let i = 0; i < 6; i++) {
      const a = r() * TAU, el = 1.0 + r() * 0.45, L = (0.22 + r() * 0.35) * sz, b = [Math.cos(a) * 0.08 * sz, Math.sin(a) * 0.08 * sz, 0];
      const tip = add(b, [Math.cos(a) * Math.cos(el) * L, Math.sin(a) * Math.cos(el) * L, Math.sin(el) * L]);
      p.push(C(b, tip, (0.05 + r() * 0.03) * sz, 0.004, "crystal"));
      if (i < 3) p.push(S(tip, 0.018, "arcane"));
    }
    return { prims: p, r: 0.35 * sz, h: 0.65 * sz, occ: [{ x: 0, y: 0, z: 0.2 * sz, r: 0.12 * sz }] };
  };

  M.banner = (o = {}) => ({
    prims: [C([0, 0, 0], [0, 0, 1.0], 0.02, 0.015, "wood"), S([0, 0, 1.02], 0.03, "gold"), C([0, -0.02, 0.95], [0, 0.24, 0.95], 0.01, 0.01, "wood"), B([0, 0.12, 0.78], [0.008, 0.11, 0.16], 0.004, o.mat || "banner")],
    r: 0.25, h: 1.05,
    detail: (x, y, z, m) => (m === (o.mat || "banner") && (Math.abs(y - 0.12) > 0.085 || z < 0.65 || (y - 0.12) ** 2 + (z - 0.8) ** 2 < 0.045 ** 2) ? "gold" : m),
  });

  M.arch = (o = {}) => {
    const p = [B([0, -0.3, 0.33], [0.08, 0.08, 0.33], 0.01, "castle"), B([0, 0.3, o.broken ? 0.18 : 0.33], [0.08, 0.08, o.broken ? 0.18 : 0.33], 0.01, "castle")];
    if (!o.broken) p.push(B([0, 0, 0.72], [0.1, 0.42, 0.06], 0.01, "castle"), B([0.1, 0, 0.72], [0.012, 0.05, 0.05], 0.01, "gold"));
    return {
      prims: p, r: 0.5, h: 0.85, occ: [{ x: 0, y: -0.3, z: 0.4, r: 0.1 }, { x: 0, y: 0.3, z: 0.3, r: 0.1 }],
      detail: (x, y, z, m, nx, ny, nz) => (m === "castle" && (nz > 0.5 || P.noise(x * 9, y * 9, z * 6, 4) > 0.62) ? "moss" : m === "castle" && Math.abs(((z * 8) % 1) - 0.5) > 0.44 ? "castleDark" : m),
    };
  };

  // ================================================================ cyberpunk: Neon Moss
  M.vending = (o = {}) => ({
    prims: [B([0, 0, 0.3], [0.12, 0.16, 0.3], 0.015, "vendBody")],
    r: 0.25, h: 0.62,
    detail: (x, y, z, m) => {
      if (x > 0.11) {
        if (z > 0.3 && z < 0.56 && Math.abs(y) < 0.13) { const gy = Math.floor((y + 0.13) * 30), gz = Math.floor(z * 30); return (gy + gz) % 3 === 0 ? (o.neon || "neonCyan") : (gy * 7 + gz * 3) % 5 === 0 ? "neonPink" : "vendGlass"; }
        if (z < 0.12 && Math.abs(y) < 0.08) return "metalDark";
      }
      if (y > 0.15 && Math.abs(z - 0.45) < 0.03) return o.neon || "neonCyan";
      return m;
    },
  });

  M.sign = (o = {}) => {
    const N = o.neon || "neonPink", N2 = o.neon2 || "neonCyan";
    return {
      prims: [C([0, 0, 0], [0, 0, 0.5], 0.02, 0.02, "metalDark"), B([0, 0, 0.78], [0.05, 0.12, 0.3], 0.01, "metalDark")],
      r: 0.2, h: 1.1, occ: [{ x: 0, y: 0, z: 0.78, r: 0.1 }],
      detail: (x, y, z, m) => {
        if (z < 0.47) return m;
        const onFace = Math.abs(x) > 0.045 || Math.abs(y) > 0.115;
        if (!onFace) return m;
        const u = Math.abs(x) > 0.045 ? y : x;
        if (Math.abs(u) > (Math.abs(x) > 0.045 ? 0.1 : 0.035) || Math.abs(z - 0.78) > 0.27) return N;
        const gu = Math.floor((u + 0.12) * 40), gz = Math.floor(z * 40);
        return P.hash(gu, gz, Math.floor(z * 6), 4) > 0.55 ? N2 : m;
      },
    };
  };

  M.acUnit = (o = {}) => ({
    prims: [B([0, 0, 0.12], [0.14, 0.1, 0.12], 0.01, "metal")],
    r: 0.22, h: 0.26,
    detail: (x, y, z, m, nx, ny, nz) => { if (x > 0.13) { const d = Math.hypot(y, z - 0.12); return d < 0.08 && Math.abs(((d * 60) % 1) - 0.5) > 0.3 ? "metalDark" : m; } return nz > 0.5 && P.noise(x * 20, y * 20, 0, 3) > 0.6 ? "rust" : m; },
  });

  M.tank = (o = {}) => {
    const p = [Y([0, 0, 0.55], 0.16, 0.18, "metal", { round: 0.02 }), C([0, 0, 0.73], [0, 0, 0.83], 0.17, 0.01, "metal")];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(C([dx * 0.12, dy * 0.12, 0.38], [dx * 0.14, dy * 0.14, 0], 0.016, 0.016, "metalDark"));
    return { prims: p, r: 0.25, h: 0.85, occ: [{ x: 0, y: 0, z: 0.55, r: 0.16 }], detail: (x, y, z, m) => (m === "metal" && P.noise(x * 12, y * 12, z * 12, 5) > 0.62 ? "rust" : m) };
  };

  M.neonTurret = (o = {}) => {
    const t = o.t ?? 0, a = 0.785 + Math.sin(t * TAU) * 0.35, d = [Math.cos(a), Math.sin(a), 0], s = [-Math.sin(a), Math.cos(a), 0], hc = [0, 0, 0.27], flash = t < 0.13;
    const p = [B([0, 0, 0.08], [0.15, 0.15, 0.08], 0.02, "metalDark"), B(hc, [0.11, 0.1, 0.07], 0.03, "metal", { R: P.rot("z", a) }), S(add(hc, mul(d, 0.12)), 0.03, "neonPink")];
    for (const sd of [-1, 1]) p.push(C(add(add(hc, mul(s, sd * 0.045)), [0, 0, 0.02]), add(add(hc, add(mul(s, sd * 0.045), mul(d, 0.3))), [0, 0, 0.02]), 0.022, 0.02, "metalDark"));
    if (flash) p.push(S(add(hc, add(mul(d, 0.36), [0, 0, 0.02])), 0.05, "neonPink"));
    return { prims: p, r: 0.34, h: 0.42, k: 1.9, detail: (x, y, z, m) => (m === "metalDark" && z < 0.16 && z > 0.1 && Math.floor((x + y) * 18) % 2 === 0 ? "neonAmber" : m) };
  };

  M.jammer = (o = {}) => {
    const t = o.t ?? 0, rr = 0.12 + t * 0.22, p = [
      B([0, 0, 0.05], [0.13, 0.13, 0.05], 0.02, "metalDark"), Y([0, 0, 0.36], 0.035, 0.32, "metal"),
      E([0, 0, 0.72], [0.15, 0.15, 0.035], "metal", { R: P.rot("y", 0.35) }), S([0, 0, 0.8], 0.03, "neonCyan"),
    ];
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; p.push(S([Math.cos(a) * rr, Math.sin(a) * rr, 0.74], 0.016 * (1.2 - t), "neonCyan")); }
    return { prims: p, r: 0.38, h: 0.9, k: 1.7 };
  };

  M.hound = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.sin(ph)) * 0.02, p = [
      B([0, 0, 0.3 + bob], [0.17, 0.075, 0.06], 0.04, "metal", { k2: 0.02 }),
      B([0.24, 0, 0.37 + bob], [0.07, 0.055, 0.05], 0.03, "metal", { k2: 0.02 }),
      B([0.305, 0, 0.375 + bob], [0.012, 0.05, 0.011], 0, "eyeRed"),
      C([0.2, 0.04, 0.42 + bob], [0.17, 0.05, 0.52 + bob], 0.012, 0.008, "metalDark"), C([0.2, -0.04, 0.42 + bob], [0.17, -0.05, 0.52 + bob], 0.012, 0.008, "metalDark"),
      C([-0.18, 0, 0.32 + bob], [-0.3, 0, 0.45 + bob], 0.014, 0.008, "metalDark"), S([-0.3, 0, 0.45 + bob], 0.018, "neonPink"),
    ];
    for (const fr of [1, -1]) for (const sd of [-1, 1]) {
      const lp = ph + (fr * sd > 0 ? 0 : Math.PI), sw = Math.sin(lp) * 0.07, lift = Math.max(0, Math.cos(lp)) * 0.04;
      const hip = [fr * 0.12, sd * 0.07, 0.27 + bob], knee = [fr * 0.12 + sw * 0.5 - fr * 0.03, sd * 0.08, 0.15], foot = [fr * 0.12 + sw, sd * 0.08, 0.02 + lift];
      p.push(C(hip, knee, 0.024, 0.02, "metalDark"), C(knee, foot, 0.02, 0.016, "metalDark"));
    }
    return { prims: p, r: 0.42, h: 0.6, k: 1.8, detail: (x, y, z, m) => (m === "metal" && Math.abs(y) < 0.012 && z > 0.33 ? "neonPink" : m) };
  };

  // ================================================================ desert: Wind Valley
  M.windmill = (o = {}) => {
    const t = o.t ?? 0, hub = [0.08, 0.08, 0.66], n = [0.707, 0.707, 0], p = [
      Y([0, 0, 0.1], 0.13, 0.1, "sandstone", { round: 0.02 }),
      C([0, 0, 0.18], [0, 0, 0.64], 0.085, 0.05, "wood"),
      S([0, 0, 0.66], 0.07, "wood"), S(hub, 0.035, "iron"),
    ];
    for (let k = 0; k < 4; k++) {
      const th = (k / 4) * TAU + (t * TAU) / 4, d = add(mul(VR, Math.cos(th)), mul(UP, Math.sin(th)));
      p.push(C(hub, add(hub, mul(d, 0.36)), 0.008, 0.008, "wood"), B(add(add(hub, mul(d, 0.21)), mul(n, 0.012)), [0.15, 0.045, 0.005], 0.004, "sail", { R: frame(d, n) }));
    }
    return { prims: p, r: 0.42, h: 1.05, k: 1.6, occ: [{ x: 0, y: 0, z: 0.4, r: 0.08 }] };
  };

  M.sandworm = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, p = [], N = 7;
    let head;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), pt = [-0.38 + s * 0.58, Math.sin(s * 3 + ph) * 0.04, -0.04 + Math.sin(s * Math.PI * 0.85) * 0.5 + Math.sin(ph + s * 4) * 0.03];
      p.push(S(pt, 0.075 + s * 0.06, i & 1 ? "wormDark" : "wormHide", { k2: 0.04 })); head = pt;
    }
    const mouth = add(head, [0.09, 0.07, 0.02]);
    p.push(S(mouth, 0.07, "void"));
    for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU, off = add(mul(VR, Math.cos(a) * 0.08), mul(VU, Math.sin(a) * 0.08)); p.push(C(add(mouth, add(off, [0.02, 0.02, 0])), add(mouth, add(mul(off, 0.4), [0.06, 0.06, 0])), 0.016, 0.003, "tusk")); }
    p.push(E([-0.38, 0, 0.0], [0.2, 0.2, 0.04], "sand", { k2: 0.05 }), E([0.28, 0.0, 0.0], [0.1, 0.1, 0.02], "sand"));
    return { prims: p, r: 0.5, h: 0.75, k: 1.7 };
  };

  M.beetle = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, bob = Math.abs(Math.sin(ph)) * 0.015, p = [
      E([0, 0, 0.19 + bob], [0.24, 0.18, 0.13], "beetleShell", { k2: 0.02 }),
      E([0.23, 0, 0.13 + bob], [0.08, 0.1, 0.07], "beetleDark", { k2: 0.02 }),
      C([0.28, 0, 0.15 + bob], [0.38, 0, 0.24 + bob], 0.045, 0.03, "beetleDark", { k2: 0.02 }), C([0.38, 0, 0.24 + bob], [0.4, 0, 0.36 + bob], 0.03, 0.006, "beetleDark"),
      S([0.27, 0.07, 0.15 + bob], 0.022, "eye"), S([0.27, -0.07, 0.15 + bob], 0.022, "eye"),
    ];
    for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) { const lp = ph + k * 2.1 + (sd > 0 ? 0 : Math.PI); p.push(C([-0.12 + k * 0.12, sd * 0.14, 0.1], [-0.12 + k * 0.12 + Math.sin(lp) * 0.05, sd * 0.24, 0.01 + Math.max(0, Math.cos(lp)) * 0.03], 0.022, 0.014, "beetleDark")); }
    return { prims: p, r: 0.5, h: 0.5, k: 1.7, detail: (x, y, z, m) => (m === "beetleShell" && Math.abs(y) < 0.012 && x < 0.15 ? "beetleDark" : m) };
  };

  M.ribcage = (o = {}) => {
    const p = [C([-0.45, 0, 0.06], [0.45, 0, 0.12], 0.04, 0.035, "bone")];
    for (let i = 0; i < 5; i++) {
      const x = -0.32 + i * 0.16, k = 1 - Math.abs(i - 1.5) * 0.18;
      for (const sd of [-1, 1]) {
        const pts = [[x, sd * 0.05, 0.1], [x + 0.03, sd * 0.3 * k, 0.3 * k], [x + 0.05, sd * 0.33 * k, 0.6 * k], [x + 0.04, sd * 0.2 * k, 0.8 * k]];
        for (let j = 0; j < 3; j++) p.push(C(pts[j], pts[j + 1], 0.032 - j * 0.006, 0.026 - j * 0.006, "bone"));
      }
    }
    return { prims: p, r: 0.6, h: 0.85, detail: (x, y, z, m) => (z < 0.12 && P.noise(x * 9, y * 9, 0, 3) > 0.55 ? "sand" : m) };
  };

  M.acacia = (o = {}) => {
    const r = P.rng(o.seed || 41), p = [], top = [0.05, 0.03, 0.62];
    p.push(C([0, 0, -0.05], top, 0.07, 0.04, "bark"));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + r(); p.push(C(top, add(top, [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.16]), 0.035, 0.02, "bark")); }
    p.push(E(add(top, [0, 0, 0.18]), [0.46, 0.42, 0.08], "leafDry", { k2: 0.05 }));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + r(), d = 0.22 + r() * 0.16; p.push(S(add(top, [Math.cos(a) * d, Math.sin(a) * d, 0.2 + r() * 0.04]), 0.11 + r() * 0.04, "leafDry", { k2: 0.05 })); }
    return { prims: p, r: 0.75, h: 1.0, occ: [{ x: top[0], y: top[1], z: top[2] + 0.18, r: 0.45 }] };
  };

  M.tent = (o = {}) => ({
    prims: [C([0, 0, 0], [0, 0, 0.5], 0.3, 0.012, "cloth2"), C([0, 0, 0.45], [0, 0, 0.62], 0.012, 0.01, "wood")],
    r: 0.35, h: 0.65,
    detail: (x, y, z, m) => {
      if (m !== "cloth2") return m;
      const a = Math.atan2(y, x);
      if (Math.abs(a - 0.785) < 0.22 && z < 0.24) return "void";
      return Math.sin(a * 6) > 0.55 ? "sash" : m;
    },
  });

  M.sandRock = (o = {}) => {
    const sz = o.sz ?? 1;
    return {
      prims: [E([0, 0, 0.14 * sz], [0.32 * sz, 0.26 * sz, 0.24 * sz], "sandstone", { disp: 0.06 * sz, df: 5 / sz }), S([0.12 * sz, -0.08 * sz, 0.3 * sz], 0.15 * sz, "sandstone", { k2: 0.06, disp: 0.05 * sz, df: 6 / sz })],
      r: 0.42 * sz, h: 0.5 * sz, occ: [{ x: 0, y: 0, z: 0.15 * sz, r: 0.24 * sz }],
      detail: (x, y, z, m) => (Math.abs(((z / sz) * 10 % 1) - 0.5) > 0.4 ? "earth" : m),
    };
  };

  M.themeRosters = {
    scifi: [["Arc Pylon", "pylon", {}], ["Beam Turret", "beamTurret", {}], ["Crawler", "crawler", {}], ["Scout Drone", "drone", {}]],
    horror: [["Ofuda Shrine", "hokora", {}], ["Jizo Ward", "jizo", {}], ["Chochin Ghost", "chochin", {}], ["Wraith", "wraith", {}]],
    fantasy: [["Mage Spire", "spire", {}], ["Ballista", "ballista", {}], ["Slime", "slime", {}], ["Goblin", "goblin", {}]],
    cyber: [["Neon Turret", "neonTurret", {}], ["Jammer", "jammer", {}], ["Mech Hound", "hound", {}], ["Kite Drone", "drone", { light: "neonPink" }]],
    desert: [["Windmill", "windmill", {}], ["Wind Ballista", "ballista", { base: "sandstone" }], ["Sand Worm", "sandworm", {}], ["Horn Beetle", "beetle", {}]],
  };
})();
