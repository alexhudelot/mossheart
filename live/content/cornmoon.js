/* Cornmoon, Mossheart's third garden (docs/decisions/2026-10-24-corn-moon.md): a walled farm under the bell
   jar on a windy Halloween night. An ochre dirt path strewn with fallen leaves runs through thick tall gold
   grass and ripe corn that ripple in the travelling gusts, over pasture and mown hay rows with low rises, past
   a scarecrow with a jack-o'-lantern head and a lantern on his arm, a sheep pen, a kitchen garden of cabbages,
   kale and sunflowers, and rust, amber and scarlet trees dropping their leaves on everything, down to a
   drainage ditch with a timber footbridge, a lit hen coop and a patch of carved pumpkins by the Heart Tree.
   Broad moon shafts slant in from a low moon. The creatures come in by the field gate at the top and by a
   second, lit east gate onto the same path. This file holds the level's part of the Mossheart content pack:
     ME.content.kinds       cmtrack (the dirt path), cmwall (the field's turf bank over fieldstone), the build
                            tiles cmmeadown, cmmeadow, cmmeadowa, cmmeadowr (the pasture in four autumn bands,
                            olive by the gate, gold, amber, then rust down by the ditch) and cmstubble (hay
                            rows); cmcorn (furrowed loam under
                            the corn), cmtallgrass, cmpatch (the pumpkin patch's dark soil), cmpen (the pen's
                            straw), cmgarden (the garden's rows), cmditch (the ditch's still, dark water)
     window.MODELS          stamps cm_gate (two stone pillars and a timber gate; o.swing, the side it opens to,
                            o.open 0-1), cm_bridge, cm_fence, cm_hay, cm_leaves (fallen leaves; o.n); volumes
                            cm_corn and cm_tallgrass (o.w 1 or 2 tiles; they sway hard), cm_thingrass (fine
                            blades in green, tan and rust; o.tall a high clump, else a low tuft; o.seed),
                            cm_shrub (a low autumn bush; o.leaf its colour), cm_scarecrow (a carved
                            pumpkin head), cm_lantern (a pole with a hung lantern),
                            cm_pumpkin (o.carved: a face glowing on +x; o.vines), cm_apple (a small tree; o.leaf
                            its crown, o.fruit false for no apples), cm_sheep (o.a its yaw, o.lamb), cm_trough,
                            cm_coop (a lit window on +x), cm_hen (o.n hens), cm_cabbage (o.kale), cm_sunflower
     ME.content.maps.cornmoon       the v1 map (plain data), with game: { route, spawn, heart, lane, build,
                                    bridges }; route[1] and spawn2 are the east gate's way in
     ME.content.mapLight.cornmoon   its light, { L, light, hd, look }: a low harvest moon in the south-east,
                                    warm beams on the track and the corn, a dusky plum fog instead of the
                                    valley's haze; look is the night the design asks of Engine (E1, E2)
   The ramps reach the palette through ME.content.addMaterials (critter-models.js, ME.content.ramps); earth
   tones are explicit lists, dark to light, so no shade hue-shifts them. The map was generated once (a field
   inside an octagon wall, terraced down from the gate to the ditch) and written out as rows, so its rows can
   be edited by hand. game.route is the walkers' centre line, one tile of each 2-tile track. */
(function () {
  const ME = window.ME, P = window.PX, { S, E, C, B, Y } = P.prim, M = window.MODELS, CT = (ME.content = ME.content || {}), TAU = Math.PI * 2;
  const WIND = ME.WIND_DIR || [0.85, -0.527];

  // ---------------------------------------------------------------- materials
  CT.ramps = Object.assign(CT.ramps || {}, {
    // the ground: the dirt path's packed ochre earth and its few warm pebbles, the mown hay rows (green-gold)
    // and their darker windrows, the patch's soil, the turf and the field stones
    cmLoam: ["#3a2a1a", "#4a3620", "#5a4228", "#6a4e30", "#7a5a38", "#8a6842", "#99764c", "#a88456"],
    cmClod: ["#5a4a38", "#6a5844", "#7a6650", "#8a745c", "#9a8268", "#aa9074"],
    cmStubble: ["#5a4e24", "#6a5c2a", "#7a6a30", "#8a7836", "#9a863e", "#aa9446", "#baa250", "#c8b05c"],
    cmWindrow: ["#5a3e1c", "#6c4a20", "#7e5826", "#90662c", "#a27434", "#b2823c"],
    cmPatch: ["#2a2420", "#352d27", "#40372f", "#4b4137", "#574b40", "#625549"],
    // the pasture in an autumn gradient down the field (the user: "the cosy beauty of momiji"): olive on the top
    // field, gold-olive in the middle one (cmMeadow, also every edge and drape), amber on the low field and
    // russet by the Heart Tree, one band a terrace so no band edge crosses flat ground; their mottle a dry tan,
    // the wall's turf an olive bank, the pen's trodden straw bedding (explicit lists: a generated ramp
    // hue-shifts its shade, the red band of #275)
    cmMeadowN: ["#2a3a1c", "#33461f", "#3d5223", "#485e27", "#536a2c", "#5f7631", "#6b8237", "#788e3e"],
    cmMeadow: ["#3a3a18", "#47461b", "#55531f", "#636023", "#726d28", "#827a2e", "#928735", "#a2943c"],
    cmMeadowA: ["#45301a", "#553b1c", "#66471f", "#775322", "#885f26", "#996b2b", "#aa7831", "#ba8538"],
    cmMeadowR: ["#45221a", "#55291c", "#66311f", "#773a22", "#884326", "#984c2a", "#a8562f", "#b66135"],
    cmMeadow2: ["#463c22", "#544828", "#62542e", "#706034", "#7e6c3a", "#8c7841", "#9a8448"],
    cmBank: ["#2e3020", "#383a24", "#424428", "#4c4e2c", "#565830", "#606234"],
    cmStraw: ["#5e5030", "#706038", "#827040", "#948048", "#a69052", "#b8a05c"],
    cmFieldstone: ["#3e4248", "#4b5057", "#595e66", "#676c74", "#757a82", "#83888f", "#91969c", "#a0a4a9"],
    // fallen autumn leaves in the pasture, thick under the trees, brown to orange-gold
    cmLitter: ["#5a2a12", "#74341a", "#8e4220", "#a8542a", "#c06a32", "#d0843c", "#dca04a"],
    // the corn ripe, green-gold leaves, and the tall grass, ripe wheat-gold with pale tips and seed heads
    cmLeaf: ["#2e3a1e", "#384624", "#43532a", "#4e6030", "#5a6d36", "#677a3e", "#748746", "#82944e"],
    cmLeafDk: ["#1e281a", "#25301e", "#2c3822", "#344026", "#3c492b", "#445230"],
    cmTassel: ["#4a4532", "#5e583f", "#736c4d", "#88805c", "#9d956d", "#b1a97f", "#c5bd92", "#d8d0a4"],
    cmHusk: ["#4c4a34", "#5f5d40", "#73714d", "#88855c", "#9c996c", "#b0ad7e", "#c2bf90"],
    cmGrass: ["#5a4a1c", "#6e5b20", "#836c26", "#987e2c", "#ad9134", "#c1a33e", "#d3b54a", "#e2c55a"],
    // the thin grass's blades mixed in with the gold: tan and rust
    cmGrassTan: ["#4e4630", "#605638", "#726642", "#84764c", "#968658", "#a69664", "#b6a672"],
    cmGrassRust: ["#4a2814", "#5c3218", "#703e1e", "#844a24", "#98582c", "#aa6634", "#ba743e"],
    cmGrassTip: ["#c8b060", "#d8c272", "#e6d286", "#f0e09c", "#f8ecb4"], cmSeed: ["#9a7a30", "#b08c3a", "#c49e46", "#d6b054", "#e6c266"],
    // the kitchen garden: cabbages, blue kale, the sunflowers' petals and dark seed faces
    cmCabbage: ["#1e3a2e", "#25483a", "#2d5646", "#356452", "#3e725e", "#48806a", "#538e76"],
    cmKale: ["#1a2e30", "#203a3c", "#264648", "#2d5254", "#345e60", "#3c6a6c"],
    cmPetal: ["#8a5e10", "#a87414", "#c48a1a", "#dca224", "#eeb830", "#f8cc48"], cmSunFace: ["#2a1c10", "#382614", "#463018", "#543a1e"],
    // the sheep's fleece and dark faces, the hens' russet feathers
    cmWool: ["#7e8088", "#94969c", "#a8aaae", "#babbbe", "#cacbcc", "#d8d8d6", "#e4e3de"], cmFace: ["#1c1a1c", "#262326", "#302c2e", "#3a3537"],
    cmHen: ["#5a3018", "#6a3a1e", "#7e4824", "#94582c", "#a86834", "#ba7a40"],
    // the pumpkins (and the candle in the carved ones), the weathered timber, the scarecrow's old coat, the
    // trees' autumn crowns (rust, amber, scarlet) and the apples
    cmPumpkin: ["#7a3010", "#94401a", "#ae5222", "#c4652c", "#d67a38", "#e49048"], cmPumpkinDk: ["#5e2a12", "#723418", "#863f1e", "#9a4b26"],
    cmPumpkinGlow: ["#f08020", "#f49a38", "#f8b458", "#fcd080"],
    cmTimber: ["#4c4c48", "#5c5b56", "#6c6a64", "#7c7a72", "#8c8a81", "#9c9a90", "#acaa9f"],
    cmCoat: ["#26324e", "#2e3c5c", "#38486a", "#435478", "#4f6186", "#5c6e92"],
    cmAppleLeaf: ["#4a1c10", "#5e2414", "#742e18", "#8a3a1e", "#a04824", "#b4582c", "#c66a34"],
    cmScarlet: ["#4e1218", "#64181c", "#7a2020", "#902a26", "#a6362c", "#b84434"],
    cmAmber: ["#5a3e14", "#70501a", "#866322", "#9c762b", "#b08a36", "#c29e44", "#d2b052"],
    cmApple: ["#6a1a1a", "#821f20", "#9a2a26", "#b03a30", "#c24c3a"],
  });
  CT.mats = Object.assign(CT.mats || {}, {
    cmPumpkinGlow: { em: 1, flat: 1 }, cmWool: { wrap: 0.5 },
    cmCabbage: { wrap: 0.5 }, cmKale: { wrap: 0.5 }, cmPetal: { wrap: 0.5 },
    cmLeaf: { wrap: 0.6 }, cmLeafDk: { wrap: 0.6 }, cmTassel: { wrap: 0.5 }, cmGrass: { wrap: 0.6 }, cmGrassTan: { wrap: 0.6 }, cmGrassRust: { wrap: 0.6 }, cmGrassTip: { wrap: 0.6 }, cmAppleLeaf: { wrap: 0.6 }, cmAmber: { wrap: 0.6 }, cmScarlet: { wrap: 0.6 },
  });
  Object.assign(CT.materialClass = CT.materialClass || {}, {
    cmMeadowN: "MOSS", cmMeadow: "MOSS", cmMeadowA: "MOSS", cmMeadowR: "MOSS", cmMeadow2: "MOSS", cmBank: "MOSS", cmLitter: "MOSS", cmStraw: "MOSS", cmWindrow: "MOSS", cmFieldstone: "ROCK", cmClod: "ROCK", cmTimber: "BARK",
    cmLeaf: "FOLIAGE", cmLeafDk: "FOLIAGE", cmTassel: "FOLIAGE", cmHusk: "FOLIAGE", cmGrass: "FOLIAGE", cmGrassTan: "FOLIAGE", cmGrassRust: "FOLIAGE", cmGrassTip: "FOLIAGE", cmSeed: "FOLIAGE", cmAppleLeaf: "FOLIAGE", cmAmber: "FOLIAGE", cmScarlet: "FOLIAGE",
    cmCabbage: "FOLIAGE", cmKale: "FOLIAGE", cmPetal: "FOLIAGE",
  });
  CT.sunShadeHalf = (CT.sunShadeHalf || []).concat(["cmLeaf", "cmAppleLeaf", "cmAmber", "cmScarlet"]);
  // the terrain blades on the pasture, under the tall grass and on the wall tops (cmBank: the cheap way to keep
  // the walls grassy, as a prop on each is ray-marched): gold, tan and rust (the thin grass's mix), dark
  // corn-leaf reeds on the ditch banks; this map's own set (ME.grassFor), so Momiji keeps its greens
  CT.mapGrass = Object.assign(CT.mapGrass || {}, { cornmoon: { ground: ["cmMeadowN", "cmMeadow", "cmMeadowA", "cmMeadowR", "cmMeadow2", "cmLitter", "cmBank"], blade: "cmGrass", blade2: "cmGrassTan", dry: "cmGrassRust", reed: "cmLeafDk" } });

  // ---------------------------------------------------------------- kinds
  Object.assign(CT.kinds = CT.kinds || {}, {
    // the cart track: a packed ochre dirt path, smooth (no stones: they read as circles), the pasture creeping
    // in from the sides; its fallen leaves are cm_leaves stamps (below the map)
    cmtrack: { recipe: "lane", top: "cmLoam", edge: "cmMeadow", drape: ["cmMeadow", "cmMeadow2"], overhang: "cmMeadow", under: "rock" },
    // the field's wall: a turf bank over fieldstone
    cmwall: { recipe: "layer", grass: true, top: "cmBank", mottle: "cmFieldstone", mottleK: 0.35, depth: 0.1, under: "cmFieldstone" },
    // the build tiles: the pasture, cushioned turf with fallen leaves thick under the trees, in its four autumn
    // bands (cmmeadown the top field, cmmeadow the middle, cmmeadowa the low field, cmmeadowr past the ditch),
    // and the mown hay strips, their windrows a darker stripe along x
    cmmeadown: { recipe: "carpet", grass: true, top: "cmMeadowN", mottle: "cmMeadow", cushions: true, litter: "cmLitter", drape: ["cmMeadowN", "cmMeadow"], overhang: "cmMeadowN", under: "rock" },
    cmmeadow: { recipe: "carpet", grass: true, top: "cmMeadow", mottle: "cmMeadow2", cushions: true, litter: "cmLitter", drape: ["cmMeadow", "cmMeadow2"], overhang: "cmMeadow", under: "rock" },
    cmmeadowa: { recipe: "carpet", grass: true, top: "cmMeadowA", mottle: "cmMeadow", cushions: true, litter: "cmLitter", drape: ["cmMeadowA", "cmMeadow"], overhang: "cmMeadowA", under: "rock" },
    cmmeadowr: { recipe: "carpet", grass: true, top: "cmMeadowR", mottle: "cmMeadowA", cushions: true, litter: "cmLitter", drape: ["cmMeadowR", "cmMeadowA"], overhang: "cmMeadowR", under: "rock" },
    cmstubble: { recipe: "layer", top: "cmStubble", mottle: "cmMeadow", mottleK: 0.2, stripe: { mat: "cmWindrow", width: 0.24 }, depth: 0.1, under: "rock" },
    // under the corn: loam with a furrow of dead weeds down each tile (a stripe along x); under the tall grass,
    // the browner straw; the pumpkin patch's soil
    cmcorn: { recipe: "layer", top: "cmLoam", stripe: { mat: "cmMeadow2", width: 0.2 }, depth: 0.1, under: "rock" },
    cmtallgrass: { recipe: "carpet", grass: true, top: "cmMeadow2", mottle: "cmMeadow", litter: "cmLitter", drape: ["cmMeadow", "cmMeadow2"], overhang: "cmMeadow", under: "rock" },
    cmpatch: { recipe: "layer", top: "cmPatch", mottle: "cmLoam", mottleK: 0.3, depth: 0.15, under: "rock" },
    // the sheep pen's trodden straw bedding over turf, and the kitchen garden's dark rows with grass between
    cmpen: { recipe: "layer", top: "cmStraw", mottle: "cmMeadow2", mottleK: 0.4, depth: 0.1, under: "rock" },
    cmgarden: { recipe: "layer", top: "cmPatch", stripe: { mat: "cmMeadow", width: 0.18 }, depth: 0.1, under: "rock" },
    // the ditch: still, dark water at its banks' foot, a bright moon glint and few caustics
    cmditch: Object.assign({}, CT.kinds.water, {
      surface: 0, clarity: 0.6, tint: [0.02, 0.06, 0.14], absorb: 1.2, calm: 0.9, glint: 1.6, caustics: 0.4,
      bank: "cmMeadow", drape: ["cmMeadow", "cmMeadow2"], overhang: "cmMeadow",
    }),
  });
  // the wall's banks are laid and keep straight lines; the meadow and the tall grass sprawl like the moss
  CT.edgeRound = Object.assign(CT.edgeRound || {}, { kinds: Object.assign((CT.edgeRound && CT.edgeRound.kinds) || {}, { cmwall: 0.05 }) });
  if (CT.edgeBreak) CT.edgeBreak.kinds = Object.assign(CT.edgeBreak.kinds || {}, { cmwall: 0, cmmeadown: 0.15, cmmeadow: 0.15, cmmeadowa: 0.15, cmmeadowr: 0.15, cmtallgrass: 0.15 });

  // ---------------------------------------------------------------- models
  // a jack-o'-lantern's face on a surface facing +x (y across, dz up from the middle, s the pumpkin's size):
  // two slanted eyes and a toothed grin; shared by cm_pumpkin and the scarecrow's head
  const jack = (y, dz, s) => { const ay = Math.abs(y); return (dz > 0.02 * s && dz < 0.09 * s && Math.abs(ay - 0.08 * s) < (0.09 * s - dz) * 0.9) || (dz < -0.025 * s && dz > -0.085 * s && ay < 0.12 * s - (dz + 0.085 * s) * 0.6 && !(ay < 0.022 * s && dz > -0.055 * s)); };
  // the fallen leaves' colours, on the bridge's planks and the coop's roof
  const fallen = ["cmAppleLeaf", "cmAmber", "cmScarlet"];
  // fernglass.js's conventions: tile units, the anchor at the ground centre, Z up; a stamp's source joins the
  // bake cache key by name (ME.ASSET_BY), with the shared jack and fallen above, so the key reads them only
  // through this map's models and a change to them moves no other map's key
  const SHARED = String(jack) + String(fallen);
  const model = (name, fn) => { M[name] = fn; (ME.ASSET_BY = ME.ASSET_BY || {})[name] = name + String(fn) + SHARED; ME.ASSET_SRC = (ME.ASSET_SRC || "") + ME.ASSET_BY[name]; };

  // The field gate: two fieldstone pillars on the wall either side of the track (model y ±1.15) with caps,
  // and a gate of timber boards in two leaves hinged on them. o.swing (1 or -1) is the side of model x the
  // leaves open to (into the field); o.open from 0 (shut) to 1 (open about 75°). Anchored on the track.
  model("cm_gate", (o = {}) => {
    const p = [], sw = o.swing || 1, th = (o.open == null ? 1 : o.open) * 1.3, W = 0.9;
    for (const s of [-1, 1]) {
      p.push(B([0, s * 1.15, 0.72], [0.2, 0.2, 0.72], 0.03, "cmFieldstone"), B([0, s * 1.15, 1.48], [0.24, 0.24, 0.05], 0.02, "cmFieldstone"));
      const hx = 0, hy = s * 0.93, dx = Math.sin(th) * sw, dy = -s * Math.cos(th), at = (u, z) => [hx + dx * u, hy + dy * u, z];
      for (let i = 0; i < 5; i++) { const u = 0.08 + i * 0.19, top = 1.0 + 0.06 * Math.sin((i / 4) * Math.PI); p.push(C(at(u, 0.12), at(u, top), 0.045, 0.045, "cmTimber")); }
      for (const z of [0.3, 0.85]) p.push(C(at(0.02, z), at(W, z), 0.035, 0.035, "cmTimber"));
      p.push(C(at(0.06, 0.32), at(W - 0.04, 0.83), 0.03, 0.03, "cmTimber"));
      for (const z of [0.3, 0.85]) p.push(C([0, s * 0.96, z], [0, s * 0.9, z], 0.04, 0.04, "iron"));
    }
    return { prims: p, r: 1.4, h: 1.6, k: 1, detail: (x, y, z, m) => (m === "cmFieldstone" && z < 1.4 && P.hash(Math.floor(z * 7), Math.floor((x + y) * 5), 0, 9) < 0.12 ? "cmBank" : m) };
  });

  // The ditch's footbridge: weathered timber planks on two log stringers, a handrail on one side. Spans its
  // model x (o.span the half length). Anchored at the middle, on the banks' height.
  model("cm_bridge", (o = {}) => {
    const p = [], X0 = o.span || 1.45, A = 0.18, zf = (x) => A * (1 - (x / X0) ** 2), N = Math.round((11 * X0) / 1.45), YW = 0.82;
    for (let i = 0; i < N; i++) {
      const x0 = -X0 + (i * 2 * X0) / N, x1 = x0 + (2 * X0) / N, xm = (x0 + x1) / 2, ph = Math.atan2(zf(x1) - zf(x0), x1 - x0), w = YW - 0.04 * P.hash(i, 1, 0, 5);
      p.push(B([xm, 0.03 * (P.hash(i, 2, 0, 5) - 0.5), zf(xm) + 0.02], [X0 / N - 0.01, w, 0.03], 0.006, "cmTimber", { R: P.rot("y", -ph) }));
      for (const y of [-0.55, 0.55]) p.push(C([x0, y, zf(x0) - 0.06], [x1, y, zf(x1) - 0.06], 0.06, 0.06, "bark"));
      p.push(C([x0, YW, zf(x0) + 0.5], [x1, YW, zf(x1) + 0.5], 0.03, 0.03, "cmTimber"));
    }
    for (const x of [-X0, 0, X0]) p.push(C([x, YW, zf(x) - 0.05], [x, YW, zf(x) + 0.52], 0.035, 0.035, "cmTimber"));
    // fallen leaves caught on the planks
    return { prims: p, r: 1.0, h: 0.75, k: 1, detail: (x, y, z, m) => (m === "cmTimber" && Math.abs(y) < 0.78 && P.hash(Math.floor(x * 9), Math.floor(y * 9), 0, 12) < 0.18 ? fallen[Math.floor(P.hash(Math.floor(x * 9), Math.floor(y * 9), 1, 12) * 3)] : m) };
  });

  // A split-rail fence panel along model x, a tile long, a little askew. Anchored on the ground.
  model("cm_fence", (o = {}) => {
    const h = (i) => P.hash(o.seed || 1, i, 0, 7), p = [];
    for (const x of [-0.45, 0.45]) p.push(C([x, 0, 0], [x + 0.03 * (h(x > 0 ? 1 : 2) - 0.5), 0, 0.62], 0.05, 0.04, "cmTimber"));
    p.push(C([-0.5, 0, 0.24 + 0.03 * h(3)], [0.5, 0, 0.22 + 0.03 * h(4)], 0.035, 0.035, "cmTimber"), C([-0.5, 0, 0.5], [0.5, 0, 0.47 + 0.05 * h(5)], 0.035, 0.035, "cmTimber"));
    return { prims: p, r: 0.55, h: 0.65, k: 1 };
  });

  // A hay bale bound with two strings, a loose sheaf leaning on it. Anchored on the ground.
  model("cm_hay", () => {
    const p = [B([0, 0, 0.2], [0.36, 0.22, 0.2], 0.06, "cmTassel"), C([0.32, 0.3, 0.02], [0.24, 0.24, 0.42], 0.08, 0.05, "cmStubble")];
    return { prims: p, r: 0.5, h: 0.45, k: 1, detail: (x, y, z, m) => (m === "cmTassel" && Math.abs(Math.abs(x) - 0.18) < 0.025 ? "cmTimber" : m === "cmTassel" && P.hash(Math.floor(x * 20), Math.floor(y * 20), Math.floor(z * 20), 3) < 0.3 ? "cmStubble" : m) };
  });

  // Corn: o.w 2 is a 2×2-tile stand of four rows of four stalks (the anchor on the corner the four tiles
  // share), o.w 1 one tile of two by two. Each stalk stands 1.25-1.55 with three arching leaves, a tassel and
  // most an ear in its husk. It sways (CT.sway), hard.
  model("cm_corn", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), w = o.w || 1, p = [], at = w > 1 ? [-0.75, -0.25, 0.25, 0.75] : [-0.25, 0.25];
    let j = 0;
    for (const y0 of at) for (const x0 of at) {
      const i = j++, x = x0 + (h(i, 1) - 0.5) * 0.14, y = y0 + (h(i, 2) - 0.5) * 0.12, H = 1.25 + 0.3 * h(i, 3), tx = x + (h(i, 4) - 0.5) * 0.06, ty = y + (h(i, 5) - 0.5) * 0.06;
      p.push(C([x, y, 0], [(x + tx) / 2, (y + ty) / 2, H * 0.55], 0.034, 0.03, "cmLeaf"), C([(x + tx) / 2, (y + ty) / 2, H * 0.55], [tx, ty, H], 0.03, 0.026, "cmLeaf"));
      for (let k = 0; k < 3; k++) {
        const a = TAU * h(i, 10 + k), c = Math.cos(a), s = Math.sin(a), z0 = H * (0.3 + 0.2 * k), L = 0.3 + 0.12 * h(i, 20 + k), u = (z0 / H), bx = x + (tx - x) * u, by = y + (ty - y) * u;
        const mid = [bx + c * L * 0.55, by + s * L * 0.55, z0 + 0.16];
        p.push(C([bx, by, z0], mid, 0.028, 0.024, "cmLeaf"), C(mid, [bx + c * L, by + s * L, z0 + 0.02], 0.024, 0.016, "cmLeafDk"));
      }
      p.push(C([tx, ty, H], [tx + 0.04 * WIND[0], ty + 0.04 * WIND[1], H + 0.17], 0.026, 0.016, "cmTassel"));
      if (h(i, 6) < 0.7) { const a = TAU * h(i, 7), c = Math.cos(a), s = Math.sin(a), z = H * (0.45 + 0.1 * h(i, 8)); p.push(C([x + c * 0.04, y + s * 0.04, z], [x + c * 0.12, y + s * 0.12, z + 0.2], 0.036, 0.026, "cmHusk")); }
    }
    return { prims: p, r: w > 1 ? 1.25 : 0.75, h: 1.75, k: 1, detail: (x, y, z, m) => (m === "cmLeaf" && z < 0.08 ? "cmLeafDk" : m) };
  });

  // Tall grass, ripe and gold: o.w 2 a 2×2-tile sweep of nine tufts (the anchor on the shared corner), o.w
  // 1 four tufts in one tile; five thin blades a tuft, 0.8-1.15 tall, all leaning downwind (ME.WIND_DIR, so
  // set it unturned), pale at the tips and many with a seed head. It sways (CT.sway), harder than the corn,
  // and one tile at a time, so the gusts ripple across it. The blade count is the phone's frame cost: each
  // tuft is ray-marched over its box, so fewer blades in tufts set close and leaning less (the Corn Moon perf pass)
  model("cm_tallgrass", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), w = o.w || 1, p = [], n = w > 1 ? 9 : 4, nb = 5, nx = -WIND[1], ny = WIND[0];
    const one = [[-0.15, -0.14], [0.16, -0.15], [-0.14, 0.16], [0.16, 0.14]];
    for (let t = 0; t < n; t++) {
      const cx = w > 1 ? ((t % 3) - 1) * 0.45 + (h(t, 1) - 0.5) * 0.14 : one[t][0] + (h(t, 1) - 0.5) * 0.1, cy = w > 1 ? (Math.floor(t / 3) - 1) * 0.45 + (h(t, 2) - 0.5) * 0.14 : one[t][1] + (h(t, 2) - 0.5) * 0.1;
      for (let b = 0; b < nb; b++) {
        const i = t * 10 + b, a = TAU * (b / nb + 0.2 * h(i, 3)), r0 = 0.02 + 0.04 * h(i, 4), Hb = 0.8 + 0.35 * h(i, 5), lean = 0.12 + 0.12 * h(i, 6), side = (h(i, 7) - 0.5) * 0.1;
        let q = [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, 0];
        for (let k = 1; k <= 3; k++) {
          const u = k / 3, d = lean * u * u, nq = [q[0] + 0, q[1] + 0, 0];
          nq[0] = cx + Math.cos(a) * r0 * (1 + u) + WIND[0] * d + nx * side * u; nq[1] = cy + Math.sin(a) * r0 * (1 + u) + WIND[1] * d + ny * side * u; nq[2] = Hb * (u - 0.25 * lean * u * u);
          p.push(C(q, nq, 0.042 - 0.005 * k, 0.037 - 0.005 * k, k === 3 ? "cmGrassTip" : "cmGrass")); q = nq;
        }
        if (h(i, 8) < 0.5) p.push(E([q[0] + WIND[0] * 0.03, q[1] + WIND[1] * 0.03, q[2] + 0.04], [0.03, 0.03, 0.07], "cmSeed"));
      }
    }
    return { prims: p, r: w > 1 ? 1.25 : 0.65, h: 1.3, k: 1 };
  });

  // Thin grass, one tile: o.tall a clump of eight fine blades 0.6-1.0 tall with pale tips, or else a low tuft
  // of ten 0.2-0.38 tall; gold, tan and rust mixed, all leaning downwind like the tall grass (so set it
  // unturned). It sways (CT.sway).
  model("cm_thingrass", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), tall = !!o.tall, n = tall ? 8 : 10, p = [], nx = -WIND[1], ny = WIND[0], mix = ["cmGrass", "cmGrassTan", "cmGrassRust"];
    for (let b = 0; b < n; b++) {
      const a = TAU * h(b, 1), r0 = 0.34 * Math.sqrt(h(b, 2)), cx = Math.cos(a) * r0, cy = Math.sin(a) * r0, m = mix[Math.floor(h(b, 6) * 3)];
      const Hb = tall ? 0.6 + 0.4 * h(b, 3) : 0.2 + 0.18 * h(b, 3), lean = (tall ? 0.14 : 0.06) + 0.12 * h(b, 4), side = (h(b, 5) - 0.5) * 0.12;
      let q = [cx, cy, 0];
      for (let k = 1; k <= 3; k++) {
        const u = k / 3, d = lean * u * u, nq = [cx + WIND[0] * d + nx * side * u, cy + WIND[1] * d + ny * side * u, Hb * (u - 0.2 * lean * u * u)];
        p.push(C(q, nq, 0.026 - 0.003 * k, 0.023 - 0.003 * k, tall && k === 3 ? "cmGrassTip" : m)); q = nq;
      }
    }
    return { prims: p, r: 0.6, h: tall ? 1.1 : 0.45, k: 1 };
  });

  // A shrub in its autumn leaves, one tile: a lumpy low bush 0.45-0.6 tall of o.leaf (cmAppleLeaf rust, cmAmber,
  // cmScarlet) flecked with a second autumn colour, on a few bare twigs. It sways a little (CT.sway). Anchored
  // on the ground.
  model("cm_shrub", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), leaf = o.leaf || "cmAppleLeaf", leaf2 = leaf === "cmAmber" ? "cmAppleLeaf" : "cmAmber", p = [];
    for (let k = 0; k < 3; k++) { const a = TAU * (k / 3 + 0.1 * h(k, 1)); p.push(C([0, 0, 0], [Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.22], 0.03, 0.02, "bark")); }
    for (let k = 0; k < 6; k++) {
      const a = TAU * (k / 6 + 0.12 * h(k, 2)), r = k === 0 ? 0 : 0.17 + 0.08 * h(k, 3), z = (k === 0 ? 0.34 : 0.24) + 0.1 * h(k, 4) + 0.08 * h(9, 5);
      p.push(E([Math.cos(a) * r, Math.sin(a) * r, z], [0.2 + 0.05 * h(k, 6), 0.2 + 0.05 * h(k, 7), 0.17], leaf));
    }
    return {
      prims: p, r: 0.5, h: 0.62, k: 1,
      detail: (x, y, z, m) => (m === leaf && P.hash(Math.floor(x * 14), Math.floor(y * 14), Math.floor(z * 14), 8) < 0.3 ? leaf2 : m),
    };
  });

  // The scarecrow: a post and a crossbar in an old blue coat, straw at the cuffs and the collar, a carved
  // pumpkin head grinning on model +x under a wide straw hat, and a lantern hung from his left arm (model +y);
  // the candle's and the lantern's lights are in the map's lights. Anchored on the ground.
  model("cm_scarecrow", () => {
    const p = [C([0, 0, 0], [0, 0, 1.45], 0.05, 0.045, "cmTimber"), C([0, -0.62, 1.12], [0, 0.62, 1.14], 0.035, 0.035, "cmTimber")];
    p.push(E([0, 0, 0.98], [0.16, 0.2, 0.26], "cmCoat"), C([0, -0.12, 0.72], [0, -0.16, 0.55], 0.1, 0.12, "cmCoat"), C([0, 0.12, 0.72], [0, 0.17, 0.55], 0.1, 0.12, "cmCoat"));
    for (const s of [-1, 1]) {
      p.push(C([0, s * 0.12, 1.14], [0.02, s * 0.5, 1.09], 0.09, 0.07, "cmCoat"));
      for (let k = 0; k < 3; k++) p.push(C([0.02, s * 0.5, 1.09], [0.02 + 0.05 * (k - 1), s * 0.62, 1.0 - 0.04 * k], 0.025, 0.012, "cmTassel"));
    }
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; p.push(C([0, 0, 1.2], [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 1.17], 0.025, 0.012, "cmTassel")); }
    p.push(E([0, 0, 1.36], [0.16, 0.16, 0.13], "cmPumpkin"), Y([0, 0, 1.48], 0.26, 0.012, "cmTassel"), C([0, 0, 1.48], [0, 0, 1.62], 0.11, 0.08, "cmTassel"), Y([0, 0, 1.53], 0.115, 0.02, "cmCoat"));
    // the lantern on a cord from the left wrist
    p.push(C([0.02, 0.56, 1.09], [0.02, 0.56, 0.96], 0.01, 0.01, "iron"), Y([0.02, 0.56, 0.95], 0.06, 0.012, "iron"), B([0.02, 0.56, 0.86], [0.05, 0.05, 0.08], 0.008, "lampGlow"));
    for (const x of [-0.035, 0.075]) for (const y of [0.505, 0.615]) p.push(C([x, y, 0.78], [x, y, 0.94], 0.01, 0.01, "iron"));
    return {
      prims: p, r: 0.7, h: 1.65, k: 1,
      detail: (x, y, z, m, nx) => {
        if (m === "cmPumpkin") return nx > 0.5 && jack(y, z - 1.36, 0.8) ? "cmPumpkinGlow" : Math.cos(8 * Math.atan2(y, x)) > 0.72 ? "cmPumpkinDk" : m;
        return m === "cmCoat" && z < 1.3 && P.hash(Math.floor(x * 12), Math.floor(y * 12), Math.floor(z * 12), 4) < 0.08 ? "sacking" : m;
      },
    };
  });

  // A lantern pole: a timber post with a crook, a lantern hung from it at model +x 0.22 (its glass at z 1.05;
  // its light is in the map's lights). Anchored on the ground.
  model("cm_lantern", () => {
    const p = [C([0, 0, 0], [0, 0, 1.3], 0.045, 0.04, "cmTimber"), C([0, 0, 1.28], [0.24, 0, 1.3], 0.03, 0.03, "cmTimber"), C([0.22, 0, 1.29], [0.22, 0, 1.17], 0.01, 0.01, "iron")];
    p.push(Y([0.22, 0, 1.16], 0.07, 0.015, "iron"), C([0.22, 0, 1.15], [0.22, 0, 1.2], 0.08, 0.02, "iron"), B([0.22, 0, 1.05], [0.055, 0.055, 0.085], 0.008, "lampGlow"), Y([0.22, 0, 0.955], 0.065, 0.012, "iron"));
    for (const x of [0.16, 0.28]) for (const y of [-0.06, 0.06]) p.push(C([x, y, 0.96], [x, y, 1.15], 0.01, 0.01, "iron"));
    return { prims: p, r: 0.35, h: 1.35, k: 1 };
  });

  // A pumpkin: a ribbed squat sphere (o.sz) and a curled stem, and unless o.vines is false its vine and broad
  // leaves trailing off the back (never over the face); o.carved cuts a face on model +x that glows from the
  // candle inside (its light is in the map's lights). Anchored on the ground.
  model("cm_pumpkin", (o = {}) => {
    const s = o.sz || 1, R = 0.22 * s, Z = 0.15 * s, h = (i, t) => P.hash(o.seed || 1, i, 0, t), p = [E([0, 0, Z], [R, R, Z], "cmPumpkin"), C([0, 0, Z * 1.8], [0.03 * s, 0.02 * s, Z * 2.45], 0.035 * s, 0.022 * s, "cmLeafDk")];
    if (o.vines !== false) for (let i = 0; i < 4; i++) {
      const a = TAU * (0.3 + 0.17 * i + 0.05 * h(i, 1)), c = Math.cos(a), n = Math.sin(a), d0 = R * 0.9, d1 = R + 0.2;
      p.push(C([c * d0, n * d0, 0.03], [c * d1, n * d1, 0.02], 0.04, 0.04, "cmLeafDk"), E([c * (d1 + 0.03), n * (d1 + 0.03), 0.04], [0.09, 0.09, 0.03], "cmLeaf"));
    }
    return {
      prims: p, r: o.vines === false ? R + 0.04 : R + 0.34, h: Z * 2.5, k: 1,
      detail: (x, y, z, m, nx) => {
        if (m !== "cmPumpkin") return m;
        if (o.carved && nx > 0.5 && jack(y, z - Z, s)) return "cmPumpkinGlow";
        return Math.cos(8 * Math.atan2(y, x)) > 0.72 ? "cmPumpkinDk" : m;
      },
    };
  });

  // A small tree in its autumn crown: a crooked trunk, three limbs, a lumpy crown of o.leaf (cmAppleLeaf rust,
  // cmAmber, cmScarlet) flecked with o.leaf2 and scarlet and, unless o.fruit is false, red apples in it. It
  // sways (CT.sway) and drops its leaves (CT.particles.leaves, CT.terrain.litterTree). Anchored on the ground.
  model("cm_apple", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), leaf = o.leaf || "cmAppleLeaf", leaf2 = o.leaf2 || (leaf === "cmAmber" ? "cmAppleLeaf" : "cmAmber"), p = [C([0, 0, 0], [0.08, -0.04, 0.6], 0.1, 0.075, "bark"), C([0.08, -0.04, 0.6], [0.02, 0.02, 1.0], 0.075, 0.06, "bark")];
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.4; p.push(C([0.05, -0.01, 0.8], [Math.cos(a) * 0.42, Math.sin(a) * 0.42, 1.25], 0.05, 0.03, "bark")); }
    for (let k = 0; k < 9; k++) {
      const a = TAU * (k / 9 + 0.1 * h(k, 1)), r = k === 0 ? 0 : 0.3 + 0.15 * h(k, 2), c = [Math.cos(a) * r, Math.sin(a) * r, 1.35 + 0.25 * h(k, 3) + (k === 0 ? 0.2 : 0)];
      p.push(E(c, [0.3, 0.3, 0.24], leaf));
    }
    if (o.fruit !== false) for (let k = 0; k < 9; k++) { const a = TAU * h(k, 4), r = 0.48 + 0.08 * h(k, 5); p.push(S([Math.cos(a) * r, Math.sin(a) * r, 1.15 + 0.4 * h(k, 6)], 0.05, "cmApple")); }
    return {
      prims: p, r: 0.85, h: 1.95, k: 1,
      detail: (x, y, z, m) => {
        if (m !== leaf) return m;
        const hh = P.hash(Math.floor(x * 14), Math.floor(y * 14), Math.floor(z * 14), 8);
        return hh < 0.3 ? leaf2 : hh < 0.38 && leaf !== "cmScarlet" ? "cmScarlet" : m;
      },
    };
  });

  // A sheep asleep in the pen: lying on folded legs, a lumpy fleece, a dark face and ears, facing model +x
  // turned o.a (radians); o.lamb is a smaller one. Anchored on the ground.
  model("cm_sheep", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), k = o.lamb ? 0.68 : 1, ca = Math.cos(o.a || 0), sa = Math.sin(o.a || 0);
    const at = (x, y, z) => [(x * ca - y * sa) * k, (x * sa + y * ca) * k, z * k], p = [E(at(0, 0, 0.21), [0.32 * k, 0.24 * k, 0.19 * k], "cmWool")];
    for (let i = 0; i < 7; i++) { const x = -0.22 + 0.075 * i, y = (h(i, 1) - 0.5) * 0.24; p.push(E(at(x, y, 0.3 + 0.04 * h(i, 2)), [0.12 * k, 0.12 * k, 0.1 * k], "cmWool")); }
    p.push(E(at(0.34, 0.02, 0.26), [0.1 * k, 0.075 * k, 0.085 * k], "cmFace"), C(at(0.33, 0.07, 0.32), at(0.3, 0.15, 0.3), 0.04 * k, 0.03 * k, "cmFace"), C(at(0.33, -0.04, 0.32), at(0.3, -0.12, 0.3), 0.04 * k, 0.03 * k, "cmFace"));
    for (const y of [-0.12, 0.12]) p.push(E(at(0.24, y, 0.05), [0.08 * k, 0.045 * k, 0.045 * k], "cmFace"));
    return { prims: p, r: 0.5 * k, h: 0.45 * k, k: 1 };
  });

  // A timber water trough on two feet, dark water in it and a wisp of straw at one end. Along model x,
  // anchored on the ground.
  model("cm_trough", () => {
    const p = [B([0, 0, 0.16], [0.34, 0.14, 0.1], 0.02, "cmTimber"), B([0, 0, 0.255], [0.3, 0.1, 0.012], 0.006, "cmKale")];
    for (const x of [-0.26, 0.26]) p.push(B([x, 0, 0.04], [0.04, 0.17, 0.04], 0.01, "cmTimber"));
    p.push(C([0.38, 0.08, 0.02], [0.3, 0.16, 0.12], 0.06, 0.04, "cmStraw"));
    return { prims: p, r: 0.45, h: 0.3, k: 1 };
  });

  // The hen coop: a timber hut on four stilts under a rust-red pitched roof, a warm lit window on model +x,
  // a ladder of a ramp down on model +y and a nest box of straw under it. Anchored on the ground.
  model("cm_coop", () => {
    const p = [B([0, 0, 0.62], [0.34, 0.28, 0.22], 0.02, "cmTimber")];
    for (const x of [-0.28, 0.28]) for (const y of [-0.22, 0.22]) p.push(C([x, y, 0], [x, y, 0.42], 0.04, 0.04, "cmTimber"));
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const u = (i + 0.5) / 4, y = s * 0.34 * u; p.push(C([-0.42, y, 1.05 - 0.26 * u], [0.42, y, 1.05 - 0.26 * u], 0.055, 0.055, "cmPumpkinDk")); }
    for (const s of [-1, 1]) p.push(B([s * 0.33, 0, 0.86], [0.02, 0.2, 0.06], 0.01, "cmTimber"));
    p.push(B([0.355, 0.04, 0.66], [0.012, 0.09, 0.08], 0.006, "lampGlow"), C([0.36, 0.04, 0.58], [0.36, 0.04, 0.74], 0.012, 0.012, "cmTimber"), C([0.36, -0.06, 0.66], [0.36, 0.14, 0.66], 0.012, 0.012, "cmTimber"));
    for (const x of [-0.08, 0.08]) p.push(C([x, 0.3, 0.42], [x, 0.66, 0.02], 0.03, 0.03, "cmTimber"));
    for (let i = 0; i < 4; i++) { const u = (i + 0.5) / 4; p.push(C([-0.1, 0.3 + 0.36 * u, 0.42 - 0.4 * u], [0.1, 0.3 + 0.36 * u, 0.42 - 0.4 * u], 0.02, 0.02, "cmTimber")); }
    p.push(E([-0.12, -0.05, 0.06], [0.22, 0.18, 0.06], "cmStraw"));
    // fallen leaves lying on the roof
    return { prims: p, r: 0.75, h: 1.12, k: 1, detail: (x, y, z, m) => (m === "cmPumpkinDk" && z > 0.75 && P.hash(Math.floor(x * 9), Math.floor(y * 9), Math.floor(z * 9), 12) < 0.35 ? fallen[Math.floor(P.hash(Math.floor(x * 9), Math.floor(y * 9), Math.floor(z * 9), 13) * 3)] : m) };
  });

  // Hens: o.n (3) russet hens settling for the night round a tile, plump with a red comb. Anchored on the
  // ground.
  model("cm_hen", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [];
    for (let i = 0; i < (o.n || 3); i++) {
      const a = TAU * (i / (o.n || 3) + 0.2 * h(i, 1)), r = 0.18 + 0.12 * h(i, 2), x = Math.cos(a) * r, y = Math.sin(a) * r, f = TAU * h(i, 3), c = Math.cos(f), s = Math.sin(f);
      p.push(E([x, y, 0.1], [0.12, 0.1, 0.09], "cmHen"), E([x - c * 0.1, y - s * 0.1, 0.16], [0.06, 0.06, 0.07], "cmHen"), S([x + c * 0.1, y + s * 0.1, 0.2], 0.055, "cmHen"));
      p.push(S([x + c * 0.11, y + s * 0.11, 0.26], 0.03, "cmApple"), C([x + c * 0.14, y + s * 0.14, 0.2], [x + c * 0.19, y + s * 0.19, 0.19], 0.02, 0.012, "cmAmber"));
    }
    return { prims: p, r: 0.5, h: 0.3, k: 1 };
  });

  // A row of the kitchen garden, one tile: six heads in two rows along model x, round cabbages or, with
  // o.kale, tall blue kale. Anchored on the ground.
  model("cm_cabbage", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [], m = o.kale ? "cmKale" : "cmCabbage";
    let i = 0;
    for (const y of [-0.24, 0.24]) for (const x of [-0.3, 0, 0.3]) {
      const cx = x + (h(i, 1) - 0.5) * 0.06, cy = y + (h(i, 2) - 0.5) * 0.06, s = 0.85 + 0.3 * h(i, 3);
      if (o.kale) for (let k = 0; k < 5; k++) { const a = TAU * (k / 5 + 0.1 * h(i, 4)); p.push(C([cx, cy, 0], [cx + Math.cos(a) * 0.1 * s, cy + Math.sin(a) * 0.1 * s, 0.3 * s], 0.045, 0.05, m)); }
      else { p.push(S([cx, cy, 0.1 * s], 0.09 * s, m)); for (let k = 0; k < 4; k++) { const a = TAU * (k / 4 + 0.15 * h(i, 4)); p.push(E([cx + Math.cos(a) * 0.08 * s, cy + Math.sin(a) * 0.08 * s, 0.06 * s], [0.08 * s, 0.08 * s, 0.05 * s], m)); } }
      i++;
    }
    return { prims: p, r: 0.6, h: 0.35, k: 1, detail: (x, y, z, m) => ((m === "cmCabbage" || m === "cmKale") && z < 0.04 ? "cmLeafDk" : m) };
  });

  // Sunflowers, one tile: three stalks 1.2-1.5 tall with broad leaves, their heavy heads nodding over toward
  // model +x for the night, gold petals round a dark seed face. They sway (CT.sway). Anchored on the ground.
  model("cm_sunflower", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [];
    for (let i = 0; i < 3; i++) {
      const a = TAU * (i / 3 + 0.1 * h(i, 1)), x = Math.cos(a) * 0.22, y = Math.sin(a) * 0.22, H = 1.2 + 0.3 * h(i, 2);
      p.push(C([x, y, 0], [x, y, H], 0.05, 0.04, "cmLeaf"), C([x, y, H], [x + 0.12, y, H - 0.05], 0.04, 0.035, "cmLeaf"));
      for (const [z, s] of [[0.45, 1], [0.8, -1]]) p.push(E([x + 0.02 * s, y + s * 0.14, H * z], [0.07, 0.12, 0.03], "cmLeaf"));
      p.push(E([x + 0.16, y, H - 0.13], [0.05, 0.19, 0.19], "cmPetal"), E([x + 0.2, y, H - 0.14], [0.04, 0.12, 0.12], "cmSunFace"));
    }
    return { prims: p, r: 0.6, h: 1.6, k: 1 };
  });

  // Fallen leaves, one tile: o.n (16) flat leaves strewn over it, rust, amber, scarlet, orange and brown, a
  // little bigger than life so they read at a far zoom. A stamp, so it costs no volume; scattered over the path,
  // the pen, the patch, the garden and the wall tops (below the map). Anchored on the ground.
  model("cm_leaves", (o = {}) => {
    const h = (i, s) => P.hash(o.seed || 1, i, 0, s), p = [], n = o.n || 16, L = ["cmAppleLeaf", "cmAmber", "cmScarlet", "cmPumpkin", "cmLitter"];
    for (let i = 0; i < n; i++) {
      const x = (h(i, 3) - 0.5) * 0.9, y = (h(i, 4) - 0.5) * 0.9, l = 0.07 + 0.05 * h(i, 5);
      p.push(E([x, y, 0.02], [l, l * (0.6 + 0.3 * h(i, 6)), 0.05], L[Math.floor(h(i, 7) * L.length)]));
    }
    return { prims: p, r: 0.6, h: 0.08, k: 1 };
  });

  CT.volumeDeco = (CT.volumeDeco || []).concat(["cm_corn", "cm_tallgrass", "cm_thingrass", "cm_shrub", "cm_scarecrow", "cm_lantern", "cm_pumpkin", "cm_apple", "cm_sheep", "cm_trough", "cm_coop", "cm_hen", "cm_cabbage", "cm_sunflower"]);
  // a windy night: the sway 1.4 times the calm farm's
  CT.sway = Object.assign(CT.sway || {}, { cm_corn: [0.11, 0.04, 2.6], cm_tallgrass: [0.3, 0.12, 3.4], cm_thingrass: [0.3, 0.12, 3.6], cm_shrub: [0.04, 0.014, 2.0], cm_scarecrow: [0.04, 0.014, 1.8], cm_apple: [0.06, 0.018, 2.1], cm_sunflower: [0.085, 0.028, 2.2], cm_cabbage: [0.02, 0.01, 2.6] });
  // fireflies round the lanterns, the carved pumpkins, the coop's window and the sunflowers (momiji.js's
  // particles)
  const ff = CT.particles && CT.particles.fireflies;
  if (CT.particles) CT.particles.fireflies = (p) => (ff && ff(p)) || p.name === "cm_lantern" || p.name === "cm_coop" || p.name === "cm_sunflower" || (p.name === "cm_pumpkin" && !!p.o && !!p.o.carved);
  // the autumn trees drop leaves, falling and lying on the straw round them
  const lv = CT.particles && CT.particles.leaves, lt = CT.terrain && CT.terrain.litterTree;
  if (CT.particles) CT.particles.leaves = (p) => (lv && lv(p)) || p.name === "cm_apple";
  if (CT.terrain) CT.terrain.litterTree = (d) => (lt && lt(d)) || d[0] === "cm_apple";

  // ---------------------------------------------------------------- the map
  // The field inside an octagon wall (h 2.0 at the top, 1.0 down the sides), in four terraces down from the
  // gate: the top field (1.5) with the corn and the scarecrow, the middle field (1.0), the low field (0.5)
  // and, past the ditch (0) and its footbridge, the Heart Tree's meadow by the pumpkin patch (0.5). The track
  // comes in at the north gate and zigzags down: west, south down the stairs, east along the middle field,
  // south down the stairs to the low field, back west, round the west end, east along row 15 and south over
  // the footbridge. The east gate lets onto the low field's track at row 11-12, which is
  // the same track from x 18 on; route[1] is that way in, lit by a lantern pole either side inside the gate.
  // Low rises half a step over their terrace, off the track: the top corn and the cut strip by the north gate
  // (2.0), the west rise with the amber tree, the middle corn and the east corn by the gate (1.5), the low
  // corn and grass in the south-east (1.0) and the apple tree's knoll (1.0).
  // The NE corn block on the top rise is now the sheep pen, the low corn in the south-east the kitchen garden.
  //   _ outside   # wall   : track   o . a r pasture, olive on the top field, gold-olive in the middle, amber on
  //   the low field, russet past the ditch (build tiles)   s hay rows (build tiles)   c corn   g tall grass
  //   p pumpkin patch   ~ ditch   n sheep pen   k kitchen garden
  CT.maps = CT.maps || {};
  CT.maps.cornmoon = {
    v: 1, id: "cornmoon", W: 24, H: 24, hStep: 0.5, floor: -3,
    h: [
      "000000044443344440000000", "000000444443333344000000", "000004434443333444400000", "000044333333333444440000",
      "000443333333333444444000", "004433333333333444434400", "033222222222222222222330", "333322222222222222223333",
      "333322222222222222223333", "333322222233332222223333", "333322222233332222223333", "211111111111111111111111",
      "211111111111111111111111", "211111111111111111112222", "211111111111111222222222", "211111111111111222222222",
      "221111111111111111111122", "022100000000000000001220", "002211111111111111112200", "000221111111111222122000",
      "000022111111111222220000", "000002211111111112200000", "000000221111111122000000", "000000022222222220000000",
    ],
    kind: [
      "_______####::####_______", "______##sss::ooo##______", "_____##osss::oonn##_____", "____##:::::::oonnn##____",
      "___##o:::::::oonnnn##___", "__##oo::ooooooonnnno##__", "_##...::.............##_", "##gg..:::::::::::::.cc##",
      "#ggg..:::::::::::::.ccc#", "#gggsssssscccc...::.ccc#", "#gggsssssscccc...::.ccc#", "#aaa::::::::::::::::::::",
      "#aaa::::::::::::::::::::", "#aaa::sssssssssaaaaaggg#", "#aaa:::::::::aakkkkkggg#", "#aaa:::::::::aakkkkkggg#",
      "##aasssssss::aaagggggg##", "_##a~~~~~~~~~~~~~~~~g##_", "__##rrrrrrr::rrrggrg##__", "___##gppprrrrrrrrgg##___",
      "____##ppprrrrrrrgg##____", "_____##grrrrrrrrg##_____", "______##rrrrrrrr##______", "_______##########_______",
    ],
    legend: { _: null, "#": "cmwall", ":": "cmtrack", o: "cmmeadown", ".": "cmmeadow", a: "cmmeadowa", r: "cmmeadowr", s: "cmstubble", c: "cmcorn", g: "cmtallgrass", p: "cmpatch", "~": "cmditch", n: "cmpen", k: "cmgarden" },
    // the ditch along row 17, wide enough to fill its tiles
    water: [{ seg: [4.5, 17.5, 19.5, 17.5], r: 0.48 }],
    props: [
      // the two gates the creatures come in by, open: the north one and the east one
      ["cm_gate", { swing: 1 }, 11, 0, { dx: 0.5, rot: 1 }],
      ["cm_gate", { swing: -1 }, 23, 11, { dy: 0.5 }],
      // the footbridge over the ditch where the track crosses it
      ["cm_bridge", null, 11, 17, { dx: 0.5, dz: 0.5, rot: 1 }],
      // the corn: 2×2 stands on their shared corners, single tiles to fill
      ["cm_corn", { seed: 3, w: 2 }, 20, 7, { dx: 0.5, dy: 0.5, rot: 2 }], ["cm_corn", { seed: 1, w: 1 }, 22, 8, { rot: 0 }],
      ["cm_corn", { seed: 1, w: 2 }, 10, 9, { dx: 0.5, dy: 0.5, rot: 2 }], ["cm_corn", { seed: 2, w: 2 }, 12, 9, { dx: 0.5, dy: 0.5 }], ["cm_corn", { seed: 1, w: 2 }, 20, 9, { dx: 0.5, dy: 0.5, rot: 2 }],
      ["cm_corn", { seed: 2, w: 1 }, 22, 9, { rot: 2 }],
      // the tall gold grass, unturned so it all leans downwind (more along the wall's foot, below)
      ["cm_tallgrass", { seed: 1, w: 2 }, 2, 7, { dx: 0.5, dy: 0.5 }], ["cm_tallgrass", { seed: 2, w: 1 }, 1, 8],
      ["cm_tallgrass", { seed: 3, w: 1 }, 3, 9], ["cm_tallgrass", { seed: 3, w: 1 }, 3, 10], ["cm_tallgrass", { seed: 4, w: 2 }, 20, 13, { dx: 0.5, dy: 0.5 }],
      ["cm_tallgrass", { seed: 3, w: 2 }, 20, 15, { dx: 0.5, dy: 0.5 }], ["cm_tallgrass", { seed: 4, w: 1 }, 22, 15],
      ["cm_tallgrass", { seed: 1, w: 1 }, 1, 9], ["cm_tallgrass", { seed: 2, w: 1 }, 2, 9], ["cm_tallgrass", { seed: 4, w: 1 }, 1, 10], ["cm_tallgrass", { seed: 1, w: 1 }, 2, 10],
      ["cm_tallgrass", { seed: 2, w: 1 }, 22, 13],
      // the sheep pen on the top field's rise where the corn was: straw bedding, a fence along its open sides,
      // four sheep asleep (one a lamb), a water trough and a lantern on a pole
      ["cm_fence", { seed: 4 }, 15, 2, { dx: -0.45, rot: 1 }], ["cm_fence", { seed: 1 }, 15, 2, { dy: -0.45 }],
      ["cm_fence", { seed: 2 }, 15, 5, { dy: 0.45 }], ["cm_fence", { seed: 3 }, 16, 5, { dy: 0.45 }], ["cm_fence", { seed: 4 }, 17, 5, { dy: 0.45 }], ["cm_fence", { seed: 1 }, 18, 5, { dy: 0.45 }],
      ["cm_fence", { seed: 2 }, 18, 5, { dx: 0.45, rot: 1 }],
      ["cm_sheep", { seed: 1, a: 0.4 }, 16, 3], ["cm_sheep", { seed: 2, a: 2.6 }, 17, 4], ["cm_sheep", { seed: 3, a: -0.5 }, 15, 4], ["cm_sheep", { seed: 4, a: 1.2, lamb: true }, 16, 5],
      ["cm_trough", null, 18, 4, { rot: 1 }], ["cm_lantern", null, 16, 2],
      // the kitchen garden in the low corner where the low corn was: cabbages, blue kale and sunflowers nodding
      // over the rows
      ["cm_cabbage", { seed: 1 }, 15, 14], ["cm_cabbage", { seed: 2 }, 16, 14], ["cm_cabbage", { seed: 3 }, 17, 14], ["cm_cabbage", { seed: 4 }, 17, 15],
      ["cm_cabbage", { seed: 1, kale: true }, 15, 15], ["cm_cabbage", { seed: 2, kale: true }, 16, 15],
      ["cm_sunflower", { seed: 1 }, 18, 14], ["cm_sunflower", { seed: 2 }, 19, 14], ["cm_sunflower", { seed: 3 }, 18, 15],
      // the autumn trees, their leaves falling over the field: an amber one on the west rise, a rust one in the
      // low corn, and eight more round the pasture's edges in rust, amber and scarlet, each with long tall grass
      // or a carved pumpkin at its foot (their lights below)
      ["cm_apple", { seed: 2, leaf: "cmAmber", fruit: false }, 1, 9, { dx: 0.5, dy: 0.5 }], ["cm_apple", { seed: 3, fruit: false }, 19, 15],
      ["cm_apple", { seed: 4, leaf: "cmScarlet", fruit: false }, 4, 5], ["cm_apple", { seed: 5, leaf: "cmAmber", fruit: false }, 19, 5],
      ["cm_apple", { seed: 6, fruit: false }, 1, 13], ["cm_apple", { seed: 7, leaf: "cmScarlet", fruit: false }, 2, 15],
      ["cm_apple", { seed: 8, leaf: "cmAmber", fruit: false }, 5, 18], ["cm_apple", { seed: 9, leaf: "cmScarlet", fruit: false }, 18, 18],
      ["cm_apple", { seed: 10, fruit: false }, 9, 22], ["cm_apple", { seed: 11, leaf: "cmAmber", fruit: false }, 15, 21],
      ["cm_pumpkin", { carved: true, vines: false, sz: 0.85, seed: 5 }, 4, 5, { dx: 0.32, dy: 0.12 }], ["cm_pumpkin", { carved: true, vines: false, sz: 0.85, seed: 6 }, 1, 13, { dx: 0.32, dy: 0.12 }],
      ["cm_pumpkin", { carved: true, vines: false, sz: 0.85, seed: 7 }, 18, 18, { dx: 0.32, dy: 0.12 }], ["cm_pumpkin", { carved: true, vines: false, sz: 0.85, seed: 8 }, 9, 22, { dx: 0.32, dy: 0.12 }],
      ["cm_tallgrass", { seed: 2, w: 1 }, 19, 5], ["cm_tallgrass", { seed: 3, w: 1 }, 2, 15], ["cm_tallgrass", { seed: 4, w: 1 }, 5, 18], ["cm_tallgrass", { seed: 1, w: 1 }, 15, 21],
      // the scarecrow by the top corn with the fence along it, the lantern poles by the track
      ["cm_scarecrow", null, 14, 3], ["cm_fence", { seed: 1 }, 15, 3, { dx: -0.45, rot: 1 }], ["cm_fence", { seed: 2 }, 15, 4, { dx: -0.45, rot: 1 }], ["cm_fence", { seed: 3 }, 15, 5, { dx: -0.45, rot: 1 }],
      ["cm_lantern", null, 13, 1], ["cm_lantern", null, 19, 13], ["cm_lantern", null, 13, 16], ["cm_lantern", null, 10, 18],
      // the east gate's way in, lit: a lantern pole either side of the track inside the gate, a bale by one
      ["cm_lantern", null, 22, 10, { rot: 2 }], ["cm_lantern", null, 22, 13, { rot: 2 }], ["cm_hay", null, 22, 14, { rot: 1 }],
      // the pumpkin patch on its vines, every pumpkin carved, the hen coop with its lit window and the hens
      // settling by it, the hay and the apple tree by the Heart Tree's meadow, and a lantern on the meadow's path
      ["cm_pumpkin", { carved: true, seed: 1 }, 6, 19], ["cm_pumpkin", { carved: true, sz: 1.15, seed: 2 }, 8, 19], ["cm_pumpkin", { carved: true, sz: 0.9, seed: 3 }, 7, 20], ["cm_pumpkin", { carved: true, sz: 0.8, seed: 4 }, 8, 20],
      ["cm_coop", null, 7, 19], ["cm_hen", { seed: 2 }, 6, 20],
      ["cm_hay", null, 8, 21], ["cm_apple", { seed: 1 }, 16, 19], ["cm_lantern", null, 13, 18],
      // jack-o'-lanterns: one on each bale and one at the foot of the path's lantern poles
      ["cm_pumpkin", { carved: true, vines: false, sz: 0.7, seed: 9 }, 22, 14, { dz: 0.4 }], ["cm_pumpkin", { carved: true, vines: false, sz: 0.7, seed: 10 }, 8, 21, { dz: 0.4 }],
      ["cm_pumpkin", { carved: true, vines: false, sz: 0.7, seed: 11 }, 19, 13, { dy: 0.28 }], ["cm_pumpkin", { carved: true, vines: false, sz: 0.7, seed: 12 }, 13, 16, { dy: 0.28 }],
      ["cm_pumpkin", { carved: true, vines: false, sz: 0.7, seed: 13 }, 10, 18, { dy: 0.28 }],
      // stairs where the track steps down from the top field and to the low field
      ["stairs", { H: 0.5, dir: "-y" }, 6, 6], ["stairs", { H: 0.5, dir: "-y" }, 7, 6], ["stairs", { H: 0.5, dir: "-y" }, 17, 11], ["stairs", { H: 0.5, dir: "-y" }, 18, 11],
    ],
    // the lights (in tiles): the lantern poles' glass, the scarecrow's lantern and his head's candle, the carved
    // pumpkins' faces (the patch, the tree feet, the bales, the lantern feet), the pen's lantern and the coop's
    // window
    lights: [
      { p: [16.72, 2.5, 3.05], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 }, { p: [7.92, 19.5, 1.16], r: 1.6, col: [1.0, 0.7, 0.35], k: 1.5 },
      { p: [13.72, 1.5, 2.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 }, { p: [19.72, 13.5, 1.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 },
      { p: [13.72, 16.5, 1.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 }, { p: [10.72, 18.5, 1.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 },
      { p: [22.28, 10.5, 2.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 }, { p: [22.28, 13.5, 2.05], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 },
      { p: [14.52, 4.06, 2.36], r: 1.8, col: [1.0, 0.74, 0.4], k: 1.6 },
      { p: [6.78, 19.5, 0.68], r: 1.4, col: [1.0, 0.6, 0.25], k: 1.3 }, { p: [7.76, 20.5, 0.66], r: 1.3, col: [1.0, 0.6, 0.25], k: 1.2 },
      { p: [8.81, 19.5, 0.71], r: 1.4, col: [1.0, 0.6, 0.25], k: 1.3 }, { p: [8.74, 20.5, 0.64], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 },
      { p: [13.72, 18.5, 1.55], r: 2.2, col: [1.0, 0.74, 0.4], k: 1.9 }, { p: [14.72, 3.5, 2.86], r: 1.0, col: [1.0, 0.6, 0.25], k: 1.0 },
      { p: [5.07, 5.62, 1.65], r: 1.3, col: [1.0, 0.6, 0.25], k: 1.2 }, { p: [2.07, 13.62, 0.65], r: 1.3, col: [1.0, 0.6, 0.25], k: 1.2 },
      { p: [19.07, 18.62, 0.65], r: 1.3, col: [1.0, 0.6, 0.25], k: 1.2 }, { p: [10.07, 22.62, 0.65], r: 1.3, col: [1.0, 0.6, 0.25], k: 1.2 },
      { p: [22.71, 14.5, 1.53], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 }, { p: [8.71, 21.5, 1.03], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 },
      { p: [19.71, 13.78, 0.63], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 }, { p: [13.71, 16.78, 0.63], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 },
      { p: [10.71, 18.78, 0.63], r: 1.2, col: [1.0, 0.6, 0.25], k: 1.1 },
    ],
    // Momiji's jar: the same island, drum, strata, glass and bake box
    frame: {
      type: "jar", c: [12, 12], r: 12, foot: 0.92, glassTop: 3.4,
      strata: [{ top: -1.02, ramp: "pebble", ramp2: "pebble2", gap: "charcoal", tex: "pebbles", f: 6.5, wob: 0.08 }, { top: -0.9, ramp: "charcoal", tex: "grain", wob: 0.05 }, { top: -0.58, ramp: "sphag", tex: "fiber", wob: 0.12 }],
    },
    box: { o: [-1, -1, -2.5], size: [26, 26, 10] },
    // The rules' data (the engine never reads it): the routes as polylines of tile corners (cells), route[0]
    // from the north gate and route[1] from the east gate, joining it at (18, 12); the gates' points and the
    // Heart Tree's centre in tiles; the walks; the build tiles (the corn, the tall grass and the patch are
    // not); the wet cells the route crosses on the footbridge
    game: {
      route: [
        [[12, 0], [12, 4], [7, 4], [7, 8], [18, 8], [18, 12], [5, 12], [5, 15], [12, 15], [12, 18]],
        [[23, 12], [18, 12], [5, 12], [5, 15], [12, 15], [12, 18]],
      ],
      spawn: [12.0, 0.6], spawn2: [23.4, 12.0], heart: [12, 20], lane: ["cmtrack"], build: ["cmmeadown", "cmmeadow", "cmmeadowa", "cmmeadowr", "cmstubble"],
      bridges: [[11, 17], [12, 17]],
    },
  };
  // the legend's letters for some kinds: the placement passes below find the build tiles and the grass by kind
  const chars = (kinds) => { const L = CT.maps.cornmoon.legend; return Object.keys(L).filter((ch) => kinds.includes(L[ch])).join(""); };
  // tall gold grass along the wall's foot: on about a fifth of the wall tiles that touch the field (the rest have the
  // map's blades on their cmBank top: a tall tuft is the dearer to draw), inside the jar's glass and clear of the two gates
  (function () {
    const m = CT.maps.cornmoon, K = m.kind, at = (x, y) => (K[y] && K[y][x]) || "_";
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      if (at(x, y) !== "#" || Math.hypot(x + 0.5 - 12, y + 0.5 - 12) > 11.2) continue;
      if ((y <= 2 && Math.abs(x - 11.5) <= 2.5) || (x >= 21 && Math.abs(y - 11.5) <= 2.5)) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !"#_".includes(at(x + dx, y + dy)))) continue;
      if (P.hash(x, y, 13, 3) < 0.2) m.props.push(["cm_tallgrass", { seed: 1 + ((x * 3 + y) % 4), w: 1 }, x, y]);
    }
  })();
  // the yellow grass meadows (the user: "a lot of yellow grass that waves in wind"): the pasture tiles out of
  // reach of the path (4.5 tiles or more from every road and the Heart Tree's leg) are tall grass now, one
  // tuft each; the same four seeds, so no new bricks, only instances on the existing sway
  (function () {
    const m = CT.maps.cornmoon;
    [[16, 16], [17, 16], [18, 16], [19, 16], [20, 17], [16, 18], [17, 18], [19, 18], [5, 19], [17, 19], [18, 19],
      [16, 20], [17, 20], [7, 21], [16, 21]].forEach(([x, y]) => m.props.push(["cm_tallgrass", { seed: 1 + ((x * 3 + y) % 4), w: 1 }, x, y]));
  })();
  // grass verges along the path: on about one in seven track tiles beside the pasture, hay, corn or tall grass at the same
  // height, a tuft leaning out over that side (anchored on the track, so no build tile is taken; the creatures
  // walk the track's middle line, a tile away); clear of the gates, the stairs and any tile with a prop
  (function () {
    const m = CT.maps.cornmoon, K = m.kind, Hh = m.h, at = (x, y) => (K[y] && K[y][x]) || "_", stairs = ["6,6", "7,6", "17,11", "18,11"];
    const V = chars([...m.game.build, "cmtallgrass", "cmcorn"]);
    const used = new Set(m.props.map((p) => Math.floor(p[2] + 0.5 + ((p[4] && p[4].dx) || 0)) + "," + Math.floor(p[3] + 0.5 + ((p[4] && p[4].dy) || 0))));
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      if (at(x, y) !== ":" || stairs.includes(x + "," + y) || Math.hypot(x + 0.5 - 12, y + 0.5 - 12) > 11.2) continue;
      if ((y <= 2 && Math.abs(x - 11.5) <= 2.5) || (x >= 21 && Math.abs(y - 11.5) <= 2.5)) continue;
      if (P.hash(x, y, 12, 3) >= 0.15) continue;
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => V.includes(at(x + dx, y + dy)) && Hh[y + dy][x + dx] === Hh[y][x] && !used.has(x + dx + "," + (y + dy)));
      if (side) m.props.push(["cm_tallgrass", { seed: 1 + ((x + y * 3) % 4), w: 1 }, x, y, { dx: side[0] * 0.38, dy: side[1] * 0.38 }]);
    }
  })();
  // the undergrowth (the user: "thin high and low grass ... more trees and bushes/shrubs"): seven more autumn
  // trees on the corner banks and the west grass (the option sets of the ones above, so no new bricks), shrubs
  // in rust, amber and scarlet on the corner wall tops, in the tall grass and at the trees' feet, and thin
  // grass, a tall clump on each tall-grass tile that has no tall grass yet (the tall grass's own ground and the
  // wall tops have the map's blades, CT.mapGrass), a low tuft at each tree's foot and on some of the
  // path's verges that have no tall tuft: one grass prop a tile at most, as each is ray-marched on its own (the
  // Corn Moon perf pass). Only on tiles that already take no plant (not a build kind, or a prop's tile), so the
  // placement zones stay as they were; clear of the gates and the stairs
  (function () {
    const m = CT.maps.cornmoon, K = m.kind, Hh = m.h, at = (x, y) => (K[y] && K[y][x]) || "_", stairs = ["6,6", "7,6", "17,11", "18,11"], N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const B = chars(m.game.build), V = chars([...m.game.build, "cmtallgrass", "cmcorn"]);
    const cell = (d) => Math.floor(d[2] + 0.5 + ((d[4] && d[4].dx) || 0)) + "," + Math.floor(d[3] + 0.5 + ((d[4] && d[4].dy) || 0));
    const used = new Set(m.props.map(cell)), put = (d) => { const c = cell(d), [x, y] = c.split(",").map(Number); if (!B.includes(at(x, y)) || used.has(c)) m.props.push(d); };
    const gate = (x, y) => (y <= 2 && Math.abs(x - 11.5) <= 2.5) || (x >= 21 && Math.abs(y - 11.5) <= 2.5) || stairs.includes(x + "," + y);
    const SH = [{ seed: 1, leaf: "cmAppleLeaf" }, { seed: 2, leaf: "cmAmber" }, { seed: 3, leaf: "cmScarlet" }], shrub = (x, y, dx, dy) => put(["cm_shrub", SH[(x * 2 + y) % 3], x, y, { dx, dy }]);
    [[{ seed: 8, leaf: "cmAmber", fruit: false }, 6, 2, 0.25, 0.25], [{ seed: 3, fruit: false }, 17, 2, -0.25, 0.25], [{ seed: 6, fruit: false }, 2, 6, 0.25, 0.25],
      [{ seed: 4, leaf: "cmScarlet", fruit: false }, 21, 6, -0.25, 0.25], [{ seed: 7, leaf: "cmScarlet", fruit: false }, 3, 8, 0, 0],
      [{ seed: 10, fruit: false }, 3, 18, 0.25, -0.25], [{ seed: 9, leaf: "cmScarlet", fruit: false }, 5, 20, 0.2, -0.2]].forEach(([o, x, y, dx, dy]) => put(["cm_apple", o, x, y, { dx, dy }]));
    // the corner banks, nudged toward the field; the tall grass; the trees' feet
    [[5, 3], [4, 4], [3, 5], [18, 3], [19, 4], [20, 5], [20, 18], [19, 19], [18, 20], [17, 21], [4, 19], [6, 21], [2, 17]].forEach(([x, y]) => shrub(x, y, Math.sign(11.5 - x) * 0.2, Math.sign(11.5 - y) * 0.2));
    [[2, 8], [21, 15], [21, 16], [18, 16], [19, 18], [7, 21]].forEach(([x, y]) => shrub(x, y, 0.2, -0.2));
    [[19, 5, -0.3, 0.28], [2, 15, 0.3, -0.28], [15, 21, -0.3, -0.25], [16, 19, 0.3, 0.28], [9, 22, -0.3, -0.25]].forEach(([x, y, dx, dy]) => shrub(x, y, dx, dy));
    m.props.filter((d) => d[0] === "cm_apple").map(cell).forEach((c) => { const [x, y] = c.split(",").map(Number); put(["cm_thingrass", { seed: 1 + ((x + y) % 2) }, x, y, { dx: -0.3, dy: 0.3 }]); });
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const k = at(x, y), hs = P.hash(x, y, 14, 3), s = 1 + (P.hash(x, y, 15, 3) < 0.5 ? 0 : 1), off = (i) => ({ dx: (P.hash(x, y, 16, i) - 0.5) * 0.6, dy: (P.hash(x, y, 17, i) - 0.5) * 0.6 });
      if (Math.hypot(x + 0.5 - 12, y + 0.5 - 12) > 11.2 || gate(x, y) || used.has(x + "," + y)) continue;
      if (k === "g") {
        put(["cm_thingrass", { seed: s, tall: true }, x, y, off(1)]);
      } else if (k === ":" && hs < 0.3) {
        const side = N4.find(([dx, dy]) => V.includes(at(x + dx, y + dy)) && Hh[y + dy][x + dx] === Hh[y][x]);
        if (side) put(["cm_thingrass", { seed: s }, x, y, { dx: side[0] * 0.44 - side[1] * 0.2, dy: side[1] * 0.44 + side[0] * 0.2 }]);
      }
    }
  })();
  // fallen leaves strewn everywhere that is not a build tile (the pasture has its litter): on most of the path,
  // all over the pen, the patch and the garden, and on about half the wall tops by the field; clear of the
  // gates, the stairs and the ditch
  (function () {
    const m = CT.maps.cornmoon, K = m.kind, at = (x, y) => (K[y] && K[y][x]) || "_", stairs = ["6,6", "7,6", "17,11", "18,11"];
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const k = at(x, y), hs = P.hash(x, y, 9, 3);
      if (Math.hypot(x + 0.5 - 12, y + 0.5 - 12) > 11.2 || stairs.includes(x + "," + y)) continue;
      if ((y <= 2 && Math.abs(x - 11.5) <= 2.5) || (x >= 21 && Math.abs(y - 11.5) <= 2.5)) continue;
      const wallByField = k === "#" && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !"#_".includes(at(x + dx, y + dy)));
      const on = (k === ":" && hs < 0.6) || "npk".includes(k) || (wallByField && hs < 0.45);
      if (on) m.props.push(["cm_leaves", { seed: 1 + Math.floor(P.hash(x, y, 10, 3) * 8), n: [12, 16, 20][Math.floor(P.hash(x, y, 11, 3) * 3)] }, x, y]);
    }
  })();

  // The light: a low harvest moon in the south-east (shadows long across the rows), a few broad moon shafts
  // slanting in on the track, the corn and the east gate (the lower the moon, the longer they lean; each
  // pool lands on its tile's ground), and a dusky plum fog, a darker vignette and honey beams over the
  // valley's (style.hd; shaftMul 1.4 brightens the shafts a little, 2.2 hid the fallen leaves). The fog and
  // beams were a cold blue until the redesign; warm ones carry Momiji's cosiness into the night.
  // ME.content.mapLight[id] goes over the style's L, light and hd. Until Engine's night look (E1) lands, the
  // scene keeps the style's dusk blend and backdrop.
  const CANOPY = P.r4 && P.r4.CANOPY;
  CT.mapLight = Object.assign(CT.mapLight || {}, {
    cornmoon: {
      L: [0.78, 0.46, 0.42],
      light: CANOPY ? CANOPY({ shade: 0.5, pool: 0.5, beams: [
        { x: 12.0, y: 3.0, r: 1.8, k: 1, len: 24 }, { x: 16.5, y: 8.5, r: 2.2, k: 1, len: 24 }, { x: 8.0, y: 12.0, r: 2.0, k: 1, len: 24 },
        { x: 20.5, y: 12.0, r: 1.8, k: 1, len: 24 }, { x: 13.0, y: 16.5, r: 2.0, k: 1, len: 24 }, { x: 12.5, y: 20.0, r: 1.6, k: 0.9, len: 24 },
      ] }) : null,
      hd: { bloom: 0.95, haze: 0.1, fog: [28, 22, 30], vignette: 0.45, beamCol: [255, 226, 184], shaftMul: 1.4 },
      // the night look the design asks of Engine (E1, E2); nothing reads it yet
      look: { sunCol: [0.62, 0.72, 1.0], backdrop: "night", windAz: -32, windK: 1.6 },
    },
  });
})();
