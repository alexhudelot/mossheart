/* Renderer: GPU resources, pipelines and the frame graph.
     particles (compute) -> G-buffer [terrain mesh | ray-marched volumes | grass | leaves]
     -> lighting -> shafts (compute, half res; coarser past 1080p, R.shaftDiv) -> forward [water | falls | spray | sparks | glass]
     -> bloom -> composite
   WebGPU has no tile memory or subpasses, so each stage is its own pass; the G-buffer layout is the
   blueprint's (albedo+AO, normal+material, depth). Sun volume recomputes only when the sun moves.

   What an app (a game) can add, without the engine knowing what it means:
     opts.hooks      WGSL for the shader hooks (ME.SHADER_HOOKS: marked volumes, re-shading, overlays, wilt)
     user            Float32Array of ME.USER_SLOTS vec4s the hooks read as u.user[k], uploaded every frame
     setField(r8)    a scalar field over the map at opts.fieldRes texels per tile (hooks: fieldAt)
     setCells(rgba8) one rgba texel per map tile (hooks: cellAt)
     setLights(list) point lights on top of the scene's own
     sprites         an ME.SpriteBatch drawn in the forward pass (orbs, beams, rings, gauge bars)
     backdrop        fn(view), called in frame(): its additive sprites (view.sprites, a batch of its own) draw
                     just in front of the far plane, behind the scene, e.g. a starfield (view.far(x, y))
     addLayer(L)     a GPU layer with its own resources (ME.VoxelPhysics): L.init(R) once, L.prepare(time,
                     dt) before encoding, L.compute(pass) in the "layers" compute pass, L.gbuffer(pass)
                     after the volumes (pipelines target R.gTargets with R.gDepth); L.ripples are rings
                     on the water ({x, y, t, amp}), as a sim layer's
     carve(cells)    terrain voxels the app removed from T.grid (ME.VoxelPhysics dig, collapse): hidden in
                     the mesh, the faces they bared drawn, the density mips and sun volume updated
     pick(px, py, cam, o)  the terrain voxel or instance under a canvas pixel, on the CPU (o: terrain,
                        instances: false to skip one; accept(layer, index) to skip some instances)
     addTask(gen)    CPU work spread over the frames, a few ms each (a progressive bake's upgrade runs on it)
     weather         an ME.WeatherMix: setWeather(kind, k, s) or weather.mix(vector, s) eases clouds, wind and
                     gusts (Weather 1; rain, snow, fog reach the uniforms) on top of R.set, never writing it
     swapModel(o)    models replaced in place under the same ids, dissolved in over a fade (onSwap(key, ids)
                     tells the app; a progressive bake's upgrade calls it: ME.bakeModels, MB.prog)
   Instances come from the Sim (sim.layers). */
(function () {
  const ME = window.ME, W = ME.wgsl, GU = GPUTextureUsage, BU = GPUBufferUsage;
  const BEVEL = 0.85, BLOOM_THRESHOLD = 0.82; // fixed: the settings sweep found neither visible across its range
  const PASSES = ["prep", "layers", "gbuffer", "lighting", "shafts", "forward", "bloom", "composite"];
  const BLEND_ALPHA = { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
  const BLEND_ADD = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };
  const SPRITE_MAX = 6144, LIGHT_MAX = 255, BUBBLE_MAX = 64; // bubbles: at most 64 sprites, their own buffer
  const SPRITE_CAP = 1 << 17; // the sprite batch doubles from SPRITE_MAX up to this (6 MB)
  const RING_MAX = 48; // water rings drawn (ringBuf)
  const byBirth = (a, b) => b[2] - a[2]; // newest ring first
  const BEAM_COL = [255, 212, 146], MOON_COL = [168, 196, 244]; // the shafts' colour by day and by moonlight
  const set4 = (u, o, a, b, c, d) => { u[o] = a; u[o + 1] = b; u[o + 2] = c; u[o + 3] = d; }; // (writeUniforms: no array per vec4)
  const SPRAY_MAX = 4096; // the rim spills' spray voxels, all spills together

  // Sprite kinds of the sprite pass (W.sprites): additive and depth tested, except BAR (alpha, on top).
  ME.SPRITE = { ORB: 0, RING: 1, BEAM: 2, STREAK: 3, PUFF: 4, GROUND: 5, BAR: 10 };
  // CPU side of the sprite pass, refilled every frame: put() the additive sprites, then overlay(), then
  // the bars. 12 floats per sprite: a = point + size, b = second point (bars: w, h px + fill) + kind, c = rgba.
  // The array is kept from frame to frame and doubles when a frame fills it (up to SPRITE_CAP sprites; past
  // that put() drops them); the renderer's GPU buffer doubles with it (Renderer.growSprites).
  class SpriteBatch {
    constructor(max = SPRITE_MAX) { this.max = max; this.data = new Float32Array(max * 12); this.n = 0; this.nAdd = 0; this.nAlpha = 0; this.split = -1; }
    begin() { this.n = 0; this.split = -1; }
    grow() {
      if (this.max >= SPRITE_CAP) return false;
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data); this.data = d; this.max *= 2;
      return true;
    }
    put(ax, ay, az, size, bx, by, bz, kind, r, g, b, a) {
      if (this.n >= this.max && !this.grow()) return;
      const o = this.n++ * 12, d = this.data;
      d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = size; d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = kind;
      d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    }
    overlay() { this.split = this.n; }
    end() { this.nAdd = this.split < 0 ? this.n : this.split; this.nAlpha = this.n - this.nAdd; }
  }
  ME.SpriteBatch = SpriteBatch;
  ME.BACKDROP_Z = 0.003; // the backdrop's sprites' NDC depth (R.backdrop; 0 is the far plane)
  // G-buffer targets: albedo + AO, normal + material + aux, emissive of marked volumes. Only the volumes
  // write the third (GV); everything else keeps it masked (G). App layers draw with R.gTargets / R.gDepth.
  ME.GBUFFER = {
    G: [{ format: "rgba8unorm-srgb" }, { format: "rgba16float" }, { format: "rgba16float", writeMask: 0 }],
    GV: [{ format: "rgba8unorm-srgb" }, { format: "rgba16float" }, { format: "rgba16float" }],
    DEPTH: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
  };
  const lerpN = (a, b, u) => a + (b - a) * u;
  // look presets from the settings sweep (out/sweep1-4): overrides on top of the style's defaults
  ME.PRESETS = {
    default: {},
    cosy: { shade: 0.47, pool: 0.6, amb: 0.21, shaftK: 0.27, bloomK: 1.2, glassK: 0.45, sunEl: 0, sunAz: 10, haze: 0.09, vignette: 0.6, mottle: 1.4, exposure: 1.03 },
    morning: { shade: 0.46, amb: 0.22, shaftK: 0.28, haze: 0.1, bloomK: 1.1, glassK: 0.45, sunEl: 8, sunAz: -20 },
    clear: { shade: 0.4, pool: 0.55, amb: 0.2, shaftK: 0.16, bloomK: 1, glassK: 0.35, mottle: 1.4 },
  };

  // Every pipeline depends only on the device and the canvas format, so they compile (async, in parallel,
  // in the GPU process) while the CPU bake runs: slow phone shader compilers hide behind it. An app's
  // shader hooks (Renderer opts.hooks) are spliced in here, so it passes the same hooks to both.
  const kit = (gpu, hooks) => {
    const d = gpu.device;
    const mod = (n) => ME.shader(d, n, ME.withHooks(W[n], hooks));
    const named = (label, p) => p.catch((e) => { ME.err("PIPELINE " + label, e.message); throw e; });
    const cpm = (label, module, constants) => named(label, d.createComputePipelineAsync({ label, layout: "auto", compute: { module, entryPoint: "main", constants } }));
    const cp = (n, constants) => cpm(n, mod(n), constants);
    const DEPTH_RO = { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" };
    const rp = (label, module, o) => named(label, d.createRenderPipelineAsync(Object.assign({ label, layout: "auto", primitive: { topology: "triangle-list", cullMode: "none" } }, o, {
      vertex: Object.assign({ module, entryPoint: o.vsEntry || "vs" }, o.vertex || {}),
      fragment: o.targets === null ? undefined : { module, entryPoint: "fs", targets: o.targets, constants: o.constants },
    })));
    // the water's vertex: position, then flow x, y and stream (and with looks, the look's index)
    const water = (looked) => ({ targets: [{ format: "rgba16float", blend: BLEND_ALPHA }], depthStencil: DEPTH_RO, vertex: { buffers: [{ arrayStride: looked ? 28 : 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: looked ? "float32x4" : "float32x3" }] }] } });
    return { mod, cpm, cp, rp, DEPTH_RO, water };
  };
  ME.compilePipelines = async function (gpu, hooks = {}) {
    const { mod, cpm, cp, rp, DEPTH_RO, water } = kit(gpu, hooks);
    // G-buffer: albedo + AO, normal + material + aux, emissive of marked volumes (only the volumes write it)
    const { G, GV, DEPTH } = ME.GBUFFER;
    const P = {};
    P.sunvol = cp("sunvol"); P.partsim = cp("partsim"); P.shafts = cp("shafts"); P.canopytex = cp("canopytex");
    const blurMod = mod("blur");
    P.blurH = cpm("blurH", blurMod, { DIRX: 1 });
    P.blurV = cpm("blurV", blurMod, { DIRX: 0 });
    const terrainVB = { buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "uint16x4" }] }] };
    P.terrain = rp("terrain", mod("terrain"), { targets: G, depthStencil: DEPTH, vertex: terrainVB });
    P.terrainCarve = rp("terrainCarve", mod("terrainCarve"), { targets: G, depthStencil: DEPTH, vertex: terrainVB }); // drawn from the first Renderer.carve
    P.volume = rp("volume", mod("volume"), { targets: GV, depthStencil: DEPTH });
    P.grass = rp("grass", mod("grass"), { targets: G, depthStencil: DEPTH });
    P.leaves = rp("leaves", mod("leaves"), { targets: G, depthStencil: DEPTH });
    P.lighting = rp("lighting", mod("lighting"), { vsEntry: "vsFull", targets: [{ format: "rgba16float" }] });
    P.water = rp("water", mod("water"), water(false));
    // the falls' vertex: position, uv (along, across, height, sheet height), normal, its look's falls gains
    P.falls = rp("falls", mod("falls"), { targets: [{ format: "rgba16float", blend: BLEND_ALPHA }], depthStencil: DEPTH_RO, vertex: { buffers: [{ arrayStride: 56, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x4" }, { shaderLocation: 2, offset: 28, format: "float32x4" }, { shaderLocation: 3, offset: 44, format: "float32x3" }] }] } });
    P.spray = rp("spray", mod("spray"), { targets: [{ format: "rgba16float", blend: BLEND_ALPHA }], depthStencil: DEPTH_RO });
    P.sparks = rp("sparks", mod("sparks"), { targets: [{ format: "rgba16float", blend: BLEND_ADD }], depthStencil: DEPTH_RO });
    const spMod = mod("sprites");
    P.spriteAdd = rp("spriteAdd", spMod, { targets: [{ format: "rgba16float", blend: BLEND_ADD }], depthStencil: DEPTH_RO });
    P.spriteAlpha = rp("spriteAlpha", spMod, { targets: [{ format: "rgba16float", blend: BLEND_ALPHA }], depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "always" } });
    P.glass = rp("glass", mod("glass"), { targets: [{ format: "rgba16float", blend: BLEND_ADD }], depthStencil: DEPTH_RO, vertex: { buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }] } });
    const bd = mod("bloomDown");
    P.bloomDown0 = rp("bloomDown0", bd, { vsEntry: "vsFull", targets: [{ format: "rgba16float" }], constants: { FIRST: 1 } });
    P.bloomDown = rp("bloomDown", bd, { vsEntry: "vsFull", targets: [{ format: "rgba16float" }], constants: { FIRST: 0 } });
    P.bloomUp = rp("bloomUp", mod("bloomUp"), { vsEntry: "vsFull", targets: [{ format: "rgba16float", blend: BLEND_ADD }] });
    P.composite = rp("composite", mod("composite"), { vsEntry: "vsFull", targets: [{ format: gpu.format }] });
    const names = Object.keys(P), done = await Promise.all(Object.values(P));
    return Object.fromEntries(names.map((n, i) => [n, done[i]]));
  };
  // The variants a baked map may need in place of three of those (Renderer.init): the water and the lighting
  // of a map with water looks (W.waterL, W.lightingL), the grass of a map with flooded tiles (W.grassL). A
  // map that needs none runs exactly the shaders above, so its frames stay the same byte for byte.
  ME.compileVariants = async function (gpu, hooks = {}, want = {}) {
    const { mod, rp, water } = kit(gpu, hooks), P = {};
    if (want.looks) {
      P.water = rp("waterL", mod("waterL"), water(true));
      P.lighting = rp("lightingL", mod("lightingL"), { vsEntry: "vsFull", targets: [{ format: "rgba16float" }] });
    }
    if (want.flooded) P.grass = rp("grassL", mod("grassL"), { targets: ME.GBUFFER.G, depthStencil: ME.GBUFFER.DEPTH });
    const names = Object.keys(P), done = await Promise.all(Object.values(P));
    return Object.fromEntries(names.map((n, i) => [n, done[i]]));
  };

  // The renderer's weather (R.weather; ME.Weather is the game-side model, src/weather.js): channels eased toward
  // a target vector, the wet and snow-cover integrators, and the factors writeUniforms puts on top of R.set (it
  // never writes R.set). Until the first set() or mix() it is inactive: every factor is 1 and the gust is
  // R.set.gust's, so a scene without weather draws as before. Once active the gust is the mix's (R.set.gust
  // stays at its base 0.5). It draws the layers in draws, which ME.Sky leaves to it: Weather 1 the clouds (canopy
  // texture and light), the wind and the gusts; Weather 2 the rain (streaks in composite, wet ground and its
  // splashes in lighting, rings in the water, drops on the glass, splash() accents on the ponds). Snow and fog
  // reach the uniforms for later steps.
  const WX_CH = ["rain", "snow", "fog", "fogHeight", "cloud", "wind", "gust", "petals", "fogLow"];
  const WX_REST = { rain: 0, snow: 0, fog: 0, fogHeight: 3, cloud: 0, wind: 0.15, gust: 0.5, petals: 0, fogLow: 0 };
  const SPLASH_PER_S = 3; // splash() accents: a bucket of 3, refilled at 3 a second
  class WeatherMix {
    constructor(R) {
      this.R = R; this.active = false; this.flashK = 1; this.auto = true;
      this.draws = new Set(["cloud", "wind", "gust", "rain"]);
      this.cur = Object.assign({}, WX_REST); this.to = Object.assign({}, WX_REST);
      this.tau = 8 / 3; this.wet = 0; this.cover = 0; this.flashV = 0; this.fogBase = null;
      this.clear = new Float32Array(16);
      this.state = { kind: "clear", rain: 0, snow: 0, fog: 0, cloud: 0, wind: 0.15, wet: 0, cover: 0, flash: 0 };
      this.onFlash = null; this.onSplash = null;
      this.splashTok = SPLASH_PER_S; this.splashAcc = 0; this.seed = 0x2545f491;
    }
    // a preset at intensity k (0..1 of its full vector; the rest blends toward calm), over seconds
    set(kind, intensity = 1, seconds = 8) {
      const p = WeatherMix.PRESETS[kind];
      if (!p) throw new Error("R.setWeather: unknown kind " + kind);
      const o = this.presetV || (this.presetV = {}), k = Math.max(0, Math.min(1, +intensity || 0));
      for (const c of WX_CH) o[c] = WX_REST[c] + ((p[c] ?? WX_REST[c]) - WX_REST[c]) * k;
      o.fogBase = p.fogBase ?? null;
      this.mix(o, seconds);
      this.state.kind = kind;
    }
    // a vector of its own: missing channels go back to calm; seconds 0 jumps there
    mix(o, seconds = 8) {
      for (const c of WX_CH) { const v = o[c]; this.to[c] = v == null ? WX_REST[c] : +v; }
      if (o.fogBase !== undefined) this.fogBase = o.fogBase;
      this.tau = Math.max(0, seconds) / 3;
      if (!this.active || seconds <= 0) { this.active = true; if (seconds <= 0) Object.assign(this.cur, this.to); }
      this.state.kind = "mix";
    }
    // fog clearing i (0..3): a hole of radius r around x, y (r 0 removes it)
    setFogClear(i, x, y, r, soft = 0.5) { this.clear.set([x, y, r, soft], (i & 3) * 4); }
    // (Weather 4: lightning and the auto strikes; flash() only lights the uniform today)
    flash(k = 1) { this.flashV = Math.max(this.flashV, k * this.flashK); if (this.onFlash) this.onFlash(k); }
    // a splash accent at p (a ring and droplets from every GPU layer that splashes, ME.VoxelPhysics among them),
    // then onSplash(p, k); at most SPLASH_PER_S a second, false when the bucket is empty
    splash(p, k = 0.3) {
      if (this.splashTok < 1) return false;
      this.splashTok -= 1;
      for (const L of this.R.layers || []) if (L.splash) L.splash(p, k);
      if (this.onSplash) this.onSplash(p, k);
      return true;
    }
    rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
    // once a frame, before the sim: ease the channels (clouds and wind lead, rain and snow 30 % behind) and
    // integrate wet (~20 s of rain, ~90 s to dry) and cover (~40 s of snow, ~120 s to melt, faster in rain)
    update(time, dt) {
      if (!this.active) return;
      const c = this.cur, to = this.to, d = Math.max(0, Math.min(0.25, dt || 0));
      const a = this.tau > 0 ? 1 - Math.exp(-d / this.tau) : 1, aL = this.tau > 0 ? 1 - Math.exp(-d / (1.3 * this.tau)) : 1;
      for (const ch of WX_CH) c[ch] += (to[ch] - c[ch]) * (ch === "rain" || ch === "snow" ? aL : a);
      this.wet = c.rain > 0.02 ? Math.min(1, this.wet + d * c.rain / 20) : Math.max(0, this.wet - d / 90);
      this.cover = c.snow > 0.02 ? Math.min(1, this.cover + d * c.snow / 40) : Math.max(0, this.cover - d * (1 + 3 * c.rain) / 120);
      this.flashV = Math.max(0, this.flashV - d * 2.2);
      // the accents: auto (the default) splashes the ponds in heavy rain, 0 at rain 0.5 up to 1.5 a second at 1
      this.splashTok = Math.min(SPLASH_PER_S, this.splashTok + d * SPLASH_PER_S);
      const pt = this.R.pondTiles;
      if (this.auto && c.rain > 0.5 && pt && pt.length) {
        this.splashAcc += d * SPLASH_PER_S * 0.5 * (c.rain - 0.5) / 0.5; // (half the rate: the game keeps the rest)
        while (this.splashAcc >= 1) {
          this.splashAcc -= 1;
          const w = pt[Math.floor(this.rnd() * pt.length)];
          this.splash([w.x + 0.1 + 0.8 * this.rnd(), w.y + 0.1 + 0.8 * this.rnd(), w.z], 0.3);
        }
      } else this.splashAcc = 0;
      const s = this.state;
      s.rain = c.rain; s.snow = c.snow; s.fog = c.fog; s.cloud = c.cloud; s.wind = c.wind; s.wet = this.wet; s.cover = this.cover; s.flash = this.flashV;
    }
    // the wind's factor on R.set.windK: 1 at the calm 0.15, 2.5 when windy, 3.3 in a gale (ME.Sky's mapping)
    windF() { return this.active ? Math.max(0.3, 1 + 3 * (this.cur.wind - 0.15)) : 1; }
    gust(s) { return this.active ? Math.max(0, Math.min(1, this.cur.gust)) : ME.gustOf(s); }
    // the fog's floor: fogBase, else the lowest water, else the island's base
    base() {
      if (this.fogBase != null) return this.fogBase;
      if (this.base0 == null) { const W = this.R.S.T.water || []; let z = Infinity; for (const w of W) z = Math.min(z, w.z); this.base0 = Number.isFinite(z) ? z : this.R.ext ? this.R.ext.base : 0; }
      return this.base0;
    }
  }
  // the presets, as mix vectors (missing channels are calm)
  WeatherMix.PRESETS = {
    clear: {},
    overcast: { cloud: 0.75, wind: 0.25, gust: 0.55 },
    rain: { cloud: 0.85, rain: 0.6, fog: 0.15, wind: 0.3, gust: 0.6 },
    storm: { cloud: 1, rain: 1, fog: 0.2, wind: 0.75, gust: 0.8 },
    snow: { cloud: 0.7, snow: 0.8, fog: 0.15, wind: 0.08, gust: 0.35 },
    fog: { cloud: 0.4, fog: 0.85, fogHeight: 4, wind: 0.05, gust: 0.3 },
    mist: { fog: 0.45, fogHeight: 1.5, fogLow: 1, wind: 0.1, gust: 0.4 },
  };
  // the clouds' factors on the light per unit of cloud (the canopy texture dims the sun and the pools itself)
  WeatherMix.LIGHT = { shaftK: 0.2, exposure: 0.09, bloomK: 0.18, haze: 0.045 };
  // the rain's, per unit of rain (ME.Sky's rain entry, which it skips once the engine draws the rain); shaftK
  // keeps a thin cloud's drizzle from showing full sun shafts (Game's Subtle Showers eyeball, #455)
  WeatherMix.LIGHT_RAIN = { shaftK: 0.6, exposure: 0.1, haze: 0.02 };
  WeatherMix.DRIFT_MIN = 0.25; // the least cloud drift, as a share of the calm drift (windE[0] is 1 at calm): the clouds still creep with the wind off
  ME.WeatherMix = WeatherMix;

  class Renderer {
    constructor(gpu, S) {
      this.gpu = gpu; this.dev = gpu.device; this.S = S;
      this.u = new Float32Array(ME.USIZE);
      this.frameNo = 0; this.pinFrame = null; this.gpuMs = null; this.sunDirty = true; this.size = [0, 0];
      const st = S.st, lt = st.light, hd = st.hd || {};
      this.set = {
        shade: lt.shade ?? 0.44, pool: lt.pool ?? 0.5, amb: st.amb ?? 0.22, aoK: st.aoK ?? 0.36,
        mottle: 1, ramp: true, canopy: true, debug: 0,
        shaftK: 0.13, bloomK: hd.bloom ?? 0.85, exposure: 1.0, haze: hd.haze ?? 0.06, vignette: hd.vignette ?? 0.5,
        shafts: true, water: true, particles: true, glass: true, glassK: 1, wind: true, windK: 1, gust: 0.5, grass: true, critters: true,
        sunAz: 0, sunEl: 0, scale: 1, autoScale: true, dusk: 0, cycle: 0, // dusk, cycle: src/daycycle.js
        beamDrift: 1, moonK: 5, // the sun pools wander this far (units); the moon beams' gain at full night
      };
      this.shaftMul = hd.shaftMul ?? 1; // a map's own shaft gain (style.hd.shaftMul): out of set, so presets and moods stay relative to it
      this.set0 = Object.assign({}, this.set);
      this.L0 = st.L.slice();
      // app extension points (see the header); all empty for the plain engine scene
      this.hooks = S.hooks || {};
      this.fieldRes = S.fieldRes || 1;
      this.user = new Float32Array(4 * ME.USER_SLOTS);
      this.sprites = new SpriteBatch();
      this.backdrop = null; this.backSprites = null; // (R.backdrop: the header)
      this.layers = [];
      this.weather = new WeatherMix(this); // (R.weather, R.setWeather: WeatherMix above)
      this.windE = [1, 0.5]; // this frame's wind strength and gust share, the weather's on R.set's (windNow)
      this.drift = 0; this.driftT = null; // the cloud banks' phase: the wind strength integrated over time (frame)
    }

    addLayer(L) { this.layers.push(L); if (this.pl) L.init(this); return L; }
    setWeather(kind, intensity = 1, seconds = 8) { this.weather.set(kind, intensity, seconds); }
    // the wind the sim, the critters and the shaders see this frame: R.set's, times the weather's (gust: the mix's once active)
    windNow() { const s = this.set, w = this.windE, W = this.weather; w[0] = s.wind ? s.windK * W.windF() : 0; w[1] = W.gust(s); return w; }

    // resets every preset-controlled value to the style default, then applies the preset's overrides
    applyPreset(name) {
      const p = ME.PRESETS[name];
      if (!p) return false;
      for (const q of Object.values(ME.PRESETS)) for (const k in q) this.set[k] = this.set0[k];
      Object.assign(this.set, p);
      return true;
    }

    // (the elevation clamp bounds sunRegion's sweep along the sun ray: L.z >= sin 0.2)
    // (into o if given: no allocation)
    sunDir(o = [0, 0, 0]) {
      const x = this.L0[0], y = this.L0[1], z = this.L0[2], az = (this.set.sunAz * Math.PI) / 180, el0 = Math.asin(z), el = Math.max(0.2, Math.min(1.45, el0 + (this.set.sunEl * Math.PI) / 180));
      const a0 = Math.atan2(y, x) + az;
      o[0] = Math.cos(el) * Math.cos(a0); o[1] = Math.cos(el) * Math.sin(a0); o[2] = Math.sin(el);
      return o;
    }

    async init() {
      const d = this.dev, S = this.S, T = S.T, MB = S.MB;
      // ---------------- static resources
      this.ubuf = d.createBuffer({ label: "uniforms", size: ME.USIZE * 4, usage: BU.UNIFORM | BU.COPY_DST });
      this.matBuf = ME.buffer(d, S.tables.mats, BU.STORAGE, "mats");
      this.rampTex = d.createTexture({ label: "ramps", size: [16, 256], format: "rgba8unorm-srgb", usage: GU.TEXTURE_BINDING | GU.COPY_DST });
      d.queue.writeTexture({ texture: this.rampTex }, S.tables.ramps, { bytesPerRow: 64 }, [16, 256]);
      this.densTex = ME.tex3d(d, "density", "r8unorm", [T.NX >> 1, T.NY >> 1, T.NZ >> 1], T.mips, 1); // half-res base: terrain shading never needed full res
      T.mips = null; // on the GPU now; carve recomputes the region it changes from T.grid (58 MB at vs40)
      this.occTex = ME.tex3d(d, "coarse", "r8unorm", T.cdims, [T.coarse], 1);
      this.sunTex = d.createTexture({ label: "sunvol", size: T.cdims, dimension: "3d", format: "rgba8unorm", usage: GU.STORAGE_BINDING | GU.TEXTURE_BINDING | GU.COPY_SRC });
      this.sunBoxBuf = d.createBuffer({ label: "sunvol box", size: 32, usage: BU.UNIFORM | BU.COPY_DST }); this.sunQ = []; this.sunCells = 0; this.sunSlabs = 0; this.sunWhole = 0;
      // canopy light, evaluated once per frame over the canopy plane and sampled by lighting, shafts and water
      const CN = ME.qn("cantex", 512);
      this.canTex = d.createTexture({ label: "canopy", size: [CN, CN], format: "rgba8unorm", usage: GU.STORAGE_BINDING | GU.TEXTURE_BINDING });
      this.canV = this.canTex.createView();
      this.atlasTex = ME.tex3d(d, "brick pool", "rgba8unorm", MB.adims, [MB.atlas], 4);
      this.brickTex = ME.tex3d(d, "bricks", "r32uint", MB.bdims, [MB.bricks], 4);
      // the models, then their 2x-down copies (MB.lods), then the spare entries a swap dissolves from (R.swapModel:
      // MB.prog.maxGroup of them), 16 u32 each (W.volume's Model): base.xyz the atlas corner, base.w its voxels' low
      // bound lo (10 bits an axis), dims.xyz their high bound hi (the proxy box spans lo..hi), dims.w the copy's
      // entry, 0 for none (a bake from before the LOD has no MB.lods); ext and off zero but while a swap fades
      const nm = MB.models.length, nl = (MB.lods || []).length;
      this.mdl = new Uint32Array((nm + nl + (MB.prog ? MB.prog.maxGroup : 0)) * 16); this.mdlF = new Float32Array(this.mdl.buffer);
      this.putModels();
      this.modelBuf = ME.buffer(d, this.mdl, BU.STORAGE, "models");
      this.instBuf = d.createBuffer({ label: "instances", size: S.sim.inst.byteLength, usage: BU.STORAGE | BU.COPY_DST });
      this.tVB = ME.buffer(d, S.mesh.verts, BU.VERTEX, "terrain vb");
      this.tIB = ME.buffer(d, S.mesh.index, BU.INDEX, "terrain ib");
      // the frame's extent: the jar's centre, glass radius, glass top, dome height and plinth foot, or the
      // box's centre, half sides, half diagonal, top and floor (a bake from before T.frame is a jar)
      const F = T.frame || { type: "jar", c: [T.geo.C, T.geo.C] }, g = T.geo, b = T.bounds;
      this.ext = F.type === "jar"
        ? { jar: true, c: F.c, R: g.RG, top: g.glassZt, dome: 7.2 * (g.RI / 7), base: g.PL_ZB, foot: g.PL_ZT, RI: g.RI }
        : { jar: false, c: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], half: [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2], R: Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2, top: b.max[2], dome: 0, base: b.min[2] };
      this.buildWater(); this.buildGlass(); this.buildParticles(); this.buildLights();
      this.grassBuf = ME.buffer(d, S.grass.blades, BU.STORAGE, "grass blades");
      const map = S.st.map;
      this.fieldDims = [map.W * this.fieldRes, map.H * this.fieldRes];
      this.fieldTex = d.createTexture({ label: "app field", size: this.fieldDims, format: "r8unorm", usage: GU.TEXTURE_BINDING | GU.COPY_DST });
      this.cellTex = d.createTexture({ label: "app cells", size: [map.W, map.H], format: "rgba8unorm", usage: GU.TEXTURE_BINDING | GU.COPY_DST });
      this.spriteBuf = d.createBuffer({ label: "sprites", size: this.sprites.max * 48, usage: BU.STORAGE | BU.COPY_DST });
      this.bubbleBuf = d.createBuffer({ label: "bubbles", size: BUBBLE_MAX * 48, usage: BU.STORAGE | BU.COPY_DST });
      this.lin = d.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });

      // ---------------- pipelines (compile started right after the device: ME.compilePipelines, same hooks)
      let P = await (S.pipelines || ME.compilePipelines(this.gpu, this.hooks));
      if (this.looked || this.flooded) P = Object.assign({}, P, await ME.compileVariants(this.gpu, this.hooks, { looks: this.looked, flooded: this.flooded }));
      this.pl = P;
      this.gTargets = ME.GBUFFER.G; this.gDepth = ME.GBUFFER.DEPTH; // app layers (ME.VoxelPhysics) draw into the G-buffer

      // ---------------- static bind groups
      const bg = (pl, group, entries) => d.createBindGroup({ layout: pl.getBindGroupLayout(group), entries: entries.map((r, i) => ({ binding: i, resource: r })) });
      this.bg = bg;
      this.g0 = {};
      for (const k in P) this.g0[k] = bg(P[k], 0, [{ buffer: this.ubuf }]);
      const sunV = this.sunTex.createView(), dens = this.densTex.createView();
      this.g1 = {
        sunvol: bg(P.sunvol, 1, [this.occTex.createView(), this.lin, sunV, { buffer: this.sunBoxBuf }]),
        canopytex: bg(P.canopytex, 1, [this.canV]),
        partsim: bg(P.partsim, 1, [{ buffer: this.partBuf }, { buffer: this.srcBuf }, dens, this.lin]),
        terrain: bg(P.terrain, 1, [dens, this.lin, { buffer: this.matBuf }]),
        volume: bg(P.volume, 1, [this.atlasTex.createView(), this.brickTex.createView(), { buffer: this.instBuf }, { buffer: this.modelBuf }, { buffer: this.matBuf }]),
        leaves: bg(P.leaves, 1, [{ buffer: this.partBuf }, { buffer: this.matBuf }]),
        grass: bg(P.grass, 1, [{ buffer: this.grassBuf }, { buffer: this.matBuf }, this.fieldTex.createView(), this.lin, ...(this.flooded ? [{ buffer: this.wcellBuf }] : [])]),
        bubbles: bg(P.spriteAdd, 1, [{ buffer: this.bubbleBuf }]),
        spriteAdd: bg(P.spriteAdd, 1, [{ buffer: this.spriteBuf }]),
        spriteAlpha: bg(P.spriteAlpha, 1, [{ buffer: this.spriteBuf }]),
        falls: bg(P.falls, 1, [sunV, this.lin, this.rampTex.createView(), this.canV]),
        sparks: bg(P.sparks, 1, [{ buffer: this.partBuf }]),
        spray: bg(P.spray, 1, [{ buffer: this.partBuf }, { buffer: this.srcBuf }, this.rampTex.createView(), this.lin]),
      };
      // ---------------- timestamps
      if (this.gpu.features.has("timestamp-query")) {
        this.qs = d.createQuerySet({ type: "timestamp", count: PASSES.length * 2 });
        this.qResolve = d.createBuffer({ size: PASSES.length * 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
        this.qRead = d.createBuffer({ size: PASSES.length * 16, usage: BU.MAP_READ | BU.COPY_DST });
        this.qBusy = false;
      }
      for (const L of this.layers) L.init(this);
      // a progressive bake's upgrade (ME.bakeModels: the full-density models after the coarse ones), over the frames
      if (MB.prog && !MB.prog.started) { MB.prog.started = true; this.addTask(MB.prog.gen(this)); }
    }

    // Entry i of the model buffer (the first 8 u32: a swap's ext and off stay): model or copy m, w its copy's entry
    putEntry(i, m, w) {
      const lo = m.lo || [0, 0, 0], hi = m.hi || m.dims, u = this.mdl, o = i * 16;
      if (m.dims.some((n) => n >= 1024)) throw new Error(`a volume of ${m.dims} voxels: the model buffer packs its bounds in 10 bits an axis`);
      u[o] = m.base[0]; u[o + 1] = m.base[1]; u[o + 2] = m.base[2]; u[o + 3] = lo[0] | (lo[1] << 10) | (lo[2] << 20);
      u[o + 4] = hi[0]; u[o + 5] = hi[1]; u[o + 6] = hi[2]; u[o + 7] = w;
    }
    putModels() {
      const MB = this.S.MB, lods = MB.lods || [], nm = MB.models.length;
      MB.models.forEach((m, i) => this.putEntry(i, m, m.lod >= 0 && lods[m.lod] ? nm + m.lod : 0));
      lods.forEach((m, j) => this.putEntry(nm + j, m, 0));
    }
    // MB.models and MB.lods again into the model buffer (a model's lod, lo or hi changed: no swap, no fade)
    refreshModels() { this.putModels(); this.dev.queue.writeBuffer(this.modelBuf, 0, this.mdl); }

    // Work spread over frames: gen, a generator, steps at the start of R.frame (before the Sim writes the
    // instances, so a step's swap draws that same frame) for up to ME.TASK_MS (3 ms) a frame, all tasks together.
    // It yields to go on, "frame" to stop until the next frame, or a promise to wait for (its value is what that
    // yield returns, its rejection is thrown there). Returns a promise of gen's return value; a throw is logged
    // (ME.err) and rejects it. this.taskStat: { frames, ms, max }, the frames that ran a step and their ms
    // (a step longer than the budget runs to its end: max says how long the longest frame's share was).
    addTask(gen) {
      return new Promise((res, rej) => (this.tasks || (this.tasks = [])).push({ gen, res, rej, wait: false, v: undefined, e: null }));
    }
    runTasks() {
      const ts = this.tasks;
      if (!ts || !ts.length || ts.every((t) => t.wait)) return;
      const t0 = ME.now(), end = t0 + (ME.TASK_MS ?? 3), st = this.taskStat || (this.taskStat = { frames: 0, ms: 0, max: 0 });
      try { this.stepTasks(ts, end); } finally { const d = ME.now() - t0; st.frames++; st.ms += d; if (d > st.max) st.max = d; }
    }
    stepTasks(ts, end) {
      for (let k = 0; k < ts.length && ME.now() < end; k++) {
        const t = ts[k];
        while (!t.wait && ME.now() < end) {
          let r;
          try { r = t.e ? t.gen.throw(t.e) : t.gen.next(t.v); } catch (e) { ME.err("TASK", e && e.message); t.rej(e); ts.splice(k--, 1); break; }
          t.e = null; t.v = undefined;
          if (r.done) { t.res(r.value); ts.splice(k--, 1); break; }
          const y = r.value;
          if (y === "frame") break;
          if (y && typeof y.then === "function") { t.wait = true; y.then((v) => { t.wait = false; t.v = v; }, (e) => { t.wait = false; t.e = e || new Error("a task's promise was rejected"); }); }
        }
      }
    }

    // A swap (R.swapModel) after a progressive bake writes its bricks into the pool and the brick map as they are on
    // the CPU (MB.atlas, MB.bricks), a brick z-layer of the pool or a box of the map at a time
    uploadPool(bz) {
      const MB = this.S.MB, [PX, PY] = MB.adims, layer = PX * PY * 8 * 4;
      this.dev.queue.writeTexture({ texture: this.atlasTex, origin: [0, 0, bz * 8] }, MB.atlas, { offset: bz * layer, bytesPerRow: PX * 4, rowsPerImage: PY }, [PX, PY, 8]);
    }
    uploadBricks(b) { // b: [x0, y0, z0, x1, y1, z1] in bricks, x1.. exclusive
      const MB = this.S.MB, [BX, BY] = MB.bdims;
      this.dev.queue.writeTexture({ texture: this.brickTex, origin: [b[0], b[1], b[2]] }, MB.bricks, { offset: ((b[2] * BY + b[1]) * BX + b[0]) * 4, bytesPerRow: BX * 4, rowsPerImage: BY }, [b[3] - b[0], b[4] - b[1], b[5] - b[2]]);
    }
    // the palette again after it grew (a swapped-in model brought new materials): the material table, the ramps,
    // and each layer's copy (L.refreshMats). The tables keep their size (256 materials), so the bind groups stay
    refreshPalette(pal) {
      const S = this.S, d = this.dev;
      S.tables = pal.build();
      d.queue.writeBuffer(this.matBuf, 0, S.tables.mats);
      d.queue.writeTexture({ texture: this.rampTex }, S.tables.ramps, { bytesPerRow: 64 }, [16, 256]);
      for (const L of this.layers) if (L.refreshMats) L.refreshMats();
    }

    // Swaps models in place: model ids[n] (an index into MB.models, the id instances draw it by) becomes models[n],
    // a record like MB.models' (its bricks already in the pool and the brick map, uploaded), and its 2x-down copy
    // (MB.lods[its lod]) lods[n]. The new model may differ in box and voxel scale (kf): its entry draws the old
    // one's voxels, mapped onto its own, on a dither that hands every pixel over to it in fade ms (default 400),
    // so the switch neither hitches nor pops. MB.models' records change in place (MB.voxel, its sampler, is made
    // again), every static is written again (the Sim's still stamps cleared), and this.onSwap(key, ids) tells
    // the app (a box it keeps per model must be read again). Returns a promise, resolved when the fade is done;
    // the old bricks are in use until then. One swap fades at a time, of at most MB.prog.maxGroup models.
    swapModel({ key = null, ids, models, lods = [], fade = 400 }) {
      const S = this.S, MB = S.MB, nm = MB.models.length, nl = (MB.lods || []).length, spare = this.mdl.length / 16 - nm - nl;
      if (this.fading) throw new Error("R.swapModel: a swap is still fading (one at a time: await the last one)");
      if (ids.length > spare) throw new Error(`R.swapModel: ${ids.length} models against ${spare} spare entries (MB.prog.maxGroup)`);
      const u = this.mdl, F = this.mdlF, ents = [];
      const ext = (e, o, off, w) => { u[e * 16 + 8] = 1 + o; F[e * 16 + 9] = 0; F[e * 16 + 12] = off[0]; F[e * 16 + 13] = off[1]; F[e * 16 + 14] = off[2]; F[e * 16 + 15] = w; ents.push(e); };
      ids.forEach((id, n) => {
        const m = MB.models[id], o = nm + nl + n, nw = models[n], K = (m.kf || 1) / (nw.kf || 1);
        // the old entry, kept in a spare one (no copy of its own: dims.w 0); off: its voxels l to the new model's,
        // (l + off) K, from the two placements (src/sim.js put: a voxel's scale is 1 / (VS / kf))
        u.copyWithin(o * 16, id * 16, id * 16 + 7); u.fill(0, o * 16 + 7, o * 16 + 16);
        const off = [0, 1, 2].map((a) => m.box[a] - nw.box[a] / K);
        if (!("kf" in nw)) delete m.kf;
        Object.assign(m, nw);
        const j = m.lod >= 0 && MB.lods[m.lod] ? m.lod : -1;
        this.putEntry(id, m, j >= 0 ? nm + j : 0); ext(id, o, off, K);
        // its copy draws the same old entry: the copy's voxel is two of the model's
        if (j >= 0) { if (lods[n]) Object.assign(MB.lods[j], lods[n]); this.putEntry(nm + j, MB.lods[j], 0); ext(nm + j, o, off, K / 2); }
      });
      this.dev.queue.writeBuffer(this.modelBuf, 0, u);
      MB.voxel = ME.brickVoxel(MB);
      if (S.sim && S.sim.stillAt) S.sim.stillAt.fill(-1);
      if (this.onSwap) this.onSwap(key, ids);
      return new Promise((res) => { this.fading = { t0: ME.now(), ms: Math.max(1, fade), ents, res }; });
    }
    // the fading swap's share of new pixels, written each frame; at 1 its entries are plain again (ext, off 0)
    fadeStep() {
      const f = this.fading;
      if (!f) return;
      const a = Math.min(1, (ME.now() - f.t0) / f.ms), u = this.mdl;
      for (const e of f.ents) {
        if (a < 1) this.mdlF[e * 16 + 9] = a; else u.fill(0, e * 16 + 8, e * 16 + 16);
        this.dev.queue.writeBuffer(this.modelBuf, e * 64 + 32, u, e * 16 + 8, 8);
      }
      if (a >= 1) { this.fading = null; f.res(); }
    }

    buildWater() {
      const d = this.dev, T = this.S.T, map = this.S.st.map;
      const wv = [], wi = [], at = new Map(T.water.map((w) => [w.x + "," + w.y, w]));
      // flow and stream weight per corner, averaged over the wet tiles at the same level sharing it,
      // so the current bends smoothly instead of jumping at tile edges
      const corner = (x, y, z) => {
        let fx = 0, fy = 0, st = 0, n = 0;
        for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const w = at.get(x + ox + "," + (y + oy));
          if (w && Math.abs(w.z - z) < 0.01) { fx += w.fx; fy += w.fy; st += w.stream; n++; }
        }
        return [fx / n, fy / n, st / n];
      };
      // a map with water looks (T.looks) or flooded tiles draws with the shader variants (ME.compileVariants)
      const looks = T.looks || [null], VN = (this.looked = looks.length > 1) ? 7 : 6;
      this.flooded = (T.stats.flooded || 0) > 0;
      for (const w of T.water) {
        const b = wv.length / VN;
        for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          wv.push(w.x + dx, w.y + dy, w.z, ...corner(w.x + dx, w.y + dy, w.z));
          if (this.looked) wv.push(w.look || 0);
        }
        wi.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      // water surface height per map cell for the caustics; with looks, two more planes: each cell's caustic
      // gain and how much its water dims the floor with depth (1 and 1: today's water)
      const NC = map.W * map.H, lev = new Float32Array(this.looked ? NC * 3 : NC).fill(-99);
      if (this.looked) lev.fill(1, NC);
      for (const w of T.water) {
        const c = w.y * map.W + w.x, L = looks[w.look || 0];
        lev[c] = w.z;
        if (L) { lev[NC + c] = L.caustics; lev[2 * NC + c] = 1 - 0.8 * L.clarity; }
      }
      this.wl = { W: map.W, H: map.H };
      this.wlevBuf = ME.buffer(d, lev, BU.STORAGE, "water levels");
      // the looks for the water pass, two vec4 each: clarity, absorb, calm, glint | tint, caustics (look 0
      // unused; looks 1 to 8, LOOK_MAX)
      if (this.looked) {
        const lk = new Float32Array(looks.length * 8);
        looks.forEach((L, i) => { if (L) lk.set([L.clarity, L.absorb, L.calm, L.glint, ...L.tint, L.caustics], i * 8); });
        this.lookBuf = ME.buffer(d, lk, BU.STORAGE, "water looks");
      }
      // per map cell for the grass: the water level and its flow (blades under it sway with the current)
      if (this.flooded) {
        const wc = new Float32Array(NC * 4).fill(0);
        for (let c = 0; c < NC; c++) wc[c * 4] = -99;
        for (const w of T.water) wc.set([w.z, w.fx, w.fy, 0], (w.y * map.W + w.x) * 4);
        this.wcellBuf = ME.buffer(d, wc, BU.STORAGE, "water cells");
      }
      this.buildBubbles();
      this.ringBuf = d.createBuffer({ label: "rings", size: RING_MAX * 16, usage: BU.STORAGE | BU.COPY_DST });
      this.ringData = new Float32Array(RING_MAX * 4); this.ringQ = { pool: [], n: 0, live: [] }; // this frame's ring candidates, pooled [x, y, t0, amp]
      this.ripples = { n: 0 };
      this.pondTiles = T.water.filter((w) => !w.stream);
      const fv = [], fi = [];
      for (const f of T.falls) {
        const b = fv.length / 14, L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), H = f.ztop - f.zbot, k = this.fallsLook(f).falls, n = [f.n[0], f.n[1], 0, 0, k.speed, k.foam, k.thick];
        fv.push(f.a[0], f.a[1], f.zbot, 0, 0, 0, H, ...n, f.b[0], f.b[1], f.zbot, L, 1, 0, H, ...n, f.b[0], f.b[1], f.ztop, L, 1, H, H, ...n, f.a[0], f.a[1], f.ztop, 0, 0, H, H, ...n);
        fi.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      this.water = { vb: ME.buffer(d, new Float32Array(wv.length ? wv : new Array(VN).fill(0)), BU.VERTEX, "water vb"), ib: ME.buffer(d, new Uint32Array(wi.length ? wi : [0, 0, 0]), BU.INDEX, "water ib"), n: wi.length };
      this.falls = { vb: ME.buffer(d, new Float32Array(fv.length ? fv : new Array(14).fill(0)), BU.VERTEX, "falls vb"), ib: ME.buffer(d, new Uint32Array(fi.length ? fi : [0, 0, 0]), BU.INDEX, "falls ib"), n: fi.length };
    }
    // a falls' style (its water kind's falls and spray, f.fk), today's values for plain water
    fallsLook(f) { return f.fk || (this.lookNone ??= ME.waterLook({})); }
    // where beam i's pool sits at time: its foot point wandering on two slow sines, about a minute and a half a
    // loop, by its own drift (b.drift, units) or R.set.beamDrift. The shaft pass and the critters both read it.
    // (into o if given: no allocation)
    beamAt(i, time, o = [0, 0]) {
      const b = this.S.T.beams[i], dr = b.drift ?? this.set.beamDrift, ph = i * 2.39;
      o[0] = b.x + dr * Math.sin(time * 0.071 + ph); o[1] = b.y + dr * 0.8 * Math.sin(time * 0.053 + ph * 1.7 + 1);
      return o;
    }

    // Bubbles, for water whose look has them (water kinds' bubbles): emitters at the props the content picks
    // (ME.content.particles.bubbles), at the falls' feet and one seep per wet tile; ME.water.bubble adds one.
    buildBubbles() {
      const T = this.S.T, H = window.PX.hash, map = this.S.st.map, looks = T.looks || [null], emit = (ME.content && ME.content.particles) || {};
      const at = new Map(T.water.map((w) => [w.y * map.W + w.x, w])), wAt = (x, y) => at.get(Math.floor(y) * map.W + Math.floor(x));
      const em = [], add = (x, y, z0, w, perMin) => { const L = looks[w.look || 0]; if (L && L.bubbles && perMin > 0 && w.z - z0 > 0.05) em.push({ x, y, z0, zs: w.z, rate: perMin / 60, L }); };
      if (looks.some((L) => L && L.bubbles)) {
        if (emit.bubbles) for (const s of this.S.MB.statics) { const p = s.place, w = wAt(p.X, p.Y), L = w && looks[w.look || 0]; if (L && L.bubbles && emit.bubbles(p)) add(p.X, p.Y, p.Z + 0.05, w, L.bubbles.rate); }
        for (const f of T.falls) {
          const x = (f.a[0] + f.b[0]) / 2 + f.n[0] * 0.2, y = (f.a[1] + f.b[1]) / 2 + f.n[1] * 0.2, w = wAt(x, y), L = w && looks[w.look || 0];
          if (L && L.bubbles) add(x, y, T.groundAt(x, y, w.z), w, L.bubbles.rate);
        }
        for (const w of T.water) {
          const L = looks[w.look || 0];
          if (L && L.bubbles && L.bubbles.seep > 0) { const x = w.x + 0.15 + 0.7 * H(w.x, w.y, 1, 47), y = w.y + 0.15 + 0.7 * H(w.x, w.y, 2, 47); add(x, y, T.groundAt(x, y, w.z), w, L.bubbles.seep); }
        }
      }
      this.bubbleEm = em; this.bubbleExtra = []; this.bubbleData = new Float32Array(BUBBLE_MAX * 12); this.bubbleN = 0;
      this.bubbleAt = wAt;
      ME.water = Object.assign(ME.water || {}, { bubble: (x, y, z) => this.addBubble(x, y, z) });
    }
    // one bubble, only in water whose kind has bubbles (a koi in Momiji's pond adds none)
    addBubble(x, y, z) {
      const w = this.bubbleAt && this.bubbleAt(x, y), L = w && (this.S.T.looks || [])[w.look || 0];
      if (!L || !L.bubbles || w.z - z < 0.03 || this.bubbleExtra.length >= 16) return false;
      this.bubbleExtra.push({ x, y, z0: z, zs: w.z, t0: this.time ?? 0, L, b: L.bubbles });
      return true;
    }
    // the bubbles alive at time (deterministic: each emitter's j-th bubble is born at a hashed time), at most
    // BUBBLE_MAX sprites; their pops go into the water rings
    updateBubbles(time) {
      const H = window.PX.hash, VS = this.S.T.VS, d = this.bubbleData, POP = 0.4;
      let n = 0;
      const put = (x, y, z, size, c, k, kind) => {
        if (n >= BUBBLE_MAX) return;
        const o = n++ * 12;
        d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = x; d[o + 5] = y; d[o + 6] = z; d[o + 7] = kind;
        d[o + 8] = c[0] * k; d[o + 9] = c[1] * k; d[o + 10] = c[2] * k; d[o + 11] = 1;
      };
      const one = (x0, y0, z0, zs, b, L, t0, key) => {
        const life = (zs - z0) / b.rise, age = time - t0;
        if (age < 0) return;
        if (age > life) { if (age - life < 2.6) this.ring(x0, y0, t0 + life, 0.05); }
        if (age > life + POP) return;
        const sz = ((b.size[0] + (b.size[1] - b.size[0]) * H(key, 1, 0, 53)) / VS) * 0.5, ph = H(key, 2, 0, 53) * 6.283, wob = 0.025 * Math.min(1, age * 2);
        const x = x0 + Math.sin(age * 7 + ph) * wob, y = y0 + Math.cos(age * 6 + ph * 1.3) * wob;
        if (age <= life) { const z = z0 + age * b.rise; put(x, y, z, sz * (1 + (0.3 * age) / life), b.colour, 0.3 + 0.5 * Math.exp(-(zs - z) / L.absorb), ME.SPRITE.RING); }
        else { const u = (age - life) / POP; put(x, y, zs + 0.004, sz * (1.2 + 2.5 * u), b.colour, 0.55 * (1 - u), ME.SPRITE.GROUND); }
      };
      this.bubbleEm.forEach((E, e) => {
        const b = E.L.bubbles, life = (E.zs - E.z0) / b.rise, j1 = Math.floor(time * E.rate), back = Math.ceil((life + 2.6) * E.rate) + 1;
        for (let j = j1; j >= j1 - back; j--) one(E.x + (H(e, j, 3, 53) - 0.5) * 0.16, E.y + (H(e, j, 4, 53) - 0.5) * 0.16, E.z0, E.zs, b, E.L, (j + 0.8 * H(e, j, 0, 53)) / E.rate, e * 7919 + j);
      });
      const X = this.bubbleExtra;
      let m = 0;
      for (let k = 0; k < X.length; k++) if (time - X[k].t0 < (X[k].zs - X[k].z0) / X[k].b.rise + 2.6) X[m++] = X[k];
      X.length = m;
      for (let k = 0; k < m; k++) { const B = X[k]; one(B.x, B.y, B.z0, B.zs, B.b, B.L, B.t0, 9e6 + k); }
      this.bubbleN = n;
    }
    // one water ring for this frame (updateRings), into the pool: [x, y, birth time, amplitude]
    ring(x, y, t0, amp) {
      const Q = this.ringQ, r = Q.pool[Q.n] || (Q.pool[Q.n] = [0, 0, 0, 0]);
      r[0] = x; r[1] = y; r[2] = t0; r[3] = amp; Q.n++;
    }

    // Water rings for this frame: steady ones where the falls plunge and the odd insect touching the
    // still water (derived from time, so frozen-time shots get them too), plus critter splashes.
    // (The candidates go into a pool, ring(), so a frame allocates nothing once the pool has grown.)
    updateRings(time) {
      const H = window.PX.hash, T = this.S.T, Q = this.ringQ;
      Q.n = 0;
      for (let i = 0; i < T.falls.length; i++) {
        const f = T.falls[i];
        // a look's foam gain above 1 lands them more often
        const fm = Math.max(1, this.fallsLook(f).falls.foam), P = 0.55 / fm, j0 = Math.floor(time / P + i * 0.37);
        for (let j = j0 - Math.ceil(2 * fm - 1e-6); j <= j0; j++) {
          const t0 = (j - i * 0.37) * P, u = H(i, j, 1, 41), off = 0.08 + 0.12 * H(i, j, 2, 41);
          this.ring(lerpN(f.a[0], f.b[0], u) + f.n[0] * off, lerpN(f.a[1], f.b[1], u) + f.n[1] * off, t0, 0.55);
        }
      }
      const pt = this.pondTiles;
      if (pt.length) for (let j = Math.floor(time / 0.9) - 3; j <= Math.floor(time / 0.9); j++) {
        const w = pt[Math.floor(H(j, 3, 0, 43) * pt.length)];
        this.ring(w.x + 0.15 + 0.7 * H(j, 4, 0, 43), w.y + 0.15 + 0.7 * H(j, 5, 0, 43), j * 0.9 + H(j, 6, 0, 43) * 0.5, 0.22);
      }
      // ripples queued by the sim's instance layers (critter splashes) and the GPU layers (voxel physics)
      for (let g = 0; g < 2; g++) {
        const LL = g ? this.layers : this.S.sim.layers;
        for (let l = 0; l < LL.length; l++) { const R = LL[l].ripples; if (R) for (let k = 0; k < R.length; k++) { const e = R[k]; if (time - e.t < 3 && time >= e.t) this.ring(e.x, e.y, e.t, e.amp); } }
      }
      if (this.bubbleEm && (this.bubbleEm.length || this.bubbleExtra.length)) this.updateBubbles(time);
      // the live ones, newest first (a stable sort: ties keep the order above), at most RING_MAX
      const live = Q.live;
      live.length = 0;
      for (let k = 0; k < Q.n; k++) { const r = Q.pool[k]; if (time >= r[2] && time - r[2] < 2.6) live.push(r); }
      live.sort(byBirth);
      const n = Math.min(RING_MAX, live.length), D = this.ringData;
      for (let k = 0; k < n; k++) { const r = live[k], o = k * 4; D[o] = r[0]; D[o + 1] = r[1]; D[o + 2] = r[2]; D[o + 3] = r[3]; }
      this.ripples.n = n;
      if (n) this.dev.queue.writeBuffer(this.ringBuf, 0, D, 0, n * 4);
    }

    // Point lights (glowing prims of the volumes + ground lanterns) in a storage buffer, binned into a
    // per-map-cell grid of up to 8 nearest lights so the lighting pass never loops over all of them.
    // An app adds its own lights with setLights(), which re-bins everything.
    buildLights() {
      const T = this.S.T, GW = Math.round(T.NX / T.VS), GH = Math.round(T.NY / T.VS);
      this.lightBuf = this.dev.createBuffer({ label: "lights", size: LIGHT_MAX * 32, usage: BU.STORAGE | BU.COPY_DST });
      this.lgridBuf = this.dev.createBuffer({ label: "light grid", size: GW * GH * 32, usage: BU.STORAGE | BU.COPY_DST });
      this.setLights([]);
    }
    // What is under canvas pixel (px, py), on the CPU (no GPU readback, the same answer in a headless
    // check): the nearer of the first terrain voxel (ME.pickGround) and the first instance box (sim.pick)
    // on the view ray. { p, n, tile, kind: "terrain" | "instance", layer, index, t } or null: p the hit
    // point, n the face's normal, tile the map tile [x, y] (the hit voxel's, or under p for an instance);
    // layer and index say which instance (sim.pick), null and -1 for the terrain.
    // o.terrain = false or o.instances = false leaves that half out.
    pick(px, py, cam, o = {}) {
      const [w, h] = this.out, T = this.S.T, sim = this.S.sim, ray = cam.ray(px, py, w, h);
      const g = o.terrain === false ? null : ME.pickGround(T, ray);
      const s = o.instances === false || !sim ? null : sim.pick(ray, g ? g.t : ray.L, o.accept || null);
      if (s) return { p: s.p, n: s.n, tile: [Math.floor(s.p[0]), Math.floor(s.p[1])], kind: "instance", layer: s.layer, index: s.index, t: s.t };
      if (!g) return null;
      const c = g.cell, tile = [Math.floor(T.O[0] + (c[0] + 0.5) / T.VS), Math.floor(T.O[1] + (c[1] + 0.5) / T.VS)];
      return { p: g.p, n: g.n, tile, kind: "terrain", layer: null, index: -1, t: g.t };
    }
    setLights(extra) {
      const T = this.S.T, list = [...this.S.MB.lights, ...(T.lights || []), ...extra].slice(0, LIGHT_MAX);
      const data = new Float32Array(Math.max(1, list.length) * 8);
      list.forEach((l, i) => data.set([...l.p, l.r, ...l.col, l.k], i * 8));
      const GW = Math.round(T.NX / T.VS), GH = Math.round(T.NY / T.VS), ox = T.O[0], oy = T.O[1], grid = new Uint32Array(GW * GH * 8).fill(0xffffffff);
      // each light visits only the cells inside its radius (not every cell every light: 80 ms per tower placed
      // on a big map); lights go in index order, so a cell's ties sort as before
      const near = new Map();
      list.forEach((l, i) => {
        const [px, py] = l.p, r = l.r;
        const cx0 = Math.max(0, Math.floor(px - r - 1 - ox)), cx1 = Math.min(GW - 1, Math.ceil(px + r - ox));
        const cy0 = Math.max(0, Math.floor(py - r - 1 - oy)), cy1 = Math.min(GH - 1, Math.ceil(py + r - oy));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
          const x0 = ox + cx, y0 = oy + cy;
          const dx = Math.max(x0 - px, 0, px - x0 - 1), dy = Math.max(y0 - py, 0, py - y0 - 1), d = Math.hypot(dx, dy);
          if (!(d < r)) continue;
          const c = cy * GW + cx, a = near.get(c);
          if (a) a.push([d, i]); else near.set(c, [[d, i]]);
        }
      });
      near.forEach((a, c) => a.sort((p, q) => p[0] - q[0]).slice(0, 8).forEach(([, i], k) => (grid[c * 8 + k] = i)));
      if (!this.lightList) this.lightList = list; // the scene's own lights (critters gather at the lamps)
      this.lgrid = [ox, oy, GW, GH];
      this.dev.queue.writeBuffer(this.lightBuf, 0, data);
      this.dev.queue.writeBuffer(this.lgridBuf, 0, grid);
    }

    // Grass on a carved spot: a blade whose ground voxel was dug or came loose, or whose own cell filled (a
    // slumped heap), is hidden (its z far below), and shown again when the terrain there comes back.
    carveGrass(cells) {
      const G = this.S.grass;
      if (!G || !G.count) return;
      const T = this.S.T, NX = T.NX, PL = NX * T.NY, vg = T.grid, B = G.blades;
      if (!this.grassOf) {
        // per blade, its ground voxel and its own cell (bakeGrass: x, y at voxel centres, z on the ground's top);
        // per such cell, the blades on it
        this.grassZ = B.slice(0); this.grassOf = new Int32Array(G.count * 2); this.grassCells = new Map();
        for (let b = 0; b < G.count; b++) {
          const i = Math.floor((B[b * 4] - T.O[0]) * T.VS), j = Math.floor((B[b * 4 + 1] - T.O[1]) * T.VS), k = Math.round((B[b * 4 + 2] - T.O[2]) * T.VS);
          const g = (k - 1) * PL + j * NX + i;
          this.grassOf[b * 2] = g; this.grassOf[b * 2 + 1] = g + PL;
          for (const n of [g, g + PL]) { const l = this.grassCells.get(n); l ? l.push(b) : this.grassCells.set(n, [b]); }
        }
      }
      let lo = Infinity, hi = -1;
      for (const n of cells) {
        const l = this.grassCells.get(n);
        if (l) for (const b of l) {
          const z = !vg.at(this.grassOf[b * 2]) || vg.at(this.grassOf[b * 2 + 1]) ? -99 : this.grassZ[b * 4 + 2];
          if (B[b * 4 + 2] !== z) { B[b * 4 + 2] = z; lo = Math.min(lo, b); hi = Math.max(hi, b); }
        }
      }
      if (hi >= 0) this.dev.queue.writeBuffer(this.grassBuf, lo * 16, B, lo * 4, (hi - lo + 1) * 4);
    }
    // Terrain voxels the app has removed or added (T.grid already changed there; cells = voxel indices, each
    // one emptied or filled since the last call). The greedy mesh stays: from the first carve the terrain
    // draws with a shader variant that discards the faces of carved cells (a bitset), and a small patch
    // mesh adds the faces their solid neighbours now bare and the open faces of added cells (no down
    // faces, as the greedy mesh). A cell back to how it was baked leaves both (a refilled cell shows its
    // baked material on the faces the greedy mesh has). The density mips (normals, AO, particles) and the
    // coarse occupancy (sun volume) are recomputed over the box around the change.
    carve(cells) {
      if (!cells.length) return;
      this.carveGrass(cells);
      const d = this.dev, T = this.S.T, NX = T.NX, NY = T.NY, NZ = T.NZ, PL = NX * NY, vg = T.grid;
      if (!this.carved) {
        this.carved = new Uint32Array(Math.ceil((PL * NZ) / 32)); this.carvedCells = new Set(); this.addedCells = new Set();
        this.carvedBuf = d.createBuffer({ label: "carved cells", size: this.carved.byteLength, usage: BU.STORAGE | BU.COPY_DST });
        const pl = this.pl.terrainCarve; // compiled async with the others (ME.compilePipelines)
        this.carveDraw = { pl, g0: this.bg(pl, 0, [{ buffer: this.ubuf }]), g1: this.bg(pl, 1, [this.densTex.createView(), this.lin, { buffer: this.matBuf }, { buffer: this.carvedBuf }]), n: 0 };
        // the patch's blocks (carvePatch): per block of 16^3 cells, its carved and added cells and its quads
        this.patchBX = Math.ceil(NX / 16); this.patchBY = Math.ceil(NY / 16);
        this.blockCells = new Map(); this.patchBlocks = new Map(); this.patchDirtyList = [];
        this.patchDirtyBlock = new Uint8Array(this.patchBX * this.patchBY * Math.ceil(NZ / 16));
        this.patchScratch = new Uint16Array(16 * 4096); this.patchAll = new Uint16Array(0);
      }
      const C = this.carved, CC = this.carvedCells, AC = this.addedCells, box = [NX, NY, NZ, -1, -1, -1];
      const BX = this.patchBX, BXY = BX * this.patchBY, BC = this.blockCells, DB = this.patchDirtyBlock, DL = this.patchDirtyList;
      const dirty = (b) => { if (!DB[b]) { DB[b] = 1; DL.push(b); } };
      let w0 = Infinity, w1 = -1;
      for (const i of cells) {
        const now = !!vg.at(i), x = i % NX, y = Math.floor(i / NX) % NY, z = Math.floor(i / PL), b = (z >> 4) * BXY + (y >> 4) * BX + (x >> 4);
        // carved: emptied and not added before; it leaves either set when it is back to how it was baked
        const inC = CC.has(i), inA = !inC && AC.has(i), carved = inC || inA ? inC && !now : !now;
        if (inC) { if (now) CC.delete(i); } else if (inA) { if (!now) AC.delete(i); } else (now ? AC : CC).add(i);
        const was = inC || inA, is = inC ? !now : inA ? now : true;
        if (is !== was) { let s = BC.get(b); if (is) { if (!s) BC.set(b, (s = new Set())); s.add(i); } else if (s) { s.delete(i); if (!s.size) BC.delete(b); } }
        dirty(b);
        if ((x & 15) === 0 && x > 0) dirty(b - 1);
        if ((x & 15) === 15 && x + 1 < NX) dirty(b + 1);
        if ((y & 15) === 0 && y > 0) dirty(b - BX);
        if ((y & 15) === 15 && y + 1 < NY) dirty(b + BX);
        if ((z & 15) === 0 && z > 0) dirty(b - BXY);
        if ((z & 15) === 15 && z + 1 < NZ) dirty(b + BXY);
        if (carved) C[i >>> 5] |= 1 << (i & 31); else C[i >>> 5] &= ~(1 << (i & 31));
        w0 = Math.min(w0, i >>> 5); w1 = Math.max(w1, i >>> 5);
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z);
        box[3] = Math.max(box[3], x); box[4] = Math.max(box[4], y); box[5] = Math.max(box[5], z);
      }
      d.queue.writeBuffer(this.carvedBuf, w0 * 4, C, w0, w1 - w0 + 1);
      vg.compact(box.slice(0, 3), box.slice(3)); // bricks the change left all one material give their slots back
      // the patch is rebuilt once a frame, before the G-buffer (carvePatch): a boss's slam carved four times in
      // a frame, and each call rebuilt it from every cell carved so far (32-97 ms; Engine's probe, 2026-10-24)
      this.patchDirty = true;
      // density mips over the box (mip 0 = 2x2x2 average of occupancy, mip 1 = 2x2x2 average of mip 0, as the
      // bake's) and the coarse occupancy over its cells there (ME.coarseFill, as the bake builds it). The mips
      // live only on the GPU (init drops T.mips after the upload: 58 MB at vs40), so mip 0 is recomputed from
      // T.grid into a local array over every cell mip 1 reads (each is what the bake or an earlier carve gave it)
      // up: src covers dims from its corner o, the region lo..hi goes to the texture at lo
      const up = (tex, mip, src, dims, lo, hi, o = [0, 0, 0]) => {
        const w = hi[0] - lo[0] + 1, h = hi[1] - lo[1] + 1, z = hi[2] - lo[2] + 1, out = new Uint8Array(w * h * z);
        for (let c = 0; c < z; c++) for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) out[(c * h + b) * w + a] = src[((lo[2] - o[2] + c) * dims[1] + lo[1] - o[1] + b) * dims[0] + lo[0] - o[0] + a];
        d.queue.writeTexture({ texture: tex, mipLevel: mip, origin: lo }, out, { bytesPerRow: w, rowsPerImage: h }, [w, h, z]);
      };
      const D1 = [NX >> 1, NY >> 1, NZ >> 1], D2 = [NX >> 2, NY >> 2, NZ >> 2], two = D2.every((n) => n > 0);
      const lo1 = [0, 1, 2].map((a) => Math.max(0, (box[a] >> 1) - 1)), hi1 = [0, 1, 2].map((a) => Math.min(D1[a] - 1, (box[a + 3] >> 1) + 1));
      const lo2 = lo1.map((x) => x >> 1), hi2 = [0, 1, 2].map((a) => Math.min(D2[a] - 1, hi1[a] >> 1));
      // the local mip 0, from corner L0 to L1: the box's cells and the 2x2x2 blocks under mip 1's
      const L0 = two ? lo2.map((x) => 2 * x) : lo1, L1 = [0, 1, 2].map((a) => (two ? Math.max(hi1[a], 2 * hi2[a] + 1) : hi1[a]));
      const LD = [0, 1, 2].map((a) => L1[a] - L0[a] + 1), d1 = new Uint8Array(LD[0] * LD[1] * LD[2]);
      for (let z = L0[2]; z <= L1[2]; z++) for (let y = L0[1]; y <= L1[1]; y++) for (let x = L0[0]; x <= L1[0]; x++) {
        let s = 0;
        for (let c = 0; c < 8; c++) s += vg.get(2 * x + (c & 1), 2 * y + ((c >> 1) & 1), 2 * z + (c >> 2)) ? 255 : 0;
        d1[((z - L0[2]) * LD[1] + y - L0[1]) * LD[0] + x - L0[0]] = s >> 3;
      }
      up(this.densTex, 0, d1, LD, lo1, hi1, L0);
      if (T.coarse) {
        const f = T.VS / T.CPU, top = [T.cdims[0], T.cdims[1], NZ / f].map((n) => n - 1);
        const lo = [0, 1, 2].map((a) => Math.max(0, Math.floor(box[a] / f) - 1)), hi = [0, 1, 2].map((a) => Math.min(top[a], Math.floor(box[a + 3] / f) + 1));
        ME.coarseFill(T, lo, hi);
        up(this.occTex, 0, T.coarse, T.cdims, lo, hi); this.sunRegion(lo, hi);
      }
      if (two) {
        const W = [0, 1, 2].map((a) => hi2[a] - lo2[a] + 1), d2 = new Uint8Array(W[0] * W[1] * W[2]);
        for (let z = lo2[2]; z <= hi2[2]; z++) for (let y = lo2[1]; y <= hi2[1]; y++) for (let x = lo2[0]; x <= hi2[0]; x++) {
          let s = 0;
          for (let c = 0; c < 8; c++) s += d1[((2 * z + (c >> 2) - L0[2]) * LD[1] + 2 * y + ((c >> 1) & 1) - L0[1]) * LD[0] + 2 * x + (c & 1) - L0[0]];
          d2[((z - lo2[2]) * W[1] + y - lo2[1]) * W[0] + x - lo2[0]] = s >> 3;
        }
        up(this.densTex, 1, d2, W, lo2, hi2, lo2);
      }
    }

    // The carved cells' patch (quads as in ME.greedyMesh) from R.carvedCells and R.addedCells: the faces each
    // carved cell's baked solid neighbours show toward it, and each added cell's faces toward empty cells. Its
    // quads are kept per block of 16^3 cells (R.patchBlocks), and only the blocks a carve touched since the last
    // build are rebuilt (carve marks them, with the blocks beside a changed cell on a block's edge, whose faces
    // it can change): rebuilding from every cell carved so far took 11-17 ms on the boss's slam frame, and more
    // as a run's carves add up (Game's profile and Engine's probe, 2026-10-24).
    carvePatch() {
      this.patchDirty = false;
      const d = this.dev, T = this.S.T, NX = T.NX, NY = T.NY, NZ = T.NZ, PL = NX * NY, vg = T.grid, AC = this.addedCells, PB = this.patchBlocks;
      let v = this.patchScratch, n = 0;
      // the quad of face dir (0 +x, 1 -x, 2 +y, 3 -y, 4 +z) of the solid cell (a, b, c): 4 vertices of x, y, z, w
      const vtx = (x, y, z, w) => { v[n] = x; v[n + 1] = y; v[n + 2] = z; v[n + 3] = w; n += 4; };
      const face = (dir, a, b, c, mat) => {
        if (n + 16 > v.length) { const g = new Uint16Array(v.length * 2); g.set(v); v = this.patchScratch = g; }
        const w = dir | (mat << 3);
        if (dir < 2) { const x = a + (dir === 0); vtx(x, b, c, w); vtx(x, b + 1, c, w); vtx(x, b + 1, c + 1, w); vtx(x, b, c + 1, w); }
        else if (dir < 4) { const y = b + (dir === 2); vtx(a, y, c, w); vtx(a + 1, y, c, w); vtx(a + 1, y, c + 1, w); vtx(a, y, c + 1, w); }
        else { const z = c + 1; vtx(a, b, z, w); vtx(a + 1, b, z, w); vtx(a + 1, b + 1, z, w); vtx(a, b + 1, z, w); }
      };
      for (const blk of this.patchDirtyList) {
        this.patchDirtyBlock[blk] = 0; n = 0;
        const cells = this.blockCells.get(blk);
        if (cells) for (const c of cells) {
          const i = c % NX, j = Math.floor(c / NX) % NY, k = Math.floor(c / PL);
          if (AC.has(c)) {
            const m = vg.at(c);
            if (i + 1 >= NX || !vg.at(c + 1)) face(0, i, j, k, m);
            if (i < 1 || !vg.at(c - 1)) face(1, i, j, k, m);
            if (j + 1 >= NY || !vg.at(c + NX)) face(2, i, j, k, m);
            if (j < 1 || !vg.at(c - NX)) face(3, i, j, k, m);
            if (k + 1 >= NZ || !vg.at(c + PL)) face(4, i, j, k, m);
          } else {
            // a carved cell: the faces of its solid neighbours that are as baked (an added one has its own)
            let s;
            if (i > 0 && vg.at((s = c - 1)) && !AC.has(s)) face(0, i - 1, j, k, vg.at(s));
            if (i + 1 < NX && vg.at((s = c + 1)) && !AC.has(s)) face(1, i + 1, j, k, vg.at(s));
            if (j > 0 && vg.at((s = c - NX)) && !AC.has(s)) face(2, i, j - 1, k, vg.at(s));
            if (j + 1 < NY && vg.at((s = c + NX)) && !AC.has(s)) face(3, i, j + 1, k, vg.at(s));
            if (k > 0 && vg.at((s = c - PL)) && !AC.has(s)) face(4, i, j, k - 1, vg.at(s));
          }
        }
        if (n) PB.set(blk, v.slice(0, n)); else PB.delete(blk);
      }
      this.patchDirtyList.length = 0;
      let nq = 0;
      for (const q of PB.values()) nq += q.length / 16;
      if (nq * 16 > this.patchAll.length) this.patchAll = new Uint16Array(nq * 32);
      let o = 0;
      for (const q of PB.values()) { this.patchAll.set(q, o); o += q.length; }
      const D = this.carveDraw;
      if (nq > (D.cap || 0)) {
        D.cap = Math.max(256, nq * 2);
        for (const b of [D.vb, D.ib]) b && b.destroy();
        D.vb = d.createBuffer({ label: "carve patch vb", size: D.cap * 32, usage: BU.VERTEX | BU.COPY_DST });
        const idx = new Uint32Array(D.cap * 6);
        for (let q = 0; q < D.cap; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        D.ib = ME.buffer(d, idx, BU.INDEX, "carve patch ib");
      }
      if (nq) d.queue.writeBuffer(D.vb, 0, this.patchAll, 0, nq * 16);
      D.n = nq * 6;
    }

    // The sun volume cells whose rays can reach coarse cells lo..hi (inclusive) once they changed: under them
    // down to the ground, out to the slanted sky rays' reach, and back along the sun ray as far as it marches
    // (ME.SUNVOL, light.js: the sun ray about 405 cells, a slanted sky ray about 57, 0.8 of it horizontal; the
    // sun ray's slope comes from sunDir's elevation clamp, 0.2 rad at the lowest), 2 cells wider for the
    // trilinear lookups. Cells outside it keep their value, so the volume ends as a full recompute would leave
    // it (tools/sunvol-check.js). A carve used to recompute the whole volume in the frame it happened: half the
    // boss wave's carve frames ran over 50 ms (Engine's probe, 2026-10-23). The region is queued, and frame()
    // takes it a z-slab at a time, at most ME.SUN_CELLS cells a frame. Once the queue holds more cells than the
    // volume (carves on most frames, a long collapse), it becomes one sweep of the whole volume, so the queue
    // and the shadows' lag stay bounded.
    sunRegion(lo, hi) {
      const D = this.S.T.cdims, L = this.lastL || this.sunDir(), m = 2, SV = ME.SUNVOL;
      const sky = SV.slantXY * SV.reach(SV.slant) + 1, reach = SV.reach(SV.sun) + 1;
      const t = Math.min(reach, (hi[2] + 1) / Math.max(0.05, L[2])), sx = -L[0] * t, sy = -L[1] * t;
      const a = [Math.floor(lo[0] + Math.min(-sky, sx)) - m, Math.floor(lo[1] + Math.min(-sky, sy)) - m, 0];
      const b = [Math.ceil(hi[0] + Math.max(sky, sx)) + m, Math.ceil(hi[1] + Math.max(sky, sy)) + m, hi[2] + m];
      const box = [0, 1, 2].map((k) => Math.max(0, a[k])).concat([0, 1, 2].map((k) => Math.min(D[k] - 1, b[k])));
      if (!(box[0] <= box[3] && box[1] <= box[4] && box[2] <= box[5])) return;
      const cells = (q) => (q[3] - q[0] + 1) * (q[4] - q[1] + 1) * (q[5] - q[2] + 1);
      if (this.sunQ.reduce((s, q) => s + cells(q), cells(box)) > D[0] * D[1] * D[2]) {
        // one volume's worth, swept on from the z the whole box being drawn got to, then from 0 up to it: a carve
        // on every frame no longer restarts the sweep at z 0, so the upper slabs don't wait for the carving to
        // stop, and every slab is still drawn once after the latest carve (#191's review)
        const h = this.sunQ[0], z = h && h[0] === 0 && h[1] === 0 && h[3] === D[0] - 1 && h[4] === D[1] - 1 ? h[2] : 0;
        this.sunQ.length = 0; this.sunQ.push([0, 0, z, D[0] - 1, D[1] - 1, D[2] - 1]); this.sunWhole = (this.sunWhole || 0) + 1;
        if (z > 0) this.sunQ.push([0, 0, 0, D[0] - 1, D[1] - 1, z - 1]);
      } else this.sunQ.push(box);
    }

    // The app's ground maps for the shader hooks: a scalar field (fieldRes texels per tile, r8) and one
    // rgba8 texel per tile.
    setField(bytes) { this.dev.queue.writeTexture({ texture: this.fieldTex }, bytes, { bytesPerRow: this.fieldDims[0] }, this.fieldDims); }
    setCells(bytes) { const m = this.S.st.map; this.dev.queue.writeTexture({ texture: this.cellTex }, bytes, { bytesPerRow: m.W * 4 }, [m.W, m.H]); }

    // the bell jar's glass (none in a box frame)
    buildGlass() {
      const E = this.ext;
      if (!E.jar) { this.glass = null; return; }
      const [C, CY] = E.c, R = E.R, zb = E.foot, zt = E.top, H = E.dome, SEG = 64, RINGS = 14, v = [], idx = [];
      for (let r = 0; r <= RINGS + 1; r++) {
        // ring 0 = bottom of the cylinder, ring 1 = top of the cylinder, then up the dome
        const a = r === 0 ? 0 : (r - 1) / RINGS, phi = a * (Math.PI / 2) * 0.985;
        const rr = r === 0 ? R : R * Math.cos(phi), z = r === 0 ? zb : zt + H * Math.sin(phi);
        for (let s = 0; s <= SEG; s++) {
          const th = (s / SEG) * Math.PI * 2, cx = Math.cos(th), sy = Math.sin(th);
          let n = r <= 1 ? [cx, sy, 0] : [cx * Math.cos(phi) / R, sy * Math.cos(phi) / R, Math.sin(phi) / H];
          const l = Math.hypot(...n); n = n.map((q) => q / l);
          v.push(C + cx * rr, CY + sy * rr, z, ...n);
        }
      }
      for (let r = 0; r <= RINGS; r++) for (let s = 0; s < SEG; s++) {
        const a = r * (SEG + 1) + s, b = a + SEG + 1;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
      this.glass = { vb: ME.buffer(this.dev, new Float32Array(v), BU.VERTEX, "glass vb"), ib: ME.buffer(this.dev, new Uint32Array(idx), BU.INDEX, "glass ib"), n: idx.length };
    }

    // the particles (leaves, fireflies, mist) back to their start state: a frozen shot steps them from there, so
    // it doesn't depend on the shots taken before it
    resetParticles() { if (this.partInit) this.dev.queue.writeBuffer(this.partBuf, 0, this.partInit); }
    buildParticles() {
      const S = this.S, T = S.T, MB = S.MB, H = window.PX.hash, emit = (ME.content && ME.content.particles) || {};
      const leafSrc = [], flySrc = [], mistSrc = [];
      for (const s of MB.statics) {
        const p = s.place, m = MB.models[s.frames[0]];
        if (emit.leaves && emit.leaves(p)) leafSrc.push([p.X, p.Y, p.Z + m.h * 0.78, Math.max(0.5, m.r * 0.75)]);
        if (emit.fireflies && emit.fireflies(p)) flySrc.push([p.X, p.Y, p.Z + 0.3, 1.6]);
      }
      for (const w of T.water) if (H(w.x, w.y, 0, 9) > 0.8) flySrc.push([w.x + 0.5, w.y + 0.5, w.z + 0.15, 1.4]);
      // a rim spill's mist starts at its lip, inside the glass (its foot is on the plinth, outside)
      for (const f of T.falls) mistSrc.push(f.lip ? f.lip.slice() : [(f.a[0] + f.b[0]) / 2 + f.n[0] * 0.15, (f.a[1] + f.b[1]) / 2 + f.n[1] * 0.15, f.zbot, Math.max(0.3, Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]))]);
      // a rim spill's spray (W6): four sources per spill falls (A foot centre on the plinth + half width, B
      // outward normal + plinth ledge + fade depth, C colour + foam share, D voxel size + plinth bottom) and
      // its look's spray.n voxels per tile of width, SPRAY_MAX in all
      const spraySrc = [], sprayOf = [], g = T.geo;
      if (g) for (const f of T.falls) {
        if (!f.spill) continue;
        const sp = this.fallsLook(f).spray, w = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), mx = (f.a[0] + f.b[0]) / 2, my = (f.a[1] + f.b[1]) / 2;
        const n = Math.min(Math.round(sp.n * Math.min(1, w)), SPRAY_MAX - sprayOf.length);
        if (n <= 0) continue;
        const s = spraySrc.length;
        spraySrc.push([mx, my, f.zbot, w / 2], [f.n[0], f.n[1], g.PL_R - Math.hypot(mx - g.C, my - g.C), sp.fade], [...sp.colour, sp.foam], [(sp.size / T.VS) * 1.6, g.PL_ZB, 0, 0]);
        for (let j = 0; j < n; j++) sprayOf.push(s);
      }
      const N = (this.pcount = { leaf: leafSrc.length ? 180 : 0, fly: flySrc.length ? 90 : 0, mist: mistSrc.length ? 200 : 0, spray: sprayOf.length });
      const tot = N.leaf + N.fly + N.mist + N.spray, data = new Float32Array(Math.max(1, tot) * 8);
      // spread initial state so the scene starts mid-flow
      for (let i = 0; i < tot; i++) {
        const r = (k) => H(i, k, 0, 31);
        let s, life;
        if (i < N.leaf) { s = leafSrc[i % leafSrc.length]; life = r(1) * 10; data.set([s[0] + (r(2) - 0.5) * s[3] * 2, s[1] + (r(3) - 0.5) * s[3] * 2, s[2] - r(4) * 2.5, life, 0, 0, -0.2, r(5)], i * 8); }
        else if (i < N.leaf + N.fly) { s = flySrc[(i - N.leaf) % flySrc.length]; data.set([s[0] + (r(2) - 0.5) * s[3], s[1] + (r(3) - 0.5) * s[3], s[2] + r(4) * 0.8, r(1) * 8, 0, 0, 0.01, r(5)], i * 8); }
        else if (i < N.leaf + N.fly + N.mist) { s = mistSrc[(i - N.leaf - N.fly) % mistSrc.length]; data.set([s[0], s[1], s[2] + r(4) * 0.4, r(1) * 3, 0, 0, 0.2, r(5)], i * 8); }
        // spray: parked (no speed, not drawn) for a staggered wait, so they leave over the first 2.8 s; seed = its
        // spill + a fraction
        else { const k = sprayOf[i - N.leaf - N.fly - N.mist], A = spraySrc[k]; data.set([A[0], A[1], A[2], 0.001 + r(1) * 2.8, 0, 0, 0, k / 4 + r(5) * 0.999], i * 8); }
      }
      this.partBuf = ME.buffer(this.dev, data, BU.STORAGE, "particles"); this.partInit = data; // the start state, for R.resetParticles (nothing writes into data after this)
      const src = [...leafSrc, ...flySrc, ...mistSrc, ...spraySrc].flat();
      this.srcBuf = ME.buffer(this.dev, new Float32Array(src.length ? src : [0, 0, 0, 1]), BU.STORAGE, "particle sources");
      this.psrc = [leafSrc.length, flySrc.length, mistSrc.length];
      this.sprayAt = leafSrc.length + flySrc.length + mistSrc.length; // the spray's first source (look4.w)
    }

    // Screen-size targets and the bind groups that read them.
    resize(cw, ch) {
      const w = Math.max(64, Math.round(cw * this.set.scale)), h = Math.max(64, Math.round(ch * this.set.scale));
      if (this.size[0] === w && this.size[1] === h && this.out && this.out[0] === cw && this.out[1] === ch) return;
      this.size = [w, h]; this.out = [cw, ch];
      const d = this.dev, mk = (label, fmt, sz, usage) => d.createTexture({ label, size: sz, format: fmt, usage });
      for (const t of this.screen || []) t.destroy();
      const RT = GU.RENDER_ATTACHMENT | GU.TEXTURE_BINDING;
      this.gA = mk("gA", "rgba8unorm-srgb", [w, h], RT);
      this.gN = mk("gN", "rgba16float", [w, h], RT);
      this.gE = mk("gE", "rgba16float", [w, h], RT);
      this.depth = mk("depth", "depth32float", [w, h], RT);
      this.hdr = mk("hdr", "rgba16float", [w, h], RT);
      // the shafts' target: half resolution up to 1080p's pixel count, then a third, a quarter...: it never holds
      // more texels than 1080p at half (960x540), so a phone at its full resolution (~2.9M pixels) marches 56% fewer
      // rays (Engine's shaft-cost probe, 2026-10-26: 3.0 ms, 21% of the GPU frame, at Full on Fernglass)
      const sd = (this.shaftDiv = Math.max(2, Math.ceil(Math.sqrt((w * h) / 518400) - 1e-6)));
      const hw = Math.max(1, sd === 2 ? w >> 1 : Math.floor(w / sd)), hh = Math.max(1, sd === 2 ? h >> 1 : Math.floor(h / sd));
      this.shA = mk("shaftA", "rgba16float", [hw, hh], GU.STORAGE_BINDING | GU.TEXTURE_BINDING);
      this.shB = mk("shaftB", "rgba16float", [hw, hh], GU.STORAGE_BINDING | GU.TEXTURE_BINDING);
      this.bloom = [1, 2, 3].map((k) => mk("bloom" + k, "rgba16float", [Math.max(1, w >> k), Math.max(1, h >> k)], RT));
      this.screen = [this.gA, this.gN, this.gE, this.depth, this.hdr, this.shA, this.shB, ...this.bloom];
      const P = this.pl, bg = this.bg, V = (t) => t.createView(), sunV = this.sunTex.createView(), ramps = this.rampTex.createView();
      Object.assign(this.g1, {
        lighting: bg(P.lighting, 1, [V(this.gA), V(this.gN), V(this.depth), sunV, this.lin, { buffer: this.matBuf }, ramps, { buffer: this.lightBuf }, { buffer: this.lgridBuf }, { buffer: this.wlevBuf }, this.canV, V(this.gE), V(this.fieldTex), V(this.cellTex)]),
        shafts: bg(P.shafts, 1, [V(this.depth), sunV, this.lin, V(this.shA), this.canV]),
        blurH: bg(P.blurH, 1, [V(this.shA), V(this.shB)]),
        blurV: bg(P.blurV, 1, [V(this.shB), V(this.shA)]),
        water: bg(P.water, 1, [V(this.depth), sunV, this.lin, ramps, { buffer: this.ringBuf }, this.canV, ...(this.looked ? [{ buffer: this.lookBuf }] : [])]),
        composite: bg(P.composite, 1, [V(this.hdr), V(this.bloom[0]), V(this.shA), this.lin, V(this.gA), V(this.gN), V(this.depth), sunV]),
        down: [bg(P.bloomDown0, 1, [V(this.hdr), this.lin]), ...[0, 1].map((k) => bg(P.bloomDown, 1, [V(this.bloom[k]), this.lin]))],
        up: [1, 0].map((k) => bg(P.bloomUp, 1, [V(this.bloom[k + 1]), this.lin])),
      });
      this.views = { gA: V(this.gA), gN: V(this.gN), gE: V(this.gE), depth: V(this.depth), hdr: V(this.hdr), bloom: this.bloom.map(V) };
    }

    writeUniforms(cam, time, dt) {
      const u = this.u, O = ME.UOFF, S = this.S, T = S.T, st = S.st, s = this.set, [w, h] = this.size;
      const M = cam.matrices(this.out[0], this.out[1]);
      u.set(M.vp, O.vp); u.set(M.ivp, O.ivp);
      u.set(M.vdir, O.vdir); u[O.vdir + M.vdir.length] = time;
      const L = this.sunDir(this.sunL || (this.sunL = [0, 0, 0])), LL = this.lastL;
      if (!LL || Math.abs(L[0] - LL[0]) > 1e-4 || Math.abs(L[1] - LL[1]) > 1e-4 || Math.abs(L[2] - LL[2]) > 1e-4) { this.sunDirty = true; this.lastL = [L[0], L[1], L[2]]; }
      set4(u, O.sun, L[0], L[1], L[2], 0);
      set4(u, O.res, w, h, 1 / w, 1 / h);
      u.set(T.O, O.grid); u[O.grid + T.O.length] = T.VS;
      const fno = this.pinFrame ?? this.frameNo; // the frame number the shaders see (R.pinFrame holds it for frozen shots)
      set4(u, O.dims, T.NX, T.NY, T.NZ, fno);
      u.set(T.O, O.cgrid); u[O.cgrid + T.O.length] = T.CPU;
      u.set(T.cdims, O.cdims); u[O.cdims + T.cdims.length] = 0;
      set4(u, O.look, s.shade, s.pool, s.amb, s.aoK);
      set4(u, O.look2, BEVEL, s.ramp ? 1 : 0, this.ext.jar ? this.ext.dome : -this.ext.half[1], s.canopy ? 1 : 0);
      // the moon, 0 by day to 1 at night (the dusk blend, as in daycycle.js): the shafts turn pale blue-silver,
      // fewer (every other pool fades), less streaky, and gain moonK so they still read once the dusk has
      // dimmed shaftK (the gain comes in late, so dusk itself stays soft)
      const dk = s.cycle > 0 ? 0.5 - 0.5 * Math.cos((time / s.cycle) * Math.PI * 2) : Math.max(0, Math.min(1, s.dusk));
      const mt = Math.max(0, Math.min(1, (dk - 0.55) / 0.45)), moon = mt * mt * (3 - 2 * mt);
      // the weather's clouds on top of R.set (factors of exactly 1 and + 0 without weather: WeatherMix)
      const Wx = this.weather, wc = Wx.active ? Wx.cur.cloud : 0, wr = Wx.active ? Wx.cur.rain : 0, WL = WeatherMix.LIGHT, WR = WeatherMix.LIGHT_RAIN;
      set4(u, O.look3, s.debug, s.shafts ? s.shaftK * this.shaftMul * (1 + s.moonK * moon * moon * moon) * (1 - WL.shaftK * wc) * (1 - WR.shaftK * wr) : 0, s.bloomK * (1 - WL.bloomK * wc), s.exposure * (1 - WL.exposure * wc) * (1 - WR.exposure * wr));
      const fog = (st.hd && st.hd.fog) || [40, 32, 18];
      set4(u, O.fog, ME.lin(fog[0]), ME.lin(fog[1]), ME.lin(fog[2]), s.haze + WL.haze * wc + WR.haze * wr);
      const bc = (st.hd && st.hd.beamCol) || BEAM_COL;
      set4(u, O.beamCol, lerpN(bc[0], MOON_COL[0], moon) / 255, lerpN(bc[1], MOON_COL[1], moon) / 255, lerpN(bc[2], MOON_COL[2], moon) / 255, s.vignette);
      const g = st.light;
      set4(u, O.canopy, 0.62, 0.38, 1.7, 3.1);
      set4(u, O.canopy2, 0.68, this.drift, 0.4, Math.min(0.6, (g.soft ?? 0.16) * 2.2));
      u.set(ME.WIND_DIR, O.wind); u[O.wind + ME.WIND_DIR.length] = this.windE[0]; u[O.wind + ME.WIND_DIR.length + 1] = this.windE[1];
      set4(u, O.canopy3, 15, 4.5, 1.0, moon);
      set4(u, O.water2, this.ripples ? this.ripples.n : 0, s.water ? 1 : 0, this.wl ? this.wl.W : 0, this.wl ? this.wl.H : 0);
      u.set(this.lgrid, O.lgrid);
      // canopy texture domain: the island projected along the sun onto the canopy plane (z = 15), with
      // room for the island's height range and the wind sway
      const E = this.ext, kL = 1 / Math.max(L[2], 0.2), lxy = Math.hypot(L[0], L[1]) * kL;
      let dMax = s.beamDrift;
      for (let i = 0; i < T.beams.length; i++) dMax = Math.max(dMax, T.beams[i].drift ?? 0);
      const cH = E.R + 1.2 + dMax + 4.2 * lxy, cx = E.c[0] + (15 - 1.5) * L[0] * kL, cy = E.c[1] + (15 - 1.5) * L[1] * kL;
      set4(u, O.shadow, cx - cH, cy - cH, 1 / (2 * cH), 0);
      const nB = Math.min(8, T.beams.length), bp = this.beamP || (this.beamP = [0, 0]);
      set4(u, O.shadow2, s.vlod, nB, g.sideK ?? 1.3, st.shadowK ?? 0.3);
      // the pools (and their shafts) wander slowly through the leaves, each on its own loop of about a minute
      // and a half (beamAt); at night every other one fades out
      for (let i = 0; i < nB; i++) {
        const b = T.beams[i], p = this.beamAt(i, time, bp);
        set4(u, O.beams + i * 4, p[0], p[1], b.z, b.r);
        u[O.beamK + i] = (b.k ?? 1) * (i % 2 ? 1 - 0.9 * moon : 1);
      }
      set4(u, O.ids, S.ids.sky, S.ids.water, S.ids.fall, S.ids.maple);
      set4(u, O.misc, s.glass ? s.glassK : 0, s.water ? 1 : 0, s.particles ? 1 : 0, s.shafts ? 1 : 0);
      set4(u, O.outres, this.out[0], this.out[1], 1 / this.out[0], 1 / this.out[1]);
      set4(u, O.part, this.pcount.leaf, this.pcount.fly, this.pcount.mist, Math.min(0.05, dt));
      u.set(this.psrc, O.psrc); u[O.psrc + this.psrc.length] = cam.D1 - cam.D0;
      set4(u, O.geo, E.c[0], E.c[1], E.jar ? E.R : E.half[0], E.top); // (a box: its half x here, minus its half y in look2.z)
      set4(u, O.misc2, fno % 64, 18, E.base, BLOOM_THRESHOLD);
      set4(u, O.look4, st.light.spriteK ?? 1, s.mottle, this.pcount.spray, this.sprayAt);
      set4(u, O.field, st.map.W, st.map.H, this.fieldRes, 0);
      // the weather (zeros without one): the channels, wet and cover, the fog's floor and the clearings
      const wv = Wx.cur, on = Wx.active;
      set4(u, O.weather, on ? wv.rain : 0, on ? wv.snow : 0, on ? wv.fog : 0, Wx.flashV);
      set4(u, O.weather2, Wx.wet, Wx.cover, wc, on ? wv.fogHeight : 0);
      set4(u, O.weather3, on ? Wx.base() : 0, on ? wv.fogLow : 0, on ? wv.petals : 0, on ? wv.wind : 0);
      u.set(Wx.clear, O.wclear);
      if (this.rainLayers == null) this.rainLayers = ME.phone && ME.phone() ? 1 : ME.compat ? 2 : 3; // (read once; a probe may set it)
      set4(u, O.weather4, this.rainLayers, 0, 0, 0);
      u.set(this.user, O.user);
      this.dev.queue.writeBuffer(this.ubuf, 0, u);
    }

    ts(name, begin = true, end = true) {
      if (!this.qs) return undefined;
      const i = PASSES.indexOf(name);
      const t = { querySet: this.qs };
      if (begin) t.beginningOfPassWriteIndex = i * 2;
      if (end) t.endOfPassWriteIndex = i * 2 + 1;
      return t;
    }

    // The sprite buffer stays from frame to frame; it doubles when the batch did (SpriteBatch.grow), and the
    // two sprite bind groups are rebuilt on it. A late wave (towers, effects, a bar per creature) passed the
    // old fixed 6144 and lost the sprites put last, the health bars.
    growSprites(n = this.sprites.max) {
      const old = this.spriteBuf, P = this.pl;
      this.spriteBuf = this.dev.createBuffer({ label: "sprites", size: n * 48, usage: BU.STORAGE | BU.COPY_DST });
      this.g1.spriteAdd = this.bg(P.spriteAdd, 1, [{ buffer: this.spriteBuf }]);
      this.g1.spriteAlpha = this.bg(P.spriteAlpha, 1, [{ buffer: this.spriteBuf }]);
      old.destroy();
      this.spriteGrows = (this.spriteGrows || 0) + 1;
    }

    // The backdrop (R.backdrop = fn): its own batch, refilled every frame and drawn with the app's additive
    // sprites. view.far(x, y) is the world point at NDC x, y just in front of the far plane (depth
    // ME.BACKDROP_Z: reversed Z, so everything the scene draws is in front of it); view.w, h are the canvas's.
    // Returns how many sprites it put. (The view is one object, rewritten each frame: no garbage on phones.)
    drawBackdrop(cam, time, dt) {
      const b = this.backSprites || (this.backSprites = new SpriteBatch(1024)), [w, h] = this.out, { ivp } = cam.matrices(w, h);
      let v = this.backView;
      if (!v) { v = this.backView = { R: this, sprites: b }; v.far = (x, y) => ME.m4.apply(v.ivp, [x, y, ME.BACKDROP_Z]); }
      v.cam = cam; v.time = time; v.dt = dt; v.w = w; v.h = h; v.ivp = ivp;
      b.begin();
      this.backdrop(v);
      b.end();
      return b.nAdd;
    }

    frame(cam, time, dt) {
      if (this.out) this.resize(this.out[0], this.out[1]); // a changed render scale (dynres, a setting) rebuilds the targets
      const d = this.dev, P = this.pl, S = this.S, sim = S.sim, s = this.set, g0 = this.g0, g1 = this.g1;
      if (this.tasks) this.runTasks(); // (R.addTask: a swap here writes the instances below)
      if (this.fading) this.fadeStep();
      this.weather.update(time, dt);
      const nInst = sim.update(time, s, this.windNow());
      // the drift follows the wind's strength without a jump when it changes (time * wind would leap); it starts,
      // and restarts when time goes back, at time * wind, so a steady wind and a pinned ?t= give the same phase
      const wk = Math.max(WeatherMix.DRIFT_MIN, this.windE[0]);
      this.drift = this.driftT == null || time < this.driftT ? time * wk : this.drift + (time - this.driftT) * wk;
      this.driftT = time;
      this.time = time;
      this.updateRings(time);
      if (this.bubbleN) d.queue.writeBuffer(this.bubbleBuf, 0, this.bubbleData, 0, this.bubbleN * 12);
      this.writeUniforms(cam, time, dt);
      // the statics update() rewrote, then the walkers and layers (all of them on this renderer's first frame)
      const IF = ME.INST_FLOATS, D = sim.dirty, a = this.instUp ? D[0] : 0, b = this.instUp ? Math.min(D[1], sim.staticCount) : sim.staticCount;
      if (b > a) d.queue.writeBuffer(this.instBuf, a * IF * 4, sim.inst, a * IF, (b - a) * IF);
      if (nInst > sim.staticCount) d.queue.writeBuffer(this.instBuf, sim.staticCount * IF * 4, sim.inst, sim.staticCount * IF, (nInst - sim.staticCount) * IF);
      this.instUp = true;
      const sp = this.sprites, nBk = this.backdrop ? this.drawBackdrop(cam, time, dt) : 0, nAdd = sp.nAdd + nBk, nSp = nAdd + sp.nAlpha;
      if (Math.max(sp.max, nSp) * 48 > this.spriteBuf.size) this.growSprites(Math.max(sp.max, nSp));
      if (!nBk) { if (nSp) d.queue.writeBuffer(this.spriteBuf, 0, sp.data, 0, nSp * 12); }
      else {
        // the app's additive sprites, the backdrop's, then the app's bars (drawn from nAdd on)
        if (sp.nAdd) d.queue.writeBuffer(this.spriteBuf, 0, sp.data, 0, sp.nAdd * 12);
        d.queue.writeBuffer(this.spriteBuf, sp.nAdd * 48, this.backSprites.data, 0, nBk * 12);
        if (sp.nAlpha) d.queue.writeBuffer(this.spriteBuf, nAdd * 48, sp.data, sp.nAdd * 12, sp.nAlpha * 12);
      }
      for (const L of this.layers) L.prepare(time, dt);
      const enc = d.createCommandEncoder();

      // the sun volume: all of it when the sun moved (the regions queued are then part of it), else the next
      // slab of the oldest region a carve queued (sunRegion)
      // (sunUpdates counts the whole-volume recomputes, sunSlabs the slabs, sunCells the cells of both)
      let sb = null;
      if (this.sunDirty) { const [X, Y, Z] = S.T.cdims; sb = [0, 0, 0, X - 1, Y - 1, Z - 1]; this.sunQ.length = 0; this.sunDirty = false; this.sunUpdates = (this.sunUpdates || 0) + 1; }
      else if (this.sunQ.length) {
        this.sunSlabs = (this.sunSlabs || 0) + 1;
        const q = this.sunQ[0], plane = (q[3] - q[0] + 1) * (q[4] - q[1] + 1), rows = Math.max(1, Math.floor((ME.SUN_CELLS ?? 1 << 19) / plane));
        sb = [q[0], q[1], q[2], q[3], q[4], Math.min(q[5], q[2] + rows - 1)];
        if (sb[5] >= q[5]) this.sunQ.shift(); else q[2] = sb[5] + 1;
      }
      if (sb) {
        const B = this.sunBoxU || (this.sunBoxU = new Uint32Array(8));
        B[0] = sb[0]; B[1] = sb[1]; B[2] = sb[2]; B[3] = 0; B[4] = sb[3]; B[5] = sb[4]; B[6] = sb[5]; B[7] = 0;
        d.queue.writeBuffer(this.sunBoxBuf, 0, B);
        const c = enc.beginComputePass();
        c.setPipeline(P.sunvol); c.setBindGroup(0, g0.sunvol); c.setBindGroup(1, g1.sunvol);
        c.dispatchWorkgroups(Math.ceil((sb[3] - sb[0] + 1) / 4), Math.ceil((sb[4] - sb[1] + 1) / 4), Math.ceil((sb[5] - sb[2] + 1) / 4));
        c.end(); this.sunCells += (sb[3] - sb[0] + 1) * (sb[4] - sb[1] + 1) * (sb[5] - sb[2] + 1);
      }
      // particles
      const nP = this.pcount.leaf + this.pcount.fly + this.pcount.mist + this.pcount.spray;
      let c = enc.beginComputePass({ timestampWrites: this.ts("prep") });
      if (s.particles && nP) { c.setPipeline(P.partsim); c.setBindGroup(0, g0.partsim); c.setBindGroup(1, g1.partsim); c.dispatchWorkgroups(Math.ceil(nP / 64)); }
      c.setPipeline(P.canopytex); c.setBindGroup(0, g0.canopytex); c.setBindGroup(1, g1.canopytex);
      c.dispatchWorkgroups(Math.ceil(this.canTex.width / 8), Math.ceil(this.canTex.height / 8));
      c.end();
      // the app's GPU layers (voxel physics)
      c = enc.beginComputePass({ timestampWrites: this.ts("layers") });
      for (const L of this.layers) L.compute(c);
      c.end();
      // G-buffer
      let r = enc.beginRenderPass({
        colorAttachments: [{ view: this.views.gA, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }, { view: this.views.gN, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }, { view: this.views.gE, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: this.views.depth, depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "store" }, timestampWrites: this.ts("gbuffer"),
      });
      if (this.patchDirty) this.carvePatch();
      const CD = this.carveDraw; // terrain voxels carved by the app: the variant that skips them, and their patch
      if (CD) { r.setPipeline(CD.pl); r.setBindGroup(0, CD.g0); r.setBindGroup(1, CD.g1); } else { r.setPipeline(P.terrain); r.setBindGroup(0, g0.terrain); r.setBindGroup(1, g1.terrain); }
      r.setVertexBuffer(0, this.tVB); r.setIndexBuffer(this.tIB, "uint32");
      const k0 = cam.turning ? cam.snapIndex(cam.from) : cam.snapIndex(), k1 = cam.turning ? cam.snapIndex(cam.to) : k0;
      let sr = S.mesh.snaps[k0]; r.drawIndexed(sr.count, 1, sr.first, 0, 0);
      if (k1 !== k0) { sr = S.mesh.snaps[k1]; r.drawIndexed(sr.count, 1, sr.first, 0, 0); }
      if (CD && CD.n) { r.setVertexBuffer(0, CD.vb); r.setIndexBuffer(CD.ib, "uint32"); r.drawIndexed(CD.n); }
      if (s.grass && S.grass.count) { r.setPipeline(P.grass); r.setBindGroup(0, g0.grass); r.setBindGroup(1, g1.grass); r.draw(42, S.grass.count); }
      r.setPipeline(P.volume); r.setBindGroup(0, g0.volume); r.setBindGroup(1, g1.volume); r.draw(36, nInst);
      for (const L of this.layers) L.gbuffer(r);
      if (s.particles && this.pcount.leaf) { r.setPipeline(P.leaves); r.setBindGroup(0, g0.leaves); r.setBindGroup(1, g1.leaves); r.draw(6, this.pcount.leaf); }
      r.end();
      // lighting
      r = enc.beginRenderPass({ colorAttachments: [{ view: this.views.hdr, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], timestampWrites: this.ts("lighting") });
      r.setPipeline(P.lighting); r.setBindGroup(0, g0.lighting); r.setBindGroup(1, g1.lighting); r.draw(3);
      r.end();
      // shafts
      c = enc.beginComputePass({ timestampWrites: this.ts("shafts") });
      if (s.shafts) {
        const hw = this.shA.width, hh = this.shA.height;
        c.setPipeline(P.shafts); c.setBindGroup(0, g0.shafts); c.setBindGroup(1, g1.shafts); c.dispatchWorkgroups(Math.ceil(hw / 8), Math.ceil(hh / 8));
        c.setPipeline(P.blurH); c.setBindGroup(0, g0.blurH); c.setBindGroup(1, g1.blurH); c.dispatchWorkgroups(Math.ceil(hw / 8), Math.ceil(hh / 8));
        c.setPipeline(P.blurV); c.setBindGroup(0, g0.blurV); c.setBindGroup(1, g1.blurV); c.dispatchWorkgroups(Math.ceil(hw / 8), Math.ceil(hh / 8));
      }
      c.end();
      // forward
      r = enc.beginRenderPass({ colorAttachments: [{ view: this.views.hdr, loadOp: "load", storeOp: "store" }], depthStencilAttachment: { view: this.views.depth, depthReadOnly: true }, timestampWrites: this.ts("forward") });
      if (s.water && this.water.n) {
        r.setPipeline(P.water); r.setBindGroup(0, g0.water); r.setBindGroup(1, g1.water); r.setVertexBuffer(0, this.water.vb); r.setIndexBuffer(this.water.ib, "uint32"); r.drawIndexed(this.water.n);
      }
      if (s.water && this.falls.n) {
        r.setPipeline(P.falls); r.setBindGroup(0, g0.falls); r.setBindGroup(1, g1.falls); r.setVertexBuffer(0, this.falls.vb); r.setIndexBuffer(this.falls.ib, "uint32"); r.drawIndexed(this.falls.n);
      }
      if (s.water && s.particles && this.pcount.spray) { r.setPipeline(P.spray); r.setBindGroup(0, g0.spray); r.setBindGroup(1, g1.spray); r.draw(36, this.pcount.spray, 0, this.pcount.leaf + this.pcount.fly + this.pcount.mist); }
      if (s.water && this.bubbleN) { r.setPipeline(P.spriteAdd); r.setBindGroup(0, g0.spriteAdd); r.setBindGroup(1, g1.bubbles); r.draw(6, this.bubbleN); }
      if (s.particles && this.pcount.fly + this.pcount.mist) { r.setPipeline(P.sparks); r.setBindGroup(0, g0.sparks); r.setBindGroup(1, g1.sparks); r.draw(6, this.pcount.fly + this.pcount.mist, 0, this.pcount.leaf); }
      if (nAdd) { r.setPipeline(P.spriteAdd); r.setBindGroup(0, g0.spriteAdd); r.setBindGroup(1, g1.spriteAdd); r.draw(6, nAdd); }
      if (s.glass && this.glass) { r.setPipeline(P.glass); r.setBindGroup(0, g0.glass); r.setVertexBuffer(0, this.glass.vb); r.setIndexBuffer(this.glass.ib, "uint32"); r.drawIndexed(this.glass.n); }
      if (sp.nAlpha) { r.setPipeline(P.spriteAlpha); r.setBindGroup(0, g0.spriteAlpha); r.setBindGroup(1, g1.spriteAlpha); r.draw(6, sp.nAlpha, 0, nAdd); }
      r.end();
      // bloom
      const B = this.views.bloom;
      for (let k = 0; k < 3; k++) {
        r = enc.beginRenderPass({ colorAttachments: [{ view: B[k], clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], timestampWrites: k === 0 ? this.ts("bloom", true, false) : undefined });
        r.setPipeline(k === 0 ? P.bloomDown0 : P.bloomDown); r.setBindGroup(0, k === 0 ? g0.bloomDown0 : g0.bloomDown); r.setBindGroup(1, g1.down[k]); r.draw(3); r.end();
      }
      for (let j = 0; j < 2; j++) {
        r = enc.beginRenderPass({ colorAttachments: [{ view: B[1 - j], loadOp: "load", storeOp: "store" }], timestampWrites: j === 1 ? this.ts("bloom", false, true) : undefined });
        r.setPipeline(P.bloomUp); r.setBindGroup(0, g0.bloomUp); r.setBindGroup(1, g1.up[j]); r.draw(3); r.end();
      }
      // composite to the canvas
      const outTex = this.gpu.ctx.getCurrentTexture();
      r = enc.beginRenderPass({ colorAttachments: [{ view: outTex.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], timestampWrites: this.ts("composite") });
      r.setPipeline(P.composite); r.setBindGroup(0, g0.composite); r.setBindGroup(1, g1.composite); r.draw(3);
      r.end();

      const readTs = this.qs && !this.qBusy && this.frameNo % (this.tsEvery || 20) === 0;
      if (readTs) { enc.resolveQuerySet(this.qs, 0, PASSES.length * 2, this.qResolve, 0); enc.copyBufferToBuffer(this.qResolve, 0, this.qRead, 0, PASSES.length * 16); }
      d.queue.submit([enc.finish()]);
      if (readTs) {
        this.qBusy = true;
        this.qRead.mapAsync(GPUMapMode.READ).then(() => {
          const q = new BigInt64Array(this.qRead.getMappedRange().slice(0));
          this.qRead.unmap(); this.qBusy = false;
          const ms = {};
          let tot = 0;
          PASSES.forEach((n, i) => { const v = Number(q[i * 2 + 1] - q[i * 2]) / 1e6; ms[n] = v > 0 && v < 1000 ? +v.toFixed(3) : 0; tot += ms[n]; });
          ms.total = +tot.toFixed(3);
          this.gpuMs = ms;
        }).catch(() => { this.qBusy = false; });
      }
      this.frameNo++;
      return outTex;
    }
  }
  ME.Renderer = Renderer;
  ME.PASSES = PASSES;
})();
