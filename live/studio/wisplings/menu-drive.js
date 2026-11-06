// The menu sprite sheets (menu.ps1 runs it after wisp-menu.js in the studio's live page): each variant at vs 64
// (head ~8 voxels), shot from the game's camera (engine, yaw 0) at a = 1 and 2 px (frames 48 and 96; a voxel 2a
// wide; add 144 to SIZES for a = 3), its three eye states, composed into the rows by whole-a offsets.
// -> { mats, missing, sheets: { "curl@48": dataURL, ... }, raw: { "curl@96": [open, half, shut, eyeless] }, json, warn }
const LOOK = globalThis.MENU_LOOK ?? 0, VS = 64, Z = 2, F0 = 48, SIZES = [48, 96], FPS = 12, COLS = 8;
const NAMES = ["curl", "leafcap", "acorn", "drop", "ears", "maple", "twin", "sprout"];
const MATS = {
  wMint: { ramp: ["#e0f2da", 4, 0.66, 0.96] }, wPeach: { ramp: ["#f8e6d6", 4, 0.68, 0.97] }, wDew: { ramp: ["#d8ecfa", 4, 0.66, 0.97] }, wLilac: { ramp: ["#eee0f8", 4, 0.66, 0.97] },
  wAcorn: { ramp: ["#8a5a34", 5, 0.18, 0.62, 0.1] }, wAcornLt: { ramp: ["#b88a52", 4, 0.3, 0.74, 0.1] }, wSprout: { ramp: ["#6cbc44", 4, 0.3, 0.8, 0.1] },
  twMaple: { ramp: ["#d4482a", 5, 0.24, 0.78, 0.04] },
};
live.materials(MATS);
const have = new Set(live.mats()), missing = new Set(["void", "blush", "hsKodama", "kgLeaf", "kgLeafLt"].filter((m) => !have.has(m)));
// the rows: [name, frames, loop, f(i) -> { s: eye state, dy: offset in a (down +), clip: hide below the baseline }]
const HOP = [0, -3, -5, -6, -5, -3, 0, 0], BOB = [0, 0, -1, -1, -1, -1, 0, 0];
const ROWS = [
  ["idle", 8, true, (i) => ({ s: 0, dy: BOB[i] })],
  ["blink", 4, false, (i) => ({ s: [0, 1, 2, 1][i], dy: 0 })],
  ["peek", 8, false, (i, h) => ({ s: i < 6 ? 0 : [1, 0][i - 6], dy: Math.round(h * (1 - Math.sin((Math.PI / 2) * Math.min(1, i / 5)))), clip: true })],
  ["duck", 6, false, (i, h) => ({ s: i ? 2 : 1, dy: i === 5 ? h + 2 : Math.round(h * (i / 5) ** 1.6), clip: true })],
  ["hop", 8, true, (i) => ({ s: 0, dy: HOP[i] })],
];
const cv = document.getElementById("cv"), H0 = cv.height, CELL = [20, 20, 1], UP = 6; // UP: the target near the figure's middle
const img = async (url) => { const m = new Image(); m.src = url; await m.decode(); return m; };
const json = {
  version: 2, fps: FPS, cols: COLS, look: LOOK, facing: "right",
  about: "Each sheet is cols x rows frames of frame x frame px, a row per animation (row, n frames, loop). Every sprite faces right (iso 3/4): mirror it to face left. look is the eyes' glance to screen right in voxels; 0 looks straight out of the face. anchor [x, y] is the feet's point in a frame, the same for every row; height is the figure's height above it in px.",
  rows: {}, order: NAMES, variants: {},
};
const sheets = {}, raw = {}, warn = [];
// the lids, drawn in 2D: a voxel eye is one or two voxels, too coarse to close in the model, so each shot is taken
// open and eyeless (o.shut matching no triangle); the eyes are the pixels that differ, split into the two eyes;
// half shut keeps each eye's lower half, shut is a dark line 2/3 of the way down, max(2, a) px thick
const NOEYE = { ru: 1e-3, rw: 1e-3, ou: 0, ow: 99 };
const lids = (open, clean, F, a) => {
  const cv2 = (m) => { const c = Object.assign(document.createElement("canvas"), { width: F, height: F }), g = c.getContext("2d"); g.drawImage(m, 0, 0); return [c, g, g.getImageData(0, 0, F, F)]; };
  const [, , po] = cv2(open), [hc, hg, ph] = cv2(clean), [sc, sg, ps] = cv2(clean), O = po.data;
  const eye = new Int32Array(F * F).fill(-1), boxes = [];
  for (let i = 0; i < F * F; i++) {
    if (eye[i] !== -1) continue;
    let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(O[i * 4 + c] - ph.data[i * 4 + c]));
    eye[i] = d > 24 ? -2 : -3;
  }
  for (let i = 0; i < F * F; i++) if (eye[i] === -2) { // flood fill one eye (8-connected)
    const b = { n: boxes.length, x0: F, x1: -1, y0: F, y1: -1, col: [0, 0, 0], k: 0 }, st = [i]; eye[i] = b.n;
    while (st.length) {
      const j = st.pop(), x = j % F, y = (j / F) | 0;
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      if (O[j * 4] + O[j * 4 + 1] + O[j * 4 + 2] < 150) { for (let c = 0; c < 3; c++) b.col[c] += O[j * 4 + c]; b.k++; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < F && Y < F && eye[Y * F + X] === -2) { eye[Y * F + X] = b.n; st.push(Y * F + X); } }
    }
    boxes.push(b);
  }
  for (const b of boxes) {
    const col = b.k ? b.col.map((c) => Math.round(c / b.k)) : [16, 20, 18], mid = b.y0 + Math.floor((b.y1 - b.y0 + 1) / 2);
    const t = Math.max(2, a), ly = Math.min(b.y1 - t + 1, b.y0 + Math.round(((b.y1 - b.y0 + 1) * 2) / 3) - Math.floor(t / 2));
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const j = y * F + x; if (eye[j] !== b.n) continue;
      if (y >= mid) for (let c = 0; c < 4; c++) ph.data[j * 4 + c] = O[j * 4 + c];
      if (y >= ly && y < ly + t) { ps.data[j * 4] = col[0]; ps.data[j * 4 + 1] = col[1]; ps.data[j * 4 + 2] = col[2]; ps.data[j * 4 + 3] = 255; }
    }
  }
  hg.putImageData(ph, 0, 0); sg.putImageData(ps, 0, 0);
  return { half: hc, shut: sc, eyes: boxes.length };
};
for (let v = 0; v < 8; v++) {
  const shots = SIZES.map(() => []); // [size][state]: open, half shut, shut
  const two = SIZES.map(() => []); // [size]: open, eyeless
  for (const sh of [null, NOEYE]) {
    live.fill(null);
    const r = live.model(["wsp_menu", sh ? { v, blink: 2, shut: sh, look: LOOK } : { v, look: LOOK }], { vs: VS, at: CELL });
    for (const m of r.missing || []) missing.add(m);
    live.view({ engine: true, yaw: 0, target: [CELL[0], CELL[1], CELL[2] + UP], zoom: (Z * Math.SQRT2 * H0) / F0 });
    await live.drawn();
    for (let k = 0; k < SIZES.length; k++) two[k].push(await img(live.shot({ w: SIZES[k], h: SIZES[k], alpha: true })));
  }
  for (let k = 0; k < SIZES.length; k++) {
    const L = lids(two[k][0], two[k][1], SIZES[k], SIZES[k] / F0);
    if (L.eyes !== 2) warn.push(NAMES[v] + "@" + SIZES[k] + ": " + L.eyes + " eyes found");
    shots[k].push(two[k][0], L.half, L.shut);
  }
  for (let k = 0; k < SIZES.length; k++) {
    const F = SIZES[k], a = F / F0, open = shots[k][0];
    // the baseline: below the lowest opaque row of the open pose; the figure's height above it
    const c0 = Object.assign(document.createElement("canvas"), { width: F, height: F }), g0 = c0.getContext("2d");
    g0.drawImage(open, 0, 0);
    const px = g0.getImageData(0, 0, F, F).data;
    let lo = -1, hi = F;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (px[(y * F + x) * 4 + 3] > 8) { lo = Math.max(lo, y); hi = Math.min(hi, y); }
    { let e = 0; for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if ((x < 1 || y < 1 || x >= F - 1 || y >= F - 1) && px[(y * F + x) * 4 + 3] > 8) e++; if (e) warn.push(NAMES[v] + "@" + F + ": the shot touches its edge (" + e + " px)"); }
    const sh = Math.round((F - 4 * a - lo - 1) / a) * a, base = lo + 1 + sh, top = hi + sh, h = Math.ceil((base - top) / a); // the baseline moved to 4a above the frame's foot
    const cs = Object.assign(document.createElement("canvas"), { width: F * COLS, height: F * ROWS.length }), g = cs.getContext("2d");
    g.imageSmoothingEnabled = false;
    ROWS.forEach(([name, n, loop, fn], row) => {
      json.rows[name] = { row, n, loop };
      for (let i = 0; i < n; i++) {
        const f = fn(i, h), x0 = i * F, y0 = row * F;
        g.save();
        g.beginPath(); g.rect(x0 + 1, y0 + 1, F - 2, (f.clip ? base : F - 1) - 1); g.clip();
        g.drawImage(shots[k][f.s], x0, y0 + sh + f.dy * a);
        g.restore();
      }
    });
    const d = g.getImageData(0, 0, cs.width, cs.height).data;
    let edge = 0;
    for (let y = 0; y < cs.height; y++) for (let x = 0; x < cs.width; x++) if ((x % F < 2 || x % F >= F - 2 || y % F < 2 || y % F >= F - 2) && d[(y * cs.width + x) * 4 + 3] > 8) edge++;
    if (edge) warn.push(NAMES[v] + "@" + F + ": " + edge + " px within 2 of a frame's edge");
    sheets[NAMES[v] + "@" + F] = cs.toDataURL("image/png");
    if (F === SIZES.at(-1)) raw[NAMES[v] + "@" + F] = [shots[k][0].src, shots[k][1].toDataURL(), shots[k][2].toDataURL(), two[k][1].src];
    (json.variants[NAMES[v]] ||= {})[F] = { frame: F, anchor: [F / 2, base], height: base - top };
  }
}
({ H0, mats: live.mats().length, missing: [...missing], warn, json, sheets, raw });
