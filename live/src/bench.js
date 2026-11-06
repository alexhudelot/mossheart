/* The benchmark (docs/reviews/2026-10-20-optimization.md, section 5): ?bench=1 on the demo or a game, or the
   demo HUD's "benchmark" button (phones), once the scene is up. It prints one line and keeps the JSON in ME.bench
   (the line starts with ctx.app, "engine" by default):
     BENCH v1 engine vs=16 core 1566x756 cold=3.86 terrain=1.00 mesh=0.49 models=2.16 grass=0.01 boot=0.20
       | gpu=7.21 prep=0.46 gb=3.58 terr=1.25 vol=2.13 grass=0.20 part=0.02 light=1.15 shafts=0.79 fwd=0.60
         bloom=0.29 comp=0.31 | cpu=1.0 sim=0.7 u300:gb=10.5,sim=1.6 | phys32k fly=0.14 rest=0.09 draw=+0.19
         full=0.31/0.12 | mem gpu=89.1 static=45.5 screen=43.6 phys=11.9 pool=2.5 heap=65 cache=41.7
       | bricks=1235 variants=116
   (one line). Times in s for the bake, ms for the rest, medians; MB for memory.
   - The bake: cold= (no cache hit) with its steps, or warm= (a cache hit). boot= is the rest of the time to
     READY (the adapter, the upload, waiting for the pipelines).
   - The frame: 2 s of warm-up, then 150 frames at the default load with timestamps every frame, dynamic
     resolution off and scale 1. Then grass, volumes and particles, each off and on in 4 interleaved rounds
     of 30 frames, the median difference: the G-buffer split (vol= and grass= are what turning each off
     saves, terr= the rest of it: terrain, leaves, loose voxels; part= is what turning particles off saves
     of the whole frame, as they span three passes). Small fields can read slightly negative: noise.
     u300 is 90 frames at 300 walkers, on a bake with walker types (ctx.walkers !== false); else u300=n/a.
   - Physics: 6 bursts of 1,200 voxels, 30 frames flying (fly=, the layers pass), 300 frames to settle and 60 at
     rest (rest=; draw= is the G-buffer cost over the idle pool); then the pool filled (full=fly/rest).
   - Memory: every buffer and texture reachable from R and the physics layer (static, screen-sized targets,
     physics), the brick pool, the JS heap (Chromium only) and the bake's cache record.
   ?bench=2 (tools\bench.ps1's warm runs) stops after the bake part. Nothing here changes the scene for good:
   settings, walkers and the pool are put back. Without timestamp-query the GPU fields read n/a. */
(function () {
  const ME = window.ME;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const med = (a) => { if (!a.length) return null; a = a.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const f2 = (v) => (v == null || !isFinite(v) ? "n/a" : v.toFixed(2));
  const f1 = (v) => (v == null || !isFinite(v) ? "n/a" : v.toFixed(1));
  const MBy = (b) => +(b / 1048576).toFixed(1);
  const BPP = { r8unorm: 1, r8uint: 1, rg8unorm: 2, r16float: 2, rgba8unorm: 4, "rgba8unorm-srgb": 4, bgra8unorm: 4, r32float: 4, r32uint: 4, r32sint: 4, rg16float: 4, depth32float: 4, depth24plus: 4, rgba16float: 8, rg32uint: 8, rg32float: 8, rgba32float: 16, rgba32uint: 16 };

  // ctx: { R, T, MB, mesh, grass, sim, phys, cache: bool (a cache hit), bakeMs, size: [w, h], app = "engine",
  //   walkers: false when the app bakes none (no u300) }; phys may be null
  ME.runBench = async function (ctx, mode = 1) {
    const { R, T, MB, mesh, grass, sim, phys } = ctx, out = { v: 1, app: ctx.app || "engine", vs: T.VS, mode: ME.compat ? "compat" : "core", size: ctx.size, cache: ctx.cache };
    const walk = ctx.walkers !== false && !!(MB.walkerTypes && MB.walkerTypes.length);
    const bakeS = ctx.bakeMs / 1000;
    if (ctx.cache) out.bake = { warm: bakeS };
    else {
      const steps = { terrain: T.stats.ms / 1000, mesh: mesh.ms / 1000, models: MB.stats.ms / 1000, grass: grass.ms / 1000 };
      out.bake = Object.assign({ cold: bakeS }, steps, { boot: bakeS - Object.values(steps).reduce((a, b) => a + b, 0) });
    }
    out.bricks = MB.stats.bricks; out.variants = MB.stats.variants;
    if (mode !== 2) Object.assign(out, await frames(R, sim, phys, walk));
    out.mem = memory(R, T, MB, mesh, grass, phys);
    out.errors = ME.errors.slice(0, 5);
    out.line = line(out);
    ME.bench = out;
    console.log(out.line);
    return out;
  };

  async function frames(R, sim, phys, walk) {
    const s = R.set, keep = { autoScale: s.autoScale, scale: s.scale, grass: s.grass, particles: s.particles }, tsEvery = R.tsEvery;
    s.autoScale = false; s.scale = 1; R.tsEvery = 1;
    let simMs = [], frameMs = [], noVol = false;
    const su = sim.update, fr = R.frame;
    sim.update = function (...a) { const t = performance.now(), n = su.apply(this, a); simMs.push(performance.now() - t); return noVol ? 0 : n; };
    R.frame = function (...a) { const t = performance.now(), o = fr.apply(this, a); frameMs.push(performance.now() - t); return o; };
    const sample = async (n) => {
      for (let i = 0; i < 10; i++) await raf();
      simMs = []; frameMs = [];
      const acc = {}; let last = R.gpuMs;
      for (let i = 0; i < n; i++) { await raf(); const g = R.gpuMs; if (g && g !== last) { last = g; for (const p in g) (acc[p] = acc[p] || []).push(g[p]); } }
      const gpu = {}; for (const p in acc) gpu[p] = med(acc[p]);
      return { gpu, cpu: med(frameMs), sim: med(simMs) };
    };
    const o = {};
    try {
      const t0 = performance.now(); while (performance.now() - t0 < 2000) await raf(); // the first second runs hot
      o.base = await sample(150);
      // what turning a feature off saves: off and on windows interleaved, 4 rounds of 30 frames each, the
      // median difference (one window each drifts by more than grass costs on a busy machine)
      const delta = async (off, on) => {
        const gb = [], total = [];
        for (let r = 0; r < 4; r++) {
          off(); const a = await sample(30); on(); const b = await sample(30);
          if (a.gpu.gbuffer != null && b.gpu.gbuffer != null) gb.push(b.gpu.gbuffer - a.gpu.gbuffer);
          if (a.gpu.total != null && b.gpu.total != null) total.push(b.gpu.total - a.gpu.total);
        }
        return { gb: med(gb), total: med(total) };
      };
      o.dGrass = await delta(() => (s.grass = false), () => (s.grass = keep.grass));
      o.dVolumes = await delta(() => (noVol = true), () => (noVol = false));
      o.dParticles = await delta(() => (s.particles = false), () => (s.particles = keep.particles));
      if (walk && sim.setCount && sim.walkers) { const w0 = sim.walkers.length; sim.setCount(300); o.u300 = await sample(90); sim.setCount(w0); }
      if (phys && phys.enabled) o.phys = await physics(phys, sample);
    } finally {
      sim.update = su; R.frame = fr; R.tsEvery = tsEvery; Object.assign(s, keep);
    }
    return o;
  }

  async function physics(phys, sample) {
    const T = phys.T, C = T.geo ? T.geo.C : (T.bounds.min[0] + T.bounds.max[0]) / 2, P = { capacity: phys.capacity };
    const pts = [[0, 0], [1.5, 0.5], [-1.2, 1.1], [0.6, -1.4], [-1.6, -0.8], [2.2, -1.9], [-2.4, 2.0], [0.2, 2.6]];
    const burst = (k, n) => { let e = 0; for (const [dx, dy] of pts.slice(0, k)) { const x = C + dx, y = C + dy; e += phys.explode([x, y, T.groundAt(x, y, 9)], 0.55, n); } return e; };
    phys.clear(); for (let i = 0; i < 30; i++) await raf();
    P.idle = await sample(40);
    P.emitted = burst(6, 1200);
    P.flying = await sample(30);
    for (let i = 0; i < 300; i++) await raf();
    P.rest = await sample(60);
    phys.clear(); for (let i = 0; i < 30; i++) await raf();
    let e = 0; for (let r = 0; r < 5 && e < phys.capacity; r++) e += burst(8, Math.ceil(phys.capacity / 8));
    P.emittedFull = e;
    P.fullFlying = await sample(30);
    for (let i = 0; i < 360; i++) await raf();
    P.fullRest = await sample(60);
    phys.clear(); for (let i = 0; i < 30; i++) await raf();
    return P;
  }

  function memory(R, T, MB, mesh, grass, phys) {
    const texBytes = (t) => { let b = 0, w = t.width, h = t.height, d = t.depthOrArrayLayers; for (let m = 0; m < t.mipLevelCount; m++) { b += w * h * d * (BPP[t.format] || 4); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); if (t.dimension === "3d") d = Math.max(1, d >> 1); } return b; };
    const seen = new Set(), items = [];
    const walk = (o, path, depth) => {
      if (!o || typeof o !== "object" || depth > 3) return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (!v || typeof v !== "object" || seen.has(v)) continue;
        if (v instanceof GPUBuffer) { seen.add(v); items.push({ phys: path.startsWith("phys"), b: v.size }); }
        else if (v instanceof GPUTexture) { seen.add(v); items.push({ phys: path.startsWith("phys"), b: texBytes(v), w: v.width, h: v.height, d: v.dimension }); }
        else if (Array.isArray(v) || v.constructor === Object) { seen.add(v); walk(v, path + k + ".", depth + 1); }
      }
    };
    if (phys) walk(phys, "phys.", 0);
    walk(R, "R.", 0);
    // render targets follow the render size (full, half, the bloom chain): those are the screen's
    const [W, H] = R.size, screen = (m) => m.d !== "3d" && m.w && [1, 2, 4, 8, 16, 32, 64, 128, R.shaftDiv || 2].some((d) => Math.abs(m.w - Math.floor(W / d)) <= 1 && Math.abs(m.h - Math.floor(H / d)) <= 1);
    const sum = (f) => items.filter(f).reduce((s, m) => s + m.b, 0);
    const tb = (o, d = 0, s = new Set()) => { if (!o || typeof o !== "object" || s.has(o) || d > 5) return 0; s.add(o); if (ArrayBuffer.isView(o)) return o.byteLength; let b = 0; for (const k in o) b += tb(o[k], d + 1, s); return b; };
    return {
      gpu: MBy(sum(() => true)), static: MBy(sum((m) => !m.phys && !screen(m))), screen: MBy(sum((m) => !m.phys && screen(m))), phys: MBy(sum((m) => m.phys)),
      pool: MB.stats.poolMB, shaftDiv: R.shaftDiv, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, cache: MBy(tb({ T, mesh, MB, grass })),
    };
  }

  function line(o) {
    const b = o.bake, parts = [`BENCH v1 ${o.app} vs=${o.vs} ${o.mode} ${o.size[0]}x${o.size[1]}`];
    parts[0] += b.warm != null ? ` warm=${f2(b.warm)}` : ` cold=${f2(b.cold)} terrain=${f2(b.terrain)} mesh=${f2(b.mesh)} models=${f2(b.models)} grass=${f2(b.grass)} boot=${f2(b.boot)}`;
    if (o.base) {
      const g = o.base.gpu, gb = g.gbuffer;
      // particles run in prep (sim), the G-buffer (leaves) and forward (sparks): their cost is the total's drop
      const vol = o.dVolumes.gb, gr = o.dGrass.gb, part = o.dParticles.total;
      parts.push(`gpu=${f2(g.total)} prep=${f2(g.prep)} gb=${f2(gb)} terr=${f2(gb != null && vol != null && gr != null ? gb - vol - gr : null)} vol=${f2(vol)} grass=${f2(gr)} part=${f2(part)} light=${f2(g.lighting)} shafts=${f2(g.shafts)} fwd=${f2(g.forward)} bloom=${f2(g.bloom)} comp=${f2(g.composite)}`);
      parts.push(`cpu=${f1(o.base.cpu)} sim=${f1(o.base.sim)}` + (o.u300 ? ` u300:gb=${f1(o.u300.gpu.gbuffer)},sim=${f1(o.u300.sim)}` : " u300=n/a"));
      const P = o.phys;
      if (P) {
        const dg = P.rest.gpu.gbuffer != null && P.idle.gpu.gbuffer != null ? P.rest.gpu.gbuffer - P.idle.gpu.gbuffer : null;
        parts.push(`phys${Math.round(P.capacity / 1024)}k fly=${f2(P.flying.gpu.layers)} rest=${f2(P.rest.gpu.layers)} draw=${dg == null ? "n/a" : (dg >= 0 ? "+" : "") + dg.toFixed(2)} full=${f2(P.fullFlying.gpu.layers)}/${f2(P.fullRest.gpu.layers)}`);
      }
    }
    const m = o.mem;
    parts.push(`mem gpu=${m.gpu} static=${m.static} screen=${m.screen} phys=${m.phys} pool=${m.pool} heap=${m.heap ?? "n/a"} cache=${m.cache}`);
    parts.push(`bricks=${o.bricks} variants=${o.variants}` + (o.errors.length ? ` errors=${o.errors.length}` : ""));
    return parts.join(" | ");
  }

  // the line on screen, with a copy button (the phone: the user pastes it)
  ME.showBench = function (text) {
    let el = document.getElementById("benchbox");
    if (!el) {
      el = document.createElement("div"); el.id = "benchbox";
      el.style.cssText = "position:fixed;left:10px;right:10px;bottom:10px;z-index:9;background:var(--panel,#1d1c1a);color:var(--fg,#e8e4da);font:12px/1.4 ui-monospace,Consolas,monospace;padding:10px;border-radius:8px;border:1px solid var(--acc,#8a6);word-break:break-all;max-height:45vh;overflow:auto";
      document.body.append(el);
    }
    el.replaceChildren();
    const t = document.createElement("div"); t.textContent = text; el.append(t);
    const row = document.createElement("div"); row.style.cssText = "margin-top:8px;display:flex;gap:8px";
    const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "font:600 13px system-ui;padding:8px 14px;min-height:40px"; b.onclick = fn; row.append(b); return b; };
    const copy = btn("Copy", () => {
      const done = () => { copy.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => sel());
      else sel();
    });
    const sel = () => { const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand("copy"); copy.textContent = "Copied"; } catch (e) { copy.textContent = "Selected: copy it"; } };
    btn("Close", () => el.remove());
    el.append(row);
  };
})();
