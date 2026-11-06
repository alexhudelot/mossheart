/* Five visual directions: palettes (hue-shifted ramps), terrain rules, maps, set dressing. */
(function () {
  const P = window.PX;
  const STY = (window.STYLES = []);

  // ---------------------------------------------------------------- ramps
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function toRgb([h, s, l]) {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  const lerpHue = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };
  // [baseHex, n, darkL, lightL, hueShift, sat] -> shadows lean blue-violet, lights lean warm yellow.
  function makeRamp(spec) {
    if (typeof spec[1] !== "number") return spec.map(P.hex);
    const [hex, n, lo, hi, shift = 0.3, sat = 1] = spec, [h0, s0] = toHsl(P.hex(hex)), out = [];
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1), L = lo + (hi - lo) * u;
      const h = u < 0.5 ? lerpHue(h0, 245, shift * (1 - 2 * u)) : lerpHue(h0, 55, shift * (2 * u - 1));
      const S = Math.min(1, s0 * sat * (1 - 0.3 * Math.pow(Math.abs(2 * u - 1), 2)) + (u < 0.4 ? 0.06 : 0));
      out.push(toRgb([h, S, L]));
    }
    return out;
  }
  const toHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  P.makeRamp = makeRamp; P.toHex = toHex; P.toHsl = toHsl;

  function parseMap(rows, floor = -2, rings = []) {
    const hgt = [], typ = [];
    for (const r of rows) { const t = r.trim().split(/\s+/); hgt.push(t.map((s) => parseInt(s[0], 36))); typ.push(t.map((s) => s[1])); }
    return { W: hgt[0].length, H: hgt.length, hgt, typ, floor, rings };
  }
  const nrm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

  const BASE_RAMPS = {
    ink: ["#1c1511"],
    moss: ["#6b9a3c", 7, 0.1, 0.78, 0.35],
    earth: ["#7a5638", 6, 0.08, 0.58],
    stone: ["#7f8079", 6, 0.1, 0.8],
    dirt: ["#9b7b52", 6, 0.16, 0.74],
    gravel: ["#bdb59f", 5, 0.42, 0.9],
    water: ["#3d8a8f", 6, 0.14, 0.8],
    bark: ["#6b4631", 6, 0.07, 0.58],
    leaf: ["#3e6d3c", 6, 0.07, 0.6],
    leaf2: ["#58923f", 6, 0.1, 0.7],
    pine: ["#3d6449", 6, 0.07, 0.6],
    maple: ["#c8532b", 6, 0.16, 0.72],
    bloom: ["#e98aa7", 4, 0.42, 0.88],
    glow: ["#ffb84a", "#ffd88a", "#fff4cf"],
    wisp: ["#6fffd2", "#d8fff2"],
    lacq: ["#c6402b", 5, 0.14, 0.62],
    spirit: ["#e6ede0", 5, 0.38, 0.97, 0.2],
    void: ["#121812"],
    fur: ["#e9e8df", 5, 0.32, 0.96, 0.25],
    eye: ["#ffc24a", "#fff1b0"],
    stalk: ["#d6c9ae", 5, 0.3, 0.88],
    cap: ["#b4473a", 5, 0.18, 0.66],
    gill: ["#e3caa0", 4, 0.35, 0.8],
    capspot: ["#fff6d6"],
    spore: ["#a8ffe0", "#efffff"],
    hide: ["#5b3b2b", 6, 0.05, 0.48],
    snout: ["#a77666", 4, 0.25, 0.65],
    tusk: ["#efe6cb", 4, 0.5, 0.95],
    curse: ["#0c070b", "#1e1018", "#35182c", "#512040"],
    eyeRed: ["#ff3a28", "#ffb48c"],
    shell: ["#55708f", 6, 0.1, 0.7],
    shellDark: ["#35405a", 4, 0.06, 0.4],
    eyeBlue: ["#46d4ff", "#d8f8ff"],
    mothBody: ["#6a6156", 4, 0.12, 0.55],
    wing: ["#cfc4ab", 5, 0.25, 0.9],
    wingTip: ["#5a4a3a", 4, 0.1, 0.45],
    wingEye: ["#b5482e", 3, 0.25, 0.55],
    cloth: ["#3b4b6b", 5, 0.08, 0.55],
    iron: ["#5b5f68", 5, 0.08, 0.68],
    skin: ["#cf9f80", 4, 0.35, 0.78],
    straw: ["#c8a75f", 5, 0.2, 0.82],
    sash: ["#b8302b", 4, 0.2, 0.6],
    wood: ["#8b6143", 5, 0.15, 0.68],
  };
  const BASE_MATS = {
    leaf: { clump: 9, clumpK: 0.6 }, leaf2: { clump: 12, clumpK: 0.55 }, pine: { clump: 10, clumpK: 0.6 }, maple: { clump: 11, clumpK: 0.6 },
    moss: { clump: 16, clumpK: 0.45 }, glow: { em: 1, flat: 1 }, wisp: { em: 1 }, spore: { em: 1 }, capspot: { em: 1, flat: 1 },
    eye: { em: 1, flat: 1 }, eyeRed: { em: 1, flat: 1 }, eyeBlue: { em: 1, flat: 1 }, fur: { wrap: 0.5 }, spirit: { wrap: 0.6 },
  };
  const BASE_TERRAIN = {
    m: { tex: "clump", top: "moss", side: "earth", drip: "moss", pebble: "stone", roots: "bark", tufts: 3, tuftFlower: 0.12, flowerRamp: "bloom" },
    M: { tex: "clump", top: "moss", side: "stone", sideTex: "stone", drip: "moss", dripK: 1.4 },
    r: { tex: "roots", top: "moss", root: "bark", side: "earth", drip: "moss", roots: "bark", pebble: "stone" },
    p: { tex: "dirt", top: "dirt", side: "earth", pebble: "stone", roots: "bark", base: 0.55 },
    s: { tex: "flag", top: "stone", side: "stone", sideTex: "stone", gap: "moss", base: 0.6 },
    g: { tex: "rake", top: "gravel", side: "stone", sideTex: "stone", base: 0.62, axis: "x" },
    w: { tex: "water", top: "water", side: "earth", base: 0.38 },
    k: { tex: "plank", top: "wood", side: "wood", sideTex: "stone", base: 0.55 },
    f: { tex: "fungus", top: "moss", side: "earth", drip: "moss", pebble: "stone", roots: "bark", glow: "spore" },
  };
  const style = (P.style = (o) => {
    const s = Object.assign({ tw: 32, dither: "band", spriteDither: "band", outline: "selout", innerLine: 0.28, amb: 0.24, scale: 3 }, o);
    s.ramps = Object.assign({}, BASE_RAMPS, o.ramps);
    s.mats = Object.assign({}, BASE_MATS, o.mats);
    s.terrain = {}; for (const k of new Set([...Object.keys(BASE_TERRAIN), ...Object.keys(o.terrain || {})])) s.terrain[k] = Object.assign({}, BASE_TERRAIN[k], (o.terrain || {})[k]);
    s.L = nrm(o.L || [-0.5, 0.85, 0.8]);
    STY.push(s);
    return s;
  });

  // ================================================================ A — Koke Tactics
  style({
    id: "koke", name: "Koke Tactics", jp: "苔の段",
    ramps: { sky: ["#3c4a3e", "#55654f", "#71805f", "#8f9a72", "#aeb38a", "#cbc9a2"], fog: ["#a9b49a", "#c5ccb0"] },
    map: parseMap([
      "8M 8M 8s 8s 8M 7m 7m 6m 6m 6m",
      "8M 8m 8s 8s 8m 7m 6p 6p 6p 6p",
      "7m 7m 7s 7m 7m 6m 6p 5m 5m 5m",
      "7m 6m 6s 6m 6m 5m 5p 5m 4m 4m",
      "6m 6m 5s 5p 5p 5p 5p 4m 4m 3m",
      "5m 5m 5m 4p 4m 4m 4m 3m 3r 3r",
      "4m 4m 4m 4p 3m 3m 3m 3r 2r 2m",
      "2w 2w 3m 3p 3p 2m 2m 2m 2m 1m",
      "2w 2w 2w 2m 2p 2m 1m 1m 1m 1m",
      "2w 2w 2w 2m 1p 1p 1p 1p 1p 1p",
    ]),
    deco: [
      ["cedar", { seed: 1, H: 2.5 }, 0, 0], ["cedar", { seed: 4, H: 2.1 }, 4, 0], ["cedar", { seed: 7, H: 2.3 }, 9, 0],
      ["maple", { seed: 2 }, 7, 2], ["pine", { seed: 3, sz: 0.9 }, 0, 3], ["torii", {}, 2, 2, { flip: true }],
      ["lantern", { wisps: false }, 1, 1], ["lantern", { wisps: false }, 4, 1],
      ["bush", { seed: 5, bloom: "bloom" }, 5, 6], ["bush", { seed: 6 }, 8, 4], ["bush", { seed: 8, bloom: "bloom" }, 1, 5], ["bush", { seed: 9 }, 9, 7],
      ["rock", { sz: 1.1 }, 6, 7], ["rock", { sz: 0.8 }, 3, 8], ["fern", { seed: 2 }, 7, 5], ["fern", { seed: 3 }, 0, 4],
      ["mossling", { t: 0.1 }, 0, 5], ["mossling", { t: 0.6, sz: 0.8 }, 1, 4, { dx: 0.2 }],
      ["lantern", { t: 0.2 }, 5, 3], ["wolf", { t: 0.3 }, 2, 5], ["mushroom", { t: 0.4 }, 7, 6],
      ["boar", { t: 0.25 }, 6, 2, { flip: true }], ["shellback", { t: 0.5 }, 3, 6, { flip: true }], ["ironclad", { t: 0.25 }, 6, 9], ["moth", { t: 0.3 }, 4, 7],
      ["lily", {}, 0, 8], ["lily", {}, 1, 9, { dx: 0.15 }],
    ],
    bg: (u, v) => 0.95 - v * 0.75,
    fx(buf, v, ctx) { ctx.sparks(14, "wisp", 0.25); },
  });

  // ================================================================ B — Karesansui
  style({
    id: "zen", name: "Karesansui", jp: "枯山水",
    dither: "none", spriteDither: "none", amb: 0.34, shadowK: 0.26, L: [-0.4, 0.7, 1.0], innerLine: 0.3,
    ramps: {
      moss: ["#79b043", 6, 0.2, 0.8, 0.35], gravel: ["#cfc8b4", 5, 0.5, 0.93, 0.2], stone: ["#8a8c88", 6, 0.18, 0.85],
      earth: ["#8a6a4c", 5, 0.18, 0.62], water: ["#4e8e98", 6, 0.2, 0.84], pine: ["#46705a", 6, 0.1, 0.62],
      maple: ["#d4542c", 6, 0.2, 0.75], wood: ["#9a6b47", 5, 0.2, 0.7], leaf2: ["#62a046", 5, 0.16, 0.72],
      sky: ["#c4cbbb", "#d3d8ca", "#e0e4d8", "#eceee5", "#f5f6f0"], fog: ["#e3e6db", "#f1f2ea"],
    },
    terrain: { m: { tufts: 0 }, M: { tufts: 0 }, s: { gap: "gravel" } },
    map: parseMap([
      "4k 4k 4k 4k 4k 4k 4k 4k 3M 3M",
      "4k 4k 4k 4k 4k 4k 4k 4k 3m 3m",
      "2g 2g 2g 2g 2g 2g 2s 2g 2g 3m",
      "2g 3m 3m 2g 2g 2g 2s 2g 2g 2g",
      "2g 3m 4M 2g 2g 2g 2s 2s 2s 2g",
      "2g 2g 2g 2g 3m 2g 2g 2g 2s 2g",
      "2g 2g 2g 2g 2g 2g 1w 1w 2s 2g",
      "3m 2g 2g 2s 2s 2s 1w 1w 2s 2g",
      "3m 3m 2g 2s 2g 2s 2s 2s 2s 2g",
      "3m 3m 2g 2s 2g 2g 2g 2g 2g 2g",
    ], -2, [{ x: 2.2, y: 4.0, R: 2.0 }, { x: 4.5, y: 5.5, R: 1.15 }]),
    deco: [
      ["pine", { seed: 3, sz: 1.0 }, 2, 4], ["pine", { seed: 8, sz: 0.8 }, 8, 0], ["maple", { seed: 4 }, 9, 1],
      ["rock", { sz: 1.0 }, 1, 3], ["rock", { sz: 0.75 }, 4, 5], ["rock", { sz: 0.6, moss: false }, 3, 2],
      ["lantern", { wisps: false }, 0, 7], ["lantern", { wisps: false }, 9, 3],
      ["lily", {}, 6, 6], ["lily", {}, 7, 7, { dx: 0.1 }], ["bush", { seed: 5, bloom: "bloom" }, 0, 8], ["bush", { seed: 2 }, 1, 9],
      ["mossling", { t: 0.2 }, 2, 1], ["mossling", { t: 0.7, sz: 0.85 }, 5, 0],
      ["lantern", { t: 0.5 }, 5, 3], ["wolf", { t: 0.1 }, 7, 5], ["mushroom", { t: 0.7 }, 2, 9],
      ["boar", { t: 0.5 }, 6, 3, { flip: true }], ["shellback", { t: 0.2 }, 8, 6, { flip: true }], ["ironclad", { t: 0.6 }, 4, 7], ["moth", { t: 0.6 }, 8, 8],
    ],
    bg: (u, v) => 0.95 - v * 0.6,
    fx(buf, v, ctx) { ctx.sparks(6, "wisp", 0.3); },
  });

  // ================================================================ C — Sea of Spores (HD-2D finish)
  style({
    id: "spore", name: "Sea of Spores", jp: "胞子の海",
    dither: "bayer", spriteDither: "bayer", amb: 0.3, L: [-0.3, 0.6, 0.9], hd: { bloom: 1.15, threshold: 0.8, radius: 2, haze: 0.42, fog: [40, 96, 92], vignette: 0.6 },
    ramps: {
      moss: ["#3f7d6e", 7, 0.06, 0.66, 0.2], earth: ["#3c2f4a", 6, 0.04, 0.42], stone: ["#4a5568", 6, 0.06, 0.55],
      dirt: ["#b9b39a", 5, 0.25, 0.8], water: ["#2fae8f", 6, 0.12, 0.72], leaf2: ["#4a8f7c", 6, 0.08, 0.62],
      stalk: ["#cdbfa6", 5, 0.2, 0.85], cap: ["#7a3f7a", 6, 0.1, 0.62], gill: ["#c7a3b8", 4, 0.3, 0.75],
      spore: ["#59ffc8", "#c8fff0", "#ffffff"], capspot: ["#b8fff0"], bloom: ["#ff9ad0", 4, 0.4, 0.85],
      sky: ["#050b10", "#0a1820", "#10262c", "#173238", "#1f3f40"], fog: ["#2a5550", "#3f706a"],
    },
    terrain: { m: { tex: "fungus", glow: "spore", tufts: 2, tuftFlower: 0.3, flowerRamp: "spore" }, f: { tufts: 2, tuftFlower: 0.25, flowerRamp: "spore" }, w: { base: 0.5 } },
    map: parseMap([
      "6f 6f 5f 5f 6f 6f 7f 7f 6f 6f",
      "6f 5f 5f 4f 5f 6f 6f 6f 5f 5f",
      "5f 5f 4f 4p 4p 4p 5f 5f 5f 4f",
      "5f 4f 4f 4p 3w 3w 4f 4f 4f 4f",
      "4f 4f 4p 4p 3w 3w 3w 4f 3f 3f",
      "4f 3f 3p 3f 3w 3w 3f 3f 3f 3f",
      "3f 3f 3p 3p 3p 3p 3p 3p 2f 2f",
      "3f 2f 2f 2f 2f 2f 2f 2p 2f 2f",
      "2f 2f 2f 1f 1f 2f 2f 2p 2p 2p",
      "2f 2f 1f 1f 1f 1f 2f 2f 1f 1f",
    ]),
    deco: [
      ["mushroomTree", { seed: 1, H: 2.5 }, 0, 0], ["mushroomTree", { seed: 3, H: 2.0 }, 7, 0], ["mushroomTree", { seed: 5, H: 1.6 }, 0, 6],
      ["sporeReeds", { seed: 1 }, 1, 2], ["sporeReeds", { seed: 2 }, 8, 3], ["sporeReeds", { seed: 3 }, 4, 8], ["sporeReeds", { seed: 4 }, 9, 9], ["sporeReeds", { seed: 5 }, 5, 1],
      ["rock", { sz: 1.0 }, 9, 5], ["rock", { sz: 0.7 }, 1, 9], ["fern", { seed: 4 }, 6, 4], ["fern", { seed: 6 }, 3, 1],
      ["mushroom", { t: 0.3 }, 6, 5], ["mushroom", { t: 0.8 }, 1, 7], ["lantern", { t: 0.4 }, 4, 1], ["wolf", { t: 0.5 }, 8, 6],
      ["shellback", { t: 0.3, angry: true, sz: 1.35 }, 3, 4, { flip: true }], ["boar", { t: 0.6 }, 5, 6], ["moth", { t: 0.1 }, 3, 6], ["ironclad", { t: 0.4 }, 7, 7, { flip: true }],
    ],
    bg: (u, v) => 0.15 + v * 0.75,
    fx(buf, v, ctx) { ctx.sparks(60, "spore", 0.0); },
  });

  // ================================================================ D — Cedar Deep
  style({
    id: "cedar", name: "Cedar Deep", jp: "杉の深森",
    dither: "band", spriteDither: "bayer", outline: "none", innerLine: 0.3, amb: 0.2, shadowK: 0.36, L: [-0.55, 0.75, 0.72],
    ramps: {
      moss: ["#4f8a34", 7, 0.05, 0.7, 0.35], leaf: ["#2c5232", 6, 0.04, 0.5], bark: ["#5a3626", 6, 0.05, 0.5],
      earth: ["#4a3424", 6, 0.04, 0.45], stone: ["#6a6f68", 6, 0.07, 0.62], water: ["#3a7c78", 6, 0.1, 0.78],
      leaf2: ["#467a38", 6, 0.06, 0.62], sky: ["#040a06", "#08130b", "#0e1d12", "#152919", "#1d3621"], fog: ["#4f7a5a", "#6e9776", "#97b996"],
    },
    terrain: { m: { tufts: 4, tuftFlower: 0.05 } },
    map: parseMap([
      "9m 9r 9m 8m 8m 8m 9m 9m 8m 8m",
      "9r 8m 8m 7m 7m 7m 8m 8r 7m 7m",
      "8m 8m 7m 6m 6p 6p 6p 7m 7m 6m",
      "7m 7m 6m 6p 6m 5m 6p 6m 6r 6m",
      "6m 6r 6p 6p 5m 5w 5m 6p 5m 5m",
      "6m 5m 5p 5m 4w 4w 4m 5p 5m 4r",
      "5r 5m 4p 4m 4w 3w 4m 4p 4m 4m",
      "4m 4m 4p 4m 3m 3w 3m 4p 3m 3m",
      "4m 3m 3p 3p 3p 3m 3p 3p 3m 2m",
      "3m 3m 2m 2m 2p 2p 2p 2m 2m 2m",
    ], -3),
    deco: [
      ["cedar", { seed: 11, H: 4.8, girth: 2.6, spread: 1.0, start: 0.6, tiers: 5 }, 0, 0], ["cedar", { seed: 12, H: 3.6, girth: 1.6, spread: 0.8 }, 8, 0],
      ["cedar", { seed: 13, H: 3.0, girth: 1.3 }, 0, 4], ["cedar", { seed: 14, H: 2.8, girth: 1.2 }, 9, 5],
      ["rock", { sz: 1.1 }, 4, 3], ["rock", { sz: 0.9 }, 8, 7], ["rock", { sz: 0.8 }, 1, 8],
      ["fern", { seed: 1 }, 2, 1], ["fern", { seed: 2 }, 6, 4], ["fern", { seed: 3 }, 9, 3], ["fern", { seed: 4 }, 3, 7], ["fern", { seed: 5 }, 5, 0],
      ["mossling", { t: 0.0 }, 1, 2], ["mossling", { t: 0.3, sz: 0.8 }, 2, 3], ["mossling", { t: 0.55 }, 7, 3], ["mossling", { t: 0.8, sz: 0.9 }, 3, 5], ["mossling", { t: 0.15 }, 8, 4], ["mossling", { t: 0.65, sz: 0.75 }, 0, 7],
      ["wolf", { t: 0.4 }, 4, 4], ["lantern", { t: 0.1 }, 5, 7], ["mushroom", { t: 0.5 }, 8, 9],
      ["boar", { t: 0.1, sz: 1.3 }, 2, 6, { flip: true }], ["boar", { t: 0.6 }, 5, 2], ["ironclad", { t: 0.75 }, 7, 5, { flip: true }], ["moth", { t: 0.8 }, 5, 8],
    ],
    bg: (u, v) => 0.2 + v * 0.6,
    fx(buf, v, ctx) {
      ctx.sparks(22, "wisp", 0.2);
      P.shafts(buf, { period: 96, width: 24, slope: -0.62, offset: 30, strength: 2 });
      P.mist(buf, ctx.st, (x, y, z, tag) => (tag === 4 ? 0 : 0.34 * P.smooth(0.74, 1.0, y / buf.h)));
    },
  });

  // ================================================================ E — Pocket Shrine (16 px)
  style({
    id: "pocket", name: "Pocket Shrine", jp: "小さな社", tw: 16, scale: 4,
    dither: "none", spriteDither: "none", outline: "ink", innerLine: 0.35, amb: 0.32, L: [-0.5, 0.8, 0.9], lip: 0.2,
    ramps: {
      ink: ["#151020"], moss: ["#5cb43c", 5, 0.2, 0.8, 0.35, 1.15], earth: ["#9a6034", 4, 0.2, 0.62], stone: ["#8a8aa0", 4, 0.25, 0.82],
      water: ["#3a8ae0", 5, 0.25, 0.86], dirt: ["#c99a5a", 4, 0.35, 0.82], leaf: ["#3a8a40", 5, 0.14, 0.62], leaf2: ["#4fae3c", 5, 0.18, 0.7],
      bark: ["#7a4a2a", 4, 0.15, 0.5], pine: ["#2f7a52", 5, 0.14, 0.6], maple: ["#ef5a2a", 5, 0.25, 0.75], hide: ["#6a4030", 4, 0.12, 0.5],
      sky: ["#4da2ea", "#6db6f2", "#8ccaf8", "#b4defc", "#dcf0ff"], fog: ["#ffffff", "#ffffff"],
    },
    terrain: { m: { tufts: 2, tuftFlower: 0.2 }, w: { base: 0.45 } },
    map: parseMap([
      "5m 5m 5m 4m 4m 4m 4m 3m 3m 3m 3m 3m 3m 3m",
      "5m 6m 6m 5m 4m 4m 4p 4p 4p 4p 4p 3m 3m 3m",
      "5m 6m 6m 5m 4m 4p 4p 3m 3m 3m 4p 3m 1w 1w",
      "4m 5m 5m 4m 4m 4p 3m 3m 3M 3m 4p 3m 1w 2m",
      "4m 4m 4m 4m 4p 4p 3m 4s 4s 3m 3p 3m 1w 2m",
      "3m 3m 4m 4m 4p 3m 3m 4s 4s 3m 3p 2m 1w 2m",
      "3m 3m 3m 3m 3p 3m 3m 3m 3m 3m 3p 2m 1w 2m",
      "1w 1w 3m 3m 3p 3p 3p 3p 3p 3p 3p 1w 1w 2m",
      "2m 1w 1w 2m 3m 3m 3m 2m 2m 2m 2m 1w 2m 2m",
      "2m 2m 1w 1w 2m 2m 2m 2m 1m 1m 1w 1w 2m 1m",
      "1m 2m 2m 1w 1w 1w 1w 1w 1w 1w 1w 1m 1m 1m",
      "1m 1m 2m 2m 2m 2m 1m 1m 1m 1m 1m 1m 1m 1m",
      "1m 1m 1m 2m 2m 1m 1m 1m 1m 0m 0m 1m 1m 0m",
      "1m 1m 1m 1m 1m 1m 1m 0m 0m 0m 0m 0m 0m 0m",
    ]),
    deco: [
      ["cedar", { seed: 1, H: 2.2 }, 1, 1], ["cedar", { seed: 2, H: 1.9 }, 2, 0], ["cedar", { seed: 3, H: 2.0 }, 0, 3], ["cedar", { seed: 5, H: 2.1 }, 12, 0],
      ["maple", { seed: 1 }, 9, 9], ["maple", { seed: 2 }, 3, 12], ["pine", { seed: 4 }, 13, 4], ["pine", { seed: 6, sz: 0.8 }, 0, 9],
      ["torii", {}, 8, 6, { flip: true }], ["lantern", { wisps: false }, 7, 4], ["lantern", { wisps: false }, 8, 5],
      ["bush", { seed: 1, bloom: "bloom" }, 6, 3], ["bush", { seed: 2 }, 11, 3], ["bush", { seed: 3, bloom: "bloom" }, 2, 8], ["bush", { seed: 4 }, 12, 12],
      ["rock", { sz: 1 }, 8, 3], ["rock", { sz: 0.8 }, 5, 11], ["lily", {}, 12, 5],
      ["lantern", { t: 0.3 }, 5, 5], ["wolf", { t: 0.2 }, 9, 6], ["mushroom", { t: 0.6 }, 3, 6], ["lantern", { t: 0.7 }, 11, 6],
      ["boar", { t: 0.2 }, 8, 1], ["shellback", { t: 0.5 }, 10, 5, { flip: true }], ["ironclad", { t: 0.3 }, 6, 7], ["moth", { t: 0.4 }, 4, 3], ["boar", { t: 0.7 }, 4, 6, { flip: true }],
      ["mossling", { t: 0.4 }, 1, 2], ["mossling", { t: 0.9 }, 7, 5],
    ],
    bg: (u, v, x, y) => 0.25 + v * 0.7 + (P.fbm(x / 40, y / 14, 0, 3) > 0.62 ? 0.5 : 0),
    fx(buf, v, ctx) { ctx.sparks(4, "wisp", 0.3); },
  });
})();
