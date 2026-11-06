/* The sky (ME.Sky, src/sky.js; moved from Mossheart's view/atmos.js): the mood (the light) and the weather,
   picked from the sky panel. The mood has Random, which rolls a new one at every wave (and again when tapped).
   The weather is the model's (ME.Weather, src/weather.js): a vector of layers that wanders inside a front. The
   panel picks Dynamic (the level's climate picks the fronts and the host's run pulls the sky: a boss's front,
   the hurt rain while its life is low, a cleared wave's sun break, game over's downpour), a front of its own
   (it still wanders, unless Steady is on) or Random (a new front at every wave).
   The choice is the player's and kept on the device (host.key); ?mood= and ?weather= pin it (screenshots;
   ?weather= takes any front, the rare ones too), and ?selftest= and ?autoplay= always run Auto and Clear. All
   of it is looks only: the model has its own seeded stream, Random uses Math.random, and Dynamic only reads
   the host's run.

   new ME.Sky(app, host): app is { R, scene, phys, st, paused }; scene is the view's { base, moodDusk, dusk,
   zoomIn, waterAt(x, y) } (this writes base and moodDusk every frame; the view's mood() blends from base and
   calls apply(s) at its end). host is the game's, every member optional:
     key          the device storage key ("me.sky")
     seed()       the run's seed (1)
     run()        this frame's { id, level, build, over, life }: id the run's identity (a new one starts the
                  model on seed() and the level's calm front), level the climate's id (ME.WX.climate), build
                  true between waves, over at game over, life 0 to 1 (below a third, the hurt rain). Called
                  every frame: return one object rewritten in place
     on(ev, f)    the run's events: f({ n, boss }) on "start" (a wave's), f() on "clear" (its end)
     mood(level)  a level's own mood until the player picks one (else Auto)
     uiScale()    the UI's zoom, for placing the panel (1)
   The page may have #wx (the overlay canvas), #sky holding #moodseg and #wxseg (the panel) and #skybtn.

   It turns the model's resolved vector into what draws today: factors on the lighting (fewer shafts and sun
   pools, more haze, a dimmer exposure), the wind (R.set.windK) and its gusts (R.set.gust), screen-space rain,
   snow, petals or leaves on a 2D canvas over the scene (#wx), rain rings on the open water, lightning and a
   rainbow arc. Once the renderer has R.weather.mix() it hands it the vector at the settings' intensity, the
   gust included: then the gust is the mix vector's, and apply() leaves R.set.gust at its base. The layers the
   engine draws itself (R.weather.draws: the clouds, the wind and the gusts since Weather 1, the rain since
   Weather 2, which also ends the overlay rain and the rings) lose their LIGHT entry here, and R.set.windK
   stays at its base (the engine scales it by its wind channel). The game tunes
   the per-layer looks in ME.WX.looks().layers. */
(function () {
  const ME = window.ME;
  const $ = (id) => document.getElementById(id);

  const MOODS = {
    auto: { name: "Auto", dusk: null },
    cosy: { name: "Cosy", look: "cosy", dusk: 0 },
    morning: { name: "Morning", look: "morning", dusk: 0 },
    clear: { name: "Clear", look: "clear", dusk: 0 },
    golden: { name: "Golden hour", look: "cosy", dusk: 0.35, set: { sunAz: 55, sunEl: -8, shaftK: 0.4, haze: 0.11 } },
    dusk: { name: "Dusk", look: "cosy", dusk: 0.75 },
    night: { name: "Night", look: "cosy", dusk: 1, after: { exposure: 0.8, amb: 0.6, bloomK: 1.35, shaftK: 0.3 } },
  };
  // the fronts the panel lists (and Random picks from), between Dynamic and Random; the model has more
  // (Dynamic's own and the rare ones, weather.js)
  const PANEL = ["clear", "overcast", "wind", "rain", "storm", "fog", "snow", "petals"];
  // each layer's light, per unit of k (at Weather Normal): f, how much it takes off a lit setting (shaftK
  // 0.88: a full cloud leaves 12 % of the shafts); add, what it adds; the sun break's factors on top
  const LIGHT = {
    cloud: { f: { shaftK: 0.88, pool: 0.65, exposure: 0.09, bloomK: 0.18 }, add: { haze: 0.045 } },
    rain: { f: { exposure: 0.1 }, add: { haze: 0.02 } },
    snow: { f: { exposure: -0.05 }, add: { haze: 0.06 } },
    fog: { f: { shaftK: 0.5, pool: 0.3 }, add: { haze: 0.17, vignette: 0.1 } },
  };
  const SUNBREAK = { shaftK: 1.6, pool: 1.2, exposure: 1.04 };
  // the overlay's strengths per unit of k (1 is a storm's rain, BUDGET particles), and the rain rings
  const FXK = { rain: 1, snow: 1, petals: 0.65, leaves: 1.1 };
  const RINGS = 1.8;
  // the overlay's colours ("r,g,b"; the drops' alpha varies per drop): leaves are two, autumn and green
  const COLOURS = { rain: "205,220,235", snow: "250,252,255", petals: "246,176,198", leaves: ["214,150,62", "138,170,74"], flash: "235,240,255" };
  const MOOD_ROLL = ["cosy", "morning", "clear", "golden", "dusk", "night"];
  const EASE = 1.5, EASE_DYN = 4; // s: the blend toward the weather (slower when it follows the run)
  const CLOUD_RAIN = 0.6; // the least cloud the engine gets while it rains (scaled(); Art: 0.5 the softest)
  // the lit settings the weather and the moods' "after" scale, at rest
  const ONE = { shaftK: 1, pool: 1, exposure: 1, bloomK: 1, amb: 1, haze: 0, vignette: 0, wind: 1, gust: 0.5 };
  const FX = ["rain", "snow", "petals", "leaves"];
  const BUDGET = 520; // overlay particles at full strength (a storm's rain)
  const CAP = 1100; // ... and at most, whatever the intensity and the zoom ask
  // the settings' Weather (a game's menu): how strong the weather is, a factor on its particles, rings and lightning
  // and (up to 1.3) on its light, wind and gusts; Off shows a clear sky whatever the sky panel picks
  const INTENSITY = { off: 0, subtle: 0.4, normal: 1, heavy: 1.6 };
  // each overlay kind's sideways drift per pixel of fall at wind 1 (rain: the slant; snow and petals: their
  // drift over their mean fall speed). The upwind side spawns that much wider, or the wind sweeps the
  // particles off it and leaves it bare (the left of the screen, in rain or snow)
  const DRIFT = { rain: 0.12, snow: 14 / 50, petals: 26 / 55, leaves: 0 };
  // the per-layer looks the game tunes: ME.WX.looks().layers = { light: { <layer>: { f, add } }, sunbreak, fx,
  // rings, budget, colours }, each part merged over the defaults above (a light entry replaces that layer's
  // whole entry; colours are "r,g,b" or "#rgb" / "#rrggbb"); cached until the looks' layers change
  const rgbOf = (c) => {
    if (typeof c !== "string" || c[0] !== "#") return c;
    const h = c.length === 4 ? c.slice(1).replace(/./g, "$&$&") : c.slice(1, 7), n = parseInt(h, 16);
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  };
  let layersOf, layersAll;
  const layers = () => {
    const l = ME.WX.looks().layers;
    if (l !== layersOf || !layersAll) {
      layersOf = l; const o = l || {};
      layersAll = { light: Object.assign({}, LIGHT, o.light), sunbreak: Object.assign({}, SUNBREAK, o.sunbreak), fx: Object.assign({}, FXK, o.fx),
        rings: o.rings ?? RINGS, budget: o.budget ?? BUDGET, colours: Object.assign({}, COLOURS, o.colours) };
      const col = layersAll.colours;
      for (const k in col) col[k] = Array.isArray(col[k]) ? col[k].map(rgbOf) : rgbOf(col[k]);
      layersAll.leaves = [].concat(col.leaves); // (draw() picks from it; hoisted out of the frame)
    }
    return layersAll;
  };
  // the bow, outside to inside, its strength and band width (x the default), and the pale moonbow of a night
  // level (the looks' rainbow.night lists them) or the Night mood; ME.WX.looks().rainbow replaces each one it has
  const RAINBOW = ["#ff5a4e", "#ff9a3c", "#ffe25a", "#7ee06a", "#5ab8ff", "#7a72ff", "#b46cff"], BOW_ALPHA = 0.16, BOW_WIDTH = 1;
  const MOONBOW = ["#e6dcd8", "#eae2d4", "#ecead0", "#dce8dc", "#d6e0ec", "#d8d8ec", "#ded6ea"], MOON_ALPHA = 0.1, NIGHT = [];
  const bowLook = (dusk, level) => {
    const r = ME.WX.looks().rainbow || {}, moon = r.moon || {};
    const night = (r.night || NIGHT).includes(level) || dusk >= 0.9;
    return { bands: night ? moon.bands || MOONBOW : r.bands || RAINBOW, alpha: night ? moon.alpha ?? MOON_ALPHA : r.alpha ?? BOW_ALPHA, width: r.width ?? BOW_WIDTH };
  };

  // the save's version: an older save (another v) is reset on its first load (Auto, or the level's mood, and
  // Dynamic), and any pick made after that is kept. (A saved weather the panel no longer lists reads as Dynamic.)
  const VERSION = 2;
  const load = (key) => {
    try {
      const d = JSON.parse(localStorage.getItem(key) || "{}");
      if (d.v === VERSION) return d;
      localStorage.setItem(key, JSON.stringify({ v: VERSION }));
    } catch (e) { /* storage blocked */ }
    return {};
  };
  const NO_RUN = { id: null, level: "", build: false, over: false, life: 1 }, none = () => {};
  const HOST = { key: "me.sky", seed: () => 1, run: () => NO_RUN, on: none, mood: none, uiScale: () => 1 };

  class Sky {
    constructor(app, host) {
      this.app = app; this.R = app.R; this.scene = app.scene;
      this.host = Object.assign({}, HOST, host);
      this.look = ME.q("preset", "cosy"); // the settings' Light (the game's menu calls setLook)
      const fixed = ME.qn("selftest", 0) || ME.qn("autoplay", 0), saved = fixed ? {} : load(this.host.key), F = ME.WX.fronts();
      // the page address first (any front), then the saved choice (a panel one), then the level's mood or Auto
      // and Dynamic (a new player: weather on at the settings' Normal; the bot and the self-test run Clear)
      const first = (table, ...vs) => vs.find((v) => table[v] || v === "random");
      this.mood = first(MOODS, ME.q("mood", ""), saved.mood, fixed ? "" : this.host.mood(this.host.run().level)) || "auto";
      const pin = ME.q("weather", "");
      this.weather = F[pin] || pin === "random" || pin === "dynamic" ? pin
        : PANEL.includes(saved.weather) || saved.weather === "random" || saved.weather === "dynamic" ? saved.weather
          : fixed ? "clear" : "dynamic";
      this.steady = ME.params.has("wxsteady") ? ME.qn("wxsteady", 0) === 1 : !!saved.steady;
      this.setIntensity("normal", true); // (the game's menu sets the player's)
      this.moodNow = "auto";
      // the model, and the run it follows under Dynamic (a new one starts its level's calm front at once)
      this.model = new ME.Weather(this.host.seed() || 1);
      this.run = { id: undefined, level: undefined };
      this.roll();
      // the blended state: the lit factors, the wind, the gusts and each particle kind's strength
      this.cur = Object.assign({ rain: 0, snow: 0, petals: 0, leaves: 0, rings: 0 }, ONE);
      this.v = ME.WX.zero(); this.sun = false;
      this.parts = []; this.flash = 0; this.nextFlash = 4; this.ringAcc = 0; this.bow = 0;
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.cv = $("wx"); this.ctx = this.cv ? this.cv.getContext("2d") : null;
      const fit = () => { if (this.cv) { this.cv.width = window.innerWidth; this.cv.height = window.innerHeight; } };
      fit(); window.addEventListener("resize", fit);
      this.host.on("start", (e) => {
        if (this.mood === "random") this.roll();
        if (this.weather === "random") this.randomFront();
        else if (this.weather === "dynamic") { const run = this.host.run(); this.follow(run); this.model.waveStart(e.n, run.level, !!e.boss); this.renderPanel(); }
      });
      this.host.on("clear", () => { if (this.weather === "dynamic") this.model.sun = ME.WX.SUN; });
      this.buildPanel();
    }

    // ------------------------------------------------------------------ the fronts
    // Dynamic: a new run (a new game or level) starts the model on its seed and the level's calm front; the
    // build phase drifts back to a calm one once the last front has run its waves
    follow(run = this.host.run()) {
      if (this.weather !== "dynamic") return;
      if (run.id !== this.run.id || run.level !== this.run.level) {
        this.run.id = run.id; this.run.level = run.level;
        this.model.newRun(this.host.seed() || 1, run.level); this.renderPanel();
      }
      if (run.build) this.model.buildPhase(run.level);
    }
    // Random: a panel front other than the one showing
    randomFront() {
      let f; do f = PANEL[(Math.random() * PANEL.length) | 0]; while (f === this.model.front);
      this.model.enter(f); this.renderPanel();
    }
    // the mood Random rolled (a fixed choice is its own pick), and the weather's front for the choice
    roll() {
      if (this.mood === "random") { let m; do m = MOOD_ROLL[(Math.random() * MOOD_ROLL.length) | 0]; while (m === this.moodNow && MOOD_ROLL.length > 1); this.moodNow = m; }
      else this.moodNow = this.mood;
      if (this.weather === "random") this.randomFront();
      else if (this.weather === "dynamic") { this.run.id = undefined; this.follow(); }
      else this.model.enter(this.weather);
      this.renderPanel();
    }
    // the front showing (for the panel), Clear with the settings' Weather off
    shownFront() { return this.level > 0 ? this.model.front : "clear"; }
    // the settings' Weather (a game's menu); ?wxi=off|subtle|normal|heavy pins it (screenshots)
    setIntensity(name, quiet) {
      const pin = ME.q("wxi", ""), k = pin in INTENSITY ? pin : name in INTENSITY ? name : "normal";
      this.level = INTENSITY[k]; this.levelName = k;
      if (!quiet) this.renderPanel();
    }
    choose(kind, v) {
      if (kind === "steady") this.steady = !this.steady;
      else if (kind === "mood") this.mood = v; else this.weather = v;
      if (!ME.qn("selftest", 0) && !ME.qn("autoplay", 0)) try { localStorage.setItem(this.host.key, JSON.stringify({ v: VERSION, mood: this.mood, weather: this.weather, steady: this.steady })); } catch (e) { /* storage blocked */ }
      if (kind === "steady") this.renderPanel(); else this.roll();
    }
    setLook(name) { this.look = ME.PRESETS[name] ? name : "cosy"; }
    // the settings the view's mood() blends from: the style's defaults, the mood's look preset, its overrides
    base() {
      const m = MOODS[this.moodNow] || MOODS.auto;
      return Object.assign({}, this.R.set0, ME.PRESETS[m.look || this.look] || {}, m.set || {});
    }

    // ------------------------------------------------------------------ every frame
    // before the view's update and draw: hand it the base and the mood's dusk; walk the model and resolve its
    // vector (with the run's pulls under Dynamic); blend toward what it asks; move the overlay and drop rain
    // rings on the water
    update(dt) {
      const run = this.host.run(), dyn = this.weather === "dynamic", over = !!run.over;
      this.follow(run); this.at = run.level;
      const md = this.model, m = MOODS[this.moodNow] || MOODS.auto, scene = this.scene;
      scene.base = this.base();
      scene.moodDusk = m.dusk;
      md.walk(dt, this.steady);
      if (!dyn) { md.sun = 0; md.hurt = false; }
      const life = dyn ? run.life ?? 1 : 1;
      const r = md.target({ over: dyn && over }, { reduced: this.reduced });
      this.v = this.level > 0 ? r.v : ME.WX.zero(); this.sun = this.level > 0 && r.sun; this.shower = r.shower;
      md.tick(dt, life, over, this.v);
      if (md.front !== this.lastFront) { this.lastFront = md.front; this.renderPanel(); }
      // the settings' intensity: L on the particles, rings and lightning, Ll on the light, the wind and the gusts
      const v = this.v, t = Object.assign({ rain: 0, snow: 0, petals: 0, leaves: 0, rings: 0 }, ONE), L = this.level, Ll = Math.min(1.3, L);
      const gust = Math.max(0, Math.min(1, 0.5 + (v.gust - 0.5) * Ll)), lk = layers();
      // the engine's path gets the vector after the intensity (the study's knob scales k after the rules), the
      // gust included, so the gusts are written there and not in apply() too
      this.mixed = !!(this.R.weather && this.R.weather.mix);
      // (at the same easing as cur: tau = seconds / 3); the layers it draws itself (R.weather.draws) skip LIGHT
      const dr = this.mixed && this.R.weather.draws;
      if (this.mixed) this.R.weather.mix(this.scaled(L, Ll, gust), 3 * (dyn ? EASE_DYN : EASE));
      for (const k in m.after || {}) t[k] *= m.after[k];
      for (const l in lk.light) {
        if (dr && dr.has(l)) continue;
        const e = lk.light[l], k = (v[l] || 0) * Ll;
        for (const p in e.f || {}) t[p] *= Math.max(0, 1 - e.f[p] * k);
        for (const p in e.add || {}) t[p] += e.add[p] * k;
      }
      if (v.rain > 0.6) t.vignette += 0.15 * (v.rain - 0.6) / 0.4 * Ll; // (a downpour closes in)
      if (this.sun) for (const p in lk.sunbreak) t[p] *= 1 + (lk.sunbreak[p] - 1) * Ll;
      // (wind: about today's 1 under a clear sky's breeze, 2.5 when windy, 3.3 in a gale)
      t.wind = 1 + (Math.max(0.3, 1 + 3 * (v.wind - 0.15)) - 1) * Ll;
      t.gust = gust;
      for (const k of FX) t[k] = v[k] * (lk.fx[k] ?? 1) * L;
      t.rings = v.rain * lk.rings * L;
      const k = 1 - Math.exp(-dt / (dyn ? EASE_DYN : EASE));
      for (const key in t) this.cur[key] += (t[key] - this.cur[key]) * k;
      // lightning: more often and brighter with the flash layer
      if (v.flash > 0.05 && !this.reduced && (this.nextFlash -= dt) <= 0) { this.flash = Math.min(1, L) * (0.5 + 0.5 * v.flash); this.nextFlash = (5 + Math.random() * 9) / (0.5 + v.flash); }
      this.flash = Math.max(0, this.flash - dt * 2.2);
      // the rainbow fades in and out over its life (weather.js starts it when rain ends under a clearing sky)
      const left = md.rainbow, life0 = ME.WX.RAINBOW;
      this.bow = this.level > 0 && left > 0 ? Math.min(1, left / 4, (life0 - left) / 4) * Math.min(1, L) : 0;
      this.rings(dt);
      this.draw(dt);
    }
    // the resolved vector at the settings' intensity, for R.weather.mix(): the light layers (cloud, fog, wind) at
    // Ll, the rest at L, each capped at 1; fogLow stays a flag, and gust is the mapped one (0.5 at rest). Rain
    // keeps the cloud at CLOUD_RAIN or more at any intensity (Subtle's Ll 0.4 left the shafts and pools of a
    // clear day under a drizzle), ramped in from rain 0.02 to 0.08 (no step as a shower starts or ends), except
    // in a sun shower or a sun break (target()'s shower, or this.sun: a break in rain under 0.05 has no shower
    // flag). resolve() calls a front a sun shower only while its rain is 0.5 or less, so a hurt rain past 0.5
    // can carry the shower flag without being one: the floor stays off then, and resolve's own rule greys it,
    // less than the floor would at Subtle (target() setting shower only while rain <= 0.5 would close it)
    // (one object, rewritten each call)
    scaled(L, Ll, gust) {
      const v = this.v, o = this.mixV || (this.mixV = {});
      for (const l of ME.WX.LAYERS) o[l] = Math.min(1, v[l] * (l === "cloud" || l === "fog" || l === "wind" ? Ll : L));
      if (L > 0 && v.rain > 0.02 && !this.shower && !this.sun) {
        const t = Math.min(1, (v.rain - 0.02) / 0.06), k = t * t * (3 - 2 * t);
        o.cloud = Math.max(o.cloud, o.cloud + (CLOUD_RAIN - o.cloud) * k);
      }
      o.fogLow = L > 0 ? v.fogLow : 0; o.gust = gust;
      o.wind = Math.min(1, 0.15 + (v.wind - 0.15) * Ll); // (around its rest, not from 0: equal at Normal)
      return o;
    }
    // at the end of the view's mood(): the preset's other settings (sun, glass, mottle), then the weather's
    // and the mood's factors on what the dusk blend wrote
    apply(s) {
      const b = this.scene.base, c = this.cur;
      for (const p of Object.values(ME.PRESETS)) for (const key in p) if (!(key in ME.DUSK) && key !== "haze") s[key] = b[key];
      for (const key of ["shaftK", "pool", "exposure", "bloomK", "amb"]) s[key] *= c[key];
      s.haze += c.haze; s.vignette += c.vignette;
      // (the wind: the engine scales R.set.windK by its own wind channel once it draws the wind, R.windNow)
      const dw = this.mixed && this.R.weather.draws && this.R.weather.draws.has("wind");
      s.windK = (this.R.set0.windK ?? 1) * (dw ? 1 : c.wind);
      if (!this.mixed) s.gust = c.gust; // (one writer: the mix carries it once the engine has one)
      if (this.flash > 0) s.exposure *= 1 + 1.6 * this.flash * this.flash;
    }
    // the engine draws the rain itself (Weather 2: streaks, rings, splashes): no overlay rain and no rings here
    engineRain() { return !!(this.mixed && this.R.weather.draws && this.R.weather.draws.has("rain")); }
    // raindrops on the open water: rings at random spots of the map, about 14 a second in rain
    rings(dt) {
      const phys = this.app.phys, map = this.app.st.map;
      if (!phys || !map || this.cur.rings < 0.05 || this.app.paused || this.engineRain()) return;
      this.ringAcc += dt * 14 * this.cur.rings;
      for (let tries = 0; this.ringAcc >= 1 && tries < 24; tries++) {
        const x = Math.random() * map.W, y = Math.random() * map.H, z = this.scene.waterAt(x, y);
        if (z === null) continue;
        this.ringAcc -= 1;
        if (phys.ring) phys.ring(x, y, 0.08 + Math.random() * 0.1); else phys.splash([x, y, z], 0.15);
      }
      this.ringAcc = Math.min(this.ringAcc, 3);
    }
    // ------------------------------------------------------------------ the overlay
    // (the wind carries everything rightwards, so a kind starts anywhere up to pad pixels left of the screen, or
    // the left edge would stay bare; sizes and speeds are at the default framing, draw() scales them by the zoom)
    spawn(kind, w, h, anywhere, pad = 30, k = 1) {
      const p = { kind, x: -pad + Math.random() * (w + pad), y: anywhere ? Math.random() * h : -20 * k, r: Math.random(), a: Math.random() * 6.28 };
      if (kind === "rain") { p.vy = 900 + 500 * p.r; p.len = 12 + 12 * p.r; if (!anywhere) p.y = -p.len * k; }
      else if (kind === "snow") { p.vy = 30 + 40 * p.r; p.size = 1 + 1.8 * p.r; }
      else if (kind === "petals") { p.vy = 40 + 30 * p.r; p.size = 2.5 + 2 * p.r; }
      else { p.vy = 60 + 50 * p.r; p.size = 2.5 + 2.5 * p.r; p.x = anywhere ? p.x : -20 * k; p.y = Math.random() * h; }
      return p;
    }
    draw(dt) {
      const ctx = this.ctx;
      if (!ctx) return;
      const w = this.cv.width, h = this.cv.height, c = this.cur, scale = this.reduced ? 0.4 : 1, wind = c.wind, lk = layers(), col = lk.colours, lv = lk.leaves;
      // the zoom (1 at the default framing): closer in, bigger and faster drops and fewer of them, so the screen
      // reads as the same weather nearer; farther out, smaller and more
      const z = Math.min(3, Math.max(0.5, this.scene.zoomIn || 1)), sk = z ** 0.75, ck = Math.min(1.6, Math.max(0.6, 1 / z));
      // how many of each kind the strengths ask for (over the screen and its upwind strip); extra ones fade out by
      // not being respawned
      const want = {}, pad = {}, have = { rain: 0, snow: 0, petals: 0, leaves: 0 };
      let all = 0;
      for (const k of FX) {
        pad[k] = h * DRIFT[k] * Math.max(0, wind) + 30;
        want[k] = lk.budget * c[k] * scale * (k === "rain" ? 1 : 0.6) * ck * (w + pad[k]) / w; all += want[k];
      }
      if (this.engineRain()) { all -= want.rain; want.rain = 0; }
      for (const k of FX) want[k] = Math.round(want[k] * Math.min(1, CAP / Math.max(1, all)));
      for (const p of this.parts) have[p.kind]++;
      for (const k of FX) for (let n = have[k]; n < want[k]; n++) this.parts.push(this.spawn(k, w, h, true, pad[k], sk));
      // (a clear sky leaves the overlay alone: nothing to clear once it is empty)
      if (!this.parts.length && this.flash <= 0 && this.bow <= 0) { if (this.drawn) { ctx.clearRect(0, 0, w, h); this.drawn = false; } return; }
      ctx.clearRect(0, 0, w, h); this.drawn = true;
      // the rainbow: a faint arc low over the far side of the scene, behind the particles
      if (this.bow > 0) {
        const b = bowLook(this.scene.dusk, this.at), cx = w * 0.62, cy = h * 1.08, R0 = Math.min(w, h * 1.6) * 0.62, bw = Math.max(3, h * 0.011) * b.width;
        ctx.save(); ctx.globalAlpha = b.alpha * this.bow; ctx.lineWidth = bw;
        b.bands.forEach((col, i) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, R0 - i * bw, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); });
        ctx.restore();
      }
      const keep = [], left = { rain: want.rain, snow: want.snow, petals: want.petals, leaves: want.leaves }, slant = 0.12 * wind, ds = dt * sk;
      ctx.lineCap = "round";
      for (const p of this.parts) {
        p.a += dt * (0.8 + p.r);
        if (p.kind === "rain") { p.y += p.vy * ds; p.x += p.vy * slant * ds; }
        else if (p.kind === "snow") { p.y += p.vy * ds; p.x += (Math.sin(p.a) * 18 + 14 * wind) * ds; }
        else if (p.kind === "petals") { p.y += p.vy * ds; p.x += (Math.sin(p.a * 0.7) * 30 + 26 * wind) * ds; }
        else { p.x += (90 + 70 * wind) * (0.6 + p.r) * ds; p.y += (Math.sin(p.a) * 40 + 12) * ds; }
        const out = p.y > h + 30 * sk || p.x > w + 40 * sk || p.x < -pad[p.kind] - 60;
        if (out) { if (left[p.kind]-- > 0) keep.push(this.spawn(p.kind, w, h, false, pad[p.kind], sk)); continue; }
        if (left[p.kind]-- <= 0 && Math.random() < dt * 2) continue; // thin out after the weather eases
        keep.push(p);
        if (p.x < -40 * sk) continue; // (still upwind of the screen)
        if (p.kind === "rain") {
          const len = p.len * sk;
          ctx.strokeStyle = `rgba(${col.rain},${0.22 + 0.2 * p.r})`; ctx.lineWidth = (1 + p.r * 0.6) * Math.min(2, sk);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - len * slant, p.y - len); ctx.stroke();
        } else if (p.kind === "snow") {
          ctx.fillStyle = `rgba(${col.snow},${0.55 + 0.35 * p.r})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * sk, 0, 6.283); ctx.fill();
        } else {
          const s = p.size * sk;
          ctx.fillStyle = p.kind === "petals" ? `rgba(${col.petals},${0.7 + 0.25 * p.r})` : `rgba(${lv[p.r < 0.5 ? 0 : lv.length - 1]},0.85)`;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.a * 1.3)));
          ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.6, 0, 0, 6.283); ctx.fill(); ctx.restore();
        }
      }
      this.parts = keep;
      if (this.flash > 0) { ctx.fillStyle = `rgba(${col.flash},${(0.28 * this.flash).toFixed(3)})`; ctx.fillRect(0, 0, w, h); }
    }

    // ------------------------------------------------------------------ the sky panel
    buildPanel() {
      const box = $("sky");
      if (!box) return;
      box.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-k]");
        if (b) this.choose(b.dataset.k, b.dataset.v);
      });
      // a tap outside the panel (and not on its button) closes it and stops there, its ✕ or a swipe too (ME.Dismiss)
      ME.Dismiss.add(box, { outside: true, dir: "any", open: () => box.classList.contains("show"), skip: (t) => !!t.closest("#skybtn"), close: () => this.toggle(false) });
      this.renderPanel();
    }
    toggle(open) {
      const box = $("sky");
      if (!box) return;
      const show = open ?? !box.classList.contains("show");
      box.classList.toggle("show", show);
      $("skybtn") && $("skybtn").classList.toggle("on", show);
      if (show) this.placePanel();
    }
    // the panel drops down under its button in the top row, its left edge at the button's (kept on screen)
    placePanel() {
      const box = $("sky"), btn = $("skybtn");
      if (!box || !btn || !box.classList.contains("show")) return;
      if (!this._placeHook) { this._placeHook = true; addEventListener("resize", () => this.placePanel()); }
      const r = btn.getBoundingClientRect(), w = box.getBoundingClientRect().width, k = this.host.uiScale() || 1; // (screen px, set unzoomed: the UI scale)
      box.style.top = `${Math.round((r.bottom + 8) / k)}px`;
      box.style.left = `${Math.round(Math.max(6, Math.min(r.left, innerWidth - w - 6)) / k)}px`;
      box.style.right = "auto";
    }
    renderPanel() {
      if (!this.model) return;
      const F = ME.WX.fronts(), now = (F[this.model.front] || F.clear).name;
      const row = (kind, list, current, label) => list.map((v) => `<button class="${current === v ? "on" : ""}" data-k="${kind}" data-v="${v}">${label(v)}</button>`).join("");
      const m = $("moodseg"), w = $("wxseg");
      if (m) m.innerHTML = row("mood", [...Object.keys(MOODS), "random"], this.mood,
        (v) => v === "random" ? `⚄ Random${this.mood === "random" ? " · " + MOODS[this.moodNow].name : ""}` : MOODS[v].name);
      // (a front the panel does not list, pinned by ?weather=, shows as its own button)
      const list = ["dynamic", ...PANEL, ...(PANEL.includes(this.weather) || this.weather === "dynamic" || this.weather === "random" ? [] : [this.weather]), "random"];
      if (w) w.innerHTML = row("weather", list, this.weather,
        (v) => v === "random" ? `⚄ Random${this.weather === "random" ? " · " + now : ""}` : v === "dynamic" ? `↻ Dynamic${this.weather === "dynamic" ? " · " + now : ""}` : (F[v] || F.clear).name)
        + `<button class="${this.steady ? "on" : ""}" data-k="steady" data-v="1" title="Hold the weather still instead of letting it wander">≡ Steady</button>`;
      const btn = $("skybtn");
      if (btn) btn.title = `Mood: ${MOODS[this.moodNow].name} · Weather: ${(F[this.shownFront()] || F.clear).name}${this.level > 0 ? "" : " (off in Settings)"}`;
    }
    // for the self-test and the flows: what is showing
    state() {
      const v = {};
      for (const l of ME.WX.LAYERS) v[l] = +this.v[l].toFixed(3);
      return { mood: this.mood, moodNow: this.moodNow, weather: this.weather, weatherNow: this.shownFront(), front: this.model.front, steady: this.steady, intensity: this.levelName, particles: this.parts.length, v, sun: this.sun, hurt: this.model.hurt, rainbow: +this.model.rainbow.toFixed(1), left: this.model.left };
    }
  }
  Sky.MOODS = MOODS;
  ME.Sky = Sky;
})();
