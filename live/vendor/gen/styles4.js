/* Round four: the Bell Jar opened up into a Japanese moss garden under a thick forest canopy.
   A wider jar on a 14-cell island, gentle half-step terraces, low moss mounds, stepping stones,
   an organic pond; deep green shade with a few hard-edged sun pools; a dark forest behind.
   Each scene also emits layers (base, beams, pool, moss, leaf, bg) for the live board. */
(function () {
  const P = window.PX, { hd, plinth, TERRAIN, STRATA, LIGHT, velvet } = P.r3;

  const N = 14, C = 7, RI = 7.0, RG = 7.35, DRUM = 0.92;

  // Garden map from a few shapes: hills (in steps, rounded to half steps) or a height(x, y) function
  // (whole steps), cell paths, water (an elliptical pond, or a list of ellipses and stream segments)
  // and an optional gravel field (signed distance, + inside). Water and gravel cells cover every tile
  // a shape touches; the textures then draw the exact wobbly shore from waterD / gravelD. Ponds sit at
  // their own level (h); streams keep the terrain height and fall where they step down.
  // Cells wholly outside the island circle are "_"; the renderer trims the rest to the circle (st.clip).
  const garden = (o) => {
    const n = o.N || N, c = n / 2, hgt = [], typ = [], path = new Set();
    // water shapes as signed distances (+ inside); g grows the shape to find every tile it touches
    const waters = (o.water || (o.pond ? [{ e: o.pond, h: 2 }] : [])).map((w) => w.e
      ? { h: w.h, d: (x, y, g = 0) => (1 - Math.hypot((x - w.e.x) / (w.e.rx + g), (y - w.e.y) / (w.e.ry + g))) * Math.min(w.e.rx, w.e.ry) }
      : { lvl: w.carve && o.height ? (x, y) => { const [x0, y0, x1, y1] = w.seg, vx = x1 - x0, vy = y1 - y0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy))); return Math.round(o.height(x0 + vx * k, y0 + vy * k)); } : null, d: (x, y, g = 0) => { const [x0, y0, x1, y1] = w.seg, vx = x1 - x0, vy = y1 - y0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy))); return w.r + g - Math.hypot(x - x0 - vx * k, y - y0 - vy * k); } });
    for (const pts of o.paths || []) for (let k = 0; k + 1 < pts.length; k++) {
      let [x, y] = pts[k]; const [x1, y1] = pts[k + 1]; path.add(x + "," + y);
      while (x !== x1 || y !== y1) { if (x !== x1) x += Math.sign(x1 - x); else y += Math.sign(y1 - y); path.add(x + "," + y); }
    }
    for (let y = 0; y < n; y++) {
      hgt.push([]); typ.push([]);
      for (let x = 0; x < n; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        let h = 2;
        if (o.height) h = Math.round(o.height(cx, cy));
        for (const hl of o.hills || []) h += hl.h * P.smooth(hl.r, hl.r * 0.35, Math.hypot(cx - hl.x, cy - hl.y));
        h = Math.round(h * 2) / 2;
        let t = o.gravel && o.gravel(cx, cy) > -0.75 ? "g" : "m";
        const onPath = path.has(x + "," + y);
        if (onPath) t = o.lane || (t === "g" ? "u" : "t");
        for (const w of waters) if (w.d(cx, cy, 0.72) > 0) { t = onPath && o.ford ? "v" : "w"; if (w.h !== undefined) h = w.h; else if (w.lvl) h = w.lvl(cx, cy); }
        hgt[y].push(h); typ[y].push(Math.hypot(cx - c, cy - c) < c + 0.71 ? t : "_");
      }
    }
    const waterD = waters.length ? (x, y) => Math.max(...waters.map((w) => w.d(x, y))) : null;
    return { W: n, H: n, hgt, typ, floor: -3, rings: o.rings || [], waterD, gravelD: o.gravel || null, geo: { N: n, C: c, RI: c }, path: o.paths || [] };
  };

  // Terrain: smooth velvet carpet (bigger, calmer cushions), stepping stones, raked gravel, a calm pond.
  const carpet = Object.assign({}, velvet, { scale: 1.1, amp: 0.14, k: 0.75, hk: 0.12, fuzz: 0.045, mix: 0.22, flowers: 0 });
  const tobi = Object.assign({}, carpet, { tex: "tobi", stone: "stone", f: 1.25, rad: 0.27, base: 0.6, stoneBase: 0.72, side: "earth", sideTex: "moss", drip: null, tufts: 0 });
  const GARDEN = Object.assign({}, TERRAIN, {
    m: Object.assign({}, TERRAIN.m, carpet, { base: 0.6 }),
    t: tobi,
    u: Object.assign({}, tobi, { fill: "gravel", fillRamp: "gravel", fillBase: 0.62 }),
    g: { tex: "rake", hd: true, top: "gravel", side: "earth", sideTex: "moss", drip: null, base: 0.56, axis: "x", freq: 4.5, grooveK: 0.09, mossEdge: 0.3 },
    w: { tex: "water", top: "water", calm: true, base: 0.62, shallow: 0.1, deep: 0.14, ripple: 0.08, glints: 0.3, side: "earth", sideTex: "moss", drip: null },
  });

  // A dark forest behind the jar: blurred trunks, a soft glow, a few bokeh discs.
  const forest = (o) => (u, v) => {
    let s = o.lo + o.k * Math.exp(-((u - 0.5) ** 2 * 3.2 + (v - (o.cy ?? 0.5)) ** 2 * 2.6)) - (o.canopy ?? 0.12) * (1 - v) ** 3;
    for (const [tu, tw, dk] of o.trunks) {
      const d = Math.abs(u - tu - Math.sin(v * 5 + tu * 11) * 0.006) / (tw * (1 + 0.3 * v));
      if (d < 1) s = s * (1 - dk * (1 - Math.pow(d, 6))) + (d > 0.6 && u < tu ? 0.025 : 0);
    }
    for (const [bu, bv, br, bk] of o.bokeh || []) { const d = Math.hypot(u - bu, (v - bv) * 0.9) / br; if (d < 1) s += bk * (d > 0.86 ? 1.25 : 1) * (1 - d * d * 0.4); }
    return s;
  };
  const TRUNKS = [[0.05, 0.035, 0.6], [0.16, 0.022, 0.45], [0.3, 0.05, 0.55], [0.71, 0.03, 0.5], [0.83, 0.055, 0.6], [0.95, 0.025, 0.45]];
  const BOKEH = [[0.12, 0.1, 0.025, 0.12], [0.24, 0.05, 0.018, 0.1], [0.62, 0.06, 0.03, 0.08], [0.9, 0.14, 0.022, 0.12], [0.77, 0.03, 0.015, 0.1]];
  const FOREST_SKY = ["#020503", "#040b06", "#08140b", "#0e1f12", "#162c19", "#203c22", "#2e4e2e", "#40623c"];
  // Shade stays a deep saturated green instead of falling to black; lights lean warm.
  const RICH_MOSS = {
    moss: ["#3f8a34", 9, 0.1, 0.8, 0.3, 1.05], moss2: ["#78a83c", 9, 0.12, 0.82, 0.28, 0.95],
    leaf: ["#2e6e30", 8, 0.07, 0.7, 0.32], leaf2: ["#4e9a3a", 8, 0.09, 0.76, 0.3],
    water: ["#2f7a62", 8, 0.1, 0.84, 0.2], stone: ["#848a7c", 7, 0.1, 0.86],
  };

  const keep = (map) => { const { C, RI } = map.geo; return ([, , x, y, ex]) => map.typ[y] && map.typ[y][x] && map.typ[y][x] !== "_" && (map.typ[y][x] !== "w" || (ex && ex.overWater))
    && Math.hypot(x + 0.5 + ((ex && ex.dx) || 0) - C, y + 0.5 + ((ex && ex.dy) || 0) - C) < RI - 0.25; };
  const jar = (o) => {
    const map = o.map, { C, RI } = map.geo, RG = RI + 0.35, sc = RI / 7, mats = Object.assign({
      moss: { clump: 30, clumpK: 0.12, wrap: 0.5 }, moss2: { clump: 30, clumpK: 0.12, wrap: 0.5 },
      mound: { ramp: "moss", bias: -0.18, wrap: 0.8 }, mound2: { ramp: "moss2", bias: -0.18, wrap: 0.8 },
      leaf: { clump: 6, clumpK: 0.2, wrap: 0.5 }, leaf2: { clump: 7, clumpK: 0.2, wrap: 0.5 }, pine: { clump: 7, clumpK: 0.22, wrap: 0.45 }, maple: { clump: 7, clumpK: 0.22, wrap: 0.5 },
    }, o.mats);
    return hd(Object.assign({
      tw: 76, pad: 0.55, headMin: 7.4 * sc, foot: 0.8, L: [-0.3, 0.32, 0.9], amb: 0.22, layers: true, sceneOnly: true, terrain: GARDEN, strata: STRATA, waterDrop: 0, lip: 0.04, clip: { x: C, y: C, r: RI, foot: DRUM },
      bg: forest({ lo: 0.05, k: 0.5, trunks: TRUNKS, bokeh: BOKEH }),
      solids: (st) => [
        plinth(st, { type: "cyl", cx: C, cy: C, R: RG + 0.45, zb: -2.15, zt: -1.5 }, (X, Y) => Math.hypot(X - C, Y - C) - RG),
        { shape: { type: "cyl", cx: C, cy: C, R: RG - 0.06, zb: -1.5, zt: DRUM }, shade(X, Y, Z, n) {
          if (n[2] > 0.5) {
            if (o.drumTop === "gravel") { const d = Math.hypot(X - C, Y - C), r = { ramp: "gravel", s: 0.6 + 0.16 * Math.sin(d * 4.2 * Math.PI * 2) + (P.noise(X * 40, Y * 40, 0, 7) - 0.5) * 0.08 }; r.s += P.lightMod(st, X, Y, Z, 0, 1); return r; }
            const r = P.velvetAt(carpet, X, Y, 0.58, st.L); r.s += P.lightMod(st, X, Y, Z, 0, 1); return r;
          }
          const L = st.L, U = Math.atan2(Y - C, X - C) * RG, sr = P.strataAt(st, U, Z, 1);
          let s = 0.3 + 0.5 * Math.max(0, n[0] * L[0] + n[1] * L[1]) + P.lightMod(st, X, Y, Z, 0, 0);
          if (sr) return { ramp: sr.ramp, s: s + sr.s };
          const dz = DRUM - Z;
          if (dz < 0.08 + 0.18 * P.fbm(U * 3, 0.5, 0, 71)) return { ramp: "moss", s: s + 0.04 - dz * 0.6 };
          return { ramp: "earth", s: s + (P.noise(U * 6, Z * 5, 0, 2) - 0.5) * 0.12 + (P.fbm(U * 0.8, Z * 6, 0, 83) - 0.5) * 0.1 - 0.06 };
        } },
      ],
      glass: { type: "cyl", cx: C, cy: C, R: RG, zb: -1.5, zt: o.glassZt ?? 2.4, dome: true, domeH: o.domeH ?? 7.2 * sc, tint: [200, 232, 210], tintA: 0.04, f0: 0.03, fk: 0.95, sky: 0.2, col: [240, 250, 236], edgePx: 2.2, edgeK: 0.42,
        windows: [{ d: [-0.6, 0.8], w0: 0.86, w1: 0.985, k: 0.8 }, { d: [0.25, 0.97], w0: 0.95, w1: 0.995, k: 0.4 }] },
      hd: { bloom: 0.8, threshold: 0.86, radius: 6, haze: 0.05, fog: [20, 40, 26], vignette: 0.5, beamK: 0.6, beamW: 1.1, motes: 0 },
    }, o, { mats, deco: o.deco.filter(keep(map)), ramps: Object.assign({ sky: FOREST_SKY, fog: ["#1a3020", "#24402a"] }, RICH_MOSS, o.ramps) }));
  };
  // Thick canopy: deep shade, a few large crisp pools broken by leaf holes, rare small flecks.
  const CANOPY = (o) => LIGHT(Object.assign({ shade: 0.48, pool: 0.42, soft: 0.16, leaf: 0.3, leafF: 2.0, leafLo: 0.38, leafHi: 0.5, dapple: 0.8, dappleF: 1.4, dappleK: 0.3, sideK: 1.5, spriteK: 0.9 }, o));

  // Shared temple-garden layout: the Heart Tree on a low knoll, two stepping-stone paths that
  // meet at its foot, a pond at the front left.
  const KOKE = garden({
    paths: [[[13, 8], [9, 8], [9, 7], [7, 7], [7, 6]], [[0, 4], [3, 4], [3, 6], [5, 6]]],
    pond: { x: 4.0, y: 10.2, rx: 2.4, ry: 1.9 },
  });
  const KOKE_UNITS = [["hotaru", { t: 0.1 }, 8, 5], ["puffcap", { t: 0.4 }, 4, 5], ["sprout", { t: 0.6 }, 9, 10], ["piglet", { t: 0.2 }, 11, 8], ["pillbug", { t: 0.5 }, 8, 7]];
  const MOUNDS = [["mound", { seed: 1, sz: 2.0 }, 2, 2], ["mound", { seed: 2, sz: 1.8 }, 10, 3], ["mound", { seed: 4, sz: 1.4 }, 12, 6], ["mound", { seed: 5, sz: 1.6 }, 8, 12], ["mound", { seed: 6, sz: 1.5 }, 1, 8], ["mound", { seed: 7, sz: 1.2 }, 5, 1]];

  // J1 — Koke-dera: a moss temple garden. Moss mounds, stepping stones, a pond with a tsukubai
  // and stone lantern, one red maple as the only warm note.
  jar({
    id: "jar-koke", name: "Koke-dera", jp: "苔寺", map: KOKE,
    deco: [
      ["niwaki", { seed: 11, H: 3.6, girth: 2.1, spread: 1.15, padR: 0.72, n: 8, flat: 0.34 }, 6, 5],
      ["lantern", { t: 0.2 }, 7, 10], ["basin", { sz: 1.1 }, 6, 8], ["niwaki", { seed: 6, H: 1.9, girth: 0.8, spread: 0.6, padR: 0.45, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 10, 11],
      ...MOUNDS, ["rock", { sz: 0.9 }, 9, 4], ["fern", { seed: 3, sz: 1.1 }, 3, 3], ["fern", { seed: 4, sz: 1.0 }, 11, 10],
      ...KOKE_UNITS,
    ],
    light: CANOPY({ beams: [{ x: 8.6, y: 8.4, r: 1.35, len: 16 }, { x: 4.0, y: 10.2, r: 1.1, k: 0.95, len: 16 }, { x: 4.6, y: 3.0, r: 0.8, k: 0.85, len: 16 }, { x: 11.4, y: 5.2, r: 0.7, k: 0.75, len: 16 }] }),
  });

  // J2 — Karesansui: a sea of raked gravel with moss islands, a cloud-pruned pine on a knoll,
  // a great rock in raked rings, stepping stones across the gravel, a moss band at the rim.
  const islands = [[4.4, 4.4, 2.4], [9.8, 9.6, 1.7], [3.4, 10.4, 1.2]];
  const KARE = garden({
    paths: [[[13, 7], [8, 7], [8, 8], [6, 8], [6, 7], [0, 7]]],
    gravel: (x, y) => Math.min(5.4 - Math.hypot(x - C, y - C), ...islands.map(([ix, iy, r]) => Math.hypot(x - ix, y - iy) - r)),
    rings: [{ x: 9.6, y: 4.6, R: 1.6 }, { x: 6.2, y: 11.0, R: 1.1 }],
  });
  jar({
    id: "jar-kare", name: "Karesansui", jp: "枯山水", map: KARE, drumTop: "gravel", ramps: { gravel: ["#cdc8b8", 7, 0.3, 0.9, 0.12, 0.5] },
    deco: [
      ["pine", { seed: 4, sz: 2.2 }, 4, 4], ["rock", { sz: 1.4 }, 9, 4], ["rock", { sz: 0.8 }, 6, 11], ["rock", { sz: 0.9 }, 10, 9], ["niwaki", { seed: 6, H: 1.8, girth: 0.75, spread: 0.55, padR: 0.42, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 9, 10],
      ["mound", { seed: 1, sz: 1.6 }, 3, 5], ["mound", { seed: 2, sz: 1.2 }, 5, 3], ["mound", { seed: 3, sz: 1.3 }, 10, 10], ["mound", { seed: 4, sz: 1.0 }, 3, 10],
      ["hotaru", { t: 0.1 }, 5, 5], ["puffcap", { t: 0.4 }, 3, 3], ["piglet", { t: 0.2 }, 11, 7], ["pillbug", { t: 0.5 }, 7, 8], ["sprout", { t: 0.6 }, 9, 9],
    ],
    light: CANOPY({ beams: [{ x: 9.4, y: 4.8, r: 1.3, len: 16 }, { x: 4.2, y: 3.6, r: 0.9, k: 0.9, len: 16 }, { x: 6.6, y: 9.6, r: 1.1, k: 0.95, len: 16 }] }),
  });

  // J3 — Kodama Grove: the deepest shade. A giant cedar, ferns at every edge, white kodama in the
  // moss, one great shaft of light and a smaller one.
  jar({
    id: "jar-kodama", name: "Kodama Grove", jp: "木霊の森", map: KOKE, amb: 0.2,
    ramps: { sky: ["#010302", "#020704", "#040c07", "#07130b", "#0c1c10", "#132816", "#1d381f", "#2a4a2a"], spirit: ["#e4ecdc", 6, 0.42, 0.98, 0.15, 0.4] },
    mats: { spirit: { bias: 0.12, wrap: 0.8 } },
    bg: forest({ lo: 0.05, k: 0.44, canopy: 0.2, trunks: [[0.04, 0.05, 0.7], [0.18, 0.03, 0.55], [0.32, 0.065, 0.65], [0.68, 0.04, 0.6], [0.82, 0.07, 0.7], [0.96, 0.035, 0.55]], bokeh: [[0.2, 0.06, 0.02, 0.08], [0.86, 0.1, 0.025, 0.08]] }),
    deco: [
      ["niwaki", { seed: 12, H: 4.2, girth: 2.7, spread: 1.3, padR: 0.8, n: 9, flat: 0.36 }, 6, 5],
      ["fern", { seed: 1, sz: 1.9 }, 1, 5], ["fern", { seed: 2, sz: 1.8 }, 3, 2], ["fern", { seed: 3, sz: 1.7 }, 10, 2], ["fern", { seed: 4, sz: 1.9 }, 12, 9], ["fern", { seed: 5, sz: 1.6 }, 9, 12],
      ["fern", { seed: 6, sz: 1.8 }, 1, 8], ["fern", { seed: 7, sz: 1.4 }, 9, 4], ["fern", { seed: 8, sz: 1.7 }, 5, 12],
      ["mound", { seed: 1, sz: 1.8 }, 2, 3], ["mound", { seed: 4, sz: 1.5 }, 11, 11], ["mound", { seed: 5, sz: 1.3 }, 12, 6],
      ["rock", { sz: 1.0 }, 10, 6], ["lantern", { t: 0.2 }, 7, 10],
      ["sprout", { t: 0.1 }, 4, 7], ["sprout", { t: 0.4 }, 8, 3], ["sprout", { t: 0.7 }, 10, 8], ["sprout", { t: 0.25 }, 7, 12], ["sprout", { t: 0.55 }, 2, 6],
      ["hotaru", { t: 0.1 }, 8, 5], ["piglet", { t: 0.2 }, 11, 8], ["pillbug", { t: 0.5 }, 8, 7],
    ],
    light: CANOPY({ shade: 0.56, pool: 0.6, dapple: 0.82, dappleK: 0.34, beams: [{ x: 8.4, y: 8.2, r: 1.45, len: 18 }, { x: 4.0, y: 10.0, r: 0.75, k: 0.8, len: 18 }] }),
    hd: { bloom: 0.85, threshold: 0.84, radius: 6, haze: 0.14, fog: [18, 34, 22], vignette: 0.55, beamK: 0.7, beamW: 1.1, motes: 0 },
  });

  // J4 — Momiji Light: low golden sun, a red maple as the Heart Tree, fallen leaves on the moss.
  jar({
    id: "jar-momiji", name: "Momiji Light", jp: "紅葉の光", map: KOKE, L: [-0.45, 0.36, 0.82],
    ramps: { maple: ["#d4482a", 8, 0.12, 0.78, 0.3], moss: ["#4a8a30", 9, 0.1, 0.86, 0.32, 1.05], sky: ["#040403", "#0b0a05", "#151309", "#201c0d", "#2c2612", "#3c3418", "#4e4222", "#645432"] },
    terrain: Object.assign({}, GARDEN, { m: Object.assign({}, GARDEN.m, { flowers: 0.05, flowerRamp: "maple" }) }),
    bg: forest({ lo: 0.05, k: 0.5, trunks: TRUNKS, bokeh: [[0.12, 0.1, 0.03, 0.16], [0.24, 0.05, 0.02, 0.14], [0.62, 0.06, 0.035, 0.1], [0.9, 0.14, 0.025, 0.16], [0.77, 0.03, 0.018, 0.12]] }),
    deco: [
      ["niwaki", { seed: 3, H: 3.2, girth: 1.7, spread: 1.25, padR: 0.7, n: 10, flat: 0.22, mat: "maple", bumps: 3 }, 6, 5],
      ["lantern", { t: 0.2 }, 7, 10], ["basin", { sz: 1.1 }, 6, 8],
      ...MOUNDS, ["rock", { sz: 0.9 }, 9, 4], ["fern", { seed: 3, sz: 1.1 }, 3, 3],
      ...KOKE_UNITS,
    ],
    light: CANOPY({ shade: 0.44, pool: 0.58, beams: [{ x: 8.6, y: 8.4, r: 1.35, len: 16 }, { x: 4.0, y: 10.2, r: 1.1, k: 0.95, len: 16 }, { x: 11.4, y: 5.2, r: 0.8, k: 0.8, len: 16 }] }),
    hd: { bloom: 0.85, threshold: 0.84, radius: 6, haze: 0.06, fog: [40, 32, 18], vignette: 0.5, beamK: 0.66, beamW: 1.1, beamCol: [255, 212, 146], motes: 0 },
  });

  // ================================================================ round five: Momiji with terraces
  // Elevation is back as whole cube steps. The blockiness is hidden by moss rolling over every lip
  // (drape + rounded shoulders), soft contact shadows at the cliff feet, and cushions and ferns
  // placed along the ledges. The island rim is a curved wall that follows the terraces.
  const DRAPED = {};
  for (const k in GARDEN) DRAPED[k] = Object.assign({}, GARDEN[k], { side: "earth", sideTex: "drape" });
  for (const k of ["m", "t"]) DRAPED[k] = Object.assign({}, DRAPED[k], { flowers: 0.05, flowerRamp: "maple" });
  DRAPED.v = Object.assign({}, DRAPED.t, { fill: "water", flowers: 0 }); // stepping stones across water

  // Moss cushions hanging over the lip of every drop, and ferns at the foot of front-facing cliffs.
  const ledges = (map, o = {}) => {
    const r = P.rng(o.seed || 31), out = [], skip = new Set((o.skip || []).map(([, , x, y]) => x + "," + y));
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      const t = map.typ[y][x];
      if (t === "_" || t === "w" || t === "v" || skip.has(x + "," + y)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nt = map.typ[y + dy] && map.typ[y + dy][x + dx];
        if (!nt || nt === "_" || map.hgt[y + dy][x + dx] >= map.hgt[y][x]) continue;
        const side = (r() - 0.5) * 0.5;
        if (r() < (o.cushions ?? 0.22)) out.push(["mound", { seed: 40 + Math.floor(r() * 60), sz: 0.45 + r() * r() * 0.7, n: 2 + Math.floor(r() * 2) }, x, y, { dx: dx * 0.4 + (dy ? side : 0), dy: dy * 0.4 + (dx ? side : 0) }]);
        if ((dx > 0 || dy > 0) && nt !== "w" && nt !== "v" && !skip.has(x + dx + "," + (y + dy))) {
          // at the foot of a front-facing cliff: a fern, or now and then a mossy boulder set into the face
          const q = r(), at = (k) => ({ dx: -dx * k + (dy ? side : 0), dy: -dy * k + (dx ? side : 0) });
          if (q < (o.rocks ?? 0.09)) out.push(["rock", { sz: 0.7 + r() * 0.5 }, x + dx, y + dy, at(0.36)]);
          else if (q < (o.rocks ?? 0.09) + (o.ferns ?? 0.3)) out.push(["fern", { seed: Math.floor(r() * 60), sz: 0.9 + r() * 0.5 }, x + dx, y + dy, at(0.3)]);
        }
      }
    }
    return out;
  };
  const warp = (x, y, k) => (P.fbm(x * 0.45, y * 0.45, 0, 7) - 0.5) * k;
  const MAPLE = (o) => ["niwaki", Object.assign({ seed: 3, H: 3.2, girth: 1.7, spread: 1.25, padR: 0.7, n: 10, flat: 0.22, mat: "maple", bumps: 3 }, o.t), o.x, o.y];
  const momiji = (o) => {
    const deco = o.deco.concat(ledges(o.map, { seed: o.seed, skip: o.deco }));
    return jar(Object.assign({
      L: [-0.45, 0.36, 0.82], terrain: DRAPED, bevel: 0.16, aoW: 0.34, aoK: 0.34,
      ramps: { maple: ["#d4482a", 8, 0.12, 0.78, 0.3], moss: ["#4a8a30", 9, 0.1, 0.86, 0.32, 1.05], sky: ["#040403", "#0b0a05", "#151309", "#201c0d", "#2c2612", "#3c3418", "#4e4222", "#645432"] },
      bg: forest({ lo: 0.05, k: 0.5, trunks: TRUNKS, bokeh: [[0.12, 0.1, 0.03, 0.16], [0.24, 0.05, 0.02, 0.14], [0.62, 0.06, 0.035, 0.1], [0.9, 0.14, 0.025, 0.16], [0.77, 0.03, 0.018, 0.12]] }),
      hd: { bloom: 0.85, threshold: 0.84, radius: 6, haze: 0.06, fog: [40, 32, 18], vignette: 0.5, beamK: 0.66, beamW: 1.1, beamCol: [255, 212, 146], motes: 0 },
    }, o, { deco, light: CANOPY({ shade: 0.44, pool: 0.5, beams: o.beams }) }));
  };

  // M1 — Terraces: the red maple on a three-step knoll; a spring at the top falls step by step into
  // the pond; the enemy path climbs the terraces from the right.
  const TERR = garden({
    height: (x, y) => 2 + 3 * P.smooth(5.4, 1.3, Math.hypot(x - 6.0, y - 4.8) + warp(x, y, 2.2)) + P.smooth(2.6, 1.2, Math.hypot(x - 10.4, y - 9.8) + warp(x, y, 1.4)),
    water: [{ e: { x: 3.8, y: 10.6, rx: 2.3, ry: 1.7 }, h: 2 }, { seg: [5.3, 6.1, 4.3, 9.4], r: 0.34 }],
    paths: [[[13, 9], [10, 9], [10, 7], [8, 7], [8, 6]]],
  });
  momiji({
    id: "mom-terrace", name: "Momiji Terraces", jp: "紅葉の段", map: TERR, seed: 31,
    deco: [MAPLE({ x: 6, y: 4 }), ["basin", { sz: 1.0 }, 5, 5], ["lantern", { t: 0.2 }, 7, 10],
      ["mound", { seed: 1, sz: 1.5 }, 2, 3], ["mound", { seed: 2, sz: 1.3 }, 11, 4], ["mound", { seed: 5, sz: 1.3 }, 9, 12], ["mound", { seed: 6, sz: 1.2 }, 1, 8],
      ["fern", { seed: 3, sz: 1.1 }, 3, 3], ["fern", { seed: 4, sz: 1.0 }, 11, 10],
      ["hotaru", { t: 0.1 }, 8, 4], ["puffcap", { t: 0.4 }, 3, 6], ["sprout", { t: 0.6 }, 9, 11], ["piglet", { t: 0.2 }, 11, 9], ["pillbug", { t: 0.5 }, 9, 7]],
    beams: [{ x: 8.8, y: 8.6, r: 1.3, len: 16 }, { x: 3.8, y: 10.6, r: 1.1, k: 0.95, len: 16 }, { x: 5.0, y: 7.8, r: 0.7, k: 0.85, len: 16 }, { x: 10.8, y: 5.4, r: 0.8, k: 0.8, len: 16 }],
  });

  // M2 — Ravine: a stream runs through a mossy cut from the back to a pool at the front; stepping
  // stones ford it; the maple stands on the high left bank.
  const RAV = [[11.8, 1.2], [8.6, 5.4], [6.4, 7.6], [3.4, 11.0]];
  const ravD = (x, y) => Math.min(...RAV.slice(1).map(([x1, y1], i) => { const [x0, y0] = RAV[i], vx = x1 - x0, vy = y1 - y0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy))); return Math.hypot(x - x0 - vx * k, y - y0 - vy * k); }));
  const RAVINE = garden({
    // the stream drops one step halfway down; the near bank stays one step up so the cut stays visible
    height: (x, y) => {
      const d = ravD(x, y) + warp(x, y, 0.9), base = 2 + (x - y > 2.5);
      if (d <= 1.0) return base;
      const hum = P.fbm(x * 0.42, y * 0.42, 0, 9) > 0.6; // moss hummocks on the banks
      return x + y > 13.4 ? base + 1 + (hum && d > 2.2) : base + 1 + (d > 2.1) + P.smooth(3.4, 1.2, Math.hypot(x - 3.4, y - 4.2));
    },
    water: RAV.slice(1).map(([x1, y1], i) => ({ seg: [RAV[i][0], RAV[i][1], x1, y1], r: 0.5 })).concat([{ e: { x: 3.2, y: 11.2, rx: 1.7, ry: 1.3 }, h: 2 }]),
    paths: [[[13, 8], [9, 8], [9, 7], [6, 7], [6, 5], [4, 5]]], ford: true,
  });
  momiji({
    id: "mom-ravine", name: "Momiji Ravine", jp: "紅葉の谷", map: RAVINE, seed: 37,
    deco: [MAPLE({ x: 3, y: 4 }), ["lantern", { t: 0.2 }, 10, 10], ["basin", { sz: 1.0 }, 5, 10],
      ["mound", { seed: 1, sz: 1.5 }, 1, 6], ["mound", { seed: 2, sz: 1.3 }, 10, 3], ["mound", { seed: 5, sz: 1.3 }, 11, 11], ["mound", { seed: 6, sz: 1.2 }, 7, 1],
      ["fern", { seed: 3, sz: 1.1 }, 5, 2], ["fern", { seed: 4, sz: 1.0 }, 12, 6],
      ["hotaru", { t: 0.1 }, 5, 4], ["puffcap", { t: 0.4 }, 9, 10], ["sprout", { t: 0.6 }, 2, 8], ["piglet", { t: 0.2 }, 11, 8], ["pillbug", { t: 0.5 }, 7, 7]],
    beams: [{ x: 6.6, y: 7.4, r: 1.2, len: 16 }, { x: 3.2, y: 11.0, r: 1.0, k: 0.95, len: 16 }, { x: 10.6, y: 8.6, r: 1.0, k: 0.85, len: 16 }, { x: 4.0, y: 3.4, r: 0.7, k: 0.75, len: 16 }],
  });

  // M3 — Hilltop: a stepped hill rises to the maple at the centre; a spring falls three steps into the
  // pond below; the path climbs from the right.
  const HILL = garden({
    height: (x, y) => 2 + 4 * P.smooth(5.8, 1.4, Math.hypot(x - 7.0, y - 6.0) + warp(x, y, 1.8)),
    water: [{ e: { x: 3.6, y: 11.0, rx: 2.2, ry: 1.6 }, h: 2 }, { seg: [6.2, 6.9, 4.2, 10.0], r: 0.34 }],
    paths: [[[13, 9], [11, 9], [11, 7], [9, 7], [9, 5], [8, 5]]],
  });
  momiji({
    id: "mom-hill", name: "Momiji Hilltop", jp: "紅葉の丘", map: HILL, seed: 41,
    deco: [MAPLE({ x: 7, y: 5 }), ["basin", { sz: 1.0 }, 6, 6], ["lantern", { t: 0.2 }, 8, 7],
      ["mound", { seed: 1, sz: 1.4 }, 2, 3], ["mound", { seed: 2, sz: 1.3 }, 11, 3], ["mound", { seed: 5, sz: 1.3 }, 9, 12], ["mound", { seed: 6, sz: 1.2 }, 1, 7],
      ["fern", { seed: 3, sz: 1.1 }, 4, 3], ["fern", { seed: 4, sz: 1.0 }, 12, 11],
      ["hotaru", { t: 0.1 }, 9, 4], ["puffcap", { t: 0.4 }, 4, 7], ["sprout", { t: 0.6 }, 9, 11], ["piglet", { t: 0.2 }, 12, 9], ["pillbug", { t: 0.5 }, 10, 7]],
    beams: [{ x: 8.4, y: 7.0, r: 1.0, len: 16 }, { x: 3.6, y: 11.0, r: 1.1, k: 0.95, len: 16 }, { x: 9.8, y: 10.2, r: 1.2, k: 0.9, len: 16 }, { x: 5.0, y: 8.6, r: 0.65, k: 0.85, len: 16 }],
  });
  P.r4 = { garden, jar, CANOPY, GARDEN, DRAPED, ledges, warp, MAPLE, forest, TRUNKS, carpet, tobi };
})();
