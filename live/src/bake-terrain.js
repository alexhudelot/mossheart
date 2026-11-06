/* Terrain bake: a map voxelised at ME.VS voxels per tile edge. The map is a v1 map (st.map.v !== undefined,
   docs/decisions/2026-10-21-map-format.md: heights, kinds from ME.content.kinds, water shapes, props, a
   frame) or a generator map (the diorama format: letters, heights, a water closure, deco), which the bake
   reads as a v1 map whose kinds come from the content's terrain roles (the old style path, until M6).
   Columns rise from the floor to the tile's top; the kind's recipe gives the top (moss carpet, gravel lane
   with stepping stones, pebble river bed, a layer with its trims and road marks), the next few voxels the
   kind's drape, everything below its under material. Lips get 1-3 voxel lobes of the kind's overhang,
   the island is clipped to its circle over a strata drum and a wooden plinth (the jar frame), and static
   props are stamped in from their SDFs. Which deco become volumes or walkers instead of terrain comes from the content
   (ME.content.volumeDeco, .walkers); the jar frame takes its materials from ME.content.terrain (until L4). */
(function () {
  const ME = window.ME, P = window.PX, sm = P.smooth;
  // deco names asset packs want as ray-marched volumes (added to the content's volumeDeco)
  ME.VOLUME_DECO = ME.VOLUME_DECO || new Set();

  // ---- Map format v1: the validator (the reference's MapV1.validate, docs/decisions/2026-10-21-map-format.js)
  const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const STEPS = [0.25, 0.5, 1];
  const RECIPES = {
    // required and optional parameters of each terrain recipe
    layer: { need: ["top", "depth", "under"], may: ["mottle", "mottleK", "edge", "stripe"] },
    carpet: { need: ["top", "under"], may: ["mottle", "cushions", "litter"] },
    lane: { need: ["top", "under"], may: ["stones", "edge", "paving"] },
    water: { need: ["bed", "under"], may: ["shore", "bank", "surface", "depth", "clarity", "tint", "absorb", "calm", "glint", "caustics", "bubbles", "falls", "spray"] },
  };
  // A water kind's look (any of LOOK set): the water pass, the caustics and the bubbles read it. A kind
  // with none of them is drawn as before (look 0). At most 8 looks in a map. FALL (falls, spray) styles only
  // its falls: it takes no look slot and keeps its pools on the plain water pass.
  const LOOK = ["clarity", "tint", "absorb", "calm", "glint", "caustics", "bubbles"], FALL = ["falls", "spray"], LOOK_MAX = 8;
  const looked = (k) => !!k && k.recipe === "water" && LOOK.some((p) => k[p] !== undefined);
  const styled = (k) => looked(k) || (!!k && k.recipe === "water" && FALL.some((p) => k[p] !== undefined));
  ME.waterLooked = looked; // a water kind with a look (it takes a look slot)
  ME.waterStyled = styled; // a water kind with a look or styled falls
  // the options' values, the omitted ones filled in (clarity: 0-1 of the floor seen; tint: the deep colour,
  // linear rgb; absorb: the thickness of water, in tiles along the view ray, that takes the tint to 63%;
  // calm: 0-1, smaller and slower ripples and no wind roughness; glint: the sun glint's gain; caustics:
  // their gain on the floor; bubbles: { rate, seep, size, colour, rise }; falls: { speed, foam, thick }, the
  // falls' flow speed, foam height at the plunge and sheet opacity, gains on today's (1); spray: a rim
  // spill's voxel spray into the void, ME.SPRAY's values for the omitted ones)
  ME.waterLook = (k) => ({
    clarity: k.clarity ?? 0, tint: k.tint ?? [0.1, 0.3, 0.4], absorb: k.absorb ?? 0.45, calm: k.calm ?? 0, glint: k.glint ?? 1, caustics: k.caustics ?? 1,
    bubbles: k.bubbles ? { rate: k.bubbles.rate ?? 0, seep: k.bubbles.seep ?? 0, size: k.bubbles.size ?? [1, 2], colour: k.bubbles.colour ?? [0.85, 0.95, 1], rise: k.bubbles.rise ?? 0.35 } : null,
    falls: { speed: (k.falls && k.falls.speed) ?? 1, foam: (k.falls && k.falls.foam) ?? 1, thick: (k.falls && k.falls.thick) ?? 1 },
    spray: Object.assign({}, ME.SPRAY, k.spray),
  });
  // the rim spill's spray, per spill falls: n voxels in flight, size in terrain voxels, foam the white share
  // (0-1), fade the depth below the plinth (tiles) by which they are gone, colour the water's (linear rgb)
  ME.SPRAY = { n: 200, size: 1, foam: 0.35, fade: 2.5, colour: [0.36, 0.6, 0.72] };
  const FLAGS = ["drape", "overhang", "grass", "fringe", "lamps", "recipe"];
  const AT = ["dx", "dy", "dz", "rot", "flip", "overWater", "as"];

  // anything a JSON round trip would drop or change: functions, undefined, NaN, Infinity, -0
  const impure = (v, path, out) => {
    if (typeof v === "function" || typeof v === "undefined" || typeof v === "symbol" || typeof v === "bigint") out.push(path + " is " + typeof v);
    else if (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0))) out.push(path + " is " + v);
    else if (Array.isArray(v)) v.forEach((x, i) => impure(x, path + "[" + i + "]", out));
    else if (v && typeof v === "object") for (const k in v) impure(v[k], path + "." + k, out);
    return out;
  };
  const rows = (map, key) => {
    const R = map[key];
    if (!Array.isArray(R) || R.length !== map.H) return null;
    return R.map((r) => (typeof r === "string" ? [...r] : r));
  };
  // per tile, row by row: the height in steps, and the kind name (null: no ground)
  const heights = (map) => {
    const out = new Int16Array(map.W * map.H), R = rows(map, "h");
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) { const c = R[y][x]; out[y * map.W + x] = typeof c === "string" ? B36.indexOf(c) : c; }
    return out;
  };
  const kindNames = (map) => {
    const out = [], R = rows(map, "kind");
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) out.push((map.legend || {})[R[y][x]] ?? null);
    return out;
  };

  // The water shapes as one signed distance (+ inside, in tiles): segments with a radius (streams) and
  // ellipses (ponds), with the generator's garden() arithmetic (styles4.js). null without shapes.
  ME.waterDist = (shapes) => {
    if (!shapes || !shapes.length) return null;
    const ds = shapes.map((w) => {
      if (w.ellipse) { const [ex, ey, rx, ry] = w.ellipse; return (x, y) => (1 - Math.hypot((x - ex) / rx, (y - ey) / ry)) * Math.min(rx, ry); }
      const [x0, y0, x1, y1] = w.seg, r = w.r;
      return (x, y) => { const vx = x1 - x0, vy = y1 - y0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy))); return r - Math.hypot(x - x0 - vx * k, y - y0 - vy * k); };
    });
    return (x, y) => { let m = -Infinity; for (const d of ds) m = Math.max(m, d(x, y)); return m; };
  };
  // A flood's region as tile indices: its listed tiles, or the tiles whose centre its ellipse or seg holds
  const floodRegion = (map, f) => {
    if (f.tiles) return f.tiles.map(([x, y]) => y * map.W + x);
    const d = ME.waterDist([f]), out = [];
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) if (d(x + 0.5, y + 0.5) > 0) out.push(y * map.W + x);
    return out;
  };

  // { errors, warnings, box }: box is the bake extent in tiles, the map's or the default (1 tile round
  // the grid, from floor x hStep - 1 to the highest top + 2.5); null when the grid is malformed.
  ME.validateMap = (map, kinds = null) => {
    const errors = [], warnings = [], err = (m) => errors.push(m), warn = (m) => warnings.push(m);
    let gridBad = false, range = null, box = null;
    const gerr = (m) => { gridBad = true; err(m); }; // a malformed h or kind grid
    if (!map || typeof map !== "object") return { errors: ["the map is not an object"], warnings, box };
    if (map.v !== 1) err("v: must be 1 (got " + map.v + ")");
    if (typeof map.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(map.id)) err("id: lowercase letters, digits and dashes");
    const { W, H } = map, hStep = map.hStep ?? 0.5;
    if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1 || W > 64 || H > 64) { err("W, H: integers from 1 to 64"); return { errors, warnings, box }; }
    if (!STEPS.includes(hStep)) err("hStep: 0.25, 0.5 or 1 (tiles per height step)");
    for (const p of impure(map, "map", [])) err(p + ": a map is plain JSON data");
    // heights
    const hr = rows(map, "h");
    if (!hr) gerr("h: " + H + " rows");
    else hr.forEach((r, y) => {
      if (r.length !== W) gerr("h[" + y + "]: " + W + " tiles, got " + r.length);
      r.forEach((c, x) => {
        const ok = typeof c === "string" ? B36.includes(c) && c.length === 1 : Number.isInteger(c) && c >= -64 && c <= 255;
        if (!ok) gerr("h[" + y + "][" + x + "]: a base-36 digit in a string row, or an integer from -64 to 255 in an array row");
      });
    });
    // kinds
    const kr = rows(map, "kind"), legend = map.legend || {};
    if (!map.legend || typeof map.legend !== "object") err("legend: an object, kind character -> kind name (or null for no ground)");
    for (const ch in legend) {
      if ([...ch].length !== 1) err("legend: keys are single characters (" + JSON.stringify(ch) + ")");
      const name = legend[ch];
      if (name !== null && typeof name !== "string") err("legend[" + JSON.stringify(ch) + "]: a kind name or null");
      if (typeof name === "string" && kinds && !kinds[name]) err("legend[" + JSON.stringify(ch) + "]: the content pack has no kind " + JSON.stringify(name));
    }
    const used = new Set();
    if (!kr) gerr("kind: " + H + " rows");
    else kr.forEach((r, y) => {
      if (r.length !== W) gerr("kind[" + y + "]: " + W + " tiles, got " + r.length);
      r.forEach((c, x) => { if (!(c in legend)) err("kind[" + y + "][" + x + "]: " + JSON.stringify(c) + " is not in the legend"); else used.add(c); });
    });
    for (const ch in legend) if (!used.has(ch)) warn("legend[" + JSON.stringify(ch) + "] is never used");
    // the kinds the map uses, as the content pack defines them
    if (kinds) for (const ch of used) {
      const name = legend[ch], k = name && kinds[name];
      if (!k) continue;
      const R = RECIPES[k.recipe];
      if (!R) { err("kind " + name + ": unknown recipe " + JSON.stringify(k.recipe) + " (" + Object.keys(RECIPES).join(", ") + ")"); continue; }
      for (const p of R.need) if (k[p] === undefined) err("kind " + name + " (" + k.recipe + "): needs " + p);
      for (const p in k) if (!R.need.includes(p) && !R.may.includes(p) && !FLAGS.includes(p)) warn("kind " + name + ": unknown parameter " + p);
      if (k.paving && !(Array.isArray(k.paving.stones) && k.paving.stones.length)) warn("kind " + name + ": paving without stones (it paves in its top, " + JSON.stringify(k.top) + ")");
    }
    // floor: every column needs ground under its top
    if (!gridBad) {
      const hs = heights(map), ks = kindNames(map);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < hs.length; i++) if (ks[i] !== null) { lo = Math.min(lo, hs[i]); hi = Math.max(hi, hs[i]); }
      if (!Number.isInteger(map.floor)) err("floor: an integer number of height steps");
      else if (lo !== Infinity && map.floor >= lo) err("floor: must be below the lowest tile (" + lo + "), got " + map.floor);
      range = [lo, hi];
    }
    // water shapes
    for (const [i, w] of (map.water || []).entries()) {
      const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
      if (w.seg) { if (!nums(w.seg, 4) || !(w.r > 0)) err("water[" + i + "]: { seg: [x0, y0, x1, y1], r > 0 }"); }
      else if (w.ellipse) { if (!nums(w.ellipse, 4) || !(w.ellipse[2] > 0 && w.ellipse[3] > 0)) err("water[" + i + "]: { ellipse: [x, y, rx > 0, ry > 0] }"); }
      else err("water[" + i + "]: a seg or an ellipse");
    }
    // floods: still water at an absolute level (tiles, like h x hStep) over a region; the region's tiles
    // below the level are wet, the others stay dry (islands)
    if (map.flood !== undefined && !Array.isArray(map.flood)) err("flood: an array");
    const fAt = new Map(), clash = new Set(), fWet = []; // tile -> [level, flood index]; each flood's wet tiles
    for (const [i, f] of (Array.isArray(map.flood) ? map.flood : []).entries()) {
      const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite), F = "flood[" + i + "]";
      if (!f || typeof f !== "object" || !Number.isFinite(f.level)) { err(F + ": { level (tiles), tiles | ellipse | seg with r }"); continue; }
      if ((f.tiles !== undefined) + (f.ellipse !== undefined) + (f.seg !== undefined) !== 1) { err(F + ": one region: tiles, an ellipse, or a seg with r"); continue; }
      if (f.tiles !== undefined) { if (!Array.isArray(f.tiles) || !f.tiles.length || !f.tiles.every((t) => Array.isArray(t) && t.length === 2 && Number.isInteger(t[0]) && Number.isInteger(t[1]) && t[0] >= 0 && t[1] >= 0 && t[0] < W && t[1] < H)) { err(F + ".tiles: [[x, y], ...], whole tiles on the map"); continue; } }
      else if (f.ellipse !== undefined) { if (!nums(f.ellipse, 4) || !(f.ellipse[2] > 0 && f.ellipse[3] > 0)) { err(F + ": ellipse: [x, y, rx > 0, ry > 0]"); continue; } }
      else if (!nums(f.seg, 4) || !(f.r > 0)) { err(F + ": seg: [x0, y0, x1, y1] with r > 0"); continue; }
      if (gridBad) continue;
      const hs = heights(map), ks = kindNames(map);
      let wet = 0;
      const wl = [];
      for (const t of floodRegion(map, f)) {
        if (ks[t] === null) continue; // no ground, no water
        if (hs[t] * hStep < f.level) { wet++; wl.push(t); }
        const o = fAt.get(t);
        if (!o) fAt.set(t, [f.level, i]);
        else if (o[0] !== f.level && !clash.has(o[1] + "," + i)) { clash.add(o[1] + "," + i); err(F + ": shares tile " + (t % W) + "," + Math.floor(t / W) + " with flood[" + o[1] + "] at another level (" + f.level + " and " + o[0] + ")"); }
      }
      if (!wet) err(F + ": the level " + f.level + " is at or below the top of every tile of its region, so it wets nothing");
      else fWet.push({ i, level: f.level, tiles: wl });
      if (f.water !== undefined) {
        if (typeof f.water !== "string") err(F + ".water: a water kind's name");
        else if (kinds && !(kinds[f.water] && kinds[f.water].recipe === "water")) err(F + ".water: " + JSON.stringify(f.water) + " is not a kind with the water recipe");
      }
    }
    // the rim: a flooded tile beside lower dry ground, no ground or the map's edge holds its water in the air
    // there (a warning: a cut box frame may want the open face)
    if (!gridBad && fWet.length) {
      const hs = heights(map), ks = kindNames(map), wetAll = new Set(fWet.flatMap((w) => w.tiles));
      for (const { i, level, tiles } of fWet) {
        let n = 0, ex = null;
        for (const t of tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = (t % W) + dx, y = Math.floor(t / W) + dy, u = y * W + x, off = x < 0 || y < 0 || x >= W || y >= H;
          if (!off && (wetAll.has(u) || (ks[u] !== null && (hs[u] * hStep >= level || (kinds && kinds[ks[u]] && kinds[ks[u]].recipe === "water"))))) continue;
          n++;
          ex = ex || (t % W) + "," + Math.floor(t / W) + " by " + (off ? "the map's edge" : ks[u] === null ? "no ground at " + x + "," + y : x + "," + y + " (top " + hs[u] * hStep + ")");
        }
        if (n) warn("flood[" + i + "]: " + n + " sides of its water have no bank as high as its level " + level + " (" + ex + "), so the water stands in the air there");
      }
    }
    // the water looks and falls styles: the options' values, and at most LOOK_MAX looked water kinds in the map
    if (kinds) {
      const names = new Set([...used].map((ch) => legend[ch]).filter((n) => n && kinds[n]));
      for (const f of Array.isArray(map.flood) ? map.flood : []) if (f && typeof f.water === "string" && kinds[f.water]) names.add(f.water);
      const lk = [...names].filter((n) => looked(kinds[n]));
      if (lk.length > LOOK_MAX) err("water looks: " + lk.length + " water kinds with a look (" + lk.join(", ") + "), at most " + LOOK_MAX);
      const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
      for (const n of [...names].filter((n) => styled(kinds[n]))) {
        const k = kinds[n], K = "kind " + n + ": ";
        if (k.clarity !== undefined && !num(k.clarity, 0, 1)) err(K + "clarity: 0 to 1");
        if (k.calm !== undefined && !num(k.calm, 0, 1)) err(K + "calm: 0 to 1");
        if (k.absorb !== undefined && !(Number.isFinite(k.absorb) && k.absorb > 0)) err(K + "absorb: > 0 (tiles of water along the view ray)");
        for (const p of ["glint", "caustics"]) if (k[p] !== undefined && !num(k[p], 0, 16)) err(K + p + ": 0 to 16");
        if (k.tint !== undefined && !(Array.isArray(k.tint) && k.tint.length === 3 && k.tint.every((c) => num(c, 0, 4)))) err(K + "tint: [r, g, b], linear, 0 to 4");
        const b = k.bubbles;
        if (b !== undefined) {
          if (!b || typeof b !== "object") err(K + "bubbles: { rate, seep, size, colour, rise }");
          else {
            for (const p of ["rate", "seep"]) if (b[p] !== undefined && !num(b[p], 0, 600)) err(K + "bubbles." + p + ": 0 to 600 a minute");
            if (b.size !== undefined && !(Array.isArray(b.size) && b.size.length === 2 && b.size[0] > 0 && b.size[1] >= b.size[0] && b.size[1] <= 8)) err(K + "bubbles.size: [min, max] voxels, 0 < min <= max <= 8");
            if (b.rise !== undefined && !num(b.rise, 0.05, 4)) err(K + "bubbles.rise: 0.05 to 4 tiles a second");
            if (b.colour !== undefined && !(Array.isArray(b.colour) && b.colour.length === 3 && b.colour.every((c) => num(c, 0, 4)))) err(K + "bubbles.colour: [r, g, b], linear");
          }
        }
        const fl = k.falls;
        if (fl !== undefined) {
          if (!fl || typeof fl !== "object") err(K + "falls: { speed, foam, thick }");
          else for (const p of ["speed", "foam", "thick"]) if (fl[p] !== undefined && !num(fl[p], 0, 4)) err(K + "falls." + p + ": 0 to 4 (1 is today's)");
        }
        const sp = k.spray;
        if (sp !== undefined) {
          if (!sp || typeof sp !== "object") err(K + "spray: { n, size, foam, fade, colour }");
          else {
            if (sp.n !== undefined && !(Number.isInteger(sp.n) && sp.n >= 0 && sp.n <= 1024)) err(K + "spray.n: a whole number, 0 to 1024 per spill");
            if (sp.size !== undefined && !num(sp.size, 0.25, 4)) err(K + "spray.size: 0.25 to 4 voxels");
            if (sp.foam !== undefined && !num(sp.foam, 0, 1)) err(K + "spray.foam: 0 to 1");
            if (sp.fade !== undefined && !num(sp.fade, 0.25, 8)) err(K + "spray.fade: 0.25 to 8 tiles below the plinth");
            if (sp.colour !== undefined && !(Array.isArray(sp.colour) && sp.colour.length === 3 && sp.colour.every((c) => num(c, 0, 4)))) err(K + "spray.colour: [r, g, b], linear");
          }
        }
      }
    }
    if (map.water && map.water.length && kinds && kr) {
      const wet = [...used].some((ch) => legend[ch] && kinds[legend[ch]] && kinds[legend[ch]].recipe === "water");
      if (!wet) warn("water: shapes but no tile of a water kind (shapes only shape the water tiles)");
    }
    // props
    if (map.props !== undefined && !Array.isArray(map.props)) err("props: an array");
    for (const [i, p] of (Array.isArray(map.props) ? map.props : []).entries()) {
      if (!Array.isArray(p) || p.length < 4 || p.length > 5) { err("props[" + i + "]: [model, options, x, y, at?]"); continue; }
      const [model, o, x, y, at] = p;
      if (typeof model !== "string" || !model) err("props[" + i + "]: a model name");
      if (o !== null && (typeof o !== "object" || Array.isArray(o))) err("props[" + i + "]: options are an object or null");
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= W || y >= H) err("props[" + i + "]: the anchor x, y must be a whole tile on the map");
      if (at !== undefined) {
        if (typeof at !== "object" || at === null) { err("props[" + i + "]: at is an object"); continue; }
        for (const k in at) if (!AT.includes(k)) err("props[" + i + "].at: unknown key " + k + " (" + AT.join(", ") + ")");
        if (at.rot !== undefined && ![0, 1, 2, 3].includes(at.rot)) err("props[" + i + "].at.rot: 0-3 quarter turns");
        if (at.as !== undefined && !["stamp", "volume"].includes(at.as)) err("props[" + i + "].at.as: stamp or volume");
        for (const k of ["dx", "dy", "dz"]) if (at[k] !== undefined && !Number.isFinite(at[k])) err("props[" + i + "].at." + k + ": a number (tiles)");
        if (at.rot && at.flip) warn("props[" + i + "]: rot and flip together (flip mirrors x and y, then rot turns)");
      }
      if (window.MODELS && typeof model === "string" && !window.MODELS[model]) warn("props[" + i + "]: no model " + model + " loaded (an error at bake time)");
    }
    // lights
    for (const [i, l] of (map.lights || []).entries()) {
      const ok = l && Array.isArray(l.p) && l.p.length === 3 && l.p.every(Number.isFinite) && l.r > 0 && Array.isArray(l.col) && l.col.length === 3 && l.col.every((c) => c >= 0) && l.k >= 0;
      if (!ok) err("lights[" + i + "]: { p: [x, y, z] (tiles), r > 0, col: [r, g, b], k >= 0 }");
    }
    // frame
    const f = map.frame;
    if (!f || !["jar", "box"].includes(f.type)) err("frame: { type: \"jar\" | \"box\", ... }");
    else if (f.type === "jar") {
      if (!(Array.isArray(f.c) && f.c.length === 2 && f.c.every(Number.isFinite)) || !(f.r > 0)) err("frame (jar): c: [x, y], r > 0");
      if (f.foot !== undefined && !Number.isFinite(f.foot)) err("frame (jar): foot is the drum top (tiles)");
      if (f.spill !== undefined && typeof f.spill !== "boolean") err("frame (jar): spill is true or false (the rim spill, W6)");
    }
    // the bake box: given, or derived
    if (range) {
      const [, hi] = range, z0 = map.floor * hStep - 1, z1 = hi * hStep + 2.5;
      box = map.box || { o: [-1, -1, z0], size: [W + 2, H + 2, Math.ceil(z1 - z0)] };
      if (map.box) {
        const ok = Array.isArray(box.o) && box.o.length === 3 && Array.isArray(box.size) && box.size.length === 3 && box.size.every((n) => Number.isInteger(n) && n > 0);
        if (!ok) { err("box: { o: [x, y, z], size: [w, h, d] } in tiles, sizes whole"); return { errors, warnings, box: null }; }
        if (!box.o.every((n) => Number.isFinite(n) && Number.isInteger(n * 4))) err("box: o in steps of 0.25 tile (on a voxel edge at every vs, all multiples of 4)");
        else if (box.o[0] > 0 || box.o[1] > 0 || box.o[0] + box.size[0] < W || box.o[1] + box.size[1] < H || box.o[2] > map.floor * hStep || box.o[2] + box.size[2] < hi * hStep) err("box: must hold every tile from the floor to the highest top");
      }
      const cells24 = box.size[0] * box.size[1] * box.size[2] * 24 ** 3;
      if (cells24 > 256e6) warn("box: " + Math.round(cells24 / 1e6) + "M voxels at vs=24 (memory: keep a phone map under 256M)");
    }
    return { errors, warnings, box };
  };

  // a map's props as [model, options, x, y, at]: a versioned map's options default to {} (so they key the model
  // bake's variants as {}), a generator map's (st.deco) are kept as they are
  const propsOf = (st) => (st.map.v !== undefined ? (st.map.props || []).map(([name, o, x, y, at]) => [name, o ?? {}, x, y, at || {}])
    : st.deco.filter(Boolean).map(([name, o, x, y, ex]) => [name, o, x, y, ex || {}]));
  // the content's volume and walker deco names
  const decoSets = (CT) => [new Set([...(CT.volumeDeco || []), ...ME.VOLUME_DECO]), new Set(Object.keys(CT.walkers || {}))];
  // what the terrain bake does with a prop: null (no model loaded), "walker", "volume" (baked by the model bake)
  // or "stamp"; at.as ("stamp" or "volume") overrides the content pack's walkers and volumeDeco for this prop
  const propRole = (name, ex, VOLUME_DECO, WALKER_DECO) => (!name || !window.MODELS[name] ? null : !ex.as && WALKER_DECO.has(name) ? "walker"
    : ex.as === "volume" || (!ex.as && VOLUME_DECO.has(name)) ? "volume" : "stamp");
  // The props of st the terrain bake hands the model bake as volumes ([{ name, o }], T.volumes' order), from st
  // and the content alone: ME.bakeModels.start builds its variant list from them before the terrain bake.
  ME.volumeDecoOf = (st, CT = ME.content || {}) => {
    const [V, W] = decoSets(CT);
    return propsOf(st).filter(([name, , , , ex]) => propRole(name, ex, V, W) === "volume").map(([name, o]) => ({ name, o }));
  };

  // ---- The bake's view of a map: per tile its top Z (tiles), its height (for comparing neighbours) and
  // its kind (null: no ground); the water distance (null: none, or whole tiles with wholeWater); the
  // props as [model, options, x, y, at]; the frame; the bake box (tiles); the map's point lights.
  const FIXED_BOX = { o: [-1, -1, -2.5], size: [26, 26, 10] }; // a generator map's
  const gridOf = (st, CT) => {
    const m = st.map;
    if (m.v !== undefined) { // a versioned map (the validator refuses any version but 1)
      const kinds = CT.kinds || {}, v = ME.validateMap(m, kinds), f = m.frame || {};
      for (const p of m.props || []) if (Array.isArray(p) && !window.MODELS[p[0]]) v.errors.push("props: no model " + p[0] + " loaded");
      if (v.errors.length) throw new Error("map " + m.id + ": " + v.errors.join("; "));
      for (const w of v.warnings) ME.log("WARN map " + m.id + ": " + w);
      const hs = heights(m), hStep = m.hStep ?? 0.5, z = new Float64Array(hs.length), names = kindNames(m);
      for (let i = 0; i < hs.length; i++) z[i] = hs[i] * hStep;
      const wd = ME.waterDist(m.water), flood = new Float64Array(hs.length).fill(NaN), floodKind = new Array(hs.length).fill(null);
      for (const f of m.flood || []) for (const t of floodRegion(m, f)) if (names[t] !== null && z[t] < f.level) { flood[t] = f.level; floodKind[t] = f.water || null; }
      return {
        W: m.W, H: m.H, hv: hs, z, names, kinds: names.map((n) => (n === null ? null : kinds[n])), kindTable: kinds, flood, floodKind, laneKinds: (m.game && m.game.lane) || [],
        floorZ: m.floor * hStep, wd, wholeWater: !wd,
        props: propsOf(st),
        frame: f.type === "jar"
          ? { type: "jar", c: f.c.slice(), r: f.r, foot: f.foot ?? 0.92, glassTop: f.glassTop ?? 3.4, strata: f.strata || [], spill: !!f.spill }
          : { type: "box", edge: f.edge ?? "cut" },
        box: v.box, lights: m.lights || [],
      };
    }
    // a generator map: its letters as kinds made of the content's terrain roles (today's constants). Every
    // ground but a sand bank drapes in moss with moss2 strands and throws moss lobes; only "m" grows grass.
    const T = CT.terrain, under = T.rock, drape = [T.moss, T.moss2], overhang = T.moss;
    const moss = { recipe: "carpet", top: T.moss, mottle: T.moss2, cushions: true, litter: T.litter, under, lamps: true, drape, overhang, grass: true };
    const lane = { recipe: "lane", top: T.gravel, stones: T.stone, edge: T.moss, under, drape, overhang };
    const LETTER = {
      m: moss, u: lane, t: lane, _: null,
      w: { recipe: "water", bed: [T.stone, T.pebble, T.pebble2], shore: T.pebble, bank: T.moss, under, drape, overhang },
      // a sand bank needs a sand role; without one an "s" tile is moss that lanes don't fringe towards
      s: T.sand !== undefined ? { recipe: "layer", top: T.sand, depth: 0.3, under } : Object.assign({}, moss, { lamps: false, fringe: false, grass: false }),
    };
    const other = Object.assign({}, moss, { lamps: false, grass: false }); // any other letter
    const W = m.W, H = m.H, hv = new Float64Array(W * H), z = new Float64Array(W * H), kinds = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = m.typ[y][x];
      hv[y * W + x] = m.hgt[y][x]; z[y * W + x] = m.hgt[y][x] * 0.5;
      kinds.push(c in LETTER ? LETTER[c] : other);
    }
    return {
      W, H, hv, z, names: null, kinds, kindTable: Object.assign({ other }, LETTER), floorZ: (m.floor ?? -3) * 0.5, wd: m.waterD || null, wholeWater: false,
      props: propsOf(st),
      frame: { type: "jar", c: [m.geo.C, m.geo.C], r: m.geo.RI, foot: (st.clip && st.clip.foot) ?? 0.92, glassTop: st.glassZt ?? 3.4, strata: st.strata, spill: !!st.spill },
      box: FIXED_BOX, lights: [],
    };
  };

  // A kind with its materials as palette ids, in a fixed order (the order ids are first given in).
  // mottleK, the share of a layer's top in its mottle: the carpet's noise, fbm(X·0.45, Y·0.45, 0, 29), cut at
  // its (1 − K) quantile, measured once on a 128 × 128 grid at half-tile steps (the noise isn't uniform). With
  // no mottleK a layer mottles as the carpet does (above 0.78).
  let FBM_Q = null;
  const mottleCut = (K) => {
    if (K === undefined) return 0.78;
    if (!FBM_Q) {
      FBM_Q = new Float64Array(128 * 128);
      for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) FBM_Q[j * 128 + i] = P.fbm((i + 0.25) * 0.5 * 0.45, (j + 0.25) * 0.5 * 0.45, 0, 29);
      FBM_Q.sort();
    }
    return FBM_Q[Math.min(FBM_Q.length - 1, Math.max(0, Math.floor((1 - K) * FBM_Q.length)))];
  };

  const resolve = (kd, id, VS) => {
    const m = (n) => (n === undefined ? undefined : id(n)), r = Object.assign({}, kd);
    r.top = m(kd.top);
    if (kd.recipe === "carpet") { r.mottle = m(kd.mottle); r.litter = m(kd.litter); }
    if (kd.recipe === "layer") {
      r.mottle = m(kd.mottle); r.mottleCut = mottleCut(kd.mottleK);
      if (kd.edge && kd.edge.mat) r.edge = { mat: id(kd.edge.mat), width: kd.edge.width ?? 0.15, raise: Math.round((kd.edge.raise ?? 0) * VS), facing: new Set(kd.edge.facing || []) };
      if (kd.stripe && kd.stripe.mat) r.stripe = { mat: id(kd.stripe.mat), axis: kd.stripe.axis === "y" ? 1 : 0, width: kd.stripe.width ?? 0.08, dash: kd.stripe.dash ?? 0 };
    }
    if (kd.recipe === "lane") {
      r.stones = m(kd.stones); r.edge = m(kd.edge);
      const pv = kd.paving;
      if (pv) r.paving = {
        stones: (pv.stones && pv.stones.length ? pv.stones : [kd.top]).map(id), joint: m(pv.joint) ?? r.top, dirt: m(pv.dirt) ?? r.top, hole: m(pv.hole) ?? r.top, moss: m(pv.moss) ?? r.edge ?? r.top,
        scale: pv.scale ?? 2.2, gap: pv.gap ?? 0.1, sunk: pv.sunk ?? 0.3, missing: pv.missing ?? 0.05, cracked: pv.cracked ?? 0.15,
        jointCut: mottleCut(pv.jointK ?? 0.7), mossCut: mottleCut(pv.mossK ?? 0.15),
      };
    }
    if (kd.recipe === "water") {
      const b = kd.bed.map(id);
      r.bed = [b[0], b[1] ?? b[0], b[2] ?? b[1] ?? b[0]];
      r.shore = m(kd.shore) ?? r.bed[0]; r.bank = m(kd.bank) ?? r.shore;
      r.surface = kd.surface ?? 1.5 / VS; // the water level below the tile top (tiles)
      r.d0 = kd.depth ? kd.depth[0] : 0.12; r.dd = kd.depth ? kd.depth[1] - kd.depth[0] : 0.34; // bed depth (tiles)
    }
    r.under = m(kd.under);
    // the drape (a material, or [material, strands]) and the overhang lobes' material
    const pair = (v) => (typeof v === "string" ? [id(v), id(v)] : Array.isArray(v) ? [id(v[0]), id(v[1] ?? v[0])] : null);
    r.drape = pair(kd.drape); r.overhang = typeof kd.overhang === "string" ? id(kd.overhang) : 0;
    return r;
  };

  // A lane's paving (an old stone road): setts on a warped cell grid, one voxel proud; moss (or earth) in
  // the joints; some stones sunk flush, some lost (a hollow of the hole material), some cracked across;
  // moss patches over the stones. The moss edge creeping in from the sides is the lane's own.
  const pave = (v, c, out) => {
    const X = c.X, Y = c.Y, S = v.scale;
    const sx = X * S + (P.noise(X * 3, Y * 3, 0, 71) - 0.5) * 0.3, sy = Y * S + (P.noise(X * 3, Y * 3, 1, 71) - 0.5) * 0.3;
    const s = P.cell2(sx, sy, 83), id = s.id, gap = s.f2 - s.f1, ox = sx - s.x, oy = sy - s.y;
    // the joints and cracks at least about a voxel wide, so they stay unbroken lines at any voxel size
    const J = Math.max(v.gap, (1.2 * S) / c.VS), crack = (0.55 * S) / c.VS;
    if (gap < J) { out.mTop = P.fbm(X * 0.9, Y * 0.9, 0, 47) > v.jointCut ? v.dirt : v.joint; return; }
    if (id < v.missing) { out.mTop = gap < J * 2 ? v.joint : v.hole; return; }
    const u = (k) => (id * k) % 1;
    out.mTop = v.stones[Math.floor(u(7.31) * v.stones.length)];
    out.extra = u(13.7) < v.sunk ? 0 : 1;
    // a crack: a line through the stone's middle at its own angle, sunk to the joint
    if (u(29.3) < v.cracked) { const a = u(41.9) * Math.PI; if (Math.abs(ox * Math.cos(a) + oy * Math.sin(a)) < crack) { out.mTop = v.dirt; out.extra = 0; return; } }
    // moss over the stones, thickest near their rims
    if (P.fbm(X * 0.7, Y * 0.7, 0, 53) + (gap < J * 2 ? 0.08 : 0) > v.mossCut) out.mTop = v.moss;
  };

  // ---- Recipes (the decision's section 2): each one sets the surface of one voxel column of a tile of
  // kind k at (c.X, c.Y), tile (c.cx, c.cy), into out: mTop, the top material; extra, voxels raised over
  // the tile top; two, the second voxel down is mTop too (velvet cushions); kT, the column top before
  // extra; bed, a carved bed (no drape); layer, voxels of top over under (no drape, no lobes).
  const RECIPE = {
    // a layer's top: its edge (a trim along the sides facing the named kinds, raised), else its stripe
    // (a road mark along an axis through the tile's middle, dashed), else the top mottled by noise
    layer(k, c, out) {
      out.layer = Math.max(1, Math.round(k.depth * c.VS));
      const fx = c.X - c.cx, fy = c.Y - c.cy, E = k.edge, S = k.stripe;
      if (E) {
        const near = (dx, dy, d) => d < E.width && E.facing.has(c.nameAt(c.cx + dx, c.cy + dy));
        // the sides, then the inner corners: a diagonal neighbour of a facing kind (its two sides not) gets
        // the width × width square at that corner, so the trims along both sides meet without a notch
        const side = near(-1, 0, fx) || near(1, 0, 1 - fx) || near(0, -1, fy) || near(0, 1, 1 - fy);
        const corner = (dx, dy, ex, ey) => ey < E.width && near(dx, dy, ex);
        if (side || corner(-1, -1, fx, fy) || corner(1, -1, 1 - fx, fy) || corner(-1, 1, fx, 1 - fy) || corner(1, 1, 1 - fx, 1 - fy)) { out.mTop = E.mat; out.extra = E.raise; return; }
      }
      if (S) {
        const across = S.axis ? fx : fy, along = S.axis ? c.Y : c.X;
        if (Math.abs(across - 0.5) < S.width / 2 && (!S.dash || along % (2 * S.dash) < S.dash)) { out.mTop = S.mat; return; }
      }
      out.mTop = k.mottle && P.fbm(c.X * 0.45, c.Y * 0.45, 0, 29) > k.mottleCut ? k.mottle : k.top; // the carpet's noise, cut at the share
    },
    carpet(k, c, out) {
      const X = c.X, Y = c.Y;
      out.mTop = k.mottle && P.fbm(X * 0.45, Y * 0.45, 0, 29) > 0.78 ? k.mottle : k.top;
      if (k.cushions && P.fbm(X * 1.6, Y * 1.6, 0, 13) > 0.6) { out.extra = 1; out.two = true; } // velvet cushions
      // fallen leaves, thick under the litter trees and thinning out
      if (k.litter) {
        let lf = 0;
        for (const [tx, ty] of c.trees) { const dd = (X - tx) ** 2 + (Y - ty) ** 2; if (dd < 9) lf = Math.max(lf, 0.16 * Math.exp(-dd / 2.2)); }
        if (lf > 0 && P.hash(Math.floor(X * 9), Math.floor(Y * 9), 0, 44) < lf && Math.hypot(((X * 9) % 1) - 0.5, ((Y * 9) % 1) - 0.5) < 0.42) out.mTop = k.litter;
      }
    },
    lane(k, c, out) {
      const X = c.X, Y = c.Y, lx = X - c.cx, ly = Y - c.cy;
      out.mTop = k.top;
      // the edge material creeping in from the sides that meet a fringing kind
      const e = (dx, dy, dist) => c.fringes(c.cx + dx, c.cy + dy) && dist < 0.1 + 0.14 * P.noise(X * 9, Y * 9, 0, 21);
      if (k.edge && (e(-1, 0, lx) || e(1, 0, 1 - lx) || e(0, -1, ly) || e(0, 1, 1 - ly))) out.mTop = k.edge;
      else if (k.paving) pave(k.paving, c, out);
      else if (k.stones) { const s = P.cell2(X * 1.25, Y * 1.25, 7); if (s.f1 < 0.27) { out.mTop = k.stones; out.extra = 1; } }
    },
    water(k, c, out) {
      const X = c.X, Y = c.Y, wv = c.wetV(X, Y);
      if (wv > 0) {
        out.bed = true;
        out.kT -= Math.max(2, Math.round((k.d0 + k.dd * sm(0, 0.9, wv)) * c.VS));
        out.mTop = P.hash(Math.floor(X * 7), Math.floor(Y * 7), 0, 3) > 0.72 ? k.bed[0] : P.hash(Math.floor(X * 11), Math.floor(Y * 11), 0, 4) > 0.5 ? k.bed[1] : k.bed[2];
      } else out.mTop = wv > -0.12 ? k.shore : k.bank;
    },
  };

  // ---- The terrain grid (T.grid): NX x NY x NZ material ids in bricks of 16^3 cells, of which only the
  // mixed ones hold their cells (a dense grid was a byte a cell: 433 MB at vs40). table: per brick, 0 all
  // air, 1..255 every cell that material, 256 + n mixed, its cells at slot n of pool (4096 bytes, x fastest,
  // then y, then z). A cell id is the dense grid's, k * NX * NY + j * NX + i. The last bricks along an axis
  // may stick out of the grid: their outside cells read as air, are never written and don't count when
  // compact() asks whether a brick is uniform. Writes split a uniform brick into a slot (free list first,
  // then the pool grows by an eighth); compact() folds uniform mixed bricks back (carve and resetTerrain
  // call it over their box, never on idle). Hot loops read whole rows (row, plane) or bricks (bricks). The
  // bake fills it a brick row at a time (band) and never holds the dense grid.
  class BrickGrid {
    constructor(NX, NY, NZ) {
      this.NX = NX; this.NY = NY; this.NZ = NZ; this.PL = NX * NY;
      this.BX = (NX + 15) >> 4; this.BY = (NY + 15) >> 4; this.BZ = (NZ + 15) >> 4; this.BXY = this.BX * this.BY;
      this.table = new Uint32Array(this.BXY * this.BZ);
      this.pool = new Uint8Array(0); this.used = 0; this.free = [];
    }
    // brick row J from band (the bake): 16 rows of j, NX x 16 x NZ cells, x fastest, then j - 16 J, then k.
    // The bricks sorted, then the mixed ones copied to slots (the pool grown once for the row). When NX is a
    // multiple of 4 (every density in use) a brick's rows are 4-byte aligned in band and in pool, so the
    // uniform test and the copy go a word (4 cells) at a time. pre (optional, a brick row's K * BX + I): a
    // material the caller knows fills the brick (0: air), which is taken without looking at buf; -1 scans
    band(J, buf, pre) {
      const { NX, NY, NZ, table: T } = this, BPL = NX * 16, j1 = Math.min(16, NY - J * 16), mix = [];
      const w = (NX & 3) === 0 && (buf.byteOffset & 3) === 0, B4 = w ? new Uint32Array(buf.buffer, buf.byteOffset, buf.length >> 2) : null;
      for (let K = 0; K < this.BZ; K++) for (let I = 0; I < this.BX; I++) {
        if (pre && pre[K * this.BX + I] >= 0) { T[(K * this.BY + J) * this.BX + I] = pre[K * this.BX + I]; continue; }
        const k1 = Math.min(NZ, K * 16 + 16), i0 = I * 16, i1 = Math.min(NX, i0 + 16), v = buf[K * 16 * BPL + i0];
        let uni = true;
        if (w) {
          const v4 = v * 0x01010101, q = (i1 - i0) >> 2;
          for (let k = K * 16; k < k1 && uni; k++) for (let j = 0; j < j1; j++) {
            const r = (k * BPL + j * NX + i0) >> 2;
            let x = 0; while (x < q && B4[r + x] === v4) x++;
            if (x < q) { uni = false; break; }
          }
        } else for (let k = K * 16; k < k1 && uni; k++) for (let j = 0; j < j1; j++) {
          const r = k * BPL + j * NX;
          let i = i0; while (i < i1 && buf[r + i] === v) i++;
          if (i < i1) { uni = false; break; }
        }
        const b = (K * this.BY + J) * this.BX + I;
        if (uni) T[b] = v; else mix.push(b);
      }
      if ((this.used + mix.length) * 4096 > this.pool.length) {
        const p = new Uint8Array((this.used + Math.max(mix.length, 64, this.used >> 3)) * 4096);
        p.set(this.pool.subarray(0, this.used * 4096)); this.pool = p;
      }
      const P = this.pool, P4 = w && (P.byteOffset & 3) === 0 ? new Uint32Array(P.buffer, P.byteOffset, P.length >> 2) : null;
      for (const b of mix) {
        const I = b % this.BX, K = Math.floor(b / this.BXY), s = this.used++, n = Math.min(16, NX - I * 16), k1 = Math.min(NZ, K * 16 + 16);
        T[b] = 256 + s;
        for (let k = K * 16; k < k1; k++) for (let j = 0; j < j1; j++) {
          const r = k * BPL + j * NX + I * 16, d = s * 4096 + ((k & 15) << 8) + (j << 4);
          if (P4) { const r4 = r >> 2, d4 = d >> 2; for (let x = 0; x < n >> 2; x++) P4[d4 + x] = B4[r4 + x]; }
          else for (let x = 0; x < n; x++) P[d + x] = buf[r + x];
        }
      }
    }
    // the cache's form (cache.js packs it): the table, the pool's used slots and the free list
    record() { return { brickGrid: 1, NX: this.NX, NY: this.NY, NZ: this.NZ, table: this.table, pool: this.pool.subarray(0, this.used * 4096), free: Int32Array.from(this.free) }; }
    // r.used: the slots in use when r.pool is longer (the cache unpacks it into room(used), so the first dig
    // after a load doesn't copy the whole pool to grow it)
    static from(r) {
      const g = new BrickGrid(r.NX, r.NY, r.NZ);
      g.table = r.table; g.pool = r.pool; g.used = r.used ?? r.pool.length / 4096; g.free = Array.from(r.free);
      return g;
    }
    // a pool for `used` slots with the headroom alloc() grows by
    static room(used) { return new Uint8Array((used + Math.max(64, used >> 3)) * 4096); }
    get(i, j, k) {
      const e = this.table[((k >> 4) * this.BY + (j >> 4)) * this.BX + (i >> 4)];
      return e < 256 ? e : this.pool[(e - 256) * 4096 + ((k & 15) << 8) + ((j & 15) << 4) + (i & 15)];
    }
    at(idx) { const i = idx % this.NX, r = (idx - i) / this.NX, j = r % this.NY; return this.get(i, j, (r - j) / this.NY); }
    put(i, j, k, m) {
      const b = ((k >> 4) * this.BY + (j >> 4)) * this.BX + (i >> 4), e = this.table[b];
      if (e === m) return;
      let s = e - 256;
      if (e < 256) { s = this.alloc(); this.pool.fill(e, s * 4096, s * 4096 + 4096); this.table[b] = 256 + s; }
      this.pool[s * 4096 + ((k & 15) << 8) + ((j & 15) << 4) + (i & 15)] = m;
    }
    set(idx, m) { const i = idx % this.NX, r = (idx - i) / this.NX, j = r % this.NY; this.put(i, j, (r - j) / this.NY, m); }
    alloc() {
      if (this.free.length) return this.free.pop();
      if (this.used * 4096 >= this.pool.length) {
        const p = BrickGrid.room(this.used);
        p.set(this.pool.subarray(0, this.used * 4096)); this.pool = p;
      }
      return this.used++;
    }
    // the mixed bricks over cells lo..hi (inclusive) whose cells in the grid are all one material go back to
    // uniform, their slots to the free list
    compact(lo, hi) {
      const P = this.pool;
      for (let K = lo[2] >> 4; K <= hi[2] >> 4; K++) for (let J = lo[1] >> 4; J <= hi[1] >> 4; J++) for (let I = lo[0] >> 4; I <= hi[0] >> 4; I++) {
        const b = (K * this.BY + J) * this.BX + I, e = this.table[b];
        if (e < 256) continue;
        const s = (e - 256) * 4096, n0 = Math.min(16, this.NX - I * 16), n1 = Math.min(16, this.NY - J * 16), n2 = Math.min(16, this.NZ - K * 16), v = P[s];
        let uni = true;
        for (let z = 0; z < n2 && uni; z++) for (let y = 0; y < n1; y++) {
          const o = s + (z << 8) + (y << 4);
          let x = 0; while (x < n0 && P[o + x] === v) x++;
          if (x < n0) { uni = false; break; }
        }
        if (uni) { this.table[b] = v; this.free.push(e - 256); }
      }
    }
    // the first solid cell's k in column (i, j) from kFrom down (air bricks skipped), -1 if none
    down(i, j, kFrom) {
      const c = (j >> 4) * this.BX + (i >> 4), o = ((j & 15) << 4) + (i & 15);
      let k = Math.min(this.NZ - 1, kFrom);
      while (k >= 0) {
        const e = this.table[(k >> 4) * this.BXY + c];
        if (e === 0) { k = (k & ~15) - 1; continue; }
        if (e < 256) return k;
        const s = (e - 256) * 4096 + o;
        for (const k0 = k & ~15; k >= k0; k--) if (this.pool[s + ((k & 15) << 8)]) return k;
      }
      return -1;
    }
    // cells i0..i1-1 of row (j, k) into dst from off. A run of bricks with one uniform material is one write
    // (a fill when long, a loop when short: fill's call costs more than 16 stores)
    row(j, k, i0, i1, dst, off = 0) {
      const b0 = ((k >> 4) * this.BY + (j >> 4)) * this.BX, ro = ((k & 15) << 8) + ((j & 15) << 4), T = this.table, P = this.pool;
      for (let i = i0; i < i1; ) {
        const e = T[b0 + (i >> 4)];
        let e1 = (i | 15) + 1;
        if (e < 256) {
          while (e1 < i1 && T[b0 + (e1 >> 4)] === e) e1 += 16;
          if (e1 > i1) e1 = i1;
          const n = e1 - i;
          if (n > 32) { dst.fill(e, off, off + n); off += n; } else for (let x = 0; x < n; x++) dst[off++] = e;
          i = e1;
        } else { if (e1 > i1) e1 = i1; const s = (e - 256) * 4096 + ro - (i & ~15); for (; i < e1; i++) dst[off++] = P[s + i]; }
      }
      return dst;
    }
    // plane k (NX * NY cells, as the dense grid's) into dst: a brick row (16 rows of j) that is one uniform
    // material is one fill
    plane(k, dst) {
      const { NX, NY, BX, table: T } = this;
      for (let J = 0; J < this.BY; J++) {
        const b0 = ((k >> 4) * this.BY + J) * BX, e = T[b0], j0 = J * 16, j1 = Math.min(NY, j0 + 16);
        let I = 1;
        if (e < 256) while (I < BX && T[b0 + I] === e) I++;
        if (I === BX && e < 256) dst.fill(e, j0 * NX, j1 * NX);
        else for (let j = j0; j < j1; j++) this.row(j, k, 0, NX, dst, j * NX);
      }
      return dst;
    }
    // every brick: fn(I, J, K, v, s) with v its material when uniform (s -1), else v -1 and s its slot's offset in pool
    bricks(fn) {
      const T = this.table;
      for (let K = 0, b = 0; K < this.BZ; K++) for (let J = 0; J < this.BY; J++) for (let I = 0; I < this.BX; I++, b++) {
        const e = T[b];
        if (e < 256) fn(I, J, K, e, -1); else fn(I, J, K, -1, (e - 256) * 4096);
      }
    }
    // the dense grid (checks and tools only: a byte a cell)
    dense() { const out = new Uint8Array(this.PL * this.NZ); for (let k = 0; k < this.NZ; k++) this.plane(k, out.subarray(k * this.PL, (k + 1) * this.PL)); return out; }
    stats() {
      let empty = 0, uniform = 0, mixed = 0;
      for (const e of this.table) if (e === 0) empty++; else if (e < 256) uniform++; else mixed++;
      return { bricks: this.table.length, empty, uniform, mixed, slots: this.used, free: this.free.length, MB: +((this.table.byteLength + this.pool.byteLength) / 1048576).toFixed(1) };
    }
  }
  ME.BrickGrid = BrickGrid;
  // T.vox is gone (T.grid): a reader left behind throws and says what to read instead. Not enumerable, so a
  // copy of T (the bake cache's put) leaves it out
  ME.voxGone = (T) => Object.defineProperty(T, "vox", { configurable: true, enumerable: false, get() { throw new Error("T.vox is gone: read T.grid (T.grid.at(idx), .get(i, j, k), .row, .plane, .down)"); } });

  ME.bakeTerrain = async function (st, pal) {
    const t0 = ME.now(), VS = ME.VS, CT = ME.content || {}, G = gridOf(st, CT), F = G.frame, jar = F.type === "jar";
    // the jar (Momiji's island): a circle of radius RI round (C, CY), over a strata drum and a wooden plinth
    const C = jar ? F.c[0] : 0, CY = jar ? F.c[1] : 0, RI = jar ? F.r : 0;
    const RG = RI + 0.35, DRUM = F.foot, PL_R = RG + 0.45, PL_ZB = -2.15, PL_ZT = -1.5, ZF = G.floorZ;
    const B = G.box, O = B.o.slice(), NX = B.size[0] * VS, NY = B.size[1] * VS, NZ = B.size[2] * VS, PLANE = NX * NY;
    // the grid (T.grid) takes the columns a brick row (16 rows of j) at a time from band, so the bake never holds
    // the dense grid (433 MB at vs40; the band is 16 / NY of it)
    const g = new BrickGrid(NX, NY, NZ), BPL = NX * 16, band = new Uint8Array(BPL * NZ);
    // Per band column: wLo..wHi bounds the cells written (other than air), and dLo..dHi (dLo -1: none) is the
    // column's deep run of its kind's under material dM, which is left out of band: a brick that every one of
    // its columns' runs fills is handed to g.band whole (pre), one that no column writes as air, and the runs'
    // cells in the other bricks are written in at the brick row's end (or by roughen, before it carves)
    const wLo = new Int32Array(BPL), wHi = new Int32Array(BPL), dLo = new Int32Array(BPL), dHi = new Int32Array(BPL), dM = new Uint8Array(BPL);
    const pre = new Int32Array(g.BZ * g.BX);
    const undefer = (bc) => { const a = dLo[bc]; if (a < 0) return; for (let k = a, b = dHi[bc], m = dM[bc]; k < b; k++) band[k * BPL + bc] = m; dLo[bc] = -1; };
    const top = new Int16Array(PLANE).fill(-1), lobe = new Uint8Array(PLANE); // lobe: the material a column hangs over lower neighbours
    const id = (n) => pal.id(n);
    // material ids of the roles (moss, moss2, gravel, stone, rock, earth, pebble, pebble2, wood, brass, litter), then of the kinds
    const M = {}, TR = CT.terrain || {};
    for (const k in TR) if (typeof TR[k] === "string") M[k] = id(TR[k]);
    const R = new Map();
    for (const kd of Object.values(G.kindTable)) if (kd && G.kinds.includes(kd)) R.set(kd, resolve(kd, id, VS));
    const kinds = G.kinds.map((kd) => kd && R.get(kd));
    const [VOLUME_DECO, WALKER_DECO] = decoSets(CT);
    const kOf = (Z) => Math.round((Z - O[2]) * VS);
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= G.W || y >= G.H ? null : kinds[y * G.W + x]);
    const recipeAt = (x, y) => { const kd = kindAt(x, y); return kd && kd.recipe; };
    // map.flood: a tile's flood level (NaN: none); a tile is wet with the water recipe or a flood; its level
    // is the higher of the two, and a flood that wins wets the whole tile
    const floodLv = (x, y) => (G.flood && kindAt(x, y) ? G.flood[y * G.W + x] : NaN);
    const wetAt = (x, y) => recipeAt(x, y) === "water" || floodLv(x, y) > -Infinity;
    const ownLv = (x, y) => (recipeAt(x, y) === "water" ? G.z[y * G.W + x] - kindAt(x, y).surface : -Infinity);
    const levelAt = (x, y) => { const f = floodLv(x, y), o = ownLv(x, y); return f > o ? f : o; };
    const fullAt = (x, y) => floodLv(x, y) > ownLv(x, y);
    // whole-tile water (a map without shapes): the distance to the nearest tile that isn't water, or to
    // the map's edge, up to 3 tiles. Each tile lists the dry tiles within 3 once, so the open water of a
    // sea map costs one empty list per column.
    const dryNear = new Map();
    const tileWet = (X, Y) => {
      const cx = Math.floor(X), cy = Math.floor(Y), t = cy * G.W + cx;
      let L = dryNear.get(t);
      if (!L) {
        L = [];
        for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (recipeAt(x, y) !== "water") L.push(x, y); // off the map counts as dry
        dryNear.set(t, L);
      }
      let d = 3;
      for (let i = 0; i < L.length; i += 2) { const x = L[i], y = L[i + 1]; d = Math.min(d, Math.hypot(Math.max(x - X, 0, X - x - 1), Math.max(y - Y, 0, Y - y - 1))); }
      return d;
    };
    const wetV = G.wd ? (X, Y) => G.wd(X, Y) + (P.fbm(X * 1.3, Y * 1.3, 0, 61) - 0.5) * 0.3 : G.wholeWater ? tileWet : () => -1;
    // lanes grow their edge towards no ground, carpets, and kinds that ask with fringe
    const fringes = (x, y) => { const kd = kindAt(x, y); return !kd || (kd.fringe ?? kd.recipe === "carpet"); };
    // Soft tile edges (the user, 2026-10-24: less sharp tile edges at high density; the look agreed with Art).
    // Where a tile stands above its neighbour, its columns near that edge are lowered on a quarter circle of
    // radius r tiles (at most half the drop), and a corner above both neighbours is rounded in plan too, as a
    // rounded box. Only the upper tile changes and never its middle, so the walk and build grid stay; a water
    // neighbour counts at its water level (the bank softens toward it); no ground (the map's edge) stays
    // sharp. Grass, lobes and lamps read the lowered top. r by recipe: carpets 0.18, layers (sand banks) 0.25,
    // lanes and water 0; ME.content.edgeRound = { size, minVS, recipes: { recipe: r }, kinds: { name: r } }
    // overrides (Art: rock kinds 0.05). Off below minVS (24), where 1-2 voxels read as stairs.
    const ER = Object.assign({ size: 0.18, minVS: 24 }, CT.edgeRound), ERR = Object.assign({ layer: 0.25, lane: 0, water: 0 }, ER.recipes), ERK = ER.kinds || {};
    const kindName = new Map();
    for (const [name, kd] of Object.entries(G.kindTable)) if (kd && R.has(kd)) kindName.set(R.get(kd), name);
    const tileK = (x, y) => { const kd = kindAt(x, y), lv = kd && kd.recipe === "water" ? levelAt(x, y) : NaN; return !kd ? Infinity : kOf(lv > -Infinity ? lv : G.z[y * G.W + x]); };
    const lip = (d, R) => (d < R ? R - Math.sqrt(R * R - (R - d) * (R - d)) : 0); // a quarter circle d voxels from the edge
    const soften = (kd, X, Y, cx, cy) => {
      const nm = kindName.get(kd), rad = VS < ER.minVS ? 0 : (ERK[nm] ?? ERR[kd.recipe] ?? ER.size) * VS;
      if (!(rad > 0)) return 0;
      const kT = kOf(G.z[cy * G.W + cx]), fx = X - cx, fy = Y - cy, sx = fx < 0.5 ? -1 : 1, sy = fy < 0.5 ? -1 : 1;
      // voxels from the column's centre to the nearer edges, and the drops past them
      const dx = (sx < 0 ? fx : 1 - fx) * VS, dy = (sy < 0 ? fy : 1 - fy) * VS, ex = kT - tileK(cx + sx, cy), ey = kT - tileK(cx, cy + sy);
      const Rx = ex > 0 && dx < rad ? Math.min(rad, ex / 2) : 0, Ry = ey > 0 && dy < rad ? Math.min(rad, ey / 2) : 0;
      // each side's lip on its own radius; within the smaller radius of both edges, the corner rounded in plan
      // too (a corner on the smaller radius alone left a lump where the sides' radii differ: the Architect)
      let v = Math.max(lip(dx, Rx), lip(dy, Ry));
      const Rc = Math.min(Rx, Ry);
      if (Rc && dx < Rc && dy < Rc) {
        const q = Math.hypot(Rc - dx, Rc - dy), full = Math.min(ex, ey, kT - tileK(cx + sx, cy + sy));
        v = Math.max(v, Math.min(full, q >= Rc ? full : Rc - Math.sqrt(Rc * Rc - q * q)));
      }
      return Math.max(0, Math.round(v));
    };
    const kPB = kOf(PL_ZB), kPT = kOf(PL_ZT), kD = kOf(DRUM), kF = kOf(ZF);
    // Edge breakup (the voxel detail layer's PR 1, docs/designs/2026-10-29-voxel-detail-layer.md, option c):
    // ME.content.edgeBreak = { amp, core, rough, minVS, recipes, kinds, vary, laneWave } turns it on; it is off
    // without it, below minVS (16) and with ?edgebreak=0. Tile borders wander: a column within 2 amp of a side
    // is moved by noise (at most 1.5 amp, tapering to nothing at 2 amp) and takes the kind, height and surface
    // of the tile it lands in, so kind and height borders meander up to about amp tiles (0.15) either side of
    // the tile line, and the tile's core (at least core, 0.4 of the tile) is never moved. A border warps by
    // the smaller amp of its two tiles (recipes: { recipe: amp }, kinds: { name: amp }; lane and water 0),
    // and never into or out of a wet tile or no ground. Rough cliffs: where a dry neighbour lies rough tiles
    // (0.12) or more below, the step's face is pitted by 3D noise up to rough tiles deep, under the top
    // voxels. The map's tiles, heights, lanes, walk and build grid stay; grass, lobes, lamps and the ground
    // (T.top) read the result.
    // PR 2a's knobs, each off when left out: a kind's or recipe's entry may be { amp, rough } (a number is its
    // amp; a step's face takes the rough of its upper tile); vary: { scale, amp: [lo, hi], rough: [lo, hi] }
    // scales each column's amp and rough by low noise fields about scale tiles across; laneWave: { amp, maxDz }
    // carries the top material across the border of a lane and a dry tile about as high (material only).
    const EB0 = ME.qn("edgebreak", 1) === 0 ? null : CT.edgeBreak;
    const EB = EB0 && VS >= (EB0.minVS ?? 16) ? Object.assign({ amp: 0.15, core: 0.4, rough: 0.12 }, EB0) : null;
    const EBR = Object.assign({ lane: 0, water: 0 }, EB && EB.recipes), EBK = (EB && EB.kinds) || {}, EBF = 2.2, AMAX = EB ? (1 - EB.core) / 4 : 0;
    // the map's lane kinds (game.lane: Fernglass walks flagstone and potting sand) keep straight edges too,
    // whatever kinds says: the game reads the ground across a lane (G.laneFrom)
    const EBL = new Set(G.laneKinds || []);
    // a kind's [amp, rough]: its kinds entry, else its recipe's, else the defaults, field by field
    const ebC = new Map(), ebF = (v, f) => (typeof v === "number" ? (f === "amp" ? v : undefined) : v ? v[f] : undefined);
    const ebOf = (kd) => {
      let r = ebC.get(kd);
      if (!r) { const a = EBK[kindName.get(kd)], b = EBR[kd.recipe]; r = [ebF(a, "amp") ?? ebF(b, "amp") ?? EB.amp, ebF(a, "rough") ?? ebF(b, "rough") ?? EB.rough]; ebC.set(kd, r); }
      return r;
    };
    // the column's vary factors for amp and rough (1 without vary), set per column by ebVary
    let ebFa = 1, ebFr = 1;
    const ampAt = (x, y) => {
      const kd = kindAt(x, y);
      if (!kd || wetAt(x, y) || EBL.has(kindName.get(kd))) return 0;
      return Math.max(0, Math.min(ebOf(kd)[0] * ebFa, AMAX));
    };
    const ebN = (X, Y, s) => Math.max(-1, Math.min(1, (P.fbm(X * EBF, Y * EBF, 0, s) - 0.5) * 4));
    // vary: two 2-octave fbm fields at 1/scale (seeds 211 and 223, used nowhere else), smoothstepped from
    // 0.3..0.7 to 0..1 and lerped to [lo, hi]; sampled on a quarter-tile grid, read bilinearly per column
    const EBV = EB && EB.vary, VQ = 4;
    let vf = null, vx0 = 0, vy0 = 0, vw = 0;
    if (EBV) {
      const sc = EBV.scale || 7, VA = EBV.amp || [1, 1], VR = EBV.rough || [1, 1], ss = (t) => { t = Math.max(0, Math.min(1, (t - 0.3) / 0.4)); return t * t * (3 - 2 * t); };
      vx0 = Math.floor(O[0]) - 1; vy0 = Math.floor(O[1]) - 1; vw = Math.ceil(NX / VS + 3) * VQ + 1;
      const vh = Math.ceil(NY / VS + 3) * VQ + 1;
      vf = new Float32Array(vw * vh * 2);
      for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
        const X = (vx0 + i / VQ) / sc, Y = (vy0 + j / VQ) / sc, q = (j * vw + i) * 2;
        vf[q] = VA[0] + (VA[1] - VA[0]) * ss(P.fbm(X, Y, 0, 211, 2));
        vf[q + 1] = VR[0] + (VR[1] - VR[0]) * ss(P.fbm(X, Y, 0, 223, 2));
      }
    }
    const ebVary = (X, Y) => {
      const u = (X - vx0) * VQ, v = (Y - vy0) * VQ, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, q = (j * vw + i) * 2, r = q + vw * 2;
      ebFa = (vf[q] * (1 - a) + vf[q + 2] * a) * (1 - b) + (vf[r] * (1 - a) + vf[r + 2] * a) * b;
      ebFr = (vf[q + 1] * (1 - a) + vf[q + 3] * a) * (1 - b) + (vf[r + 1] * (1 - a) + vf[r + 3] * a) * b;
    };
    // the warped position and its tile into w = [Xw, Yw, tx, ty]
    const ebWarp = (X, Y, cx, cy, w) => {
      w[0] = X; w[1] = Y; w[2] = cx; w[3] = cy;
      const fx = X - cx, fy = Y - cy, sx = fx < 0.5 ? -1 : 1, sy = fy < 0.5 ? -1 : 1, dX = sx < 0 ? fx : 1 - fx, dY = sy < 0 ? fy : 1 - fy;
      const a0 = ampAt(cx, cy);
      if (!(a0 > 0) || (dX >= 2 * a0 && dY >= 2 * a0)) return;
      // per axis, the amp of the border across the nearer side (the same seen from both tiles)
      const ax = Math.min(a0, ampAt(cx + sx, cy)), ay = Math.min(a0, ampAt(cx, cy + sy));
      const Xw = dX < 2 * ax ? X + ebN(X, Y, 83) * 1.5 * ax * (1 - dX / (2 * ax)) : X;
      let Yw = dY < 2 * ay ? Y + ebN(X, Y, 89) * 1.5 * ay * (1 - dY / (2 * ay)) : Y;
      const tx = Math.floor(Xw);
      let ty = Math.floor(Yw);
      if (tx !== cx && ty !== cy && !(ampAt(tx, ty) > 0)) { Yw = Y; ty = cy; } // a corner tile that may not warp: stay in the row
      w[0] = Xw; w[1] = Yw; w[2] = tx; w[3] = ty;
    };
    // the step faces within rough of a column (in warped space): its voxels from the lower top up to under its
    // top voxels are dropped where 3D noise beats a cut rising with the distance from the face. The rough is
    // the column's tile's (the upper tile of the step), times the column's vary factor, at most 2 AMAX, so
    // no content value undercuts the tile's core
    const EB_KEEP = 2;
    const roughen = (Xw, Yw, tx, ty, kd, kEnd, bc) => {
      const RD = Math.min(ebOf(kd)[1] * ebFr, 2 * AMAX) * VS;
      if (!(RD > 0)) return 0;
      const fx = Xw - tx, fy = Yw - ty, sx = fx < 0.5 ? -1 : 1, sy = fy < 0.5 ? -1 : 1, dx = (sx < 0 ? fx : 1 - fx) * VS, dy = (sy < 0 ? fy : 1 - fy) * VS;
      if ((dx >= RD && dy >= RD) || wetAt(tx, ty)) return 0;
      const kT = kOf(G.z[ty * G.W + tx]), drop = Math.max(4, RD);
      let kN = Infinity, d = RD;
      if (dx < RD && !wetAt(tx + sx, ty)) { const k = tileK(tx + sx, ty); if (kT - k >= drop) { kN = Math.min(kN, k); d = Math.min(d, dx); } }
      if (dy < RD && !wetAt(tx, ty + sy)) { const k = tileK(tx, ty + sy); if (kT - k >= drop) { kN = Math.min(kN, k); d = Math.min(d, dy); } }
      if (kN === Infinity) return 0;
      undefer(bc);
      const cut = 0.4 + 0.6 * (d / RD);
      let n = 0;
      for (let k = Math.max(kN, kF); k < kEnd - EB_KEEP; k++) {
        const q = k * BPL + bc;
        if (band[q] && P.noise(Xw * 6, Yw * 6, ((k + 0.5) / VS) * 6, 97) > cut) { band[q] = 0; n++; }
      }
      return n;
    };
    // laneWave: a column within 2 amp of the border between a lane tile (the lane recipe or a game.lane kind)
    // and a dry tile of another sort whose tops differ by maxDz voxels at most takes the top material of the
    // neighbour where the warp's wave (the same noise, at amp) would carry it across, either way: into w =
    // [X, Y, tx, ty] the landing point and tile, true if it crossed. Kind, height and tile logic stay the column's.
    // A sand kind (top or mottle in content.sand) never waves, either way: dig and collapse go by material
    const LW = EB && EB.laneWave, LWA = LW ? LW.amp ?? 0.1 : 0, LWZ = LW ? LW.maxDz ?? 1 : 0;
    const laneAt = (x, y) => { const kd = kindAt(x, y); return kd.recipe === "lane" || EBL.has(kindName.get(kd)); };
    const SAND = new Set(CT.sand || []), sandKd = (kd) => SAND.has(pal.names[kd.top]) || SAND.has(pal.names[kd.mottle]);
    const waveTo = (Xw, Yw, cx, cy, w) => {
      const fx = Xw - cx, fy = Yw - cy, sx = fx < 0.5 ? -1 : 1, sy = fy < 0.5 ? -1 : 1, dX = sx < 0 ? fx : 1 - fx, dY = sy < 0 ? fy : 1 - fy;
      if ((dX >= 2 * LWA && dY >= 2 * LWA) || wetAt(cx, cy) || sandKd(kindAt(cx, cy))) return false;
      const ln = laneAt(cx, cy), kT = kOf(G.z[cy * G.W + cx]);
      const other = (x, y) => !!kindAt(x, y) && !wetAt(x, y) && !sandKd(kindAt(x, y)) && laneAt(x, y) !== ln && Math.abs(kOf(G.z[y * G.W + x]) - kT) <= LWZ;
      if (dX < 2 * LWA && other(cx + sx, cy)) {
        const Xv = Xw + ebN(Xw, Yw, 83) * 1.5 * LWA * (1 - dX / (2 * LWA));
        if (Math.floor(Xv) === cx + sx) { w[0] = Xv; w[1] = Yw; w[2] = cx + sx; w[3] = cy; return true; }
      }
      if (dY < 2 * LWA && other(cx, cy + sy)) {
        const Yv = Yw + ebN(Xw, Yw, 89) * 1.5 * LWA * (1 - dY / (2 * LWA));
        if (Math.floor(Yv) === cy + sy) { w[0] = Xw; w[1] = Yv; w[2] = cx; w[3] = cy + sy; return true; }
      }
      return false;
    };
    const lwW = [0, 0, 0, 0], lwOut = {};
    const ebW = [0, 0, 0, 0];
    let ebCols = 0, ebCarved = 0, lwCols = 0;
    // the rim spill (W6, frame.spill or st.spill): a drum column under a wet map tile on the rim (half a tile
    // inside the island's edge, on the column's own radius) that lies lower than the drum top is notched down
    // to that tile's top; the tile's water falls down the drum's face below (the falls)
    const RS = RI - 0.5, rimTile = (X, Y) => {
      const r = Math.hypot(X - C, Y - CY), s = RS / r, tx = Math.floor(C + (X - C) * s), ty = Math.floor(CY + (Y - CY) * s);
      return F.spill && wetAt(tx, ty) && kOf(G.z[ty * G.W + tx]) < kD ? ty * G.W + tx : -1;
    };
    let wetCols = 0;
    const trees = TR.litterTree ? G.props.filter((d) => TR.litterTree(d)).map((d) => [d[2] + 0.5, d[3] + 0.5]) : [];
    const nameAt = (x, y) => (G.names && x >= 0 && y >= 0 && x < G.W && y < G.H ? G.names[y * G.W + x] : null);
    const c = { VS, X: 0, Y: 0, cx: 0, cy: 0, trees, wetV, fringes, nameAt }, out = {};
    const skirt = !jar && F.edge && F.edge.skirt ? id(F.edge.skirt) : 0, e1 = 1 / VS; // e1: the outermost voxel ring of the map

    for (let j = 0; j < NY; j++) {
      if ((j & 31) === 0) { ME.progress("terrain columns " + Math.round((j / NY) * 100) + "%", 0.05 + 0.15 * (j / NY)); await ME.tick(); }
      const Y = O[1] + (j + 0.5) / VS;
      if ((j & 15) === 0) { band.fill(0); wLo.fill(NZ); wHi.fill(0); dLo.fill(-1); }
      for (let i = 0; i < NX; i++) {
        const X = O[0] + (i + 0.5) / VS, col = j * NX + i, bc = (j & 15) * NX + i;
        if (jar) {
          const r = Math.hypot(X - C, Y - CY);
          if (r > PL_R) continue;
          // wooden plinth with a brass trim on its upper outer edge
          for (let k = kPB; k < kPT; k++) band[k * BPL + bc] = k === kPT - 1 && r > PL_R - 0.09 ? M.brass : M.wood;
          wLo[bc] = kPB; wHi[bc] = kPT;
          top[col] = kPT; lobe[col] = M.moss;
          if (r > RG - 0.06) continue;
          // drum: soil strata seen through the glass, a moss lip under the rim, a moss ring on top
          const U = Math.atan2(Y - CY, X - C) * RG, shell = r > RG - 0.06 - 2.5 / VS, rt = r > RI ? rimTile(X, Y) : -1, kN = rt < 0 ? kD : kOf(G.z[rt]), ZN = rt < 0 ? DRUM : O[2] + kN / VS;
          for (let k = kPT; k < kN; k++) {
            let m = M.earth;
            if (shell) {
              const Zc = O[2] + (k + 0.5) / VS, sr = F.strata && P.strataAt(F, U, Zc, 1);
              if (sr) m = id(sr.ramp);
              if (ZN - Zc < 0.08 + 0.18 * P.fbm(U * 3, 0.5, 0, 71)) m = M.moss;
            }
            band[k * BPL + bc] = m;
          }
          if (r > RI - 0.12) band[(kN - 1) * BPL + bc] = P.fbm(X * 0.45, Y * 0.45, 0, 29) > 0.78 ? M.moss2 : M.moss;
          if (kN > wHi[bc]) wHi[bc] = kN;
          top[col] = kN;
          if (r > RI) continue;
        }
        let cx = Math.floor(X), cy = Math.floor(Y), kd = kindAt(cx, cy), Xw = X, Yw = Y;
        if (!kd) continue;
        // edge breakup: the column takes the tile at its warped position (the own tile in the core)
        if (EB) {
          if (vf) ebVary(X, Y);
          ebWarp(X, Y, cx, cy, ebW);
          Xw = ebW[0]; Yw = ebW[1];
          if (ebW[2] !== cx || ebW[3] !== cy) { cx = ebW[2]; cy = ebW[3]; kd = kindAt(cx, cy); ebCols++; }
        }
        // terrain column: the kind's recipe gives the surface material and micro relief
        out.kT = kOf(G.z[cy * G.W + cx]); out.mTop = 0; out.extra = 0; out.two = false; out.bed = false; out.layer = 0;
        c.X = Xw; c.Y = Yw; c.cx = cx; c.cy = cy;
        RECIPE[kd.recipe](kd, c, out);
        // laneWave: the neighbour's recipe at the landing point gives the top material, nothing else
        if (LW && waveTo(Xw, Yw, cx, cy, lwW)) {
          const nk = kindAt(lwW[2], lwW[3]);
          lwOut.kT = 0; lwOut.mTop = 0; lwOut.extra = 0; lwOut.two = false; lwOut.bed = false; lwOut.layer = 0;
          c.X = lwW[0]; c.Y = lwW[1]; c.cx = lwW[2]; c.cy = lwW[3];
          RECIPE[nk.recipe](nk, c, lwOut);
          c.X = Xw; c.Y = Yw; c.cx = cx; c.cy = cy;
          if (lwOut.mTop) { out.mTop = lwOut.mTop; lwCols++; }
        }
        const { kT, mTop, extra, two, bed, layer } = out;
        if (bed) wetCols++;
        // drape: a couple of voxels under every lip, with hanging strands, and the lobes it hangs over lower
        // neighbours: the kind's drape and overhang (none on a layer, none where the kind asks for none)
        const dr = layer ? null : kd.drape;
        lobe[col] = layer ? 0 : kd.overhang;
        let dd = 2;
        const n1 = P.noise(X * 9, Y * 9, 0, 5);
        if (n1 > 0.52) dd += Math.round((n1 - 0.52) * 30);
        if (P.noise(X * 21, Y * 21, 0, 6) > 0.8) dd += 5;
        const kEnd = kT + extra - soften(kd, Xw, Yw, cx, cy);
        const sk = skirt && (X < e1 || Y < e1 || X > G.W - e1 || Y > G.H - e1);
        // the deep run: below the top voxels, the drape and a layer's top, and above what the jar wrote (the
        // skirt overwrites the whole column, so it has none)
        const uHi = Math.min(kEnd, kEnd - (layer ? layer + extra : 1 + Math.max(two ? 1 : 0, dr && !bed ? dd : 0))), uLo = Math.max(kF, wHi[bc]);
        let a = -1;
        if (!sk && uHi > uLo) { a = uLo; dLo[bc] = uLo; dHi[bc] = uHi; dM[bc] = kd.under; }
        if (kF < wLo[bc]) wLo[bc] = kF;
        if (kEnd > wHi[bc]) wHi[bc] = kEnd;
        for (let k = kF; k < kEnd; k++) {
          if (k === a && (k = uHi) >= kEnd) break;
          const dz = kEnd - 1 - k;
          band[k * BPL + bc] = layer ? (dz < layer + extra ? mTop : kd.under) : dz === 0 || (two && dz === 1) ? mTop : dr && dz <= dd && !bed ? (n1 > 0.7 ? dr[1] : dr[0]) : kd.under;
        }
        if (EB) ebCarved += roughen(Xw, Yw, cx, cy, kd, kEnd, bc);
        if (jar) for (let k = kEnd; k < kD; k++) band[k * BPL + bc] = 0; // beds carved below the drum top
        // a box's skirt: the outer faces of the map's edge tiles, under their top voxel, in one material
        if (sk) for (let k = kF; k < kEnd - 1; k++) band[k * BPL + bc] = skirt;
        top[col] = kEnd;
      }
      if ((j & 15) === 15 || j === NY - 1) {
        const j1 = (j & 15) + 1, BX = g.BX;
        for (let K = 0; K < g.BZ; K++) for (let I = 0; I < BX; I++) {
          const k0 = K * 16, k1 = Math.min(NZ, k0 + 16), i0 = I * 16, i1 = Math.min(NX, i0 + 16);
          let w = false, m = -1; // m: the runs' material while every column's run fills the brick, -2 once one doesn't
          for (let r = 0; r < j1 && !(w && m === -2); r++) for (let bc = r * NX + i0, e = r * NX + i1; bc < e; bc++) {
            if (wLo[bc] < k1 && wHi[bc] > k0) w = true;
            if (m !== -2) m = dLo[bc] >= 0 && dLo[bc] <= k0 && dHi[bc] >= k1 && (m < 0 || dM[bc] === m) ? dM[bc] : -2;
          }
          pre[K * BX + I] = !w ? 0 : m >= 0 ? m : -1;
        }
        for (let bc = 0; bc < j1 * NX; bc++) {
          const a = dLo[bc];
          if (a < 0) continue;
          const b = dHi[bc], m = dM[bc], I = (bc % NX) >> 4;
          for (let K = a >> 4; K <= (b - 1) >> 4; K++) if (pre[K * BX + I] < 0) for (let k = Math.max(a, K * 16), k1 = Math.min(b, K * 16 + 16); k < k1; k++) band[k * BPL + bc] = m;
        }
        g.band(j >> 4, band, pre);
      }
    }

    // Moss overhangs: where a column stands 4+ voxels above a neighbour, hang 0-3 voxels over the lip.
    ME.progress("moss overhangs", 0.21); await ME.tick();
    const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let lobes = 0;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const col = j * NX + i, tk = top[col];
      if (tk < 0 || !lobe[col]) continue; // layers (sand banks) do not overhang
      const X = O[0] + (i + 0.5) / VS, Y = O[1] + (j + 0.5) / VS;
      for (const [dx, dy] of D4) {
        const nc = col + dx + dy * NX, nk = top[nc];
        if (nk < 0 || tk - nk < 4) continue;
        const len = Math.floor(P.noise(X * 7 + dx * 3.1, Y * 7 + dy * 3.1, 0, 9) * 4.6) - 1;
        for (let k = tk - len; k < tk; k++) if (!g.get(i + dx, j + dy, k)) { g.put(i + dx, j + dy, k, lobe[col]); lobes++; }
      }
    }

    // Static props stamped into the grid; volume props and walkers are returned for the model bake.
    const grid = { bricks: g, NX, NY, NZ, O, vs: VS };
    const volumes = [], walkers = [];
    let stamped = 0, propCount = 0;
    const deco = G.props;
    for (let n = 0; n < deco.length; n++) {
      const [name, o, x, y, ex] = deco[n];
      const role = propRole(name, ex, VOLUME_DECO, WALKER_DECO);
      if (!role) continue;
      const place = { name, o, X: x + 0.5 + (ex.dx || 0), Y: y + 0.5 + (ex.dy || 0), Z: G.z[y * G.W + x] + (ex.dz || 0), flip: !!ex.flip };
      if (ex.rot & 3) place.rot = ex.rot & 3; // quarter turns (stamps, volumes, their splat and lights)
      // walkers and volumes go to the model bake (ME.volumeDecoOf lists the same volumes from st)
      if (role === "walker") { walkers.push(place); continue; }
      if (role === "volume") { volumes.push(place); continue; }
      if ((n & 7) === 0) { ME.progress("stamping props " + n + "/" + deco.length, 0.22 + 0.1 * (n / deco.length)); await ME.tick(); }
      stamped += ME.stampModel(ME.modelOf(name, o), place, grid, pal);
      propCount++;
    }

    // Ground lamps (content.groundLamps): one kind lining the lanes, another by the water, on moss tiles
    // clear of the props, at least `spacing` tiles apart. Stamped into the grid; each one lights.
    const lights = [], GL = CT.groundLamps;
    if (GL) {
      const surfZ = (X, Y, zFrom) => {
        const i = Math.floor((X - O[0]) * VS), j = Math.floor((Y - O[1]) * VS);
        const k = g.down(i, j, Math.min(NZ - 1, kOf(zFrom)));
        return k >= 0 ? O[2] + (k + 1) / VS : zFrom;
      };
      const taken = deco.filter((d) => window.MODELS[d[0]]).map((d) => [d[2] + 0.5 + (d[4].dx || 0), d[3] + 0.5 + (d[4].dy || 0)]);
      const cand = [];
      for (let cy = 0; cy < G.H; cy++) for (let cx = 0; cx < G.W; cx++) {
        const kd = kindAt(cx, cy);
        if (!kd || !kd.lamps || fullAt(cx, cy) || (jar && Math.hypot(cx + 0.5 - C, cy + 0.5 - CY) > RI - 1.0)) continue;
        let dir = null, kind = null;
        for (const [dx, dy] of D4) {
          const t = recipeAt(cx + dx, cy + dy);
          if (t === "lane" && G.hv[(cy + dy) * G.W + cx + dx] === G.hv[cy * G.W + cx]) { dir = [dx, dy]; kind = GL.lane; }
          else if ((t === "water" || fullAt(cx + dx, cy + dy)) && !dir) { dir = [dx, dy]; kind = GL.water; }
        }
        if (dir) cand.push({ cx, cy, dir, kind, r: P.hash(cx, cy, 0, 61) });
      }
      cand.sort((a, b) => a.r - b.r);
      const placed = [];
      for (const c of cand) {
        if (placed.length >= GL.max) break;
        const side = (P.hash(c.cx, c.cy, 1, 61) - 0.5) * 0.4;
        const X = c.cx + 0.5 + c.dir[0] * 0.3 + (c.dir[1] ? side : 0), Y = c.cy + 0.5 + c.dir[1] * 0.3 + (c.dir[0] ? side : 0);
        if (placed.some((p) => Math.hypot(p.X - X, p.Y - Y) < GL.spacing) || taken.some(([tx, ty]) => Math.hypot(tx - X, ty - Y) < 0.75)) continue;
        const Z = surfZ(X, Y, G.z[c.cy * G.W + c.cx] + 0.6), o = { seed: 1 + placed.length * 7 }, md = ME.modelOf(c.kind.model, o);
        stamped += ME.stampModel(md, { X, Y, Z, flip: false }, grid, pal);
        placed.push({ X, Y });
        const lp = [X, Y, Z + md.lz * md.k];
        const L = c.kind.light;
        lights.push({ p: lp, r: L.r, col: L.col.slice(), k: L.k, mat: L.mat });
      }
    }

    // The map's point lights (tiles)
    for (const l of G.lights) lights.push({ p: l.p.slice(), r: l.r, col: l.col.slice(), k: l.k });

    // Water: one surface quad per wet tile, falls where a wet tile steps down into lower water. Between two
    // water-recipe tiles, flow and falls follow the height steps (hv), as before floods; where either tile
    // is flooded, they follow the water levels. T.tiles gets each tile's wetness and deepest water.
    const water = [], falls = [], wetT = new Uint8Array(G.W * G.H), depthT = new Float32Array(G.W * G.H);
    // the looks: 0 is today's water; a looked water kind gets the next index, in the order its tiles come
    const looks = [null], lookIx = new Map();
    const lookOf = (name) => {
      const k = name && G.kindTable[name];
      if (!looked(k)) return 0;
      if (!lookIx.has(name)) { lookIx.set(name, looks.length); looks.push(Object.assign({ kind: name }, ME.waterLook(k))); }
      return lookIx.get(name);
    };
    // a falls' style: its water kind's falls and spray (ME.waterLook's), null for today's; a falls-only kind
    // gets one without a look
    const fallsIx = new Map();
    const fallsOf = (name) => {
      const k = name && G.kindTable[name];
      if (!styled(k)) return null;
      if (!fallsIx.has(name)) { const L = ME.waterLook(k); fallsIx.set(name, { falls: L.falls, spray: L.spray }); }
      return fallsIx.get(name);
    };
    for (let cy = 0; cy < G.H; cy++) for (let cx = 0; cx < G.W; cx++) {
      const kd = kindAt(cx, cy), full = fullAt(cx, cy);
      if (!kd || !wetAt(cx, cy)) continue;
      let any = full;
      for (let s = 0; s < 64 && !any; s++) any = wetV(cx + ((s % 8) + 0.5) / 8, cy + (Math.floor(s / 8) + 0.5) / 8) > 0;
      if (!any) continue;
      const h = G.hv[cy * G.W + cx], Zw = levelAt(cx, cy), byLevel = (x, y) => floodLv(cx, cy) > -Infinity || floodLv(x, y) > -Infinity;
      // 1: a wet neighbour's water lies lower, -1 higher, 0 level (by height steps, or by level)
      const below = (x, y) => {
        if (!byLevel(x, y)) return Math.sign(h - G.hv[y * G.W + x]);
        const d = Zw - levelAt(x, y);
        return d > 0.5 / VS ? 1 : d < -0.5 / VS ? -1 : 0;
      };
      wetT[cy * G.W + cx] = 1;
      depthT[cy * G.W + cx] = Zw - (G.z[cy * G.W + cx] - (kd.recipe === "water" ? kd.d0 + kd.dd : 0));
      let fx = 0, fy = 0;
      for (const [dx, dy] of D4) if (wetAt(cx + dx, cy + dy)) { const d = below(cx + dx, cy + dy); if (d > 0) { fx += dx; fy += dy; } else if (d < 0) { fx -= dx; fy -= dy; } }
      const stream = G.wd && Math.abs(G.wd(cx + 0.5, cy + 0.5)) < 1 && (fx || fy) ? 1 : 0;
      const nm = full && G.floodKind ? G.floodKind[cy * G.W + cx] : G.names ? G.names[cy * G.W + cx] : null, lk = lookOf(nm), fk = fallsOf(nm);
      water.push({ x: cx, y: cy, z: Zw, fx, fy, stream, look: lk });
      for (const [dx, dy] of D4) {
        if (!wetAt(cx + dx, cy + dy) || below(cx + dx, cy + dy) <= 0) continue;
        // wet run along the shared edge, sampled just inside the upper tile (all of it under a flood)
        let u0 = full ? 0 : 1, u1 = full ? 1 : 0;
        for (let s = 0; s < 32 && !full; s++) {
          const u = (s + 0.5) / 32, ex = dx ? cx + (dx > 0 ? 1 - 0.5 / VS : 0.5 / VS) : cx + u, ey = dy ? cy + (dy > 0 ? 1 - 0.5 / VS : 0.5 / VS) : cy + u;
          if (wetV(ex, ey) > 0) { u0 = Math.min(u0, u - 0.5 / 32); u1 = Math.max(u1, u + 0.5 / 32); }
        }
        if (u1 <= u0) continue;
        const ztop = Zw, zbot = levelAt(cx + dx, cy + dy), off = 0.7 / VS;
        // the falling sheet stands just in front of the cliff face, facing the lower tile
        const ex0 = dx ? cx + (dx > 0 ? 1 + off : -off) : cx + u0, ey0 = dy ? cy + (dy > 0 ? 1 + off : -off) : cy + u0;
        const ex1 = dx ? ex0 : cx + u1, ey1 = dy ? ey0 : cy + u1;
        falls.push({ a: [ex0, ey0], b: [ex1, ey1], ztop, zbot, n: [dx, dy], fk });
      }
      // the rim spill: a rim tile that notches the drum (rimTile, on its centre's radius) pours over it, one
      // sheet just outside the drum's face, facing out, from its water down to the plinth; its width is the
      // tile's wet run across that radius, scaled out from RS to the face; lip: [x, y, z, width], where its mist starts,
      // on the rim tile 0.35 inside RS (the sheet's foot is on the plinth, outside the glass)
      if (F.spill && kOf(G.z[cy * G.W + cx]) < kD) {
        const r0 = Math.hypot(cx + 0.5 - C, cy + 0.5 - CY), nx = (cx + 0.5 - C) / r0, ny = (cy + 0.5 - CY) / r0, qx = C + nx * RS, qy = CY + ny * RS;
        if (r0 > 0 && Math.floor(qx) === cx && Math.floor(qy) === cy) {
          let t0 = 1, t1 = -1;
          for (let s = 0; s < 32; s++) {
            const t = (s + 0.5) / 32 - 0.5, X = qx - ny * t, Y = qy + nx * t;
            if (Math.floor(X) === cx && Math.floor(Y) === cy && (full || wetV(X, Y) > 0)) { t0 = Math.min(t0, t - 0.5 / 32); t1 = Math.max(t1, t + 0.5 / 32); }
          }
          const rf = RG - 0.06 + 0.7 / VS, sc = rf / RS, fx0 = C + nx * rf, fy0 = CY + ny * rf;
          if (t1 > t0) falls.push({ a: [fx0 - ny * t0 * sc, fy0 + nx * t0 * sc], b: [fx0 - ny * t1 * sc, fy0 + nx * t1 * sc], ztop: Zw, zbot: PL_ZT, n: [nx, ny], spill: true, fk,
            lip: [qx - nx * 0.35 - ny * (t0 + t1) / 2, qy - ny * 0.35 + nx * (t0 + t1) / 2, Zw, Math.min(0.6, t1 - t0)] });
        }
      }
    }

    // Density for normals/AO from half resolution up (mip0 = 2x2x2 box average of occupancy, mip1 = 4x4x4) and the coarse occupancy
    // (about 8 cells per tile at any VS, taller than the voxel grid so the tree canopies fit) that feeds the sun volume.
    ME.progress("density mips", 0.33); await ME.tick();
    // the props and lobes split bricks: the ones they left one material fold back
    g.compact([0, 0, 0], [NX - 1, NY - 1, NZ - 1]);
    // one pass over the grid's bricks: the solid count, the top (the highest k with a solid cell among every
    // 7th cell of its plane) and mip0, the occupancy (255 where solid) of each 2x2x2 averaged. A brick's 2x2x2
    // never straddles bricks, so a uniform brick is its size, its top and an 8^3 block of mip0 at once
    let solid = 0, kMax = 0;
    const MX = NX >> 1, MY = NY >> 1, MZ = NZ >> 1, d1 = new Uint8Array(MX * MY * MZ), GP = g.pool;
    const s7 = (j, i0) => i0 + (7 - (j * NX + i0) % 7) % 7; // row j's first 7th cell from i0
    g.bricks((I, J, K, v, s) => {
      if (v === 0) return;
      const i0 = I << 4, j0 = J << 4, k0 = K << 4, i1 = Math.min(NX, i0 + 16), j1 = Math.min(NY, j0 + 16), k1 = Math.min(NZ, k0 + 16);
      const x0 = i0 >> 1, x1 = Math.min(MX, x0 + 8), y0 = j0 >> 1, y1 = Math.min(MY, y0 + 8), z0 = k0 >> 1, z1 = Math.min(MZ, z0 + 8);
      if (v > 0) {
        solid += (i1 - i0) * (j1 - j0) * (k1 - k0);
        if (k1 - 1 > kMax) for (let j = j0; j < j1; j++) if (s7(j, i0) < i1) { kMax = k1 - 1; break; }
        for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let c = (z * MY + y) * MX + x0, e = c + x1 - x0; c < e; c++) d1[c] = 255;
        return;
      }
      let n = 0;
      for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) {
        const o = s + ((k & 15) << 8) + ((j & 15) << 4) - i0;
        for (let i = i0; i < i1; i++) if (GP[o + i]) n++;
      }
      solid += n;
      if (n) for (let k = k1 - 1, hit = false; k > kMax && !hit; k--) for (let j = j0; j < j1 && !hit; j++) {
        const o = s + ((k & 15) << 8) + ((j & 15) << 4) - i0;
        for (let i = s7(j, i0); i < i1; i += 7) if (GP[o + i]) { kMax = k; hit = true; break; }
      }
      for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = s + (((2 * z) & 15) << 8) + (((2 * y) & 15) << 4) + ((2 * x) & 15);
        d1[(z * MY + y) * MX + x] = ((GP[o] ? 255 : 0) + (GP[o + 1] ? 255 : 0) + (GP[o + 16] ? 255 : 0) + (GP[o + 17] ? 255 : 0) +
          (GP[o + 256] ? 255 : 0) + (GP[o + 257] ? 255 : 0) + (GP[o + 272] ? 255 : 0) + (GP[o + 273] ? 255 : 0)) >> 3;
      }
    });
    // mip1: mip0's 2x2x2 averaged
    const down = (src, nx, ny, nz) => {
      const mx = nx >> 1, my = ny >> 1, mz = nz >> 1, out = new Uint8Array(mx * my * mz);
      for (let z = 0; z < mz; z++) for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) {
        let s = 0;
        for (let c = 0; c < 8; c++) s += src[((2 * z + (c >> 2)) * ny + 2 * y + ((c >> 1) & 1)) * nx + 2 * x + (c & 1)];
        out[(z * my + y) * mx + x] = s >> 3;
      }
      return out;
    };
    const d2 = down(d1, MX, MY, MZ);
    // the coarse grid is 3 tiles taller than the box (13 tiles for a generator map), f voxels a cell
    const f = ME.coarseStep(VS), CPU = VS / f, QX = NX / f, QY = NY / f, QZ = (B.size[2] + 3) * CPU, coarse = new Uint8Array(QX * QY * QZ);

    // Beams stand on the tile below their foot point (px3 P.lightAt needs bm.z).
    const beams = (st.light.beams || []).map((b) => Object.assign({}, b, { z: b.z ?? G.z[Math.min(G.H - 1, Math.floor(b.y)) * G.W + Math.min(G.W - 1, Math.floor(b.x))] }));

    // Walkable ground: first solid voxel scanning down from zFrom.

    const stats = { dims: [NX, NY, NZ], solid, wetCols, lobes, props: propCount, lanterns: lights.length, stampedVoxels: stamped, water: water.length, falls: falls.length, flooded: G.flood ? water.filter((w) => fullAt(w.x, w.y)).length : 0, edgeBreak: EB ? Object.assign({ cols: ebCols, carved: ebCarved }, LW ? { waved: lwCols } : null) : null, zTop: O[2] + (kMax + 1) / VS, ms: Math.round(ME.now() - t0) };
    // bounds: the world box in tiles; frame: the map's (jar or box); geo: the jar's measures (null in a box)
    const bounds = { min: O.slice(), max: [O[0] + B.size[0], O[1] + B.size[1], O[2] + B.size[2]] };
    // tiles: per tile of the map, its top (tiles), its kind's name (null on a generator map) and recipe (null:
    // no ground), and whether it grows grass (what the sim and the grass read instead of the map's letters)
    const tiles = { W: G.W, H: G.H, z: G.z, name: G.names, recipe: G.kinds.map((k) => (k ? k.recipe : null)), grass: Uint8Array.from(G.kinds, (k) => (k && k.grass ? 1 : 0)), wet: wetT, depth: depthT };
    const T = { O, NX, NY, NZ, VS, grid: g, top, mips: [d1, d2], coarse, cdims: [QX, QY, QZ], CPU, volumes, walkers, water, looks, falls, beams, lights, stats, bounds, frame: F, tiles,
      geo: jar ? { C, RI, RG, DRUM, PL_R, PL_ZB, PL_ZT, glassZt: F.glassTop } : null };
    ME.coarseFill(T, [0, 0, 0], [QX - 1, QY - 1, NZ / f - 1]); // the cells above the voxel grid stay empty
    T.groundAt = ME.groundAt(T);
    return T;
  };
  // the code the bake runs besides bakeTerrain itself (the bake cache key holds its source)
  // the bake cache key's code: the bake's helpers and its tables (cache.js)
  ME.bakeTerrain.parts = [ME.validateMap, ME.waterDist, gridOf, propsOf, decoSets, propRole, resolve, mottleCut, pave, heights, kindNames, rows, impure, BrickGrid, ...Object.values(RECIPE),
    JSON.stringify({ B36, STEPS, RECIPES, FLAGS, AT, FIXED_BOX })];

  // The coarse occupancy (docs/decisions/2026-10-20-sun-volume-density.md): one cell is f voxels on a side,
  // f the largest divisor of VS that keeps VS / f >= 8 cells per tile, and at least 2 (f = 2 up to vs=20,
  // as before: the low densities phones pick keep their small volume; 3 at 24, 8 at 64).
  ME.coarseStep = (VS) => { let f = VS; while (VS % f || VS / f < 8) f--; return Math.max(2, f); };
  // Refill the coarse cells lo..hi (inclusive, cell coordinates) from T.grid: the occupancy averaged over
  // the cell's f^3 voxels (the bake fills the whole grid, a carve the box around the change), plus the
  // static volumes' splat (T.splat, from the model bake) so a carve keeps the trees' shade. Counted a brick
  // at a time over the box's voxels: a uniform solid brick adds its overlap with each cell it touches, a
  // mixed one cell by cell.
  ME.coarseFill = (T, lo, hi) => {
    const { grid: g, NZ, coarse, cdims, splat } = T, f = T.VS / T.CPU, n = f * f * f, W = hi[0] - lo[0] + 1, H = hi[1] - lo[1] + 1, D = hi[2] - lo[2] + 1;
    const a0 = lo[0] * f, a1 = lo[1] * f, a2 = lo[2] * f, b0 = (hi[0] + 1) * f, b1 = (hi[1] + 1) * f, b2 = Math.min(NZ, (hi[2] + 1) * f);
    const cnt = new Uint32Array(W * H * D), P = g.pool, Tb = g.table;
    // a voxel's cell along an axis, counted from the box's first voxel
    const q = (m) => Uint32Array.from({ length: m * f }, (_, i) => Math.floor(i / f)), qx = q(W), qy = q(H), qz = q(D);
    if (b2 > a2) for (let K = a2 >> 4; K <= (b2 - 1) >> 4; K++) for (let J = a1 >> 4; J <= (b1 - 1) >> 4; J++) for (let I = a0 >> 4; I <= (b0 - 1) >> 4; I++) {
      const e = Tb[(K * g.BY + J) * g.BX + I];
      if (e === 0) continue;
      const i0 = Math.max(a0, I << 4), i1 = Math.min(b0, (I << 4) + 16), j0 = Math.max(a1, J << 4), j1 = Math.min(b1, (J << 4) + 16), k0 = Math.max(a2, K << 4), k1 = Math.min(b2, (K << 4) + 16);
      if (e < 256) {
        for (let k = k0; k < k1; ) {
          const z = qz[k - a2], ke = Math.min(k1, a2 + (z + 1) * f);
          for (let j = j0; j < j1; ) {
            const y = qy[j - a1], je = Math.min(j1, a1 + (y + 1) * f), r = (z * H + y) * W, nk = (ke - k) * (je - j);
            for (let i = i0; i < i1; ) { const x = qx[i - a0], ie = Math.min(i1, a0 + (x + 1) * f); cnt[r + x] += nk * (ie - i); i = ie; }
            j = je;
          }
          k = ke;
        }
        continue;
      }
      const s = (e - 256) * 4096 - (I << 4);
      for (let k = k0; k < k1; k++) {
        const z = qz[k - a2] * H;
        for (let j = j0; j < j1; j++) {
          const r = (z + qy[j - a1]) * W, o = s + ((k & 15) << 8) + ((j & 15) << 4);
          for (let i = i0; i < i1; i++) if (P[o + i]) cnt[r + qx[i - a0]]++;
        }
      }
    }
    for (let z = 0, t = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++, t++) {
      const c = ((lo[2] + z) * cdims[1] + lo[1] + y) * cdims[0] + lo[0] + x, s = cnt[t] * 255;
      coarse[c] = splat ? Math.min(255, Math.floor(s / n) + splat[c]) : Math.floor(s / n);
    }
  };

  // Walkable ground: first solid voxel scanning down from zFrom (rebuilt from the arrays on a cache hit, which
  // is also where T gets the T.vox guard back: ME.voxGone).
  ME.groundAt = (T) => {
    const { O, NX, NY, NZ, VS, grid } = T;
    if (!Object.getOwnPropertyDescriptor(T, "vox")) ME.voxGone(T);
    return (X, Y, zFrom) => {
      const i = Math.floor((X - O[0]) * VS), j = Math.floor((Y - O[1]) * VS);
      if (i < 0 || j < 0 || i >= NX || j >= NY) return zFrom;
      const k = Math.floor((zFrom - O[2]) * VS);
      if (k < 0) return O[2];
      const g = grid.down(i, j, Math.min(NZ - 1, k));
      return g < 0 ? O[2] : O[2] + (g + 1) / VS;
    };
  };
})();
