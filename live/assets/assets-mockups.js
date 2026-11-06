/* Voxel asset mockups for Mossheart: the same eight game assets (Heart Tree, the four plant towers, three
   creatures) in three themes, shown by ?gallery=<theme> as a lineup in a small mossy bell jar.
     koke    Koke Garden   living plants and soft garden bugs, the current scene's language
     shrine  Shrine Craft  towers as crafted shrine objects (lanterns, mirror), creatures as playful yokai
     hotaru  Hotaru Spirit bioluminescent spirit plants, blight-corrupted creatures with glowing veins
     toy     Toy Block     Koke Garden voxelised at half density and drawn back up (chunky look)
     spirit  Spirit Shrine Shrine Craft towers with the Hotaru Spirit Heart Tree and enemies
   Same conventions as the generator's models: tile units, anchor at the ground centre, Z up, facing +X,
   chibi faces painted toward the viewer. Gallery shots: g (whole jar), l (lineup), a-<kind> (one asset close up, e.g. a-heart). */
(function () {
  const ME = window.ME, { S, E, C, B, Y, M, TAU, add, mul, lerp3, norm, rx, rz, rmul, orient, near, nz3, cface, mossPad, stoneMoss, larva, lantern, kodama, kodamaFace, model } = ME.assetKit;

  // ================================================================ A · Koke Garden
  M.kg_heart = () => {
    const p = [C([0, 0, -0.05], [0.04, 0.02, 0.95], 0.27, 0.15, "kgBark", { k2: 0.1 })];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; p.push(C([Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.2], [Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.02], 0.1, 0.035, "kgBark", { k2: 0.06 })); }
    for (const l of [[0.5, 0.15, 1.35], [-0.45, 0.25, 1.3], [0.05, -0.5, 1.32], [-0.1, 0.1, 1.55]]) p.push(C([0.03, 0.02, 0.85], l, 0.11, 0.05, "kgBark", { k2: 0.05 }));
    for (const [x, y, z, r] of [[0, 0, 1.62, 0.48], [0.48, 0.18, 1.42, 0.36], [-0.46, 0.26, 1.4, 0.36], [0.08, -0.5, 1.42, 0.34], [-0.22, -0.28, 1.76, 0.3], [0.3, 0.3, 1.78, 0.3], [0.42, -0.3, 1.6, 0.28], [-0.4, -0.1, 1.62, 0.3]])
      p.push(S([x, y, z], r, "kgLeaf", { k2: 0.12 }));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; p.push(S([Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0.52 + Math.sin(a * 3) * 0.008], 0.042, "kgRope", { k2: 0.015 })); }
    for (const a of [0.35, 0.8, 1.25]) for (let j = 0; j < 3; j++) { const c = [Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.45 - j * 0.045]; p.push(B(add(c, [Math.cos(a + 1.57) * (j % 2 ? 0.015 : -0.015), Math.sin(a + 1.57) * (j % 2 ? 0.015 : -0.015), 0]), [0.008, 0.03, 0.022], 0.003, "kgPaper", { R: rz(a) })); }
    p.push(E([0.13, 0.13, 0.76], [0.07, 0.07, 0.085], "kgHeart"));
    return {
      prims: p, r: 0.95, h: 2.1, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgLeaf") return nz > 0.3 && nz3(x, y, z, 7, 4) > 0.5 ? "kgLeafLt" : m;
        if (m === "kgBark" && nz > 0.4 && nz3(x, y, z, 9, 3) > 0.45) return "moss";
        return m;
      },
    };
  };

  M.kg_thorn = () => {
    const p = [mossPad(0.3), C([0, 0, 0.04], [0, 0, 0.7], 0.032, 0.022, "kgStem")], stems = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4, mid = [Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.3], top = [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.55 + 0.1 * (i % 2)];
      p.push(C([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.03], mid, 0.034, 0.027, "kgStem", { k2: 0.02 }), C(mid, top, 0.027, 0.017, "kgStem", { k2: 0.015 }));
      p.push(E(add(top, [0, 0, 0.035]), [0.032, 0.032, 0.048], "kgRose"));
      stems.push([mid, top, a]);
    }
    for (const [mid, top, a] of stems) {
      for (let k = 0; k < 4; k++) { const q = lerp3([mid[0] * 0.4, mid[1] * 0.4, 0.06], top, 0.25 + k * 0.22), o = norm([Math.cos(a + k * 1.9), Math.sin(a + k * 1.9), 0.4]); p.push(C(q, add(q, mul(o, 0.075)), 0.014, 0.001, "kgThorn")); }
      const lq = lerp3(mid, top, 0.4), ld = norm([Math.cos(a + 0.8), Math.sin(a + 0.8), 0.2]);
      p.push(E(add(lq, mul(ld, 0.055)), [0.055, 0.026, 0.008], "kgLeaf", { R: orient([0, 0, 1], ld) }));
    }
    const bc = [0, 0, 0.78];
    p.push(S(bc, 0.07, "kgRose", { k2: 0.02 }));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, d = [Math.cos(a), Math.sin(a), 0]; p.push(E(add(bc, mul(d, 0.075)), [0.065, 0.052, 0.014], "kgRoseLt", { R: orient(norm([d[0], d[1], 0.9]), d) })); }
    return { prims: p, r: 0.36, h: 0.9, k: 1 };
  };

  M.kg_sun = () => {
    const hc = [0.05, 0.05, 0.84], n = norm([0.55, 0.55, 0.62]), R = orient(n), u = R.slice(0, 3), v = R.slice(3, 6);
    const p = [mossPad(0.28), C([0, 0, 0], [0.01, 0.01, 0.45], 0.042, 0.036, "kgStem", { k2: 0.02 }), C([0.01, 0.01, 0.45], add(hc, mul(n, -0.06)), 0.036, 0.03, "kgStem", { k2: 0.02 })];
    for (const [a, z, L] of [[2.2, 0.22, 0.17], [-0.6, 0.36, 0.15], [3.6, 0.5, 0.12]]) { const d = [Math.cos(a), Math.sin(a), 0.25]; p.push(E(add([0, 0, z], mul(norm(d), L)), [L, L * 0.42, 0.012], "kgLeaf", { R: orient([0, 0, 1], d) })); }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
      p.push(E(add(hc, mul(d, 0.21)), [0.1, 0.042, 0.014], "kgPetal", { R: orient(n, d) }));
      const a2 = a + TAU / 28, d2 = add(mul(u, Math.cos(a2)), mul(v, Math.sin(a2)));
      p.push(E(add(add(hc, mul(n, -0.022)), mul(d2, 0.19)), [0.09, 0.04, 0.012], "kgPetalDk", { R: orient(n, d2) }));
    }
    p.push(Y(hc, 0.14, 0.032, "kgBrass", { R }), Y(add(hc, mul(n, 0.014)), 0.115, 0.03, "kgLens", { R }));
    return { prims: p, r: 0.36, h: 1.08, k: 1 };
  };

  M.kg_puff = () => {
    const hc = [0, 0, 0.18], p = [mossPad(0.32), E([0, 0, 0.2], [0.14, 0.14, 0.2], "kgStalk", { k2: 0.04 }), E([0, 0, 0.5], [0.34, 0.34, 0.17], "kgCap", { k2: 0.04 }), E([0, 0, 0.42], [0.3, 0.3, 0.05], "kgGill")];
    for (const [x, y, s] of [[-0.24, 0.2, 1], [0.22, -0.24, 0.75]]) p.push(E([x, y, 0.06 * s], [0.04 * s, 0.04 * s, 0.07 * s], "kgStalk"), E([x, y, 0.13 * s], [0.09 * s, 0.09 * s, 0.05 * s], "kgCap", { k2: 0.01 }));
    for (const [x, y, z, r] of [[0.05, -0.08, 0.78, 0.04], [-0.1, 0.06, 0.88, 0.03], [0.09, 0.1, 0.96, 0.022]]) p.push(S([x, y, z], r, "kgSpore"));
    return {
      prims: p, r: 0.4, h: 1.0, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "kgCap" && nz > 0.1 && nz3(x, y, z, 9, 8) > 0.66) return "kgSpot";
        if (m === "kgStalk" && z < 0.4 && Math.hypot(x, y) < 0.2) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.14, { ex: 0.4, ey: 0.02, er: 0.26, blush: true, mouth: [0, -0.42, 0.1] }) || m;
        return m;
      },
    };
  };

  M.kg_wisp = () => {
    const p = [mossPad(0.3), C([0, 0, 0], [0.06, 0.02, 0.35], 0.1, 0.075, "kgBark", { k2: 0.05 }), C([0.06, 0.02, 0.35], [0, 0, 0.68], 0.075, 0.06, "kgBark", { k2: 0.04 })];
    for (const a of [0.5, 2.6, 4.4]) p.push(C([0, 0, 0.12], [Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.0], 0.05, 0.025, "kgBark", { k2: 0.03 }));
    p.push(E([0, 0, 0.78], [0.28, 0.28, 0.15], "kgWillow", { k2: 0.06 }), S([0, 0, 0.88], 0.17, "kgWillow", { k2: 0.05 }));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + 0.1, cs = Math.cos(a), sn = Math.sin(a), top = [cs * 0.25, sn * 0.25, 0.76], mid = [cs * 0.33, sn * 0.33, 0.6], bot = [cs * 0.35, sn * 0.35, 0.3 + 0.07 * (i % 3)];
      p.push(C(top, mid, 0.04, 0.03, "kgWillow", { k2: 0.02 }), C(mid, bot, 0.03, 0.014, "kgWillowLt"));
    }
    for (const [a, z] of [[0.45, 0.48], [1.15, 0.4], [-0.25, 0.42], [2.0, 0.52]]) p.push(C([Math.cos(a) * 0.4, Math.sin(a) * 0.4, z + 0.12], [Math.cos(a) * 0.4, Math.sin(a) * 0.4, z + 0.05], 0.006, 0.006, "kgStem"), S([Math.cos(a) * 0.4, Math.sin(a) * 0.4, z], 0.045, "kgOrb"));
    p.push(S([0.05, 0.05, 1.16], 0.07, "kgOrb"), C([0.05, 0.05, 1.16], [0.0, 0.0, 1.3], 0.05, 0.005, "kgOrb"));
    return { prims: p, r: 0.46, h: 1.35, k: 1 };
  };

  M.kg_grub = () => {
    const L = larva("kgGrub", "kgGrubHead");
    return {
      prims: L.p, r: 0.38, h: 0.3, k: 1,
      detail: (x, y, z, m) => {
        if (m !== "kgGrub") return m;
        if (near([x, y, z], L.hc, L.hr * 1.1)) return cface([x - L.hc[0], y - L.hc[1], z - L.hc[2]], L.hr, { ex: 0.42, ey: 0.12, er: 0.26, blush: true }) || m;
        if (L.bounds.some((b) => Math.abs(x - b) < 0.011)) return "kgGrubDk";
        return nz3(x, y, z, 14, 6) > 0.72 ? "kgRot" : m;
      },
    };
  };

  M.kg_moth = () => {
    const z0 = 0.45, hc = [0.17, 0, z0 + 0.04], p = [E([-0.03, 0, z0], [0.14, 0.075, 0.08], "kgMothFur", { k2: 0.03 }), S([0.07, 0, z0 + 0.03], 0.085, "kgMothFur", { k2: 0.03 }), S(hc, 0.1, "kgMothFur", { k2: 0.03 })];
    for (const sd of [-1, 1]) {
      p.push(E([0.02, sd * 0.19, z0 + 0.1], [0.14, 0.2, 0.024], "kgMothWing", { R: rx(sd * 0.45) }), E([-0.09, sd * 0.15, z0 + 0.04], [0.1, 0.14, 0.022], "kgMothWing", { R: rx(sd * 0.55) }));
      const a0 = add(hc, [0.03, sd * 0.04, 0.08]), a1 = add(hc, [0.1, sd * 0.13, 0.2]);
      p.push(C(a0, a1, 0.008, 0.006, "kgMothDk"));
      for (let k = 1; k < 5; k++) { const q = lerp3(a0, a1, k / 5); p.push(E(q, [0.012, 0.03 * (1 - k / 7), 0.006], "kgMothDk", { R: rz(sd * 0.6) })); }
    }
    return {
      prims: p, r: 0.42, h: 0.72, k: 1,
      detail: (x, y, z, m) => {
        if (m === "kgMothFur" && near([x, y, z], hc, 0.11)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.1, { ex: 0.45, ey: 0.1, er: 0.3 }) || m;
        if (m === "kgMothWing") {
          const ay = Math.abs(y);
          if (ay > 0.27) return "kgMothDk";
          const d = Math.hypot(x - 0.04, ay - 0.2);
          if (d < 0.055) return d < 0.025 ? "kgMothFur" : "kgEyeSpot";
        }
        return m;
      },
    };
  };

  M.kg_golem = () => {
    // boulder body, a separate small head sunk between the shoulders, long arms with knuckles on the ground
    const hc = [0.14, 0.02, 0.66], p = [
      E([-0.02, 0, 0.38], [0.24, 0.27, 0.25], "kgStone", { k2: 0.03 }), S([-0.04, 0, 0.56], 0.2, "kgStone", { k2: 0.06 }), S(hc, 0.13, "kgStone", { k2: 0.02 }),
      E([-0.06, 0, 0.72], [0.17, 0.19, 0.06], "moss", { k2: 0.04 }), C([-0.08, 0.02, 0.76], [-0.06, 0.04, 0.92], 0.014, 0.009, "kgStem"),
      E([-0.01, 0.08, 0.93], [0.06, 0.026, 0.009], "kgLeafLt", { R: rz(0.8) }), E([-0.09, -0.02, 0.92], [0.055, 0.024, 0.009], "kgLeafLt", { R: rz(-0.6) }),
    ];
    for (const sd of [-1, 1]) {
      p.push(S([-0.02, sd * 0.13, 0.08], 0.09, "kgStoneDk", { k2: 0.02 }));
      p.push(S([0, sd * 0.3, 0.5], 0.1, "kgStone", { k2: 0.03 }), C([0.02, sd * 0.33, 0.48], [0.1, sd * 0.36, 0.16], 0.075, 0.065, "kgStone", { k2: 0.02 }), S([0.12, sd * 0.36, 0.09], 0.085, "kgStoneDk", { k2: 0.02 }));
      p.push(E([-0.01, sd * 0.3, 0.58], [0.08, 0.08, 0.035], "moss", { k2: 0.03 }));
    }
    const sm = stoneMoss("kgStone", 9, 0.55);
    const face = (x, y, z) => (near([x, y, z], hc, 0.15) ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.13, { ex: 0.36, ey: 0.02, er: 0.2, eye: "kgGolemEye", hi: false }) : null);
    return { prims: p, r: 0.46, h: 0.98, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "kgStone" && face(x, y, z)) || sm(x, y, z, m, nx, ny, nz) || (m === "kgStone" && nz3(x, y, z, 16, 5) > 0.74 ? "kgStoneDk" : m) };
  };

  // ================================================================ B · Shrine Craft
  M.sc_heart = () => {
    const p = [B([0, 0, 0.06], [0.5, 0.5, 0.06], 0.02, "scStone"), B([0, 0, 0.16], [0.38, 0.38, 0.05], 0.02, "scStone")];
    for (let i = 0; i < 12; i++) { const t = (i / 12) * 4, s = Math.floor(t), f = t - s, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]], a = c[s], b = c[(s + 1) % 4]; p.push(Y([(a[0] + (b[0] - a[0]) * f) * 0.45, (a[1] + (b[1] - a[1]) * f) * 0.45, 0.2], 0.022, 0.08, "scLacquer")); }
    p.push(C([0, 0, 0.18], [0.08, -0.04, 0.7], 0.17, 0.12, "kgBark", { k2: 0.08 }), C([0.08, -0.04, 0.7], [-0.04, 0.05, 1.18], 0.12, 0.07, "kgBark", { k2: 0.06 }));
    const pads = [[0.45, 0.1, 1.0, 0.3], [-0.38, 0.3, 1.18, 0.3], [0.1, -0.42, 1.3, 0.28], [0, 0.05, 1.58, 0.26], [0.32, 0.36, 1.42, 0.24]];
    for (const [x, y, z, r] of pads) p.push(C([x * 0.2, y * 0.2, z - 0.25], [x, y, z - 0.04], 0.045, 0.03, "kgBark", { k2: 0.02 }), E([x, y, z], [r, r, r * 0.4], "scPine", { k2: 0.05 }));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; p.push(S([Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.5], 0.055, "kgRope", { k2: 0.02 })); }
    for (const a of [0.45, 0.95, 1.45, 3.6]) for (let j = 0; j < 4; j++) { const c = [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.42 - j * 0.045]; p.push(B(add(c, [Math.cos(a + 1.57) * (j % 2 ? 0.016 : -0.016), Math.sin(a + 1.57) * (j % 2 ? 0.016 : -0.016), 0]), [0.008, 0.03, 0.022], 0.003, "kgPaper", { R: rz(a) })); }
    const sm = stoneMoss("scStone", 8, 0.6);
    return { prims: p, r: 0.9, h: 1.85, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || (m === "scPine" && nz > 0.4 && nz3(x, y, z, 8, 4) > 0.5 ? "scPineLt" : m) };
  };

  M.sc_thorn = () => {
    const p = lantern("scLitGreen");
    let prev = null;
    for (let i = 0; i <= 22; i++) {
      const t = i / 22, a = t * TAU * 2.1 + 0.6, r = (t < 0.6 ? 0.1 : t < 0.75 ? 0.2 : 0.15) + 0.03 * Math.sin(i * 1.7), q = [Math.cos(a) * r, Math.sin(a) * r, 0.06 + t * 0.78];
      if (prev) p.push(C(prev, q, 0.026, 0.024, "kgStem", { k2: 0.01 }));
      if (i % 2) p.push(C(q, add(q, mul(norm([Math.cos(a + 0.6), Math.sin(a + 0.6), 0.5]), 0.07)), 0.013, 0.001, "kgThorn"));
      if (i % 5 === 3) p.push(E(add(q, mul([Math.cos(a), Math.sin(a), 0], 0.035)), [0.035, 0.035, 0.04], "scRose", { k2: 0.01 }));
      prev = q;
    }
    const sm = stoneMoss("scStone", 10, 0.55);
    return { prims: p, r: 0.34, h: 0.95, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || m };
  };

  M.sc_sun = () => {
    const c = [0, 0, 0.44], n = norm([0.707, 0.707, 0.12]), R = orient(n), u = R.slice(0, 3), v = R.slice(3, 6);
    const p = [B([0, 0, 0.04], [0.14, 0.32, 0.04], 0.015, "scLacquer")];
    for (const sd of [-1, 1]) p.push(Y([0, sd * 0.28, 0.38], 0.025, 0.32, "scLacquer"), S([0, sd * 0.28, 0.72], 0.035, "scGold"), C([0, sd * 0.24, 0.64], [0.02, sd * 0.2, 0.5], 0.006, 0.006, "scLacquer"), S([0.02, sd * 0.2, 0.48], 0.022, "scGold"));
    p.push(B([0, 0, 0.66], [0.035, 0.34, 0.025], 0.01, "scLacquer"), C([0, -0.36, 0.69], [0, -0.42, 0.74], 0.025, 0.02, "scLacquer"), C([0, 0.36, 0.69], [0, 0.42, 0.74], 0.025, 0.02, "scLacquer"));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))); p.push(B(add(add(c, mul(n, -0.035)), mul(d, 0.25)), [0.055, 0.012, 0.008], 0.004, "scGold", { R: orient(n, d) })); }
    p.push(Y(c, 0.19, 0.028, "scBronze", { R }), Y(add(c, mul(n, 0.012)), 0.16, 0.025, "scMirror", { R }));
    return { prims: p, r: 0.46, h: 0.8, k: 1 };
  };

  M.sc_puff = () => {
    const p = [];
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; p.push(C([Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.0], [Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.16], 0.035, 0.032, "scStone", { k2: 0.02 }), C([Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.16], [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.28], 0.032, 0.03, "scStone", { k2: 0.02 })); }
    p.push(B([0, 0, 0.3], [0.1, 0.1, 0.02], 0.01, "scStone"), Y([0, 0, 0.38], 0.1, 0.07, "scStone"), B([0.1, 0, 0.38], [0.012, 0.045, 0.04], 0, "scLitViolet"), B([0, 0.1, 0.38], [0.045, 0.012, 0.04], 0, "scLitViolet"));
    p.push(E([0, 0, 0.53], [0.36, 0.36, 0.12], "scGlaze", { k2: 0.03 }), E([0, 0, 0.47], [0.3, 0.3, 0.035], "scStone"), S([0, 0, 0.65], 0.05, "scGlaze"));
    for (const [x, y, z, r] of [[0.2, 0.16, 0.42, 0.03], [0.26, 0.24, 0.56, 0.024], [0.22, 0.32, 0.7, 0.018]]) p.push(S([x, y, z], r, "kgSpore"));
    return { prims: p, r: 0.4, h: 0.78, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "scGlaze" && nz > 0.2 && nz3(x, y, z, 9, 8) > 0.67 ? "kgSpot" : stoneMoss("scStone", 10, 0.6)(x, y, z, m, nx, ny, nz) || m) };
  };

  M.sc_wisp = () => {
    const lc = [0.13, 0, 0.6], p = [Y([-0.15, 0, 0.03], 0.12, 0.03, "scStone", { round: 0.015 }), C([-0.15, 0, 0.0], [-0.14, 0.02, 0.82], 0.04, 0.032, "scWood", { k2: 0.01 }), C([-0.14, 0.02, 0.82], [0.13, 0, 0.94], 0.03, 0.022, "scWood", { k2: 0.01 })];
    p.push(C([0.13, 0, 0.94], [0.13, 0, 0.8], 0.006, 0.006, "scBlack"), E(lc, [0.13, 0.13, 0.17], "scPaperLit"), Y(add(lc, [0, 0, 0.165]), 0.075, 0.02, "scBlack"), Y(add(lc, [0, 0, -0.165]), 0.075, 0.02, "scBlack"));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, b = [-0.14, 0.02, 0.84], m = add(b, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.02]); p.push(C(b, m, 0.022, 0.018, "kgWillow"), C(m, add(m, [Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.3 - 0.05 * (i % 2)]), 0.018, 0.01, "kgWillowLt")); }
    return { prims: p, r: 0.36, h: 1.0, k: 1, detail: (x, y, z, m) => (m === "scPaperLit" && Math.abs(((z - lc[2]) / 0.048) % 1) < 0.14 ? "scBlack" : m) };
  };

  M.sc_grub = () => {
    const L = larva("kgGrub", "kgGrubHead"), mc = add(L.hc, [0.085, 0.03, 0.01]);
    L.p.push(E(mc, [0.06, 0.13, 0.13], "scLacquer", { k2: 0.01, R: rz(0.6) }));
    for (const sd of [-1, 1]) L.p.push(C(add(mc, [-0.03, sd * 0.07, 0.09]), add(mc, [-0.05, sd * 0.11, 0.2]), 0.024, 0.004, "scGold"));
    return {
      prims: L.p, r: 0.38, h: 0.32, k: 1,
      detail: (x, y, z, m) => {
        if (m === "scLacquer") { const dy = Math.abs(y) - 0.032, dz = z - mc[2] - 0.02; if (dy * dy + dz * dz < 0.016 ** 2) return "scGold"; if (Math.abs(y) < 0.03 && Math.abs(z - mc[2] + 0.04) < 0.008) return "scBlack"; return m; }
        if (m === "kgGrub" && L.bounds.some((b) => Math.abs(x - b) < 0.011)) return "kgGrubDk";
        return m;
      },
    };
  };

  M.sc_moth = () => {
    const z0 = 0.5, p = [C([-0.13, 0, z0], [0.15, 0, z0 + 0.01], 0.032, 0.026, "scIndigo"), S([0.17, 0, z0 + 0.015], 0.04, "scIndigo")];
    for (const sd of [-1, 1]) {
      p.push(B([0.02, sd * 0.17, z0 + 0.06], [0.11, 0.11, 0.006], 0, "scPaper", { R: rmul(rz(sd * 0.785 + 0.15 * sd), rx(sd * 0.45)) }));
      p.push(B([-0.1, sd * 0.13, z0 + 0.03], [0.08, 0.08, 0.006], 0, "scPaper", { R: rmul(rz(sd * 0.785 - 0.3 * sd), rx(sd * 0.3)) }));
      p.push(C([0.19, sd * 0.015, z0 + 0.04], [0.26, sd * 0.08, z0 + 0.14], 0.006, 0.004, "scIndigo"));
    }
    return {
      prims: p, r: 0.4, h: 0.68, k: 1,
      detail: (x, y, z, m) => {
        if (m !== "scPaper") return m;
        const ay = Math.abs(y);
        if (Math.hypot(x - 0.08, ay - 0.24) < 0.035) return "scLacquer";
        if (Math.abs(x - (ay - 0.02) * 0.9 + 0.02) < 0.006) return "scIndigo"; // the fold line
        return nz3(x, y, z, 30, 9) > 0.78 ? "scIndigo" : m;
      },
    };
  };

  M.sc_golem = () => {
    const hc = [0.24, 0, 0.76], p = [E([0, 0, 0.42], [0.26, 0.17, 0.17], "scStone", { k2: 0.06 }), E([0.14, 0, 0.5], [0.15, 0.16, 0.18], "scStone", { k2: 0.06 }), S(hc, 0.16, "scStone", { k2: 0.06 })];
    for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 1.4 - Math.PI * 0.7 + Math.PI, r = 0.15; p.push(S(add(hc, [Math.cos(a) * r * 0.6 - 0.04, Math.sin(a) * r, 0.04 + Math.abs(Math.sin(a)) * 0.02 + (i % 2) * 0.04]), 0.06, "scStone", { k2: 0.02 })); }
    p.push(E([0.38, 0, 0.72], [0.07, 0.09, 0.06], "scStone", { k2: 0.03 }), E([0.4, 0, 0.66], [0.035, 0.065, 0.02], "scBlack"));
    for (const sd of [-1, 1]) {
      p.push(S([0.35, sd * 0.075, 0.82], 0.036, "scGold"));
      for (const fr of [1, -1]) p.push(C([fr * 0.15, sd * 0.1, 0.36], [fr * 0.17, sd * 0.11, 0.06], 0.07, 0.06, "scStone", { k2: 0.03 }), E([fr * 0.17 + 0.03, sd * 0.11, 0.035], [0.075, 0.06, 0.04], "scStone", { k2: 0.02 }));
    }
    for (let k = 0; k < 4; k++) p.push(S([-0.26 - k * 0.03, 0, 0.5 + k * 0.08], 0.07 - k * 0.008, "scStone", { k2: 0.03 }));
    p.push(E([0.22, 0, 0.58], [0.09, 0.2, 0.11], "scBib", { k2: 0.01 }));
    const sm = stoneMoss("scStone", 9, 0.55);
    return { prims: p, r: 0.42, h: 0.95, k: 1, detail: (x, y, z, m, nx, ny, nz) => sm(x, y, z, m, nx, ny, nz) || m };
  };

  // ================================================================ C · Hotaru Spirit

  M.hs_heart = () => {
    const p = [C([0, 0, -0.05], [0.05, -0.03, 1.0], 0.26, 0.13, "hsBark", { k2: 0.1 })];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; p.push(C([Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.22], [Math.cos(a) * 0.55, Math.sin(a) * 0.55, -0.02], 0.1, 0.03, "hsBark", { k2: 0.06 })); }
    for (const l of [[0.48, 0.1, 1.4], [-0.42, 0.3, 1.35], [0.1, -0.48, 1.38], [0, 0.1, 1.62]]) p.push(C([0.03, 0, 0.9], l, 0.1, 0.045, "hsBark", { k2: 0.05 }));
    for (const [x, y, z, r] of [[0, 0, 1.66, 0.46], [0.46, 0.12, 1.45, 0.34], [-0.44, 0.3, 1.42, 0.34], [0.1, -0.46, 1.44, 0.32], [0.3, 0.32, 1.78, 0.28], [-0.3, -0.24, 1.76, 0.28]]) p.push(S([x, y, z], r, "hsLeaf", { k2: 0.12 }));
    for (const [x, y, z] of [[0.62, 0.3, 1.2], [0.2, 0.6, 1.25], [-0.5, 0.52, 1.15], [0.5, -0.4, 1.22], [0.66, -0.05, 1.32], [0.05, 0.4, 1.1]]) p.push(C([x, y, z + 0.14], [x, y, z + 0.04], 0.006, 0.006, "hsStem"), S([x, y, z], 0.05, "hsGlowGold"));
    const heads = [kodama([0.42, 0.2, 0.02], 1.1, p), kodama([0.15, 0.48, 0.0], 0.85, p)];
    const kf = kodamaFace(heads, 1.1);
    return {
      prims: p, r: 0.95, h: 2.1, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "hsKodama") return kf(x, y, z) || m;
        if (m === "hsBark" && Math.abs(Math.sin(z * 22 + nz3(x, y, z, 5, 2) * 6 + Math.atan2(y, x) * 2)) < 0.07 && z < 1.2) return "hsGlowCyan";
        if (m === "hsLeaf" && nz > 0.3 && nz3(x, y, z, 7, 4) > 0.52) return "hsLeafLt";
        return m;
      },
    };
  };

  M.hs_thorn = () => {
    const p = [E([0, 0, 0.02], [0.28, 0.28, 0.06], "hsBarkDk", { k2: 0.03 })];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.2, mid = [Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.3], top = [Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.56 + 0.08 * (i % 2)];
      p.push(C([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.03], mid, 0.032, 0.026, "hsStem", { k2: 0.02 }), C(mid, top, 0.026, 0.016, "hsStem", { k2: 0.015 }));
      for (let k = 0; k < 4; k++) { const q = lerp3([mid[0] * 0.4, mid[1] * 0.4, 0.06], top, 0.25 + k * 0.22), o = norm([Math.cos(a + k * 1.9), Math.sin(a + k * 1.9), 0.45]); p.push(C(q, add(q, mul(o, 0.085)), 0.016, 0.001, "hsGlowLime")); }
    }
    const bc = [0, 0, 0.76];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU, d = norm([Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1]); p.push(E(add(bc, mul(d, 0.08)), [0.035, 0.035, 0.11], "hsCrystal", { R: orient(d, [1, 0, 0]) })); }
    p.push(E(add(bc, [0, 0, 0.06]), [0.04, 0.04, 0.14], "hsCrystal"), S(add(bc, [0, 0, 0.02]), 0.05, "hsGlowLime"));
    return { prims: p, r: 0.36, h: 0.98, k: 1 };
  };

  M.hs_sun = () => {
    const cc = [0.02, 0.02, 0.8], p = [E([0, 0, 0.02], [0.24, 0.24, 0.06], "hsBarkDk", { k2: 0.03 }), C([0, 0, 0], [0.03, -0.02, 0.4], 0.035, 0.028, "hsStem", { k2: 0.02 }), C([0.03, -0.02, 0.4], cc, 0.028, 0.024, "hsStem", { k2: 0.02 })];
    for (const [a, z] of [[1.0, 0.18], [3.8, 0.3]]) { const d = [Math.cos(a), Math.sin(a), 0.5]; p.push(E(add([0, 0, z], mul(norm(d), 0.13)), [0.13, 0.05, 0.012], "hsLeaf", { R: orient([0, 0, 1], d) })); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, d = norm([Math.cos(a), Math.sin(a), 1.4]); p.push(E(add(cc, mul(d, 0.12)), [0.05, 0.035, 0.11], "hsPetal", { R: orient(norm([Math.cos(a), Math.sin(a), -0.5]), d), k2: 0.01 })); }
    p.push(S(add(cc, [0, 0, 0.2]), 0.1, "hsGlowGold"));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; p.push(S(add(cc, [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.2 + Math.sin(a * 2) * 0.06]), 0.02, "hsGlowGold")); }
    return { prims: p, r: 0.34, h: 1.15, k: 1 };
  };

  M.hs_puff = () => {
    const p = [E([0, 0, 0.02], [0.32, 0.32, 0.06], "hsBarkDk", { k2: 0.03 })];
    for (const [x, y, h, r] of [[0.02, 0.02, 0.5, 0.2], [-0.2, 0.14, 0.3, 0.13], [0.18, -0.16, 0.36, 0.14], [-0.06, -0.22, 0.18, 0.09]]) {
      p.push(C([x, y, 0], [x * 0.9, y * 0.9, h], 0.04 * r * 6, 0.03 * r * 6, "hsKodama", { k2: 0.02 }), E([x * 0.9, y * 0.9, h + r * 0.15], [r, r, r * 0.55], "hsCap", { k2: 0.03 }), E([x * 0.9, y * 0.9, h - r * 0.08], [r * 0.85, r * 0.85, r * 0.12], "hsGlowPink"));
    }
    for (const [x, y, z, r] of [[0.1, 0.12, 0.8, 0.025], [-0.12, 0.02, 0.7, 0.02], [0.02, -0.12, 0.88, 0.016]]) p.push(S([x, y, z], r, "hsGlowPink"));
    return { prims: p, r: 0.4, h: 0.92, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "hsCap" && nz > 0.25 && nz3(x, y, z, 11, 8) > 0.7 ? "hsGlowPink" : m) };
  };

  M.hs_wisp = () => {
    const p = [Y([0, 0, 0.14], 0.24, 0.14, "hsBarkDk", { round: 0.04 }), E([0, 0, 0.29], [0.22, 0.22, 0.03], "moss", { k2: 0.03 })];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.4; p.push(C([Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0.1], [Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0], 0.07, 0.03, "hsBarkDk", { k2: 0.04 })); }
    const heads = [kodama([0.06, 0.08, 0.3], 1.0, p), kodama([-0.1, -0.06, 0.3], 0.8, p), kodama([0.14, -0.1, 0.3], 0.7, p)];
    p.push(S([0.0, 0.0, 0.82], 0.075, "hsGlowCyan"), C([0.0, 0.0, 0.82], [-0.02, -0.02, 1.0], 0.06, 0.004, "hsGlowCyan"), S([0.12, 0.12, 0.68], 0.025, "hsGlowCyan"), S([-0.14, 0.06, 0.74], 0.02, "hsGlowCyan"));
    const kf = kodamaFace(heads, 1.0);
    return { prims: p, r: 0.4, h: 1.05, k: 1, detail: (x, y, z, m) => (m === "hsKodama" ? kf(x, y, z) || m : m) };
  };

  M.hs_grub = () => {
    const L = larva("hsBlight", "hsBarkDk");
    for (const [x, r] of [[0.06, 0.03], [-0.05, 0.034], [-0.15, 0.026], [0.12, 0.022], [-0.22, 0.02]]) L.p.push(S([x, 0.02 * Math.sign(x + 0.01), 0.21 - Math.abs(x) * 0.25], r, "hsVein"));
    return {
      prims: L.p, r: 0.38, h: 0.3, k: 1,
      detail: (x, y, z, m) => (m === "hsBlight" && near([x, y, z], L.hc, L.hr * 1.1) ? cface([x - L.hc[0], y - L.hc[1], z - L.hc[2]], L.hr, { ex: 0.42, ey: 0.12, er: 0.2, eye: "hsVein", hi: false }) || m : m),
    };
  };

  M.hs_moth = () => {
    const z0 = 0.45, hc = [0.17, 0, z0 + 0.04], p = [E([-0.03, 0, z0], [0.14, 0.07, 0.075], "hsWingDk", { k2: 0.03 }), S(hc, 0.1, "hsWingDk", { k2: 0.03 })];
    for (const sd of [-1, 1]) {
      p.push(E([0.02, sd * 0.19, z0 + 0.1], [0.14, 0.2, 0.024], "hsWingDk", { R: rx(sd * 0.45) }), E([-0.1, sd * 0.15, z0 + 0.04], [0.1, 0.14, 0.022], "hsWingDk", { R: rx(sd * 0.55) }));
      p.push(C(add(hc, [0.03, sd * 0.04, 0.08]), add(hc, [0.1, sd * 0.13, 0.2]), 0.008, 0.006, "hsWingDk"), S(add(hc, [0.1, sd * 0.13, 0.2]), 0.02, "hsGlowCyan"));
    }
    return {
      prims: p, r: 0.42, h: 0.7, k: 1,
      detail: (x, y, z, m) => {
        if (m !== "hsWingDk") return m;
        if (near([x, y, z], hc, 0.11)) return cface([x - hc[0], y - hc[1], z - hc[2]], 0.1, { ex: 0.45, ey: 0.1, er: 0.28, eye: "hsGlowPink", hi: false }) || m;
        const ay = Math.abs(y);
        if (ay < 0.06) return m;
        const ang = Math.atan2(ay, x + 0.02), d = Math.hypot(x + 0.02, ay);
        if (Math.abs(Math.sin(ang * 9)) < 0.12 && d > 0.1) return "hsGlowCyan";
        if (Math.abs(d - 0.25) < 0.012) return "hsGlowPink";
        return m;
      },
    };
  };

  M.hs_golem = () => {
    // the Koke golem's silhouette in blighted obsidian: crystal shards for moss, a glowing crack for a heart
    const hc = [0.14, 0.02, 0.66], p = [E([-0.02, 0, 0.38], [0.24, 0.27, 0.25], "hsObsidian", { k2: 0.03 }), S([-0.04, 0, 0.56], 0.2, "hsObsidian", { k2: 0.06 }), S(hc, 0.13, "hsObsidian", { k2: 0.02 })];
    for (const sd of [-1, 1]) {
      p.push(S([-0.02, sd * 0.13, 0.08], 0.09, "hsObsidian", { k2: 0.02 }), S([0, sd * 0.3, 0.5], 0.1, "hsObsidian", { k2: 0.03 }), C([0.02, sd * 0.33, 0.48], [0.1, sd * 0.36, 0.16], 0.075, 0.065, "hsObsidian", { k2: 0.02 }), S([0.12, sd * 0.36, 0.09], 0.085, "hsObsidian", { k2: 0.02 }));
      p.push(C([-0.04, sd * 0.28, 0.56], [-0.1, sd * 0.36, 0.78], 0.045, 0.005, "hsCrystal"), C([-0.1, sd * 0.1, 0.7], [-0.16, sd * 0.14, 0.9], 0.04, 0.004, "hsCrystal"));
    }
    p.push(E([0.2, 0.06, 0.4], [0.04, 0.07, 0.08], "hsVein", { R: rz(0.7) }));
    const face = (x, y, z) => (near([x, y, z], hc, 0.15) ? cface([x - hc[0], y - hc[1], z - hc[2]], 0.13, { ex: 0.36, ey: 0.02, er: 0.2, eye: "hsVein", hi: false }) : null);
    return { prims: p, r: 0.46, h: 0.95, k: 1, detail: (x, y, z, m) => (m === "hsObsidian" ? face(x, y, z) || (Math.abs(nz3(x, y, z, 7, 5) - 0.5) < 0.025 ? "hsVein" : m) : m) };
  };

  // ---------------------------------------------------------------- gallery
  // world scale per kind (same range as the generator's towers and units, k 1.6..2.2)
  const K = { heart: 1.45, thorn: 1.9, sun: 1.9, puff: 1.9, wisp: 1.9, grub: 2.0, moth: 2.0, golem: 1.9 };
  for (const k of Object.keys(M)) { const m = /^(kg|sc|hs)_([a-z]+)$/.exec(k); if (m) model(k, K[m[2]], M[k]); }
  // back row: towers around the Heart Tree; front row: the creatures. mix takes a per-kind prefix
  const theme = (label, prefix, o = {}, mix = {}) => {
    const it = (n) => [(mix[n] || prefix) + "_" + n, o, n];
    return { label, rows: [[["thorn", "puff", "heart", "sun", "wisp"].map(it), -1.3, [-4.4, -2.5, 0, 2.5, 4.4]], [["grub", "golem", "moth"].map(it), 1.7, [-2.5, 0, 2.5]]], zoom: { heart: 3.0, grub: 6.5, moth: 6, golem: 5 } };
  };
  Object.assign(ME.ASSET_THEMES, {
    koke: theme("A · Koke Garden", "kg"),
    shrine: theme("B · Shrine Craft", "sc"),
    hotaru: theme("C · Hotaru Spirit", "hs"),
    toy: theme("D · Toy Block", "kg", { chunk: 2 }),
    // Shrine Craft towers guarding the Hotaru Spirit tree against its blight
    spirit: theme("E · Spirit Shrine", "hs", {}, { thorn: "sc", sun: "sc", puff: "sc", wisp: "sc" }),
  });
})();
