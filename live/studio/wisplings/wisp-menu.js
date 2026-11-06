// The wisplings for Mossheart's menu sprites (menu.ps1 runs it in the studio's live page): MODELS.wsp_menu(o), one
// wispling standing on the ground centre without the game's low-density growth. o.v 0..7 is its variant (Curl,
// Leafcap, Acorn, Drop, Ears, Maple, Twin, Sprout); o.blink 0 open, 1 half shut, 2 shut (o.shut overrides the shut
// eye: the driver passes one that matches no triangle, for the eyeless shot); o.look shifts the eyes to screen right,
// in voxels (a 3/4 glance). The pieces and faces copy games/Mossheart/src/art/models.js (WV, wface): keep them in
// step when those change. The face is snapped to the game camera's screen lattice (iso along -(1,1,1)), so shoot it
// from that camera. Needs the wisp materials, which the driver installs.
(() => {
  const AK = ME.assetKit, { S, E, C, add, mul, norm, orient, near } = AK;
  const FR = Math.PI / 4, SIDE = [-Math.sin(FR), Math.cos(FR), 0], FWD = [Math.cos(FR), Math.sin(FR), 0], VUP = [-0.408, -0.408, 0.816];
  const WS = "hsKodama";
  const WV = [
    { m: WS, tip: 1, face: { ex: 0.36, ey: 0.12, er: 0.2, hi: false } },
    { m: "wMint", hat: "leaf", face: { ex: 0.34, ey: 0.06, er: 0.22, blush: true } },
    { m: "wPeach", hat: "acorn", face: { ex: 0.32, ey: -0.1, er: 0.18, mouth: [0, -0.4, 0.07] } },
    { m: "wDew", drop: 1, face: { ex: 0.32, ey: 0.0, er: 0.25, blush: true } },
    { m: "wLilac", ears: 1, face: { ex: 0.38, ey: 0.1, er: 0.15, hi: false, mouth: [0, -0.16, 0.06] } },
    { m: "wPeach", tip: 1, maple: 1, face: { ex: 0.34, ey: 0.1, er: 0.2, blush: true } },
    { m: "wMint", tip: 2, face: { ex: 0.4, ey: 0.06, er: 0.13, hi: false, blush: true } },
    { m: WS, sprout: 1, face: { ex: 0.34, ey: 0.1, er: 0.21 } },
  ];
  // the game's wface (models.js) with the blink: open is the game's face; half shut keeps the eye's triangles below
  // its lattice point (a lid over the top); shut is a flat band of triangles a little under it. Snapped to the screen
  // lattice of the game's camera (iso along -(1,1,1)), so the sprites must be shot from that camera
  const LA = 0.70710678, LB = 0.40824829, inE = (u, w, ru, rw) => (u / ru) ** 2 + (w / rw) ** 2 <= 1 + 1e-6;
  const T6 = [[0, 0.23570226, LB], [0, -0.23570226, LB], [1, -0.47140452, 0], [1, -0.23570226, -LB], [2, 0.47140452, 0], [2, 0.23570226, -LB]]; // the exposed face and its triangles' centres from the cell's point
  const inX = (A, B, e, xp) => { // cell (A, B) from the eye's point: an exposed face's triangle in eye e {ru, rw, ou, ow, lo}
    const u = (A - B) * LA - e.ou, w = (A + B) * LB - e.ow;
    for (const [k, cu, cw] of T6) if (xp[k] && (e.lo === undefined || w + cw + e.ow > e.lo) && inE(u + cu, w + cw, e.ru, e.rw)) return true;
    return false;
  };
  const wface = (q, hr, hz, f, cap, tv, bl, lk = 0, se = null) => {
    if ((q[0] + q[1] + q[2]) * 0.577 < 0.15 * hr) return null;
    const hv = hr / tv, one = f.er * hv < 0.75, hw = one ? 0.9 : 1.3;
    const e = bl === 2 ? se || { ru: 0.9, rw: 0.25, ou: 0, ow: 0.2 } : one ? { ru: 0.2, rw: 0.2, ou: 0.23570226, ow: -LB } : { ru: 0.5, rw: 0.5, ou: 0, ow: 0, lo: bl === 1 ? 0.1 : undefined };
    const m = Math.max(2, Math.ceil((2 * hw + 1) / 1.414 - 0.01), Math.round((2 * f.ex * hv) / 1.414));
    const qu = ((q[0] - q[1]) * LA) / tv, qw = ((q[0] + q[1]) * LB - q[2] * 0.81649658) / tv;
    const du = -m * LA + 1.3e-4 + lk - qu, dw = -f.ey * hv + 0.7e-4 - qw, a = (du / LA + dw / LB) / 2, b = (dw / LB - du / LA) / 2;
    let best = 1e9, A = 0, B = 0;
    for (let ia = Math.floor(a); ia <= Math.floor(a) + 1; ia++) for (let ib = Math.floor(b); ib <= Math.floor(b) + 1; ib++) {
      const u = (ia - ib) * LA - du, w = (ia + ib) * LB - dw, d = u * u + w * w;
      if (d < best - 1e-9) { best = d; A = ia; B = ib; }
    }
    const out = (x, y, z) => (x * x + y * y) / (hr * hr) + (z * z) / (hz * hz * hr * hr) >= 1 && (!cap || (x * x + y * y) / (0.875 * hr) ** 2 + (z / hr - 0.8125) ** 2 / 0.469 ** 2 >= 1);
    const xp = [out(q[0], q[1], q[2] + tv), out(q[0] + tv, q[1], q[2]), out(q[0], q[1] + tv, q[2])];
    if (inX(-A, -B, e, xp) || inX(-A - m, -B + m, e, xp)) return "void";
    if (f.mouth && hv >= 4.5) {
      const mk = Math.max(1, Math.round(((f.ey - f.mouth[1]) * hv - (m % 2) * 0.408) / 0.816));
      if (inX(-A - Math.floor((m + 1) / 2) - mk, -B + Math.floor(m / 2) - mk, { ru: 0.2, rw: 0.2, ou: 0, ow: 0 }, xp)) return "void";
    }
    if (f.blush) {
      const u = (qu - lk) / hv, v = -qw / hv, ex = (m * LA) / hv;
      for (const sx of [-1, 1]) if ((u - sx * (ex + 0.16)) ** 2 + ((v - f.ey + 0.3) * 1.8) ** 2 < 0.16 ** 2) return "blush";
    }
    return null;
  };
  const curl = (p, b, s, m, sd = 0) => {
    const o = mul(SIDE, sd * 0.026 * s), q0 = add(b, add(o, [0, 0, 0.038 * s])), q1 = add(b, add(mul(o, 1.6), [-0.022 * s, -0.022 * s, 0.092 * s])), q2 = add(b, add(mul(o, 1.9), [-0.004 * s, -0.004 * s, 0.118 * s]));
    p.push(C(q0, q1, 0.028 * s * (sd ? 0.8 : 1), 0.012 * s, m, { k2: 0.012 }), C(q1, q2, 0.012 * s, 0.003, m, { k2: 0.006 }));
  };
  AK.model("wsp_menu", 1, (o) => {
    const v = WV[(o.v || 0) % 8], m = v.m, s = 1, p = [];
    let b = [0, 0, 0.058 * s], hr = 0.064 * s;
    if (v.drop) { b = [0, 0, 0.056 * s]; hr = 0.06 * s; p.push(E(b, [0.06 * s, 0.06 * s, 0.056 * s], m, { k2: 0.02 }), C(add(b, [0, 0, 0.03 * s]), add(b, [-0.008 * s, -0.008 * s, 0.11 * s]), 0.042 * s, 0.003, m, { k2: 0.02 })); }
    else p.push(E(b, [0.064 * s, 0.064 * s, 0.058 * s], m, { k2: 0.02 }));
    if (v.tip === 1) curl(p, b, s, m);
    if (v.tip === 2) { curl(p, b, s, m, 1); curl(p, b, s, m, -1); }
    if (v.ears) for (const sd of [1, -1]) p.push(C(add(b, add(mul(SIDE, sd * 0.034 * s), [0, 0, 0.038 * s])), add(b, add(mul(SIDE, sd * 0.05 * s), [-0.006 * s, -0.006 * s, 0.086 * s])), 0.02 * s, 0.007 * s, m, { k2: 0.008 }));
    if (v.hat === "leaf") {
      const t = add(b, [0, 0, 0.056 * s]);
      p.push(E(add(t, mul(SIDE, 0.012 * s)), [0.058 * s, 0.03 * s, 0.009 * s], "kgLeafLt", { R: orient(norm(add([0, 0, 1], mul(SIDE, -0.35))), SIDE) }), C(add(t, mul(SIDE, -0.03 * s)), add(t, add(mul(SIDE, -0.05 * s), [0, 0, 0.02 * s])), 0.006 * s, 0.004 * s, "kgLeaf"));
    }
    if (v.hat === "acorn") {
      const t = add(b, [0, 0, 0.052 * s]);
      p.push(E(t, [0.056 * s, 0.056 * s, 0.03 * s], "wAcorn", { k2: 0.01 }), E(add(t, [0, 0, 0.012 * s]), [0.042 * s, 0.042 * s, 0.024 * s], "wAcornLt"), C(add(t, [0, 0, 0.028 * s]), add(t, [0.006 * s, -0.004 * s, 0.05 * s]), 0.009 * s, 0.006 * s, "wAcorn"));
    }
    if (v.sprout) {
      const t0 = add(b, [0, 0, 0.05 * s]), t = add(b, [-0.006 * s, -0.006 * s, 0.09 * s]);
      p.push(C(t0, t, 0.008 * s, 0.006 * s, "wSprout"));
      for (const sd of [1, -1]) { const d = norm(add(mul(SIDE, sd), [0, 0, 0.45])); p.push(E(add(t, mul(d, 0.026 * s)), [0.028 * s, 0.014 * s, 0.006 * s], "wSprout", { R: orient(norm(add([0, 0, 1], mul(d, -0.5))), d) })); }
    }
    if (v.maple) {
      const hand = add(b, add(mul(FWD, 0.044 * s), add(mul(SIDE, 0.04 * s), [0, 0, -0.012 * s]))), q = add(b, add(mul(FWD, 0.062 * s), add(mul(SIDE, 0.074 * s), [0, 0, 0.036 * s])));
      p.push(S(hand, 0.016 * s, m), C(hand, q, 0.004 * s, 0.004 * s, "twMaple"));
      const n = norm([1, 1, 1]);
      for (const [a, l] of [[90, 1], [45, 0.85], [135, 0.85], [0, 0.6], [180, 0.6]]) {
        const r = (a * Math.PI) / 180, d = norm(add(mul(SIDE, Math.cos(r)), mul(VUP, Math.sin(r))));
        p.push(E(add(q, mul(d, 0.02 * s * l)), [0.022 * s * l, 0.009 * s, 0.004 * s], "twMaple", { R: orient(n, d) }));
      }
    }
    const fo = v.face, bl = o.blink || 0, lk = o.look || 0, se = o.shut || null, hz = v.drop ? 0.056 / 0.06 : 0.058 / 0.064, cap = v.hat === "acorn";
    return { prims: p, r: 0.14, h: 0.26, detail: (x, y, z, mm, nx, ny, nz, tv = 1 / 60) => { if ((mm === m || (cap && mm === "wAcorn")) && near([x, y, z], b, hr * 1.12 + 0.855 * tv)) { const f = wface([x - b[0], y - b[1], z - b[2]], hr, hz, fo, cap, tv, bl, lk, se); if (f) return f; } return mm; } };
  }, 1);
})();
