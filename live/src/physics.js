/* Voxel physics v2: loose voxels, each one terrain voxel in size, simulated on the GPU (shaders/physics.js).
   They fly under gravity, air drag and wind, bounce off the terrain voxels, come to rest on whole cells and
   pile up on each other; a voxel that loses its support falls again, granular ones slide off heap edges,
   and under water they sink slowly and drift with the current (leaves float). A voxel that hits the
   water splashes: a ring on the surface (layer.ripples, drawn by the water shader) and droplets. Sand
   (any granular voxel) piles up at the angle of repose (set.repose, degrees). A renderer layer
   (Renderer.addLayer): steps in the "layers" compute pass and draws its voxels into the G-buffer, lit
   like terrain.

   New voxels go into a ring of `capacity` slots (the oldest are recycled). When nothing is alive the
   layer costs nothing: no dispatch, no draw.
     emit(...)                 one voxel with a position, velocity, material and life
     explode(p, r, n)          a burst: n voxels in the materials of the ground within r of p, thrown out
     shatter(MB, static)       a static volume bursts into its own voxels (and is hidden)
     splash(p, strength)       a splash on the water at p: a ring and droplets (droplets alone on dry ground)
     pour(p, mat, n, o)        a stream of n sand grains from p, o.rate grains/s, that heap up
     dig(p, r, o)              the resting voxels and the terrain sand within r of p are thrown out; the
                               sand around slides into the hole (a grain flow)
     collapse(p, r, o)         the terrain sand within r of p comes loose where it is and slumps into a heap
     setSand(mats)             which terrain materials are sand (default: the content pack's, ME.content.sand)
     resetTerrain()            the terrain as it was baked (every dig, collapse and settled grain undone)
                               and every loose voxel gone: for a new run
     clear()                   every loose voxel goes but dug sand (it settles into the terrain as ever)
     census()                  GPU readback with consistency counts (tests, tools)
   stats: impacts (voxels that hit the water), rings, droplets, settled (dug grains back in the terrain),
   lost (dug grains that left the grid or had no cell to go back to).
   Dug sand stays: a grain that dig or collapse carved out of the terrain lives until it has slept a
   moment on the terrain itself (never on loose voxels that will go), then the GPU lists it and the CPU
   writes it back into T.grid (Renderer.carve shows it), so a dig leaves a crater and a heap, not a hole.
   Loose dug sand is never recycled by the ring, nor taken by a clear.
   opts.sliceMs (0): dig and collapse spread their terrain work over frames, about that many ms a frame
   (a big collapse slides in over a few frames instead of costing one long one).
   Modes (opts, all measured in PHYSICS.md; the defaults are the fastest at the same fidelity):
     step  "dda" (exact cell-by-cell motion) | "substep" (v1: fixed substeps, fast voxels can skip a
           thin wall)
     sleep true: resting voxels sleep until a neighbouring cell is freed
     draw  "list" (the step lists the visible faces, one indirect draw) | "faces" (3 camera-facing faces
           per voxel) | "cubes" (36 vertices per voxel, as v1) | "splat" (a ray-cast quad per voxel)
   ME.raycast finds the terrain voxel under a canvas point; ME.pickGround is the exact one R.pick uses. */
(function () {
  // KEEP: the life of dug terrain sand (it never expires; shaders/physics.js); SETCAP: settled grains listed
  // per copy; ARGS: draw args (16 bytes), impact and settle counts (16), 64 impacts, the settled grains
  const ME = window.ME, BU = window.GPUBufferUsage || {}, F = 8, BYTES = F * 4, KEEP = 1e9, SETCAP = 2048, ARGS = 32 + 64 * 16 + SETCAP * 8;
  // the cells an emptied cell can unsettle (loosen): the one above, and the four beside it, level and one up
  const WAKE = [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  const hash32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };

  class VoxelPhysics {
    constructor(T, opts = {}) {
      this.T = T;
      this.capacity = opts.capacity ?? 32768;
      this.maxSpawn = opts.maxSpawn ?? 16384; // voxels uploaded per frame; the rest wait their turn
      this.sliceMs = opts.sliceMs ?? 0; this.jobs = []; this.tick = 0; this.sliceTick = -1; this.sliceEnd = Infinity; // loosen over frames (loosen)
      this.mode = { step: opts.step ?? "dda", sleep: opts.sleep ?? true, draw: opts.draw ?? "list" };
      this.sandOpt = opts.sand; // terrain sand materials (names or ids; see setSand)
      this.set = { gravity: 6, restitution: 0.3, friction: 0.86, settle: 0.45, wind: 0.5, repose: 34 };
      this.waterMat = opts.waterMat; // droplets' material (default: the first water-class material)
      this.ripples = []; this.stats = { impacts: 0, rings: 0, droplets: 0, settled: 0, lost: 0 }; this.pours = []; this.digs = []; this.time = 0;
      this.carveQ = []; this.carvedTotal = 0; this.nCarve = 0; // terrain cells carved on the CPU, given back on the GPU
      // dug sand: grains queued and loose on the GPU; steps (stepNo) and the last step whose settled grains
      // are in T.grid (freeUpTo); orig = each changed terrain cell's baked value (resetTerrain); gen = resets
      this.keepQueued = 0; this.keepLive = 0; this.keepUntil = -1; this.keeps = false;
      this.stepNo = 0; this.freeUpTo = 0; this.orig = new Map(); this.gen = 0; this.occReset = 0;
      this.enabled = true; this.noDraw = false; this.timeScale = 1; // 0 freezes the simulation (it still draws)
      // spawn queue: F words per voxel (as the GPU struct), live from qh to qt
      this.q = new Float32Array(F * 4096); this.qU = new Uint32Array(this.q.buffer); this.qh = 0; this.qt = 0;
      this.cursor = 0; this.spawned = 0; this.clock = 0; this.activeUntil = -1; this.clearReq = false;
      this.stepping = false; this.nSpawn = 0; this.spawnBase = 0; this.frameNo = 0; this.seed = opts.seed ?? 1;
      this.pp = new Float32Array(28); this.ppU = new Uint32Array(this.pp.buffer);
      this.args0 = new Uint32Array(4); this.args0[0] = 6; // draw args (6 vertices a face)
    }
    // slots that have ever held a voxel (dispatch and draw size)
    get used() { return Math.min(this.capacity, this.spawned); }
    get queued() { return (this.qt - this.qh) / F; }
    // the share left, 1..0, of the sand that kept digs (o.keep, the default) may have loose at once (half the
    // capacity; with none left such a dig takes nothing): a game that digs often backs off early with it
    keepRoom() { const half = Math.floor(this.capacity / 2); return half > 0 ? Math.max(0, 1 - (this.keepLive + this.keepQueued) / half) : 0; }
    get active() { return this.enabled && (this.clock < this.activeUntil || this.queued > 0 || this.clearReq || this.pours.length > 0 || this.digs.length > 0 || this.carveQ.length > 0 || this.jobs.length > 0 || this.occReset > 0 || (this.keepLive > 0 && this.clock < this.keepUntil)); }
    rng() { let t = (this.seed = (this.seed + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

    // foliage materials drift and do not heap; droplets take the first water-class material unless the app set
    // one. Again when the palette grows (R.refreshPalette: a progressive bake's new materials, E4).
    refreshMats() {
      const mats = this.R.S.tables.mats;
      this.leaf = new Uint8Array(256);
      let water = 0;
      for (let m = 0; m < 256 && (m * 2 + 1) * 4 + 3 < mats.length; m++) {
        const cls = Math.round(mats[(m * 2 + 1) * 4 + 3]);
        this.leaf[m] = cls === ME.CLS.FOLIAGE ? 1 : 0;
        if (m && !water && cls === ME.CLS.WATER) water = m;
      }
      if (this.waterAuto) this.waterMat = water || 1;
    }

    init(R) {
      this.R = R;
      const d = (this.dev = R.dev), T = this.T, W = ME.wgsl, M = this.mode;
      this.waterAuto = this.waterMat === undefined;
      this.refreshMats();
      // which terrain materials dig and collapse loosen: opts.sand, else the content pack's (palette names)
      this.setSand(this.sandOpt ?? (ME.content && ME.content.sand) ?? []);
      // per map tile: water surface z (-99 where dry), current (units/s: brisk in streams, a slow drift in
      // ponds), stream flag
      const WL = R.wl || { W: 1, H: 1 };
      this.wat = new Float32Array(WL.W * WL.H * 4); this.watW = WL.W; this.watH = WL.H;
      for (let i = 0; i < WL.W * WL.H; i++) this.wat[i * 4] = -99;
      for (const w of T.water || []) {
        const L = Math.hypot(w.fx, w.fy) || 1, sp = w.stream ? 0.6 : 0.12;
        this.wat.set([w.z, (w.fx / L) * sp, (w.fy / L) * sp, w.stream], (w.y * WL.W + w.x) * 4);
      }
      this.hasWater = !!(T.water && T.water.length);
      const words = Math.ceil((T.NX * T.NY * T.NZ) / 32), S = BU.STORAGE;
      this.watBuf = ME.buffer(d, this.wat, S, "physics water");
      // impact and settled-grain readback: a few staging buffers in flight, one copy a frame
      this.evFree = [0, 1, 2].map(() => d.createBuffer({ label: "impacts and settled grains", size: ARGS - 16, usage: BU.MAP_READ | BU.COPY_DST }));
      this.vxBuf = d.createBuffer({ label: "loose voxels", size: this.capacity * BYTES, usage: S | BU.COPY_SRC | BU.COPY_DST });
      this.occBuf = d.createBuffer({ label: "solid cells", size: words * 4, usage: S | BU.COPY_SRC | BU.COPY_DST });
      this.terBuf = d.createBuffer({ label: "terrain cells", size: words * 4, usage: S | BU.COPY_DST }); // dug sand settles on these only
      this.wakeBuf = d.createBuffer({ label: "wake cells", size: M.sleep ? words * 4 : 16, usage: S });
      this.listBuf = d.createBuffer({ label: "voxel faces", size: this.capacity * 3 * 4, usage: S });
      this.argsBuf = d.createBuffer({ label: "voxel draw args", size: ARGS, usage: S | BU.INDIRECT | BU.COPY_DST | BU.COPY_SRC });
      this.spawnBuf = d.createBuffer({ label: "voxel spawns", size: this.maxSpawn * BYTES, usage: S | BU.COPY_DST });
      this.ppBuf = d.createBuffer({ label: "physics params", size: this.pp.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
      const cp = (n, constants) => d.createComputePipeline({ label: n, layout: "auto", compute: { module: ME.shader(d, n, W[n]), entryPoint: "main", constants } });
      this.cp = cp;
      this.plSpawn = cp("physSpawn", { SLEEP: M.sleep ? 1 : 0 });
      this.plCarve = cp("physCarve", { SLEEP: M.sleep ? 1 : 0 });
      const bg = R.bg, B = (b) => ({ buffer: b });
      this.g = {
        spawn0: bg(this.plSpawn, 0, [B(R.ubuf)]),
        spawn1: bg(this.plSpawn, 1, [B(this.ppBuf), B(this.vxBuf), B(this.occBuf), B(this.wakeBuf), B(this.spawnBuf), B(this.argsBuf), B(this.terBuf)]),
        carve0: bg(this.plCarve, 0, [B(R.ubuf)]),
      };
      this.carveCap = 0; this.growCarve(8192);
      this.steps = {}; this.draws = {};
      this.setDraw(M.draw);
      this.staticBits = this.staticBits0 = this.writeOcc();
    }
    // Switches the draw mode (pipelines built once per mode; "list" also needs the listing step).
    setDraw(mode) {
      const d = this.dev, R = this.R, W = ME.wgsl, M = this.mode, list = mode === "list", bg = R.bg, B = (b) => ({ buffer: b });
      M.draw = mode;
      if (!this.steps[list]) {
        const pl = this.cp("physStep", { SLEEP: M.sleep ? 1 : 0, DDA: M.step === "dda" ? 1 : 0, LIST: list ? 1 : 0 });
        this.steps[list] = { pl, g0: bg(pl, 0, [B(R.ubuf)]), g1: bg(pl, 1, [B(this.ppBuf), B(this.vxBuf), B(this.occBuf), B(this.wakeBuf), B(this.listBuf), B(this.argsBuf), B(this.watBuf), B(this.terBuf)]) };
      }
      if (!this.draws[mode]) {
        const splat = mode === "splat", dm = ME.shader(d, splat ? "physSplat" : "physDraw", splat ? W.physSplat : W.physDraw);
        const pl = d.createRenderPipeline({ label: "physDraw " + mode, layout: "auto", primitive: { topology: "triangle-list", cullMode: "none" },
          vertex: { module: dm, entryPoint: { cubes: "vsCubes", faces: "vsFaces", list: "vsList", splat: "vs" }[mode] }, fragment: { module: dm, entryPoint: "fs", targets: R.gTargets }, depthStencil: R.gDepth });
        this.draws[mode] = { pl, g0: bg(pl, 0, [B(R.ubuf)]), g1: bg(pl, 1, list ? [B(this.vxBuf), B(R.matBuf), B(this.listBuf)] : [B(this.vxBuf), B(R.matBuf)]) };
      }
      this.st = this.steps[list]; this.dr = this.draws[mode];
    }

    // One voxel: world position, velocity (units/s), palette material, life (s), granular (slides off
    // heaps), air drag (per s, 0-15.75 in quarters), droplet (small, never rests, ends on the ground or
    // in the water).
    emit(x, y, z, vx, vy, vz, mat, life = 12, granular = true, drag = 0.25, droplet = false) {
      if (this.qt + F > this.q.length) this.grow();
      const o = this.qt, q = this.q;
      q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = life; q[o + 4] = vx; q[o + 5] = vy; q[o + 6] = vz;
      this.qU[o + 7] = (mat & 255) | (1 << 8) | (granular ? 1 << 10 : 0) | (Math.min(63, Math.round(drag * 4)) << 11) | ((Math.floor(this.rng() * 64) & 63) << 17) | (droplet ? 1 << 23 : 0);
      this.qt += F;
    }
    grow() {
      const live = this.q.subarray(this.qh, this.qt), q = new Float32Array(Math.max(this.q.length * 2, live.length * 2 + F * 1024));
      q.set(live); this.q = q; this.qU = new Uint32Array(q.buffer); this.qt -= this.qh; this.qh = 0;
    }
    // foliage drifts down and does not heap; everything else tumbles and piles like grit
    emitMat(x, y, z, vx, vy, vz, mat, life) {
      const leaf = this.leaf ? this.leaf[mat] : 0;
      this.emit(x, y, z, vx, vy, vz, mat, life, !leaf, leaf ? 3 : 0.25);
    }

    // A burst at p (world): n voxels taken from the ground surface within r (their materials and spots)
    // thrown up and away from p. o.speed (units/s), o.life (s). The terrain itself is not carved.
    explode(p, r = 0.55, n = 800, o = {}) {
      const T = this.T, VS = T.VS, NX = T.NX, NY = T.NY, PL = NX * NY, vg = T.grid, rnd = () => this.rng();
      const ci = Math.floor((p[0] - T.O[0]) * VS), cj = Math.floor((p[1] - T.O[1]) * VS), ck = Math.floor((p[2] - T.O[2]) * VS), R = Math.ceil(r * VS);
      const cells = [];
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NY || (i - ci) ** 2 + (j - cj) ** 2 > R * R) continue;
        for (let k = Math.min(T.NZ - 2, ck + R); k >= Math.max(0, ck - R); k--) {
          const m = vg.at(k * PL + j * NX + i);
          if (m && !vg.at((k + 1) * PL + j * NX + i)) { cells.push(i, j, k + 1, m); break; }
        }
      }
      if (!cells.length) return 0;
      const sp0 = o.speed ?? 2.2, life = o.life ?? 14, nc = cells.length / 4;
      for (let q = 0; q < n; q++) {
        const b = Math.floor(rnd() * nc) * 4, m = cells[b + 3];
        const x = T.O[0] + (cells[b] + 0.5) / VS, y = T.O[1] + (cells[b + 1] + 0.5) / VS, z = T.O[2] + (cells[b + 2] + 0.3 + 0.4 * rnd()) / VS;
        let dx = x - p[0] + (rnd() - 0.5) * 0.1, dy = y - p[1] + (rnd() - 0.5) * 0.1;
        const dl = Math.hypot(dx, dy) || 1, sp = sp0 * (0.35 + 0.65 * rnd()), out = 0.3 + 0.7 * Math.min(1, dl / r);
        dx /= dl; dy /= dl;
        this.emitMat(x, y, z, dx * sp * out, dy * sp * out, sp * (1.1 - 0.5 * out) + 0.4, m, life * (0.7 + 0.6 * rnd()));
      }
      return n;
    }

    // A static volume (an MB.statics entry) bursts into the voxels of its model, flung out from its
    // middle; the volume is hidden (s.hidden, skipped by the Sim). o.speed, o.life. Reads the model
    // through MB.voxel(mi, x, y, z) (ME.brickVoxel's, made here when MB has none). A model still at its first,
    // coarser bake (m.kf, R.swapModel) has kf x fewer voxels a tile.
    shatter(MB, s, o = {}) {
      const mi = s.frames[0], m = MB.models[mi], VS = (this.T.VS * (m.fine || 1)) / (m.kf || 1), [nx, ny, nz] = m.dims, [ox, oy, oz] = m.box, p = s.place, rnd = () => this.rng();
      const voxel = MB.voxel || ME.brickVoxel(MB), at = (x, y, z) => voxel(mi, x, y, z);
      const cz = p.Z + m.h * 0.35, sp0 = o.speed ?? 1.4, life = o.life ?? 16;
      let n = 0;
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const mat = at(x, y, z);
        if (!mat) continue;
        let lx = (ox + x + 0.5) / VS, ly = (oy + y + 0.5) / VS;
        if (p.flip) [lx, ly] = [ly, lx];
        if (p.rot) [lx, ly] = ME.rotQ(lx, ly, p.rot);
        const X = p.X + lx, Y = p.Y + ly, Z = p.Z + (oz + z + 0.5) / VS, dx = X - p.X, dy = Y - p.Y, dz = Z - cz, dl = Math.hypot(dx, dy, dz) || 1, sp = sp0 * (0.3 + 0.7 * rnd());
        this.emitMat(X, Y, Z, (dx / dl) * sp + (rnd() - 0.5) * 0.3, (dy / dl) * sp + (rnd() - 0.5) * 0.3, (dz / dl) * sp * 0.5 + sp * 0.5, mat, life * (0.7 + 0.6 * rnd()));
        n++;
      }
      s.hidden = true;
      return n;
    }

    // ---- water and sand
    // water surface z at a world point (-99 where dry)
    waterLevel(x, y) {
      const i = Math.floor(x), j = Math.floor(y);
      return !this.wat || i < 0 || j < 0 || i >= this.watW || j >= this.watH ? -99 : this.wat[(j * this.watW + i) * 4];
    }
    // n droplets thrown up from (x, y, z), faster for a harder impact (s, units/s)
    spray(x, y, z, s, n) {
      const rnd = () => this.rng(), VS = this.T.VS;
      for (let j = 0; j < n; j++) {
        const a = rnd() * Math.PI * 2, out = (0.25 + 0.45 * rnd()) * Math.min(2, 0.4 + s * 0.2), up = Math.min(3.2, 0.9 + s * 0.3 * (0.5 + rnd()));
        this.emit(x + Math.cos(a) * 0.02, y + Math.sin(a) * 0.02, z + 0.8 / VS, Math.cos(a) * out, Math.sin(a) * out, up, this.waterMat, 0.6 + 0.5 * rnd(), false, 0.5, true);
      }
      this.stats.droplets += n;
      return n;
    }
    ring(x, y, amp) { this.ripples.push({ x, y, t: this.time, amp }); this.stats.rings++; }
    // A splash at p (world): a ring on the water there and droplets; strength 1 is a stone dropped in
    // (0.3 a pebble, 3 a boulder). On dry ground only the droplets. Returns the droplets thrown.
    splash(p, strength = 1) {
      const z = this.waterLevel(p[0], p[1]), wet = z > -90;
      if (wet) this.ring(p[0], p[1], Math.min(0.8, Math.max(0.1, 0.25 * strength)));
      return this.spray(p[0], p[1], wet ? z : p[2], 2.5 * strength, Math.round(Math.min(40, Math.max(2, 6 * strength))));
    }
    // A stream of n grains of material mat falling from p (world), at o.rate grains/s (600) over a disc of
    // radius o.spread (0.05), o.speed down (0.4 units/s), each living o.life s (300). They heap at the
    // angle of repose (set.repose). Returns n.
    pour(p, mat, n = 600, o = {}) {
      this.pours.push({ p: [p[0], p[1], p[2]], mat, left: n, rate: o.rate ?? 600, r: o.spread ?? 0.05, speed: o.speed ?? 0.4, life: o.life ?? 300, acc: 0 });
      return n;
    }
    // The resting voxels and the terrain sand within r of p are thrown up and out at o.speed (1); the sand
    // around slides into the hole (a grain flow). Dug terrain grains go back into the terrain once they
    // have settled (o.keep, default true; with o.keep false they live o.life s, 600). One dig of resting
    // voxels is applied per frame. Returns the terrain grains released.
    dig(p, r = 0.25, o = {}) {
      this.digs.push([p[0], p[1], p[2], r]);
      return this.loosen(p, r, o.speed ?? 1, o.keep ?? true ? KEEP : o.life ?? 600);
    }
    // The terrain sand within r of p comes loose where it is and slumps into a heap (a bank giving way).
    collapse(p, r = 0.4, o = {}) { return this.loosen(p, r, 0, o.keep ?? true ? KEEP : o.life ?? 600); }
    // Which terrain materials are sand (the only ones dig and collapse loosen): names or palette ids.
    setSand(mats) {
      if (!this.R) { this.sandOpt = mats; return 0; }
      const names = this.R.S.pal ? this.R.S.pal.names : [];
      this.sand = new Uint8Array(256);
      for (const m of mats) { const id = typeof m === "number" ? m : names.indexOf(m); if (id > 0 && id < 256) this.sand[id] = 1; }
      return (this.nSand = this.sand.reduce((a, b) => a + b, 0));
    }
    // Terrain sand within r of p comes loose: each cell is carved out of T.grid (the renderer hides it,
    // R.carve), given back to the solid bitset on the GPU next step (physCarve: release, which wakes the
    // voxels it held up) and becomes a loose grain in its place, thrown up and out at `speed` (0: it
    // slumps). Then the sand around that lost its footing (nothing below, or a free cell beside and below
    // it) follows, bottom up, round by round, within 2.5 r: the walls of the hole slide in. Grains that
    // stay (life KEEP) are held to half the pool, counting the ones still loose: the rest stays put.
    // With opts.sliceMs (0: off) the work is spread over frames, at most about sliceMs of it a frame: a call
    // starts at once when no loosen ran yet this frame, else it waits its turn, and it returns the grains
    // released so far. A boss's slam (three collapses and a dig, 6144 cells) took 55-115 ms in its frame,
    // most of it code the JIT had not seen yet, since a big loosen comes once a wave (Engine's probe, 2026-10-24).
    loosen(p, r, speed, life) {
      if (!this.R || !this.nSand) return 0;
      const job = { n: 0 };
      job.it = this.loosenJob(p, r, speed, life, job);
      // (sliceMs set back to 0 with loosens still waiting: they finish first, so the order holds)
      if (!this.sliceMs) { if (this.jobs.length) this.runJobs(); this.sliceEnd = Infinity; job.it.next(); return job.n; }
      this.jobs.push(job);
      if (this.jobs.length === 1 && this.sliceTick !== this.tick) this.runJobs();
      return job.n;
    }
    // the queued loosens, in order, for sliceMs (prepare, every frame); every one of them when sliceMs is 0
    runJobs() {
      this.sliceTick = this.tick; this.sliceEnd = this.sliceMs > 0 ? performance.now() + this.sliceMs : Infinity;
      while (this.jobs.length && performance.now() < this.sliceEnd) if (this.jobs[0].it.next().done) this.jobs.shift();
    }
    *loosenJob(p, r, speed, life, job) {
      const T = this.T, VS = T.VS, NX = T.NX, NY = T.NY, NZ = T.NZ, PL = NX * NY, vg = T.grid, sand = this.sand, rnd = () => this.rng();
      const keep = life >= KEEP, half = Math.floor(this.capacity / 2), room = () => !keep || this.keepLive + this.keepQueued < half;
      if (!room()) return;
      if (keep) this.keeps = true;
      const pc = [(p[0] - T.O[0]) * VS, (p[1] - T.O[1]) * VS, (p[2] - T.O[2]) * VS], R0 = r * VS, RC = Math.ceil(R0 * 2.5) + 1;
      const [ci, cj, ck] = pc.map(Math.floor), i0 = Math.max(0, ci - RC), i1 = Math.min(NX - 1, ci + RC), j0 = Math.max(0, cj - RC), j1 = Math.min(NY - 1, cj + RC);
      const k0 = Math.max(0, ck - RC), k1 = Math.min(NZ - 1, ck + RC);
      const at = (i, j, k) => (k < 0 ? 1 : i < 0 || j < 0 || i >= NX || j >= NY || k >= NZ ? 0 : vg.at(k * PL + j * NX + i));
      let out = [];
      const take = (i, j, k, vx, vy, vz) => {
        const idx = k * PL + j * NX + i, m = vg.at(idx);
        vg.set(idx, 0); out.push(idx); this.changed(idx, m);
        this.emit(T.O[0] + (i + 0.5) / VS, T.O[1] + (j + 0.5) / VS, T.O[2] + (k + 0.5) / VS, vx, vy, vz, m, keep ? KEEP : life * (0.9 + 0.2 * rnd()), true, 0.25);
        if (keep) this.keepQueued++;
        job.n++;
      };
      // the cells taken so far, to the renderer and the GPU's solid bitset
      const flush = () => { if (out.length) { for (const c of out) this.carveQ.push(c); this.R.carve(out); out = []; } };
      // Past the slice's end, the cells so far go out and the job waits a frame. It is looked at between
      // slabs and batches: the loops themselves stay in plain functions, as a loop inside the generator ran
      // twice as slow (the slam's first call 25 ms against 11, Engine's probe, 2026-10-24).
      const late = () => performance.now() > this.sliceEnd;
      // the cells within r (the box around them, not the slide's box, 2.5 r: 15 times the cells; a slam's
      // first call scanned 250 000 of them, 61 ms before the JIT had seen loosen), one k slab at a time
      const RS = Math.ceil(R0) + 1;
      const sphere = (k) => {
        for (let j = Math.max(j0, cj - RS); j <= Math.min(j1, cj + RS) && room(); j++) for (let i = Math.max(i0, ci - RS); i <= Math.min(i1, ci + RS) && room(); i++) {
          const dx = i + 0.5 - pc[0], dy = j + 0.5 - pc[1], dz = k + 0.5 - pc[2];
          if (dx * dx + dy * dy + dz * dz > R0 * R0 || !sand[vg.at(k * PL + j * NX + i)]) continue;
          const L = Math.hypot(dx, dy) || 1, s = speed * (0.3 + 0.5 * rnd());
          take(i, j, k, (dx / L) * s, (dy / L) * s, speed * (0.7 + 0.4 * rnd()));
        }
      };
      for (let k = Math.max(k0, ck - RS); k <= Math.min(k1, ck + RS) && room(); k++) {
        sphere(k);
        if (late()) { flush(); yield; }
      }
      // The slide, round by round. The first round scans the whole box, bottom up: sand already standing too
      // steep comes down as well, so the banks the slam meets collapse. After it, only a cell next to one just
      // emptied can lose its footing: the cell above it, and its four neighbours, level and one up (WAKE). So
      // the later rounds visit those cells, not the whole box: a boss's slam (four collapses) scanned the box up
      // to 48 times, 187-340 ms in one frame (Engine's probe, 2026-10-24). They go in scan order, and a cell
      // woken after the one in hand joins the same round, as the scan reached it. Which way a cell slides comes
      // from a hash of the cell and the round, so it doesn't depend on which cells were visited (one rng draw
      // per call).
      const D = [[1, 0], [0, 1], [-1, 0], [0, -1]], BX = i1 - i0 + 1, BY = j1 - j0 + 1, NB = BX * BY * (k1 - k0 + 1);
      // which cells are in this round's heap and the next round's list: marks of the call's base + round, in
      // arrays kept between calls (two of 250 000 cells were zeroed on every call); loosens run one at a time
      if (!this.lMarks || this.lMarks[0].length < NB) { this.lMarks = [new Int32Array(NB), new Int32Array(NB)]; this.lBase = 0; }
      const [inCur, inNext] = this.lMarks, base = (this.lBase += 64), hp = [], salt = (rnd() * 4294967296) | 0;
      const push = (x) => { let n = hp.push(x) - 1; while (n > 0) { const q = (n - 1) >> 1; if (hp[q] <= x) break; hp[n] = hp[q]; n = q; } hp[n] = x; };
      const pop = () => {
        const top = hp[0], x = hp.pop(), L = hp.length;
        if (L) { let n = 0; for (;;) { let c = 2 * n + 1; if (c >= L) break; if (c + 1 < L && hp[c + 1] < hp[c]) c++; if (hp[c] >= x) break; hp[n] = hp[c]; n = c; } hp[n] = x; }
        return top;
      };
      let next = [], round = 0, cur = Infinity;
      const wake = (i, j, k) => {
        for (const [a0, b0, c0] of WAKE) {
          const a = i + a0, b = j + b0, c = k + c0;
          if (a < i0 || a > i1 || b < j0 || b > j1 || c < k0 || c > k1) continue;
          const l = ((c - k0) * BY + b - j0) * BX + a - i0, key = c * PL + b * NX + a;
          // (round 0's scan reaches the cells ahead itself)
          if (key > cur) { if (round && inCur[l] !== base + round + 1) { inCur[l] = base + round + 1; push(key); } }
          else if (inNext[l] !== base + round + 2) { inNext[l] = base + round + 2; next.push(key); }
        }
      };
      const slide = (key, i, j, k) => {
        cur = key;
        if (!sand[vg.at(key)]) return;
        if (!at(i, j, k - 1)) { take(i, j, k, 0, 0, 0); wake(i, j, k); return; }
        const r0 = hash32(key ^ salt ^ Math.imul(round + 1, 0x9e3779b9)) & 3;
        for (let q = 0; q < 4; q++) {
          const [dx, dy] = D[(r0 + q) & 3];
          if (!at(i + dx, j + dy, k) && !at(i + dx, j + dy, k - 1)) { take(i, j, k, dx * 1.1, dy * 1.1, 0); wake(i, j, k); break; }
        }
      };
      // round 0 scans the box (it reaches the cells woken ahead of it itself; the ones behind go to next), and
      // calls slide only on its sand cells (a call per cell of the box was 28 ms of a cold slam)
      const slab0 = (k) => {
        for (let j = j0; j <= j1 && room(); j++) {
          const row = k * PL + j * NX;
          for (let i = i0; i <= i1 && room(); i++) if (sand[vg.at(row + i)]) slide(row + i, i, j, k);
        }
      };
      if (job.n) for (let k = k0; k <= k1 && room(); k++) {
        slab0(k);
        if (late()) { flush(); yield; }
      }
      hp.length = 0; cur = Infinity;
      // up to 256 cells off the heap (a slice can end between two batches: the heap and the marks wait with the job)
      const drain = () => {
        for (let n = 0; n < 256 && hp.length && room(); n++) { const key = pop(); slide(key, key % NX, Math.floor(key / NX) % NY, Math.floor(key / PL)); }
      };
      for (round = 1; round < 48 && next.length && room(); round++) {
        for (const key of next) { const l = ((Math.floor(key / PL) - k0) * BY + (Math.floor(key / NX) % NY) - j0) * BX + (key % NX) - i0; if (inCur[l] !== base + round + 1) { inCur[l] = base + round + 1; push(key); } }
        next = []; cur = -1;
        while (hp.length && room()) {
          drain();
          if (hp.length && late()) { flush(); yield; }
        }
        hp.length = 0; cur = Infinity;
      }
      flush();
    }
    // a terrain cell changed from `was`: its baked value is kept until it is back to it (resetTerrain)
    changed(idx, was) {
      const o = this.orig.get(idx);
      if (o === undefined) this.orig.set(idx, was);
      else if (o === this.T.grid.at(idx)) this.orig.delete(idx);
    }
    // The terrain as it was baked: every carved cell and settled grain undone, every loose voxel gone (for
    // a new run). The solid bitset is rebuilt from T.grid once the clear has run. Returns the cells restored.
    resetTerrain() {
      if (!this.R) return 0;
      const vg = this.T.grid, NX = vg.NX, NY = vg.NY, flips = [], n = this.orig.size, lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
      for (const [i, o] of this.orig) {
        if (!vg.at(i) !== !o) flips.push(i);
        vg.set(i, o);
        const c = [i % NX, Math.floor(i / NX) % NY, Math.floor(i / (NX * NY))];
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]); }
      }
      if (hi[0] >= 0) vg.compact(lo, hi);
      this.orig.clear();
      this.clear(); this.qh = this.qt = 0; this.carveQ.length = 0;
      this.keepLive = this.keepQueued = 0; this.gen++; this.occReset = 1; this.jobs.length = 0;
      // settled grains not yet copied are void (copies already in flight are dropped by gen)
      this.dev.queue.writeBuffer(this.argsBuf, 16, new Uint32Array(4));
      if (flips.length) this.R.carve(flips);
      this.staticBits = this.staticBits0;
      return n;
    }
    // The baked terrain's cells into the solid and terrain bitsets, at full voxel resolution (T.grid, not a
    // density mip). Built once at init (T.grid as baked); a terrain reset uploads the same words again.
    writeOcc() {
      let n = 0;
      if (!this.occ0) {
        // a brick at a time, a row of 16 cells at a time: the row's solid cells as a 16-bit mask (all of them
        // in a uniform solid brick; in a mixed one from its 4 pool words, a bit per nonzero byte) ORed into
        // the one or two words it covers. The cells were tested one by one until 2026-11 (1.7 s at vs40)
        const g = this.T.grid, { NX, NY, NZ, PL } = g, P = g.pool, occ = (this.occ0 = new Uint32Array(this.occBuf.size / 4));
        const P4 = (P.byteOffset & 3) === 0 ? new Uint32Array(P.buffer, P.byteOffset, P.length >> 2) : null;
        // a word's 4 bytes as 4 bits, bit x set when byte x is nonzero
        const nz = (w) => Math.imul(((w | ((w & 0x7f7f7f7f) + 0x7f7f7f7f)) & 0x80808080) >>> 7, 0x10204080) >>> 28;
        g.bricks((I, J, K, v, s) => {
          if (v === 0) return;
          const i0 = I << 4, j0 = J << 4, k0 = K << 4, i1 = Math.min(NX, i0 + 16), j1 = Math.min(NY, j0 + 16), k1 = Math.min(NZ, k0 + 16);
          const len = i1 - i0, full = (1 << len) - 1; // (a brick past the grid's edge: its outside cells left out)
          for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) {
            let m = full;
            if (v > 0) n += len;
            else {
              const o = s + ((k & 15) << 8) + ((j & 15) << 4);
              if (P4) {
                const q = o >> 2, w0 = P4[q], w1 = P4[q + 1], w2 = P4[q + 2], w3 = P4[q + 3];
                if ((w0 | w1 | w2 | w3) === 0) continue;
                m &= nz(w0) | (nz(w1) << 4) | (nz(w2) << 8) | (nz(w3) << 12);
              } else { let b = 0; for (let x = 0; x < len; x++) if (P[o + x]) b |= 1 << x; m = b; }
              if (m === 0) continue;
              let c = m - ((m >>> 1) & 0x5555); c = (c & 0x3333) + ((c >>> 2) & 0x3333); c = (c + (c >>> 4)) & 0x0f0f;
              n += (c + (c >>> 8)) & 0x1f;
            }
            const a = k * PL + j * NX + i0, w = a >>> 5, sh = a & 31;
            occ[w] |= m << sh;
            if (sh > 16) occ[w + 1] |= m >>> (32 - sh);
          }
        });
      }
      this.dev.queue.writeBuffer(this.occBuf, 0, this.occ0);
      this.dev.queue.writeBuffer(this.terBuf, 0, this.occ0);
      return n;
    }
    // the upload buffer for carved cells, with room for n (the whole queue goes up each frame)
    growCarve(n) {
      if (n <= this.carveCap) return;
      this.carveCap = Math.max(n, this.carveCap * 2);
      if (this.carveBuf) this.carveBuf.destroy();
      this.carveBuf = this.dev.createBuffer({ label: "carved terrain cells", size: (this.carveCap + 1) * 4, usage: BU.STORAGE | BU.COPY_DST });
      this.g.carve1 = this.R.bg(this.plCarve, 1, [{ buffer: this.ppBuf }, { buffer: this.occBuf }, { buffer: this.wakeBuf }, { buffer: this.carveBuf }, { buffer: this.terBuf }]);
    }
    // What the steps since the last copy logged: water impacts become rings and droplets (merged within
    // 0.2 units, a budget per frame), settled dug grains go into T.grid. The counts are zeroed right after
    // the copy; when every staging buffer is still being read back, everything waits in args.
    readBack() {
      const st = this.evFree.pop();
      if (!st) return false;
      const enc = this.dev.createCommandEncoder(), gen = this.gen, upTo = this.stepNo;
      enc.copyBufferToBuffer(this.argsBuf, 16, st, 0, this.keeps ? st.size : 16 + 64 * 16); // the settle list once sand was dug
      this.dev.queue.submit([enc.finish()]);
      this.dev.queue.writeBuffer(this.argsBuf, 16, new Uint32Array(4));
      st.mapAsync(GPUMapMode.READ).then(() => {
        const raw = st.getMappedRange(), [total, nSet, lost] = new Uint32Array(raw, 0, 3), ev = new Float32Array(raw.slice(16, 16 + Math.min(64, total) * 16));
        const set = nSet ? new Uint32Array(raw.slice(16 + 64 * 16, 16 + 64 * 16 + Math.min(SETCAP, nSet) * 8)) : null;
        st.unmap(); this.evFree.push(st);
        if (gen === this.gen) {
          if (lost) { this.keepLive = Math.max(0, this.keepLive - lost); this.stats.lost += lost; }
          if (set) this.settle(set, upTo);
        }
        if (!total) return;
        this.stats.impacts += total;
        const hits = [];
        for (let i = 0; i < ev.length; i += 4) {
          const h = hits.find((q) => Math.hypot(q[0] - ev[i], q[1] - ev[i + 1]) < 0.2);
          if (h) { h[3] = Math.max(h[3], ev[i + 3]); h[4]++; } else hits.push([ev[i], ev[i + 1], ev[i + 2], ev[i + 3], 1]);
        }
        let budget = 240;
        for (const [x, y, z, s, n] of hits.slice(0, 12)) {
          this.ring(x, y, Math.min(0.6, Math.max(0.12, 0.08 + s * 0.06 + n * 0.01)));
          const k = Math.min(budget, Math.round(Math.min(10, 1 + s * 1.2 + n * 0.5)));
          if (k > 0) budget -= this.spray(x, y, z, s, k);
        }
      }, () => this.evFree.push(st));
      return true;
    }
    // dug grains the GPU settled (cell, material pairs) into the terrain; their slots go from step upTo on
    settle(set, upTo) {
      const vg = this.T.grid, cells = [];
      for (let e = 0; e < set.length; e += 2) {
        const i = set[e], m = set[e + 1];
        if (vg.at(i)) continue;
        vg.set(i, m); this.changed(i, 0); cells.push(i);
      }
      this.staticBits += cells.length; this.stats.settled += cells.length;
      this.keepLive = Math.max(0, this.keepLive - set.length / 2);
      this.freeUpTo = Math.max(this.freeUpTo, upTo);
      if (cells.length) this.R.carve(cells);
    }

    // Every loose voxel goes but dug sand: it settles as ever, and dug grains still queued spawn after the
    // clear (the layer stays active until all of it is back in the terrain).
    clear() {
      if (this.keepQueued) {
        const q = this.q, keep = [];
        for (let o = this.qh; o < this.qt; o += F) if (q[o + 3] >= KEEP) keep.push(q.slice(o, o + F));
        this.qh = 0; this.qt = keep.length * F;
        keep.forEach((v, j) => q.set(v, j * F));
      } else this.qh = this.qt = 0;
      this.clearReq = true; this.pours.length = 0; this.digs.length = 0; this.jobs.length = 0; // (a slam's pending slices too: Game, a new run mid-slam)
    }

    // ---- renderer layer
    prepare(time, dt) {
      const stepped = this.stepping;
      this.stepping = false; this.nSpawn = 0; this.time = time;
      if (this.ripples.length) this.ripples = this.ripples.filter((e) => time - e.t < 3);
      if (stepped && (this.hasWater || this.keeps)) this.readBack();
      // the waiting loosens' slice, unless a loosen called this frame took it
      if (this.jobs.length && this.sliceTick !== this.tick) this.runJobs();
      this.tick++;
      if (!this.active) return;
      dt =Math.min(1 / 30, Math.max(0, dt)) * this.timeScale;
      // pours: their grains for this frame
      for (const P of this.pours) {
        P.acc += P.rate * dt;
        const n = Math.min(P.left, Math.floor(P.acc));
        P.acc -= n; P.left -= n;
        for (let j = 0; j < n; j++) {
          const a = this.rng() * Math.PI * 2, r = P.r * Math.sqrt(this.rng());
          this.emit(P.p[0] + Math.cos(a) * r, P.p[1] + Math.sin(a) * r, P.p[2] + this.rng() * 0.02, 0, 0, -P.speed, P.mat, P.life * (0.9 + 0.2 * this.rng()), true, 0.25);
        }
      }
      if (this.pours.length) this.pours = this.pours.filter((P) => P.left > 0);
      // (nothing spawns in a clearing step: it would go at once)
      const k = this.clearReq ? 0 : Math.min(this.maxSpawn, this.capacity, this.queued);
      if (k) {
        for (let j = 0, o = this.qh + 3; j < k; j++, o += F) {
          const life = this.q[o];
          // dug sand keeps the layer active only until it has settled (keepLive)
          if (life >= KEEP) { this.keepLive++; this.keepQueued--; this.keepUntil = this.clock + 600; } else this.activeUntil = Math.max(this.activeUntil, this.clock + life + 0.5);
        }
        this.dev.queue.writeBuffer(this.spawnBuf, 0, this.q, this.qh, k * F);
        this.qh += k * F;
        if (this.qh >= this.qt) this.qh = this.qt = 0;
        this.spawnBase = this.cursor; this.cursor = (this.cursor + k) % this.capacity; this.spawned += k;
      }
      this.clock += dt;
      const s = this.set, pp = this.pp, pu = this.ppU, T = this.T;
      // the share of grains that also step two cells out: 0 piles at 45 degrees, 1 at atan(1/2) = 26.6
      const far = Math.min(1, Math.max(0, 1 / Math.tan((Math.max(26.6, s.repose) * Math.PI) / 180) - 1));
      pp.set([dt, s.gravity, far, s.restitution, s.friction, s.settle, this.clock, s.wind]);
      pu[8] = this.used; pu[9] = k; pu[10] = this.spawnBase; pu[11] = this.clearReq ? (this.occReset === 1 ? 3 : 1) : 0;
      pu[12] = T.NX; pu[13] = T.NY; pu[14] = T.NZ; pu[15] = this.capacity;
      pp[16] = T.O[0]; pp[17] = T.O[1]; pp[18] = T.O[2]; pp[19] = T.VS;
      const dg = this.digs.shift();
      pp.set(dg || [0, 0, 0, 0], 20);
      // every terrain cell carved since the last step, given back to the solid bitset before the spawn
      // (so no grain spawns inside a cell that is still solid)
      this.nCarve = 0;
      if (this.carveQ.length) {
        const n = this.carveQ.length, a = new Uint32Array(n + 1);
        a[0] = n; a.set(this.carveQ, 1); this.carveQ.length = 0;
        this.growCarve(n);
        this.dev.queue.writeBuffer(this.carveBuf, 0, a);
        this.nCarve = n; this.staticBits -= n; this.carvedTotal += n;
      }
      // a terrain reset: the bitset from T.grid, in the step after the clear (no voxel holds a cell then)
      if (this.occReset === 2) { this.writeOcc(); this.occReset = 0; }
      if (this.clearReq) { this.clearReq = false; this.activeUntil = this.clock; if (this.occReset === 1) this.occReset = 2; }
      pu[24] = ++this.stepNo; pu[25] = this.freeUpTo;
      this.dev.queue.writeBuffer(this.ppBuf, 0, pp);
      this.dev.queue.writeBuffer(this.argsBuf, 0, this.args0);
      this.nSpawn = k; this.stepping = true;
    }
    compute(c) {
      if (!this.stepping) return;
      if (this.nCarve) { c.setPipeline(this.plCarve); c.setBindGroup(0, this.g.carve0); c.setBindGroup(1, this.g.carve1); c.dispatchWorkgroups(Math.ceil(this.nCarve / 64)); }
      if (this.nSpawn) { c.setPipeline(this.plSpawn); c.setBindGroup(0, this.g.spawn0); c.setBindGroup(1, this.g.spawn1); c.dispatchWorkgroups(Math.ceil(this.nSpawn / 64)); }
      c.setPipeline(this.st.pl); c.setBindGroup(0, this.st.g0); c.setBindGroup(1, this.st.g1); c.dispatchWorkgroups(Math.ceil(this.used / 64));
    }
    gbuffer(r) {
      if (!this.stepping || this.noDraw) return;
      r.setPipeline(this.dr.pl); r.setBindGroup(0, this.dr.g0); r.setBindGroup(1, this.dr.g1);
      const m = this.mode.draw;
      if (m === "list") r.drawIndirect(this.argsBuf, 0);
      else r.draw(m === "cubes" ? 36 : m === "faces" ? 18 : 6, this.used);
    }

    // ---- diagnostics
    async readback() {
      const d = this.dev, nv = this.capacity * BYTES, no = this.occBuf.size, MR = BU.MAP_READ | BU.COPY_DST;
      const a = d.createBuffer({ size: nv, usage: MR }), b = d.createBuffer({ size: no, usage: MR }), e = d.createBuffer({ size: 16, usage: MR }), enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(this.vxBuf, 0, a, 0, nv); enc.copyBufferToBuffer(this.occBuf, 0, b, 0, no); enc.copyBufferToBuffer(this.argsBuf, 0, e, 0, 16);
      d.queue.submit([enc.finish()]);
      await Promise.all([a.mapAsync(GPUMapMode.READ), b.mapAsync(GPUMapMode.READ), e.mapAsync(GPUMapMode.READ)]);
      const vox = new Float32Array(a.getMappedRange().slice(0)), occ = new Uint32Array(b.getMappedRange().slice(0)), faces = new Uint32Array(e.getMappedRange())[1];
      a.destroy(); b.destroy(); e.destroy();
      return { vox, voxU: new Uint32Array(vox.buffer), occ, faces };
    }
    // Counts over the pool: flying / resting (and asleep) voxels, cells held, and what should never
    // happen: a voxel inside a terrain voxel, two resting voxels in one cell, a held cell no voxel owns
    // (leak), a resting voxel whose cell is not marked (wrongCell), non-finite state. `unsupported` =
    // resting voxels with nothing under them this instant (they fall next step). Draw mode "list": faces =
    // faces listed in the last step, staleFaces = sleeping voxels whose cached open faces disagree with the
    // cells around them (a neighbour that changed this very step is picked up next step). Dug sand: loose =
    // grains not yet settled, settling = settled but not yet in T.grid. restCells (not in
    // JSON): the cells of the resting voxels.
    async census() {
      const { vox, voxU, occ, faces } = await this.readback(), T = this.T, VS = T.VS, PL = T.NX * T.NY, list = this.mode.draw === "list";
      const c = { flying: 0, resting: 0, asleep: 0, held: 0, inSolid: 0, dupCells: 0, wrongCell: 0, unsupported: 0, nonFinite: 0, leak: 0, maxSpeed: 0, meanRestZ: 0, drops: 0, underwater: 0, maxSinkSpeed: 0, loose: 0, settling: 0 };
      if (list) { c.faces = faces; c.staleFaces = 0; }
      const solidAt = (i, j, k) => (k < 0 ? 1 : i < 0 || j < 0 || i >= T.NX || j >= T.NY || k >= T.NZ ? 0 : bit(k * PL + j * T.NX + i));
      const bit = (i) => (occ[i >>> 5] >>> (i & 31)) & 1, seen = new Set(), cells = [];
      let zs = 0;
      for (let i = 0; i < this.capacity; i++) {
        const o = i * F, st = (voxU[o + 7] >>> 8) & 3;
        if (!st) continue;
        const x = vox[o], y = vox[o + 1], z = vox[o + 2];
        if (![x, y, z, vox[o + 4], vox[o + 5], vox[o + 6]].every(Number.isFinite)) { c.nonFinite++; continue; }
        const ci = Math.floor((x - T.O[0]) * VS), cj = Math.floor((y - T.O[1]) * VS), ck = Math.floor((z - T.O[2]) * VS);
        const inG = ci >= 0 && cj >= 0 && ck >= 0 && ci < T.NX && cj < T.NY && ck < T.NZ, idx = ck * PL + cj * T.NX + ci;
        // settled dug sand: terrain once T.grid has it, else it still holds its cell
        if (vox[o + 3] > 3e9) { if (inG && T.grid.at(idx)) continue; c.settling++; if (!bit(idx)) c.wrongCell++; if (seen.has(idx)) c.dupCells++; else seen.add(idx); continue; }
        if (vox[o + 3] >= KEEP) c.loose++;
        if (inG && T.grid.at(idx)) c.inSolid++;
        const wz = this.waterLevel(x, y);
        if (st === 1) {
          const sp = Math.hypot(vox[o + 4], vox[o + 5], vox[o + 6]);
          c.flying++; c.maxSpeed = Math.max(c.maxSpeed, sp);
          if ((voxU[o + 7] >>> 23) & 1) c.drops++; else if (z < wz - 0.1) c.maxSinkSpeed = Math.max(c.maxSinkSpeed, -vox[o + 6]);
          continue;
        }
        if (z < wz) c.underwater++;
        c.resting++; zs += z; cells.push(idx);
        if (st === 3) c.asleep++;
        if (vox[o + 3] <= 0.5) continue; // shrinking away: holds no cell
        if (!bit(idx)) c.wrongCell++;
        if (seen.has(idx)) c.dupCells++; else seen.add(idx);
        if (ck > 0 && !T.grid.at(idx - PL) && !bit(idx - PL)) c.unsupported++;
        if (list && st === 3) {
          let m = 0;
          for (let f = 0; f < 6; f++) { const s = f & 1 ? 1 : -1, a = f >> 1; if (!solidAt(ci + (a === 0 ? s : 0), cj + (a === 1 ? s : 0), ck + (a === 2 ? s : 0))) m |= 1 << f; }
          if ((voxU[o + 4] & 63) !== m) c.staleFaces++;
        }
      }
      for (let w = 0; w < occ.length; w++) { let v = occ[w]; while (v) { v &= v - 1; c.held++; } }
      c.held -= this.staticBits;
      c.leak = c.held - seen.size;
      c.maxSpeed = +c.maxSpeed.toFixed(2); c.maxSinkSpeed = +c.maxSinkSpeed.toFixed(2);
      c.meanRestZ = c.resting ? +(zs / c.resting).toFixed(4) : 0;
      Object.defineProperty(c, "restCells", { value: Uint32Array.from(cells) });
      return c;
    }
    destroy() { for (const b of [this.vxBuf, this.occBuf, this.wakeBuf, this.listBuf, this.argsBuf, this.spawnBuf, this.ppBuf, this.watBuf, this.carveBuf, this.terBuf, ...(this.evFree || [])]) b && b.destroy(); }
  }
  // the configurations demo/physbench.js compares (PHYSICS.md)
  VoxelPhysics.BENCH = [
    { name: "substep", step: "substep", sleep: false, draw: "cubes" },
    { name: "dda", step: "dda", sleep: false, draw: "cubes" },
    { name: "dda-sleep", step: "dda", sleep: true, draw: "cubes" },
    { name: "faces", step: "dda", sleep: true, draw: "faces" },
    { name: "list", step: "dda", sleep: true, draw: "list" },
    { name: "splat", step: "dda", sleep: true, draw: "splat" },
  ];
  ME.VoxelPhysics = VoxelPhysics;

  // The first terrain voxel along the view ray through a canvas point (ndc x, y in -1..1), with ivp the
  // camera's inverse view-projection. Returns { a: ray start on the near plane, dir, t: distance to the
  // hit, p: world point just in front of it, cell: [i, j, k] }; a miss has t = Infinity and p = null.
  ME.raycast = (T, ivp, x, y) => {
    const a = ME.m4.apply(ivp, [x, y, 1]), b = ME.m4.apply(ivp, [x, y, 0]), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L], h = 0.4 / T.VS, PL = T.NX * T.NY;
    for (let t = 0; t < L; t += h) {
      const p = [a[0] + dir[0] * t, a[1] + dir[1] * t, a[2] + dir[2] * t];
      const i = Math.floor((p[0] - T.O[0]) * T.VS), j = Math.floor((p[1] - T.O[1]) * T.VS), k = Math.floor((p[2] - T.O[2]) * T.VS);
      if (i < 0 || j < 0 || k < 0 || i >= T.NX || j >= T.NY || k >= T.NZ || !T.grid.at(k * PL + j * T.NX + i)) continue;
      const tb = t - h;
      return { a, dir, t, p: [a[0] + dir[0] * tb, a[1] + dir[1] * tb, a[2] + dir[2] * tb], cell: [i, j, k] };
    }
    return { a, dir, t: Infinity, p: null, cell: null };
  };

  // The terrain half of picking (R.pick): the first solid voxel of T.grid along a view ray ({ a, dir, L }:
  // cam.ray), exact, cell by cell (stamped props and dug or settled cells included). Returns { t, p, n,
  // cell }: t in world units along the ray, p where it enters the voxel, n that face's outward normal.
  ME.pickGround = (T, ray) => {
    const { a, dir } = ray, VS = T.VS, N = [T.NX, T.NY, T.NZ], PL = T.NX * T.NY;
    const o = [0, 1, 2].map((k) => (a[k] - T.O[k]) * VS); // in voxels, where t counts voxels too
    let t0 = 0, t1 = ray.L * VS, ax = -1;
    for (let k = 0; k < 3; k++) { // clip to the grid
      if (!dir[k]) { if (o[k] < 0 || o[k] >= N[k]) return null; continue; }
      let ta = -o[k] / dir[k], tb = (N[k] - o[k]) / dir[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; ax = k; }
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return null;
    const st = dir.map(Math.sign), c = [0, 1, 2].map((k) => Math.min(N[k] - 1, Math.max(0, Math.floor(o[k] + dir[k] * t0))));
    const tD = dir.map((d) => (d ? Math.abs(1 / d) : Infinity)), tM = [0, 1, 2].map((k) => (dir[k] ? (c[k] + (st[k] > 0) - o[k]) / dir[k] : Infinity));
    for (let t = t0; t <= t1;) {
      if (T.grid.at(c[2] * PL + c[1] * T.NX + c[0])) {
        const n = [0, 0, 0], tw = t / VS;
        if (ax >= 0) n[ax] = -st[ax]; else n[2] = 1; // (a ray that starts inside the ground)
        return { t: tw, p: [a[0] + dir[0] * tw, a[1] + dir[1] * tw, a[2] + dir[2] * tw], n, cell: c };
      }
      ax = tM[0] < tM[1] ? (tM[0] < tM[2] ? 0 : 2) : tM[1] < tM[2] ? 1 : 2;
      t = tM[ax]; tM[ax] += tD[ax]; c[ax] += st[ax];
      if (c[ax] < 0 || c[ax] >= N[ax]) return null;
    }
    return null;
  };
})();
