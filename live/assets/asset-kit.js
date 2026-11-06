/* Asset kit: shared helpers, materials and parts for hand-authored voxel assets (assets/assets-mockups.js,
   assets/asset-set.js), plus the showroom that ?gallery=<name> renders: a cleaned-up jar-koke with rows of assets.
   Model conventions match the generator's: tile units, anchor at the ground centre, Z up, facing +X, chibi
   faces painted toward the viewer, animation phase o.t in [0, 1). Exposed as ME.assetKit. */
(function () {
  const ME = window.ME, P = window.PX, { S, E, C, B, Y } = P.prim, M = window.MODELS, TAU = Math.PI * 2;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const rx = (a) => P.rot("x", a), ry = (a) => P.rot("y", a), rz = (a) => P.rot("z", a);
  // world-to-local rows (A after B): local = A(B(world))
  const rmul = (A, Bm) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * Bm[j] + A[i * 3 + 1] * Bm[3 + j] + A[i * 3 + 2] * Bm[6 + j]); return o; };
  // rows for a prim whose local z runs along n and local x along d (projected)
  const orient = (n, d = [0, 0, 1]) => {
    n = norm(n);
    let x = add(d, mul(n, -dot(d, n)));
    if (Math.hypot(x[0], x[1], x[2]) < 1e-4) x = Math.abs(n[2]) < 0.9 ? add([0, 0, 1], mul(n, -n[2])) : add([1, 0, 0], mul(n, -n[0]));
    x = norm(x);
    return [...x, ...cross(n, x), ...n];
  };
  const near = (q, c, r) => (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 < r * r;
  const nz3 = (x, y, z, k, s) => P.noise(x * k, y * k, z * k, s);

  // chibi face painted toward the viewer (port of the generator's private cface in models2.js)
  const VF = [0.577, 0.577, 0.577], VR = [0.707, -0.707, 0], VU = [-0.408, -0.408, 0.816];
  function cface(q, hr, o = {}) {
    if (dot(q, VF) < 0.15 * hr) return null;
    const u = (q[0] * VR[0] + q[1] * VR[1]) / hr, v = dot(q, VU) / hr;
    const ex = o.ex ?? 0.36, ey = o.ey ?? 0.05, er = o.er ?? 0.2;
    for (const sx of [-1, 1]) {
      const du = u - sx * ex, dv = v - ey;
      if (du * du + dv * dv < er * er) {
        if (o.hi !== false && (du + er * 0.3) ** 2 + (dv - er * 0.32) ** 2 < (er * 0.42) ** 2) return o.hiM || "eyeHi";
        return o.eye || "void";
      }
      if (o.blush && (u - sx * (ex + 0.16)) ** 2 + ((v - ey + 0.3) * 1.8) ** 2 < 0.16 ** 2) return "blush";
    }
    if (o.mouth) { const [mx, my, mr] = o.mouth; if ((u - mx) ** 2 + ((v - my) * 1.5) ** 2 < mr * mr) return o.mouthM || "void"; }
    return null;
  }

  // ---------------------------------------------------------------- materials
  const EM = { em: 1, flat: 1 }, FOL = { cls: 2, wrap: 0.6 };
  const MAT = {
    // Koke Garden
    kgBark: [["#6b4a32", 6, 0.14, 0.55, 0.25]], kgLeaf: [["#4f9a3a", 8, 0.16, 0.68, 0.3], FOL], kgLeafLt: [["#8cc84a", 6, 0.3, 0.8, 0.3], FOL],
    kgRope: [["#e2cf98", 4, 0.5, 0.88, 0.2]], kgPaper: [["#f6f2e6", 3, 0.78, 0.97]], kgHeart: [["#f0604a", "#f47a56", "#f89666", "#fcb07a"], EM],
    kgStem: [["#3f7a2e", 5, 0.14, 0.55]], kgThorn: [["#e0d09a", 3, 0.5, 0.85]], kgRose: [["#e04a70", 6, 0.22, 0.75, 0.3]], kgRoseLt: [["#f490ac", 5, 0.45, 0.88, 0.25]],
    kgPetal: [["#f4c43a", 6, 0.32, 0.86, 0.3]], kgPetalDk: [["#e09a28", 5, 0.25, 0.7, 0.3]], kgBrass: [["#b8863a", 5, 0.25, 0.75, 0.3]], kgLens: [["#f4ead0", 4, 0.6, 0.9], { bias: 0.12 }],
    kgCap: [["#a77ad6", 6, 0.25, 0.76, 0.3]], kgGill: [["#d8c8a8", 4, 0.4, 0.8]], kgSpot: [["#f6eeda", 3, 0.72, 0.97]], kgStalk: [["#efe2c4", 5, 0.5, 0.92]],
    kgSpore: [["#a070e0", "#b488ec", "#c8a4f4"], EM], kgWillow: [["#78b850", 6, 0.22, 0.75, 0.3], FOL], kgWillowLt: [["#a6d468", 5, 0.35, 0.85, 0.3], FOL],
    kgOrb: [["#28b4d8", "#40c4e4", "#64d4ee", "#8ae2f4"], EM], kgGrub: [["#efe0bf", 5, 0.45, 0.92, 0.2]], kgGrubDk: [["#c8b48c", 4, 0.3, 0.7]], kgRot: [["#8a8a4a", 4, 0.2, 0.6]],
    kgGrubHead: [["#6a4a3a", 4, 0.15, 0.5]], kgMothFur: [["#e2d6ee", 5, 0.5, 0.92, 0.2]], kgMothWing: [["#b096d8", 6, 0.28, 0.8, 0.3]], kgMothDk: [["#5a4878", 4, 0.12, 0.45]],
    // the second four plants: Briar Vine's hips, Stinkhorn's slime, tip and spores, Moonpetal's silver and
    // moon, Ghost Lily's petals and blush
    kgHip: [["#c8322a", 5, 0.2, 0.7, 0.25]], kgGleba: [["#4e4a22", 5, 0.1, 0.45, 0.2]], kgStinkOr: [["#e8782a", 6, 0.25, 0.78, 0.3]], kgStinkGlow: [["#9cd040", "#b0dc58", "#c8ea78"], EM],
    kgMoonPetal: [["#dce4f4", 4, 0.55, 0.94], { bias: 0.04 }], kgMoon: [["#7e96e4", "#90a6ec", "#a4b6f2", "#b8c6f6"], EM], kgBriar: [["#8a3a2c", 5, 0.16, 0.6, 0.2]],
    kgLily: [["#f8e8f0", 4, 0.66, 0.98], { bias: 0.2 }], kgLilyPink: [["#f088b8", 5, 0.4, 0.86, 0.2]], kgLilyGlow: [["#f478c0", "#f894cc", "#fcb4dc"], EM],
    kgLeafSick: [["#8a7a40", 6, 0.16, 0.62, 0.3], FOL], kgEyeSpot: [["#3a2a5a", 3, 0.1, 0.4]], kgStone: [["#8e8c84", 6, 0.2, 0.72, 0.2]], kgStoneDk: [["#66645e", 5, 0.14, 0.52]], kgGolemEye: [["#30d8a0", "#48e4b0", "#68eec4"], EM],
    // Shrine Craft
    scStone: [["#a29e92", 6, 0.24, 0.8, 0.15]], scLacquer: [["#c8382c", 6, 0.2, 0.7, 0.25]], scGold: [["#dcaa40", 5, 0.32, 0.86, 0.3]], scBronze: [["#5f8a78", 5, 0.2, 0.66, 0.2]],
    scMirror: [["#fff0c0", 4, 0.75, 0.99], { bias: 0.4 }], scWood: [["#7a5638", 5, 0.18, 0.6]], scBlack: [["#2a2628", 3, 0.05, 0.3]], scIndigo: [["#3a4a8a", 5, 0.15, 0.6]],
    scPine: [["#2f6a3a", 7, 0.12, 0.6, 0.3], FOL], scPineLt: [["#5a9a48", 5, 0.25, 0.72, 0.3], FOL], scRose: [["#b0182c", 5, 0.15, 0.6]], scGlaze: [["#9a7ac8", 6, 0.25, 0.78, 0.3]],
    scLitGreen: [["#90e050", "#a4ea68", "#bcf088"], EM], scLitViolet: [["#b07ae8", "#c090f0", "#d0a8f4"], EM], scPaperLit: [["#2a88b8", "#3898c4", "#4aa8d0"], EM],
    scPaper: [["#f2e8d2", 4, 0.68, 0.96]], scBib: [["#d8402e", 5, 0.25, 0.72, 0.2]], scLitWarm: [["#f0a040", "#f4b458", "#f8c878"], EM],
    // Hotaru Spirit
    hsBark: [["#cfd6d0", 5, 0.45, 0.88, 0.2]], hsBarkDk: [["#3a3048", 5, 0.1, 0.45]], hsLeaf: [["#2e7a6a", 6, 0.12, 0.58, 0.3], FOL], hsLeafLt: [["#4aa890", 5, 0.25, 0.7, 0.3], FOL],
    hsGlowGold: [["#f0a830", "#f4b848", "#f8c868", "#fcd88c"], EM], hsGlowCyan: [["#20c0e0", "#38d0ea", "#5cdcf0"], EM], hsGlowPink: [["#e848b0", "#f064c0", "#f484d0"], EM],
    hsGlowLime: [["#8ce030", "#a0ea48", "#b8f068"], EM], hsVein: [["#b020e0", "#c040ec", "#d064f4"], EM], hsVeinDim: [["#4a1460", "#561c6e", "#62247c"], { em: 0.35, flat: 1 }], hsCrystal: [["#b8f0ff", 4, 0.6, 0.96], { bias: 0.3 }],
    hsStem: [["#2a4a40", 5, 0.1, 0.45]], hsPetal: [["#f4ecd0", 4, 0.6, 0.95], { bias: 0.15 }], hsCap: [["#c8b0f0", 5, 0.45, 0.88], { bias: 0.15 }],
    hsKodama: [["#eef2e8", 4, 0.7, 0.97]], hsBlight: [["#3a2440", 5, 0.08, 0.42, 0.3]], hsWingDk: [["#2a2a5a", 5, 0.08, 0.4]], hsObsidian: [["#2c2834", 5, 0.06, 0.38, 0.3]],
    hsShell: [["#4a2c52", 6, 0.1, 0.5, 0.3]], hsShellLt: [["#6a4478", 5, 0.2, 0.62, 0.3]], hsMask: [["#e8e2ee", 4, 0.62, 0.95, 0.2]], hsWraith: [["#5c3a78", 6, 0.14, 0.6, 0.3]],
    // the mould creatures (game/enemies): mould greens and their glow, the snail, the mole, lichen, the mender's mint
    hsMould: [["#5e7a34", 6, 0.14, 0.62, 0.3]], hsMouldLt: [["#94b456", 5, 0.3, 0.8, 0.3]], hsMouldDk: [["#3a4a24", 4, 0.1, 0.42]], hsMouldGlow: [["#c8e848", "#d4ee68", "#e0f488"], EM],
    hsSnailBody: [["#b4a68e", 5, 0.4, 0.85, 0.2]], hsSnailShell: [["#8a6440", 6, 0.18, 0.66, 0.3]], hsSnailShellLt: [["#c89a62", 5, 0.35, 0.8, 0.3]],
    hsMoleFur: [["#584436", 5, 0.12, 0.5, 0.2]], hsMoleFurLt: [["#7a6050", 4, 0.25, 0.62]], hsLichen: [["#8a9a6c", 5, 0.25, 0.7, 0.3]], hsLichenLt: [["#c4cc96", 4, 0.5, 0.86, 0.25]],
    hsCrab: [["#5a5468", 5, 0.14, 0.55, 0.25]], hsGlowMint: [["#48d898", "#60e4aa", "#84eec0"], EM],
    // the blight creatures (the bestiary the user picked): the crow's night plumage, bone beak and husk bones, its green eyes
    bcCrow: [["#3a3258", 5, 0.08, 0.5, 0.3]], bcCrowDk: [["#201c32", 4, 0.05, 0.3, 0.2]], bcBone: [["#d4c690", 4, 0.4, 0.88, 0.2]], bcHusk: [["#a49c70", 4, 0.3, 0.76, 0.2]],
    bcEyeGreen: [["#6ab02a", "#8ed040", "#b4ec68"], EM],
  };
  const RAMPS = {}, MATS = {};
  for (const k in MAT) { RAMPS[k] = MAT[k][0]; if (MAT[k][1]) MATS[k] = MAT[k][1]; }
  Object.assign(ME.LIGHT_COL, {
    kgHeart: [1.0, 0.62, 0.48, 1.6], kgOrb: [0.6, 0.95, 1.0, 0.9], kgSpore: [0.85, 0.62, 1.0, 0.6], kgGolemEye: [0.5, 1.0, 0.85, 0.35],
    kgStinkGlow: [0.7, 1.0, 0.4, 0.6], kgMoon: [0.62, 0.72, 1.0, 0.8], kgLilyGlow: [1.0, 0.55, 0.8, 0.8],
    scLitGreen: [0.65, 1.0, 0.5, 0.9], scLitViolet: [0.85, 0.62, 1.0, 0.9], scPaperLit: [0.6, 0.95, 1.0, 1.4], scLitWarm: [1.0, 0.72, 0.4, 1.1],
    hsMouldGlow: [0.8, 1.0, 0.4, 0.5], hsGlowMint: [0.5, 1.0, 0.75, 0.9], bcEyeGreen: [0.55, 0.9, 0.3, 0.4],
    hsGlowGold: [1.0, 0.82, 0.45, 1.2], hsGlowCyan: [0.55, 0.95, 1.0, 1.2], hsGlowPink: [1.0, 0.55, 0.85, 1.0], hsGlowLime: [0.75, 1.0, 0.4, 0.9], hsVein: [0.9, 0.3, 1.0, 0.7],
  });

  // ---------------------------------------------------------------- shared parts
  const mossPad = (r = 0.3) => E([0, 0, 0.02], [r, r, 0.065], "moss", { k2: 0.03 });
  const stoneMoss = (m, k = 9, th = 0.5) => (x, y, z, mm, nx, ny, nz) => (mm === m && nz > th && nz3(x, y, z, k, 3) > 0.48 ? "moss" : null);
  // a segmented larva along +x (head at +x): returns prims, the head centre and segment boundaries
  // chibi proportions: a big raised head (the face reads at game zoom), body tapering to a curled tail;
  // o.wave (radians) ripples the segments for a crawl cycle
  function larva(body, head, o = {}) {
    const w = o.wave, seg = [[0.08, 0.1], [-0.03, 0.095], [-0.12, 0.085], [-0.19, 0.07], [-0.22, 0.055, 0.09]], p = [];
    seg.forEach(([x, r, y = 0], i) => p.push(S([x, y, r * 0.95 + (w === undefined ? 0 : Math.max(0, Math.sin(w - i * 1.3)) * 0.035)], r, body, { k2: 0.025 })));
    const hc = [0.2, 0, 0.15 + (w === undefined ? 0 : Math.max(0, Math.sin(w + 1.3)) * 0.02)];
    p.push(S(hc, 0.135, body, { k2: 0.03 }));
    for (const sd of [-1, 1]) {
      p.push(C(add(hc, [0.1, sd * 0.05, -0.08]), add(hc, [0.15, sd * 0.02, -0.12]), 0.018, 0.006, head));
      for (const x of [0.08, -0.03, -0.12]) p.push(C([x, sd * 0.07, 0.04], [x + 0.02, sd * 0.105, 0.004], 0.02, 0.013, head));
    }
    return { p, hc, hr: 0.135, bounds: [0.025, -0.075, -0.155] };
  }
  // stone lantern (kasuga-ish), s scales it about the base; lit is the window material
  const lantern = (lit, s = 1) => {
    const q = (v) => mul(v, s);
    return [
      Y(q([0, 0, 0.05]), 0.2 * s, 0.05 * s, "scStone", { round: 0.02 * s }), Y(q([0, 0, 0.13]), 0.13 * s, 0.03 * s, "scStone"), Y(q([0, 0, 0.32]), 0.065 * s, 0.17 * s, "scStone"), B(q([0, 0, 0.52]), q([0.16, 0.16, 0.03]), 0.01 * s, "scStone"),
      B(q([0, 0, 0.63]), q([0.12, 0.12, 0.08]), 0.01 * s, "scStone"), B(q([0.115, 0, 0.635]), q([0.012, 0.05, 0.045]), 0, lit), B(q([0, 0.115, 0.635]), q([0.05, 0.012, 0.045]), 0, lit),
      E(q([0, 0, 0.76]), q([0.27, 0.27, 0.06]), "scStone", { k2: 0.03 * s }), C(q([0, 0, 0.78]), q([0, 0, 0.88]), 0.1 * s, 0.02 * s, "scStone", { k2: 0.02 * s }), S(q([0, 0, 0.9]), 0.04 * s, "scStone"),
    ];
  };
  // kodama (tree spirit): pushes body + head prims, returns the head centre for kodamaFace
  const kodama = (c, s, p) => {
    p.push(E(add(c, [0, 0, 0.06 * s]), [0.045 * s, 0.045 * s, 0.065 * s], "hsKodama", { k2: 0.02 }), S(add(c, [0, 0, 0.16 * s]), 0.07 * s, "hsKodama", { k2: 0.02 }));
    return add(c, [0, 0, 0.16 * s]);
  };
  const kodamaFace = (heads, s) => (x, y, z) => {
    for (const h of heads) if (near([x, y, z], h, 0.078 * s)) return cface([x - h[0], y - h[1], z - h[2]], 0.07 * s, { ex: 0.38, ey: 0.1, er: 0.17, hi: false, mouth: [0.05, -0.35, 0.1] });
    return null;
  };

  // ---------------------------------------------------------------- registration
  // model(name, k, fn, frames): registers MODELS[name] at world scale k (models are authored at k 1) as a
  // ray-marched volume, with a flipbook of `frames` over o.t. The source joins the bake-cache key.
  ME.ASSET_SRC = ME.ASSET_SRC || "";
  const model = (name, k, fn, frames) => {
    M[name] = (o) => { const md = fn(o || {}); md.k = k * (md.kMul || 1); return md; };
    ME.VOLUME_DECO.add(name);
    if (frames > 1) ME.FRAMES[name] = frames;
    (ME.ASSET_BY = ME.ASSET_BY || {})[name] = name + k + String(fn); // by name: a bake keys only the models it reads (src/cache.js)
    ME.ASSET_SRC += ME.ASSET_BY[name];
  };

  // ---------------------------------------------------------------- showroom
  // ME.ASSET_THEMES[name] = { label, rows: [[[id, o, cam], ...], c, offsets], keepPath, deco, walkers, jarLight }
  // rows run along the screen horizontal (offsets in tiles) at c tiles from the jar centre toward the viewer;
  // cam names a close-up shot a-<cam>. keepPath keeps the jar's path (walkers need it).
  ME.ASSET_THEMES = ME.ASSET_THEMES || {};
  ME.galleryStyle = (theme) => {
    const th = ME.ASSET_THEMES[theme];
    if (!th) throw new Error("unknown gallery theme " + theme + " (" + Object.keys(ME.ASSET_THEMES).join(", ") + ")");
    const base = window.STYLES.find((s) => s.id === "jar-koke"), m0 = base.map, Cc = m0.W / 2, h = [Math.SQRT1_2, -Math.SQRT1_2];
    const clean = (r) => (typeof r === "string" ? r.replace(th.keepPath ? /w/g : /[tw]/g, "m") : r.map((c) => (c === "w" || (!th.keepPath && c === "t") ? "m" : c)));
    const map = Object.assign({}, m0, { typ: m0.typ.map(clean) }), deco = [], cams = {};
    for (const [items, c, us] of th.rows || []) items.forEach(([id, o, cam], i) => {
      const u = us[i], px = Cc + c + h[0] * u, py = Cc + c + h[1] * u, x = Math.floor(px), y = Math.floor(py);
      deco.push([id, o, x, y, { dx: px - x - 0.5, dy: py - y - 0.5 }]);
      const md = M[id](o);
      if (cam) cams["a-" + cam] = [px, py, 1 + md.h * md.k * 0.45, th.zoom?.[cam] || (md.h * md.k > 2.2 ? 3.0 : md.h * md.k < 0.9 ? 6.5 : 4.6)];
    });
    for (const d of th.deco || []) deco.push(d);
    for (const d of base.deco) if (d && /mound|fern/.test(d[0]) && Math.hypot(d[2] + 0.5 - Cc, d[3] + 0.5 - Cc) > 5.6) deco.push(d);
    // even showroom light: two moderate beams over the rows instead of the jar's spotlight pools
    const b0 = base.light.beams[0], bc = Cc - 1.3, fc = Cc + 1.7;
    const light = th.jarLight ? base.light : Object.assign({}, base.light, { shade: 0.62, pool: 0.3, beams: [Object.assign({}, b0, { x: bc + 0.3, y: bc - 0.3, r: 2.4, k: 0.5 }), Object.assign({}, b0, { x: fc, y: fc, r: 2.0, k: 0.45 })] });
    ME.galleryCams = Object.assign({ g: [Cc, Cc, 1.3, 1.55], l: [Cc, Cc, 1.6, 2.1] }, cams, th.cams || {});
    return Object.assign({}, base, { id: "gallery-" + theme, map, deco, light, walkers: th.walkers, ramps: Object.assign({}, base.ramps, RAMPS), mats: Object.assign({}, base.mats, MATS) });
  };

  ME.assetKit = { P, S, E, C, B, Y, M, TAU, add, mul, lerp3, dot, norm, cross, rx, ry, rz, rmul, orient, near, nz3, cface, mossPad, stoneMoss, larva, lantern, kodama, kodamaFace, model, RAMPS, MATS };
})();
