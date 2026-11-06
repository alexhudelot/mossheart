/* Round two: cozy Cedar Deep variants (same diorama, five moods, chibi roster), two non-pixel
   renders of the same scene, and five themed tilesets built on the same engine. */
(function () {
  const P = window.PX, MOD = window.MODELS, STY = window.STYLES, parseMap = (rows, floor = -2) => {
    const hgt = [], typ = [];
    for (const r of rows) { const t = r.trim().split(/\s+/); hgt.push(t.map((s) => parseInt(s[0], 36))); typ.push(t.map((s) => s[1])); }
    return { W: hgt[0].length, H: hgt.length, hgt, typ, floor, rings: [] };
  };

  const EXTRA = {
    paper: ["#f6d58e", 5, 0.42, 0.92, 0.25], paperRib: ["#c9955a", 3, 0.3, 0.62], paperOld: ["#d9cfae", 5, 0.3, 0.88, 0.2], paperTorn: ["#5a4a3a", 2, 0.12, 0.3],
    eyeHi: ["#fffdf2"], eyeWhite: ["#f3eedc", 3, 0.62, 0.95], blush: ["#f39a9a", "#ffbcb0"],
    fluff: ["#efe3c8", 5, 0.4, 0.95, 0.25], wing2: ["#c9b0e0", 5, 0.4, 0.9, 0.25], firefly: ["#d8ff6a", "#f8ffd0"],
    metal: ["#7d8a96", 6, 0.12, 0.82, 0.25], metalDark: ["#3d4652", 5, 0.06, 0.45], cyan: ["#3be8ff", "#bff8ff", "#ffffff"],
    deadBark: ["#5c5560", 6, 0.06, 0.6, 0.2], bib: ["#c42b2b", 4, 0.2, 0.6], candle: ["#ffb347", "#ffe8a8", "#fffbe8"], onibi: ["#58d8ff", "#d6f6ff"],
    darkWood: ["#4b3324", 5, 0.05, 0.4], roofDark: ["#2e2c33", 4, 0.05, 0.35], tongue: ["#d84a5a", 4, 0.25, 0.65],
    ghost: ["#dfe6ee", 5, 0.45, 0.97, 0.2], ghostDark: ["#8a92a8", 3, 0.3, 0.6], hair: ["#14121a", 3, 0.03, 0.18], lilyRed: ["#e8332a", "#ff7a5c"], moon: ["#c2302a", "#e8603a", "#ffa070"],
    castle: ["#a39e93", 6, 0.15, 0.85], castleDark: ["#5e5a54", 3, 0.12, 0.4], roofBlue: ["#3a5fb0", 5, 0.15, 0.65], arcane: ["#c77dff", "#ecd2ff", "#ffffff"],
    crystal: ["#8f6ae0", 6, 0.15, 0.85, 0.2], crystalEm: ["#b98cff", "#e9d6ff", "#ffffff"], slime: ["#59c94a", 5, 0.18, 0.82, 0.3], skinG: ["#7caa4a", 5, 0.15, 0.7],
    leather: ["#7a5236", 4, 0.15, 0.55], banner: ["#2f62c0", 4, 0.2, 0.62], banner2: ["#b8302b", 4, 0.2, 0.6], gold: ["#e0b040", 4, 0.3, 0.85],
    vendBody: ["#d8dde4", 5, 0.25, 0.92], vendGlass: ["#2a3a5a", 3, 0.1, 0.35], neonPink: ["#ff3fa4", "#ff9ad4", "#fff0f8"], neonCyan: ["#28e0ff", "#a8f4ff", "#f0ffff"], neonAmber: ["#ffb02e", "#ffe08a", "#fff6d8"], winAmber: ["#b86a24", "#f0a040"], winPink: ["#a8286c", "#f0509e"], winCyan: ["#1a7aa0", "#40c8f0"],
    concrete: ["#5c6070", 6, 0.06, 0.62], asphalt: ["#262a34", 5, 0.04, 0.32], rust: ["#9a4e2a", 4, 0.15, 0.55], rain: ["#5a7090", "#8fa6c4", "#c4d4ea"],
    snow: ["#e8f0f8", 5, 0.55, 0.98, 0.25], sand: ["#e2b878", 6, 0.3, 0.9, 0.3], sandstone: ["#c47a4a", 6, 0.12, 0.74, 0.3], sail: ["#efe3c8", 4, 0.45, 0.95],
    wormHide: ["#9a7a5a", 5, 0.12, 0.7], wormDark: ["#5a4636", 4, 0.06, 0.45], beetleShell: ["#3a6a8a", 5, 0.06, 0.6], beetleDark: ["#2a2a36", 4, 0.04, 0.3],
    bone: ["#e6dcc0", 5, 0.35, 0.95], leafDry: ["#6e8e3a", 5, 0.1, 0.62], cloth2: ["#d8c8a0", 4, 0.3, 0.85],
    hydra: ["#7a8cf0", 4, 0.35, 0.85], hydra2: ["#c08ae0", 4, 0.35, 0.85], gingko: ["#e6b42e", 5, 0.3, 0.85],
  };
  const XMATS = {
    paper: { wrap: 0.85, bias: 0.12 }, paperOld: { wrap: 0.6 }, fluff: { clump: 22, clumpK: 0.45, wrap: 0.5 }, cyan: { em: 1 }, candle: { em: 1, flat: 1 }, onibi: { em: 1 },
    arcane: { em: 1 }, crystalEm: { em: 1 }, neonPink: { em: 1 }, neonCyan: { em: 1 }, neonAmber: { em: 1 }, winAmber: { em: 1 }, winPink: { em: 1 }, winCyan: { em: 1 }, firefly: { em: 1 }, moon: { em: 1 },
    crystal: { wrap: 0.5, rim: 0.8 }, slime: { wrap: 0.6, rim: 0.7 }, beetleShell: { rim: 0.9 }, ghost: { wrap: 0.8, bias: 0.1 }, metal: { rim: 0.3 },
    snow: { wrap: 0.5 }, leafDry: { clump: 10, clumpK: 0.55 }, hydra: { clump: 18, clumpK: 0.5 }, hydra2: { clump: 18, clumpK: 0.5 }, gingko: { clump: 11, clumpK: 0.6 },
  };
  const mk = (o) => P.style(Object.assign({}, o, { ramps: Object.assign({}, EXTRA, o.ramps), mats: Object.assign({}, XMATS, o.mats) }));

  // ================================================================ cozy Cedar Deep variants
  const cedar = STY.find((s) => s.id === "cedar");
  const CUTE = { lantern: "hotaru", wolf: "pup", mushroom: "puffcap", mossling: "sprout", boar: "piglet", shellback: "pillbug", moth: "fluffmoth", ironclad: "ashigaru" };
  const cutify = (deco) => deco.map(([n, o, x, y, ex]) => (CUTE[n] ? [CUTE[n], { t: o.t }, x, y, ex] : [n, o, x, y, ex]));
  const cozyDeco = cutify(cedar.deco);
  const swap = (deco, x, y, entry) => deco.map((d) => (d[2] === x && d[3] === y ? entry : d));
  const cozy = (o) => mk(Object.assign({
    tw: 32, dither: "band", spriteDither: "band", outline: "soft", innerLine: 0.3, amb: 0.26, shadowK: 0.3, L: [-0.55, 0.75, 0.8],
    map: cedar.map, roster: MOD.cute, kit: ["m", "r", "M", "p", "w"], kitBase: "m", bg: (u, v) => 0.2 + v * 0.7,
  }, o));

  const SUN = {
    moss: ["#64a83c", 7, 0.1, 0.8, 0.35], leaf: ["#376b3a", 6, 0.06, 0.58], leaf2: ["#5c9a40", 6, 0.1, 0.72], bark: ["#6e4a32", 6, 0.07, 0.58],
    earth: ["#5e4330", 6, 0.06, 0.52], stone: ["#7c847a", 6, 0.12, 0.78], water: ["#4aa6a2", 6, 0.14, 0.86], dirt: ["#b08a5a", 6, 0.2, 0.8],
    sky: ["#1e3a22", "#2e5530", "#467042", "#6a9054", "#9ab86c", "#d0dc92"], fog: ["#e0ecb8", "#f4f8dc"],
  };
  const sunDeco = [...cozyDeco,
    ["bush", { seed: 5, bloom: "bloom" }, 3, 0], ["bush", { seed: 6, bloom: "bloom" }, 6, 6], ["bush", { seed: 7 }, 9, 8], ["hotaru", { t: 0.4, wisps: false, k: 1.4 }, 6, 1],
    ["fern", { seed: 7 }, 0, 9], ["puffcap", { t: 0.2 }, 4, 9],
  ];
  const sunFx = (sc) => function (buf, v, ctx) {
    P.shafts(buf, { period: 110 * sc, width: 34 * sc, slope: -0.62, offset: 30 * sc, strength: 2 });
    if (sc > 1) ctx.blobs(26, "glow", 2.2 * sc / 3, 1); else ctx.sparks(26, "glow", 1);
  };

  cozy({ id: "cozy-sun", name: "Komorebi", jp: "木漏れ日", ramps: SUN, terrain: { m: { tufts: 4, tuftFlower: 0.18 } }, deco: sunDeco, fx: sunFx(1) });

  cozy({
    id: "cozy-dusk", name: "Hotaru Dusk", jp: "蛍の宵", L: [-0.3, 0.6, 0.9], amb: 0.3,
    ramps: {
      moss: ["#3c6e52", 7, 0.04, 0.6, 0.4], leaf: ["#1f3c3c", 6, 0.03, 0.45], leaf2: ["#2e5a4a", 6, 0.05, 0.55], bark: ["#3e2c38", 6, 0.04, 0.42],
      earth: ["#33263c", 6, 0.03, 0.4], stone: ["#525a70", 6, 0.06, 0.55], water: ["#2e5a8c", 6, 0.08, 0.7], dirt: ["#6a5a6a", 6, 0.1, 0.6],
      sky: ["#0c0e22", "#161a36", "#262650", "#40305e", "#6c4470", "#b46a82"], fog: ["#4a3e6a", "#6a5a8a"],
    },
    mats: { paper: { em: 1 } },
    terrain: { m: { tufts: 3, tuftFlower: 0.06 } },
    deco: [...cozyDeco, ["hotaru", { t: 0.1, wisps: false, k: 1.4 }, 3, 2], ["hotaru", { t: 0.5, wisps: false, k: 1.4 }, 6, 6], ["hotaru", { t: 0.7, wisps: false, k: 1.4 }, 7, 8], ["hotaru", { t: 0.3, wisps: false, k: 1.4 }, 4, 9]],
    hd: { bloom: 1.1, threshold: 0.85, radius: 2, haze: 0.2, fog: [60, 50, 100], vignette: 0.55 },
    fx(buf, v, ctx) { ctx.sparks(55, "firefly", 1); P.mist(buf, ctx.st, (x, y, z, tag) => (tag === 4 ? 0 : 0.28 * P.smooth(0.78, 1.0, y / buf.h))); },
  });

  cozy({
    id: "cozy-rain", name: "Tsuyu Rain", jp: "梅雨", L: [-0.4, 0.6, 1.0], amb: 0.36, shadowK: 0.16,
    ramps: {
      moss: ["#4f8c5a", 7, 0.06, 0.7, 0.3], leaf: ["#2a4e40", 6, 0.05, 0.5], leaf2: ["#4a7a52", 6, 0.08, 0.62], stone: ["#6a7484", 6, 0.08, 0.68], bark: ["#4e3a34", 6, 0.05, 0.48],
      earth: ["#40363a", 6, 0.05, 0.45], water: ["#5a8ca4", 6, 0.12, 0.82], dirt: ["#8a7a68", 6, 0.15, 0.7],
      sky: ["#2a3442", "#364252", "#465464", "#586878", "#6e7e8c", "#8a98a4"], fog: ["#8c9cac", "#aab8c4"],
    },
    deco: [...cozyDeco, ["bush", { seed: 5, bloom: "hydra" }, 3, 0], ["bush", { seed: 6, bloom: "hydra2" }, 6, 1], ["bush", { seed: 7, bloom: "hydra" }, 6, 6], ["bush", { seed: 8, bloom: "hydra2" }, 9, 8], ["bush", { seed: 9, bloom: "hydra" }, 0, 9], ["puffcap", { t: 0.6 }, 4, 9]],
    fx(buf, v, ctx) {
      P.streaks(buf, ctx.st, { n: 420, ramp: "rain", len: 6, slope: -0.3, seed: 5 });
      P.mist(buf, ctx.st, (x, y, z, tag) => (tag === 4 ? 0 : 0.18 + 0.2 * P.smooth(0.7, 1.0, y / buf.h)));
    },
  });

  let autumnDeco = swap(cozyDeco, 0, 4, ["maple", { seed: 5, sz: 1.4 }, 0, 4]);
  autumnDeco = swap(autumnDeco, 9, 5, ["maple", { seed: 6, sz: 1.3, mat: "gingko" }, 9, 5]);
  cozy({
    id: "cozy-autumn", name: "Momiji", jp: "紅葉", L: [-0.7, 0.6, 0.55],
    ramps: {
      moss: ["#a08c3c", 7, 0.08, 0.76, 0.35], leaf: ["#2e4a30", 6, 0.05, 0.5], maple: ["#d8542a", 6, 0.18, 0.75], leaf2: ["#b0882e", 6, 0.1, 0.7],
      bark: ["#5e3a28", 6, 0.06, 0.52], earth: ["#5a3a26", 6, 0.06, 0.5], water: ["#4a8a90", 6, 0.12, 0.8], dirt: ["#b08050", 6, 0.2, 0.78],
      sky: ["#2a1810", "#4a2818", "#7a4224", "#b46a32", "#e6a04c", "#f6d88e"], fog: ["#f0c890", "#fae0b0"],
    },
    terrain: { m: { flowers: 0.12, flowerRamp: "maple", tufts: 3, tuftFlower: 0.3 }, r: { flowers: 0.1, flowerRamp: "maple" } },
    deco: [...autumnDeco, ["maple", { seed: 7, sz: 0.9 }, 3, 0], ["maple", { seed: 8, sz: 0.8, mat: "gingko" }, 6, 6], ["bush", { seed: 4, mat: "maple" }, 9, 8]],
    fx(buf, v, ctx) {
      P.shafts(buf, { period: 120, width: 30, slope: -0.4, offset: 10, strength: 1 });
      P.streaks(buf, ctx.st, { n: 60, ramp: "maple", len: 2, slope: 1, seed: 9 });
      P.streaks(buf, ctx.st, { n: 30, ramp: "gingko", len: 2, slope: -1, seed: 11 });
    },
  });

  cozy({
    id: "cozy-snow", name: "Hatsuyuki", jp: "初雪", L: [-0.45, 0.7, 0.8], amb: 0.34, snowCap: 0.55,
    ramps: {
      moss: ["#4a7a52", 7, 0.05, 0.6, 0.3], leaf: ["#24443a", 6, 0.04, 0.48], leaf2: ["#3a6248", 6, 0.06, 0.55], stone: ["#6a7484", 6, 0.08, 0.66],
      earth: ["#3a3036", 6, 0.04, 0.42], water: ["#3a6c8c", 6, 0.1, 0.72], dirt: ["#6a5a50", 6, 0.1, 0.62], bark: ["#4a3430", 6, 0.05, 0.48],
      sky: ["#0e1626", "#182436", "#24344c", "#344864", "#4e6684", "#7a92ae"], fog: ["#c4d4e6", "#e6eef8"],
    },
    mats: { paper: { em: 1 } },
    terrain: { m: { top: "snow", drip: "snow", tufts: 0 }, r: { top: "snow", drip: "snow" }, M: { top: "snow", drip: "snow" } },
    deco: [...cozyDeco, ["hotaru", { t: 0.2, wisps: false, k: 1.4 }, 3, 2], ["hotaru", { t: 0.6, wisps: false, k: 1.4 }, 7, 8]],
    fx(buf, v, ctx) {
      P.streaks(buf, ctx.st, { n: 260, ramp: "snow", len: 1, seed: 7 });
      P.streaks(buf, ctx.st, { n: 60, ramp: "snow", len: 2, slope: 0, seed: 8 });
      P.mist(buf, ctx.st, (x, y, z, tag) => (tag === 4 ? 0 : 0.25 * P.smooth(0.8, 1.0, y / buf.h)));
    },
  });

  // ================================================================ the same cozy scene without pixels
  // Smooth ramps: every ramp regenerated with k times the tones (lists interpolated in RGB).
  function fine(ramps, k) {
    const out = {};
    for (const n in ramps) {
      const s = ramps[n];
      if (typeof s[1] === "number") { out[n] = [s[0], Math.max(2, Math.round(s[1] * k)), ...s.slice(2)]; continue; }
      if (s.length < 2) { out[n] = s; continue; }
      const cols = s.map(P.hex), N = Math.round((s.length - 1) * k) + 1, list = [];
      for (let i = 0; i < N; i++) { const f = (i / (N - 1)) * (cols.length - 1), j = Math.min(cols.length - 2, Math.floor(f)), u = f - j; list.push(P.toHex(cols[j].map((c, ch) => Math.round(c + (cols[j + 1][ch] - c) * u)))); }
      out[n] = list;
    }
    return out;
  }
  // Cel: every ramp cut down to a few flat bands.
  function cel(ramps) {
    const out = {};
    for (const n in ramps) { const s = ramps[n]; out[n] = typeof s[1] === "number" ? [s[0], Math.max(3, Math.round(s[1] / 2)), s[2] + 0.06, s[3], ...s.slice(4)] : s; }
    return out;
  }
  const baseRamps = Object.assign({}, cedar.ramps, EXTRA, SUN);
  P.r2 = { mk, fine, baseRamps, cedar };

  mk({
    id: "cozy-hd", name: "Komorebi HD", jp: "木漏れ日 · 高解像", tw: 96, scale: 1, map: cedar.map, roster: MOD.cute, kit: ["m", "r", "M", "p", "w"], kitBase: "m",
    dither: "none", spriteDither: "none", bgDither: "bayer", outline: "none", innerLine: 0, amb: 0.28, shadowK: 0.3, L: [-0.55, 0.75, 0.8], cubeSeams: false,
    ramps: fine(baseRamps, 4), terrain: { m: { tufts: 5, tuftFlower: 0.18, tuftH: 2.5 } }, deco: sunDeco, bg: (u, v) => 0.2 + v * 0.7,
    hd: { bloom: 0.9, threshold: 0.82, radius: 6, haze: 0.28, fog: [215, 230, 175], vignette: 0.35 }, hdScale: 1,
    fx(buf, v, ctx) {
      P.shafts(buf, { period: 330, width: 100, slope: -0.62, offset: 90, strength: 4 });
      ctx.blobs(30, "glow", 2.4, 1);
    },
  });

  mk({
    id: "cozy-vector", name: "Komorebi Vector", jp: "木漏れ日 · ベクター", tw: 96, scale: 1, map: cedar.map, roster: MOD.cute, kit: ["m", "r", "M", "p", "w"], kitBase: "m",
    dither: "none", spriteDither: "none", bgDither: "none", outline: "ink", outlineW: 3, edgeInk: 2.5, innerLine: 0.3, amb: 0.3, shadowK: 0.34, L: [-0.55, 0.75, 0.8], cubeSeams: false,
    ramps: Object.assign(cel(baseRamps), { ink: ["#1f2a1c"], sky: ["#e6ebc8", "#eef1d8"] }),
    terrain: { m: { tufts: 0, pebble: "earth", roots: null }, r: { tufts: 0, pebble: "earth", roots: null }, p: { pebble: "earth", roots: null }, M: { pebble: "earth" } }, deco: sunDeco, bg: (u, v) => 0.1 + v * 0.9,
    fx(buf, v, ctx) { ctx.blobs(20, "glow", 2.6, 1); },
  });

  // ================================================================ themes
  const theme = (o) => mk(Object.assign({ tw: 32, dither: "band", spriteDither: "band", outline: "selout", innerLine: 0.3, amb: 0.28, roster: MOD.themeRosters[o.id] }, o));
  const clouds = (lo, k) => (u, v, x, y) => lo + v * k + (P.fbm(x / 50, y / 16, 0, 3) > 0.6 ? 0.55 : 0);

  theme({
    id: "scifi", name: "Sky Ruin", jp: "天空の遺跡", L: [-0.5, 0.8, 0.9],
    ramps: {
      moss: ["#5aa04a", 7, 0.08, 0.78, 0.35], leaf2: ["#4f8f3f", 6, 0.08, 0.68], stone: ["#7a8290", 6, 0.1, 0.78], earth: ["#5a5a66", 6, 0.06, 0.5],
      water: ["#3aa6c8", 6, 0.14, 0.86], sky: ["#3e7ec8", "#5c9ad8", "#82b6e6", "#aed0f0", "#d8eaf8", "#f4faff"], fog: ["#ffffff", "#ffffff"],
    },
    terrain: {
      n: { tex: "panel", top: "metal", side: "metal", sideTex: "stone", rowH: 0.5, drip: "moss", dripK: 0.8, overgrow: 0.32, lines: "cyan", lineP: 0.16, base: 0.55, cracks: 0.012 },
      p: { tex: "panel", top: "metalDark", side: "metal", sideTex: "stone", rowH: 0.5, lines: "cyan", lineP: 0.5, lineAxis: "y", rivets: false, base: 0.62 },
      m: { side: "metal", sideTex: "stone", rowH: 0.5, tufts: 3, tuftFlower: 0.1 },
      w: { side: "metal", sideTex: "stone", rowH: 0.5 },
    },
    map: parseMap([
      "7n 7n 7n 6m 6m 5m 5m 5m 4m 4m",
      "7n 7n 7n 6m 6p 6p 6p 5m 4m 4m",
      "7n 7n 7p 6p 6p 5m 6p 5m 4m 3m",
      "6m 6m 6p 6m 5m 5m 5p 4m 3m 3m",
      "5m 5m 5p 5m 5n 5n 5p 4m 3w 3w",
      "5m 4m 4p 4m 5n 5n 4p 4m 3w 3w",
      "4m 4m 4p 4p 4p 4p 4p 3m 3m 3m",
      "3m 3m 3m 3m 3m 4n 4n 3m 2m 2m",
      "3m 2m 2m 2m 3m 4n 4n 3m 2m 2m",
      "2m 2m 2m 2m 2m 3m 3m 2m 2m 1m",
    ], -2),
    deco: [
      ["golem", {}, 1, 1], ["dish", {}, 0, 0], ["pod", {}, 8, 1], ["pipe", {}, 5, 8], ["maple", { seed: 3, mat: "leaf2" }, 3, 0], ["pine", { seed: 4 }, 9, 0],
      ["bush", { seed: 2, bloom: "bloom" }, 0, 3], ["bush", { seed: 3 }, 7, 3], ["bush", { seed: 4 }, 1, 8], ["fern", { seed: 2 }, 8, 6], ["rock", { sz: 0.9 }, 9, 7], ["lily", {}, 8, 5],
      ["pylon", { t: 0.2 }, 5, 5], ["beamTurret", { t: 0.3 }, 3, 3], ["pylon", { t: 0.7 }, 7, 7], ["beamTurret", { t: 0.8 }, 4, 5],
      ["crawler", { t: 0.2 }, 2, 4, { flip: true }], ["crawler", { t: 0.6 }, 5, 6], ["drone", { t: 0.4 }, 6, 2], ["drone", { t: 0.9 }, 3, 6],
    ],
    kit: ["n", "p", "m", "w"], kitBase: "n", bg: clouds(0.2, 0.6),
    fx(buf, v, ctx) { ctx.sparks(10, "cyan", 1); },
  });

  theme({
    id: "horror", name: "Hollow Moon", jp: "朧月", outline: "none", spriteDither: "bayer", L: [-0.6, 0.5, 0.75], amb: 0.22, shadowK: 0.4,
    ramps: {
      moss: ["#4e5c4a", 7, 0.03, 0.52, 0.25], earth: ["#2c2230", 6, 0.03, 0.38], stone: ["#5c5a68", 6, 0.05, 0.56], dirt: ["#4e403c", 6, 0.06, 0.5],
      water: ["#2e3a40", 6, 0.04, 0.5], leaf2: ["#3a4a3a", 6, 0.04, 0.5], lacq: ["#7a2a24", 5, 0.08, 0.45],
      sky: ["#07050b", "#100b16", "#1a1222", "#26182c", "#341e34", "#4a2638"], fog: ["#3c3448", "#5c5268"],
    },
    terrain: { m: { tufts: 3, tuftFlower: 0.3, flowerRamp: "lilyRed" }, r: { flowers: 0.05, flowerRamp: "lilyRed" } },
    map: parseMap([
      "6m 6m 6r 5m 5m 5s 5s 5m 4m 4m",
      "6m 5m 5m 5m 5s 5s 5s 4m 4m 4r",
      "5r 5m 4m 4p 4p 4s 4m 4m 3m 3m",
      "5m 4m 4p 4p 4m 4m 4m 3m 3m 3m",
      "4m 4m 4p 3m 3m 3w 3w 3m 3r 2m",
      "4r 3m 3p 3m 3w 3w 3w 3m 2m 2m",
      "3m 3m 3p 3p 3p 3m 3m 2p 2p 2m",
      "3m 2m 2m 2m 3p 3p 2p 2p 2m 2m",
      "2m 2m 2r 2m 2m 2m 2m 2m 1m 1m",
      "2m 1m 1m 1m 1m 2m 1m 1m 1m 1m",
    ], -3),
    deco: [
      ["deadTree", { seed: 21, H: 2.2 }, 0, 0], ["deadTree", { seed: 22, H: 1.8 }, 9, 1], ["deadTree", { seed: 23, H: 1.6 }, 0, 5], ["deadTree", { seed: 24, H: 1.5 }, 8, 8],
      ["torii", {}, 5, 2, { flip: true }], ["hokora", { wisps: false }, 6, 0], ["lantern", { wisps: false }, 4, 0],
      ["grave", { tilt: 0.1 }, 1, 2], ["grave", { tilt: -0.15 }, 2, 0], ["grave", { tilt: 0.2 }, 8, 3], ["grave", {}, 9, 5], ["grave", { tilt: -0.1 }, 1, 8], ["grave", { tilt: 0.25 }, 3, 9],
      ["jizo", { wisps: false, k: 1.5 }, 7, 2], ["jizo", { wisps: false, k: 1.4 }, 8, 2, { dx: 0.15 }],
      ["jizo", { t: 0.3 }, 4, 3], ["hokora", { t: 0.6 }, 6, 3], ["jizo", { t: 0.7 }, 1, 6],
      ["chochin", { t: 0.2 }, 2, 4], ["chochin", { t: 0.65 }, 5, 6, { flip: true }], ["wraith", { t: 0.3 }, 3, 6], ["wraith", { t: 0.8 }, 7, 6, { flip: true }],
    ],
    kit: ["m", "r", "s", "p", "w"], bg: (u, v) => 0.05 + v * 0.95,
    hd: { bloom: 1.0, threshold: 0.86, radius: 2, haze: 0.32, fog: [50, 40, 62], vignette: 0.85 },
    fx(buf, v, ctx) {
      P.disc(buf, ctx.st, buf.w * 0.8, buf.h * 0.13, 20, "moon", 1.9);
      ctx.sparks(18, "onibi", 1);
      P.mist(buf, ctx.st, (x, y, z, tag) => (tag === 4 ? 0 : 0.1 + 0.4 * P.smooth(0.6, 1.0, y / buf.h)));
    },
  });

  theme({
    id: "fantasy", name: "Crystal Keep", jp: "水晶城", amb: 0.32, L: [-0.5, 0.8, 0.9],
    ramps: {
      moss: ["#5cb848", 7, 0.12, 0.82, 0.35], leaf2: ["#4aa040", 6, 0.1, 0.72], stone: ["#8c8c94", 6, 0.12, 0.82], earth: ["#7a5a3e", 6, 0.08, 0.55],
      water: ["#3aa0d8", 6, 0.16, 0.88], dirt: ["#b8925e", 6, 0.22, 0.82],
      sky: ["#3a7ad8", "#5a98e8", "#86b8f0", "#b8d8f8", "#e8f4ff", "#ffffff"], fog: ["#ffffff", "#ffffff"],
    },
    terrain: {
      k: { tex: "flag", top: "castle", side: "castle", sideTex: "stone", gap: "castleDark", base: 0.62, scale: 3, drip: "moss", dripK: 0.6 },
      s: { gap: "moss" }, m: { tufts: 3, tuftFlower: 0.2 },
    },
    map: parseMap([
      "7k 7k 7k 7k 5m 5m 5m 4m 4m 4m",
      "7k 6s 6s 7k 5m 5p 5p 5p 4m 4m",
      "7k 6s 6s 6s 6s 5s 4m 5p 4m 3m",
      "7k 7k 6s 7k 5m 4m 4m 4p 3m 3m",
      "5m 5m 5s 5m 4m 4m 3w 3w 3p 3m",
      "4m 4m 4s 4m 4m 3w 3w 3w 3p 3m",
      "4m 3m 3p 3p 3p 3m 3w 3m 3p 2m",
      "3m 3m 3m 3m 3p 3p 3p 3p 3p 2m",
      "3m 2m 2m 3m 3m 2m 2m 2m 2m 2m",
      "2m 2m 2m 2m 2m 2m 1m 1m 1m 1m",
    ], -3),
    deco: [
      ["spire", { t: 0.1 }, 0, 0], ["spire", { t: 0.5 }, 3, 0], ["banner", {}, 0, 3], ["banner", { mat: "banner2" }, 3, 3], ["arch", {}, 2, 4, { flip: true }], ["arch", { broken: true }, 4, 2],
      ["crystals", { seed: 31 }, 8, 0], ["crystals", { seed: 32, sz: 0.8 }, 9, 2], ["crystals", { seed: 33, sz: 1.2 }, 0, 7], ["crystals", { seed: 34, sz: 0.7 }, 5, 4],
      ["maple", { seed: 1, mat: "leaf2" }, 4, 0], ["maple", { seed: 2, mat: "leaf2", sz: 1.1 }, 9, 6], ["maple", { seed: 4, mat: "leaf2" }, 1, 9],
      ["bush", { seed: 2, bloom: "bloom" }, 7, 0], ["bush", { seed: 3, bloom: "bloom" }, 4, 5], ["rock", { sz: 1 }, 8, 8], ["lily", {}, 6, 5],
      ["ballista", { t: 0.2 }, 1, 1], ["spire", { t: 0.7 }, 6, 2], ["ballista", { t: 0.6 }, 9, 4],
      ["slime", { t: 0.1 }, 7, 1], ["slime", { t: 0.55 }, 3, 6], ["goblin", { t: 0.3 }, 4, 7, { flip: true }], ["goblin", { t: 0.75 }, 8, 4],
    ],
    kit: ["m", "s", "k", "p", "w"], bg: clouds(0.15, 0.6),
    fx(buf, v, ctx) { ctx.sparks(12, "arcane", 1); },
  });

  const win = { side: "concrete", sideTex: "windows", win: "winAmber", win2: "winPink", glass: "vendGlass", lit: 0.2, cols: 2, rowH: 0.34 };
  theme({
    id: "cyber", name: "Neon Moss", jp: "ネオン苔", outline: "none", L: [-0.3, 0.5, 0.9], amb: 0.3, shadowK: 0.25,
    ramps: {
      moss: ["#3a8a5c", 7, 0.04, 0.62, 0.3], leaf2: ["#3a7a50", 6, 0.04, 0.55], pine: ["#2f6a52", 6, 0.04, 0.5], water: ["#1c2a4e", 6, 0.06, 0.62],
      stone: ["#5a5e6c", 6, 0.06, 0.6], sky: ["#05040c", "#0c0a1c", "#17112e", "#24163e", "#3a1a4c", "#5a2058"], fog: ["#3a2a5e", "#5a3a80"],
    },
    terrain: {
      c: Object.assign({ tex: "panel", top: "concrete", overgrow: 0.16, puddle: 0.2, puddleRamp: "water", cracks: 0.01, drip: "moss", dripK: 0.6, scale: 2.5, base: 0.5 }, win),
      n: Object.assign({ tex: "panel", top: "asphalt", seams: false, lines: "neonAmber", lineP: 1, lineW: 0.04, scale: 1, puddle: 0.28, puddleRamp: "water", base: 0.5 }, win, { win: "winCyan" }),
      v: Object.assign({ tex: "panel", top: "asphalt", seams: false, lines: "neonAmber", lineP: 1, lineW: 0.04, lineAxis: "y", scale: 1, puddle: 0.28, puddleRamp: "water", base: 0.5 }, win, { win: "winCyan" }),
      m: Object.assign({ tufts: 2, tuftFlower: 0.1, drip: "moss" }, win, { win2: "winCyan" }),
      w: Object.assign({}, win),
    },
    map: parseMap([
      "9c 9c 9m 8c 8c 3v 3v 8c 7c 7m",
      "9c 9c 9c 8c 7c 3v 3v 7c 7c 7c",
      "8m 8c 7c 7c 6c 3v 3v 6c 6c 6c",
      "3n 3n 3n 3n 3n 3n 3n 3n 3n 3n",
      "3n 3n 3n 3n 3n 3n 3n 3n 3n 3n",
      "6c 6c 5m 5c 4c 3v 3v 5c 5c 6c",
      "5c 5c 5c 4c 4c 3v 3v 4c 5c 5c",
      "5m 4c 4c 4c 4m 3v 3v 4c 4c 4m",
      "4c 4c 3c 3c 4c 3v 3v 3w 4c 4c",
      "3c 3c 3c 3c 3c 3v 3v 3c 3c 3c",
    ], -2),
    deco: [
      ["tank", {}, 1, 0], ["acUnit", {}, 0, 1], ["acUnit", {}, 8, 0], ["tank", {}, 8, 1], ["dish", {}, 9, 2], ["pine", { seed: 5, sz: 0.8 }, 2, 0], ["bush", { seed: 2 }, 0, 2],
      ["sign", {}, 4, 2], ["sign", { neon: "neonCyan", neon2: "neonPink" }, 7, 5], ["sign", { neon: "neonAmber", neon2: "neonCyan" }, 2, 5], ["vending", {}, 3, 2], ["vending", { neon: "neonPink" }, 0, 6],
      ["bush", { seed: 4, bloom: "bloom" }, 4, 7], ["bush", { seed: 5 }, 9, 7], ["acUnit", {}, 8, 6], ["pine", { seed: 6, sz: 0.7 }, 0, 7],
      ["neonTurret", { t: 0.0 }, 4, 6], ["jammer", { t: 0.4 }, 7, 6], ["neonTurret", { t: 0.5 }, 3, 8],
      ["hound", { t: 0.2 }, 2, 3], ["hound", { t: 0.7 }, 8, 4, { flip: true }], ["drone", { t: 0.3, light: "neonPink" }, 5, 4], ["drone", { t: 0.8, light: "neonPink" }, 6, 7],
    ],
    kit: ["c", "n", "m", "w"], kitBase: "c", bg: (u, v) => 0.05 + v * 0.95,
    hd: { bloom: 1.1, threshold: 0.88, radius: 2, haze: 0.3, fog: [40, 20, 70], vignette: 0.6 },
    fx(buf, v, ctx) { P.streaks(buf, ctx.st, { n: 240, ramp: "rain", len: 4, slope: -0.2, seed: 4, lv: 1 }); },
  });

  theme({
    id: "desert", name: "Wind Valley", jp: "風の谷", L: [-0.6, 0.7, 0.9], amb: 0.3, shadowK: 0.38,
    ramps: {
      moss: ["#8e9a48", 6, 0.15, 0.72, 0.35], dirt: ["#c49a64", 6, 0.25, 0.82], water: ["#3ab0b8", 6, 0.18, 0.86], earth: ["#9a5a38", 6, 0.1, 0.6],
      leaf2: ["#7a9040", 6, 0.12, 0.66], bark: ["#6a4a34", 6, 0.07, 0.56],
      sky: ["#3c84cc", "#5c9cd8", "#84b8e4", "#b0d0ec", "#dce6e8", "#f4e8cc"], fog: ["#f2e2c2", "#faf2e2"],
    },
    terrain: {
      d: { tex: "rake", top: "sand", side: "sandstone", pebble: "sandstone", base: 0.6, axis: "x", wave: 2.2, freq: 3 },
      M: { tex: "rake", top: "sandstone", side: "sandstone", sideTex: "stone", rowH: 0.18, base: 0.62, axis: "y", wave: 3, freq: 2.2, drip: null },
      m: { side: "sandstone", pebble: "sandstone", tufts: 2, tuftFlower: 0.05, drip: null },
      p: { side: "sandstone" }, w: { side: "sandstone" },
    },
    map: parseMap([
      "7M 7M 6M 5d 5d 5d 5d 6M 6M 6M",
      "7M 6M 5d 5d 4d 4d 5d 5d 6M 6M",
      "6M 5d 4d 4p 4p 4p 4d 4d 5d 5M",
      "5d 4d 4p 4m 3m 3m 4p 4d 4d 4d",
      "4d 4d 4p 3m 3w 3w 3m 4p 4d 4d",
      "4d 3d 3p 3m 3w 3w 3m 3p 3d 3d",
      "3d 3d 3p 3m 3m 3m 3m 3p 3d 2d",
      "3d 2d 2d 2p 2p 2p 2p 2p 2d 2d",
      "2d 2d 2d 2d 2d 2d 2d 2p 2d 1d",
      "2d 1d 1d 1d 1d 1d 1d 1p 1d 1d",
    ], -3),
    deco: [
      ["windmill", { t: 0.1 }, 1, 1], ["windmill", { t: 0.5 }, 8, 1], ["ribcage", {}, 8, 5], ["acacia", { seed: 41 }, 3, 3], ["acacia", { seed: 42 }, 6, 6], ["tent", {}, 0, 3], ["tent", {}, 9, 3],
      ["sandRock", { sz: 1.1 }, 9, 8], ["sandRock", { sz: 0.8 }, 0, 7], ["bush", { seed: 3, mat: "leaf2" }, 6, 4], ["bush", { seed: 4, mat: "leaf2" }, 3, 5], ["lily", {}, 4, 4], ["lily", {}, 5, 5],
      ["windmill", { t: 0.3 }, 2, 1], ["ballista", { t: 0.2, base: "sandstone" }, 7, 3], ["ballista", { t: 0.7, base: "sandstone" }, 1, 4],
      ["sandworm", { t: 0.2 }, 1, 6], ["sandworm", { t: 0.6 }, 8, 8, { flip: true }], ["beetle", { t: 0.3 }, 3, 7], ["beetle", { t: 0.75 }, 6, 7, { flip: true }],
    ],
    kit: ["d", "M", "m", "p", "w"], kitBase: "d", bg: (u, v) => 0.1 + v * 0.85,
    fx(buf, v, ctx) { ctx.sparks(8, "sail", 1); },
  });
})();
