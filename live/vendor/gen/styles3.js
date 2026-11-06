/* Round three: Komorebi HD refined into a striking isometric terrarium. Calmer velvet moss,
   sun pools inside canopy shade, volumetric shafts, soil strata behind glass. Five variants. */
(function () {
  const P = window.PX, MOD = window.MODELS, { mk, fine, baseRamps } = P.r2, sm = P.smooth;
  const parseMap = (rows, floor, mask) => {
    const hgt = [], typ = [];
    rows.forEach((r, y) => { const t = r.trim().split(/\s+/); hgt.push(t.map((s) => parseInt(s[0], 36))); typ.push(t.map((s, x) => (mask && !mask(x + 0.5, y + 0.5) ? "_" : s[1]))); });
    return { W: hgt[0].length, H: hgt.length, hgt, typ, floor, rings: [] };
  };

  // ---------------------------------------------------------------- shared look
  const MOSSY = {
    moss: ["#4a8f32", 8, 0.06, 0.78, 0.42, 0.95], moss2: ["#7aa63e", 8, 0.09, 0.8, 0.36, 0.85],
    leaf: ["#2c6a32", 7, 0.05, 0.62, 0.38], leaf2: ["#4e9a3a", 7, 0.08, 0.72, 0.35], pine: ["#2c5e40", 7, 0.05, 0.58, 0.38],
    bark: ["#5a3c2a", 6, 0.06, 0.55], earth: ["#3a2a20", 6, 0.04, 0.42], stone: ["#7a8478", 6, 0.12, 0.8], water: ["#38a09a", 7, 0.1, 0.86, 0.3],
    pebble: ["#8a9098", 6, 0.16, 0.82], pebble2: ["#b0a690", 6, 0.2, 0.86], charcoal: ["#2a282e", 4, 0.04, 0.3], sphag: ["#a69a5c", 6, 0.16, 0.72],
    wood: ["#4a3020", 7, 0.04, 0.5, 0.25], brass: ["#b08a3a", 6, 0.14, 0.86, 0.3], bloom: ["#f0a0b8", 4, 0.5, 0.9],
  };
  const velvet = { tex: "velvet", top: "moss", top2: "moss2", mix: 0.26, scale: 1.6, amp: 0.22, k: 0.95, hk: 0.18, fuzz: 0.09, flowers: 0.025, flowerRamp: "bloom" };
  const TERRAIN = {
    m: Object.assign({}, velvet, { base: 0.6, side: "earth", sideTex: "moss", drip: null, tufts: 0, roots: "bark", pebble: "stone" }),
    s: { tex: "flag", top: "stone", side: "earth", sideTex: "moss", drip: null, gap: "moss", base: 0.62 },
    w: { tex: "water", top: "water", side: "earth", sideTex: "moss", drip: null, base: 0.4, rim: 0.72, rimW: 0.035 },
    M: Object.assign({}, velvet, { side: "stone", sideTex: "moss", drip: null, mossCover: 0.75 }),
  };
  const STRATA = [
    { top: -1.02, ramp: "pebble", ramp2: "pebble2", gap: "charcoal", tex: "pebbles", f: 6.5, wob: 0.08 },
    { top: -0.9, ramp: "charcoal", tex: "grain", wob: 0.05 },
    { top: -0.58, ramp: "sphag", tex: "fiber", wob: 0.12 },
  ];
  const hd = (o) => mk(Object.assign({
    tw: 96, ss: 2, scale: 1, roster: MOD.cute, kit: ["m", "s", "M", "w"], kitBase: "m", sceneOnly: false,
    dither: "none", spriteDither: "none", bgDither: "bayer", outline: "none", innerLine: 0, cubeSeams: false,
    amb: 0.3, shadowK: 0.12, softShadow: 7, lip: 0.1, L: [-0.22, 0.32, 0.92], terrain: TERRAIN,
  }, o, { mats: Object.assign({ leaf: { clump: 7, clumpK: 0.42 }, leaf2: { clump: 8, clumpK: 0.42 }, pine: { clump: 8, clumpK: 0.45 } }, o.mats), ramps: fine(Object.assign({}, baseRamps, MOSSY, o.ramps), 4) }));

  // Wooden plinth with a brass trim and a contact shadow where the glass stands.
  const plinth = (st, shape, glassD, o = {}) => ({
    shape,
    shade(X, Y, Z, n) {
      const L = st.L, dif = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), top = n[2] > 0.5;
      if (!top && shape.zt - Z < 0.07) return { ramp: "brass", s: 0.42 + 0.4 * dif + (shape.zt - Z < 0.02 ? 0.25 : 0) + (n[1] > 0.5 ? 0.12 : 0) };
      let s = (o.base ?? 0.18) + 0.5 * dif + (n[1] > 0.5 ? 0.1 : 0);
      const along = shape.type !== "box" ? Math.atan2(Y - shape.cy, X - shape.cx) * 3 : Math.abs(n[0]) > 0.5 ? Y : X;
      s += (P.fbm(along * 2.5, Z * 34 + (top ? Y * 5 : 0), 0, 101) - 0.5) * 0.2;
      if (top) s -= 0.3 * sm(0.22, 0, glassD(X, Y));
      return { ramp: "wood", s };
    },
  });
  const boxD = (g) => (X, Y) => Math.max(g.x0 - X, X - g.x1, g.y0 - Y, Y - g.y1);
  const spot = (lo, k, cx = 0.5, cy = 0.42) => (u, v) => lo + k * Math.exp(-((u - cx) ** 2 * 4.5 + (v - cy) ** 2 * 3.2));

  // ---------------------------------------------------------------- the glass-box map
  // A spring at the back falls in three steps into a pond; the path winds from the right corner
  // down and across the front. One hero cedar, one pine, a few rocks and ferns.
  const BOX_ROWS = [
    "8m 8m 8m 7m 7m 6m 6m 6m 6m 6m",
    "8m 8m 8w 7m 7m 6m 6m 6m 6M 6m",
    "7m 7m 7w 7m 6m 5s 5s 5s 5s 5s",
    "6m 6m 6w 6m 5m 5s 5m 5m 5m 5m",
    "5m 5m 5w 5m 5m 4s 4m 4m 4m 4m",
    "4m 3w 3w 3w 4m 4s 4m 3m 3m 3m",
    "4m 3w 3w 3w 3m 3s 3m 3m 3m 3m",
    "3s 3s 3s 3s 3s 3s 3m 3m 2m 2m",
    "3m 3m 3m 3m 3m 3m 3m 2m 2m 2m",
    "2m 2m 3m 3m 3m 2m 2m 2m 2m 2m",
  ];
  const BOX_DECO = [
    ["cedar", { seed: 11, H: 3.6, girth: 2.2, spread: 0.95, start: 0.55, tiers: 5 }, 0, 0], ["pine", { seed: 4, sz: 1.7 }, 9, 0],
    ["rock", { sz: 1.0 }, 3, 4], ["rock", { sz: 0.75 }, 4, 6], ["fern", { seed: 2, sz: 1.2 }, 1, 3], ["fern", { seed: 5 }, 7, 5], ["fern", { seed: 7, sz: 0.9 }, 6, 8],
    ["lily", {}, 1, 6], ["lily", {}, 3, 5, { dx: -0.1 }],
    ["hotaru", { t: 0.1 }, 7, 3], ["puffcap", { t: 0.4 }, 4, 4], ["pup", { t: 0.3 }, 6, 6], ["sprout", { t: 0.6 }, 1, 8],
    ["piglet", { t: 0.2 }, 8, 2], ["pillbug", { t: 0.5 }, 5, 4], ["ashigaru", { t: 0.75 }, 3, 7],
  ];
  const boxBeams = () => [{ x: 5.6, y: 3.7, r: 1.2, len: 14 }, { x: 2.3, y: 5.8, r: 1.05, k: 0.95, len: 12 }, { x: 8.3, y: 3.3, r: 0.85, k: 0.8, len: 14 }];
  const glassBox = (o) => Object.assign({ type: "box", x0: -0.07, y0: -0.07, x1: 10.07, y1: 10.07, zb: -1.5, zt: 8.3, tint: [190, 232, 208], tintA: 0.05, f0: 0.03, fk: 0.9, sky: 0.2, col: [236, 250, 240], edgePx: 2.2, edgeK: 0.55, bands: [[0.16, 0.05, 0.3], [0.25, 0.012, 0.22], [0.72, 0.03, 0.12]], bandSlope: 0.5 }, o);
  const boxSolids = (g) => (st, map) => [plinth(st, { type: "box", x0: -0.5, y0: -0.5, x1: map.W + 0.5, y1: map.H + 0.5, zb: -2.15, zt: -1.5 }, boxD(g))];
  const BOX = (o) => { const g = glassBox(o.glassOpts); return hd(Object.assign({ map: parseMap(BOX_ROWS, -3), deco: BOX_DECO, pad: 1.1, headMin: 4.6, foot: 0.8, strata: STRATA, solids: boxSolids(g), glass: g }, o)); };
  const LIGHT = (o) => Object.assign({ beams: boxBeams(), shade: 0.32, pool: 0.38, leaf: 0.35, soft: 0.3, dapple: 0.68, dappleF: 1.2, dappleK: 0.32, sideK: 1.4, spriteK: 0.8 }, o);
  const DARK_SKY = ["#030604", "#060d08", "#0b170e", "#122215", "#1b301d", "#284226", "#385630"];

  P.r3 = { hd, plinth, TERRAIN, STRATA, LIGHT, MOSSY, velvet, parseMap };

  // H1 — the hero: a glass terrarium on a walnut plinth, spot-lit against the dark.
  BOX({
    id: "terra", name: "Glasshouse", jp: "苔の硝子庭", sceneOnly: false,
    ramps: { sky: DARK_SKY, fog: ["#1e3a26", "#2c4a32"] }, bg: spot(0.04, 0.85), light: LIGHT(),
    hd: { bloom: 0.7, threshold: 0.86, radius: 6, haze: 0.08, fog: [30, 60, 40], vignette: 0.45, beamK: 0.5, beamW: 1.2, motes: 26 },
  });

  // H4 — morning dew: pale studio light, condensation on the glass, tilt-shift focus.
  BOX({
    id: "terra-dew", name: "Morning Dew", jp: "朝露",
    ramps: {
      sky: ["#8ea896", "#a3baa6", "#b8cbb6", "#cddbc8", "#e0e9d9", "#eef3e8", "#f8faf3"], fog: ["#e6eee0", "#f4f8ee"],
      moss: ["#559c40", 8, 0.1, 0.82, 0.36, 0.9], moss2: ["#8bb24e", 8, 0.14, 0.86, 0.3, 0.8], wood: ["#8a6a4a", 7, 0.12, 0.7, 0.25], water: ["#5ab4ac", 7, 0.18, 0.9, 0.3],
    },
    bg: spot(0.3, 0.6, 0.5, 0.35), amb: 0.38, L: [-0.3, 0.38, 0.88],
    light: LIGHT({ shade: 0.2, pool: 0.3, dappleK: 0.3, beams: [{ x: 5.6, y: 3.7, r: 1.4, len: 12 }, { x: 2.4, y: 5.8, r: 1.15, k: 0.9, len: 10 }] }),
    glassOpts: { tintA: 0.06, sky: 0.3, fogTop: 0.45, drops: 0.6, dropF: 40, edgeK: 0.5 },
    hd: { bloom: 0.5, threshold: 0.9, radius: 6, haze: 0.16, fog: [235, 242, 228], vignette: 0.2, beamK: 0.32, beamW: 1.3, beamCol: [250, 252, 240], motes: 12, dof: { focus: 0.55, band: 0.17, ramp: 0.32, r: 4 } },
  });

  // H5 — firefly night: moonlight through the lid, glowing lanterns, fireflies in the jar.
  BOX({
    id: "terra-night", name: "Hotaru Night", jp: "蛍の硝子庭", amb: 0.26, L: [-0.25, 0.3, 0.92],
    ramps: {
      sky: ["#020308", "#04070f", "#070c1a", "#0b1326", "#111c34", "#192842", "#223452"], fog: ["#141e38", "#1e2a48"],
      moss: ["#2f6e52", 8, 0.04, 0.62, 0.45, 0.9], moss2: ["#4a7e4c", 8, 0.05, 0.64, 0.4, 0.8], leaf: ["#1e4a40", 7, 0.03, 0.5, 0.4], pine: ["#1c4440", 7, 0.03, 0.48, 0.4],
      water: ["#2a5c8c", 7, 0.06, 0.78, 0.3], earth: ["#2a2028", 6, 0.03, 0.36], stone: ["#5a6474", 6, 0.08, 0.66], wood: ["#3a2418", 7, 0.03, 0.42, 0.25],
    },
    mats: { paper: { em: 1 } }, bg: spot(0.03, 0.55, 0.5, 0.35),
    deco: [...BOX_DECO, ["hotaru", { t: 0.5, wisps: false, k: 1.4 }, 6, 1], ["hotaru", { t: 0.8, wisps: false, k: 1.4 }, 2, 8], ["lantern", { t: 0.2 }, 3, 3]],
    light: LIGHT({ shade: 0.3, pool: 0.34, dappleK: 0.3, beams: [{ x: 2.4, y: 5.8, r: 1.2, len: 16 }, { x: 5.6, y: 4.6, r: 0.9, k: 0.8, len: 16 }] }),
    glassOpts: { tint: [170, 200, 235], sky: 0.16, edgeK: 0.45 },
    hd: { bloom: 1.05, threshold: 0.82, radius: 6, haze: 0.06, fog: [20, 30, 60], vignette: 0.5, beamK: 0.38, beamW: 1.2, beamCol: [190, 214, 255], motes: 10 },
    fx(buf, v, ctx) { ctx.blobs(70, "firefly", 2.4 * (ctx.st.ss || 1), 1); },
  });

  // H3 — moss island: the same garden without glass, floating in bright morning haze.
  hd({
    id: "terra-isle", name: "Moss Island", jp: "苔の浮島", map: parseMap(BOX_ROWS, -5), deco: BOX_DECO, pad: 1.0, headMin: 3.6, L: [-0.3, 0.38, 0.88],
    ramps: { sky: ["#456e4c", "#5f8a60", "#7aa476", "#97bd8e", "#b5d3a8", "#d2e6c2", "#ecf4dc"], fog: ["#cfe3bf", "#e6f1d8"] },
    terrain: Object.assign({}, TERRAIN, { m: Object.assign({}, TERRAIN.m, { mossCover: 0.7, mossFall: 0.32 }) }),
    bg: (u, v) => 0.18 + 0.6 * (1 - v) + 0.3 * Math.exp(-((u - 0.18) ** 2 * 5 + (v - 0.08) ** 2 * 6)),
    light: LIGHT({ shade: 0.22, pool: 0.32, beams: [{ x: 5.6, y: 3.7, r: 1.25, len: 30 }, { x: 2.3, y: 5.8, r: 1.05, k: 0.95, len: 30 }, { x: 8.3, y: 3.3, r: 0.9, k: 0.85, len: 30 }, { x: 4.0, y: 8.3, r: 0.8, k: 0.75, len: 30 }] }),
    hd: { bloom: 0.6, threshold: 0.88, radius: 6, haze: 0.3, fog: [214, 232, 196], vignette: 0.15, beamK: 0.42, beamW: 1.25, beamCol: [255, 246, 214], motes: 18 },
  });

  // H2 — bell jar: a round island under a glass cloche, the Heart Tree at its centre and the
  // path circling it. Golden late light.
  const C = 5, RG = 5.95;
  hd({
    id: "terra-jar", name: "Bell Jar", jp: "硝子の鐘", pad: 1.0, headMin: 5.7, foot: 0.8, L: [-0.34, 0.3, 0.89],
    map: parseMap([
      "3m 3m 3m 3m 3m 3m 3m 3m 3m 3m",
      "3m 3m 4m 4m 4m 4m 4m 4m 3m 3m",
      "3m 4m 4s 4s 4s 4s 4s 4s 4m 3m",
      "3m 4m 4s 5m 5m 5m 5m 4s 4m 3m",
      "4s 4s 4s 5m 7m 6m 5m 4s 4m 3m",
      "3m 4m 4s 5m 6m 6m 5m 4s 4m 3m",
      "3m 4m 4s 5m 5m 5m 5m 4s 4m 3m",
      "3m 4m 4s 4s 4s 4s 4s 4s 4m 3m",
      "3m 3m 4m 3w 3w 3w 4m 4m 3m 3m",
      "2m 2m 3m 3w 3w 3m 3m 3m 2m 2m",
    ], -3, (x, y) => Math.hypot(x - C, y - C) < 5.2),
    deco: [
      ["cedar", { seed: 11, H: 3.6, girth: 2.2, spread: 0.95, start: 0.55, tiers: 5 }, 4, 4],
      ["rock", { sz: 0.9 }, 6, 3], ["rock", { sz: 0.7 }, 2, 8], ["fern", { seed: 2, sz: 1.1 }, 3, 5], ["fern", { seed: 5 }, 8, 6], ["fern", { seed: 9, sz: 0.9 }, 5, 1],
      ["lily", {}, 4, 8], ["lily", {}, 3, 9, { dx: 0.15 }],
      ["hotaru", { t: 0.1 }, 3, 3], ["puffcap", { t: 0.4 }, 6, 5], ["pup", { t: 0.3 }, 1, 5], ["sprout", { t: 0.6 }, 8, 3],
      ["piglet", { t: 0.2 }, 2, 6], ["pillbug", { t: 0.5 }, 5, 7], ["ashigaru", { t: 0.75 }, 7, 3, { flip: true }],
    ],
    ramps: {
      sky: ["#020605", "#05100d", "#0a1a16", "#10241e", "#163028", "#1f3e32", "#2a4c3c"], fog: ["#24382c", "#304a38"],
      moss: ["#55902e", 8, 0.07, 0.8, 0.45, 0.95], moss2: ["#8aa83a", 8, 0.1, 0.82, 0.4, 0.85],
    },
    bg: spot(0.04, 0.8, 0.5, 0.45),
    solids: (st) => [
      plinth(st, { type: "cyl", cx: C, cy: C, R: 6.4, zb: -2.15, zt: -1.5 }, (X, Y) => Math.hypot(X - C, Y - C) - RG),
      { shape: { type: "cyl", cx: C, cy: C, R: RG - 0.06, zb: -1.5, zt: 0.75 }, shade(X, Y, Z, n) {
        if (n[2] > 0.5) return { ramp: "moss", s: 0.5 + (P.fbm(X * 1.6, Y * 1.6, 0, 13) - 0.5) * 0.3 + (P.noise(X * 46, Y * 46, 0, 41) - 0.5) * 0.09 + P.lightMod(st, X, Y, Z, 0, 1) };
        const L = st.L, U = Math.atan2(Y - C, X - C) * RG, s = 0.3 + 0.5 * Math.max(0, n[0] * L[0] + n[1] * L[1]) + P.lightMod(st, X, Y, Z, 0, 0), sr = P.strataAt(st, U, Z, 1);
        if (sr) return { ramp: sr.ramp, s: s + sr.s };
        const dz = 0.75 - Z;
        if (P.fbm(U * 2.2, Z * 2.2, 0, 71) + 0.55 - dz * 0.45 > 0.62) return { ramp: "moss", s: s + 0.04 - dz * 0.12 };
        return { ramp: "earth", s: s + (P.noise(U * 6, Z * 5, 0, 2) - 0.5) * 0.14 - 0.06 };
      } },
    ],
    strata: STRATA,
    glass: { type: "cyl", cx: C, cy: C, R: RG, zb: -1.5, zt: 2.6, dome: true, domeH: 6.2, tint: [200, 232, 210], tintA: 0.05, f0: 0.03, fk: 0.95, sky: 0.3, col: [255, 246, 226], edgePx: 2.4, edgeK: 0.45,
      windows: [{ d: [-0.6, 0.8], w0: 0.86, w1: 0.985, k: 0.9 }, { d: [0.25, 0.97], w0: 0.95, w1: 0.995, k: 0.45 }] },
    light: LIGHT({ shade: 0.3, pool: 0.4, beams: [{ x: 4.6, y: 3.6, r: 1.35, len: 14 }, { x: 3.0, y: 7.2, r: 0.95, k: 0.9, len: 12 }, { x: 4.3, y: 8.6, r: 0.8, k: 0.85, len: 12 }] }),
    hd: { bloom: 0.75, threshold: 0.86, radius: 6, haze: 0.08, fog: [40, 60, 40], vignette: 0.45, beamK: 0.5, beamW: 1.2, beamCol: [255, 224, 168], motes: 24 },
  });
})();
