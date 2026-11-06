/* Momiji Valley content pack: the art-side tables the engine's bakers and sim read through ME.content.
   The engine (src/) knows how to voxelise, light, sway and animate things; this file says which things
   of the generator's art set are what (which materials are moss or foliage, which deco become volumes,
   how fast each prop sways, what glows). The critter models and the ambient wildlife that uses them are
   in critter-models.js and critters.js beside this file. A different art set swaps these files, not the
   engine. */
(function () {
  const ME = window.ME, C = (ME.content = ME.content || {});

  // material name -> lighting class (ME.CLS key); emissive materials (mat.em) are EMISSIVE regardless
  C.materialClass = {
    moss: "MOSS", moss2: "MOSS", mound: "MOSS", mound2: "MOSS", sphag: "MOSS",
    maple: "FOLIAGE", leaf: "FOLIAGE", leaf2: "FOLIAGE", pine: "FOLIAGE", leafDry: "FOLIAGE", gingko: "FOLIAGE",
    rock: "ROCK", stone: "ROCK", pebble: "ROCK", pebble2: "ROCK", gravel: "ROCK", sett: "ROCK", sett2: "ROCK", sett3: "ROCK",
    bark: "BARK", wood: "BARK", water: "WATER",
    hide: "SKIN", snout: "SKIN", spirit: "SKIN", cap: "SKIN", stalk: "SKIN", shell: "SKIN", shellDark: "SKIN", paper: "SKIN",
  };

  // The terrain baker's material roles in the diorama format: moss carpet and its mottling, the gravel
  // lane, stepping stones, cliff rock, soil strata, the river bed, the wooden plinth with its brass trim,
  // and the fallen leaves. litterTree says which deco drop leaves around them.
  C.terrain = {
    moss: "moss", moss2: "moss2", gravel: "gravel", stone: "stone", rock: "rock", earth: "earth", pebble: "pebble", pebble2: "pebble2", wood: "wood", brass: "brass", litter: "maple", sand: "sand",
    litterTree: (d) => (d[0] === "niwaki" || d[0] === "maple") && !/pine|green/.test(JSON.stringify(d[1] || {})),
  };
  // Ground kinds of the v1 map (docs/decisions/2026-10-21-map-format.md, section 2): a recipe and its
  // materials. Every parameter left out is today's constant in bake-terrain.js, so these bake what the
  // generator's letters bake now (content/garden-map.js maps m, u/t, w and s to them).
  C.kinds = {
    moss: { recipe: "carpet", top: "moss", mottle: "moss2", cushions: true, litter: "maple", drape: ["moss", "moss2"], overhang: "moss", under: "rock", grass: true, lamps: true },
    // the route: an ancient stone road (the user, 2026-10-24), worn setts with moss in the joints and
    // over the stones, some sunk, cracked or lost to a gravel hollow; the moss creeps in from the sides
    lane: {
      recipe: "lane", top: "gravel", edge: "moss", drape: ["moss", "moss2"], overhang: "moss", under: "rock",
      paving: { stones: ["sett", "sett2", "sett3"], joint: "moss", dirt: "earth", hole: "gravel", moss: "moss2", scale: 2.2, gap: 0.1, sunk: 0.3, missing: 0.05, cracked: 0.18, jointK: 0.3, mossK: 0.14 },
    },
    // W6 (the user: "more flow and foam", "fall into space in a voxelated spray of water and foam"): the falls
    // run faster, thicker and foam higher at each plunge; a rim spill breaks into a heavier, chunkier, foamier
    // voxel spray that falls further into the void before it is gone
    water: {
      recipe: "water", bed: ["stone", "pebble", "pebble2"], shore: "pebble", bank: "moss", drape: ["moss", "moss2"], overhang: "moss", under: "rock",
      falls: { speed: 1.6, foam: 1.8, thick: 1.3 }, spray: { n: 320, size: 1.5, foam: 0.45, fade: 3 },
    },
    sandbank: { recipe: "layer", top: "sand", depth: 0.3, under: "rock" },
  };
  // the road's setts, as explicit lists dark to light (no hue shift through the shade): weathered grey,
  // a darker worn one and one greened by lichen, all lighter than the moss so the route reads
  ME.content.ramps = Object.assign(ME.content.ramps || {}, {
    sett: ["#4c4a44", "#5e5b53", "#716d63", "#848074", "#979284", "#a9a494", "#bab5a5", "#cac6b7"],
    sett2: ["#43413c", "#535049", "#645f57", "#757066", "#878175", "#989284", "#a8a293", "#b7b2a3"],
    sett3: ["#45493c", "#555a4a", "#666b58", "#777d67", "#888e76", "#999f85", "#a9ae94", "#b8bca3"],
  });
  // The valley's look, today's renderer defaults (R.set) as content (docs/decisions/2026-10-22-engine-
  // library.md, L4): the canopy shadow, light shafts, the bell-jar glass, wind, and the forest backdrop
  C.look = { canopy: true, shafts: true, shaftK: 0.13, glass: true, glassK: 1, wind: true, windK: 1, backdrop: "forest" };
  // the palette materials of the renderer's special features (L5): the backdrop's sky ramp, the water
  // surface, the falls sheet and the leaf litter
  C.special = { sky: "sky", water: "water", fall: "fall", litter: "maple" };
  // terrain materials the engine's dig() and collapse() loosen into grains: the sand-bank tiles and the shades
  // their covers paint them in (critter-models.js, sandCover)
  C.sand = ["sand", "sand2", "sand3"];
  // edge breakup at vs 16 and up (bake-terrain.js, the voxel detail layer's PR 1): tile borders meander up to
  // 0.15 tile, cliff faces pitted 0.12 deep; lanes and water keep straight edges. For both packs (Fernglass
  // adds its kinds). Per kind (the design's PR 2, Art): the moss terraces break up most; the sand banks stay
  // soft, gently curved shores. vary: over about 7 tiles amp and rough swell and fade (their own noise), so
  // some terraces are calm ledges and others ragged, pitted and here and there overhung. laneWave: where the
  // road meets moss at its height the moss creeps onto the setts and grit into the moss (material only)
  C.edgeBreak = {
    amp: 0.15, core: 0.3, rough: 0.12, kinds: { moss: 0.15, sandbank: { amp: 0.07, rough: 0.05 } },
    vary: { scale: 7, amp: [0.25, 1.2], rough: [0, 2.2] }, laneWave: { amp: 0.1, maxDz: 1 },
  };
  // the material of a model prim that names none
  C.defaultMaterial = "stone";
  // grass tufts: the ground materials they grow on, and the blade materials
  C.grass = { ground: ["moss", "moss2", "maple", "mound", "mound2"], blade: "leaf2", blade2: "moss2", reed: "pine", dry: "leafDry" };

  // deco drawn as ray-marched volumes (trees, lanterns, the generator's sample towers) instead of being
  // stamped into the terrain; deco that walk the route instead
  C.volumeDeco = ["niwaki", "lantern", "hotaru", "puffcap", "sprout", "pine", "cedar", "maple", "bush", "fern"];
  // walkers of the route: model options, speed (tiles/s), gait (flipbook cycles per tile), hop or roll
  C.walkers = { piglet: { o: { seed: 7 }, speed: 0.62, rate: 2.2, gait: "hop" }, pillbug: { o: {}, speed: 0.42, rate: 1.6, gait: "roll" } };

  // flipbook frames of animated volumes (over the generator's animation phase o.t)
  C.flipbookFrames = { hotaru: 4, puffcap: 4, sprout: 4, piglet: 4, pillbug: 4 };
  // point lights from glowing prims of static volumes: material -> [r, g, b, intensity, radius]
  C.primLights = { glow: [1.0, 0.7, 0.36, 2.6, 2.6], firefly: [0.85, 1.0, 0.42, 1.5, 1.7], spore: [0.5, 0.95, 0.85, 1.0, 1.7], capspot: [0.5, 0.95, 0.85, 0.6, 1.7], wisp: [0.7, 0.9, 1.0, 0.6, 1.7] };
  // materials that shade the sun volume at half weight (leafy crowns let light through)
  C.sunShadeHalf = ["maple", "leaf", "leaf2", "pine"];
  // wind response per prop: [lean per unit of gust, flutter, flutter rate]
  C.sway = { niwaki: [0.05, 0.012, 2.1], pine: [0.04, 0.01, 2.4], cedar: [0.035, 0.008, 1.9], maple: [0.05, 0.012, 2.1], fern: [0.16, 0.06, 4.3], bush: [0.07, 0.03, 3.1] };
  // the size of the generator's unit models (they stand about one tile tall; build.js UNIT_K)
  C.modelScale = { lantern: 1.45, wolf: 1.6, mushroom: 1.35, mossling: 1.7, boar: 1.25, shellback: 1.2, moth: 1.35, ironclad: 1.5 };
  // Ground lamps the terrain baker lines the map with: paper andon by the lanes, little moss-capped
  // stone lamps by the water, each with its light (radius, colour, intensity, glowing material)
  C.groundLamps = {
    max: 14, spacing: 2.3,
    lane: { model: "andon", light: { r: 2.1, col: [1.0, 0.76, 0.42], k: 2.4, mat: "lanternPaper" } },
    water: { model: "forestLantern", light: { r: 1.8, col: [1.0, 0.7, 0.36], k: 2.1, mat: "candle" } },
  };
  // particle emitters from static volumes: falling leaves from maple crowns and Fernglass's orange trees,
  // fireflies round the lanterns and Fernglass's hanging lanterns (content/fernglass.js), bubbles from
  // Fernglass's pond plants (the engine reads them once it has bubbles; the water kind sets their look)
  C.particles = {
    leaves: (p) => (p.name === "niwaki" && p.o && p.o.mat === "maple") || p.name === "fg_orange",
    fireflies: (p) => p.name === "hotaru" || p.name === "lantern" || p.name === "fg_lantern",
    bubbles: (p) => p.name === "fg_eelgrass" || p.name === "fg_frond",
  };
})();
