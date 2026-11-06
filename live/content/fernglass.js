/* Fernglass, Mossheart's second garden (docs/decisions/2026-10-22-showcase-level.md): a round Victorian
   fernery under the bell jar. Its flagstone walks are grown with moss and its glass bays have lost half
   their panes. A fountain spills down a spout in two falls into a lily pond, and an iron
   footbridge crosses it to the Heart Tree's island in its middle. This file holds the level's part of the
   Mossheart content pack:
     ME.content.kinds       flagstone (a brick kerb facing moss, standing puddles), gravel, pottingsand, wall,
                            fernbed, fernwater (the fountain's and the pond's water), pond (the pond's sand and
                            gravel floor)
     window.MODELS          stamps fg_bay (one glass bay, turned and flipped into eight places), fg_grate (the
                            boiler house the creatures come out of), fg_fountain, fg_bridge (o.span), fg_shed,
                            fg_pondstones (moss cushions and pebbles on the pond's floor), fg_rocks (the
                            island's); volumes fg_pot (o.plant: fern, geranium or agave; a pot can shatter),
                            fg_orange (an orange tree in a Versailles tub, swaying), fg_lantern (hung from a bay's front beam), and the pond's
                            plants fg_eelgrass, fg_frond (o.type: hornwort or cabomba) and fg_lily (pads on the
                            surface, o.flower), which sway with the water
     ME.content.critterExtra.fernglass, ME.content.padTop   the pond's minnow school; the pads a frog sits on
     ME.content.maps.fernglass      the v1 map (plain data), with game: { route, spawn, heart, lane, build,
                                    bridges }
     ME.content.mapLight.fernglass  its light, { L, light }, to put over the style's: a low late sun and
                                    beams on the walks
   The ramps reach the palette through ME.content.addMaterials (critter-models.js, ME.content.ramps). The
   map is generated once from rings round the middle (an octagon metric) and written out as rows, so its
   rows can be edited by hand. game.route is the walkers' centre line, one tile of each 2-tile walk. */
(function () {
  const ME = window.ME, P = window.PX, { S, E, C, B, Y } = P.prim, M = window.MODELS, CT = (ME.content = ME.content || {}), TAU = Math.PI * 2;
  const rz = (a) => P.rot("z", a), ry = (a) => P.rot("y", a), mul = P.rotMul;
  const nz3 = (x, y, z, k, s) => P.noise(x * k, y * k, z * k, s);

  // ---------------------------------------------------------------- materials
  CT.ramps = Object.assign(CT.ramps || {}, {
    flag: ["#9a9384", 8, 0.18, 0.84, 0.12], puddle: ["#4c5c68", 6, 0.12, 0.6, 0.1], limestone: ["#c8c0ac", 7, 0.3, 0.92, 0.1],
    brick: ["#4a2620", "#5c2e24", "#6e3828", "#80432e", "#924e36", "#a35c42", "#b26b52", "#c07c64"], mortar: ["#8e887e", 4, 0.3, 0.8, 0.1],
    iron: ["#2f3a36", 5, 0.06, 0.42, 0.15], glassPane: ["#bfe0dc", 5, 0.55, 0.96, 0.1], glassMoss: ["#8fb89a", 5, 0.4, 0.86, 0.15],
    vineLeaf: ["#4f8a3a", 7, 0.14, 0.66, 0.3], fernLeaf: ["#5a9a3e", 7, 0.14, 0.7, 0.3], geranLeaf: ["#4a7a34", 6, 0.12, 0.6, 0.3], agave: ["#6a9a8a", 6, 0.2, 0.75, 0.2],
    geranRed: ["#a8202a", "#c02a30", "#d83c3c", "#e85a50", "#f07a68"], terracotta: ["#5a2c1c", "#6e3622", "#82412a", "#964d32", "#a95b3c", "#b86b4a", "#c67d5c", "#d29070"],
    orangeLeaf: ["#2f6a2e", 7, 0.1, 0.6, 0.3], orangeLeafLt: ["#4f8a3a", 6, 0.2, 0.72, 0.3], orangeFruit: ["#a8401a", "#c4521e", "#dc6a22", "#ec8430", "#f49e44", "#f8b860"],
    tubGreen: ["#3e6a5a", 6, 0.14, 0.62, 0.2], foam: ["#d8eef0", 4, 0.7, 0.98, 0.05], shedWood: ["#6a8a8c", 6, 0.18, 0.7, 0.15], shedWoodDk: ["#4a6466", 5, 0.12, 0.5, 0.15],
    slate: ["#4a4c54", 5, 0.12, 0.5, 0.15], plank: ["#7a6248", 6, 0.16, 0.62, 0.2], sacking: ["#a08a64", 5, 0.25, 0.75, 0.15], peat: ["#3e3024", 6, 0.08, 0.4, 0.2],
    soot: ["#1e1a18", 3, 0.04, 0.2, 0],
    // the pond: a pale floor of sand and gravel so the bottom reads through clear water (explicit lists, dark to
    // light, so no shade hue-shifts), and its plants
    pondSand: ["#6a6252", "#7f7664", "#948a76", "#a89e88", "#bab19b", "#cac2ad", "#d8d1be", "#e4dfcf"],
    pondGravel: ["#4c5050", "#5c6160", "#6d7270", "#7f8381", "#909492", "#a2a5a2", "#b3b5b2", "#c3c5c1"],
    pondPebble: ["#4e463c", "#615849", "#756a58", "#897d69", "#9c907b", "#ada28e", "#bdb3a0"],
    eelgrass: ["#9eb040", 6, 0.24, 0.9, 0.08], eelgrassDk: ["#56682a", 5, 0.1, 0.52, 0.2], eelgrassLt: ["#c4d064", 5, 0.3, 0.92, 0.15],
    hornwort: ["#2e5c2c", 6, 0.12, 0.6, 0.25], cabomba: ["#58a048", 6, 0.18, 0.8, 0.25],
    lilyPad: ["#3f8434", 6, 0.15, 0.72, 0.25], lilyRim: ["#7a4434", 4, 0.15, 0.55, 0.1], lilyStem: ["#5e6e38", 4, 0.12, 0.55, 0.1],
    lilyPetal: ["#d89cae", "#e8b4c4", "#f2cad6", "#f8dee6", "#fcf0f4"], lilyHeart: ["#e0a428", 4, 0.3, 0.88, 0.1],
    lampGlow: ["#f0a040", "#f4b858", "#f8cc78", "#fce0a0"], ember: ["#c84018", "#e06020", "#f08830", "#f8b050"],
  });
  CT.mats = Object.assign(CT.mats || {}, {
    glassPane: { bias: 0.25 }, glassMoss: { bias: 0.1 }, foam: { bias: 0.3 }, puddle: { bias: 0.1 }, lampGlow: { em: 1, flat: 1 }, ember: { em: 1, flat: 1 },
    vineLeaf: { wrap: 0.6 }, fernLeaf: { wrap: 0.6 }, orangeLeaf: { wrap: 0.6 }, orangeLeafLt: { wrap: 0.6 },
    eelgrass: { wrap: 0.7 }, eelgrassDk: { wrap: 0.6 }, eelgrassLt: { wrap: 0.7 }, hornwort: { wrap: 0.6 }, cabomba: { wrap: 0.7 }, lilyPad: { wrap: 0.4 }, lilyPetal: { wrap: 0.6 },
  });
  Object.assign(CT.materialClass = CT.materialClass || {}, {
    flag: "ROCK", brick: "ROCK", limestone: "ROCK", puddle: "WATER", peat: "MOSS",
    vineLeaf: "FOLIAGE", fernLeaf: "FOLIAGE", geranLeaf: "FOLIAGE", agave: "FOLIAGE", orangeLeaf: "FOLIAGE", orangeLeafLt: "FOLIAGE", plank: "BARK", tubGreen: "BARK",
    pondGravel: "ROCK", pondPebble: "ROCK", eelgrass: "FOLIAGE", eelgrassDk: "FOLIAGE", eelgrassLt: "FOLIAGE", hornwort: "FOLIAGE", cabomba: "FOLIAGE",
    lilyPad: "FOLIAGE", lilyRim: "FOLIAGE", lilyStem: "FOLIAGE", lilyPetal: "FOLIAGE",
  });
  CT.sunShadeHalf = (CT.sunShadeHalf || []).concat(["vineLeaf", "orangeLeaf", "orangeLeafLt"]);

  // ---------------------------------------------------------------- kinds
  // the walks: flagstones with a brick kerb where they meet the beds and puddles standing in them; gravel
  // with set flags; potting sand spilled from the shed
  const flagstone = { recipe: "layer", top: "flag", mottle: "puddle", mottleK: 0.1, depth: 0.15, under: "rock", edge: { mat: "brick", width: 0.12, raise: 0.07, facing: ["moss", "fernbed"] } };
  Object.assign(CT.kinds = CT.kinds || {}, {
    flagstone,
    gravel: { recipe: "lane", top: "gravel", stones: "flag", edge: "moss", drape: ["moss", "moss2"], overhang: "moss", under: "rock" },
    pottingsand: { recipe: "layer", top: "sand", mottle: "sand2", mottleK: 0.2, depth: 0.3, under: "rock" },
    // the low wall: brick under a mossy limestone coping
    wall: { recipe: "layer", top: "limestone", mottle: "moss", mottleK: 0.3, depth: 0.1, under: "brick" },
    // the fern beds along the west wall: darker moss over peat; build tiles like the moss (game.build), so
    // the bigger pond costs the garden none
    fernbed: { recipe: "carpet", top: "moss2", mottle: "peat", cushions: true, drape: ["moss", "moss2"], overhang: "moss", under: "rock", grass: true },
    // Fernglass's water: the shared water with its surface at the tile top (the default sits 1.5 voxels down,
    // which in narrow channels reads as a trickle at the bottom of a ditch: the user's "water level low"). The
    // map's flood names it too (flood[i].water), so the fountain and the pond share one look (ME.waterLook): a
    // still lake, crystal clear (clarity 0-1 of the floor seen) with a blue deep tint (linear rgb) that a tile
    // and a half of water along the view takes to 63% (absorb), calm ripples, a bright sun glint and caustics
    // on the sand. Its bubbles: rate per emitter per minute (the pond's plants, ME.content.particles.bubbles,
    // and the falls' feet), seep per wet tile per minute from the floor, size in voxels, colour linear rgb,
    // rise in tiles/s.
    fernwater: Object.assign({}, CT.kinds.water, {
      surface: 0, clarity: 0.9, tint: [0.03, 0.2, 0.34], absorb: 1.5, calm: 0.8, glint: 1.4, caustics: 1.4,
      bubbles: { rate: 4, seep: 0.5, size: [1, 2], colour: [0.76, 0.89, 0.94], rise: 0.22 },
    }),
    // the pond's floor round the Heart Tree's island, under the map's flood (water at 0.95, held by the walk
    // and the beds round it): pale sand mottled with gravel and no land grass, so the bottom reads through the water and the
    // underwater plants stand on it; its own kind, so that it is not a build tile
    pond: { recipe: "layer", top: "pondSand", mottle: "pondGravel", mottleK: 0.3, depth: 0.2, under: "rock" },
  });
  // soft tile edges at vs 24 and up (bake-terrain.js): stone stays crisp beside the soft turf; layers would get
  // the sand banks' 0.15 (Art, #238)
  CT.edgeRound = Object.assign(CT.edgeRound || {}, { kinds: Object.assign((CT.edgeRound && CT.edgeRound.kinds) || {}, { flagstone: 0.05, wall: 0.05 }) });
  // edge breakup (momiji.js's edgeBreak, Art): the walls are laid masonry and keep straight lines; the fern
  // beds sprawl like the moss; the pond floor under the flood only wavers (the walks are lane kinds: straight)
  if (CT.edgeBreak) CT.edgeBreak.kinds = Object.assign(CT.edgeBreak.kinds || {}, { wall: 0, fernbed: 0.15, pond: 0.05 });

  // ---------------------------------------------------------------- models
  // Model conventions are the generator's: tile units, the anchor at the ground centre, Z up. A stamp's
  // source joins the bake cache key: ME.ASSET_BY by name (a bake keys only the models its map reads), and
  // ME.ASSET_SRC (all of them).
  const model = (name, fn) => { M[name] = fn; (ME.ASSET_BY = ME.ASSET_BY || {})[name] = name + String(fn); ME.ASSET_SRC = (ME.ASSET_SRC || "") + ME.ASSET_BY[name]; };
  // brick courses and mortar on a face (u: the run along the face)
  const bricks = (u, z) => { const row = Math.floor(z * 11); return (z * 11) % 1 < 0.16 || ((u * 5.5 + row * 0.5) % 1 + 1) % 1 < 0.08; };

  // The glass bay: a lean-to of iron ribs on the low wall, its front posts reaching down to the bed, a
  // cresting along the ridge and vine leaves over the ribs; o.seed picks which panes are gone and which
  // have greened. It faces 22.5° outward (u, the bay's own axis), so a quarter turn and a flip set it in
  // each of the octagon's eight places. Anchored on the wall's top.
  const BAY_A = Math.PI / 8, ca = Math.cos(BAY_A), sa = Math.sin(BAY_A), RB = rz(BAY_A);
  const bw = (u, v, z) => [u * ca - v * sa, u * sa + v * ca, z]; // the bay's frame (u out, v along the wall) to the model's
  model("fg_bay", (o = {}) => {
    const p = [], h = (i, s) => P.hash(o.seed || 1, i, 0, s), FU = -0.85, BU = 0.35, FZ = 0.9, BZ = 1.35, VS = [-1, -0.5, 0, 0.5, 1];
    const phi = Math.atan2(BZ - FZ, BU - FU), RR = mul(ry(-phi), RB), L = Math.hypot(BU - FU, BZ - FZ);
    p.push(B(bw(FU, 0, -0.42), [0.09, 1.08, 0.09], 0.01, "brick", { R: RB })); // the front's brick sill, down on the bed
    for (const v of VS) {
      p.push(C(bw(FU, v, -0.75), bw(FU, v, FZ), 0.05, 0.045, "iron"), C(bw(FU, v, FZ), bw(BU, v, BZ), 0.045, 0.045, "iron"), C(bw(BU, v, -0.05), bw(BU, v, BZ), 0.045, 0.045, "iron"));
      p.push(C(bw(FU, v, 0.6), bw(FU + 0.3, v, FZ + 0.1), 0.03, 0.03, "iron")); // the bracket under the eave
    }
    for (const [u, z] of [[FU, FZ], [BU, BZ], [FU, 0.18]]) p.push(C(bw(u, -1.05, z), bw(u, 1.05, z), 0.04, 0.04, "iron"));
    for (let v = -1; v <= 1.001; v += 0.25) p.push(S(bw(BU, v, BZ + 0.09), v === -1 || v > 0.99 ? 0.055 : 0.035, "iron")); // cresting
    // the panes: front (two bands) and roof (two bands) between the ribs; about half are gone
    for (let i = 0; i < 4; i++) {
      const vc = -0.75 + 0.5 * i;
      [[-0.34, 0.18], [0.18, FZ]].forEach(([z0, z1], j) => {
        if (h(i * 4 + j, 3) < 0.5) return;
        p.push(B(bw(FU, vc, (z0 + z1) / 2), [0.025, 0.22, (z1 - z0) / 2 - 0.03], 0, h(i * 4 + j, 5) < 0.3 ? "glassMoss" : "glassPane", { R: RB }));
      });
      [0.25, 0.75].forEach((t, j) => {
        if (h(i * 4 + 2 + j, 3) < 0.5) return;
        p.push(B(bw(FU + (BU - FU) * t, vc, FZ + (BZ - FZ) * t), [L / 4 - 0.03, 0.22, 0.025], 0, h(i * 4 + 2 + j, 5) < 0.3 ? "glassMoss" : "glassPane", { R: RR }));
      });
    }
    // vine leaves along the ridge, over the roof ribs and trailing down two front posts
    for (let i = 0; i < 26; i++) {
      const t = h(i, 11), v = -1 + 2 * h(i, 12), q = i < 16 ? bw(FU + (BU - FU) * (0.6 + 0.4 * t), v, FZ + (BZ - FZ) * (0.6 + 0.4 * t) + 0.05) : bw(FU - 0.04, VS[1 + (i % 3)], FZ - (i - 16) * 0.09);
      p.push(E(q, [0.075, 0.05, 0.025], "vineLeaf", { R: rz(TAU * h(i, 13)) }));
    }
    return { prims: p, r: 1.0, h: 1.0, k: 1 };
  });

  // The boiler house in the north wall: a brick housing with a limestone coping, an arched opening with a
  // sooty firebox and embers, its iron grate swung open, a brass plate and a chimney. Faces +x (rot 1 puts
  // it facing the garden at the top of the map). Anchored on the gravel at the rim's height.
  model("fg_grate", () => {
    const p = [B([-0.35, 0, 0.75], [0.38, 1.3, 0.75], 0.02, "brick"), B([-0.35, 0, 1.53], [0.42, 1.35, 0.04], 0.01, "limestone")];
    p.push(B([0, 0, 0.35], [0.5, 0.55, 0.4], 0, "brick", { sub: true }), Y([0, 0, 0.72], 0.55, 0.5, "brick", { sub: true, R: ry(Math.PI / 2) }));
    p.push(B([-0.52, 0, 0.6], [0.02, 0.54, 0.62], 0, "soot"));
    for (const [y, r] of [[-0.25, 0.06], [0.05, 0.08], [0.28, 0.05]]) p.push(E([-0.44, y, 0.05], [r, r * 1.3, 0.04], "ember"));
    const dir = [Math.sin(1.2), -Math.cos(1.2)], at = (d, z) => [0.03 + dir[0] * d, 0.55 + dir[1] * d, z];
    for (let d = 0.1; d < 0.95; d += 0.13) p.push(C(at(d, 0.02), at(d, 0.92), 0.022, 0.022, "iron"), S(at(d, 0.97), 0.03, "iron"));
    for (const z of [0.15, 0.82]) p.push(C(at(0, z), at(0.92, z), 0.025, 0.025, "iron"));
    p.push(B([0.04, 0, 1.38], [0.012, 0.22, 0.06], 0, "brass"));
    p.push(B([-0.45, 0.85, 1.95], [0.17, 0.17, 0.45], 0.01, "brick"), B([-0.45, 0.85, 2.42], [0.21, 0.21, 0.04], 0, "limestone"), Y([-0.45, 0.85, 2.54], 0.08, 0.09, "terracotta"));
    return {
      prims: p, r: 1.0, h: 1.8, k: 1,
      detail: (x, y, z, m, nx, ny) => (m === "brick" && bricks(Math.abs(nx) > Math.abs(ny) ? y : x, z) ? "mortar" : m),
    };
  });

  // The fountain in its basin: a limestone kerb, a pedestal, two bowls brimming with foam, a pineapple
  // finial and the streams falling from bowl to bowl and into the basin. Anchored at the basin's middle.
  model("fg_fountain", () => {
    const p = [Y([0, 0, -0.18], 0.98, 0.25, "limestone", { round: 0.02 }), Y([0, 0, -0.08], 0.86, 0.3, "limestone", { sub: true })];
    p.push(Y([0, 0, -0.1], 0.1, 0.4, "limestone"), E([0, 0, 0.32], [0.42, 0.42, 0.12], "limestone"), E([0, 0, 0.39], [0.36, 0.36, 0.1], "limestone", { sub: true }), E([0, 0, 0.35], [0.35, 0.35, 0.03], "foam"));
    p.push(Y([0, 0, 0.55], 0.05, 0.2, "limestone"), E([0, 0, 0.75], [0.2, 0.2, 0.07], "limestone"), E([0, 0, 0.8], [0.16, 0.16, 0.05], "limestone", { sub: true }), E([0, 0, 0.78], [0.16, 0.16, 0.02], "foam"));
    p.push(E([0, 0, 0.92], [0.05, 0.05, 0.08], "limestone"));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; p.push(C([0, 0, 0.97], [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 1.06], 0.015, 0.008, "limestone")); }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6 + 1 / 12) * TAU, c = Math.cos(a), s = Math.sin(a);
      p.push(C([c * 0.2, s * 0.2, 0.78], [c * 0.29, s * 0.29, 0.4], 0.02, 0.02, "foam"), C([c * 0.42, s * 0.42, 0.34], [c * 0.52, s * 0.52, 0.0], 0.022, 0.025, "foam"));
    }
    return { prims: p, r: 1.0, h: 1.0, k: 1 };
  });

  // The iron footbridge: a low arch of planks two tiles wide (the whole walk crosses on it) on three
  // cast-iron girders, balusters with a lattice, a handrail and newel posts with ball finials. o.span is
  // its half length (1.45: over the spout's one tile of water; the island's, over two, is longer and rises
  // a little higher). Spans x (rot 1 spans y). Anchored mid-span at the walk's height (at.dz).
  model("fg_bridge", (o = {}) => {
    const p = [], X0 = o.span || 1.45, A = 0.42 * Math.sqrt(X0 / 1.45), zf = (x) => A * (1 - (x / X0) ** 2), N = Math.round((10 * X0) / 1.45), YW = 0.94;
    for (let i = 0; i < N; i++) {
      const x0 = -X0 + (i * 2 * X0) / N, x1 = x0 + (2 * X0) / N, xm = (x0 + x1) / 2, ph = Math.atan2(zf(x1) - zf(x0), x1 - x0);
      p.push(B([xm, 0, zf(xm) + 0.02], [X0 / N + 0.005, YW - 0.04, 0.03], 0.004, "plank", { R: ry(-ph) }));
      p.push(C([x0, 0, zf(x0) - 0.06], [x1, 0, zf(x1) - 0.06], 0.035, 0.035, "iron")); // the middle girder
      for (const y of [-YW, YW]) {
        p.push(C([x0, y, zf(x0) - 0.06], [x1, y, zf(x1) - 0.06], 0.035, 0.035, "iron"), C([x0, y, zf(x0) + 0.42], [x1, y, zf(x1) + 0.42], 0.025, 0.025, "iron"));
        p.push(C([x0, y, zf(x0)], [x0, y, zf(x0) + 0.42], 0.018, 0.018, "iron"));
        p.push(C([x0, y, zf(x0) + 0.04], [x1, y, zf(x1) + 0.38], 0.012, 0.012, "iron"), C([x1, y, zf(x1) + 0.04], [x0, y, zf(x0) + 0.38], 0.012, 0.012, "iron"));
      }
    }
    for (const x of [-X0, X0]) for (const y of [-YW, YW]) p.push(Y([x, y, 0.25], 0.04, 0.27, "iron"), S([x, y, 0.56], 0.055, "iron"));
    return { prims: p, r: 1.0, h: 0.7, k: 1 };
  });

  // The potting shed: painted boards, a pent slate roof, a door ajar on -x, a window on -y, a potting
  // bench with pots, a sack of sand tipped over, a rain barrel and a flue. Anchored at its middle.
  model("fg_shed", () => {
    const p = [B([0, 0, 0.05], [0.72, 0.67, 0.05], 0.01, "brick"), B([0, 0, 0.55], [0.68, 0.63, 0.5], 0.01, "shedWood")];
    p.push(B([-0.7, 0.15, 0.42], [0.06, 0.22, 0.38], 0, "shedWood", { sub: true }), B([0.1, -0.66, 0.66], [0.22, 0.06, 0.16], 0, "shedWood", { sub: true }));
    p.push(B([-0.66, 0.15, 0.42], [0.01, 0.21, 0.37], 0, "soot"), B([-0.85, 0.22, 0.42], [0.02, 0.2, 0.37], 0, "shedWoodDk", { R: rz(0.9) }));
    p.push(B([0.1, -0.62, 0.66], [0.2, 0.015, 0.14], 0, "glassPane"), B([0.1, -0.64, 0.66], [0.012, 0.02, 0.15], 0, "shedWoodDk"), B([0.1, -0.64, 0.66], [0.21, 0.02, 0.012], 0, "shedWoodDk"));
    p.push(B([0.04, 0, 1.13], [0.84, 0.78, 0.04], 0.01, "slate", { R: ry(0.22) }));
    // the potting bench on -y, its pots and trays
    p.push(B([-0.25, -0.86, 0.36], [0.32, 0.14, 0.025], 0, "plank"));
    for (const x of [-0.52, 0.02]) for (const y of [-0.96, -0.76]) p.push(B([x, y, 0.17], [0.02, 0.02, 0.17], 0, "plank"));
    for (const [x, r] of [[-0.45, 0.06], [-0.3, 0.05], [-0.12, 0.07]]) p.push(C([x, -0.86, 0.39], [x, -0.86, 0.39 + r * 1.4], r * 0.75, r, "terracotta"));
    // the sack tipped over, its sand running out towards the path
    p.push(E([-0.72, -0.62, 0.13], [0.16, 0.11, 0.12], "sacking", { R: rz(0.6) }), E([-0.95, -0.72, 0.03], [0.22, 0.16, 0.06], "sand"), E([-1.1, -0.8, 0.0], [0.18, 0.14, 0.04], "sand"));
    p.push(Y([0.55, 0.78, 0.25], 0.16, 0.25, "plank"), Y([0.55, 0.78, 0.12], 0.165, 0.018, "iron"), Y([0.55, 0.78, 0.38], 0.165, 0.018, "iron"), Y([0.55, 0.78, 0.49], 0.14, 0.01, "puddle"));
    p.push(Y([0.42, 0.3, 1.3], 0.04, 0.16, "iron"), Y([0.42, 0.3, 1.47], 0.06, 0.02, "iron"));
    return {
      prims: p, r: 1.0, h: 1.4, k: 1,
      detail: (x, y, z, m, nx, ny) => (m === "shedWood" && ((Math.abs(nx) > Math.abs(ny) ? y : x) * 9 % 1 + 1) % 1 < 0.12 ? "shedWoodDk" : m),
    };
  });

  // A terracotta pot with a fern, a geranium or an agave in it. A volume: a boss can shatter it (it stays
  // well under 2,048 voxels at vs=24).
  model("fg_pot", (o = {}) => {
    const p = [C([0, 0, 0.02], [0, 0, 0.3], 0.12, 0.16, "terracotta"), Y([0, 0, 0.31], 0.18, 0.03, "terracotta", { round: 0.012 }), Y([0, 0, 0.33], 0.145, 0.012, "peat")];
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s);
    if (o.plant === "geranium") {
      p.push(E([0, 0, 0.42], [0.18, 0.18, 0.1], "geranLeaf", { k2: 0.03 }));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + h(i, 2); p.push(S([Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.5 + 0.03 * h(i, 3)], 0.045, "geranRed")); }
    } else if (o.plant === "agave") {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + h(i, 2), r = 0.2 + 0.1 * h(i, 3); p.push(C([0, 0, 0.34], [Math.cos(a) * r, Math.sin(a) * r, 0.52 + 0.12 * h(i, 4)], 0.04, 0.008, "agave")); }
      p.push(C([0, 0, 0.34], [0, 0, 0.62], 0.04, 0.01, "agave"));
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.4 * h(i, 2), c = Math.cos(a), s = Math.sin(a), r = 0.3 + 0.08 * h(i, 3);
        p.push(C([c * 0.03, s * 0.03, 0.34], [c * r * 0.75, s * r * 0.75, 0.56], 0.03, 0.022, "fernLeaf"), C([c * r * 0.75, s * r * 0.75, 0.56], [c * r, s * r, 0.42], 0.022, 0.01, "fernLeaf"));
      }
    }
    return { prims: p, r: 0.3, h: 0.62, k: 1 };
  });

  // An orange tree clipped round in a Versailles tub: green boards, iron bands, ball finials, oranges in
  // the crown. A volume that sways; it drops leaves (content/momiji.js, particles).
  model("fg_orange", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [B([0, 0, 0.19], [0.2, 0.2, 0.19], 0.015, "tubGreen")];
    for (const z of [0.07, 0.31]) p.push(B([0, 0, z], [0.207, 0.207, 0.018], 0.004, "iron"));
    for (const x of [-0.2, 0.2]) for (const y of [-0.2, 0.2]) p.push(S([x, y, 0.42], 0.035, "tubGreen"));
    p.push(Y([0, 0, 0.385], 0.17, 0.01, "peat"), C([0, 0, 0.38], [0.02, 0.01, 0.86], 0.045, 0.03, "bark"));
    const cz = 1.08, crown = [[0, 0, cz, 0.3]];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + h(i, 2); crown.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17, cz + (h(i, 3) - 0.5) * 0.2, 0.17]); }
    for (const [x, y, z, r] of crown) p.push(S([x, y, z], r, "orangeLeaf", { k2: 0.06 }));
    for (let i = 0; i < 12; i++) {
      const a = TAU * h(i, 5), e = Math.asin(2 * h(i, 6) - 1) * 0.8, d = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
      p.push(S([d[0] * 0.31, d[1] * 0.31, cz + d[2] * 0.3], 0.038, "orangeFruit"));
    }
    return {
      prims: p, r: 0.42, h: 1.42, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => (m === "orangeLeaf" && nz > 0.3 && nz3(x, y, z, 7, 4) > 0.5 ? "orangeLeafLt" : m),
    };
  });

  // A lantern hung from a bay's front beam (1.4 tiles over the bed): a chain, a cap, four glowing panes in
  // an iron frame. The map lights it (its lights), and fireflies gather round it.
  model("fg_lantern", () => {
    const p = [Y([0, 0, 0.79], 0.07, 0.015, "iron"), B([0, 0, 0.9], [0.06, 0.06, 0.1], 0.008, "lampGlow")];
    for (const x of [-0.065, 0.065]) for (const y of [-0.065, 0.065]) p.push(C([x, y, 0.79], [x, y, 1.0], 0.012, 0.012, "iron"));
    p.push(C([0, 0, 0.99], [0, 0, 1.1], 0.1, 0.018, "iron"), S([0, 0, 1.12], 0.025, "iron"));
    for (let z = 1.15, i = 0; z < 1.42; z += 0.055, i++) p.push(E([0, 0, z], i % 2 ? [0.012, 0.022, 0.03] : [0.022, 0.012, 0.03], "iron"));
    return { prims: p, r: 0.12, h: 1.45, k: 1 };
  });

  // The pond's plants stand on its floor, 0.45 under the surface (the floor at 0.5, the water at 0.95), and
  // keep below it; the lily pads float on it. They sway (CT.sway), and wherever a prop's base is under the
  // water the engine drives that with the current instead of the wind: slower, with no gusts.
  const POND_DEPTH = 0.45;
  // Tape grass (eelgrass): a clump of long yellow-olive ribbons from a tuft of roots. They stand nearly upright to
  // the surface, the tips bending over along it with the current (o.dir, radians), so at vs16 they read as bright
  // upright blades through the water rather than a dark mat on the floor. Dark at the roots, yellow at the tips.
  model("fg_eelgrass", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), n = o.n || 7, top = POND_DEPTH - 0.03, p = [E([0, 0, 0.01], [0.11, 0.11, 0.03], "eelgrassDk", { k2: 0.02 })];
    const dir = o.dir == null ? 0.6 : o.dir;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.5 * h(i, 1), c = Math.cos(a), s = Math.sin(a), r0 = 0.03 + 0.06 * h(i, 2), ph = TAU * h(i, 6);
      const rise = top * (0.9 + 0.1 * h(i, 3)), trail = 0.08 + 0.12 * h(i, 4), td = dir + (h(i, 5) - 0.5) * 0.7, tc = Math.cos(td), ts = Math.sin(td);
      let q = [c * r0, s * r0, 0.01];
      const seg = (nq, ra, rb, m) => { p.push(C(q, nq, ra, rb, m)); q = nq; }; // two voxels wide at vs16, so a ribbon reads through the water
      for (let k = 1; k <= 4; k++) { // upright, leaning a little out and down the current near the top
        const u = k / 4, d = r0 + 0.03 * u * u;
        seg([c * d + tc * 0.05 * u ** 3, s * d + ts * 0.05 * u ** 3, 0.01 + rise * u], 0.064, 0.062, u > 0.6 ? "eelgrassLt" : "eelgrass");
      }
      const [bx, by] = q;
      for (let k = 1; k <= 2; k++) { // the tip bends over along the current, waving a little across it
        const u = k / 2, along = trail * u, side = 0.04 * (Math.sin(ph + u * 3) - Math.sin(ph));
        seg([bx + tc * along - ts * side, by + ts * along + tc * side, Math.min(top, 0.01 + rise + 0.02 * u)], 0.06, 0.05, "eelgrassLt");
      }
    }
    return { prims: p, r: 0.62, h: top + 0.02, k: 1, detail: (x, y, z, m) => (m !== "eelgrass" ? m : z < 0.06 ? "eelgrassDk" : m) };
  });

  // Hornwort (o.type "hornwort": dark bottle-brush whorls) or cabomba ("cabomba": bright flat fans): a few
  // stems leaning out of a root ball, with a whorl every few centimetres.
  model("fg_frond", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), cab = o.type === "cabomba", m = cab ? "cabomba" : "hornwort", n = o.n || 5;
    const p = [E([0, 0, 0.01], [0.07, 0.07, 0.03], "hornwort", { k2: 0.02 })];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + h(i, 1), c = Math.cos(a), s = Math.sin(a), L = (POND_DEPTH - 0.1) * (0.6 + 0.4 * h(i, 2)), lean = 0.05 + 0.12 * h(i, 3);
      const at = (u) => [c * (0.03 + lean * u * u), s * (0.03 + lean * u * u), 0.02 + L * u];
      for (let k = 0; k < 4; k++) p.push(C(at(k / 4), at((k + 1) / 4), 0.012, 0.01, "hornwort"));
      for (let z = 0.08, j = 0; z < L; z += cab ? 0.05 : 0.045, j++) {
        const u = z / L, c0 = at(u), r = (cab ? 0.06 : 0.036) * (1 - 0.35 * u);
        p.push(cab ? E(c0, [r, r, 0.01], m, { R: mul(P.rot("x", 0.25), rz(a + j)) }) : S(c0, r, m, { k2: 0.025 }));
      }
    }
    return { prims: p, r: 0.3, h: POND_DEPTH - 0.06, k: 1 };
  });

  // Water-lily pads on the surface (o.z: the surface over the floor), on stems down to the floor, the
  // middle pad the largest (a frog sits on it: ME.content.padTop); o.flower opens a pink lily on one. Rims
  // red-brown, faint veins.
  const LILY_PADS = [[0, 0, 0.15], [0.2, 0.12, 0.1], [-0.16, 0.17, 0.085], [0.06, -0.21, 0.11], [-0.2, -0.1, 0.075]];
  model("fg_lily", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), Z = (o.z ?? POND_DEPTH) + 0.02, p = [];
    const pads = LILY_PADS.slice(0, o.n || 5).map(([x, y, r], i) => [x + 0.03 * (h(i, 1) - 0.5), y + 0.03 * (h(i, 2) - 0.5), r]);
    for (const [x, y, r] of pads) p.push(Y([x, y, Z], r, 0.012, "lilyPad"), C([x * 0.4, y * 0.4, 0], [x, y, Z - 0.012], 0.012, 0.01, "lilyStem"));
    if (o.flower) {
      const [x, y] = pads[1];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, c = Math.cos(a), s = Math.sin(a); p.push(E([x + c * 0.035, y + s * 0.035, Z + 0.04], [0.035, 0.016, 0.012], "lilyPetal", { R: mul(ry(-0.7), rz(a)) })); }
      p.push(S([x, y, Z + 0.035], 0.02, "lilyHeart"));
    }
    return {
      prims: p, r: 0.38, h: Z + 0.08, k: 1,
      detail: (x, y, z, m) => {
        if (m !== "lilyPad") return m;
        let b = pads[0], d = Infinity;
        for (const q of pads) { const e = Math.hypot(x - q[0], y - q[1]) - q[2]; if (e < d) { d = e; b = q; } }
        const ang = Math.atan2(y - b[1], x - b[0]);
        return d > -0.02 ? "lilyRim" : ((ang / TAU) * 9 + 9) % 1 < 0.1 ? "eelgrassLt" : m;
      },
    };
  });

  // Moss cushions and pebbles on the pond's floor, stamped (they don't sway).
  model("fg_pondstones", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [];
    for (let i = 0; i < 2; i++) { const a = TAU * h(i, 1), d = 0.25 * h(i, 2), r = 0.1 + 0.06 * h(i, 3); p.push(E([Math.cos(a) * d, Math.sin(a) * d, 0], [r, r * 0.8, r * 0.5], i ? "moss2" : "moss", { k2: 0.02 })); }
    for (let i = 0; i < 7; i++) { const a = TAU * h(i, 4), d = 0.1 + 0.28 * h(i, 5), r = 0.03 + 0.04 * h(i, 6); p.push(E([Math.cos(a) * d, Math.sin(a) * d, 0], [r * 1.2, r, r * 0.7], "pondPebble", { k2: 0.01 })); }
    return { prims: p, r: 0.45, h: 0.1, k: 1 };
  });

  // A few mossy limestone rocks on the Heart Tree's island: o.n boulders round the anchor, each half sunk
  // in the moss with a cushion of moss on its top.
  model("fg_rocks", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [], n = o.n || 3;
    for (let i = 0; i < n; i++) {
      const a = TAU * (i / n + 0.3 * h(i, 1)), d = n > 1 ? 0.16 + 0.12 * h(i, 2) : 0, r = (i ? 0.1 : 0.15) + 0.06 * h(i, 3), x = Math.cos(a) * d, y = Math.sin(a) * d;
      p.push(E([x, y, r * 0.3], [r, r * 0.85, r * 0.75], "limestone", { k2: 0.04, R: rz(TAU * h(i, 4)) }));
      p.push(E([x - r * 0.15, y + r * 0.1, r * 0.9], [r * 0.7, r * 0.6, r * 0.22], i % 2 ? "moss2" : "moss", { k2: 0.02 }));
    }
    return { prims: p, r: 0.45, h: 0.3, k: 1 };
  });

  CT.volumeDeco = (CT.volumeDeco || []).concat(["fg_pot", "fg_orange", "fg_lantern", "fg_eelgrass", "fg_frond", "fg_lily"]);
  CT.sway = Object.assign(CT.sway || {}, { fg_orange: [0.03, 0.01, 2.0], fg_pot: [0.06, 0.03, 3.4], fg_eelgrass: [0.14, 0.06, 1.3], fg_frond: [0.09, 0.04, 1.1], fg_lily: [0.01, 0.005, 0.6] });
  // the critters' part: the top of fg_lily's middle pad over its tile (a frog sits there), and the minnow
  // school of the flooded pond (content/critters.js)
  CT.padTop = Object.assign(CT.padTop || {}, { fg_lily: POND_DEPTH + 0.032 });
  CT.critterExtra = Object.assign(CT.critterExtra || {}, { fernglass: { minnow: 7 } });

  // ---------------------------------------------------------------- the map
  // Rings round the middle (12, 12), measured as an octagon: the wall (h 2.0), the rim beds (1.5), the outer
  // walk (1.0; gravel on its east half, its west half grown over), the middle beds (1.0), the shore walk
  // (1.0, flush with the beds; flagstones, on the pond's west half only), the pond and the Heart Tree's
  // island in its middle. The rift comes in through the boiler house at the top; the route runs clockwise
  // down the outer walk's east half and its potting sand, up the south cut, round the shore walk's half (over
  // the footbridge on the spout), and across the iron footbridge from the north shore to a flagstone landing on the island. The water
  // stands level with its banks: the fountain's basin is raised to the wall's 2.0 in a limestone kerb and
  // spills down a spout channel (1.5), which falls into the pond's west reach. The pond, eight tiles across,
  // rings the island two tiles wide: water at 0.95 (flood) over a sand floor at 0.5 grown with water plants,
  // held by the shore walk on the west and by the beds, which run down to it, on the east. The island, moss
  // at 1.0 with a few rocks, is four tiles across.
  //   _ outside   # wall   . moss (build tiles)   f fern bed (build tiles)   : gravel   % potting sand
  //   = flagstone   ~ water   p the pond's floor (sand, flooded)
  CT.maps = CT.maps || {};
  CT.maps.fernglass = {
    v: 1, id: "fernglass", W: 24, H: 24, hStep: 0.5, floor: -3,
    h: [
      "000000044443344440000000", "000000443333333344000000", "000004433333333334400000", "000044332222222233440000",
      "000443322222222223344000", "004433222222222222334400", "044332222222222222233440", "443322222222222222223344",
      "433222222111111222222334", "433222221111111122222334", "444222221112211122222334", "444422221122221122222334",
      "444311111122221122222334", "444422221112211122222334", "433222221111111122222334", "433222222111111222222334",
      "443322222222222222223344", "044332222222222222233440", "004433222222222222334400", "000443322222222223344000",
      "000044332222222233440000", "000004433333333334400000", "000000443333333344000000", "000000044444444440000000",
    ],
    kind: [
      "_______####::####_______", "______##ff.::...##______", "_____##fff.::....##_____", "____##ff...:::::..##____",
      "___##ff....::::::..##___", "__##ff.........:::..##__", "_##ff....====...:::..##_", "##ff....=====....:::..##",
      "#ff....==pppppp...:::..#", "#ff...==pppppppp...::..#", "###...==ppp.=ppp...::..#", "#~~#..==pp....pp...::..#",
      "#~~~pppppp....pp...::..#", "####..==ppp..ppp...::..#", "#ff...==pppppppp...::..#", "#ff....==pppppp...%%%..#",
      "##ff....=====....%%%..##", "_##ff....====...%%%%.##_", "__##ff.....::..%%%%%##__", "___##ff....:::%%%%%##___",
      "____##ff...:::%%..##____", "_____##fff.......##_____", "______##ff......##______", "_______##########_______",
    ],
    legend: { _: null, "#": "wall", ".": "moss", f: "fernbed", ":": "gravel", "%": "pottingsand", "=": "flagstone", "~": "fernwater", p: "pond" },
    // the basin round the fountain and its spout along row 12, wide enough to fill their tiles (the pond is
    // flooded whole: it needs no shape)
    water: [{ ellipse: [2.0, 12.0, 1.04, 1.04] }, { seg: [2.0, 12.5, 3.6, 12.5], r: 0.48 }],
    // the pond: its tiles flooded to 0.95 (their tops are at 0.5), with the fountain's water (its look, its bubbles)
    flood: [{ level: 0.95, water: "fernwater", tiles: [[9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [8, 9], [9, 9], [10, 9], [11, 9], [12, 9], [13, 9], [14, 9], [15, 9], [8, 10], [9, 10], [10, 10], [13, 10], [14, 10], [15, 10], [8, 11], [9, 11], [14, 11], [15, 11], [4, 12], [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [14, 12], [15, 12], [8, 13], [9, 13], [10, 13], [13, 13], [14, 13], [15, 13], [8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [14, 14], [15, 14], [9, 15], [10, 15], [11, 15], [12, 15], [13, 15], [14, 15]] }],
    props: [
      // the eight glass bays on the wall, each with its lantern hung from the front beam
      ["fg_bay", { seed: 1 }, 22, 16, { dx: -0.337, dy: -0.29 }], ["fg_lantern", { seed: 1 }, 21, 15, { dx: -0.143, dy: 0.376 }],
      ["fg_bay", { seed: 2 }, 16, 22, { dx: -0.29, dy: -0.337, flip: true }], ["fg_lantern", { seed: 2 }, 15, 21, { dx: 0.376, dy: -0.143 }],
      ["fg_bay", { seed: 3 }, 7, 22, { dx: 0.29, dy: -0.337, rot: 1 }], ["fg_lantern", { seed: 3 }, 8, 21, { dx: -0.376, dy: -0.143 }],
      ["fg_bay", { seed: 4 }, 1, 16, { dx: 0.337, dy: -0.29, flip: true, rot: 1 }], ["fg_lantern", { seed: 4 }, 2, 15, { dx: 0.143, dy: 0.376 }],
      ["fg_bay", { seed: 5 }, 1, 7, { dx: 0.337, dy: 0.29, rot: 2 }], ["fg_lantern", { seed: 5 }, 2, 8, { dx: 0.143, dy: -0.376 }],
      ["fg_bay", { seed: 6 }, 7, 1, { dx: 0.29, dy: 0.337, flip: true, rot: 2 }], ["fg_lantern", { seed: 6 }, 8, 2, { dx: -0.376, dy: 0.143 }],
      ["fg_bay", { seed: 7 }, 16, 1, { dx: -0.29, dy: 0.337, rot: 3 }], ["fg_lantern", { seed: 7 }, 15, 2, { dx: 0.376, dy: 0.143 }],
      ["fg_bay", { seed: 8 }, 22, 7, { dx: -0.337, dy: 0.29, flip: true, rot: 3 }], ["fg_lantern", { seed: 8 }, 21, 8, { dx: -0.143, dy: -0.376 }],
      // the boiler house the creatures come out of, the fountain, the footbridge where the shore walk crosses
      // the spout's reach, the longer one from the north shore to the island, the potting shed
      ["fg_grate", null, 11, 0, { dx: 0.5, rot: 1 }],
      ["fg_fountain", null, 1, 11, { dx: 0.5, dy: 0.5 }],
      ["fg_bridge", null, 6, 12, { dx: 0.5, dz: 0.5, rot: 1 }],
      ["fg_bridge", { span: 1.8 }, 11, 8, { dx: 0.5, dy: 0.5, dz: 0.5, rot: 1 }],
      ["fg_shed", null, 18, 18, { dx: 0.5, dy: 0.5 }],
      // the island's rocks, under the Heart Tree's crown (no build tile lost)
      ["fg_rocks", { seed: 1, n: 3 }, 13, 12, { dx: 0.1, dy: 0.15 }], ["fg_rocks", { seed: 2, n: 2 }, 11, 13, { dx: -0.1, dy: 0.1 }],
      // the pond: moss cushions and pebbles on its floor, tape grass and hornwort or cabomba under the water
      // (swaying with it), lily pads on its surface; none under the bridges
      ["fg_pondstones", { seed: 5 }, 4, 12], ["fg_pondstones", { seed: 1 }, 9, 9], ["fg_pondstones", { seed: 2 }, 15, 9, { dx: -0.15 }], ["fg_pondstones", { seed: 3 }, 8, 11],
      ["fg_pondstones", { seed: 4 }, 13, 15, { dy: -0.15 }], ["fg_pondstones", { seed: 6 }, 9, 14], ["fg_pondstones", { seed: 7 }, 15, 12, { dx: -0.15 }],
      ["fg_eelgrass", { seed: 8, n: 7 }, 5, 12, { dy: 0.1 }], ["fg_eelgrass", { seed: 1 }, 10, 8, { dy: 0.15 }], ["fg_eelgrass", { seed: 2 }, 14, 8, { dx: -0.1, dy: 0.15 }],
      ["fg_eelgrass", { seed: 3, n: 8 }, 8, 9, { dx: 0.1 }], ["fg_eelgrass", { seed: 4 }, 15, 11, { dx: -0.1 }], ["fg_eelgrass", { seed: 5, n: 8 }, 8, 12, { dx: 0.1 }],
      ["fg_eelgrass", { seed: 6 }, 9, 15, { dy: -0.1 }], ["fg_eelgrass", { seed: 7, n: 9 }, 13, 14], ["fg_eelgrass", { seed: 9 }, 10, 13, { dx: -0.1, dy: 0.1 }],
      ["fg_eelgrass", { seed: 10 }, 15, 14, { dx: -0.1, dy: -0.1 }], ["fg_eelgrass", { seed: 11, n: 7 }, 14, 10], ["fg_eelgrass", { seed: 12 }, 8, 14, { dx: 0.1 }],
      ["fg_frond", { seed: 1, type: "cabomba" }, 13, 8], ["fg_frond", { seed: 2, type: "hornwort" }, 9, 10, { dx: 0.1 }], ["fg_frond", { seed: 3, type: "hornwort" }, 14, 13, { dy: 0.1 }],
      ["fg_frond", { seed: 4, type: "cabomba" }, 11, 15, { dy: -0.1 }], ["fg_frond", { seed: 5, type: "cabomba" }, 8, 13, { dx: 0.1 }], ["fg_frond", { seed: 6, type: "hornwort" }, 15, 10, { dx: -0.1 }],
      ["fg_lily", { seed: 1, flower: true }, 10, 9, { dx: 0.15, dy: 0.05 }], ["fg_lily", { seed: 2, n: 4 }, 14, 9, { dx: -0.1 }], ["fg_lily", { seed: 3, flower: true }, 9, 11, { dx: 0.1, dy: 0.15 }],
      ["fg_lily", { seed: 4, n: 4 }, 14, 12, { dy: 0.1 }], ["fg_lily", { seed: 5, flower: true }, 12, 14, { dx: 0.1 }], ["fg_lily", { seed: 6 }, 13, 10, { dx: 0.1, dy: -0.05 }],
      ["fg_lily", { seed: 7, n: 4 }, 10, 15, { dy: -0.1 }],
      // terracotta pots by the outer walk, orange trees in tubs along the west avenue
      ["fg_pot", { seed: 1, plant: "fern" }, 17, 3], ["fg_pot", { seed: 2, plant: "geranium" }, 19, 5], ["fg_pot", { seed: 3, plant: "fern" }, 21, 9],
      ["fg_pot", { seed: 4, plant: "agave" }, 21, 11], ["fg_pot", { seed: 5, plant: "geranium" }, 21, 14], ["fg_pot", { seed: 6, plant: "fern" }, 13, 21],
      ["fg_orange", { seed: 1 }, 4, 9], ["fg_orange", { seed: 2 }, 4, 15], ["fg_orange", { seed: 3 }, 7, 5], ["fg_orange", { seed: 4 }, 7, 19],
      // ferns on the fern beds, stamped
      ["fern", { seed: 4, sz: 1.1 }, 2, 9, { as: "stamp" }], ["fern", { seed: 8, sz: 1.2 }, 2, 8, { as: "stamp" }], ["fern", { seed: 12, sz: 1 }, 4, 6, { as: "stamp" }],
      ["fern", { seed: 16, sz: 1.1 }, 6, 4, { as: "stamp" }], ["fern", { seed: 20, sz: 1.2 }, 8, 2, { as: "stamp" }], ["fern", { seed: 24, sz: 1 }, 9, 22, { as: "stamp" }],
      ["fern", { seed: 28, sz: 1.1 }, 7, 21, { as: "stamp" }], ["fern", { seed: 32, sz: 1.2 }, 5, 19, { as: "stamp" }], ["fern", { seed: 36, sz: 1 }, 3, 17, { as: "stamp" }],
      ["fern", { seed: 40, sz: 1.1 }, 1, 15, { as: "stamp" }], ["fern", { seed: 44, sz: 1.2 }, 1, 14, { as: "stamp" }],
      // stairs where the route steps down from the rift to the outer walk
      ["stairs", { H: 0.5, dir: "-y" }, 11, 3], ["stairs", { H: 0.5, dir: "-y" }, 12, 3],
      // the potting sand's covers (G.dressSand's, written here so the engine demo shows them too)
      ["sandCover", { x: 18, y: 15, open: "nw" }, 18, 15], ["sandCover", { x: 19, y: 15, open: "n" }, 19, 15], ["sandCover", { x: 20, y: 15, open: "n" }, 20, 15],
      ["sandCover", { x: 17, y: 16, open: "nw" }, 17, 16], ["sandCover", { x: 18, y: 16, open: "" }, 18, 16], ["sandCover", { x: 19, y: 16, open: "" }, 19, 16],
      ["sandCover", { x: 16, y: 17, open: "nw" }, 16, 17], ["sandCover", { x: 17, y: 17, open: "" }, 17, 17], ["sandCover", { x: 18, y: 17, open: "" }, 18, 17],
      ["sandCover", { x: 19, y: 17, open: "e" }, 19, 17], ["sandCover", { x: 15, y: 18, open: "nw" }, 15, 18], ["sandCover", { x: 16, y: 18, open: "" }, 16, 18],
      ["sandCover", { x: 17, y: 18, open: "" }, 17, 18], ["sandCover", { x: 18, y: 18, open: "" }, 18, 18], ["sandCover", { x: 19, y: 18, open: "" }, 19, 18],
      ["sandCover", { x: 14, y: 19, open: "nw" }, 14, 19], ["sandCover", { x: 15, y: 19, open: "" }, 15, 19], ["sandCover", { x: 16, y: 19, open: "" }, 16, 19],
      ["sandCover", { x: 17, y: 19, open: "s" }, 17, 19], ["sandCover", { x: 18, y: 19, open: "" }, 18, 19], ["sandCover", { x: 14, y: 20, open: "w" }, 14, 20],
      ["sandCover", { x: 15, y: 20, open: "" }, 15, 20],
    ],
    // the lanterns' lights (in tiles), at their glowing panes
    lights: [
      { p: [21.357, 15.876, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 }, { p: [15.876, 21.357, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 },
      { p: [8.124, 21.357, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 }, { p: [2.643, 15.876, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 },
      { p: [2.643, 8.124, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 }, { p: [8.124, 2.643, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 },
      { p: [15.876, 2.643, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 }, { p: [21.357, 8.124, 2.4], r: 2.4, col: [1.0, 0.72, 0.42], k: 1.9 },
    ],
    // Momiji's jar: the same island, drum, strata, glass and bake box
    frame: {
      type: "jar", c: [12, 12], r: 12, foot: 0.92, glassTop: 3.4,
      strata: [{ top: -1.02, ramp: "pebble", ramp2: "pebble2", gap: "charcoal", tex: "pebbles", f: 6.5, wob: 0.08 }, { top: -0.9, ramp: "charcoal", tex: "grain", wob: 0.05 }, { top: -0.58, ramp: "sphag", tex: "fiber", wob: 0.12 }],
    },
    box: { o: [-1, -1, -2.5], size: [26, 26, 10] },
    // The rules' data (the engine never reads it): the route as one polyline of tile corners (cells), the
    // rift's point and the Heart Tree's centre in tiles, the kinds that are walks, the kinds that are build
    // tiles (the pond is not), and the wet cells the route crosses on the bridges (dry for the creatures)
    game: {
      route: [[[12, 0], [12, 4], [15, 4], [15, 5], [16, 5], [16, 6], [17, 6], [17, 7], [18, 7], [18, 8], [19, 8], [19, 15], [18, 15], [18, 16], [17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [15, 19], [12, 19], [12, 16], [8, 16], [8, 15], [7, 15], [7, 8], [8, 8], [8, 7], [12, 7], [12, 10]]],
      spawn: [12.0, 0.6], heart: [12, 12], lane: ["gravel", "flagstone", "pottingsand"], build: ["moss", "fernbed"],
      bridges: [[6, 12], [7, 12], [11, 8], [12, 8], [11, 9], [12, 9]],
    },
  };

  // The light: a lower, later sun than Momiji's from the same side, and beams on the walks, the pool, the
  // sand and the rift. ME.content.mapLight[id] goes over the style's L and light.
  const CANOPY = P.r4 && P.r4.CANOPY;
  CT.mapLight = Object.assign(CT.mapLight || {}, {
    fernglass: {
      L: [-0.62, 0.5, 0.6],
      light: CANOPY ? CANOPY({ shade: 0.46, pool: 0.55, beams: [
        { x: 10.6, y: 12.2, r: 1.2, len: 24 }, { x: 14.6, y: 12.0, r: 1.0, k: 0.9, len: 24 }, { x: 11.5, y: 8.4, r: 1.1, k: 0.9, len: 24 },
        { x: 19.6, y: 11.0, r: 1.2, k: 0.9, len: 24 }, { x: 17.0, y: 18.0, r: 1.2, k: 0.95, len: 24 }, { x: 12.0, y: 3.0, r: 1.0, k: 0.85, len: 24 },
      ] }) : null,
    },
  });
})();
