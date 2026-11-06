/* Round six: Momiji with real height. Terraces a full cube tall with mossy rock cliffs, waterfalls
   stepping down them into the pond, and a large map with a whole tower-defence path: stone stairs
   up each terrace, a red bridge over the river, towers along the way. */
(function () {
  const P = window.PX, { garden, jar, CANOPY, DRAPED, ledges, warp, MAPLE, forest, TRUNKS } = P.r4;

  // Cliffs: the Momiji moss lip, then mossy rock. The path is a pale gravel lane with stepping stones.
  const CLIFF = {};
  for (const k in DRAPED) CLIFF[k] = Object.assign({}, DRAPED[k], { sideTex: "cliff", rock: "rock", drapeD: 0.12, drapeK: 0.18 });
  const RAMPS = {
    maple: ["#d4482a", 8, 0.12, 0.78, 0.3], moss: ["#4a8a30", 9, 0.1, 0.86, 0.32, 1.05],
    sky: ["#040403", "#0b0a05", "#151309", "#201c0d", "#2c2612", "#3c3418", "#4e4222", "#645432"],
    rock: ["#6f675a", 9, 0.08, 0.8, 0.22], gravel: ["#b9b1a0", 8, 0.3, 0.92, 0.12, 0.5], fall: ["#8ccac2", 10, 0.2, 0.99, 0.12], lacq: ["#c43a22", 8, 0.12, 0.74, 0.25],
  };

  // Path cells in walking order, from polylines of cell corners.
  const cellsOf = (pts) => {
    const out = [pts[0].slice()];
    for (let k = 0; k + 1 < pts.length; k++) {
      let [x, y] = pts[k]; const [x1, y1] = pts[k + 1];
      while (x !== x1 || y !== y1) { if (x !== x1) x += Math.sign(x1 - x); else y += Math.sign(y1 - y); out.push([x, y]); }
    }
    return out;
  };
  // Walk the path: stone stairs on the lower tile wherever it climbs, an arched bridge wherever it
  // crosses water (from the bank tile before to the bank tile after).
  const trail = (map) => {
    const deco = [], isW = (x, y) => map.typ[y][x] === "w";
    for (const cs of map.path.map(cellsOf)) {
      for (let i = 0; i + 1 < cs.length; i++) {
        const [x, y] = cs[i], [x1, y1] = cs[i + 1];
        if (isW(x, y) || isW(x1, y1)) continue;
        const d = map.hgt[y1][x1] - map.hgt[y][x]; if (!d) continue;
        const [lx, ly, hx, hy] = d > 0 ? [x, y, x1, y1] : [x1, y1, x, y];
        deco.push(["stairs", { H: Math.abs(d) * 0.5, dir: (hx - lx + hy - ly > 0 ? "+" : "-") + (hx !== lx ? "x" : "y") }, lx, ly]);
      }
      for (let i = 1; i < cs.length; i++) {
        if (!isW(...cs[i]) || isW(...cs[i - 1])) continue;
        let j = i; while (j < cs.length && isW(...cs[j])) j++;
        if (j >= cs.length) break;
        const [ax, ay] = cs[i - 1], [bx, by] = cs[j], [wx, wy] = cs[i], L = Math.hypot(bx - ax, by - ay) + 0.1;
        deco.push(["bridge", { L, rise: 0.2 + 0.05 * L }, wx, wy, { dx: (ax + bx) / 2 - wx, dy: (ay + by) / 2 - wy, dz: (map.hgt[ay][ax] - map.hgt[wy][wx]) * 0.5 + 0.14, flip: ay !== by, overWater: true }]);
        i = j;
      }
    }
    return deco;
  };

  const falls = (o) => {
    const path = o.map.path.flatMap(cellsOf).map(([x, y]) => ["", {}, x, y]), deco = o.deco.concat(trail(o.map));
    const dress = ledges(o.map, { seed: o.seed, skip: deco.concat(path), cushions: o.cushions ?? 0.18, ferns: o.ferns ?? 0.34, rocks: o.rocks ?? 0.1 });
    return jar(Object.assign({
      L: [-0.45, 0.36, 0.82], terrain: CLIFF, bevel: 0.16, aoW: 0.34, aoK: 0.36, glassZt: 3.4, ramps: RAMPS,
      bg: forest({ lo: 0.05, k: 0.5, trunks: TRUNKS, bokeh: [[0.12, 0.1, 0.03, 0.16], [0.24, 0.05, 0.02, 0.14], [0.62, 0.06, 0.035, 0.1], [0.9, 0.14, 0.025, 0.16], [0.77, 0.03, 0.018, 0.12]] }),
      hd: { bloom: 0.85, threshold: 0.84, radius: 6, haze: 0.06, fog: [40, 32, 18], vignette: 0.5, beamK: 0.66, beamW: 1.1, beamCol: [255, 212, 146], motes: 0 },
    }, o, { deco: deco.concat(dress), light: CANOPY({ shade: 0.44, pool: 0.5, beams: o.beams }) }));
  };

  // F1 — Falls: an amphitheatre of terraces rising to a high plateau at the back. The river leaves the
  // plateau in one tall fall (two cubes) into a plunge pool, then steps down twice more to the pond;
  // the path climbs from the right by three flights of stairs.
  const AMPH = (x, y) => Math.hypot(x - 2.4, y - 2.4) + warp(x, y, 1.6);
  const FALLS = garden({
    height: (x, y) => { const d = AMPH(x, y); return 2 + 2 * (d < 10.8) + 2 * (d < 7.6) + 4 * (d < 4.4); },
    water: [{ seg: [3.6, 2.6, 3.6, 7.0], r: 0.66, carve: true }, { seg: [3.8, 7.4, 6.4, 7.4], r: 0.5, carve: true }, { seg: [6.4, 7.4, 6.4, 10.4], r: 0.5, carve: true },
      { e: { x: 3.9, y: 7.5, rx: 1.3, ry: 0.95 }, h: 6 }, { e: { x: 7.6, y: 11.5, rx: 2.2, ry: 1.5 }, h: 2 }], // pools last: their level wins // the pond last: its level wins
    paths: [[[13, 6], [10, 6], [10, 4], [7, 4], [7, 2], [5, 2]]], lane: "u",
  });
  falls({
    id: "mf-falls", name: "Momiji Falls", jp: "紅葉の滝", map: FALLS, seed: 43, dumpMap: true,
    deco: [MAPLE({ x: 1, y: 5 }), ["lantern", { t: 0.2 }, 10, 12], ["basin", { sz: 1.0 }, 5, 3],
      ["hotaru", { t: 0.1 }, 11, 5], ["puffcap", { t: 0.4 }, 9, 3], ["sprout", { t: 0.6 }, 8, 5], ["piglet", { t: 0.2 }, 12, 6], ["pillbug", { t: 0.5 }, 10, 5],
      ["mound", { seed: 1, sz: 1.5 }, 1, 8], ["mound", { seed: 2, sz: 1.3 }, 11, 9], ["mound", { seed: 5, sz: 1.2 }, 4, 12], ["niwaki", { seed: 6, H: 1.6, girth: 0.75, spread: 0.6, padR: 0.44, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 2, 10],
      ["fern", { seed: 3, sz: 1.2 }, 8, 8], ["fern", { seed: 4, sz: 1.1 }, 12, 10]],
    beams: [{ x: 4.2, y: 7.6, r: 1.15, len: 18 }, { x: 7.8, y: 11.6, r: 1.1, k: 0.95, len: 18 }, { x: 10.4, y: 6.2, r: 1.0, k: 0.85, len: 18 }],
  });

  // L1 — Valley: a 24-tile island. A summit with the Heart Tree at the back, five levels of terraces
  // around it, a river falling level by level into a lake at the front, and a full enemy route.
  const VAL = (x, y) => Math.hypot(x - 8, y - 7.5) + warp(x, y, 2.0);
  const VALLEY = garden({
    N: 24,
    // W6: the lake spills south through a one-tile gorge, ledge by ledge (z 0, then -0.5 on the rim), and
    // off the island's edge down the drum (the engine's rim spill); W6 flow: the gorge stream fills most of its tile (r 0.42)
    height: (x, y) => { if (Math.abs(x - 10.5) < 0.5 && y > 22) return y > 23 ? -1 : 0; const d = VAL(x, y); return 2 + 2 * (d < 10.4) + 2 * (d < 7.9) + 2 * (d < 5.4) + 2 * (d < 2.9); },
    water: [{ seg: [9.6, 8.2, 9.6, 17.8], r: 0.6, carve: true }, { seg: [10.5, 21.2, 10.5, 24.0], r: 0.42, carve: true }, { e: { x: 10.4, y: 19.6, rx: 3.2, ry: 2.0 }, h: 2 }],
    // enemies enter through the torii on the right, snake through the lowland, climb onto the first
    // terrace, cross the river on the red bridge, then switch back up three more terraces to the summit
    paths: [[[23, 8], [21, 8], [21, 4], [19, 4], [19, 12], [22, 12], [22, 16], [13, 16], [4, 16], [4, 14], [7, 14], [7, 12], [5, 12], [5, 10], [6, 10], [6, 7]]], lane: "u",
  });
  falls({
    id: "mf-valley", name: "Momiji Valley", jp: "紅葉の谷間", map: VALLEY, seed: 47, tw: 60, dumpMap: true, spill: true,
    deco: [MAPLE({ x: 7, y: 5, t: { H: 3.4 } }), ["lantern", { t: 0.2 }, 5, 7], ["torii", {}, 22, 8],
      // towers on the build spots beside the route, enemies on it
      ["hotaru", { t: 0.1 }, 20, 6], ["puffcap", { t: 0.4 }, 20, 10], ["sprout", { t: 0.6 }, 17, 14], ["hotaru", { t: 0.5 }, 14, 18], ["puffcap", { t: 0.2 }, 5, 15], ["sprout", { t: 0.3 }, 6, 13], ["hotaru", { t: 0.7 }, 4, 11],
      ["piglet", { t: 0.2 }, 21, 6], ["pillbug", { t: 0.5 }, 19, 10], ["piglet", { t: 0.6 }, 16, 16], ["pillbug", { t: 0.1 }, 6, 14],
      // garden: small maples, moss mounds, ferns
      ["niwaki", { seed: 6, H: 1.7, girth: 0.8, spread: 0.6, padR: 0.45, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 14, 5], ["niwaki", { seed: 7, H: 1.5, girth: 0.7, spread: 0.55, padR: 0.42, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 2, 10],
      ["niwaki", { seed: 8, H: 1.6, girth: 0.75, spread: 0.6, padR: 0.44, n: 5, flat: 0.24, mat: "maple", bumps: 3 }, 16, 21], ["niwaki", { seed: 9, H: 2.0, girth: 0.9, spread: 0.7, padR: 0.5, n: 6, flat: 0.26 }, 12, 3],
      ["mound", { seed: 1, sz: 1.6 }, 3, 19], ["mound", { seed: 2, sz: 1.4 }, 16, 9], ["mound", { seed: 6, sz: 1.3 }, 13, 10], ["mound", { seed: 4, sz: 1.3 }, 3, 6],
      ["fern", { seed: 3, sz: 1.2 }, 17, 6], ["fern", { seed: 4, sz: 1.1 }, 20, 18], ["rock", { sz: 1.1 }, 12, 20]],
    beams: [{ x: 9.6, y: 16.4, r: 1.3, len: 24 }, { x: 10.4, y: 19.8, r: 1.2, k: 0.95, len: 24 }, { x: 9.4, y: 9.2, r: 1.0, k: 0.9, len: 24 }, { x: 20.0, y: 8.0, r: 1.3, k: 0.9, len: 24 }, { x: 5.6, y: 13.0, r: 0.9, k: 0.85, len: 24 }],
  });
})();
