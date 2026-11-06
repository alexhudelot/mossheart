/* Mossheart asset set (the user's pick from the mockups): Koke Garden Heart Tree, Sunpetal and Puffcap,
   the Shrine Craft Thornbloom lantern, the Hotaru Spirit Willow Wisp and blighted enemies.
     towers   ms_thorn ms_sun ms_puff ms_wisp, ms_briar ms_toad ms_moon ms_lily   o.lv 1..3 (upgrade level), 4-frame idle over o.t
     base     ms_heart                               o.hurt 0..2 (healthy, wounded, critical), 4-frame idle
     enemies  ms_grub ms_beetle ms_moth ms_golem ms_spirit (boss), and the mould creatures ms_snail ms_bloat
              ms_mite ms_mender ms_midge ms_mole ms_lichen ms_mother (second boss), and the blight creatures
              of the bestiary: ms_crow   4-frame walk / fly cycles
     props    ms_rift (blight spawn) ms_glowcap ms_lamp ms_stone ms_kodama
   Showrooms: ?gallery=set-towers | set-towers2 | set-heart | set-enemies | set-enemies2 | set-bestiary | set-world (a mini level: enemies walk the path,
   add &units=10; &set=cycle:60 loops day and dusk). Built on assets/asset-kit.js. */
(function () {
  const ME = window.ME, { S, E, C, B, Y, TAU, add, mul, lerp3, norm, cross, rx, rz, orient, near, nz3, cface, mossPad, stoneMoss, larva, lantern, kodamaFace, model } = ME.assetKit;
  const lv = (o) => Math.max(1, Math.min(3, o.lv || 2)), ph = (o) => (o.t || 0) * TAU;
  const ring = (n, f) => { for (let i = 0; i < n; i++) f((i / n) * TAU, i); };
  // kodama whose head tilts by (dx, dy): the rattle of the idle loop
  const kodamaT = (c, s, p, dx = 0, dy = 0) => {
    p.push(E(add(c, [0, 0, 0.06 * s]), [0.045 * s, 0.045 * s, 0.065 * s], "hsKodama", { k2: 0.02 }));
    const h = add(c, [dx * s, dy * s, 0.16 * s]);
    p.push(S(h, 0.07 * s, "hsKodama", { k2: 0.02 }));
    return h;
  };

  // ================================================================ towers
  // Thornbloom: a stone tōrō overgrown by a thorny rose vine (Shrine Craft). Level 3 grows a gold finial
  // and green thorn-seeds orbiting the roof; sparks rise from the flame on every level.
  model("ms_thorn", 1.9, (o) => {
    const L = lv(o), w = ph(o), s = [0.82, 1, 1.14][L - 1], p = lantern("scLitGreen", s), top = 0.9 * s;
    const n = [12, 22, 30][L - 1], h = [0.5, 0.84, 1.0][L - 1], th = [0.018, 0.024, 0.03][L - 1];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * TAU * (1.4 + 0.35 * L) + 0.6, r = (t < 0.6 ? 0.1 : t < 0.75 ? 0.2 : 0.15) * s + 0.03 * Math.sin(i * 1.7), q = [Math.cos(a) * r, Math.sin(a) * r, 0.06 + t * h];
      if (prev) p.push(C(prev, q, th + 0.002, th, "kgStem", { k2: 0.01 }));
      if (i % 2) p.push(C(q, add(q, mul(norm([Math.cos(a + 0.6), Math.sin(a + 0.6), 0.5]), 0.05 + 0.01 * L)), 0.012, 0.001, "kgThorn"));
      const bloom = L === 1 ? i === n - 2 : i % (L === 3 ? 4 : 5) === 3;
      if (bloom) p.push(E(add(q, [Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0.005 * Math.sin(w + i)]), L === 1 ? [0.022, 0.022, 0.03] : [0.035, 0.035, 0.04], "scRose", { k2: 0.01 }));
      prev = q;
    }
    if (L === 3) {
      p.push(S([0, 0, top + 0.05], 0.045, "scGold"), Y([0, 0, top - 0.02], 0.06, 0.012, "scGold"));
      ring(3, (a) => { const b = a + w / 3, c = [Math.cos(b) * 0.36, Math.sin(b) * 0.36, 0.78 + 0.04 * Math.sin(w + a * 2)], d = [-Math.sin(b), Math.cos(b), 0.2]; p.push(C(c, add(c, mul(norm(d), 0.08)), 0.02, 0.002, "scLitGreen")); });
    }
    // sparks rising from the windows, one per level, looping with the flipbook
    for (let k = 0; k < L; k++) { const f = ((o.t || 0) + k / L) % 1, a = k * 2.1; p.push(S([0.16 * s + Math.cos(a) * 0.04, 0.05 * Math.sin(a), 0.62 * s + f * 0.35], 0.016 * (1 - f * 0.6), "scLitGreen")); }
    const sm = stoneMoss("scStone", 10, 0.55);
    return { prims: p, r: 0.36, h: top + 0.15, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || m };
  }, 4);

  // Sunpetal Lens: a sunflower turned to the sky with a glass lens for a centre (Koke Garden). The head
  // tracks a slow circle; level 3 has a double petal ring, brass spokes and two buds.
  model("ms_sun", 1.9, (o) => {
    const L = lv(o), w = ph(o), hz = [0.58, 0.84, 1.0][L - 1], hr = [0.15, 0.21, 0.25][L - 1];
    const n = norm([0.55 + 0.07 * Math.sin(w), 0.55 + 0.07 * Math.cos(w), 0.62]), R = orient(n), u = R.slice(0, 3), v = R.slice(3, 6);
    const hc = [0.05 + 0.02 * Math.sin(w), 0.05 + 0.02 * Math.cos(w), hz];
    const p = [mossPad(0.24 + 0.03 * L), C([0, 0, 0], [0.01, 0.01, hz * 0.55], 0.03 + 0.006 * L, 0.026 + 0.005 * L, "kgStem", { k2: 0.02 }), C([0.01, 0.01, hz * 0.55], add(hc, mul(n, -0.06)), 0.026 + 0.005 * L, 0.022 + 0.004 * L, "kgStem", { k2: 0.02 })];
    const leaves = [[2.2, 0.22, 0.17], [-0.6, 0.36, 0.15], [3.6, 0.5, 0.12], [1.0, 0.62, 0.11]].slice(0, L + 1);
    for (const [a, z, Lf] of leaves) { const d = [Math.cos(a), Math.sin(a), 0.25 + 0.05 * Math.sin(w + a)]; p.push(E(add([0, 0, z * hz / 0.84], mul(norm(d), Lf)), [Lf, Lf * 0.42, 0.012], "kgLeaf", { R: orient([0, 0, 1], d) })); }
    const petals = (c, rr, np, sz) => {
      for (let i = 0; i < np; i++) {
        const a = (i / np) * TAU + 0.04 * Math.sin(w * 2 + i), d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
        p.push(E(add(c, mul(d, rr)), [0.1 * sz, 0.042 * sz, 0.014], "kgPetal", { R: orient(n, d) }));
        const a2 = a + Math.PI / np, d2 = add(mul(u, Math.cos(a2)), mul(v, Math.sin(a2)));
        p.push(E(add(add(c, mul(n, -0.022)), mul(d2, rr * 0.9)), [0.09 * sz, 0.04 * sz, 0.012], "kgPetalDk", { R: orient(n, d2) }));
      }
    };
    petals(hc, hr, [10, 14, 14][L - 1], hr / 0.21);
    if (L === 3) petals(add(hc, mul(n, -0.03)), hr * 1.32, 18, 1.15);
    if (L > 1) p.push(Y(hc, hr * 0.66, 0.032, "kgBrass", { R }));
    p.push(Y(add(hc, mul(n, 0.014)), hr * 0.55, 0.03, "kgLens", { R }));
    if (L === 3) {
      ring(4, (a) => { const d = add(mul(u, Math.cos(a + 0.4)), mul(v, Math.sin(a + 0.4))); p.push(C(add(hc, mul(d, hr * 0.62)), add(add(hc, mul(d, hr * 0.95)), mul(n, 0.03)), 0.014, 0.008, "kgBrass")); });
      for (const sd of [-1, 1]) {
        const b0 = [0.01, 0.01, hz * 0.45], b1 = [sd * 0.1 - 0.06, -sd * 0.1 - 0.06, hz * 0.62];
        p.push(C(b0, b1, 0.016, 0.012, "kgStem"), S(b1, 0.045, "kgPetalDk", { k2: 0.01 }), S(add(b1, [0.01, 0.01, 0.02]), 0.03, "kgStem"));
      }
    }
    return { prims: p, r: 0.3 + 0.04 * L, h: hz + 0.28, k: 1 };
  }, 4);

  // Puffcap: a spotted lilac mushroom with a face on the stalk (Koke Garden). It breathes; spores rise and
  // fade over the loop (the breath on cos, so the game's two frames, t 0 and 0.5, hold it). Level 3 is
  // broad with a ring of four little caps.
  model("ms_puff", 1.9, (o) => {
    const L = lv(o), w = ph(o), br = 1 + 0.05 * Math.cos(w), cr = [0.24, 0.34, 0.42][L - 1], cz = [0.36, 0.5, 0.6][L - 1], sr = [0.1, 0.14, 0.17][L - 1];
    const hc = [0, 0, cz * 0.36];
    const p = [mossPad(cr * 0.95), E([0, 0, cz * 0.4], [sr, sr, cz * 0.4], "kgStalk", { k2: 0.04 }), E([0, 0, cz], [cr * (2 - br), cr * (2 - br), cr * 0.5 * br], "kgCap", { k2: 0.04 }), E([0, 0, cz - cr * 0.24], [cr * 0.88, cr * 0.88, 0.05], "kgGill")];
    const minis = L === 1 ? [] : L === 2 ? [[-0.24, 0.2, 1], [0.22, -0.24, 0.75]] : [[-0.32, 0.22, 1.1], [0.26, -0.32, 0.9], [-0.18, -0.34, 0.75], [0.34, 0.16, 0.8]];
    for (const [x, y, sc] of minis) p.push(E([x, y, 0.06 * sc], [0.04 * sc, 0.04 * sc, 0.07 * sc], "kgStalk"), E([x, y, 0.13 * sc], [0.09 * sc, 0.09 * sc, 0.05 * sc * br], "kgCap", { k2: 0.01 }));
    for (let i = 0; i < L + 1; i++) { const f = ((o.t || 0) + i / (L + 1)) % 1, a = i * 2.4; p.push(S([Math.cos(a) * 0.1, Math.sin(a) * 0.1, cz + cr * 0.5 + 0.06 + f * 0.4], 0.04 * (1 - f * 0.55), "kgSpore")); }
    return {
      prims: p, r: cr + 0.1, h: cz + cr * 0.5 + 0.5, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgCap" && nz > 0.1 && nz3(x, y, z, 9, 8) > (L === 3 ? 0.62 : 0.66)) return "kgSpot";
        if (m === "kgStalk" && z < cz * 0.7 && Math.hypot(x, y) < sr + 0.05) return cface([x - hc[0], y - hc[1], z - hc[2]], sr, { ex: 0.4, ey: 0.02, er: 0.26, blush: true, mouth: [0, -0.42, 0.1] }) || m;
        return m;
      },
    };
  }, 4);

  // Willow Wisp: kodama on a mossy stump under a cyan spirit flame (Hotaru Spirit). The flame flickers and
  // the kodama rattle their heads, each once per loop on cos, so the game's two frames (t 0 and 0.5) hold
  // it; level 3 is a big stump with a sapling, four kodama and orbiting orbs.
  model("ms_wisp", 1.9, (o) => {
    const L = lv(o), w = ph(o), sr = [0.17, 0.24, 0.3][L - 1], sh = [0.1, 0.14, 0.17][L - 1];
    const p = [Y([0, 0, sh], sr, sh, "hsBarkDk", { round: 0.04 }), E([0, 0, sh * 2 + 0.01], [sr - 0.02, sr - 0.02, 0.03], "moss", { k2: 0.03 })];
    ring(L + 3, (a) => p.push(C([Math.cos(a + 0.4) * sr * 0.75, Math.sin(a + 0.4) * sr * 0.75, 0.1], [Math.cos(a + 0.4) * sr * 1.5, Math.sin(a + 0.4) * sr * 1.5, 0], 0.07 * sr / 0.24, 0.03, "hsBarkDk", { k2: 0.04 })));
    const top = sh * 2 + 0.02, spots = [[[0.02, 0.03, 1.0]], [[0.06, 0.08, 1.0], [-0.1, -0.06, 0.8], [0.14, -0.1, 0.7]], [[0.1, 0.1, 1.05], [-0.13, -0.04, 0.85], [0.16, -0.12, 0.75], [-0.04, 0.17, 0.7]]][L - 1];
    const heads = spots.map(([x, y, s], i) => kodamaT([x, y, top], s, p, Math.cos(w + i * 2.1) > 0.3 ? 0.012 : 0, Math.cos(w + i * 2.1) < -0.3 ? 0.012 : 0));
    if (L === 3) {
      p.push(C([-0.14, 0.02, top], [-0.18, 0.04, top + 0.42], 0.016, 0.01, "hsStem"));
      for (const [dz, a] of [[0.24, 0.6], [0.32, 2.6], [0.42, 4.4]]) p.push(E([-0.16 + Math.cos(a) * 0.05, 0.03 + Math.sin(a) * 0.05, top + dz], [0.055, 0.025, 0.01], "hsLeafLt", { R: rz(a) }));
    }
    const fz = top + [0.42, 0.52, 0.62][L - 1], fr = [0.05, 0.075, 0.09][L - 1], sway = [0.03 * Math.sin(w), 0.03 * Math.cos(w)];
    p.push(S([0, 0, fz], fr, "hsGlowCyan"), C([0, 0, fz], [sway[0], sway[1], fz + fr * (2.2 + 0.3 * Math.cos(w))], fr * 0.8, 0.004, "hsGlowCyan"));
    const orbs = L === 3 ? 3 : L - 1;
    ring(orbs, (a) => { const b = a + w; p.push(S([Math.cos(b) * 0.24, Math.sin(b) * 0.24, fz - 0.12 + 0.04 * Math.sin(b * 2)], 0.025, "hsGlowCyan")); });
    const kf = kodamaFace(heads, spots[0][2]);
    return { prims: p, r: sr * 1.5, h: fz + fr * 2.6, k: 1, detail: (x, y, z, m) => (m === "hsKodama" ? kf(x, y, z) || m : m) };
  }, 4);

  // ---------------------------------------------------------------- the second four plants
  // Briar Vine: a wild-rose briar on a root knot, red thorny canes arching out, their tips swaying, each
  // ending in a leaf tuft (Koke Garden). Level 2 grows rose hips and a runner that ends in a snare loop on
  // the ground (its snare); level 3 a second runner (its second patch) and a crown rose on a tall cane.
  model("ms_briar", 1.9, (o) => {
    const L = lv(o), w = ph(o), nv = L + 1, R0 = [0.26, 0.33, 0.38][L - 1], H0 = [0.4, 0.52, 0.6][L - 1];
    const p = [mossPad(0.24 + 0.03 * L), E([0, 0, 0.05], [0.11, 0.1, 0.07], "kgBark", { k2: 0.03 })];
    const thorn = (q, d, s = 1) => p.push(C(q, add(q, mul(norm(d), 0.05 * s)), 0.016 * s, 0.002, "kgThorn"));
    // a cane from the knot: an arch out along angle a, the tip swaying
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * TAU + 0.5, R = R0 * (i % 2 ? 0.85 : 1), H = H0 * (i % 2 ? 0.8 : 1), ca = Math.cos(a), sa = Math.sin(a), n = 6 + L;
      let prev = [ca * 0.04, sa * 0.04, 0.08];
      for (let j = 1; j <= n; j++) {
        const t = j / n, sw = 0.035 * Math.sin(w + i * 1.9) * t * t, q = [ca * (0.04 + R * t) - sa * sw, sa * (0.04 + R * t) + ca * sw, 0.08 + H * Math.sin(Math.PI * t * 0.85)];
        p.push(C(prev, q, 0.032 - 0.012 * t, 0.03 - 0.012 * t, "kgBriar", { k2: 0.008 }));
        if (j < n) thorn(q, [ca * 0.3 - sa * (j % 2 ? 1 : -1), sa * 0.3 + ca * (j % 2 ? 1 : -1), 0.7], 1 - 0.3 * t);
        if (L > 1 && j === n - 2) p.push(S(add(q, [-sa * 0.03, ca * 0.03, -0.035]), 0.032, "kgHip"));
        prev = q;
      }
      for (const [da, s] of [[0.9, 1], [-0.9, 0.85], [0, 0.75]]) p.push(E(add(prev, [Math.cos(a + da) * 0.035, Math.sin(a + da) * 0.035, 0.01]), [0.05 * s, 0.026 * s, 0.01], "kgLeaf", { R: rz(a + da) }));
    }
    // runners on the ground toward the viewer's side, each ending in a snare loop
    const runners = L === 1 ? [] : L === 2 ? [0.6] : [0.6, -1.0];
    for (const a of runners) {
      const ca = Math.cos(a), sa = Math.sin(a);
      let prev = [ca * 0.08, sa * 0.08, 0.03];
      for (let j = 1; j <= 5; j++) { const q = [ca * (0.08 + j * 0.065) - sa * 0.02 * Math.sin(j * 1.3), sa * (0.08 + j * 0.065) + ca * 0.02 * Math.sin(j * 1.3), 0.03]; p.push(C(prev, q, 0.02, 0.018, "kgBriar")); if (j % 2) thorn(q, [-sa, ca, 0.8], 0.8); prev = q; }
      const c = add(prev, [ca * 0.08, sa * 0.08, 0]);
      ring(8, (b, k) => { const u = [c[0] + Math.cos(b) * 0.08, c[1] + Math.sin(b) * 0.08, 0.03], v = [c[0] + Math.cos(b + TAU / 8) * 0.08, c[1] + Math.sin(b + TAU / 8) * 0.08, 0.03]; p.push(C(u, v, 0.017, 0.017, "kgBriar")); if (k % 2 === 0) thorn(u, [Math.cos(b), Math.sin(b), 1.2], 0.8); });
    }
    let top = H0 + 0.12;
    if (L === 3) {
      // the crown rose on a tall cane, nodding with the loop
      const rc = [0.02 + 0.015 * Math.sin(w), 0.02, 0.86];
      p.push(C([0, 0, 0.08], [0.01, 0.01, 0.45], 0.03, 0.026, "kgBriar"), C([0.01, 0.01, 0.45], rc, 0.026, 0.02, "kgBriar"));
      thorn([0.005, 0.005, 0.3], [1, 0.2, 0.6]); thorn([0.01, 0.01, 0.55], [-0.4, 1, 0.6]);
      p.push(E([-0.05, 0.03, 0.6], [0.06, 0.028, 0.008], "kgLeaf", { R: rz(2.4) }), E(add(rc, [0, 0, -0.05]), [0.05, 0.05, 0.02], "kgLeaf"));
      ring(6, (b) => p.push(E(add(rc, [Math.cos(b) * 0.05, Math.sin(b) * 0.05, 0.01]), [0.055, 0.035, 0.025], "scRose", { R: rz(b), k2: 0.01 })));
      p.push(S(add(rc, [0, 0, 0.035]), 0.035, "kgRoseLt", { k2: 0.01 }));
      top = 0.98;
    }
    return { prims: p, r: R0 + 0.12 + (L > 1 ? 0.2 : 0), h: top, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "kgBark" && nz > 0.3 && nz3(x, y, z, 10, 3) > 0.45 ? "moss" : m) };
  }, 4);

  // Stinkhorn: a basket stinkhorn, an orange lattice ball hatched from a white egg that has a face (Koke
  // Garden). The olive slime inside glows, and a spore bomb swells out of the lattice's top over the loop
  // (what it lobs). Level 2 adds an unhatched sibling egg and a poison puddle, level 3 a small basket beside it.
  model("ms_toad", 1.9, (o) => {
    const L = lv(o), w = ph(o), t = o.t || 0, R = [0.13, 0.16, 0.19][L - 1], es = [0.85, 1, 1.1][L - 1];
    const vc = [0, 0, 0.07 * es], p = [mossPad(0.26 + 0.03 * L), E(vc, [0.15 * es, 0.15 * es, 0.1 * es], "kgSpot", { k2: 0.03 })];
    const basket = (bc, r, nm, bomb) => {
      const br = 1 + 0.04 * Math.sin(w), th = 0.012 + 0.03 * r;
      ring(nm, (a) => { let prev = null; for (let k = 0; k <= 6; k++) { const v = -1.0 + (k / 6) * 2.2, q = [bc[0] + Math.cos(a) * Math.cos(v) * r * br, bc[1] + Math.sin(a) * Math.cos(v) * r * br, bc[2] + Math.sin(v) * r]; if (prev) p.push(C(prev, q, th, th, "kgStinkOr", { k2: 0.006 })); prev = q; } });
      for (const v of [-0.25, 0.5]) ring(2 * nm, (a) => { const q = (b) => [bc[0] + Math.cos(b) * Math.cos(v) * r * br, bc[1] + Math.sin(b) * Math.cos(v) * r * br, bc[2] + Math.sin(v) * r]; p.push(C(q(a), q(a + Math.PI / nm), th * 0.9, th * 0.9, "kgStinkOr")); });
      p.push(S(bc, r * 0.5, "kgGleba", { k2: 0.02 }));
      if (bomb) p.push(S([bc[0], bc[1], bc[2] + r * (0.45 + 0.75 * t)], r * (0.22 + 0.2 * t), "kgStinkGlow"));
    };
    basket([0, 0, 0.1 * es + R * 0.8], R, L === 3 ? 8 : 6, true);
    if (L > 1) {
      // an unhatched sibling egg, and the poison puddle
      p.push(E([0.2, -0.14, 0.05], [0.07, 0.07, 0.06], "kgSpot", { k2: 0.02 }), E([-0.06, 0.24, 0.008], [0.12, 0.08, 0.01], "kgStinkGlow"));
    }
    if (L === 3) { p.push(E([-0.2, -0.12, 0.04], [0.08, 0.08, 0.05], "kgSpot")); basket([-0.2, -0.12, 0.13], 0.08, 5, false); }
    return {
      prims: p, r: 0.38 + 0.03 * L, h: 0.1 * es + R * 2.5 + 0.04, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgSpot" && near([x, y, z], vc, 0.17 * es)) return cface([x - vc[0], y - vc[1], z - vc[2]], 0.13 * es, { ex: 0.42, ey: -0.05, er: 0.2, blush: true, mouth: [0, -0.42, 0.1] }) || (nz3(x, y, z, 20, 6) > 0.68 ? "kgGill" : m);
        if (m === "kgGleba" && nz3(x, y, z, 18, 2) > 0.7) return "kgStinkGlow";
        return m;
      },
    };
  }, 4);

  model("ms_moon", 1.9, (o) => {
    const L = lv(o), w = ph(o), hb = [0.42, 0.54, 0.62][L - 1], br = [0.13, 0.15, 0.17][L - 1], bs = 0.15 + 0.02 * L;
    const p = [Y([0, 0, 0.06], bs, 0.06, "scStone", { round: 0.03 }), E([0, 0, 0.125], [bs - 0.03, bs - 0.03, 0.012], "moss", { k2: 0.02 })];
    const bloom = (c, r, n) => {
      const R = orient(n), u = R.slice(0, 3), v = R.slice(3, 6);
      ring(5, (a, i) => { const d = add(mul(u, Math.cos(a + 0.03 * Math.sin(w + i))), mul(v, Math.sin(a + 0.03 * Math.sin(w + i)))); p.push(E(add(add(c, mul(d, r * 0.62)), mul(n, 0.02)), [r * 0.62, r * 0.42, 0.014], "kgMoonPetal", { R: orient(norm(add(n, mul(d, -0.35))), d) })); });
      p.push(S(add(c, mul(n, 0.02)), r * 0.2, "kgMoon"));
    };
    const n0 = norm([0.35 + 0.05 * Math.sin(w), 0.3, 1]), bc = [0.03, 0.02, hb];
    p.push(C([0, 0, 0.12], [0.02, 0.01, hb * 0.6], 0.024, 0.02, "kgStem"), C([0.02, 0.01, hb * 0.6], bc, 0.02, 0.016, "kgStem"));
    for (const [a, z, s] of [[2.4, 0.2, 1], [-0.7, 0.3, 0.85], [4.0, 0.36, 0.75]].slice(0, L + 1)) { const d = [Math.cos(a), Math.sin(a), 0.15]; p.push(E(add([0, 0, z], mul(norm(d), 0.1 * s)), [0.1 * s, 0.075 * s, 0.01], "kgLeaf", { R: orient([0, 0, 1], d) })); }
    bloom(bc, br, n0);
    if (L > 1) { const b2 = [-0.12, -0.06, hb * 0.66]; p.push(C([0, 0, 0.12], b2, 0.018, 0.014, "kgStem")); bloom(b2, br * 0.7, norm([-0.3, 0.2, 1])); }
    // the moon: a crescent standing in the plane facing the viewer, or (level 3) the full moon
    const mc = [0.02, 0.02, hb + 0.24 + 0.03 * Math.sin(w)], mr = [0.085, 0.105, 0.1][L - 1], VR = [0.707, -0.707, 0], tilt = 0.12 * Math.sin(w) - 0.3;
    if (L < 3) {
      for (let k = 0; k <= 12; k++) {
        const b = Math.PI + ((k / 12) - 0.5) * 3.6 + tilt, r = mr * 0.42 * Math.sin(((k + 0.5) / 13) * Math.PI) + 0.01;
        p.push(S(add(mc, add(mul(VR, Math.cos(b) * mr), [0, 0, Math.sin(b) * mr])), r, "kgMoon"));
      }
    } else {
      p.push(S(mc, mr, "kgMoon"));
      ring(5, (a) => { const b = a + w; p.push(S(add(mc, [Math.cos(b) * 0.2, Math.sin(b) * 0.2, 0.04 * Math.sin(b * 2)]), 0.02, "kgMoon")); });
    }
    if (L === 2) ring(16, (a) => p.push(S(add(mc, [Math.cos(a) * mr * 1.5, Math.sin(a) * mr * 1.5, 0]), 0.008, "kgMoon")));
    const sm = stoneMoss("scStone", 10, 0.5);
    return { prims: p, r: 0.24 + 0.02 * L, h: mc[2] + mr + 0.08, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || m };
  }, 4);

  // Ghost Lily: pale trumpet lilies with a pink blush and glowing stamens, strap leaves round a dark
  // mossy stone (Hotaru Spirit). The trumpets breathe and the stamens flicker. Level 2 is a bigger bloom
  // with a bud and ghost motes rising; level 3 two trumpets, as it holds two beams.
  model("ms_lily", 1.9, (o) => {
    const L = lv(o), w = ph(o), t = o.t || 0, hb = [0.48, 0.6, 0.66][L - 1], s = [0.85, 1, 1.05][L - 1];
    const p = [mossPad(0.24 + 0.02 * L), E([0, 0, 0.04], [0.12, 0.1, 0.06], "hsObsidian", { k2: 0.03 })], blooms = [];
    ring(4 + L, (a, i) => { const d = [Math.cos(a), Math.sin(a)], tip = [d[0] * 0.3, d[1] * 0.3, 0.16 + 0.04 * (i % 2)]; p.push(C([d[0] * 0.04, d[1] * 0.04, 0.06], [d[0] * 0.16, d[1] * 0.16, 0.2], 0.02, 0.016, "hsLeaf"), C([d[0] * 0.16, d[1] * 0.16, 0.2], tip, 0.016, 0.004, "hsLeafLt")); });
    const trumpet = (base, h, n, sc, ph0) => {
      const c = add(base, [n[0] * 0.03 + 0.012 * Math.sin(w + ph0), n[1] * 0.03, h]), open = 1 + 0.08 * Math.sin(w + ph0);
      p.push(C(base, add(base, [0, 0, h * 0.6]), 0.02, 0.017, "hsStem"), C(add(base, [0, 0, h * 0.6]), c, 0.017, 0.014, "hsStem"));
      const R = orient(n), u = R.slice(0, 3), v = R.slice(3, 6);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + ph0, d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))), dp = norm(add(mul(n, 0.8), mul(d, 0.55 * open))), tg = cross(n, d);
        p.push(E(add(c, mul(dp, 0.08 * sc)), [0.085 * sc, 0.03 * sc, 0.009], "kgLily", { R: orient(norm(cross(dp, tg)), dp) }));
        const d2 = norm(add(mul(n, 0.1), d)), tip = add(add(c, mul(dp, 0.15 * sc)), mul(d2, 0.025 * sc));
        p.push(E(tip, [0.04 * sc, 0.024 * sc, 0.008], "kgLily", { R: orient(norm(cross(d2, tg)), d2) }));
      }
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + w * 0.5, d = add(mul(u, Math.cos(a) * 0.025), mul(v, Math.sin(a) * 0.025)), e = add(add(c, mul(n, 0.13 * sc)), d); p.push(C(c, e, 0.004, 0.003, "kgLilyPink"), S(e, 0.012 + 0.005 * Math.max(0, Math.sin(w * 2 + k * 2.1)), "kgLilyGlow")); }
      p.push(S(add(c, mul(n, 0.02)), 0.022 * sc, "kgLilyGlow"));
      blooms.push(c);
      return c;
    };
    trumpet([0.02, 0, 0.06], hb, norm([0.55, 0.25, 0.8]), s, 0);
    if (L === 2) { const b = [-0.08, -0.06, 0.06], bt = [-0.11, -0.07, 0.06 + hb * 0.7]; p.push(C(b, bt, 0.016, 0.012, "hsStem"), E(add(bt, [0, 0, 0.04]), [0.026, 0.026, 0.06], "kgLily")); }
    if (L === 3) trumpet([-0.08, -0.07, 0.06], hb * 0.8, norm([-0.2, -0.55, 0.8]), s * 0.9, 2.6);
    // ghost motes rising off the blooms and fading over the loop
    for (let k = 0; k < L - 1; k++) { const f = (t + k / Math.max(1, L - 1)) % 1, c = blooms[k % blooms.length]; p.push(S(add(c, [0.03 * Math.sin(k * 2.3 + f * 4), 0.03 * Math.cos(k * 2.3), 0.12 + f * 0.3]), 0.02 * (1 - f * 0.6), "kgLilyGlow")); }
    return {
      prims: p, r: 0.34, h: hb + 0.32, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgLily") for (const c of blooms) if (near([x, y, z], c, 0.065)) return "kgLilyPink";
        if (m === "hsObsidian" && nz > 0.3 && nz3(x, y, z, 10, 3) > 0.45) return "moss";
        return m;
      },
    };
  }, 4);

  // ================================================================ the Heart Tree
  // Koke Garden: a gnarled mossy tree tied with a shimenawa, the heart knot glowing. The canopy sways and the
  // shide flutter (4 frames); the knot holds still (the game makes it beat when hit, a swell and a glow,
  // Mossheart view/scene.js). o.hurt spreads the blight: veined bark from the roots up, sick leaves, a
  // thinner crown, a smaller knot.
  model("ms_heart", 1.45, (o) => {
    const hurt = Math.max(0, Math.min(2, o.hurt || 0)), w = ph(o);
    const p = [C([0, 0, -0.05], [0.04, 0.02, 0.95], 0.27, 0.15, "kgBark", { k2: 0.1 })];
    ring(6, (a) => p.push(C([Math.cos(a + 0.3) * 0.12, Math.sin(a + 0.3) * 0.12, 0.2], [Math.cos(a + 0.3) * 0.5, Math.sin(a + 0.3) * 0.5, -0.02], 0.1, 0.035, "kgBark", { k2: 0.06 })));
    for (const l of [[0.5, 0.15, 1.35], [-0.45, 0.25, 1.3], [0.05, -0.5, 1.32], [-0.1, 0.1, 1.55]]) p.push(C([0.03, 0.02, 0.85], l, 0.11, 0.05, "kgBark", { k2: 0.05 }));
    const crown = [[0, 0, 1.62, 0.48], [0.48, 0.18, 1.42, 0.36], [-0.46, 0.26, 1.4, 0.36], [0.08, -0.5, 1.42, 0.34], [-0.22, -0.28, 1.76, 0.3], [0.3, 0.3, 1.78, 0.3], [0.42, -0.3, 1.6, 0.28], [-0.4, -0.1, 1.62, 0.3]];
    crown.slice(0, 8 - hurt * 2).forEach(([x, y, z, r], i) => p.push(S([x + 0.02 * Math.sin(w + i), y + 0.02 * Math.cos(w + i * 1.3), z], r * (1 - 0.06 * hurt), "kgLeaf", { k2: 0.12 })));
    ring(16, (a) => p.push(S([Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0.52 + Math.sin(a * 3) * 0.008], 0.042, "kgRope", { k2: 0.015 })));
    for (const a of [0.35, 0.8, 1.25]) for (let j = 0; j < 3; j++) { const c = [Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.45 - j * 0.045]; p.push(B(add(c, [Math.cos(a + 1.57) * (j % 2 ? 0.015 : -0.015), Math.sin(a + 1.57) * (j % 2 ? 0.015 : -0.015), 0.004 * Math.sin(w + a)]), [0.008, 0.03, 0.022], 0.003, "kgPaper", { R: rz(a) })); }
    const knot = 1 - 0.22 * hurt;
    p.push(E([0.13, 0.13, 0.76], [0.07 * knot, 0.07 * knot, 0.085 * knot], "kgHeart"));
    // fallen leaves at the roots once the tree is hurt
    for (let i = 0; i < hurt * 4; i++) { const a = i * 2.39, r = 0.45 + 0.2 * ((i * 0.618) % 1); p.push(E([Math.cos(a) * r, Math.sin(a) * r, 0.01], [0.04, 0.02, 0.006], "kgLeafSick", { R: rz(a * 1.7) })); }
    return {
      prims: p, r: 0.95, h: 2.1, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgBark" && hurt) {
          const reach = 0.3 + 0.4 * hurt, v = nz3(x, y, z, 6, 5);
          if (z < reach && Math.abs(v - 0.5) < 0.022 + 0.008 * hurt) return "hsVein";
          if (z < reach && v > 0.66 - 0.06 * hurt) return "hsBlight";
        }
        if (m === "kgLeaf") { if (hurt && nz3(x, y, z, 5, 9) > 0.7 - 0.12 * hurt) return "kgLeafSick"; return nz > 0.3 && nz3(x, y, z, 7, 4) > 0.5 ? "kgLeafLt" : m; }
        if (m === "kgBark" && nz > 0.4 && nz3(x, y, z, 9, 3) > 0.45) return "moss";
        return m;
      },
    };
  }, 4);

  // ================================================================ enemies (Hotaru Spirit blight)
  // Rot Grub: a blight larva with magenta veins and glowing eyes; the body ripples to crawl.
  model("ms_grub", 2.0, (o) => {
    const w = ph(o), L = larva("hsBlight", "hsBarkDk", { wave: w });
    const bump = (i) => Math.max(0, Math.sin(w - i * 1.3)) * 0.035;
    for (const [x, r, i] of [[0.06, 0.03, 0], [-0.05, 0.034, 1], [-0.15, 0.026, 2], [-0.2, 0.02, 3]]) L.p.push(S([x, 0.02 * Math.sign(x + 0.01), 0.17 + bump(i) - Math.abs(x) * 0.15], r, "hsVein"));
    return {
      prims: L.p, r: 0.38, h: 0.34, k: 1,
      detail: (x, y, z, m) => (m === "hsBlight" && near([x, y, z], L.hc, L.hr * 1.1) ? cface([x - L.hc[0], y - L.hc[1], z - L.hc[2]], L.hr, { ex: 0.42, ey: 0.12, er: 0.2, eye: "hsVein", hi: false }) || m : m),
    };
  }, 4);

  // Bark Beetle: a domed blight shell of bark plates split by a glowing seam, an obsidian horn tipped with
  // crystal; six legs walk in alternating tripods.
  model("ms_beetle", 2.0, (o) => {
    const w = ph(o), hc = [0.2, 0, 0.13], p = [E([-0.03, 0, 0.17], [0.24, 0.18, 0.13], "hsShell", { k2: 0.02 }), E([-0.02, 0, 0.1], [0.22, 0.15, 0.06], "hsObsidian", { k2: 0.03 }), S(hc, 0.095, "hsObsidian", { k2: 0.03 })];
    p.push(C(add(hc, [0.05, 0, 0.05]), add(hc, [0.14, 0, 0.2]), 0.045, 0.02, "hsObsidian", { k2: 0.015 }), C(add(hc, [0.14, 0, 0.2]), add(hc, [0.16, 0, 0.3]), 0.022, 0.004, "hsCrystal"));
    // glowing blight pores along the shell
    for (const [x, sd] of [[0.08, 1], [-0.04, -1], [-0.14, 1], [0.0, 1], [-0.1, -1]]) p.push(S([x, sd * 0.1, 0.17 + 0.08 * Math.cos(x * 6)], 0.022, "hsVein"));
    for (const sd of [-1, 1]) {
      p.push(C(add(hc, [0.07, sd * 0.04, -0.04]), add(hc, [0.12, sd * 0.015, -0.07]), 0.014, 0.004, "hsObsidian"));
      [0.1, -0.02, -0.14].forEach((x, i) => {
        const g = w + ((i % 2) ^ (sd > 0 ? 1 : 0)) * Math.PI, fx = x + 0.04 * Math.sin(g), lift = 0.03 * Math.max(0, Math.cos(g));
        const hip = [x, sd * 0.12, 0.1], knee = [x + 0.01, sd * 0.2, 0.1 + lift], foot = [fx, sd * 0.24, lift * 0.7];
        p.push(C(hip, knee, 0.016, 0.013, "hsObsidian"), C(knee, foot, 0.013, 0.008, "hsObsidian"));
      });
    }
    return {
      prims: p, r: 0.34, h: 0.4, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "hsShell") { if (Math.abs(y) < 0.022 && z > 0.14) return "hsVein"; return nz3(x, y, z, 12, 4) > 0.6 ? "hsShellLt" : m; }
        if (m === "hsObsidian" && near([x, y, z], hc, 0.105)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.095, { ex: 0.42, ey: 0.15, er: 0.2, eye: "hsVein", hi: false }) || m;
        return m;
      },
    };
  }, 4);

  // Dusk Moth: a night moth with cyan wing veins and a pink rim; the wings beat over the loop.
  model("ms_moth", 2.0, (o) => {
    const w = ph(o), beat = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(w)), z0 = 0.45, hc = [0.17, 0, z0 + 0.04];
    const p = [E([-0.03, 0, z0], [0.14, 0.07, 0.075], "hsWingDk", { k2: 0.03 }), S(hc, 0.1, "hsWingDk", { k2: 0.03 })];
    for (const sd of [-1, 1]) {
      p.push(E([0.02, sd * 0.19 * Math.cos(beat * 0.6), z0 + 0.06 + 0.12 * Math.sin(beat)], [0.14, 0.2, 0.024], "hsWingDk", { R: rx(sd * beat) }), E([-0.1, sd * 0.15 * Math.cos(beat * 0.6), z0 + 0.03 + 0.08 * Math.sin(beat)], [0.1, 0.14, 0.022], "hsWingDk", { R: rx(sd * (beat + 0.1)) }));
      p.push(C(add(hc, [0.03, sd * 0.04, 0.08]), add(hc, [0.1, sd * 0.13, 0.2]), 0.008, 0.006, "hsWingDk"), S(add(hc, [0.1, sd * 0.13, 0.2]), 0.02, "hsGlowCyan"));
    }
    return {
      prims: p, r: 0.42, h: 0.8, k: 1,
      detail: (x, y, z, m) => {
        if (m !== "hsWingDk") return m;
        if (near([x, y, z], hc, 0.11)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.1, { ex: 0.45, ey: 0.1, er: 0.28, eye: "hsGlowPink", hi: false }) || m;
        const ay = Math.hypot(y, z - z0);
        if (ay < 0.07) return m;
        const ang = Math.atan2(ay, x + 0.02), d = Math.hypot(x + 0.02, ay);
        if (Math.abs(Math.sin(ang * 9)) < 0.12 && d > 0.1) return "hsGlowCyan";
        if (Math.abs(d - 0.25) < 0.012) return "hsGlowPink";
        return m;
      },
    };
  }, 4);

  // Moss Golem: blighted obsidian with crystal shards and a glowing crack for a heart; arms swing, the body bobs.
  model("ms_golem", 1.8, (o) => {
    const w = ph(o), bob = 0.02 * Math.abs(Math.sin(w)), hc = [0.14, 0.02, 0.66 + bob];
    const p = [E([-0.02, 0, 0.38 + bob], [0.24, 0.27, 0.25], "hsObsidian", { k2: 0.03 }), S([-0.04, 0, 0.56 + bob], 0.2, "hsObsidian", { k2: 0.06 }), S(hc, 0.13, "hsObsidian", { k2: 0.02 })];
    for (const sd of [-1, 1]) {
      const sw = 0.07 * Math.sin(w) * sd, lift = 0.03 * Math.max(0, Math.sin(w) * sd);
      p.push(S([-0.02 - sw * 0.5, sd * 0.13, 0.08 + lift], 0.09, "hsObsidian", { k2: 0.02 }), S([0, sd * 0.3, 0.5 + bob], 0.1, "hsObsidian", { k2: 0.03 }));
      p.push(C([0.02, sd * 0.33, 0.48 + bob], [0.1 + sw, sd * 0.36, 0.16 + bob], 0.075, 0.065, "hsObsidian", { k2: 0.02 }), S([0.12 + sw, sd * 0.36, 0.09 + bob], 0.085, "hsObsidian", { k2: 0.02 }));
      p.push(C([-0.04, sd * 0.28, 0.56 + bob], [-0.1, sd * 0.36, 0.78 + bob], 0.045, 0.005, "hsCrystal"), C([-0.1, sd * 0.1, 0.7 + bob], [-0.16, sd * 0.14, 0.9 + bob], 0.04, 0.004, "hsCrystal"));
    }
    p.push(E([0.2, 0.06, 0.4 + bob], [0.04, 0.07, 0.08], "hsVein", { R: rz(0.7) }));
    const face = (x, y, z) => (near([x, y, z], hc, 0.15) ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.13, { ex: 0.36, ey: 0.02, er: 0.2, eye: "hsVein", hi: false }) : null);
    return { prims: p, r: 0.46, h: 0.98, k: 1, detail: (x, y, z, m) => (m === "hsObsidian" ? face(x, y, z) || (Math.abs(nz3(x, y, z, 7, 5) - 0.5) < 0.025 ? "hsVein" : m) : m) };
  }, 4);

  // Blight Spirit (boss): a hooded wraith with a cracked white mask, a crown of crystal horns, a tattered hem
  // that ripples as it drifts, two floating clawed hands and pink wisps circling it.
  model("ms_spirit", 1.6, (o) => {
    const w = ph(o), hc = [0.18, 0.1, 1.0]; // the mask turned toward the viewer, out of the hood
    const p = [E([0, 0, 0.72], [0.3, 0.29, 0.42], "hsWraith", { k2: 0.06 }), S([-0.05, -0.03, 1.08], 0.25, "hsWraith", { k2: 0.08 }), S(hc, 0.165, "hsMask", { k2: 0.01 })];
    ring(12, (a, i) => { const r0 = [Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.45], r1 = [Math.cos(a + 0.12 * Math.sin(w + i)) * 0.4, Math.sin(a + 0.12 * Math.sin(w + i)) * 0.4, 0.1 + 0.05 * Math.sin(w + i * 1.7)]; p.push(C(r0, r1, 0.1, 0.025, i % 2 ? "hsWraith" : "hsBlight", { k2: 0.06 })); }); // a tattered skirt, rippling
    ring(5, (a, i) => { const b = a * 0.5 - 1.0, base = [0.0 + Math.cos(b) * 0.04, Math.sin(b) * 0.2, 1.24], tip = add(base, [-0.04, Math.sin(b) * 0.12, 0.16 + 0.05 * (i % 2)]); p.push(C(base, tip, 0.035, 0.004, "hsCrystal")); });
    p.push(E([0.22, 0, 0.66], [0.04, 0.09, 0.11], "hsVein"));
    for (const sd of [-1, 1]) {
      const hz = 0.66 + 0.05 * Math.sin(w + sd), hp = [0.26, sd * 0.42, hz];
      p.push(S(hp, 0.07, "hsWraith", { k2: 0.02 }));
      for (const k of [-1, 0, 1]) p.push(C(add(hp, [0.04, k * 0.03, -0.02]), add(hp, [0.1, k * 0.045, -0.08]), 0.016, 0.003, "hsCrystal"));
    }
    ring(4, (a) => { const b = a + w; p.push(S([Math.cos(b) * 0.55, Math.sin(b) * 0.55, 0.8 + 0.1 * Math.sin(b * 2)], 0.035, "hsGlowPink")); });
    return {
      prims: p, r: 0.62, h: 1.48, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsMask") {
          const f = cface([x - hc[0], y - hc[1], z - hc[2]], 0.165, { ex: 0.36, ey: 0.08, er: 0.22, eye: "hsVein", hi: false, mouth: [0, -0.4, 0.16] });
          if (f) return f;
          return Math.abs(nz3(x, y, z, 8, 3) - 0.5) < 0.02 ? "hsVein" : m;
        }
        if (m === "hsWraith" && z < 0.9 && Math.abs(nz3(x, y, z, 5, 7) - 0.5) < 0.018) return "hsVein";
        return m;
      },
    };
  }, 4);

  // ---------------------------------------------------------------- the mould creatures (game/enemies)
  // a creature's legs in alternating tripods: hips at (x, ±y0, z0) for each x, reaching out to ±y1; w the
  // walk phase. Pushes the prims, in material m with radius r.
  const tripods = (p, xs, y0, y1, z0, w, m, r = 0.016, stride = 0.04) => {
    for (const sd of [-1, 1]) xs.forEach((x, i) => {
      const g = w + ((i % 2) ^ (sd > 0 ? 1 : 0)) * Math.PI, lift = 0.03 * Math.max(0, Math.cos(g));
      const hip = [x, sd * y0, z0], knee = [x + 0.01, sd * (y0 + y1) / 2 + sd * 0.02, z0 + 0.02 + lift], foot = [x + stride * Math.sin(g), sd * y1, lift * 0.7];
      p.push(C(hip, knee, r, r * 0.8, m), C(knee, foot, r * 0.8, r * 0.5, m));
    });
  };

  // Shellback Snail: a pale slug foot under a big spiral shell, banded and cracked with blight; the foot
  // ripples forward and the eye stalks sway.
  model("ms_snail", 2.0, (o) => {
    const w = ph(o), sq = 0.02 * Math.sin(w), hc = [0.24 + sq, 0, 0.12], sc = [-0.05, 0, 0.23 + 0.008 * Math.sin(w + 1)];
    const p = [E([0.02, 0, 0.055], [0.27 + sq, 0.11, 0.06], "hsSnailBody", { k2: 0.03 }), S(hc, 0.085, "hsSnailBody", { k2: 0.04 }), E(sc, [0.18, 0.13, 0.18], "hsSnailShell", { k2: 0.02 }), S(add(sc, [0.03, 0, 0.0]), 0.07, "hsSnailShellLt")];
    for (const sd of [-1, 1]) { const tip = add(hc, [0.07 + 0.015 * Math.sin(w + sd), sd * 0.06, 0.15]); p.push(C(add(hc, [0.02, sd * 0.03, 0.05]), tip, 0.014, 0.01, "hsSnailBody"), S(tip, 0.022, "hsVein")); }
    return {
      prims: p, r: 0.34, h: 0.42, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsSnailBody" && near([x, y, z], hc, 0.095)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.085, { ex: 0.4, ey: 0.05, er: 0.2, eye: "hsVein", hi: false }) || m;
        if (m === "hsSnailShell" || m === "hsSnailShellLt") {
          // the spiral seen on the shell's sides: bands where log(r) and the angle in the xz plane line up
          const dx = x - sc[0], dz = z - sc[2], r = Math.hypot(dx, dz) + 1e-4, a = Math.atan2(dz, dx) / TAU, f = (Math.log(r / 0.18) / 0.55 + a + 10) % 1;
          if (f < 0.12) return "hsBlight";
          if (Math.abs(nz3(x, y, z, 9, 6) - 0.5) < 0.02) return "hsVein";
          return f < 0.5 ? "hsSnailShellLt" : "hsSnailShell";
        }
        return m;
      },
    };
  }, 4);

  // Bloat Mould: a swollen mould sack on a grub's little head, its pustules glowing and the sack breathing
  // as it crawls (the mites inside show as lumps).
  model("ms_bloat", 2.0, (o) => {
    const w = ph(o), br = 1 + 0.06 * Math.sin(w), hc = [0.2, 0, 0.11];
    const p = [E([-0.03, 0, 0.17], [0.2 * br, 0.18 * br, 0.17 / br], "hsMould", { k2: 0.04 }), S(hc, 0.085, "hsMouldLt", { k2: 0.04 })];
    for (const [x, y, z, r] of [[0.02, 0.14, 0.24, 0.045], [-0.12, -0.1, 0.26, 0.05], [-0.08, 0.12, 0.08, 0.04], [0.06, -0.12, 0.2, 0.04], [-0.18, 0.04, 0.2, 0.04], [-0.04, 0, 0.33, 0.04]]) p.push(S([x * br, y * br, z], r * (1 + 0.15 * Math.sin(w + x * 20)), "hsMouldLt", { k2: 0.01 }));
    for (const sd of [-1, 1]) for (const x of [0.12, 0, -0.12]) p.push(C([x, sd * 0.12, 0.05], [x + 0.02 * Math.sin(w + x * 9), sd * 0.16, 0.0], 0.022, 0.012, "hsMouldDk"));
    return {
      prims: p, r: 0.3, h: 0.38, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsMouldLt" && near([x, y, z], hc, 0.095)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.085, { ex: 0.42, ey: 0.08, er: 0.22, eye: "hsMouldDk", hi: true, mouth: [0, -0.4, 0.12], mouthM: "hsMouldDk" }) || m;
        if (m === "hsMouldLt" && nz3(x, y, z, 30, 4) > 0.62) return "hsMouldGlow";
        if (m === "hsMould") return nz3(x, y, z, 14, 2) > 0.62 ? "hsMouldLt" : Math.abs(nz3(x, y, z, 7, 5) - 0.5) < 0.02 ? "hsMouldGlow" : m;
        return m;
      },
    };
  }, 4);

  // Mould Mite: a round little mite with a big face and pincers, skittering on six legs.
  model("ms_mite", 2.0, (o) => {
    const w = ph(o), hc = [0.13, 0, 0.15], p = [E([-0.03, 0, 0.13], [0.14, 0.12, 0.1], "hsMouldLt", { k2: 0.03 }), S(hc, 0.095, "hsMouldLt", { k2: 0.03 })];
    for (const sd of [-1, 1]) p.push(C(add(hc, [0.07, sd * 0.04, -0.04]), add(hc, [0.13, sd * 0.015, -0.06]), 0.016, 0.006, "hsMouldDk"));
    p.push(S([-0.08, 0.04, 0.22], 0.03, "hsMouldGlow"), S([-0.02, -0.06, 0.22], 0.025, "hsMouldGlow"));
    tripods(p, [0.06, -0.03, -0.12], 0.08, 0.2, 0.1, w, "hsMouldDk", 0.016, 0.05);
    return { prims: p, r: 0.26, h: 0.26, k: 1, detail: (x, y, z, m) => (m === "hsMouldLt" && near([x, y, z], hc, 0.105) ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.095, { ex: 0.42, ey: 0.1, er: 0.26, hi: true }) || m : m) };
  }, 4);

  // Rot Mender: a hunched little mould shaman in a mossy cloak and a mushroom hat, swinging a staff with
  // a mint glow that heals; motes of it circle the mender.
  model("ms_mender", 2.0, (o) => {
    const w = ph(o), bob = 0.015 * Math.abs(Math.sin(w)), hc = [0.06, 0, 0.36 + bob];
    const p = [C([0, 0, 0.02], [0.02, 0, 0.3 + bob], 0.19, 0.1, "hsMould", { k2: 0.04 }), S(hc, 0.11, "hsMask", { k2: 0.02 }), E([0.03, 0, 0.5 + bob], [0.14, 0.14, 0.05], "hsMouldLt", { k2: 0.02 }), E([0.03, 0, 0.47 + bob], [0.11, 0.11, 0.015], "hsMouldGlow")];
    const hand = [0.12, 0.14, 0.24 + bob], top = [0.16 + 0.04 * Math.sin(w), 0.18, 0.6 + bob];
    p.push(S(hand, 0.04, "hsMould"), C([0.1, 0.17, 0.02], top, 0.014, 0.012, "hsBarkDk"), S(add(top, [0, 0, 0.04]), 0.045 * (1 + 0.12 * Math.sin(w * 2)), "hsGlowMint"));
    for (const sd of [-1, 1]) p.push(E([0.02, sd * 0.11, 0.04], [0.06, 0.04, 0.03], "hsMouldDk"));
    ring(3, (a) => { const b = a + w; p.push(S([Math.cos(b) * 0.28, Math.sin(b) * 0.28, 0.3 + 0.05 * Math.sin(b * 2)], 0.022, "hsGlowMint")); });
    return {
      prims: p, r: 0.36, h: 0.72, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsMask") return cface([x - hc[0], y - hc[1], z - hc[2]], 0.11, { ex: 0.38, ey: 0.0, er: 0.2, eye: "hsGlowMint", hi: false, mouth: [0, -0.4, 0.09] }) || m;
        if (m === "hsMould") return nz3(x, y, z, 12, 3) > 0.6 ? "moss" : m;
        if (m === "hsMouldLt" && nz3(x, y, z, 20, 5) > 0.66) return "kgSpot";
        return m;
      },
    };
  }, 4);

  // Midge Swarm: a cloud of tiny dark midges with glinting wings and pink eyes, jittering as it flies.
  model("ms_midge", 2.0, (o) => {
    const w = ph(o), p = [];
    const M = [[0.1, 0.0, 0.42], [-0.08, 0.1, 0.5], [-0.04, -0.12, 0.38], [0.02, 0.06, 0.62], [-0.14, -0.02, 0.56], [0.12, -0.1, 0.55], [0.0, 0.14, 0.34]];
    M.forEach(([x, y, z], i) => {
      const c = [x + 0.03 * Math.sin(w + i * 2.1), y + 0.03 * Math.cos(w * 2 + i), z + 0.04 * Math.sin(w + i * 1.3)], beat = 0.4 + 0.5 * Math.abs(Math.sin(w * 2 + i));
      p.push(E(c, [0.035, 0.022, 0.022], "hsWingDk"), S(add(c, [0.03, 0, 0.005]), 0.016, "hsGlowPink"));
      for (const sd of [-1, 1]) p.push(E(add(c, [-0.01, sd * 0.035, 0.02 + 0.02 * beat]), [0.03, 0.035, 0.006], "hsCrystal", { R: rx(sd * beat) }));
    });
    return { prims: p, r: 0.3, h: 0.72, k: 1 };
  }, 4);

  // Root Mole: a furry mole with a pink star nose and big pale digging claws, roots and earth on its back,
  // paddling forward.
  model("ms_mole", 2.0, (o) => {
    const w = ph(o), hc = [0.17, 0, 0.13], p = [E([-0.03, 0, 0.13], [0.22, 0.15, 0.13], "hsMoleFur", { k2: 0.04 }), S(hc, 0.1, "hsMoleFur", { k2: 0.05 })];
    ring(6, (a) => p.push(E(add(hc, [0.1 + Math.cos(a) * 0.012, Math.sin(a) * 0.022, Math.cos(a) * 0.022]), [0.012, 0.018, 0.018], "kgRoseLt")));
    for (const sd of [-1, 1]) {
      const g = w + (sd > 0 ? 0 : Math.PI), paw = [0.16 + 0.05 * Math.sin(g), sd * 0.15, 0.03 + 0.025 * Math.max(0, Math.cos(g))];
      p.push(E(paw, [0.05, 0.04, 0.02], "hsMoleFurLt", { k2: 0.01 }));
      for (const k of [-1, 0, 1]) p.push(C(add(paw, [0.03, k * 0.018, 0]), add(paw, [0.08, k * 0.024, -0.02]), 0.01, 0.003, "hsMask"));
      p.push(E([-0.14, sd * 0.12, 0.03], [0.05, 0.035, 0.025], "hsMoleFurLt"));
    }
    // roots and a clod of earth on its back
    p.push(E([-0.07, 0.02, 0.25], [0.08, 0.07, 0.03], "kgBark"), C([-0.12, 0.0, 0.26], [-0.02, 0.06, 0.33], 0.01, 0.005, "kgStem"), C([-0.05, -0.03, 0.27], [0.02, -0.08, 0.31], 0.009, 0.004, "kgStem"));
    return {
      prims: p, r: 0.3, h: 0.34, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsMoleFur" && near([x, y, z], hc, 0.11)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.1, { ex: 0.36, ey: 0.22, er: 0.11, eye: "hsVein", hi: false }) || m;
        if (m === "hsMoleFur") return Math.abs(y) < 0.018 && z > 0.18 ? "hsVein" : nz3(x, y, z, 26, 3) > 0.62 ? "hsMoleFurLt" : m;
        return m;
      },
    };
  }, 4);

  // Lichen Crab: a broad crab shell crusted with lichen (its armour) and split by a blight seam, eyes on
  // stalks, two big claws, scuttling on eight legs.
  model("ms_lichen", 1.8, (o) => {
    const w = ph(o), bob = 0.012 * Math.abs(Math.sin(w * 2)), sc = [0, 0, 0.24 + bob];
    const p = [E(sc, [0.24, 0.3, 0.12], "hsCrab", { k2: 0.03 }), E(add(sc, [0, 0, -0.06]), [0.2, 0.26, 0.06], "hsObsidian", { k2: 0.02 })];
    for (const sd of [-1, 1]) {
      const eye = add(sc, [0.2, sd * 0.07, 0.14]);
      p.push(C(add(sc, [0.16, sd * 0.06, 0.06]), eye, 0.014, 0.012, "hsCrab"), S(eye, 0.03, "hsMouldGlow"));
      // a big claw, opening and closing
      const sh = add(sc, [0.12, sd * 0.24, -0.04]), el = [0.34, sd * 0.3, 0.2 + bob], cl = [0.46, sd * 0.24, 0.2 + bob], open = 0.25 + 0.2 * Math.sin(w + sd);
      p.push(C(sh, el, 0.035, 0.03, "hsCrab"), E(cl, [0.09, 0.05, 0.05], "hsCrab", { R: rz(-sd * 0.5) }));
      p.push(C(add(cl, [0.05, 0, 0.02]), add(cl, [0.13, -sd * 0.03, 0.02 + open * 0.15]), 0.025, 0.008, "hsLichenLt"), C(add(cl, [0.05, 0, -0.01]), add(cl, [0.13, -sd * 0.04, -0.01]), 0.022, 0.008, "hsLichenLt"));
    }
    tripods(p, [0.08, -0.02, -0.11, -0.19], 0.24, 0.42, 0.2 + bob, w * 2, "hsCrab", 0.02, 0.03);
    return {
      prims: p, r: 0.52, h: 0.46, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m !== "hsCrab" || z < sc[2]) return m;
        if (Math.abs(y) < 0.016 && nz > 0.6) return "hsVein";
        const v = nz3(x, y, z, 11, 8);
        return v > 0.66 ? "hsLichenLt" : v > 0.5 ? "hsLichen" : m;
      },
    };
  }, 4);

  // Mould Mother (the second boss): a vast mould queen, a banded abdomen glowing with pustules dragged
  // behind a crowned head (a ring of little mushrooms), mites riding her back; the abdomen heaves and the
  // legs crawl.
  model("ms_mother", 1.6, (o) => {
    const w = ph(o), br = 1 + 0.05 * Math.sin(w), hc = [0.36, 0.06, 0.55], ac = [-0.28, 0, 0.36];
    const p = [E(ac, [0.46 * br, 0.38 * br, 0.34 / br], "hsMould", { k2: 0.06 }), S([0.12, 0.02, 0.42], 0.22, "hsMouldDk", { k2: 0.06 }), S(hc, 0.2, "hsMouldLt", { k2: 0.05 })];
    ring(9, (a, i) => { const c = add(ac, [Math.cos(a) * 0.4 * br, Math.sin(a) * 0.33 * br, 0.06 + 0.12 * Math.sin(i * 1.7)]); p.push(S(c, 0.045 * (1 + 0.2 * Math.sin(w + i)), "hsMouldGlow")); });
    // the crown: five little mushrooms round the top of her head
    ring(5, (a) => { const b = add(hc, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.16]), t = add(b, [Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0.1]); p.push(C(b, t, 0.018, 0.014, "kgSpot"), E(t, [0.05, 0.05, 0.025], "hsMouldLt", { k2: 0.01 }), E(add(t, [0, 0, -0.012]), [0.04, 0.04, 0.008], "hsMouldGlow")); });
    for (const sd of [-1, 1]) p.push(C(add(hc, [0.15, sd * 0.06, -0.08]), add(hc, [0.25, sd * 0.03, -0.16]), 0.03, 0.01, "hsObsidian"));
    tripods(p, [0.22, 0.08, -0.06], 0.18, 0.4, 0.3, w, "hsObsidian", 0.035, 0.05);
    // mites riding her back
    for (const [x, y] of [[-0.3, 0.12], [-0.45, -0.1]]) { const c = [x, y, ac[2] + 0.33 / br + 0.02 + 0.02 * Math.sin(w + x * 9)]; p.push(E(c, [0.05, 0.04, 0.035], "hsMouldLt"), S(add(c, [0.04, 0, 0.01]), 0.03, "hsMouldLt")); }
    return {
      prims: p, r: 0.72, h: 1.0, k: 1,
      detail: (x, y, z, m) => {
        if (m === "hsMouldLt" && near([x, y, z], hc, 0.21)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.2, { ex: 0.38, ey: 0.08, er: 0.2, eye: "hsMouldGlow", hi: false, mouth: [0, -0.42, 0.14], mouthM: "hsMouldDk" }) || m;
        if (m === "hsMould") { const band = Math.abs(Math.sin((x - ac[0]) * 22)); return band < 0.12 ? "hsMouldDk" : nz3(x, y, z, 10, 4) > 0.64 ? "hsMouldLt" : m; }
        return m;
      },
    };
  }, 4);

  // ---------------------------------------------------------------- the blight creatures (the bestiary)
  // Blight Crow: a night-black crow with a bone beak and green eyes, a blight sore on its back and husk bones
  // showing through the wings; the wings beat (up, level, down, level), the tips lagging the arms. Authored
  // in tiles at k 1, flying with its talons at the anchor (the rules set the height).
  model("ms_crow", 1.0, (o) => {
    const w = ph(o), th = 0.1 + 0.5 * Math.sin(w), lag = 0.25 * Math.cos(w), dz = -0.02 * Math.sin(w) - 0.25;
    const q = (x, y, z) => [x, y, z + dz];
    // a point on side s's wing, swung about the shoulder (y = s * 0.08, z = 0.47) by a, up positive
    const wing = (s, [x, y, z], a) => { const out = y * s - 0.08, up = z - 0.47; return [x, s * (0.08 + out * Math.cos(a) - up * Math.sin(a)), 0.47 + out * Math.sin(a) + up * Math.cos(a) + dz]; };
    const p = [
      E(q(0, 0, 0.42), [0.2, 0.11, 0.11], "bcCrow", { k2: 0.03 }), E(q(0.08, 0, 0.39), [0.12, 0.09, 0.09], "bcCrow", { k2: 0.03 }), E(q(-0.04, 0, 0.5), [0.08, 0.05, 0.03], "hsBlight"),
      E(q(0.21, 0, 0.5), [0.09, 0.075, 0.08], "bcCrow", { k2: 0.02 }), C(q(0.28, 0, 0.5), q(0.42, 0, 0.465), 0.032, 0.008, "bcBone"),
      E(q(-0.27, 0, 0.43), [0.12, 0.07, 0.02], "bcCrowDk"),
    ];
    for (const s of [-1, 1]) {
      p.push(S(q(0.26, s * 0.056, 0.53), 0.024, "bcEyeGreen"), C(q(-0.25, s * 0.03, 0.43), q(-0.42, s * 0.07, 0.42), 0.025, 0.012, "bcCrowDk"), C(q(0, s * 0.04, 0.34), q(0.04, s * 0.045, 0.27), 0.014, 0.01, "bcBone"));
      p.push(E(wing(s, [-0.02, s * 0.25, 0.47], th), [0.15, 0.22, 0.026], "bcCrowDk", { R: rx(s * th), k2: 0.01 }), E(wing(s, [-0.04, s * 0.2, 0.495], th), [0.05, 0.06, 0.012], "hsBlight", { R: rx(s * th) }));
      for (let i = 0; i < 5; i++) p.push(C(wing(s, [0.04 - i * 0.045, s * 0.36, 0.47], th), wing(s, [-0.02 - i * 0.06, s * (0.56 - i * 0.025), 0.455 - i * 0.004], th - lag), 0.03, 0.012, i % 2 ? "bcCrow" : "bcCrowDk"));
      p.push(C(wing(s, [-0.1, s * 0.3, 0.45], th), wing(s, [-0.15, s * 0.34, 0.35], th), 0.02, 0.008, "bcHusk"), C(wing(s, [0.02, s * 0.42, 0.45], th), wing(s, [0.0, s * 0.45, 0.37], th), 0.014, 0.006, "bcHusk"));
    }
    return { prims: p, r: 0.6, h: 0.62, k: 1, detail: (x, y, z, m) => (m === "bcCrow" && nz3(x, y, z, 22, 3) > 0.66 ? "bcCrowDk" : m) };
  }, 4);

  // ================================================================ props
  // blight rift: where enemies enter. A cracked obsidian crater with a glowing pool and crystal shards.
  // o.dim: a rift that sleeps (no blight comes through it yet): its pool and cracks only smoulder
  // (hsVeinDim, which casts no point light) and its shards go dark.
  model("ms_rift", 1.6, (o) => {
    const vein = o.dim ? "hsVeinDim" : "hsVein", shard = o.dim ? "hsObsidian" : "hsCrystal";
    const p = [E([0, 0, 0.0], [0.42, 0.42, 0.07], "hsObsidian", { k2: 0.05 }), E([0, 0, 0.045], [0.2, 0.2, 0.025], vein)];
    ring(6, (a, i) => { const r = 0.3 + 0.06 * (i % 2), b = [Math.cos(a) * r, Math.sin(a) * r, 0.02], d = norm([Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1]); p.push(C(b, add(b, mul(d, 0.12 + 0.07 * ((i * 0.618) % 1))), 0.04, 0.005, shard)); });
    return { prims: p, r: 0.5, h: 0.3, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "hsObsidian" && nz > 0.5 && Math.abs(nz3(x, y, z, 6, 2) - 0.5) < 0.03 ? vein : m) };
  });
  // a cluster of small glowing mushrooms (lights the path at dusk)
  model("ms_glowcap", 1.7, () => {
    const p = [];
    for (const [x, y, h, r] of [[0.02, 0.02, 0.22, 0.09], [-0.1, 0.07, 0.14, 0.065], [0.09, -0.08, 0.17, 0.07]]) p.push(C([x, y, 0], [x, y, h], r * 0.35, r * 0.28, "hsKodama", { k2: 0.01 }), E([x, y, h + r * 0.12], [r, r, r * 0.5], "hsCap", { k2: 0.02 }), E([x, y, h - r * 0.08], [r * 0.85, r * 0.85, r * 0.1], "hsGlowPink"));
    return { prims: p, r: 0.2, h: 0.3, k: 1 };
  });
  // a small stone ground lantern with a warm light (path marker)
  model("ms_lamp", 1.6, () => {
    const p = lantern("scLitWarm", 0.55), sm = stoneMoss("scStone", 12, 0.5);
    return { prims: p, r: 0.16, h: 0.55, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || m };
  });
  // a mossy boulder
  model("ms_stone", 1.7, () => {
    const p = [E([0, 0, 0.1], [0.24, 0.2, 0.15], "kgStone", { k2: 0.05 }), E([0.1, -0.08, 0.06], [0.12, 0.1, 0.08], "kgStone", { k2: 0.05 })], sm = stoneMoss("kgStone", 8, 0.35);
    return { prims: p, r: 0.28, h: 0.3, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || (nz3(x, y, z, 14, 5) > 0.72 ? "kgStoneDk" : m) };
  });
  // a kodama sitting on a mossy rock, rattling its head
  model("ms_kodama", 1.9, (o) => {
    const w = ph(o), p = [E([0, 0, 0.06], [0.14, 0.12, 0.09], "kgStone", { k2: 0.04 }), E([0, 0, 0.13], [0.11, 0.09, 0.03], "moss", { k2: 0.03 })];
    const h = kodamaT([0.02, 0, 0.14], 0.9, p, Math.sin(w) > 0.4 ? 0.015 : 0, Math.sin(w) < -0.4 ? 0.015 : 0), kf = kodamaFace([h], 0.9);
    return { prims: p, r: 0.16, h: 0.36, k: 1, detail: (x, y, z, m) => (m === "hsKodama" ? kf(x, y, z) || m : m) };
  }, 4);

  // ================================================================ showrooms
  const T = ["thorn", "sun", "puff", "wisp"];
  const T2 = ["briar", "toad", "moon", "lily"];
  const towerRow = (L, kinds = T) => [kinds.map((n) => ["ms_" + n, { lv: L }, n + L]), [2.1, -0.2, -2.5][L - 1], [-3.6, -1.2, 1.2, 3.6]];
  const ENEMY_WALK = [
    { type: "grub", model: "ms_grub", speed: 0.45, rate: 2.6, gait: "roll" }, { type: "beetle", model: "ms_beetle", speed: 0.38, rate: 3.0, gait: "roll" },
    { type: "moth", model: "ms_moth", speed: 0.6, rate: 3.2, gait: "fly", fly: 0 }, { type: "golem", model: "ms_golem", speed: 0.28, rate: 1.5, gait: "roll" },
    { type: "spirit", model: "ms_spirit", speed: 0.22, rate: 1.0, gait: "fly", fly: 0.08 },
  ];
  const BESTIARY = ["crow"]; // the blight creatures built so far, one PR each
  Object.assign(ME.ASSET_THEMES, {
    "set-towers": { label: "Towers, levels 1-3", rows: [towerRow(1), towerRow(2), towerRow(3)] },
    "set-towers2": { label: "The second four plants, levels 1-3", rows: [1, 2, 3].map((L) => towerRow(L, T2)) },
    "set-heart": {
      label: "Heart Tree and props",
      rows: [[[0, 1, 2].map((h) => ["ms_heart", { hurt: h }, "heart" + h]), -1.2, [-3.8, 0, 3.8]], [["rift", "glowcap", "lamp", "stone", "kodama"].map((n) => ["ms_" + n, {}, n]), 2.6, [-3.6, -1.8, 0, 1.8, 3.6]]],
    },
    "set-enemies": { label: "Enemies", rows: [[["grub", "beetle", "moth", "golem", "spirit"].map((n) => ["ms_" + n, {}, n]), 0.4, [-4.2, -2.2, -0.2, 1.8, 4.2]]], zoom: { spirit: 3.4 } },
    "set-enemies2": { label: "The mould creatures", rows: [[["snail", "bloat", "mite", "mender"].map((n) => ["ms_" + n, {}, n]), 1.6, [-3.6, -1.2, 1.2, 3.6]], [["midge", "mole", "lichen", "mother"].map((n) => ["ms_" + n, {}, n]), -1.4, [-3.6, -1.2, 1.2, 3.8]]], zoom: { mother: 3.4 } },
    "set-bestiary": { label: "The blight creatures", rows: [[BESTIARY.map((n) => ["ms_" + n, {}, n]), 0.4, [0]]] },
    // each creature's flipbook frame by frame (a still deco plays frame floor((t * 1.1 + o.t) % 1 * n), so o.t = k / n shows
    // frame k at the shots' frozen t): shots a-<name>0 .. a-<name>3, left to right in the creature's row
    "set-bestiary-frames": { label: "The blight creatures, frame by frame", rows: BESTIARY.map((n, r) => [[0, 1, 2, 3].map((k) => ["ms_" + n, { t: k / 4 }, n + k]), 0.4 + 1.6 * r, [-1.35, -0.45, 0.45, 1.35]]) },
    // a mini level on the jar's own path: the Heart Tree at the path's end, towers of each level along it,
    // rifts where the blight comes in, props, and the enemies walking (add &units=N)
    "set-world": {
      label: "Mini level", keepPath: true, jarLight: true, walkers: ENEMY_WALK,
      deco: [
        ["ms_heart", {}, 6, 6], ["ms_rift", {}, 13, 9], ["ms_rift", {}, 0, 5],
        ["ms_thorn", { lv: 3 }, 11, 9], ["ms_sun", { lv: 2 }, 8, 8], ["ms_puff", { lv: 1 }, 10, 6], ["ms_wisp", { lv: 3 }, 2, 6],
        ["ms_thorn", { lv: 1 }, 1, 3], ["ms_sun", { lv: 3 }, 4, 5], ["ms_puff", { lv: 2 }, 12, 7], ["ms_wisp", { lv: 1 }, 5, 3],
        ["ms_lamp", {}, 6, 8], ["ms_lamp", {}, 2, 3], ["ms_lamp", {}, 10, 9], ["ms_glowcap", {}, 9, 10], ["ms_glowcap", {}, 4, 8], ["ms_glowcap", {}, 11, 5],
        ["ms_stone", {}, 5, 10], ["ms_stone", {}, 8, 3], ["ms_kodama", {}, 8, 4], ["ms_kodama", {}, 3, 9],
      ],
      cams: { w1: [9.5, 8, 1.4, 3.2], w2: [3.5, 5, 1.4, 3.2] },
    },
  });
})();
