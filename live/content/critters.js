/* Ambient wildlife: butterflies, dragonflies, bees, songbirds, squirrels, frogs, koi, minnows, bunnies,
   snails, beetles and lantern moths. Each is a small state machine over the baked scene: ground heights from the
   voxel grid, perches on the tree volumes' crowns (found in the model bricks, and swaying with the tree),
   the pond and streams, and the lanterns. Ground critters scatter when a walker (or anything an app
   marks with sim.avoid) comes close. It is an instance layer of the sim (sim.layers); splashes and dips
   are queued as water ripples (layer.ripples) for the renderer's ring waves. The ground comes from the
   bake's tiles (T.tiles: each tile's top and recipe), so it works on a generator map and a v1 map alike:
   carpets are the critters' moss, lanes and layers their walks. */
(function () {
  const ME = window.ME, TAU = Math.PI * 2;
  const COUNTS = { butterfly: 5, dragonfly: 2, bee: 3, bird: 5, squirrel: 2, frog: 3, koi: 4, bunny: 2, snail: 2, beetle: 2, moth: 4 }; // 34 (v0.1: 45)
  const TREES = new Set(["niwaki", "maple", "pine", "cedar", "fg_orange"]);
  // stamped props whose tops birds perch on (Fernglass's glass bays: the ridge and the cresting)
  const PERCH_PROPS = new Set(["fg_bay"]);
  const CLS = { carpet: "m", lane: "u", layer: "u", water: "w" }; // a tile's recipe as the critters see it
  // how far a koi keeps its middle from the pond's banks (tiles), so no part of it lies on the bank
  const KOI_M = 0.16;
  // the minnow shoal's places behind its leader (tiles: along, across), about a fish length apart
  const SHOAL = [[0, 0], [-0.34, -0.16], [-0.34, 0.16], [-0.66, 0], [-0.68, -0.3], [-0.68, 0.3], [-0.98, 0.14]];
  const lerp = (a, b, u) => a + (b - a) * u, ease = (u) => u * u * (3 - 2 * u), clamp01 = (u) => Math.max(0, Math.min(1, u));
  const frame = (fr, rate, t, ph = 0) => fr[Math.floor((((t * rate + ph) % 1) + 1) % 1 * fr.length) % fr.length];

  class Critters {
    // (o.beamAt(i, t): where sun pool i is at t, the renderer's R.beamAt; without it sunAt asks ME.app.R)
    constructor(T, st, MB, lights, o = {}) {
      this.beamAt = o.beamAt || null;
      this.T = T; this.MB = MB; this.F = MB.critterFrames; this.map = st.map; this.ripples = [];
      let seed = 0x2f6b9e1;
      this.rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const TL = T.tiles, inIsland = (x, y) => this.inside(x, y, 0.7);
      this.W = TL.W; this.H = TL.H; this.tz = TL.z; this.tc = Array.from(TL.recipe, (r) => CLS[r] || "_");
      for (const w of T.water) this.tc[w.y * TL.W + w.x] = "w"; // a wet tile is water whatever its recipe (a flooded carpet)
      this.cells = { m: [], u: [] };
      for (let y = 0; y < TL.H; y++) for (let x = 0; x < TL.W; x++) { const t = this.tc[y * TL.W + x]; if (this.cells[t] && inIsland(x + 0.5, y + 0.5)) this.cells[t].push([x, y]); }
      // trees and their crown perches (top voxel of the volume at sampled offsets)
      this.trees = MB.statics.filter((s) => TREES.has(s.place.name)).map((s) => ({ s, X: s.place.X, Y: s.place.Y, Z: s.place.Z, h: MB.models[s.frames[0]].h, r: MB.models[s.frames[0]].r }));
      this.perches = [];
      for (const tr of this.trees) {
        let n = 0;
        for (let k = 0; k < 40 && n < 6; k++) {
          const a = this.rnd() * TAU, d = Math.sqrt(this.rnd()) * tr.r * 0.75, dx = Math.cos(a) * d, dy = Math.sin(a) * d, z = this.crownTop(tr.s, dx, dy);
          if (z !== null && z > tr.Z + tr.h * 0.45) { this.perches.push({ x: tr.X + dx, y: tr.Y + dy, z, tree: tr }); n++; }
        }
      }
      // perches on the tops of the perch props (they don't sway): the highest ground near the anchor, if it
      // stands well over the prop's own tile
      for (const d of (st.map.v === 1 ? st.map.props : st.deco) || []) {
        if (!d || !PERCH_PROPS.has(d[0])) continue;
        const at = d[4] || {}, X0 = d[2] + 0.5 + (at.dx || 0), Y0 = d[3] + 0.5 + (at.dy || 0), Z0 = this.hgt(d[2], d[3]), still = { s: {}, X: X0, Y: Y0, Z: Z0 };
        for (let k = 0, n = 0; k < 24 && n < 3; k++) {
          const a = this.rnd() * TAU, r = 0.2 + this.rnd() * 0.5, x = X0 + Math.cos(a) * r, y = Y0 + Math.sin(a) * r, z = T.groundAt(x, y, Z0 + 2.5);
          if (z > Z0 + 1.0) { this.perches.push({ x, y, z, tree: still }); n++; }
        }
      }
      // water: all wet tiles for dragonflies; the deep still ones are the pond (koi); banks are moss beside water
      this.wet = T.water.map((w) => ({ x: w.x, y: w.y, z: w.z, bed: T.groundAt(w.x + 0.5, w.y + 0.5, w.z), stream: w.stream }));
      this.pond = this.wet.filter((w) => !w.stream && w.z - w.bed > 0.25);
      const wetAt = new Map(this.wet.map((w) => [w.x + "," + w.y, w]));
      this.wetAt = (x, y) => wetAt.get(Math.floor(x) + "," + Math.floor(y));
      this.banks = [];
      for (const [x, y] of this.cells.m) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const w = wetAt.get(x + dx + "," + (y + dy));
        if (w && Math.abs(w.z - this.hgt(x, y)) < 0.6) this.banks.push({ x: x + 0.5 + dx * 0.32, y: y + 0.5 + dy * 0.32, wx: x + 0.5 + dx * 0.85, wy: y + 0.5 + dy * 0.85, w });
      }
      this.lamps = lights.filter((l) => l.mat === "glow" || l.mat === "lanternPaper" || l.mat === "candle" || !l.mat); // (no mat: a map's own lights)
      this.agents = [];
      for (const kind in COUNTS) for (let k = 0; k < COUNTS[kind]; k++) this.agents.push({ kind, k, ph: this.rnd(), seed: this.rnd() });
      // a map's own extra critters (ME.content.critterExtra by map id: Fernglass's minnow school) and the
      // lily pads a frog sits on (ME.content.padTop: a pad's top over its prop's base, by model). The extras
      // draw from their own random stream, so a map without them keeps its critters exactly as before.
      const CT = ME.content || {}, extra = (CT.critterExtra || {})[st.map.id] || {}, padTop = CT.padTop || {};
      let seed2 = 0x5ec2a17;
      this.rnd2 = () => { seed2 = (seed2 + 0x6d2b79f5) | 0; let t = Math.imul(seed2 ^ (seed2 >>> 15), 1 | seed2); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      this.extra = Object.keys(extra).some((kind) => kind !== "wisp");
      for (const kind in extra) if (kind !== "wisp") for (let k = 0; k < extra[kind]; k++) this.agents.push({ kind, k, ph: this.rnd2(), seed: this.rnd2() });
      // the garden wisplings (extra kind wisp, the app's flipbooks wisp0..7): a third stream, so the other critters
      // keep their places and their draws; each map shows its own run of the eight designs
      let seed3 = 0x7a15e33, d0 = 0;
      this.rnd3 = () => { seed3 = (seed3 + 0x6d2b79f5) | 0; let t = Math.imul(seed3 ^ (seed3 >>> 15), 1 | seed3); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (const c of st.map.id || "") d0 += c.charCodeAt(0);
      for (let k = 0; k < (extra.wisp || 0); k++) this.agents.push({ kind: "wisp", k, d: (d0 + k) % 8, ph: this.rnd3(), seed: this.rnd3() });
      this.pads = MB.statics.filter((s) => padTop[s.place.name] !== undefined).map((s) => ({ x: s.place.X, y: s.place.Y, z: s.place.Z + padTop[s.place.name] }));
      this.lastT = null;
    }

    // world z of the top voxel of a static volume at local offset (dx, dy), or null
    crownTop(s, dx, dy) {
      const MB = this.MB, m = MB.models[s.frames[0]], VS = this.T.VS, p = s.place;
      const [rx, ry] = p.rot ? ME.rotQ(dx, dy, 4 - p.rot) : [dx, dy]; // world offset to the model's: undo the turn, then the mirror
      const [lx, ly] = p.flip ? [ry, rx] : [rx, ry], ix = Math.floor(lx * VS) - m.box[0], iy = Math.floor(ly * VS) - m.box[1];
      if (ix < 0 || iy < 0 || ix >= m.dims[0] || iy >= m.dims[1]) return null;
      for (let z = m.dims[2] - 1; z >= 0; z--) if (MB.voxel(s.frames[0], ix, iy, z)) return p.Z + (m.box[2] + z + 1) / VS;
      return null;
    }
    // a tile's top (tiles) and its class (m moss, u walk, w water, _ none) at a world point
    hgt(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= this.W || cy >= this.H ? -9 : this.tz[cy * this.W + cx]; }
    typ(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= this.W || cy >= this.H ? "_" : this.tc[cy * this.W + cx]; }
    // inside the island by margin m (the jar's circle; a box frame's bounds)
    inside(x, y, m) { const g = this.T.geo, b = this.T.bounds; return g ? Math.hypot(x - g.C, y - g.C) < g.RI - m : x > b.min[0] + m && y > b.min[1] + m && x < b.max[0] - m && y < b.max[1] - m; }
    gz(x, y) { return this.T.groundAt(x, y, this.hgt(x, y) + 0.6); }
    // the moss nearest a sun pool whose own foot has none (on water, a lane or a terrace's lip): rings out to r1,
    // the nearest moss point clear of trunks, then a spot on its terrace round it
    ringMoss(x, y, r1 = 2.4) {
      for (let r = 0.3; r <= r1; r += 0.3) for (let k = 0, n = Math.ceil((TAU * r) / 0.3); k < n; k++) {
        const a = (k / n) * TAU, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (this.typ(px, py) !== "m" || !this.inside(px, py, 0.6) || this.trees.some((t) => Math.hypot(t.X - px, t.Y - py) < 0.3)) continue;
        return this.spot(px, py, 0, 0.6) || [px, py, this.gz(px, py)];
      }
      return null;
    }
    // a ground point near (x, y): same terrace, on moss (or lanes), clear of tree trunks, straight path
    // (R: the random stream, the critters' own by default)
    spot(x, y, r0, r1, lanes, R = this.rnd) {
      const h = this.hgt(x, y), ok = (px, py) => { const t = this.typ(px, py); return (t === "m" || (lanes && t === "u")) && this.hgt(px, py) === h && this.inside(px, py, 0.6); };
      for (let k = 0; k < 14; k++) {
        const a = R() * TAU, d = lerp(r0, r1, R()), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        if (!ok(px, py) || !ok((x + px) / 2, (y + py) / 2) || this.trees.some((t) => Math.hypot(t.X - px, t.Y - py) < 0.3)) continue;
        return [px, py, this.gz(px, py)];
      }
      return null;
    }
    anyMoss(R = this.rnd) { const c = this.cells.m[Math.floor(R() * this.cells.m.length)]; return [c[0] + 0.15 + R() * 0.7, c[1] + 0.15 + R() * 0.7]; }
    // sun pool i where the shaft pass draws it at t (R.beamAt: the pools drift); its fixed foot without a renderer
    sunAt(i, t) { if (this.beamAt) return this.beamAt(i, t); const R = ME.app && ME.app.R, b = this.T.beams[i]; return R && R.beamAt ? R.beamAt(i, t) : [b.x, b.y]; }
    wetPoint(w) { return [w.x + 0.15 + this.rnd() * 0.7, w.y + 0.15 + this.rnd() * 0.7]; }
    threat(a, R) {
      const W = this.wpos;
      for (let i = 0; i < this.wn; i++) if (Math.abs(W[i * 2] - a.x) < R && Math.abs(W[i * 2 + 1] - a.y) < R && Math.hypot(W[i * 2] - a.x, W[i * 2 + 1] - a.y) < R) return [W[i * 2], W[i * 2 + 1]];
      return null;
    }
    ripple(x, y, t, amp) { this.ripples.push({ x, y, t, amp }); if (this.ripples.length > 64) this.ripples.shift(); }
    // start a timed move from the current position
    go(a, state, to, t, dur, extra) { Object.assign(a, { state, from: [a.x, a.y, a.z], to, t0: t, end: t + dur }, extra || {}); if (to && (to[0] !== a.x || to[1] !== a.y)) a.yaw = Math.atan2(to[1] - a.y, to[0] - a.x); }
    wait(a, state, t, dur, extra) { Object.assign(a, { state, t0: t, end: t + dur }, extra || {}); }

    // ---- per-kind behaviour: init places the agent, decide picks the next state when one ends,
    //      pose(a, t, dt) sets x,y,z,yaw,pitch and the model frame mi (or a.hide)
    init(a, t) {
      if (a.kind === "wisp") return this.wispInit(a, t);
      const R = this.rnd;
      a.yaw = R() * TAU; a.pitch = 0; a.hide = false;
      const place = (p) => { a.x = p[0]; a.y = p[1]; a.z = this.gz(p[0], p[1]); };
      switch (a.kind) {
        case "butterfly": {
          // every other one keeps to a sun pool (a.sun, its beam) and follows it as it drifts
          const nb = this.T.beams.length;
          if (nb && a.k % 2 === 0) a.sun = a.k % nb;
          const s = a.sun !== undefined ? this.sunAt(a.sun, t) : this.anyMoss();
          a.home = this.spot(s[0], s[1], 0, 1.2) || (a.sun !== undefined && this.ringMoss(s[0], s[1])) || [...this.anyMoss()];
          place(a.home); a.fr = this.F[["butterflyOrange", "butterflyBlue", "butterflyYellow"][a.k % 3]];
          this.go(a, "fly", null, t, 0);
          break;
        }
        case "dragonfly": { if (!this.wet.length) { a.dead = a.hide = true; break; } const w = this.wet[Math.floor(R() * this.wet.length)], p = this.wetPoint(w); a.x = p[0]; a.y = p[1]; a.z = w.z + 0.3; this.wait(a, "hover", t, R()); break; }
        case "bee": { const f = MB_FERNS(this) || this.anyMoss(); a.h0 = a.h1 = [f[0], f[1]]; a.t0 = t; a.trav = 1; a.end = t + 6 + R() * 8; a.x = f[0]; a.y = f[1]; a.z = this.gz(f[0], f[1]) + 0.3; a.state = "buzz"; break; }
        case "bird": {
          a.col = a.k % 3 === 2 ? "tit" : "robin";
          if (a.k % 3 === 1 && this.perches.length) { const p = this.perches[Math.floor(R() * this.perches.length)]; a.perch = p; a.x = p.x; a.y = p.y; a.z = p.z; this.wait(a, "perch", t, 2 + R() * 6); }
          else { place(this.anyMoss()); this.wait(a, "stand", t, R() * 1.5); }
          break;
        }
        case "squirrel": { if (!this.trees.length) { a.dead = a.hide = true; break; } a.tree = this.trees[a.k % this.trees.length]; place(this.spot(a.tree.X, a.tree.Y, 0.5, 1.6) || this.anyMoss()); this.wait(a, "sit", t, 0.5 + R() * 2); break; }
        case "frog": {
          // the first frog sits on a lily pad if the map has one
          if (a.k === 0 && this.pads.length) { a.pad = this.pads[0]; a.x = a.pad.x; a.y = a.pad.y; a.z = a.pad.z; this.wait(a, "sit", t, 1 + R() * 4); break; }
          const b = this.banks[Math.floor(R() * this.banks.length)]; if (!b) { a.hide = true; a.dead = true; break; } a.bank = b; place([b.x, b.y]); a.yaw = Math.atan2(b.wy - b.y, b.wx - b.x); this.wait(a, "sit", t, 1 + R() * 4); break; }
        case "koi": {
          if (!this.pond.length) { a.dead = a.hide = true; break; }
          const p = this.koiSpot();
          Object.assign(a, { x: p[0], y: p[1], speed: 0.2 + R() * 0.12, cyc: R(), nextJump: t + 6 + R() * 18, fr: this.F[["koiKohaku", "koiKohaku2", "koiOgon", "koiKohaku"][a.k % 4]] });
          a.z = this.koiZ(a.x, a.y); a.tgt = this.koiSpot(); a.state = "swim"; a.end = Infinity;
          break;
        }
        case "minnow": {
          if (!this.pond.length) { a.dead = a.hide = true; break; }
          // a place in the loose shoal behind its leader (SHOAL, about a fish length apart), and a lag in
          // following its turns; the school starts where the whole shoal is in open water
          const R2 = this.rnd2, o = SHOAL[a.k % SHOAL.length];
          a.off = [o[0] + (R2() - 0.5) * 0.05, o[1] + (R2() - 0.5) * 0.05]; a.lag = 3.5 + R2() * 2; a.cyc = R2();
          if (!this.school) this.school = this.schoolStart();
          const s = this.school, [ox, oy] = a.off;
          a.yaw = s.yaw;
          for (let f = 1; f > 0.05; f *= 0.5) {
            a.x = s.x + (Math.cos(s.yaw) * ox - Math.sin(s.yaw) * oy) * f; a.y = s.y + (Math.sin(s.yaw) * ox + Math.cos(s.yaw) * oy) * f;
            if (this.openWater(a.x, a.y, 0.1)) break;
          }
          a.z = this.minnowZ(a); a.state = "school"; a.end = Infinity;
          break;
        }
        case "bunny": place(this.anyMoss()); this.wait(a, "sit", t, R() * 3); break;
        case "snail": { const b = this.banks.length && a.k < 2 ? this.banks[Math.floor(R() * this.banks.length)] : null; place(b ? [b.x, b.y] : this.anyMoss()); this.wait(a, "pause", t, R() * 3); break; }
        case "beetle": place(this.anyMoss()); this.wait(a, "pause", t, R() * 2); break;
        case "moth": a.lamp = this.lamps.length ? this.lamps[a.k % this.lamps.length] : null; if (!a.lamp) a.dead = a.hide = true; a.state = "orbit"; a.end = Infinity; break;
      }
    }

    decide(a, t) {
      if (a.kind === "wisp") return this.wispDecide(a, t);
      const R = this.rnd;
      switch (a.kind) {
        case "butterfly": {
          if (a.state === "fly" && a.to && R() < 0.35) { this.wait(a, "perch", t, 1.5 + R() * 4); a.z = a.to[2] = this.gz(a.x, a.y); break; }
          const c = a.sun !== undefined ? this.sunAt(a.sun, t) : a.home;
          const p = this.spot(c[0], c[1], 0, 1.6) || (a.sun !== undefined && this.ringMoss(c[0], c[1])) || this.spot(a.home[0], a.home[1], 0, 1.6) ||[a.home[0], a.home[1], this.gz(a.home[0], a.home[1])];
          p[2] += 0.2 + R() * 0.5;
          this.go(a, "fly", p, t, 0.8 + Math.hypot(p[0] - a.x, p[1] - a.y) / 0.45);
          break;
        }
        case "dragonfly": {
          if (a.state === "dart" && R() < 0.18) { this.go(a, "dip", [a.x, a.y, this.wetAt(a.x, a.y) ? this.wetAt(a.x, a.y).z + 0.02 : a.z], t, 0.55); break; }
          if (a.state !== "hover") { this.wait(a, "hover", t, 0.5 + R() * 1.6); break; }
          const near = this.wet.filter((w) => Math.hypot(w.x + 0.5 - a.x, w.y + 0.5 - a.y) < 1.8), w = near[Math.floor(R() * near.length)] || this.wet[0], p = this.wetPoint(w);
          this.go(a, "dart", [p[0], p[1], w.z + 0.18 + R() * 0.35], t, 0.28 + R() * 0.2);
          break;
        }
        case "bee": {
          // drift on to another fern nearby
          const f = MB_FERNS(this, a.h1, 4) || a.h1;
          a.h0 = a.h1; a.h1 = [f[0], f[1]]; a.t0 = t; a.trav = Math.max(1.5, Math.hypot(f[0] - a.h0[0], f[1] - a.h0[1]));
          a.end = t + a.trav + 5 + R() * 8;
          break;
        }
        case "koi": { a.x = a.to[0]; a.y = a.to[1]; a.z = a.to[2]; a.state = "swim"; a.end = Infinity; a.nextJump = t + 10 + R() * 25; break; }
        case "bird": this.birdDecide(a, t); break;
        case "squirrel": this.squirrelDecide(a, t); break;
        case "frog": {
          const b = a.bank, pd = a.pad;
          if (pd) {
            // the pad frog: dives off the pad now and then, comes up beside it and hops back on
            if (a.state === "dive") { this.ripple(a.x, a.y, t, 1); a.hide = true; this.wait(a, "under", t, 3 + R() * 6); break; }
            if (a.state === "under") { const an = R() * TAU; a.hide = false; a.x = pd.x + Math.cos(an) * 0.32; a.y = pd.y + Math.sin(an) * 0.32; a.z = pd.z - 0.08; this.ripple(a.x, a.y, t, 0.7); this.go(a, "hop", [pd.x, pd.y, pd.z], t, 0.45); break; }
            if (a.state === "sit" && R() < 0.2) { const an = R() * TAU; this.go(a, "dive", [pd.x + Math.cos(an) * 0.32, pd.y + Math.sin(an) * 0.32, pd.z - 0.1], t, 0.45); break; }
            a.yaw += (R() - 0.5) * 0.8; this.wait(a, "sit", t, 2 + R() * 5);
            break;
          }
          if (a.state === "dive") { this.ripple(a.x, a.y, t, 1); a.hide = true; this.wait(a, "under", t, 3 + R() * 6); break; }
          if (a.state === "under") {
            const nb = this.banks[Math.floor(R() * this.banks.length)]; a.bank = nb; a.hide = false;
            a.x = nb.wx; a.y = nb.wy; a.z = nb.w.z - 0.05; this.ripple(a.x, a.y, t, 0.7);
            this.go(a, "hop", [nb.x, nb.y, this.gz(nb.x, nb.y)], t, 0.45); break;
          }
          if (a.state === "sit") {
            const r = R();
            if (r < 0.25) { this.go(a, "dive", [b.wx + (R() - 0.5) * 0.3, b.wy + (R() - 0.5) * 0.3, b.w.z - 0.04], t, 0.45); break; }
            if (r < 0.6) { const p = this.spot(a.x, a.y, 0.15, 0.4); if (p) { this.go(a, "hop", p, t, 0.35); break; } }
          }
          a.yaw += (R() - 0.5) * 0.8; this.wait(a, "sit", t, 2 + R() * 5);
          break;
        }
        case "bunny": {
          // a run of short hops, then a long sit
          if (a.state === "hop" && a.hops > 0) { a.hops--; const p = this.hopFrom(a, a.flee ? 0.36 : 0.26); if (p) { this.go(a, "hop", p, t, a.flee ? 0.24 : 0.32); break; } }
          if (a.state === "sit") { a.hops = Math.floor(R() * 4); a.yaw += (R() - 0.5) * 2; const p = this.hopFrom(a, 0.26); if (p) { this.go(a, "hop", p, t, 0.32); break; } }
          a.flee = false; this.wait(a, "sit", t, 2 + R() * 5);
          break;
        }
        case "snail": case "beetle": {
          const sp = a.kind === "snail" ? 0.035 : 0.13;
          if (a.state === "pause" || R() < 0.4) { const p = this.spot(a.x, a.y, 0.2, a.kind === "snail" ? 0.4 : 0.9, a.kind === "beetle"); if (p) { this.go(a, "crawl", p, t, Math.hypot(p[0] - a.x, p[1] - a.y) / sp); break; } }
          this.wait(a, "pause", t, 1 + R() * 4);
          break;
        }
      }
    }

    hopFrom(a, d) {
      // keep heading roughly forward; turn if the way ahead is a ledge, water or a trunk
      for (let k = 0; k < 6; k++) {
        const yaw = a.yaw + (this.rnd() - 0.5) * (0.8 + k * 0.6), px = a.x + Math.cos(yaw) * d, py = a.y + Math.sin(yaw) * d;
        if (this.typ(px, py) === "m" && this.hgt(px, py) === this.hgt(a.x, a.y) && this.inside(px, py, 0.6) && !this.trees.some((t) => Math.hypot(t.X - px, t.Y - py) < 0.3)) return [px, py, this.gz(px, py)];
      }
      return null;
    }

    birdDecide(a, t) {
      const R = this.rnd, toPerch = () => {
        const p = this.perches.length ? this.perches[Math.floor(R() * this.perches.length)] : null;
        if (!p) return false;
        this.flyTo(a, [p.x, p.y, p.z], t, p); return true;
      };
      if (a.state === "fly") { if (a.perch) this.wait(a, "perch", t, 3 + R() * 7); else this.wait(a, "stand", t, 0.3 + R()); return; }
      if (a.state === "perch") {
        if (R() < 0.35) { a.yaw += (R() - 0.5) * 2.2; this.wait(a, "perch", t, 1 + R() * 3); return; }
        if (R() < 0.3 && toPerch()) return;
        const g = this.spot(a.x, a.y, 0.5, 3.5) || [...this.anyMoss(), 0]; g[2] = this.gz(g[0], g[1]);
        this.flyTo(a, g, t, null); return;
      }
      const r = R();
      if (r < 0.05 && toPerch()) return;
      if (r < 0.45) { const p = this.spot(a.x, a.y, 0.1, 0.26); if (p) { this.go(a, "hop", p, t, 0.2); return; } }
      if (r < 0.8) { this.wait(a, "peck", t, 0.28 + R() * 0.2); return; }
      a.yaw += (R() - 0.5) * 1.6; this.wait(a, "stand", t, 0.4 + R() * 1.3);
    }
    flyTo(a, to, t, perch) {
      const d = Math.hypot(to[0] - a.x, to[1] - a.y);
      this.go(a, "fly", to, t, 0.5 + d / 2.2, { perch, peak: Math.max(a.z, to[2]) + 0.35 + d * 0.18 });
    }

    squirrelDecide(a, t) {
      const R = this.rnd, tr = a.tree;
      switch (a.state) {
        case "run": this.wait(a, "sit", t, 1.2 + R() * 2.5); a.yaw += (R() - 0.5) * 1.5; return;
        case "toTree": {
          const z0 = a.z, top = tr.Z + Math.min(1.3, tr.h * 0.45);
          a.yaw = Math.atan2(tr.Y - a.y, tr.X - a.x);
          this.go(a, "climb", [a.x, a.y, top], t, (top - z0) / 0.9); a.yaw = Math.atan2(tr.Y - a.y, tr.X - a.x);
          return;
        }
        case "climb": this.wait(a, "hidden", t, 2 + R() * 4); return;
        case "hidden": { const g = this.gz(a.x, a.y); this.go(a, "descend", [a.x, a.y, g], t, (a.z - g) / 1.1); a.yaw = Math.atan2(a.y - tr.Y, a.x - tr.X); return; }
        case "descend": case "sit": default: {
          if (a.state === "sit" && R() < 0.22) return this.runToTree(a, t, 1.5);
          const p = this.spot(a.x, a.y, 0.8, 2.2) || this.spot(tr.X, tr.Y, 0.6, 1.8);
          if (p) { this.go(a, "run", p, t, Math.hypot(p[0] - a.x, p[1] - a.y) / 1.5); return; }
          this.wait(a, "sit", t, 1 + R() * 2);
        }
      }
    }
    runToTree(a, t, speed) {
      const tr = a.tree, ang = Math.atan2(a.y - tr.Y, a.x - tr.X), bx = tr.X + Math.cos(ang) * 0.16, by = tr.Y + Math.sin(ang) * 0.16;
      this.go(a, "toTree", [bx, by, this.gz(bx, by)], t, Math.max(0.2, Math.hypot(bx - a.x, by - a.y) / speed));
    }

    koiZ(x, y) { const w = this.wetAt(x, y); return w ? Math.max(w.bed + 0.02, w.z - 0.17) : this.gz(x, y); }
    // the minnows: deep still water, a point in it, and each fish's depth (high in the water, where it reads,
    // bobbing a little, always wholly under the surface)
    inPond(x, y) { const w = this.wetAt(x, y); return !!w && !w.stream && w.z - w.bed > 0.2; }
    // in the pond and m clear of its banks
    clear(x, y, m) { return [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dy]) => this.inPond(x + dx, y + dy)); }
    // ... and not under a bridge (the map's game.bridges), where nobody sees it
    openWater(x, y, m) {
      if (!this.bridged) this.bridged = new Set((((this.map || {}).game || {}).bridges || []).map(([bx, by]) => bx + "," + by));
      return !this.bridged.has(Math.floor(x) + "," + Math.floor(y)) && this.clear(x, y, m);
    }
    pondPoint(R = this.rnd2) { const w = this.pond[Math.floor(R() * this.pond.length)]; return [w.x + 0.35 + R() * 0.3, w.y + 0.35 + R() * 0.3]; }
    // a koi's spot: the middle of a pond tile, always KOI_M clear of the banks (a wetPoint at a tile's edge
    // could sit half in the bank, and a koi steering for it pressed against the bank for good)
    koiSpot() { return this.pondPoint(this.rnd); }
    // the middle of the pond tile nearest (x, y) and how far it is
    nearPond(x, y) {
      let best = null, bd = Infinity;
      for (const w of this.pond) { const d = (w.x + 0.5 - x) ** 2 + (w.y + 0.5 - y) ** 2; if (d < bd) { bd = d; best = [w.x + 0.5, w.y + 0.5]; } }
      return [best, Math.sqrt(bd)];
    }
    // a koi's swim: steer toward a wandering target inside the pond. Blocked by a bank, it turns away one
    // way, smoothly, and keeps that way a moment after it's free (turnT), with a new target: a quarter turn
    // each blocked frame, toward the target and back, left a koi in a corner flipping 90 degrees every frame
    // for good. A move must leave it KOI_M clear of the banks with its nose in the pond (only its middle was
    // checked, so a koi swam up to a tile's edge and lay half on the bank)
    koiSwim(a, dt) {
      const dx = a.tgt[0] - a.x, dy = a.tgt[1] - a.y;
      if (Math.hypot(dx, dy) < 0.25) a.tgt = this.koiSpot();
      let da = Math.atan2(dy, dx) - a.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (a.turnT > 0) { a.turnT -= dt; a.yaw += a.turnDir * 2.2 * dt; }
      else a.yaw += Math.max(-1.3 * dt, Math.min(1.3 * dt, da));
      const c = Math.cos(a.yaw), s = Math.sin(a.yaw), nx = a.x + c * a.speed * dt, ny = a.y + s * a.speed * dt;
      if (this.clear(nx, ny, KOI_M) && this.inPond(nx + c * 0.26, ny + s * 0.26)) { a.x = nx; a.y = ny; }
      else {
        if (!(a.turnT > 0)) { a.turnDir = Math.sign(da || 1); a.tgt = this.koiSpot(); }
        a.turnT = 0.4;
      }
    }
    // a stranded koi: in the water still, it heads for the middle of the nearest pond tile at a quick swim;
    // one on land, or more than a tile and a half from the pond, is put back in it
    koiHome(a, dt) {
      const [p, d] = this.nearPond(a.x, a.y);
      if (d > 1.5 || !this.wetAt(a.x, a.y)) { [a.x, a.y] = this.koiSpot(); a.z = this.koiZ(a.x, a.y); a.tgt = this.koiSpot(); return; }
      const v = Math.min(d, Math.max(0.45, a.speed) * dt);
      let da = Math.atan2(p[1] - a.y, p[0] - a.x) - a.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      a.yaw += Math.max(-4 * dt, Math.min(4 * dt, da));
      a.x += (p[0] - a.x) / (d || 1) * v; a.y += (p[1] - a.y) / (d || 1) * v;
      a.turnT = 0;
    }
    // the school's start: a point and a heading along the pond's channels where every place in the shoal is
    // open water (the best of a few tries)
    schoolStart() {
      const R = this.rnd2;
      let best = null, bestN = -1;
      for (let k = 0; k < 48 && bestN < SHOAL.length; k++) {
        const [x, y] = this.pondPoint(), yaw = Math.floor(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.4, c = Math.cos(yaw), s = Math.sin(yaw);
        const n = SHOAL.filter(([ox, oy]) => this.openWater(x + c * ox - s * oy, y + s * ox + c * oy, 0.1)).length;
        if (n > bestN) { bestN = n; best = { x, y, yaw, v: 0.28, tgt: this.pondPoint(), t: null }; }
      }
      return best;
    }
    minnowZ(a) { const w = this.wetAt(a.x, a.y); return w ? Math.max(w.bed + 0.04, w.z - 0.16 + 0.02 * Math.sin((this.lastT || 0) * 0.9 + a.ph * 6)) : a.z; }
    // the school's leader: wanders the pond toward a target, darting now and then; all its fish turn with it
    schoolStep(dt) {
      const s = this.school, R = this.rnd2;
      if (!this.openWater(s.x, s.y, 0.05)) Object.assign(s, this.schoolStart()); // (a leader out of open water starts over)
      if (Math.hypot(s.tgt[0] - s.x, s.tgt[1] - s.y) < 0.3) s.tgt = this.pondPoint();
      if (R() < dt * 0.12) { s.v = 0.85; s.yaw += (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.8); }
      s.v += (0.28 - s.v) * Math.min(1, dt * 1.4);
      let da = Math.atan2(s.tgt[1] - s.y, s.tgt[0] - s.x) - s.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      s.yaw += Math.max(-1.8 * dt, Math.min(1.8 * dt, da));
      const nx = s.x + Math.cos(s.yaw) * s.v * dt, ny = s.y + Math.sin(s.yaw) * s.v * dt;
      if (this.openWater(nx, ny, 0.15) && this.inPond(nx + Math.cos(s.yaw) * 0.35, ny + Math.sin(s.yaw) * 0.35)) { s.x = nx; s.y = ny; }
      else { s.yaw += Math.PI * 0.6 * Math.sign(da || 1); s.tgt = this.pondPoint(); }
    }

    pose(a, t, dt) {
      const F = this.F, u = a.end > a.t0 ? clamp01((t - a.t0) / (a.end - a.t0)) : 1, mv = () => { if (!a.to) return; a.x = lerp(a.from[0], a.to[0], u); a.y = lerp(a.from[1], a.to[1], u); };
      a.pitch = 0;
      if (a.kind === "wisp") return this.wispPose(a, t, u, mv);
      switch (a.kind) {
        case "butterfly": {
          if (a.state === "perch") { a.mi = frame(a.fr, 0.6, t, a.ph); break; }
          if (a.to) {
            const e = ease(u), px = -Math.sin(a.yaw), py = Math.cos(a.yaw), wob = Math.sin(u * Math.PI * 3 + a.ph * 9) * 0.1 * Math.sin(u * Math.PI);
            const g = ME.gust(a.x, a.y, t, this.windK, this.gustS) * 0.12;
            a.x = lerp(a.from[0], a.to[0], e) + px * wob + ME.WIND_DIR[0] * g; a.y = lerp(a.from[1], a.to[1], e) + py * wob + ME.WIND_DIR[1] * g;
            a.z = lerp(a.from[2], a.to[2], e) + Math.sin(u * Math.PI) * 0.15 + Math.sin(t * 9 + a.ph * 20) * 0.03;
          }
          a.mi = frame(a.fr, 7, t, a.ph);
          break;
        }
        case "dragonfly": {
          if (a.state === "dart") { const e = ease(u); a.x = lerp(a.from[0], a.to[0], e); a.y = lerp(a.from[1], a.to[1], e); a.z = lerp(a.from[2], a.to[2], e); }
          else if (a.state === "dip") { const s = Math.sin(u * Math.PI); a.z = lerp(a.from[2], a.to[2], s); if (u > 0.5 && !a.dipped) { a.dipped = true; this.ripple(a.x, a.y, t, 0.35); } if (u < 0.5) a.dipped = false; }
          a.mi = F.dragonfly[Math.floor(t * 28 + a.ph * 2) % 2];
          a.zOff = a.state === "hover" ? Math.sin(t * 5 + a.ph * 9) * 0.015 : 0;
          break;
        }
        case "bee": {
          const e = ease(clamp01((t - a.t0) / a.trav)), hx = lerp(a.h0[0], a.h1[0], e), hy = lerp(a.h0[1], a.h1[1], e), ph = a.ph * 20;
          const at = (s) => [hx + 0.32 * Math.sin(s * 0.9 + ph) + 0.1 * Math.sin(s * 4.3 + 2 * ph), hy + 0.28 * Math.sin(s * 1.17 + ph * 1.3) + 0.1 * Math.cos(s * 3.7 + ph)];
          const p = at(t), q = at(t + 0.05);
          a.x = p[0]; a.y = p[1]; a.z = this.gz(hx, hy) + 0.26 + 0.08 * Math.sin(t * 2.3 + ph); a.yaw = Math.atan2(q[1] - p[1], q[0] - p[0]);
          a.mi = F.bee[Math.floor(t * 30) % 2];
          break;
        }
        case "bird": {
          const B = (s) => F[a.col + s];
          if (a.state === "fly") {
            const e = u, c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2, a.peak], q = (i) => (1 - e) * (1 - e) * a.from[i] + 2 * (1 - e) * e * c[i] + e * e * a.to[i];
            a.x = q(0); a.y = q(1); a.z = q(2);
            a.pitch = Math.atan2(2 * ((1 - e) * (c[2] - a.from[2]) + e * (a.to[2] - c[2])), Math.max(0.3, Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]))) * 0.4;
            // bounding flight: a burst of beats, then a glide with the wings tucked
            a.mi = (t * 1.7 + a.ph) % 1 < 0.68 || u > 0.85 ? frame(B("Fly"), 7, t, a.ph) : B("Fly")[3];
          } else if (a.state === "perch") {
            const p = a.perch, sh = p.tree.s.wsh || [0, 0], dz = p.z - p.tree.Z;
            a.x = p.x + sh[0] * dz; a.y = p.y + sh[1] * dz; a.z = p.z; a.mi = B("Stand")[0];
          } else {
            if (a.state === "hop") { mv(); a.z = this.gz(a.x, a.y) + Math.sin(u * Math.PI) * 0.05; }
            else a.z = this.gz(a.x, a.y);
            a.mi = a.state === "peck" && u < 0.6 ? B("Peck")[0] : B("Stand")[0];
          }
          break;
        }
        case "squirrel": {
          if (a.state === "run" || a.state === "toTree") { mv(); a.z = this.gz(a.x, a.y); a.mi = frame(F.squirrelRun, 4.5, t, a.ph); }
          else if (a.state === "climb" || a.state === "descend") { a.z = lerp(a.from[2], a.to[2], u); a.pitch = a.state === "climb" ? Math.PI / 2 : -Math.PI / 2; a.mi = frame(F.squirrelRun, 3.5, t, a.ph); }
          else if (a.state === "hidden") { a.pitch = Math.PI / 2; a.mi = F.squirrelRun[0]; }
          else { a.z = this.gz(a.x, a.y); a.mi = frame(F.squirrelSit, 2.5, t, a.ph); }
          break;
        }
        case "frog": {
          if (a.state === "sit") { a.z = a.pad ? a.pad.z : this.gz(a.x, a.y); a.mi = frame(F.frogSit, 1.3, t, a.ph); break; }
          if (a.state === "under") break;
          mv(); a.z = lerp(a.from[2], a.to[2], u) + Math.sin(u * Math.PI) * 0.13; a.pitch = (0.5 - u) * 0.9; a.mi = F.frogJump[0];
          break;
        }
        case "koi": {
          if (a.state === "jump") {
            mv(); const w = this.wetAt(a.x, a.y), sz = w ? w.z : a.from[2];
            a.z = lerp(a.from[2], a.to[2], u) + Math.sin(u * Math.PI) * (sz - a.from[2] + 0.28);
            a.pitch = Math.cos(u * Math.PI) * 1.0;
            if (!a.splash1 && u > 0.18) { a.splash1 = true; this.ripple(a.x, a.y, t, 0.8); }
            if (!a.splash2 && u > 0.84) { a.splash2 = true; this.ripple(a.x, a.y, t, 1.2); }
            a.mi = a.fr[1];
            break;
          }
          // a koi out of the pond or pressed against a bank swims back to open water first (none should get
          // there now; this keeps one from staying, whatever put it there)
          if (this.clear(a.x, a.y, KOI_M)) this.koiSwim(a, dt); else this.koiHome(a, dt);
          a.z = lerp(a.z, this.koiZ(a.x, a.y), Math.min(1, dt * 2));
          a.cyc += dt * (1.2 + a.speed * 6);
          a.mi = a.fr[Math.floor((a.cyc % 1) * a.fr.length)];
          // a map with extras (Fernglass) has its koi blow a bubble now and then, once the engine has them
          if (this.extra && ME.water && ME.water.bubble && this.rnd2() < dt * 0.12) ME.water.bubble(a.x + Math.cos(a.yaw) * 0.12, a.y + Math.sin(a.yaw) * 0.12, a.z + 0.05);
          if (t > a.nextJump) {
            // it lands in the pond, clear of the banks (any wet tile would do: one jump into the shallows or a
            // stream left a koi there for good, every move refused)
            const L = 0.5, tx = a.x + Math.cos(a.yaw) * L, ty = a.y + Math.sin(a.yaw) * L;
            if (this.clear(tx, ty, KOI_M)) this.go(a, "jump", [tx, ty, this.koiZ(tx, ty)], t, 0.8, { splash1: false, splash2: false });
            else a.nextJump = t + 2;
          }
          break;
        }
        case "minnow": {
          // the first fish moves the school; each keeps its place round the leader, turning after it with a
          // little lag so a turn ripples through the school
          const s = this.school;
          if (a.k === 0 && s.t !== t) { s.t = t; this.schoolStep(dt); }
          let da = s.yaw - a.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
          a.yaw += Math.max(-a.lag * dt, Math.min(a.lag * dt, da));
          const [ox, oy] = a.off, wob = 0.025 * Math.sin(t * 1.3 + a.ph * 9);
          const tx = s.x + Math.cos(a.yaw) * ox - Math.sin(a.yaw) * (oy + wob), ty = s.y + Math.sin(a.yaw) * ox + Math.cos(a.yaw) * (oy + wob);
          // it eases toward its place only through the pond (cutting a corner of the bank left a fish on land);
          // one that is out of the pond all the same goes back to its leader
          if (this.inPond(tx, ty)) { const k = Math.min(1, dt * 5), x = lerp(a.x, tx, k), y = lerp(a.y, ty, k); if (this.inPond(x, y)) { a.x = x; a.y = y; } }
          if (!this.inPond(a.x, a.y)) { a.x = s.x; a.y = s.y; }
          a.z = lerp(a.z, this.minnowZ(a), Math.min(1, dt * 2));
          a.cyc += dt * (3 + s.v * 12);
          a.mi = F.minnow[Math.floor((a.cyc % 1) * F.minnow.length)];
          break;
        }
        case "bunny": {
          if (a.state === "hop") { mv(); a.z = lerp(a.from[2], a.to[2], u) + Math.sin(u * Math.PI) * 0.09; a.mi = F.bunnyHop[Math.min(3, Math.floor(u * 4))]; }
          else { a.z = this.gz(a.x, a.y); a.mi = (t * 0.7 + a.ph) % 1 < 0.15 ? F.bunnySit[1] : F.bunnySit[0]; }
          break;
        }
        case "snail": case "beetle": {
          if (a.state === "crawl") mv();
          a.z = this.gz(a.x, a.y);
          a.mi = a.state === "crawl" ? frame(F[a.kind], a.kind === "snail" ? 0.6 : 6, t, a.ph) : F[a.kind][0];
          break;
        }
        case "moth": {
          const L = a.lamp, ph = a.ph * TAU, ang = t * (1.4 + 0.5 * Math.sin(ph)) + ph, r = 0.26 + 0.08 * Math.sin(t * 1.7 + ph);
          a.x = L.p[0] + Math.cos(ang) * r + 0.04 * Math.sin(t * 7 + ph); a.y = L.p[1] + Math.sin(ang) * r + 0.04 * Math.cos(t * 6 + ph);
          a.z = L.p[2] - 0.18 + 0.1 * Math.sin(t * 2.3 + ph); a.yaw = ang + Math.PI / 2;
          a.mi = frame(F.moth, 9, t, a.ph);
          break;
        }
      }
    }

    // the sim's instance layer hook (off with the renderer's critters setting)
    writeInstances(t, sim, i, opts) { const w = sim.windE; return opts.critters ? this.update(t, sim, i, w ? w[0] : opts.wind ? opts.windK ?? 1 : 0, w ? w[1] : ME.gustOf(opts)) : i; }
    // Advance every critter to time t and append its instance to the sim.
    update(t, sim, i, windK, gust = 0.5) {
      const dt = this.lastT === null ? 0 : Math.max(0, Math.min(0.1, t - this.lastT));
      const first = this.lastT === null;
      this.lastT = t; this.windK = windK; this.gustS = gust; this.wpos = sim.wpos; this.wn = sim.wn;
      for (const a of this.agents) {
        if (first) this.init(a, t - a.ph * 3);
        if (a.dead) continue;
        for (let g = 0; g < 24 && t >= a.end; g++) this.decide(a, a.end);
        this.flee(a, t);
        this.pose(a, t, dt);
        if (a.hide) continue;
        const m = this.MB.models[a.mi], sc = 1 / m.fine, z = a.z + (a.zOff || 0);
        if (a.kind === "wisp") { this.wispPut(a, t, sim, i++, m, sc); continue; }
        sim.put(i++, a.mi, a.x, a.y, z, a.yaw, false, [sc, sc, sc], [0, 0], 1, a.pitch);
      }
      return i;
    }

    // walkers coming close: birds take to the trees, squirrels bolt up theirs, frogs dive, bunnies bound off
    flee(a, t) {
      if (!this.wn) return;
      const busy = (s) => a.state === s;
      if (a.kind === "bird" && (busy("stand") || busy("peck") || busy("hop"))) {
        if (this.threat(a, 0.9) && this.perches.length) { const p = this.perches[Math.floor(this.rnd() * this.perches.length)]; this.flyTo(a, [p.x, p.y, p.z], t, p); }
      } else if (a.kind === "squirrel" && (busy("sit") || busy("run"))) {
        if (this.threat(a, 1.0)) this.runToTree(a, t, 2.6);
      } else if (a.kind === "frog" && busy("sit")) {
        if (this.threat(a, 0.8)) {
          const b = a.bank, pd = a.pad, an = pd ? this.rnd() * TAU : 0; // (no draw for a bank frog: Momiji unchanged)
          if (pd) this.go(a, "dive", [pd.x + Math.cos(an) * 0.32, pd.y + Math.sin(an) * 0.32, pd.z - 0.1], t, 0.4);
          else this.go(a, "dive", [b.wx, b.wy, b.w.z - 0.04], t, 0.4);
        }
      } else if (a.kind === "bunny" && !a.flee) {
        const w = this.threat(a, 0.9);
        if (w) { a.flee = true; a.hops = 5; a.yaw = Math.atan2(a.y - w[1], a.x - w[0]); const p = this.hopFrom(a, 0.36); if (p) this.go(a, "hop", p, t, 0.24); }
      } else if (a.kind === "wisp" && (busy("idle") || busy("hop") || busy("peek"))) {
        // a wispling ducks into the moss where it stands, and peeks up somewhere near once the walker has gone
        if (this.threat(a, 0.9)) { const s = a.state === "peek" ? 1 - (a.sink || 0) : 1; this.go(a, "duck", null, t - 0.3 * (1 - s), 0.3); }
      }
    }

    // ---- the garden wisplings (kind wisp): they peek up out of the moss, breathe, blink and hop about, hop over to
    //      meet a friend now and then, duck under the moss from a walker, and at dusk two of each six float up and
    //      drift by the lamps. Yaw stays 0: their faces are drawn on the model's axes (the app's wispling builder),
    //      so they always look out of the screen. Draws come from rnd3 only.
    dusk(t) { const R = ME.app && ME.app.R, s = R && R.set; return !s ? 0 : s.cycle > 0 ? 0.5 - 0.5 * Math.cos((t / s.cycle) * TAU) : clamp01(s.dusk); }
    mossOk(px, py, h) { return this.typ(px, py) === "m" && this.hgt(px, py) === h && this.inside(px, py, 0.6) && !this.trees.some((r) => Math.hypot(r.X - px, r.Y - py) < 0.3); }
    wispInit(a, t) {
      const R = this.rnd3;
      a.pitch = 0; a.hide = false; a.yaw = 0; a.fr = this.F["wisp" + a.d];
      if (!a.fr || !this.cells.m.length) { a.dead = a.hide = true; return; }
      const p = this.anyMoss(R); a.x = p[0]; a.y = p[1]; a.z = this.gz(p[0], p[1]);
      this.wait(a, "under", t, R() * 2);
    }
    wispDecide(a, t) {
      const R = this.rnd3, night = this.dusk(t) > 0.5 && a.k % 3 === 0, h = this.hgt(a.x, a.y);
      switch (a.state) {
        case "duck": this.wait(a, "under", t, 1.5 + R() * 2); return;
        case "under": {
          const p = this.spot(a.x, a.y, 0.6, 1.4, false, R) || this.anyMoss(R);
          a.x = p[0]; a.y = p[1]; a.z = this.gz(p[0], p[1]); this.wait(a, "peek", t, 0.5);
          return;
        }
        case "lift": case "float": {
          if (night) {
            // drift on round the nearest lamp on its terrace (or its own patch), a little over the moss
            const L = this.lamps.reduce((b, l) => (!b || Math.hypot(l.p[0] - a.x, l.p[1] - a.y) < Math.hypot(b.p[0] - a.x, b.p[1] - a.y) ? l : b), null);
            const c = L && Math.hypot(L.p[0] - a.x, L.p[1] - a.y) < 3 ? L.p : [a.x, a.y], p = this.spot(c[0], c[1], 0.3, 1.0, false, R) || this.spot(a.x, a.y, 0.3, 0.9, false, R);
            if (p && this.hgt(p[0], p[1]) === h) { this.go(a, "float", [p[0], p[1], p[2] + 0.4 + R() * 0.5], t, 3 + R() * 4); return; }
          }
          this.go(a, "land", [a.x, a.y, this.gz(a.x, a.y)], t, 1.5);
          return;
        }
        case "hop": if (a.hops > 0) break;
        // falls through: the run is over
        case "land": case "peek": a.goal = null; this.wait(a, "idle", t, 2 + R() * 3); return;
      }
      // idle, or a run of hops going on: the next hop toward the friend it is meeting, or about its patch
      if (a.state === "idle") {
        if (night) { this.go(a, "lift", [a.x, a.y, a.z + 0.4 + R() * 0.5], t, 1.5); return; }
        const r = R();
        if (r < 0.25) {
          const f = this.agents.find((b) => b !== a && b.kind === "wisp" && !b.dead && (b.state === "idle" || b.state === "hop") && Math.hypot(b.x - a.x, b.y - a.y) < 2.5 && this.hgt(b.x, b.y) === h);
          if (f) { a.goal = [f.x, f.y]; a.hops = 6; }
        } else if (r < 0.7) a.hops = 1 + Math.floor(R() * 3);
        else { this.wait(a, "idle", t, 2 + R() * 3); return; }
      }
      a.hops--;
      let p = null;
      if (a.goal) {
        const dx = a.goal[0] - a.x, dy = a.goal[1] - a.y, d = Math.hypot(dx, dy), s = Math.min(0.5, d - 0.42) / (d || 1), px = a.x + dx * s, py = a.y + dy * s;
        if (d > 0.5 && this.mossOk(px, py, h) && this.mossOk((a.x + px) / 2, (a.y + py) / 2, h)) p = [px, py, this.gz(px, py)];
        if (!p) { a.goal = null; a.hops = 0; }
      } else p = this.spot(a.x, a.y, 0.3, 0.6, false, R);
      if (p) { this.go(a, "hop", p, t, 0.32 + Math.hypot(p[0] - a.x, p[1] - a.y) * 0.25); }
      else { a.goal = null; this.wait(a, "idle", t, 2 + R() * 3); }
    }
    // frames: 0 and 1 breathe, 2 blinks, 3 crouches, 4 stretches. a.sink: 0 up, 1 under the moss
    wispPose(a, t, u, mv) {
      const F = a.fr, st = a.state, e = ease(u), breath = (t * 0.8 + a.ph) % 1 < 0.5 ? 0 : 1, blink = (t * 0.31 + a.ph * 7) % 1 < 0.035;
      a.hide = st === "under"; a.sink = 0;
      if (st === "hop") { mv(); a.z = lerp(a.from[2], a.to[2], u) + Math.sin(u * Math.PI) * 0.12; a.mi = F[u < 0.18 || u > 0.86 ? 3 : 4]; }
      else if (st === "lift" || st === "float" || st === "land") {
        a.x = lerp(a.from[0], a.to[0], e); a.y = lerp(a.from[1], a.to[1], e);
        a.z = lerp(a.from[2], a.to[2], e) + (st === "float" ? Math.sin(t * 1.9 + a.ph * TAU) * 0.03 * Math.sin(u * Math.PI) : 0);
        a.mi = F[blink ? 2 : st === "land" && u > 0.85 ? 3 : breath];
      } else {
        a.z = this.gz(a.x, a.y);
        if (st === "peek") { a.sink = 1 - e; a.mi = F[u > 0.7 ? 4 : 0]; }
        else if (st === "duck") { a.sink = e; a.mi = F[3]; }
        else a.mi = F[blink ? 2 : breath];
      }
      a.yaw = 0;
    }
    // sunk into the moss by a.sink (the ground hides what is under it) and squashed as it goes; the app's mark
    // (ME.content.wispMark, the hookMark bit) with markV the glow: dim by day, full at dusk, a slow pulse
    wispPut(a, t, sim, i, m, sc) {
      const s = a.sink || 0, CT = ME.content || {}, mk = CT.wispMark || 0;
      const v = mk ? clamp01(0.15 + 0.85 * this.dusk(t)) * (0.85 + 0.15 * Math.sin(t * 1.6 + a.ph * TAU)) : 0;
      sim.put(i, a.mi, a.x, a.y, a.z - s * 0.7 * m.h, 0, false, [sc, sc, sc * (1 - 0.35 * s)], [0, 0], 1, 0, mk, v);
    }
  }

  // a fern or bush to visit (bees), optionally within r of p, else null
  function MB_FERNS(c, p, r) {
    const f = c.MB.statics.filter((s) => (s.place.name === "fern" || s.place.name === "bush") && (!p || Math.hypot(s.place.X - p[0], s.place.Y - p[1]) < r));
    if (!f.length) return null;
    const s = f[Math.floor(c.rnd() * f.length)].place;
    return [s.X, s.Y];
  }

  ME.Critters = Critters;
})();
