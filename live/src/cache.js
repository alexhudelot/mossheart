/* Bake cache: the bake (terrain arrays, mesh, model bricks, grass, palette order) kept in IndexedDB, so a
   repeat launch skips the CPU bake. Two ways to key it:
   - key()/put(): the whole bake in one record. The newest bake is kept per app and map: a key starts with
     its slot (the app id, then the map's id), and a put drops every other record of that slot (an older
     density or version) and keeps the other slots, so two games or two levels on one origin don't evict
     each other. The rest of the key holds the engine version, the density and a fingerprint of the bake
     code, so a changed bake never loads a stale result.
   - terrainKey()/later()/modelCache()/flush() (E3, Mossheart): the parts apart, each keyed on its own input
     and a hand-raised revision (ME.BAKE_REV) in place of the code's fingerprint, so a release that leaves a
     part alone keeps it: the terrain record per slot, a record per model per app (the slot's "#models" list
     names the ones its map uses; a model no list names is dropped). tools\bake-rev.ps1 in Mossheart checks
     that a changed bake raised its number.
   Any failure (no IndexedDB, quota, clone error) falls back to baking. ?nocache=1 skips it. */
(function () {
  const ME = window.ME, DB = "mossheart", STORE = "bake";
  let held = null; // the database get() opened, kept as a value so put() writes with no await before it

  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  // Packed arrays. put() packs every typed array of 1 MB or more (the voxel grid, the mips, the coarse grid,
  // the brick pool) into run-length chunks of CHUNK bytes before the write: the packing is the record's copy
  // (the caller writes T and MB in place once put returns), and IndexedDB then clones only the chunks, where
  // it cloned the whole grid (433 MB at vs40). A chunk is a list of tokens, each a varint v and then: when v
  // is odd, one byte repeated v >> 1 times; when even, v >> 1 bytes as they are. A chunk that packs no
  // smaller is kept as it is (raw). get() unpacks the arrays in place; a record from before packing has none.
  const CHUNK = 1 << 22, BIG = 1 << 20, RUN = 4;
  let scratch = null;
  const packBytes = (src) => {
    const chunks = [];
    if (!scratch) scratch = new Uint8Array(CHUNK + (CHUNK >> 3) + 16);
    const out = scratch;
    for (let a = 0; a < src.length; a += CHUNK) {
      const b = Math.min(src.length, a + CHUNK), lim = b - a;
      let o = 0, i = a, lit = a;
      const vint = (v) => { while (v > 127) { out[o++] = (v & 127) | 128; v >>>= 7; } out[o++] = v; };
      const flush = (e) => {
        const n = e - lit; vint(n * 2);
        if (n < 32) for (let k = lit; k < e; k++) out[o++] = src[k]; else { out.set(src.subarray(lit, e), o); o += n; }
      };
      while (i < b && o < lim) {
        const v = src[i]; let j = i + 1;
        while (j < b && src[j] === v) j++;
        if (j - i >= RUN) { if (lit < i) flush(i); vint((j - i) * 2 + 1); out[o++] = v; lit = j; }
        i = j;
      }
      if (o < lim && lit < b) flush(b);
      chunks.push(o < lim ? { n: lim, d: out.slice(0, o) } : { n: lim, raw: src.slice(a, b) });
    }
    return chunks;
  };
  const unpackBytes = (chunks, dst) => {
    let p = 0;
    for (const c of chunks) {
      if (c.raw) { dst.set(c.raw, p); p += c.n; continue; }
      const d = c.d, end = p + c.n;
      let q = 0;
      while (p < end) {
        let v = 0, s = 0, x;
        do { x = d[q++]; v += (x & 127) * 2 ** s; s += 7; } while (x & 128);
        const n = Math.floor(v / 2);
        if (v & 1) { dst.fill(d[q++], p, p + n); p += n; }
        else if (n < 32) { for (let k = 0; k < n; k++) dst[p++] = d[q++]; }
        else { dst.set(d.subarray(q, q + n), p); q += n; p += n; }
      }
    }
  };
  // the record with its big typed arrays packed (plain objects and arrays walked; anything else kept as is,
  // and a part with nothing to pack kept as the same object). A small view into a bigger buffer is copied
  // (IndexedDB would clone the whole buffer); a ME.BrickGrid goes as its record(). st: the sizes, for checks
  // copy: every typed array copied, small ones too (a record kept while its source changes; packed arrays are copies)
  const pack = (x, st, copy = false) => {
    if (isPacked(x)) return x;
    if (ME.BrickGrid && x instanceof ME.BrickGrid) return pack(x.record(), st, copy);
    if (ArrayBuffer.isView(x)) {
      if (x instanceof DataView) return x;
      if (x.byteLength < BIG) return copy || x.byteLength < x.buffer.byteLength ? x.slice() : x;
      const t0 = performance.now(), chunks = packBytes(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      st.raw += x.byteLength; st.packed += chunks.reduce((s, c) => s + (c.d || c.raw).byteLength, 0); st.ms += performance.now() - t0;
      return { packed: 1, type: x.constructor.name, length: x.length, chunks };
    }
    if (Array.isArray(x)) { let same = !copy; const y = x.map((v) => { const p = pack(v, st, copy); if (p !== v) same = false; return p; }); return same ? x : y; }
    if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
      let y = copy ? Object.assign({}, x) : null;
      for (const k in x) { const v = x[k], p = pack(v, st, copy); if (p !== v) (y || (y = Object.assign({}, x)))[k] = p; }
      return y || x;
    }
    return x;
  };
  function isPacked(x) { return !!x && x.packed === 1 && Array.isArray(x.chunks) && typeof x.type === "string"; }
  // a record's snapshot for a write later (ME.bakeCache.later): its plain objects, arrays and small typed arrays
  // copied now; its big typed arrays and brick grids kept as they are, packed when written (the caller leaves
  // them as they are till then)
  const snap = (x) => {
    if ((ME.BrickGrid && x instanceof ME.BrickGrid) || isPacked(x)) return x;
    if (ArrayBuffer.isView(x)) return x instanceof DataView || x.byteLength >= BIG ? x : x.slice();
    if (Array.isArray(x)) return x.map(snap);
    if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) { const y = {}; for (const k in x) y[k] = snap(x[k]); return y; }
    return x;
  };
  const unpack = (x) => {
    if (isPacked(x)) { const a = new window[x.type](x.length); unpackBytes(x.chunks, new Uint8Array(a.buffer)); return a; }
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) x[i] = unpack(x[i]); return x; }
    if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
      // a brick grid's packed pool goes into one with room to grow (BrickGrid.room), the slots past it unused
      if (x.brickGrid === 1 && isPacked(x.pool) && x.pool.type === "Uint8Array" && ME.BrickGrid.room) {
        const used = x.pool.length / 4096, a = ME.BrickGrid.room(used);
        unpackBytes(x.pool.chunks, a); x.pool = a; x.used = used;
      }
      for (const k in x) x[k] = unpack(x[k]);
      return x.brickGrid === 1 ? ME.BrickGrid.from(x) : x;
    }
    return x;
  };

  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
  // a key's slot: "<app>/<map id>/" (each part URI-encoded, so neither holds a "/")
  const slotOf = (key) => { const m = /^([^/]*\/[^/]*\/)/.exec(key); return m ? m[1] : null; };
  // the default app id: the page's folder (each game's pages and the engine's live in their own)
  const pageApp = () => location.pathname.replace(/[^/]*$/, "");

  // What the cache did this load (ME.bakeCache.status), for the LOAD line, the loading screen and a game's info,
  // so a phone can show why a load was cold:
  //   read: "hit", "miss: key changed" (the slot holds another key: a new release or density), "miss: no record",
  //     "miss: evicted" (the last write landed but the record is gone), "miss: read failed <error>", or "off"
  //   last: the previous load's write for this slot: "ok", "failed <error>", "never finished" (started with no
  //     result: the tab was closed or killed mid-write, as Android does at the memory peak) or "none"
  //   write: this load's: "writing" until put() ends, then as `last`; "none" if nothing was put
  //   persist: navigator.storage.persist()'s answer, "persisted", "not persisted" or "n/a"
  //   models (E3): the model records, "<hits>/<jobs> hit" (then " · wrote <n>/<m>" once flushed), "off" or "none"
  // Each write's state is kept per slot in localStorage (WRITES), before and after it, so the next load reads it.
  // ME.bakeCache.onStatus(fn) calls fn on each change; statusText() is the one line.
  const WRITES = "me.bakeCache.writes", status = { read: "off", last: "none", write: "none", persist: "n/a" }, subs = [];
  const changed = () => subs.forEach((f) => { try { f(status); } catch (e) { ME.log("WARN bake cache status:", e.message); } });
  const writes = () => { try { return JSON.parse(localStorage.getItem(WRITES) || "{}") || {}; } catch (e) { return {}; } };
  const noteWrite = (key, state) => {
    status.write = state === "started" ? "writing" : state; changed();
    try { const w = writes(); w[slotOf(key)] = { key, state, at: Date.now() }; localStorage.setItem(WRITES, JSON.stringify(w)); } catch (e) { /* storage blocked */ }
  };
  // asked on every load the record isn't persisted yet: Chrome answers without a prompt, from the site's engagement,
  // which grows as the game is played; Firefox asks the user once and keeps the answer
  const persist = () => {
    const s = navigator.storage;
    if (!s || !s.persisted || !s.persist) return;
    s.persisted().then((p) => p || s.persist()).then((p) => { status.persist = p ? "persisted" : "not persisted"; changed(); }, () => {});
  };

  // The hand-authored models' sources this bake reads (assets/asset-kit.js, src/asset-format.js, a content
  // pack's own): each registration appends its source to ME.ASSET_SRC and records it by name in ME.ASSET_BY.
  // A key takes the sources of the models its map, content or extra names (as a quoted name), and of the
  // models those sources name in turn, so one level's models don't move another level's key. While some
  // source was appended without its name (the records don't add up to ME.ASSET_SRC), it takes them all.
  const assetSrc = (text) => {
    const by = ME.ASSET_BY, all = ME.ASSET_SRC || "";
    if (!by || Object.values(by).reduce((n, s) => n + s.length, 0) !== all.length) return all;
    const names = Object.keys(by).sort(), inc = new Set();
    let pool = text, grew = true;
    while (grew) { grew = false; for (const n of names) if (!inc.has(n) && pool.includes(JSON.stringify(n))) { inc.add(n); pool += by[n]; grew = true; } }
    return [...inc].sort().map((n) => by[n]).join("");
  };

  // what a key hashes of the bake's input: its slot and the map's id, own (the content, the style or map and
  // extra) and lists (see below)
  const inputOf = (st, extra, o) => {
      // the content the bake reads: terrain roles (functions as their source), the kinds the map's legend
      // names (a generator map's letters are kinds made of the terrain roles), grass, critters, walkers and the
      // ground lamps' kinds. The lists that only name the models a placement may use (volumeDeco,
      // flipbookFrames) and the tables keyed by any model or material (modelScale, primLights, sunShadeHalf,
      // critterScale) are hashed whole but not searched for model names, so a pack's list doesn't pull its
      // models into every map's key (the Architect's #161 review)
      const C = ME.content, src = (k, v) => (typeof v === "function" ? String(v) : v);
      const v1 = st.map && st.map.v !== undefined, kinds = {};
      if (v1 && C && C.kinds) for (const n of Object.values(st.map.legend || {})) if (n !== null && C.kinds[n]) kinds[n] = C.kinds[n];
      const content = C ? JSON.stringify([C.terrain, kinds, C.defaultMaterial, ME.grassFor ? ME.grassFor(st) : C.grass, C.critters, C.walkers, C.groundLamps, C.edgeRound, ME.qn("edgebreak", 1) === 0 ? null : C.edgeBreak, C.sand], src) : "";
      const lists = C ? JSON.stringify([C.volumeDeco, C.flipbookFrames, C.modelScale, C.critterScale, C.primLights, C.sunShadeHalf], src) : "";
      // a v1 map names the bake, and its game block (route, cover, spawns) is not baked, but for its lane
      // kinds (game.lane: the edge breakup keeps their borders straight, bake-terrain.js)
      const game = v1 && st.map.game ? { lane: st.map.game.lane } : undefined;
      const s = v1 ? Object.assign({}, st, { map: Object.assign({}, st.map, { game }) }) : st, id = v1 ? st.map.id : st.id;
      const slot = encodeURIComponent(o.app ?? pageApp()) + "/" + encodeURIComponent(id) + "/";
      return { slot, id, own: content + JSON.stringify(s) + extra, lists };
  };

  // E3 (the vs64 load study's PR 2): the bake in parts that outlive a release. A terrain record per app and map
  // (terrainKey: the grid, the coarse grid as the terrain bake left it, the mips, the mesh, the grass and the
  // palette's names), and a record per worker job of the model bake (modelCache: the worker's answer, keyed by the
  // job's input, so any map with the same model shares it). Neither key holds the engine's version or its code:
  // BAKE_REV does, one number per part, raised by hand whenever the code changes what that part bakes.
  // Mossheart's tools\bake-rev.ps1 bakes every map at vs12 and fails when a part's output changed and its
  // number didn't (warns on a raise with no change). The parts are written after R.init (flush), one at a time.
  ME.BAKE_REV = { terrain: 1, models: 1 };
  // ?bakerev=1: hashes of what the parts would store (ME.bakeCache.trace: terrain, models by key), for bake-rev.ps1;
  // with or without the cache. Timings (stats, ms, *Ms, a worker's idle and first) are left out; fields: each model record's top-level parts hashed, by key
  const trace = ME.qn("bakerev", 0) ? { terrain: null, models: {}, fields: {} } : null, TIMING = /^(stats|ms|idle|first)$|Ms$/;
  const hashOf = (x) => {
    let h = 0x811c9dc5;
    const str = (s) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); };
    const walk = (v) => {
      if (ME.BrickGrid && v instanceof ME.BrickGrid) return walk(v.record());
      if (ArrayBuffer.isView(v)) { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); str(v.constructor.name + v.length); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619); return; }
      if (Array.isArray(v)) { str("["); v.forEach(walk); str("]"); return; }
      if (v && typeof v === "object") { str("{"); for (const k of Object.keys(v).sort()) if (!TIMING.test(k)) { str(k + ":"); walk(v[k]); } str("}"); return; }
      str(String(v) + ",");
    };
    walk(x);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const off = () => !!ME.qn("nocache", 0) || !window.indexedDB;
  const keyHash = (s) => fnv(s) + fnv("|" + s) + s.length.toString(36);
  const MODELS = "~models/", REFS = "#models";
  const appOf = (o) => encodeURIComponent(o.app ?? pageApp()) + "/";
  // the parts waiting for flush: the terrain record ([key, snapshot]) and the model records ([key, packed copy]);
  // a model's answer kept after the flush is written at once (chain: one write at a time). wanted: every model key
  // this load's bakes asked for (stored by map at the flush, REFS, so a model no map wants is dropped)
  let laterT = null, laterM = [], flushed = false, chain = Promise.resolve();
  const wanted = new Set();
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  const db = async () => held || (held = await open());
  const putOne = async (key, rec) => { const tx = (await db()).transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec, key); await done(tx); };
  status.models = "none";

  ME.bakeCache = {
    // extra: anything else the bake depends on (an app's own model list, as a string)
    // o.app: the app's id (default: the page's folder); with the map's id it names the key's slot
    // o.focus: the bake bakes the models' md.focus (ME.bakeModels' opts.focus), so focused and plain records never share a key
    // (the whole bake in one record, keyed on the engine's version and its code; Mossheart keeps its parts: terrainKey)
    key(st, extra = "", o = {}) {
      const code = [ME.bakeTerrain, ...(ME.bakeTerrain.parts || []), ME.coarseStep, ME.coarseFill, ME.greedyMesh, ME.bakeModels, ...(ME.bakeModels.parts || []), ME.voxelizeModel, ...(ME.voxelizeModel.parts || []), ME.reduce, ...((ME.reduce && ME.reduce.parts) || []), ME.stampModel, ME.bakeGrass, ME.modelOf].map(String).join("|");
      const { slot, id, own, lists } = inputOf(st, extra, o);
      // the pool's check knobs (bake-models.js: ME.poolSlab / ?poolslab, ME.poolHollow / ?hollow), when set
      const slab = ME.poolSlab || ME.qn("poolslab", 0), knobs = (slab ? "|slab" + slab : "") + (ME.poolHollow === false || ME.qn("hollow", 1) === 0 ? "|solid" : "");
      return `${slot}${ME.VERSION}:${id}:vs${ME.VS}:${fnv(code + assetSrc(own) + own + lists + (o.focus ? "|focus" : "") + knobs)}`;
    },
    // the terrain record's key: the map's content (as key() takes it, with the sources of the models the terrain
    // bake stamps), BAKE_REV.terrain and the density. extra: anything else the terrain bake reads. Read with get()
    terrainKey(st, extra = "", o = {}) {
      const { slot, own, lists } = inputOf(st, extra, o);
      return `${slot}T${ME.BAKE_REV.terrain}:vs${ME.VS}:${keyHash(assetSrc(own) + own + lists)}`;
    },
    // the terrain record, stored at the flush: its plain parts copied now (snap), its big arrays as they are then,
    // so the caller copies any it changes before (the model bake splats into T.coarse; R.init drops T.mips)
    later(key, rec) {
      if (trace) trace.terrain = hashOf(rec);
      if (!off()) laterT = [key, snap(rec)];
    },
    // the model bake's cache (ME.bakeModels with opts.cache): load(qs) reads the stored answers of the worker jobs
    // qs (their inputs, q), then hit(q) is one (or undefined) and keep(q, r) stores a worker's answer (copied at once:
    // the bake renumbers it in place). A finishing job (q.finish: its input is the bake's own) is not stored
    modelCache(o = {}) {
      const app = appOf(o), keys = new WeakMap(), hits = new Map();
      const keyOf = (q) => {
        if (q.finish) return null;
        if (!keys.has(q)) { const { id, ...rest } = q; keys.set(q, `${app}${MODELS}m${ME.BAKE_REV.models}:vs${ME.VS}:${keyHash(JSON.stringify(rest))}`); }
        return keys.get(q);
      };
      return {
        async load(qs) {
          const ks = qs.map(keyOf).filter(Boolean);
          for (const k of ks) wanted.add(k);
          if (off()) { status.models = "off"; return; }
          try {
            const s = (await db()).transaction(STORE).objectStore(STORE), got = await Promise.all(ks.map((k) => req(s.get(k))));
            got.forEach((r, i) => { if (r) hits.set(ks[i], unpack(r)); });
          } catch (e) { ME.log("WARN bake cache: model read failed:", e && e.message); }
          status.models = `${hits.size}/${ks.length} hit`; changed();
        },
        has(q) { const k = keyOf(q); return !!k && hits.has(k); },
        // (once: the bake takes the answer in in place)
        hit(q) { const k = keyOf(q), r = k ? hits.get(k) : undefined; if (r) { hits.delete(k); r.id = q.id; } return r; }, // (its id: this bake's job)
        keep(q, r) {
          const k = keyOf(q);
          if (!k || !r || r.error) return;
          if (trace) { const { id, ...rec } = r; trace.models[k] = hashOf(rec); trace.fields[k] = Object.fromEntries(Object.keys(rec).filter((f) => !TIMING.test(f)).map((f) => [f, hashOf(rec[f])])); } // (not its id: the job's number, in the order the jobs went out)
          if (off()) return;
          let rec;
          try { rec = pack(r, { raw: 0, packed: 0, ms: 0 }, true); } catch (e) { ME.log("WARN bake cache: model pack failed:", e && e.message); return; }
          if (!flushed) laterM.push([k, rec]);
          else chain = chain.then(() => putOne(k, rec)).catch((e) => ME.log("WARN bake cache: model write failed:", e && e.message));
        },
      };
    },
    // writes the parts waiting (later, keep), one at a time, once the app is past its memory peak (Mossheart: after
    // R.init): the terrain record (replacing its slot's other records), the model records, then the models this
    // map's bake asked for (key's slot + REFS); a model record no map of the app asks for is dropped. key: the
    // terrain record's (on a hit too: it names the map). Its state is noted like put()'s (status.write, WRITES)
    async flush(key) {
      flushed = true;
      if (off()) return;
      const slot = slotOf(key), app = slot.replace(/[^/]*\/$/, ""), refs = slot + REFS, name = (e) => (e && e.name) || "error";
      const t = laterT, ms = laterM, st = { raw: 0, packed: 0, ms: 0 };
      laterT = null; laterM = [];
      const run = async () => {
        if (t) {
          noteWrite(key, "started");
          try {
            const rec = pack(t[1], st), d = await db(), tx = d.transaction(STORE, "readwrite"), s = tx.objectStore(STORE);
            s.put(rec, key);
            const g = s.getAllKeys();
            g.onsuccess = () => { for (const k of g.result) if (k !== key && k !== refs && (typeof k !== "string" || slotOf(k) === slot || slotOf(k) === null)) s.delete(k); };
            await done(tx);
            ME.bakeCache.packed = { rawMB: +(st.raw / 1048576).toFixed(1), packedMB: +(st.packed / 1048576).toFixed(1), ms: Math.round(st.ms) }; // (checks read it)
            noteWrite(key, "ok");
          } catch (e) {
            ME.log("WARN bake cache write failed:", e && e.message);
            noteWrite(key, "failed " + name(e));
            // the store is full: drop every other app's and map's records but this app's models, for the next launch
            if (e && e.name === "QuotaExceededError") try {
              const tx = (await db()).transaction(STORE, "readwrite"), s = tx.objectStore(STORE), g = s.getAllKeys();
              g.onsuccess = () => { for (const k of g.result) if (typeof k !== "string" || (slotOf(k) !== slot && !k.startsWith(app + MODELS))) s.delete(k); };
              ME.bakeCache.evicted = true;
            } catch (_) {}
          }
        }
        let n = 0;
        for (const [k, rec] of ms) try { await putOne(k, rec); n++; } catch (e) { ME.log("WARN bake cache: model write failed:", e && e.message); break; }
        if (ms.length) { status.models += ` · wrote ${n}/${ms.length}`; changed(); }
        // this map's models, then every model record of the app that no map's list names dropped
        const mine = [...wanted].filter((k) => k.startsWith(app));
        try {
          const d = await db(), all = await req(d.transaction(STORE).objectStore(STORE).getAllKeys()), lists = all.filter((k) => typeof k === "string" && k.startsWith(app) && k.endsWith(REFS) && k !== refs);
          const tx = d.transaction(STORE, "readwrite"), s = tx.objectStore(STORE), keep = new Set(mine);
          for (const l of await Promise.all(lists.map((k) => req(s.get(k))))) for (const k of l || []) keep.add(k);
          s.put(mine, refs);
          for (const k of all) if (typeof k === "string" && k.startsWith(app + MODELS) && !keep.has(k)) s.delete(k);
          await done(tx);
        } catch (e) { ME.log("WARN bake cache: model list failed:", e && e.message); }
      };
      chain = chain.then(run, run);
      return chain;
    },
    trace,
    hashOf,
    async get(key) {
      if (ME.qn("nocache", 0) || !window.indexedDB) { status.read = "off"; changed(); return null; }
      const was = writes()[slotOf(key)];
      status.last = !was ? "none" : was.state === "started" ? "never finished" : was.state;
      persist();
      try {
        const db = (held = await open()), s = db.transaction(STORE).objectStore(STORE);
        const rec = await new Promise((res, rej) => { const r = s.get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
        if (!rec) {
          // why: another key in this slot, or the last write landed and its record is gone
          const keys = await new Promise((res) => { try { const r = db.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); } catch (e) { res([]); } });
          status.read = "miss: " + (keys.some((k) => typeof k === "string" && slotOf(k) === slotOf(key) && !k.endsWith(REFS)) ? "key changed" : was && was.state === "ok" ? "evicted" : "no record");
          changed();
          return null;
        }
        const t0 = performance.now();
        unpack(rec); // (in place: the chunks go with the record's packed parts)
        ME.bakeCache.unpackMs = Math.round(performance.now() - t0);
        status.read = "hit"; changed();
        return rec;
      } catch (e) { ME.log("WARN bake cache read failed:", e.message); status.read = "miss: read failed " + ((e && e.name) || "error"); changed(); return null; }
    },
    status,
    onStatus(fn) { subs.push(fn); },
    // "cache hit · last write ok · storage persisted"; "cache miss: key changed · write ok · ..." once this load's
    // write is done. short: "hit · ok · persisted" (a corner label on a phone)
    statusText(short) {
      if (status.read === "off") return "cache off";
      const mine = status.write !== "none", w = mine ? status.write : status.last, m = status.models === "none" ? "" : short ? ` · m ${status.models.replace(" hit", "")}` : ` · models ${status.models}`;
      return short ? `${status.read.replace("miss: ", "miss ")} · ${w}${m} · ${status.persist}` : `cache ${status.read} · ${mine ? "write" : "last write"} ${w}${m} · storage ${status.persist}`;
    },
    // fire and forget: the record is copied here, before the first await (the caller goes on to R.init, the sim
    // and the critters, which write some of T and MB in place: a later copy would store a played scene), and
    // the write commits in the background. Packing copies the big arrays; with the database get() opened,
    // IndexedDB's put() clones the rest (synchronous); without it, structuredClone keeps a copy while the
    // database opens. It replaces its slot's other records and any record without a slot (from before slots).
    // E4: a progressive bake's record (rec.MB.prog) is stored once its upgrade is done, with the full models, so the
    // next launch starts on them: the rest is copied now as it is (T, the mesh, the grass and MB's statics, which
    // the game plays), MB (compacted: MB.prog.compact) and the palette's names (the full models bring materials)
    // then. Nothing is stored if the
    // upgrade fails or is cancelled.
    async put(key, rec) {
      if (ME.qn("nocache", 0) || !window.indexedDB) return;
      const slot = slotOf(key), st = { raw: 0, packed: 0, ms: 0 }, prog = rec.MB && rec.MB.prog, names = rec.palNames;
      const name = (e) => (e && e.name) || "error";
      noteWrite(key, "started");
      try { rec = pack(prog ? Object.assign({}, rec, { palNames: null, MB: { statics: rec.MB.statics } }) : rec, st); if (prog) rec = structuredClone(rec); } catch (e) { ME.log("WARN bake cache pack failed:", e && e.message); noteWrite(key, "failed pack " + name(e)); return; }
      if (prog) {
        if (!(await prog.upgraded)) { ME.log("WARN bake cache: the progressive bake's upgrade did not finish, so it is not stored"); noteWrite(key, "failed upgrade"); return; }
        try { rec.MB = pack(Object.assign(prog.compact(), { statics: rec.MB.statics }), st); rec.palNames = names.slice(); } catch (e) { ME.log("WARN bake cache pack failed:", e && e.message); noteWrite(key, "failed pack " + name(e)); return; }
      }
      ME.bakeCache.packed = { rawMB: +(st.raw / 1048576).toFixed(1), packedMB: +(st.packed / 1048576).toFixed(1), ms: Math.round(st.ms) }; // (checks read it)
      const write = (db, r) => {
        const tx = db.transaction(STORE, "readwrite"), s = tx.objectStore(STORE);
        try {
          s.put(r, key);
          const g = s.getAllKeys();
          g.onsuccess = () => { for (const k of g.result) if (k !== key && (typeof k !== "string" || slotOf(k) === slot || slotOf(k) === null)) s.delete(k); };
        } catch (e) { try { tx.abort(); } catch (_) {} throw e; } // a put that throws deletes nothing
        return tx;
      };
      try {
        let tx = null;
        ME.bakeCache.via = "held"; // how the last put copied the record (checks read it)
        // the held connection closed, or put threw: drop the handle so this put and the next take the fallback
        if (held) try { tx = write(held, rec); } catch (e) { tx = null; held = null; }
        if (!tx) {
          ME.bakeCache.via = "structuredClone";
          const copy = structuredClone(rec), db = await open();
          tx = write(db, copy);
        }
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
        noteWrite(key, "ok");
      } catch (e) {
        ME.log("WARN bake cache write failed:", e && e.message);
        noteWrite(key, "failed " + name(e));
        // the store is full (one record per app and map adds up): drop every other slot, so the next launch's
        // put fits. Not retried now: the record has changed since the call (see above)
        if (e && e.name === "QuotaExceededError") {
          try {
            const db = held || (await open()), tx = db.transaction(STORE, "readwrite"), s = tx.objectStore(STORE), g = s.getAllKeys();
            g.onsuccess = () => { for (const k of g.result) if (typeof k !== "string" || slotOf(k) !== slot) s.delete(k); };
            ME.bakeCache.evicted = true;
          } catch (_) {}
        }
      }
    },
    // the stored keys (for checks and tools)
    async keys() {
      if (!window.indexedDB) return [];
      try {
        const db = held || (await open());
        return await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      } catch (e) { return []; }
    },
  };
})();
