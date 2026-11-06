/* Third model set: moss-garden props for the bell-jar terrariums. Same conventions as models.js. */
(function () {
  const P = window.PX, { S, E, C, B, Y } = P.prim, TAU = Math.PI * 2;
  const M = window.MODELS;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  // Soft moss hummock: a few low overlapping half-buried ellipsoids, patched with a second moss.
  // Uses the "mound" materials so a style can tone it down to sit in the moss carpet.
  M.mound = (o = {}) => {
    const r = P.rng(o.seed || 21), sz = o.sz ?? 1, m1 = o.mat || "mound", m2 = o.mat2 || "mound2", p = [E([0, 0, -0.06 * sz], [0.52 * sz, 0.48 * sz, 0.2 * sz], m1, { k2: 0.14, disp: 0.014 * sz, df: 22 })];
    for (let i = 0; i < (o.n ?? 3); i++) {
      const a = r() * TAU, d = (0.14 + r() * 0.2) * sz;
      p.push(E([Math.cos(a) * d, Math.sin(a) * d, 0], [(0.26 + r() * 0.12) * sz, (0.24 + r() * 0.1) * sz, (0.1 + r() * 0.08) * sz], m1, { k2: 0.16, disp: 0.014 * sz, df: 22 }));
    }
    return { prims: p, r: 0.64 * sz, h: 0.22 * sz, detail: (x, y, z, m) => (P.fbm(x * 1.8, y * 1.8, z * 1.8, (o.seed || 5) + 3) > 0.64 ? m2 : m) };
  };

  // Niwaki: a garden tree shaped into cloud pads, like the pine but larger and tunable. A leaning,
  // tapering trunk with flared roots; branches carry flattened leaf pads in rising tiers.
  // o: H, girth, spread, padR, n (pads), flat (pad thickness), mat, bumps, droop
  M.niwaki = (o = {}) => {
    const r = P.rng(o.seed || 9), H = o.H ?? 2.4, g = o.girth ?? 1, mat = o.mat || "leaf", p = [], occ = [];
    const lean = [(r() - 0.5) * 0.22, (r() - 0.5) * 0.22], at = (u) => [lean[0] * u + Math.sin(u * 5 + 1) * 0.04 * g, lean[1] * u + Math.cos(u * 4) * 0.04 * g, H * 0.92 * u];
    for (let i = 0; i < 4; i++) p.push(C(at(i / 4), at((i + 1) / 4), (0.16 - i * 0.03) * g, (0.13 - i * 0.03) * g, "bark", { k2: 0.05 }));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + r() * 0.8; p.push(C([0, 0, 0.22 * g], [Math.cos(a) * 0.36 * g, Math.sin(a) * 0.36 * g, -0.04], 0.07 * g, 0.03, "bark", { k2: 0.08 })); }
    const n = o.n ?? 6, flat = o.flat ?? 0.34, padR = o.padR ?? 0.42, spread = o.spread ?? 0.7;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 1 : i / (n - 1), top = i === n - 1, a = i * 2.4 + r() * 0.6, d = top ? 0 : spread * (1 - 0.55 * u) * (0.8 + 0.4 * r());
      const z = H * (0.42 + 0.56 * u), base = at(Math.min(1, (z - 0.2) / (H * 0.92))), R = padR * (1 - 0.4 * u) * (top ? 0.95 : 0.85 + 0.3 * r());
      const c = add(base, [Math.cos(a) * d, Math.sin(a) * d, top ? 0.1 : 0.12 + (o.droop ?? 0) * -0.1]);
      if (!top) p.push(C(base, c, 0.05 * g, 0.03 * g, "bark", { k2: 0.04 }));
      p.push(E(c, [R, R * 0.92, R * flat], mat, { k2: 0.06 }));
      const nb = o.bumps ?? 6;
      for (let k = 0; k < nb; k++) { const b = (k / nb) * TAU + r(); p.push(S(add(c, [Math.cos(b) * R * 0.6, Math.sin(b) * R * 0.6, R * flat * 0.45]), R * (0.34 + r() * 0.1), mat, { k2: 0.06 })); }
      p.push(S(add(c, [0, 0, R * flat * 0.7]), R * 0.42, mat, { k2: 0.06 }));
      occ.push({ x: c[0], y: c[1], z: c[2] + 0.04, r: R * 0.95 });
    }
    return {
      prims: p, r: spread + padR + 0.2, h: H + padR * 0.6, occ,
      detail: (x, y, z, m, nx, ny, nz) => (m === "bark" && z < H * 0.4 && P.noise(x * 7, y * 7, z * 5, 4) > 0.58 - nz * 0.3 ? "moss" : m),
    };
  };

  // Tsukubai: a low round stone basin brimming with water, with a moss collar.
  M.basin = (o = {}) => {
    const sz = o.sz ?? 1;
    return {
      prims: [E([0, 0, 0.1 * sz], [0.24 * sz, 0.24 * sz, 0.16 * sz], "stone", { disp: 0.02 * sz, df: 8 }), E([0, 0, 0.215 * sz], [0.15 * sz, 0.15 * sz, 0.035 * sz], "water")],
      r: 0.3 * sz, h: 0.28 * sz, occ: [{ x: 0, y: 0, z: 0.1 * sz, r: 0.2 * sz }],
      detail: (x, y, z, m, nx, ny, nz) => (m === "stone" && z < 0.06 * sz + P.noise(x * 20, y * 20, 0, 3) * 0.05 ? "moss" : m),
    };
  };

  // Stone stairs filling one path tile, climbing H (world units) towards dir ("-x", "+x", "-y", "+y"),
  // so a path can step up a terrace. Mossy treads and a moss skirt at the foot.
  M.stairs = (o = {}) => {
    const H = o.H ?? 1, n = o.n ?? Math.max(2, Math.round(H * 5)), w = o.w ?? 0.36, ax = o.dir[1] === "x" ? 0 : 1, sg = o.dir[0] === "-" ? -1 : 1, p = [];
    for (let k = 0; k < n; k++) {
      const s0 = -0.5 + k / n, mid = (s0 + 0.5) / 2, hl = (0.5 - s0) / 2, z = ((k + 1) / n) * H;
      const c = ax === 0 ? [sg * mid, 0, z / 2] : [0, sg * mid, z / 2], h = ax === 0 ? [hl, w, z / 2] : [w, hl, z / 2];
      p.push(B(c, h, 0.015, "stone", { disp: 0.008, df: 14 }));
    }
    return { prims: p, r: 0.72, h: H + 0.05, detail: (x, y, z, m, nx, ny, nz) => (nz > 0.5 ? (P.noise(x * 16, y * 16, z * 9, 7) > 0.66 ? "moss" : m) : z < 0.08 + P.noise(x * 9, y * 9, 0, 8) * 0.12 ? "moss" : m) };
  };

  // Taiko-bashi: a red lacquered arched bridge spanning L along x (flip for y), deck of planks,
  // posts and a top rail on both sides, small stone feet.
  M.bridge = (o = {}) => {
    const L = o.L ?? 2.4, rise = o.rise ?? 0.3, w = o.w ?? 0.3, n = Math.round(L * 9), p = [], zAt = (x) => rise * (1 - (2 * x / L) ** 2);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * L / n, sl = Math.atan(-8 * rise * x / (L * L));
      p.push(B([x, 0, zAt(x) + 0.02], [L / n * 0.46, w, 0.025], 0.006, "wood", { R: P.rot("y", -sl) }));
    }
    const posts = 6, top = [[], []];
    for (let i = 0; i <= posts; i++) for (const sd of [-1, 1]) {
      const x = -L / 2 + 0.08 + i * (L - 0.16) / posts, z = zAt(x) + 0.04;
      p.push(Y([x, sd * (w + 0.02), z + 0.09], 0.022, 0.09, "lacq", { round: 0.006 }));
      top[sd < 0 ? 0 : 1].push([x, sd * (w + 0.02), z + 0.19]);
    }
    for (const rail of top) for (let i = 0; i + 1 < rail.length; i++) p.push(C(rail[i], rail[i + 1], 0.02, 0.02, "lacq"));
    for (const sx of [-1, 1]) p.push(B([sx * (L / 2 - 0.05), 0, -0.05], [0.12, w + 0.06, 0.08], 0.03, "stone"));
    return { prims: p, r: L / 2 + 0.1, h: rise + 0.3, occ: [{ x: 0, y: 0, z: rise, r: 0.3 }] };
  };
})();
