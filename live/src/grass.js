/* Grass bake: tufts of voxel blades on the moss carpet, drawn by the grass pass and bent by the wind.
   Thicker along lane edges, cliff feet and banks; reeds (taller, darker) where moss meets water.
   One vec4 per blade: x, y, z (ground), w = material << 8 | height in voxels << 4 | seed. */
(function () {
  const ME = window.ME, P = window.PX;

  // a map's blades: ME.content.mapGrass[its id] when its pack gives one (Corn Moon's gold, tan and rust), else
  // ME.content.grass, whole (no merge: a map's set names all its materials). The terrain key hashes this
  // (cache.js), so a map's own set rebakes that map only
  ME.grassFor = function (st) {
    const C = ME.content || {}, id = st && (st.map && st.map.id !== undefined ? st.map.id : st.id);
    return (C.mapGrass && id !== undefined && C.mapGrass[id]) || C.grass;
  };

  ME.bakeGrass = function (T, st, pal) {
    const t0 = ME.now(), VS = T.VS, { NX, NY, O, grid, top } = T, PLANE = NX * NY, H = P.hash, TL = T.tiles;
    // grass grows on the tiles whose kind asks for it (grass: true), with the map's blades (grassFor above)
    const GR = ME.grassFor(st);
    if (!GR || !TL.grass.includes(1)) return { blades: new Float32Array([0, 0, -99, 0]), count: 0, ms: 0 };
    const KV = VS / 16; // blade sizes are tuned in voxels at 16 per tile: the same size in tiles at any density
    // but a blade is one voxel wide, so above 16 there are KV times the tufts a tile (the user: more grass at
    // higher resolution), the cap with them; tuft k keeps its place, so the tufts of 16 are all still there
    const FT = Math.max(1, KV), CAP = Math.round(9000 * FT);
    const on = (x, y) => x >= 0 && y >= 0 && x < TL.W && y < TL.H;
    const recipe = (x, y) => (on(x, y) ? TL.recipe[y * TL.W + x] : null);
    const hgt = (x, y) => (recipe(x, y) === null ? -Infinity : TL.z[y * TL.W + x]);
    // ground and blade materials from the content
    const ok = new Set((GR.ground || []).map((n) => pal.ids[n]).filter((i) => i !== undefined));
    const M = { grass: pal.id(GR.blade), grass2: pal.id(GR.blade2), reed: pal.id(GR.reed), dry: pal.id(GR.dry) };
    const geo = T.geo, out = [];
    for (let cy = 0; cy < TL.H; cy++) for (let cx = 0; cx < TL.W; cx++) {
      if (!TL.grass[cy * TL.W + cx] || (geo && Math.hypot(cx + 0.5 - geo.C, cy + 0.5 - geo.C) > geo.RI - 0.4)) continue;
      let lane = 0, water = 0, cliff = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = recipe(cx + dx, cy + dy);
        if (t === "lane") lane = 1;
        if (t === "water" || (t !== null && TL.wet && TL.wet[(cy + dy) * TL.W + cx + dx])) water = 1;
        if (hgt(cx + dx, cy + dy) > hgt(cx, cy)) cliff = 1;
      }
      const patch = P.fbm(cx * 0.35, cy * 0.35, 0, 77);
      const n = Math.round((2 + 3 * lane + 4 * water + 3 * cliff) * (0.45 + patch) * (H(cx, cy, 0, 71) > 0.2 ? 1 : 0.3) * FT);
      for (let k = 0; k < n; k++) {
        const r = (s) => H(cx * 31 + k, cy * 17 + s, 0, 73);
        // tufts lean towards the feature that feeds them
        const i0 = Math.floor((cx - O[0] + 0.1 + r(1) * 0.8) * VS), j0 = Math.floor((cy - O[1] + 0.1 + r(2) * 0.8) * VS);
        const reed = water && r(3) > 0.35, blades = reed ? 4 + Math.floor(r(4) * 4) : 3 + Math.floor(r(4) * 3);
        for (let b = 0; b < blades; b++) {
          const i = i0 + Math.round((H(i0, j0, b, 74) - 0.5) * 4 * KV), j = j0 + Math.round((H(i0, j0, b, 75) - 0.5) * 4 * KV);
          if (i < 1 || j < 1 || i >= NX - 1 || j >= NY - 1) continue;
          const col = j * NX + i, kt = top[col];
          if (kt < 1 || !ok.has(grid.at((kt - 1) * PLANE + col)) || grid.at(kt * PLANE + col)) continue;
          const hv = Math.max(1, Math.round(KV * (reed ? 6 + Math.floor(H(i, j, b, 76) * 7) : 2 + Math.floor(H(i, j, b, 76) * 4) + (cliff ? 1 : 0))));
          const mat = reed ? M.reed : H(i, j, b, 77) > 0.82 ? M.dry : H(i, j, b, 78) > 0.5 ? M.grass : M.grass2;
          out.push(O[0] + (i + 0.5) / VS, O[1] + (j + 0.5) / VS, O[2] + kt / VS, (mat << 8) | (Math.min(15, hv) << 4) | Math.floor(H(i, j, b, 79) * 16));
          if (out.length >= CAP * 4) break;
        }
      }
    }
    const blades = new Float32Array(out.length ? out : [0, 0, -99, 0]);
    return { blades, count: out.length / 4, ms: Math.round(ME.now() - t0) };
  };
})();
