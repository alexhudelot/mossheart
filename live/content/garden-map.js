/* Momiji's generator maps as v1 engine maps (docs/decisions/2026-10-21-map-format.md, section 3; the
   reference is MapV1.fromGarden in docs/decisions/2026-10-21-map-format.js). The engine stops reading
   map.geo, map.waterD, the map.typ letters and map.path; this adapter turns a generator style into the
   plain-data map the engine reads instead.
     ME.content.mapFromGarden(st)   -> a v1 map (garden() styles: a jar frame; parseMap styles: a box)
     ME.content.gardenWater         -> the water shapes of the garden styles, by style id
     ME.content.checkGardenMap(st)  -> { id, errors, warnings, props, bytes, water: { samples, differ } }
   garden() (vendor/gen/styles4.js) keeps its water shapes in a closure, so the lists below are a copy of
   the ones in styles4.js and styles5.js. Only the outline is kept: the generator's carve and h have
   already shaped the heights. checkGardenMap compares their distance with the closure's at every 1/32
   tile, so a generator update that moves a shape fails the demo self-test. */
(function () {
  const ME = window.ME, C = (ME.content = ME.content || {});
  const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

  C.gardenWater = {
    "mf-valley": [{ seg: [9.6, 8.2, 9.6, 17.8], r: 0.6 }, { seg: [10.5, 21.2, 10.5, 24.0], r: 0.42 }, { ellipse: [10.4, 19.6, 3.2, 2.0] }],
    "mf-falls": [{ seg: [3.6, 2.6, 3.6, 7.0], r: 0.66 }, { seg: [3.8, 7.4, 6.4, 7.4], r: 0.5 }, { seg: [6.4, 7.4, 6.4, 10.4], r: 0.5 }, { ellipse: [3.9, 7.5, 1.3, 0.95] }, { ellipse: [7.6, 11.5, 2.2, 1.5] }],
  };
  // the older jars of vendor/gen/styles4.js (Koke-dera's pond is shared by three of them)
  const KOKE = [{ ellipse: [4.0, 10.2, 2.4, 1.9] }], RAV = [[11.8, 1.2], [8.6, 5.4], [6.4, 7.6], [3.4, 11.0]];
  Object.assign(C.gardenWater, {
    "jar-koke": KOKE, "jar-kodama": KOKE, "jar-momiji": KOKE,
    "mom-terrace": [{ ellipse: [3.8, 10.6, 2.3, 1.7] }, { seg: [5.3, 6.1, 4.3, 9.4], r: 0.34 }],
    "mom-ravine": RAV.slice(1).map(([x1, y1], i) => ({ seg: [RAV[i][0], RAV[i][1], x1, y1], r: 0.5 })).concat([{ ellipse: [3.2, 11.2, 1.7, 1.3] }]),
    "mom-hill": [{ ellipse: [3.6, 11.0, 2.2, 1.6] }, { seg: [6.2, 6.9, 4.2, 10.0], r: 0.34 }],
  });

  // garden() letters -> the Momiji kinds (content/momiji.js). "t" is a lane without gravel, which the
  // terrain baker bakes as "u"; "v" is a ford (water the route crosses: the route is in game.route);
  // "s" is #26's sand bank. Karesansui's raked gravel "g" gets a style kind, as below.
  const GARDEN_KIND = { m: "moss", u: "lane", t: "lane", w: "water", v: "water", s: "sandbank", _: null };

  // The older parseMap styles (square dioramas, each with its own letters) keep "m" as Momiji moss and
  // get one kind for each other letter (as does a garden letter with no Momiji kind), named
  // "<style id>-<letter>", from the style's terrain entry: water for its water tex, a layer of its top
  // over its side material for the rest. These only make the map complete and valid; how close they
  // come to the generator's look is M1–M4's business.
  const styleKind = (st, ch) => {
    const tr = (st.terrain && st.terrain[ch]) || {}, under = tr.side || "earth";
    if (tr.tex === "water") return { recipe: "water", bed: [tr.pebble || "stone"], shore: tr.pebble || "stone", under };
    const k = { recipe: "layer", top: tr.top || "moss", depth: 0.25, under };
    if (typeof tr.drip === "string") k.drape = tr.drip;
    if (k.top === "moss") k.grass = true;
    return k;
  };

  // the water shapes as one signed distance (+ inside, in tiles), with garden()'s formulas
  const waterDist = (shapes) => {
    if (!shapes || !shapes.length) return null;
    const ds = shapes.map((w) => {
      if (w.ellipse) { const [ex, ey, rx, ry] = w.ellipse; return (x, y) => (1 - Math.hypot((x - ex) / rx, (y - ey) / ry)) * Math.min(rx, ry); }
      const [x0, y0, x1, y1] = w.seg, r = w.r;
      return (x, y) => { const vx = x1 - x0, vy = y1 - y0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy))); return r - Math.hypot(x - x0 - vx * k, y - y0 - vy * k); };
    });
    return (x, y) => Math.max(...ds.map((d) => d(x, y)));
  };

  C.mapFromGarden = (st) => {
    const m = st.map, garden = !!m.geo, rowsOf = (r) => (typeof r === "string" ? [...r] : r);
    const typ = m.typ.map(rowsOf);
    // the legend: one character per letter used
    const legend = {}, kinds = (C.kinds = C.kinds || {});
    for (const r of typ) for (const ch of r) {
      if (ch in legend) continue;
      if (ch === "_") legend[ch] = null;
      else if (ch === "m" || (garden && ch in GARDEN_KIND)) legend[ch] = GARDEN_KIND[ch];
      else {
        const name = st.id + "-" + ch;
        if (!kinds[name]) kinds[name] = styleKind(st, ch);
        legend[ch] = name;
      }
    }
    if (garden && m.waterD && !C.gardenWater[st.id]) throw new Error("mapFromGarden: no water shapes for " + st.id + " (add them to ME.content.gardenWater)");
    // heights in half steps when they are whole, quarter steps when there are half steps
    const whole = m.hgt.every((r) => r.every(Number.isInteger)), hStep = whole ? 0.5 : 0.25, k = whole ? 1 : 2;
    const props = [];
    for (const d of st.deco || []) {
      if (!d) continue;
      const [name, o, x, y, ex] = d, p = [name, o === undefined ? null : o, x, y];
      if (ex && Object.keys(ex).length) p.push(ex);
      props.push(p);
    }
    const map = {
      v: 1, id: st.id, W: m.W, H: m.H, hStep,
      h: m.hgt.map((r) => (r.every((v) => v * k >= 0 && v * k < 36) ? r.map((v) => B36[v * k]).join("") : r.map((v) => v * k))),
      kind: typ.map((r) => r.join("")),
      legend, floor: m.floor * k,
      water: (garden && C.gardenWater[st.id]) || [],
      props,
    };
    if (garden) {
      // the island: a circle clip round the centre, the drum, its strata and the glass; and today's
      // fixed bake box, written out so a later default can't move Momiji's bytes
      const { C: c, RI } = m.geo;
      map.frame = { type: "jar", c: [c, c], r: RI, foot: (st.clip && st.clip.foot) ?? 0.92, glassTop: st.glassZt ?? 3.4, strata: st.strata || [], ...(st.spill ? { spill: true } : {}) };
      map.box = { o: [-1, -1, -2.5], size: [26, 26, 10] };
    } else map.frame = { type: "box" }; // a square block, cut square at the edges (M2)
    map.game = { route: m.path || [] };
    return map;
  };

  // The adapter's check, for the demo self-test: the map validates (once the engine has ME.validateMap,
  // M1) and survives JSON, and its water shapes give the generator's distance exactly
  C.checkGardenMap = (st) => {
    const map = C.mapFromGarden(st), json = JSON.stringify(map), back = JSON.parse(json);
    const val = ME.validateMap ? ME.validateMap(back, C.kinds) : { errors: [], warnings: ["ME.validateMap not built yet (M1)"] };
    const water = { samples: 0, differ: 0 };
    if (st.map.waterD) {
      const wd = waterDist(back.water);
      for (let y = -1; y <= st.map.H + 1; y += 1 / 32) for (let x = -1; x <= st.map.W + 1; x += 1 / 32) { water.samples++; if (wd(x, y) !== st.map.waterD(x, y)) water.differ++; }
    }
    return { id: st.id, errors: val.errors, warnings: val.warnings, props: back.props.length, bytes: json.length, same: JSON.stringify(back) === json, water };
  };
})();
