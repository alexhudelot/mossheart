/* The weather model (ME.Weather, ME.WX; moved from Mossheart's view/weather.js, G-W1): the weather is a vector
   of layers, each with an intensity k from 0 to 1 (cloud, rain, snow, fog, fogLow, wind, gust, petals, leaves,
   flash). Fronts are named mixes, each layer given a range; within a front each layer's k wanders on a slow
   bounded walk, so a drizzle swells to a downpour and eases off. Under Dynamic a climate picks a new front every
   one to three waves (never the same twice in a row, one not yet seen weighing double, the heavy ones growing
   with the wave), the host's run still pulls the sky (a boss's front, the hurt rain when its life is low, a
   cleared wave's sun break, game over's downpour), and resolve() applies the mixing rules before anything is
   drawn. ME.Sky (src/sky.js) draws the resolved vector.
   Looks only: the model never reads a game's rng. Its own stream is seeded from the run's seed with a salt
   (?wxseed= pins it, ?wxfront= pins a front), so a replay gets the same sky.
   The game's looks: ME.WX.use(looks, fallback), looks() returning { fronts (merged over FRONTS), climates
   (replacing CLIMATES), ... } or null, fallback the climate a level without one of its own takes (then
   CLIMATES.default). A page loads this file after the engine. */
(function () {
  const ME = window.ME;
  const LAYERS = ["cloud", "rain", "snow", "fog", "fogLow", "wind", "gust", "petals", "leaves", "flash"];
  // layer: [low, high], the range its walk stays in (absent: 0); name: the panel's and the sky button's;
  // heavy: counts toward the escalation's share; rare: its chance at a front change (once a run: newRun clears what it has seen)
  const FRONTS = {
    clear: { name: "Clear", cloud: [0, 0.15], wind: [0.05, 0.3], gust: [0.3, 0.6] },
    overcast: { name: "Overcast", cloud: [0.7, 0.95], wind: [0.15, 0.4], gust: [0.4, 0.6] },
    wind: { name: "Windy", cloud: [0.1, 0.35], wind: [0.5, 0.8], gust: [0.5, 0.8], leaves: [0.3, 0.6] },
    showers: { name: "Showers", cloud: [0.55, 0.85], rain: [0.15, 0.6], wind: [0.3, 0.55], gust: [0.4, 0.7] },
    rain: { name: "Rain", cloud: [0.75, 0.95], rain: [0.35, 0.75], wind: [0.25, 0.5], gust: [0.4, 0.6] },
    storm: { name: "Storm", heavy: true, cloud: [0.9, 1], rain: [0.75, 1], wind: [0.6, 0.9], gust: [0.6, 0.9], flash: [0.5, 1], leaves: [0, 0.3] },
    mistmorn: { name: "Mist", cloud: [0.1, 0.3], fog: [0.35, 0.6], fogLow: [1, 1], wind: [0, 0.15], gust: [0.2, 0.4] },
    fog: { name: "Fog", cloud: [0.3, 0.6], fog: [0.6, 0.95], fogLow: [1, 1], wind: [0, 0.1], gust: [0.2, 0.4] },
    drizzlemist: { name: "Drizzle in mist", cloud: [0.6, 0.85], fog: [0.3, 0.55], rain: [0.1, 0.3], wind: [0.05, 0.25], gust: [0.3, 0.5] },
    gale: { name: "Gale", heavy: true, cloud: [0.4, 0.7], wind: [0.8, 1], gust: [0.7, 1], leaves: [0.5, 0.9] },
    snow: { name: "Snow", cloud: [0.75, 0.95], snow: [0.35, 0.65], wind: [0.15, 0.4], gust: [0.3, 0.5] },
    blizzard: { name: "Blizzard", heavy: true, cloud: [0.9, 1], snow: [0.75, 1], wind: [0.6, 0.9], gust: [0.6, 0.9] },
    petals: { name: "Petals", cloud: [0, 0.2], wind: [0.3, 0.55], gust: [0.4, 0.7], petals: [0.35, 0.7] },
    // the rare ones
    sunshower: { name: "Sun shower", rare: 0.04, cloud: [0.1, 0.3], rain: [0.3, 0.5], wind: [0.15, 0.35], gust: [0.3, 0.5] },
    thundersnow: { name: "Thundersnow", rare: 0.02, heavy: true, cloud: [0.9, 1], snow: [0.6, 0.9], wind: [0.4, 0.7], gust: [0.5, 0.8], flash: [0.3, 0.6] },
    petalstorm: { name: "Petal storm", rare: 0.03, cloud: [0, 0.15], wind: [0.6, 0.85], gust: [0.8, 1], petals: [0.8, 1] },
    goldenhaze: { name: "Golden haze", rare: 0.03, cloud: [0, 0.2], fog: [0.25, 0.35], fogLow: [1, 1], wind: [0, 0.15], gust: [0.2, 0.4] },
    sleet: { name: "Sleet", rare: 0.02, cloud: [0.85, 1], rain: [0.15, 0.25], snow: [0.15, 0.25], wind: [0.3, 0.6], gust: [0.4, 0.7] },
  };
  // each garden's climate: a weight per front (absent: never, the rare ones aside), its calm fronts (the build
  // phase drifts to them), its boss front and, optional, a factor on a rare front's chance (0: never there)
  // a climate: a weight per front (absent: never, the rare ones aside), its calm fronts (the build phase drifts
  // to them), its boss front and, optional, a factor on a rare front's chance (0: never there). The game's
  // looks replace this table; "default" is what a level without a climate takes.
  const CLIMATES = {
    default: { weights: { clear: 3, overcast: 2, wind: 1.5, showers: 2, rain: 1.5, storm: 0.6, mistmorn: 1, fog: 0.6, gale: 0.4, snow: 0.5, blizzard: 0.15, petals: 1.5 }, calm: ["clear", "petals", "mistmorn"], boss: "storm" },
  };
  // the escalation: the heavy fronts' share from wave 1 to wave HEAVY_AT and on
  const HEAVY0 = 0.1, HEAVY1 = 0.3, HEAVY_AT = 12;
  const TAU = 45; // s: the walk's time constant (mean-reverting toward the middle of the range)
  const SUN = 6, SUN_SHOWER = 40; // s: a sun break, and a sun shower's longest
  const HURT_IN = 1 / 3, HURT_OUT = 0.45, HURT_RAIN = 0.3; // the hurt rain: starts (life below), stops (above), how much it adds
  const RAINBOW = 22; // s: a rainbow's life once rain ends under a clear enough sky

  let source = () => null, fallback = "default";
  const use = (looks, fb) => { source = looks || (() => null); fallback = fb || "default"; };
  const looks = () => source() || {};
  // (the merged table, cached until the looks' fronts changes)
  let frontsOf, frontsAll = FRONTS;
  const fronts = () => { const lf = looks().fronts; if (lf !== frontsOf) { frontsOf = lf; frontsAll = lf ? Object.assign({}, FRONTS, lf) : FRONTS; } return frontsAll; };
  const climates = () => looks().climates || CLIMATES;
  const climate = (id) => { const c = climates(); return c[id] || c[fallback] || CLIMATES.default; };
  const zero = () => Object.fromEntries(LAYERS.map((l) => [l, 0]));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // a small seeded stream (mulberry32), the weather's own
  const stream = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ------------------------------------------------------------------ resolve: the mixing rules, in order
  // (a pure function: v is the walked vector, o the context: sunshower (s held), budget (the frame's), the
  // reduced-motion caps). Returns a new vector.
  const WEIGHT = { rain: 1, snow: 0.8, fog: 0.3, cloud: 0.05, wind: 0.02, gust: 0, fogLow: 0, petals: 0.1, leaves: 0.1, flash: 0.05 };
  const resolve = (v, o = {}) => {
    const r = Object.assign(zero(), v);
    for (const l of LAYERS) r[l] = clamp01(r[l] || 0);
    // 1 rain or snow, not both (sleet aside)
    if (!o.sleet) { if (r.rain >= r.snow) r.snow = Math.min(r.snow, 0.15); else r.rain = Math.min(r.rain, 0.15); }
    // 2 precipitation needs cloud (a sun shower aside: rain <= 0.5 for <= SUN_SHOWER s)
    const sunshower = o.sunshower && r.rain <= 0.5 && r.snow <= 0.15;
    if (!sunshower) r.cloud = Math.max(r.cloud, 0.8 * Math.max(r.rain, r.snow));
    // 3 wind thins fog, and the low mist needs still air
    r.fog = Math.min(r.fog, 1 - 0.8 * r.wind);
    if (r.wind > 0.4) r.fogLow = 0;
    // 4 heavy rain washes the fog out
    if (r.rain > 0.6) r.fog = Math.min(r.fog, 0.5);
    // 5 flash needs a storm
    if (!((r.rain >= 0.6 && r.cloud >= 0.8) || r.snow >= 0.6)) r.flash = 0;
    // 6 petals need dry air
    r.petals = Math.min(r.petals, Math.max(0, 1 - 2 * Math.max(r.rain, r.snow)));
    // 7 a blizzard needs wind
    if (r.wind < 0.4) r.snow = Math.min(r.snow, 0.6);
    // 8 at most two particle layers: one falling, one drifting
    if (r.petals >= r.leaves) r.leaves = 0; else r.petals = 0;
    if (!o.sleet) { if (r.rain >= r.snow) r.snow = Math.min(r.snow, 0.15); }
    // the reduced-motion caps (no lightning: rain at 0.5 is no storm, rule 5)
    if (o.reduced) { r.rain = Math.min(r.rain, 0.5); r.snow = Math.min(r.snow, 0.5); r.gust = Math.min(r.gust, 0.3); r.flash = 0; }
    // 9 the frame budget: the particle and fog layers scaled down together to fit
    const budget = o.budget ?? Infinity, cost = LAYERS.reduce((a, l) => a + r[l] * (WEIGHT[l] || 0), 0);
    if (cost > budget) { const s = budget / cost; for (const l of ["rain", "snow", "fog", "petals", "leaves"]) r[l] *= s; }
    return r;
  };
  // the rules as checks (the self-test and the flows run them over random vectors)
  const broken = (r, o = {}) => {
    const bad = [];
    if (!o.sleet && Math.min(r.rain, r.snow) > 0.15) bad.push(1);
    if (!o.sunshower && r.cloud < 0.8 * Math.max(r.rain, r.snow) - 1e-9) bad.push(2);
    if (r.fog > 1 - 0.8 * r.wind + 1e-9 || (r.wind > 0.4 && r.fogLow > 0)) bad.push(3);
    if (r.rain > 0.6 && r.fog > 0.5 + 1e-9) bad.push(4);
    if (r.flash > 0 && !((r.rain >= 0.6 && r.cloud >= 0.8) || r.snow >= 0.6)) bad.push(5);
    if (r.petals > Math.max(0, 1 - 2 * Math.max(r.rain, r.snow)) + 1e-9) bad.push(6);
    if (r.wind < 0.4 && r.snow > 0.6 + 1e-9) bad.push(7);
    if (r.petals > 0 && r.leaves > 0) bad.push(8);
    return bad;
  };

  // ------------------------------------------------------------------ the model
  class Weather {
    constructor(seed) {
      this.reseed(seed);
      this.v = zero(); this.front = "clear"; this.left = 0; this.seen = new Set(); this.rareSeen = new Set();
      this.sun = 0; this.hurt = false; this.rainbow = 0; this.wasRain = 0; this.shower = 0;
    }
    // two streams: the front schedule's and the walk's, so the frames a run lasts never shift its fronts
    reseed(seed) { const s = ME.qn("wxseed", 0) || seed || 1; this.rng = stream(s ^ 0x77ea7e); this.wrng = stream(s ^ 0x3a1c5d); }
    // a front's walk starts in the middle of its ranges
    enter(name) {
      const f = fronts()[name] || FRONTS.clear;
      this.front = name; this.seen.add(name); if (f.rare) this.rareSeen.add(name);
      for (const l of LAYERS) { const r = f[l]; this.v[l] = r ? (r[0] + r[1]) / 2 : this.v[l] * 0.5; }
    }
    // the next front under Dynamic (at a wave start): the climate's weights, never the same twice, unseen ones
    // double, the heavy share by the wave, a rare one now and then
    next(wave, levelId) {
      const pin = ME.q("wxfront", ""), F = fronts();
      if (F[pin]) return pin;
      const c = climate(levelId);
      const rare = c.rare || {};
      for (const k in F) if (F[k].rare && !this.rareSeen.has(k) && k !== this.front && this.rng() < F[k].rare * (rare[k] ?? 1)) return k;
      const heavyShare = HEAVY0 + (HEAVY1 - HEAVY0) * clamp01((wave - 1) / (HEAVY_AT - 1));
      const heavy = this.rng() < heavyShare;
      const pool = Object.keys(c.weights).filter((k) => F[k] && k !== this.front && !!F[k].heavy === heavy);
      const list = pool.length ? pool : Object.keys(c.weights).filter((k) => F[k] && k !== this.front);
      const w = list.map((k) => c.weights[k] * (this.seen.has(k) ? 1 : 2));
      let r = this.rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < list.length; i++) if ((r -= w[i]) < 0) return list[i];
      return list[0] || "clear";
    }
    // a new run: its seed, its garden's calm front
    newRun(seed, levelId) {
      this.reseed(seed); this.seen.clear(); this.rareSeen.clear(); this.left = 0; this.sun = 0; this.hurt = false; this.rainbow = 0;
      const c = climate(levelId), pin = ME.q("wxfront", "");
      this.enter(fronts()[pin] ? pin : c.calm[(this.rng() * c.calm.length) | 0]);
    }
    // a wave starts: a boss's front, or the next one when this one has run its waves
    waveStart(wave, levelId, boss) {
      this.sun = 0;
      const c = climate(levelId);
      if (boss && !ME.q("wxfront", "")) { this.enter(c.boss || "storm"); this.left = 0; return; }
      if (this.left > 0 && fronts()[this.front] && this.front !== c.boss) { this.left--; return; }
      this.enter(this.next(wave, levelId)); this.left = (this.rng() * 3) | 0; // one to three waves
    }
    // the build phase between waves drifts to a calm front once the last one has run out
    buildPhase(levelId) {
      const c = climate(levelId);
      if (this.left <= 0 && !c.calm.includes(this.front) && !ME.q("wxfront", "")) this.enter(c.calm[(this.rng() * c.calm.length) | 0]);
    }
    // every frame: the walk (steady: each layer held in the middle of its range)
    walk(dt, steady) {
      const f = fronts()[this.front] || FRONTS.clear, a = Math.min(1, dt / TAU);
      for (const l of LAYERS) {
        const r = f[l] || [0, 0], mid = (r[0] + r[1]) / 2, half = (r[1] - r[0]) / 2;
        if (steady || half <= 0) { this.v[l] += (mid - this.v[l]) * a * 4; continue; }
        // (the Ornstein-Uhlenbeck step: back toward the middle, plus noise whose rest spread is about the range)
        const n = (this.wrng() + this.wrng() + this.wrng() - 1.5) * 2; // about a unit normal
        this.v[l] += (mid - this.v[l]) * a + half * Math.sqrt(2 * a) * n;
        this.v[l] = Math.max(r[0], Math.min(r[1], this.v[l]));
      }
    }
    // the run's pulls on the walked vector, then resolve(). run: { phase: "build"|"wave"|"over", life, sunBreak }
    target(run, o = {}) {
      const v = Object.assign({}, this.v);
      if (run.over) { v.rain = Math.max(v.rain, 0.9); v.cloud = Math.max(v.cloud, 0.9); v.snow = 0; v.petals = 0; }
      if (this.hurt && !run.over) v.rain = Math.min(1, v.rain + HURT_RAIN);
      let shower = false;
      if (this.sun > 0) {
        // a sun break: the cloud drops, the shafts come back; in rain it is a sun shower (the rain eases)
        v.cloud = Math.min(v.cloud, 0.25); v.fog *= 0.5;
        if (v.rain > 0.05) { v.rain = Math.min(v.rain, 0.45); shower = true; }
        v.snow = Math.min(v.snow, 0.15); v.flash = 0;
      }
      if (this.front === "sunshower") shower = true;
      return { v: resolve(v, Object.assign({ sunshower: shower, sleet: this.front === "sleet" }, o)), sun: this.sun > 0, shower };
    }
    // every frame: the sun break's clock, the hurt rain, the rainbow when rain ends under a clear sky
    tick(dt, life, over, shown) {
      this.sun = Math.max(0, this.sun - dt);
      this.hurt = !over && (this.hurt ? life < HURT_OUT : life < HURT_IN);
      const raining = shown.rain;
      if (this.wasRain > 0.15 && raining < 0.05 && shown.cloud <= 0.35 && !this.rainbow) this.rainbow = RAINBOW;
      if (raining > 0.12 && shown.cloud <= 0.3 && this.sun > 0 && !this.rainbow) this.rainbow = RAINBOW; // a sun shower's
      this.rainbow = Math.max(0, this.rainbow - dt);
      this.wasRain = Math.max(raining, this.wasRain - dt * 0.05);
    }
  }

  // ------------------------------------------------------------------ the checks (CPU only; the self-test and
  // a -Eval run call ME.WX.check()): the rules over n random vectors, then 50 simulated 15-wave runs per garden
  // (the fronts a run sees, the heavy share of the non-boss wave starts; the design asks six or more, and 10 to 30 %)
  const check = (n = 10000, runs = 50, waves = 15) => {
    const rnd = stream(12345), out = { rules: { n, broken: 0, first: null }, gardens: {} };
    for (let i = 0; i < n; i++) {
      const v = Object.fromEntries(LAYERS.map((l) => [l, rnd() < 0.3 ? 0 : rnd()]));
      const o = { sleet: rnd() < 0.05, sunshower: rnd() < 0.05, reduced: rnd() < 0.2 };
      const bad = broken(resolve(v, o), o);
      if (bad.length) { out.rules.broken++; if (!out.rules.first) out.rules.first = { v, o, bad }; }
    }
    for (const id of Object.keys(climates())) { // (the loaded climates, the looks' when they have them)
      let count = 0, heavy = 0, starts = 0, min = Infinity;
      const all = {};
      for (let r = 0; r < runs; r++) {
        const w = new Weather(1000 + r);
        w.newRun(1000 + r, id);
        const seen = new Set([w.front]);
        for (let k = 1; k <= waves; k++) {
          w.buildPhase(id); seen.add(w.front);
          w.waveStart(k, id, k % 5 === 0); seen.add(w.front);
          if (k % 5) { starts++; if ((fronts()[w.front] || {}).heavy) heavy++; } // the boss waves (always heavy) aside
          all[w.front] = (all[w.front] || 0) + 1;
        }
        count += seen.size; min = Math.min(min, seen.size);
      }
      out.gardens[id] = { frontsPerRun: +(count / runs).toFixed(2), minFronts: min, heavyShare: +(heavy / starts).toFixed(3), waveFronts: all };
    }
    return out;
  };

  ME.Weather = Weather;
  ME.WX = { LAYERS, FRONTS, CLIMATES, resolve, broken, fronts, climate, climates, looks, use, stream, zero, check, SUN, RAINBOW };
})();
