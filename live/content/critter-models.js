/* Critter models for the ambient wildlife (critters.js) and the ground lanterns. Same conventions as the
   generator's models: tile units, anchor at the ground centre, Z up, facing +X, animation phase o.t.
   Critters are baked at o.fine x the voxel density and drawn scaled back down, so bodies a few tenths
   of a tile long keep their shape. ME.content.critters lists the flipbooks the model bake produces, and
   ME.content.addMaterials(st) adds their ramps to a style. */
(function () {
  const ME = window.ME, P = window.PX, { S, E, C, B, Y } = P.prim, TAU = Math.PI * 2, M = window.MODELS;
  const rx = (a) => P.rot("x", a);
  const pitch = (a) => P.rot("y", -a); // raises the +x end of a prim by a
  const near = (x, y, z, c, r) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < r * r;
  // a flat wing of length L hinged on the body axis at (x, 0, z), raised by angle a on side sd
  const wing = (x, z, sd, a, L, w, m) => E([x, sd * Math.cos(a) * L * 0.5, z + Math.sin(a) * L * 0.5], [w, L * 0.5, 0.01], m, { R: rx(sd * a) });

  M.squirrel = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, p = [], sit = o.pose === "sit";
    let hc;
    if (sit) {
      // upright, nibbling a nut held in the fore paws, tail curled up the back
      const nib = Math.sin(ph * 2) * 0.006;
      hc = [0.035, 0, 0.245 + nib];
      p.push(E([-0.01, 0, 0.125], [0.062, 0.058, 0.095], "squirrel", { k2: 0.03 }), E([-0.015, 0, 0.05], [0.07, 0.07, 0.05], "squirrel", { k2: 0.03 }));
      for (const sd of [-1, 1]) {
        p.push(C([0.03, sd * 0.03, 0.15], [0.07, sd * 0.012, 0.19 + nib], 0.014, 0.011, "squirrel"));
        p.push(E([0.03, sd * 0.045, 0.012], [0.04, 0.02, 0.012], "squirrel"));
      }
      p.push(S([0.082, 0, 0.195 + nib], 0.02, "acorn"));
      [[-0.07, 0.06, 0.035], [-0.13, 0.12, 0.05], [-0.15, 0.21, 0.06], [-0.12, 0.3, 0.058], [-0.07, 0.34, 0.045]].forEach(([x, z, r], k) => p.push(S([x + Math.sin(ph + k) * 0.004, 0, z], r, "squirrelTail", { k2: 0.04 })));
    } else {
      // bounding run: front paws reach while the hind legs push, back stretching and bunching
      const s = Math.sin(ph), c = Math.cos(ph), z0 = 0.1 + Math.abs(s) * 0.035, st = 1 + 0.18 * c;
      hc = [0.12 * st + 0.02, 0, z0 + 0.045];
      p.push(E([0, 0, z0], [0.11 * st, 0.058, 0.06 - 0.008 * c], "squirrel", { k2: 0.03 }));
      for (const sd of [-1, 1]) {
        p.push(C([0.07 * st, sd * 0.032, z0 - 0.02], [0.07 * st + 0.05 * c + 0.02, sd * 0.034, Math.max(0.008, 0.01 + 0.04 * s)], 0.014, 0.01, "squirrel"));
        p.push(E([-0.07 * st, sd * 0.04, z0 - 0.005], [0.05, 0.028, 0.045], "squirrel", { k2: 0.02 }));
        p.push(C([-0.07 * st, sd * 0.04, z0 - 0.03], [-0.07 * st - 0.05 * c, sd * 0.04, Math.max(0.008, 0.01 - 0.04 * s)], 0.016, 0.01, "squirrel"));
      }
      for (let k = 0; k < 5; k++) {
        const u = k / 4, x = -0.11 * st - 0.05 - u * 0.15 + u * u * 0.06, z = z0 + 0.03 + u * 0.16 + Math.sin(ph - k * 0.9) * 0.025;
        p.push(S([x, 0, z], 0.032 + 0.028 * Math.sin(u * Math.PI * 0.9), "squirrelTail", { k2: 0.04 }));
      }
    }
    p.push(S(hc, 0.05, "squirrel", { k2: 0.02 }), E([hc[0] + 0.045, 0, hc[2] - 0.012], [0.03, 0.026, 0.024], "squirrel", { k2: 0.015 }));
    for (const sd of [-1, 1]) {
      p.push(C([hc[0] - 0.01, sd * 0.026, hc[2] + 0.035], [hc[0] - 0.025, sd * 0.032, hc[2] + 0.085], 0.014, 0.004, "squirrel"));
      p.push(S([hc[0] + 0.03, sd * 0.032, hc[2] + 0.012], 0.011, "void"));
    }
    return {
      prims: p, r: 0.3, h: 0.42, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m === "squirrel" && (nz < -0.35 || (sit && nx > 0.55 && z > 0.05 && z < 0.21))) return "squirrelLight";
        if (m === "squirrelTail" && P.noise(x * 60, y * 60, z * 60, 5) > 0.66) return "squirrel";
        return m;
      },
    };
  };

  // o.col "robin" (brown, orange face and breast) or "tit" (green back, blue cap and wings, yellow breast)
  M.songbird = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, pose = o.pose || "stand", tit = o.col === "tit", p = [];
    const back = tit ? "titGreen" : "birdBody", wm = tit ? "titBlue" : "birdWing";
    let bc, hc, fwd;
    if (pose === "fly") {
      bc = [0, 0, 0.13]; hc = [0.078, 0, 0.15]; fwd = [1, 0, -0.1];
      p.push(E(bc, [0.075, 0.048, 0.048], back, { k2: 0.03 }), E([-0.1, 0, 0.135], [0.05, 0.034, 0.008], wm));
      const a = 0.15 + Math.sin(ph) * 1.0;
      for (const sd of [-1, 1]) p.push(wing(-0.005, 0.14, sd, a, 0.13, 0.042, wm));
    } else {
      const peck = pose === "peck";
      bc = peck ? [0.012, 0, 0.082] : [0, 0, 0.09];
      hc = peck ? [0.085, 0, 0.06] : [0.06, 0, 0.145];
      fwd = peck ? [0.6, 0, -0.8] : [1, 0, -0.1];
      p.push(E(bc, [0.072, 0.052, 0.056], back, { k2: 0.03, R: pitch(peck ? -0.45 : 0.2) }));
      for (const sd of [-1, 1]) {
        p.push(E([bc[0] - 0.012, sd * 0.045, bc[2] + 0.01], [0.055, 0.012, 0.03], wm, { R: pitch(peck ? -0.4 : 0.25) }));
        p.push(C([0, sd * 0.018, 0.04], [0.01, sd * 0.02, 0], 0.006, 0.005, "birdLeg"));
      }
      p.push(E([-0.09, 0, peck ? 0.13 : 0.1], [0.05, 0.026, 0.008], wm, { R: pitch(peck ? -0.7 : -0.45) }));
    }
    p.push(S(hc, 0.038, back, { k2: 0.025 }));
    const bk = [hc[0] + fwd[0] * 0.032, 0, hc[2] + fwd[2] * 0.032];
    p.push(C(bk, [bk[0] + fwd[0] * 0.03, 0, bk[2] + fwd[2] * 0.03], 0.011, 0.003, "beak"));
    for (const sd of [-1, 1]) p.push(S([hc[0] + 0.02, sd * 0.027, hc[2] + 0.012], 0.008, "void"));
    return {
      prims: p, r: 0.25, h: 0.32, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (m !== back) return m;
        const head = near(x, y, z, hc, 0.045);
        if (tit) {
          if (head) return nz > 0.45 ? "titBlue" : Math.abs(ny) > 0.55 ? "titCheek" : m;
          return nz < 0.15 && nx > -0.4 ? "titYellow" : m;
        }
        if (head) return nx > 0.3 && z < hc[2] + 0.01 ? "birdBreast" : m;
        return nx > 0.25 && nz < 0.45 ? "birdBreast" : m;
      },
    };
  };

  // o.col "orange" | "blue" | "yellow"; o.t is the wing beat (open flat at 0.5)
  M.butterfly = (o = {}) => {
    const t = o.t ?? 0, fl = 0.12 + 1.25 * (0.5 + 0.5 * Math.cos(t * TAU)), z0 = 0.02, p = [];
    const wm = o.col === "blue" ? "wingBlue" : o.col === "yellow" ? "wingYellow" : "wingOrange";
    p.push(C([-0.045, 0, z0], [0.03, 0, z0 + 0.004], 0.008, 0.011, "bugBody"), S([0.04, 0, z0 + 0.006], 0.012, "bugBody"));
    for (const sd of [-1, 1]) {
      const tip = [0.087, sd * 0.032, z0 + 0.055];
      p.push(C([0.045, sd * 0.006, z0 + 0.012], tip, 0.004, 0.003, "bugBody"), S(tip, 0.007, "bugBody"));
      p.push(wing(0.016, z0 + 0.006, sd, fl, 0.1, 0.046, wm), wing(-0.03, z0 + 0.004, sd, fl * 0.92, 0.078, 0.036, wm));
    }
    return {
      prims: p, r: 0.16, h: 0.2, k: 1,
      detail: (x, y, z, m) => {
        if (m !== wm) return m;
        const d = Math.hypot(y, z - z0), lim = x > -0.006 ? 0.082 : 0.062;
        if (d > lim) return "wingEdge";
        if (d > lim - 0.022 && P.noise(x * 80, y * 80, z * 80, 4) > 0.56) return "wingSpot";
        return m;
      },
    };
  };

  M.dragonfly = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, z0 = 0.025, p = [
      C([-0.2, 0, z0 + 0.012], [0.02, 0, z0], 0.007, 0.011, "dragonBody"),
      E([0.035, 0, z0], [0.026, 0.017, 0.019], "dragonBody", { k2: 0.01 }),
      S([0.066, 0, z0 + 0.002], 0.014, "dragonBody"),
    ];
    for (const sd of [-1, 1]) {
      p.push(S([0.073, sd * 0.013, z0 + 0.008], 0.012, "dragonEye"));
      p.push(wing(0.045, z0 + 0.016, sd, 0.12 + 0.3 * Math.sin(ph), 0.2, 0.019, "dragonWing"));
      p.push(wing(0.016, z0 + 0.016, sd, 0.12 + 0.3 * Math.sin(ph + 2.2), 0.19, 0.023, "dragonWing"));
    }
    return { prims: p, r: 0.22, h: 0.14, k: 1, detail: (x, y, z, m) => (m === "dragonBody" && x < 0 && ((x * 40) % 1 + 1) % 1 < 0.3 ? "dragonDark" : m) };
  };

  M.bee = (o = {}) => {
    const t = o.t ?? 0, a = 0.3 + 0.7 * Math.sin(t * TAU), z0 = 0.035, p = [
      E([-0.005, 0, z0], [0.042, 0.031, 0.031], "bee", { k2: 0.01 }),
      S([0.042, 0, z0 + 0.004], 0.02, "beeDark"),
    ];
    for (const sd of [-1, 1]) {
      p.push(wing(-0.004, z0 + 0.024, sd, a, 0.065, 0.024, "beeWing"));
      p.push(C([0.052, sd * 0.008, z0 + 0.012], [0.07, sd * 0.02, z0 + 0.032], 0.003, 0.003, "beeDark"));
    }
    return { prims: p, r: 0.08, h: 0.1, k: 1, detail: (x, y, z, m) => (m === "bee" && (x < -0.034 || ((x + 1) * 45) % 1 < 0.38) ? "beeDark" : m) };
  };

  M.frog = (o = {}) => {
    const t = o.t ?? 0, p = [];
    let hc;
    if (o.pose === "jump") {
      hc = [0.09, 0, 0.115];
      p.push(E([0, 0, 0.09], [0.1, 0.058, 0.045], "frog", { k2: 0.02, R: pitch(0.25) }), E(hc, [0.05, 0.055, 0.035], "frog", { k2: 0.02 }));
      for (const sd of [-1, 1]) {
        p.push(C([-0.07, sd * 0.04, 0.08], [-0.2, sd * 0.05, 0.035], 0.022, 0.01, "frog"), E([-0.215, sd * 0.05, 0.03], [0.03, 0.022, 0.006], "frog"));
        p.push(C([0.08, sd * 0.04, 0.07], [0.145, sd * 0.05, 0.03], 0.012, 0.008, "frog"));
      }
    } else {
      // squat, nose up, throat pulsing
      const pulse = Math.max(0, Math.sin(t * TAU)) * 0.012;
      hc = [0.055, 0, 0.095];
      p.push(E([-0.015, 0, 0.065], [0.085, 0.068, 0.05], "frog", { k2: 0.02, R: pitch(0.3) }), E(hc, [0.05, 0.062, 0.038], "frog", { k2: 0.025 }));
      p.push(E([0.062, 0, 0.06 - pulse * 0.5], [0.035, 0.04, 0.022 + pulse], "frogBelly", { k2: 0.01 }));
      for (const sd of [-1, 1]) {
        p.push(E([-0.06, sd * 0.06, 0.035], [0.06, 0.028, 0.032], "frog", { k2: 0.015 }), E([0, sd * 0.075, 0.008], [0.045, 0.022, 0.008], "frog"));
        p.push(C([0.06, sd * 0.045, 0.05], [0.085, sd * 0.05, 0.006], 0.013, 0.009, "frog"));
      }
    }
    for (const sd of [-1, 1]) {
      p.push(S([hc[0] + 0.01, sd * 0.038, hc[2] + 0.033], 0.02, "frog"));
      p.push(S([hc[0] + 0.022, sd * 0.045, hc[2] + 0.04], 0.012, "frogEye"), S([hc[0] + 0.032, sd * 0.049, hc[2] + 0.042], 0.006, "void"));
    }
    return {
      prims: p, r: 0.25, h: 0.2, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => (m !== "frog" ? m : nz < -0.3 ? "frogBelly" : nz > 0.4 && P.noise(x * 50, y * 50, z * 50, 6) > 0.62 ? "frogDark" : m),
    };
  };

  // o.col "ogon" (all gold) or kohaku patches seeded by o.seed; a travelling wave swings the tail
  M.koi = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, z0 = 0.045, p = [], N = 7;
    const wig = (x) => Math.sin(ph - x * 18) * 0.022 * (0.25 + (0.14 - x) * 3.5);
    for (let k = 0; k < N; k++) {
      const u = k / (N - 1), x = 0.13 - u * 0.27, w = 0.042 * Math.sin((0.25 + u * 0.75) * Math.PI) + 0.008;
      p.push(E([x, wig(x), z0], [0.032, w, w * 0.85], "koiWhite", { k2: 0.02 }));
    }
    p.push(E([-0.175, wig(-0.175), z0 + 0.004], [0.032, 0.006, 0.034], "koiFin"));
    for (const sd of [-1, 1]) {
      p.push(E([0.075, sd * 0.045 + wig(0.075), z0 - 0.016], [0.022, 0.018, 0.004], "koiFin", { R: rx(sd * 0.4) }));
      p.push(S([0.135, sd * 0.021 + wig(0.135), z0 + 0.012], 0.006, "void"));
    }
    return {
      prims: p, r: 0.22, h: 0.1, k: 1,
      detail: (x, y, z, m) => (m !== "koiWhite" ? m : o.col === "ogon" ? "koiGold" : P.noise(x * 22 + 3, y * 22, z * 22 + (o.seed || 0) * 5.3, 2) > 0.5 ? "koiOrange" : m),
    };
  };

  // A minnow for a flooded pond's school (Fernglass), after the white cloud mountain minnow so it reads
  // through the water: a brown back over golden flanks with a bright teal stripe, a pale belly, orange-red fins
  // and a forked tail; o.t swings it. Opaque, and drawn under the surface. It reuses the koi's, the
  // dragonfly's and the birds' materials: the flipbooks bake for every map, so new ones would grow every
  // style's palette (Momiji's frame moved by a step in 2 pixels)
  M.minnow = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, z0 = 0.045, p = [], N = 7;
    const wig = (x) => Math.sin(ph - x * 22) * 0.018 * (0.3 + (0.1 - x) * 5);
    for (let k = 0; k < N; k++) {
      const u = k / (N - 1), x = 0.1 - u * 0.2, w = 0.028 * Math.sin((0.2 + u * 0.8) * Math.PI) + 0.008;
      p.push(E([x, wig(x), z0], [0.024, w, w * 1.3], "koiGold", { k2: 0.01 }));
    }
    for (const sd of [-1, 1]) {
      p.push(E([-0.135, wig(-0.135), z0 + sd * 0.014], [0.028, 0.006, 0.013], "koiOrange", { R: pitch(sd * 0.55) }));
      p.push(S([0.088, sd * 0.016 + wig(0.088), z0 + 0.008], 0.007, "void"));
    }
    p.push(E([-0.01, wig(-0.01), z0 + 0.04], [0.026, 0.005, 0.014], "koiOrange", { R: pitch(-0.3) }));
    return {
      prims: p, r: 0.17, h: 0.1, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => (m !== "koiGold" ? m : nz > 0.5 ? "birdWing" : nz < -0.45 ? "koiWhite" : Math.abs(z - z0 - 0.004) < 0.006 ? "dragonBody" : m),
    };
  };

  // o.pose "sit" (o.t twitches an ear) or "hop" (o.t runs crouch -> stretched -> crouch)
  M.bunny = (o = {}) => {
    const t = o.t ?? 0, hop = o.pose === "hop", s = hop ? Math.sin(t * Math.PI) : 0, tw = hop ? 0 : Math.max(0, Math.sin(t * TAU)), p = [];
    const hc = [0.07 + s * 0.05, 0, 0.15 - s * 0.02];
    p.push(E([-0.015, 0, 0.085 + s * 0.03], [0.085 + s * 0.035, 0.068, 0.072 - s * 0.012], "bunny", { k2: 0.03, R: pitch(0.15 - s * 0.25) }));
    p.push(E(hc, [0.056, 0.048, 0.046], "bunny", { k2: 0.025 }));
    for (const sd of [-1, 1]) {
      const ea = s * 0.9 + (sd > 0 ? tw * 0.3 : 0), e0 = [hc[0] - 0.01, sd * 0.02, hc[2] + 0.035];
      p.push(C(e0, [e0[0] - 0.02 - Math.sin(ea) * 0.09, sd * 0.032, e0[2] + Math.cos(ea) * 0.1], 0.017, 0.012, "bunny"));
      p.push(S([hc[0] + 0.035, sd * 0.03, hc[2] + 0.012], 0.01, "void"));
      p.push(E([-0.05 - s * 0.03, sd * 0.05, 0.05 + s * 0.03], [0.058, 0.028, 0.045], "bunny", { k2: 0.02 }));
      p.push(C([-0.05 - s * 0.03, sd * 0.05, 0.03 + s * 0.03], [-0.02 - s * 0.14, sd * 0.05, 0.008 + s * 0.02], 0.016, 0.012, "bunny"));
      p.push(C([0.05 + s * 0.03, sd * 0.03, 0.06 + s * 0.02], [0.065 + s * 0.08, sd * 0.03, 0.008 + s * 0.03], 0.012, 0.01, "bunny"));
    }
    p.push(S([hc[0] + 0.055, 0, hc[2] - 0.005], 0.009, "bunnyNose"), S([-0.1 - s * 0.03, 0, 0.1 + s * 0.02], 0.028, "bunnyTail"));
    return { prims: p, r: 0.24, h: 0.3, k: 1, detail: (x, y, z, m, nx, ny, nz) => (m === "bunny" && nz < -0.45 ? "bunnyTail" : m) };
  };

  M.snail = (o = {}) => {
    const t = o.t ?? 0, ph = t * TAU, st = Math.sin(ph) * 0.008, sc = [-0.012, 0, 0.065], p = [
      E([st, 0, 0.016], [0.085 + st, 0.024, 0.016], "snailBody", { k2: 0.01 }),
      C([0.07 + st * 2, 0, 0.016], [0.09 + st * 2, 0, 0.04], 0.016, 0.013, "snailBody"),
      E(sc, [0.052, 0.042, 0.05], "snailShell", { k2: 0.01 }),
    ];
    for (const sd of [-1, 1]) {
      const tip = [0.115 + st * 2, sd * 0.018, 0.085 + Math.sin(ph + sd) * 0.006];
      p.push(C([0.09 + st * 2, sd * 0.008, 0.04], tip, 0.0045, 0.0035, "snailBody"), S(tip, 0.0065, "void"));
    }
    return {
      prims: p, r: 0.16, h: 0.13, k: 1,
      detail: (x, y, z, m) => (m === "snailShell" && ((Math.atan2(z - sc[2], x - sc[0]) / TAU + Math.hypot(x - sc[0], z - sc[2]) * 22 + Math.abs(y) * 6) % 1 + 1) % 1 < 0.26 ? "snailDark" : m),
    };
  };

  // Ground lanterns. forestLantern: a squat moss-capped stone yukimi on three feet; andon: a paper lamp
  // box on a short wooden post. o.seed varies proportions.
  M.forestLantern = (o = {}) => {
    const r = P.rng(o.seed || 3), s = 0.9 + r() * 0.2, p = [];
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5; p.push(C([Math.cos(a) * 0.08 * s, Math.sin(a) * 0.08 * s, 0], [Math.cos(a) * 0.05 * s, Math.sin(a) * 0.05 * s, 0.07 * s], 0.018, 0.014, "stone")); }
    p.push(Y([0, 0, 0.085 * s], 0.075 * s, 0.014 * s, "stone", { round: 0.006 }));
    p.push(B([0, 0, 0.14 * s], [0.052 * s, 0.052 * s, 0.045 * s], 0.008, "stone"));
    p.push(B([0.052 * s, 0, 0.14 * s], [0.008, 0.028 * s, 0.026 * s], 0, "candle"), B([0, 0.052 * s, 0.14 * s], [0.028 * s, 0.008, 0.026 * s], 0, "candle"));
    p.push(B([-0.052 * s, 0, 0.14 * s], [0.008, 0.028 * s, 0.026 * s], 0, "candle"), B([0, -0.052 * s, 0.14 * s], [0.028 * s, 0.008, 0.026 * s], 0, "candle"));
    p.push(C([0, 0, 0.19 * s], [0, 0, 0.25 * s], 0.13 * s, 0.02, "stone"), S([0, 0, 0.265 * s], 0.025 * s, "stone"));
    return { prims: p, r: 0.18, h: 0.3, k: 1.4, lz: 0.14 * s, detail: (x, y, z, m, nx, ny, nz) => (m === "stone" && nz > 0.45 && P.noise(x * 30, y * 30, z * 30, 3) > 0.4 ? "moss" : m) };
  };
  M.andon = (o = {}) => {
    const r = P.rng(o.seed || 5), hgt = 0.2 + r() * 0.08, p = [
      Y([0, 0, hgt * 0.5], 0.018, hgt * 0.5, "lanternWood"),
      B([0, 0, hgt + 0.065], [0.055, 0.055, 0.065], 0.004, "lanternPaper"),
      B([0, 0, hgt + 0.002], [0.062, 0.062, 0.008], 0.002, "lanternWood"),
      B([0, 0, hgt + 0.135], [0.07, 0.07, 0.008], 0.003, "lanternWood"),
      C([0, 0, hgt + 0.143], [0, 0, hgt + 0.18], 0.045, 0.01, "lanternWood"),
    ];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(B([dx * 0.055, dy * 0.055, hgt + 0.065], [0.007, 0.007, 0.066], 0, "lanternWood"));
    return { prims: p, r: 0.12, h: hgt + 0.2, k: 1.4, lz: hgt + 0.065, detail: (x, y, z, m) => (m === "lanternPaper" && ((z - hgt) * 30 % 1 + 1) % 1 < 0.14 ? "paperRib" : m) };
  };

  // flipbooks for the critter sim: key -> [model, options, frames, fine]. Drawn CRITTER_SCALE x life size;
  // fine 1.5 gives them voxels a little smaller than the terrain's, 2 for the insects.
  const content = (ME.content = ME.content || {});
  content.critterScale = 1.6;
  content.critters = {
    squirrelRun: ["squirrel", { pose: "run" }, 4, 1.5], squirrelSit: ["squirrel", { pose: "sit" }, 2, 1.5],
    robinStand: ["songbird", { col: "robin" }, 1, 1.5], robinPeck: ["songbird", { col: "robin", pose: "peck" }, 1, 1.5], robinFly: ["songbird", { col: "robin", pose: "fly" }, 4, 1.5],
    titStand: ["songbird", { col: "tit" }, 1, 1.5], titPeck: ["songbird", { col: "tit", pose: "peck" }, 1, 1.5], titFly: ["songbird", { col: "tit", pose: "fly" }, 4, 1.5],
    butterflyOrange: ["butterfly", { col: "orange" }, 4, 2], butterflyBlue: ["butterfly", { col: "blue" }, 4, 2], butterflyYellow: ["butterfly", { col: "yellow" }, 4, 2],
    dragonfly: ["dragonfly", { size: 0.7 }, 2, 2], bee: ["bee", {}, 2, 2],
    frogSit: ["frog", {}, 2, 1.5], frogJump: ["frog", { pose: "jump" }, 1, 1.5],
    koiKohaku: ["koi", { seed: 1 }, 4, 1.5], koiKohaku2: ["koi", { seed: 4 }, 4, 1.5], koiOgon: ["koi", { col: "ogon" }, 4, 1.5],
    bunnySit: ["bunny", {}, 2, 1.5], bunnyHop: ["bunny", { pose: "hop" }, 4, 1.5],
    snail: ["snail", {}, 2, 2], beetle: ["beetle", { size: 0.32 }, 4, 1.5], moth: ["fluffmoth", { size: 0.32 }, 4, 2],
    // last, so the frames before it keep their places in the bake (Momiji unchanged)
    minnow: ["minnow", {}, 4, 2],
  };

  // Ramps and material flags for the new materials; a style's own entries win.
  const RAMPS = {
    squirrel: ["#b8622a", 6, 0.12, 0.62, 0.3], squirrelTail: ["#c87434", 6, 0.16, 0.7, 0.3], squirrelLight: ["#ecd2a6", 5, 0.45, 0.92, 0.2], acorn: ["#8a5a2a", 4, 0.15, 0.55],
    birdBody: ["#7c5a40", 5, 0.12, 0.6, 0.25], birdWing: ["#5e4432", 5, 0.08, 0.5, 0.2], birdBreast: ["#e8692c", 5, 0.25, 0.78, 0.3], beak: ["#e0a040", 4, 0.3, 0.75], birdLeg: ["#6a5040", 3, 0.15, 0.5],
    titGreen: ["#8aa046", 5, 0.2, 0.7, 0.3], titBlue: ["#4a82c8", 5, 0.15, 0.7, 0.25], titYellow: ["#f2d24a", 5, 0.35, 0.9, 0.25], titCheek: ["#f4f0e4", 3, 0.6, 0.95],
    bugBody: ["#2e2a2c", 3, 0.05, 0.3], wingOrange: ["#f28a2c", 5, 0.3, 0.82, 0.3], wingBlue: ["#58a6f0", 5, 0.25, 0.85, 0.25], wingYellow: ["#f4dc5c", 5, 0.4, 0.92, 0.25],
    wingEdge: ["#2a2226", 3, 0.04, 0.28], wingSpot: ["#fbf6ea", 2, 0.7, 0.98],
    dragonBody: ["#2aa89a", 5, 0.12, 0.7, 0.25], dragonDark: ["#1d3a40", 3, 0.04, 0.3], dragonEye: ["#3a6ad0", 4, 0.2, 0.75], dragonWing: ["#d8eef4", 3, 0.6, 0.97],
    bee: ["#f2bc2a", 4, 0.3, 0.82, 0.3], beeDark: ["#2e2622", 3, 0.04, 0.28], beeWing: ["#eef4f8", 2, 0.75, 0.98],
    frog: ["#5aa83a", 5, 0.15, 0.72, 0.3], frogDark: ["#2f6a2a", 4, 0.08, 0.45], frogBelly: ["#d8dca0", 4, 0.45, 0.9], frogEye: ["#e8b838", 3, 0.4, 0.85],
    koiWhite: ["#f4efe6", 4, 0.55, 0.97], koiOrange: ["#f06424", 5, 0.25, 0.8, 0.3], koiGold: ["#f2b438", 5, 0.3, 0.88, 0.3], koiFin: ["#f6d2b4", 3, 0.55, 0.95],
    bunny: ["#9c8068", 5, 0.15, 0.68, 0.25], bunnyTail: ["#f2ece0", 3, 0.6, 0.96], bunnyNose: ["#e89a9a", 2, 0.5, 0.85],
    snailShell: ["#b8783e", 5, 0.15, 0.7, 0.3], snailDark: ["#5a3a24", 3, 0.06, 0.4], snailBody: ["#c4b494", 4, 0.3, 0.8],
    lanternPaper: ["#ffb45c", "#ffd890", "#fff2cc"], lanternWood: ["#5a3a26", 5, 0.08, 0.5], candle: ["#ffb347", "#ffe8a8", "#fffbe8"], paperRib: ["#c9955a", 3, 0.3, 0.62],
  };
  const MATS = {
    squirrel: { wrap: 0.5 }, squirrelTail: { wrap: 0.6 }, bunny: { wrap: 0.5 }, bunnyTail: { wrap: 0.6 },
    wingOrange: { wrap: 0.7 }, wingBlue: { wrap: 0.7 }, wingYellow: { wrap: 0.7 }, dragonWing: { wrap: 0.8, bias: 0.15 }, beeWing: { wrap: 0.8, bias: 0.15 }, koiFin: { wrap: 0.7 },
    lanternPaper: { em: 1, flat: 1 }, candle: { em: 1, flat: 1 },
  };
  // A sand tile's cover, stamped on every sand tile (G.dressSand, src/art/models.js). It recolours the tile's
  // top flush with grain, faint ripples and damp patches. These are taken in world coordinates (o.x, o.y: the
  // tile), so neighbouring covers join without a seam. Low lumps spill over the open sides (o.open: any of
  // "n", "e", "s", "w" for -y, +x, +y, -x) onto the path and moss beside, so the bank has no square border.
  M.sandCover = (o = {}) => {
    const tx = o.x ?? 0, ty = o.y ?? 0, X0 = tx + 0.5, Y0 = ty + 0.5, h = (i, s) => P.hash(tx, ty, i, s), VS = ME.VS;
    const p = [B([0, 0, -0.06], [0.5, 0.5, 0.05], 0, "sand")]; // top at -0.01: the tile's top voxel, not above
    const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    for (const c of o.open || "") {
      const [nx, ny] = SIDES[c] || [0, 0], s0 = c.charCodeAt(0);
      if (!nx && !ny) continue;
      for (let i = 0; i < 3; i++) {
        const u = (i - 1) * 0.34 + (h(i, s0) - 0.5) * 0.2, r = 0.1 + 0.08 * h(i, s0 + 1), out = 0.5 + 0.04 + 0.17 * h(i, s0 + 2) - r;
        p.push(E([nx * out - ny * u, ny * out + nx * u, -0.03], nx ? [r, r * 1.7, 0.055] : [r * 1.7, r, 0.055], "sand", { k2: 0.04 }));
      }
    }
    // a dune or two inside
    for (let i = 0; i < 2; i++) p.push(E([(h(i, 3) - 0.5) * 0.5, (h(i, 4) - 0.5) * 0.5, -0.03], [0.14 + 0.08 * h(i, 6), 0.1, 0.055], "sand", { k2: 0.04 }));
    return {
      prims: p, r: 0.6, h: 0.1, k: 1,
      detail: (x, y, z, m, nx, ny, nz) => {
        if (nz < 0.5) return m;
        const X = X0 + x, Y = Y0 + y, g = P.hash(Math.floor(X * VS), Math.floor(Y * VS), 0, 17);
        const rip = Math.sin((X * 0.86 + Y * 0.5 + 0.6 * P.fbm(X * 0.5, Y * 0.5, 0, 3)) * TAU * 2.4);
        if (P.fbm(X * 0.7, Y * 0.7, 0, 33) > 0.64) return g > 0.85 ? m : "sand2"; // damp patches
        if (g > 0.92 || rip > 0.82) return "sand3"; // pale grains and the ripples' crests
        if (g < 0.08 || rip < -0.88) return "sand2";
        return m;
      },
    };
  };
  (ME.ASSET_BY = ME.ASSET_BY || {}).sandCover = "sandCover" + String(M.sandCover); // the bake cache key, by name and in all
  ME.ASSET_SRC = (ME.ASSET_SRC || "") + ME.ASSET_BY.sandCover;

  // Ramps that win over the style's own. The generator's sand (["#e2b878", …, 0.3]) hue-shifts its shade from
  // ochre the short way round through red, so shaded sand banks drew as a crimson band. The Momiji sands are
  // explicit lists, dark to light: a soft grey-beige, a damp darker one and pale grains, none saturated.
  const OWN = {
    sand: ["#5a5044", "#6c6152", "#807360", "#95876f", "#a99b80", "#bcae92", "#cdc0a5", "#dcd1b9"],
    sand2: ["#4e463c", "#5e5548", "#706555", "#827663", "#948772", "#a59882", "#b5a992", "#c4b9a3"],
    sand3: ["#6a604f", "#7f7461", "#958974", "#aa9e88", "#bdb29c", "#cec4af", "#ddd4c1", "#ebe4d4"],
  };
  // content.ramps and content.mats: other files of the pack add theirs there (content/fernglass.js); like
  // RAMPS they only fill gaps in the style
  content.addMaterials = (st) => {
    for (const k in RAMPS) if (!st.ramps[k]) st.ramps[k] = RAMPS[k];
    for (const k in content.ramps || {}) if (!st.ramps[k]) st.ramps[k] = content.ramps[k];
    Object.assign(st.ramps, OWN);
    for (const k in MATS) if (!st.mats[k]) st.mats[k] = MATS[k];
    for (const k in content.mats || {}) if (!st.mats[k]) st.mats[k] = content.mats[k];
  };
})();
