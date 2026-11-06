/* Mossheart Engine POC: shared namespace, logging, URL params and column-major mat4 helpers.
   Everything hangs off window.ME, the same way the generator hangs off window.PX. */
(function () {
  const ME = (window.ME = { VS: 16 });

  // ------------------------------------------------------------------ log (also the self-test channel)
  ME.lines = [];
  ME.errors = [];
  ME.log = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    ME.lines.push(s);
    console.log(s);
    const el = document.getElementById("log");
    if (el) el.textContent = ME.lines.slice(-400).join("\n");
  };
  ME.err = (...a) => { ME.errors.push(a.join(" ")); ME.log("ERROR", ...a); };
  window.addEventListener("error", (e) => ME.err("JS", e.message, (e.filename || "").split("/").pop() + ":" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => ME.err("PROMISE", (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

  ME.VERSION = "0.2";
  ME.params = new URLSearchParams(location.search);
  ME.q = (k, d) => (ME.params.has(k) ? ME.params.get(k) : d);
  ME.qn = (k, d) => (ME.params.has(k) ? parseFloat(ME.params.get(k)) : d);

  // ------------------------------------------------------------------ keys by physical position
  // A key binding is a position on the keyboard (KeyboardEvent.code: KeyQ, KeyW, Digit1...), so it stays
  // in the same place on every layout: Q/E on QWERTY are A/E on AZERTY. label(code) is what that key
  // shows on the user's layout, for help text. It comes from the keys pressed so far, else the browser's
  // layout map (navigator.keyboard), else a guess (AZERTY for French, else QWERTY) that the first letter
  // pressed corrects. Shortcuts with Ctrl (undo, save) stay on e.key: they follow the letter, not the place.
  //   ME.keys.code(e) -> e.code; for an event without one (synthetic, old browsers), the QWERTY code of e.key
  //   ME.keys.is(e, ...codes) -> true if e is one of them; "Digit1" also matches "Numpad1"
  //   ME.keys.digit(e) -> 0-9 from the digit row or the numpad (no Shift needed on AZERTY), else -1
  //   ME.keys.label(code) -> "A" for "KeyQ" on AZERTY;  ME.keys.text(s): each {Code} in s becomes its label
  //   ME.keys.layout -> "qwerty" | "azerty" | "qwertz";  ME.keys.onChange(fn): the labels changed
  {
    const K = (ME.keys = {}), seen = new Map(), subs = [];
    const SWAP = { qwerty: {}, azerty: { KeyQ: "A", KeyA: "Q", KeyW: "Z", KeyZ: "W", Semicolon: "M", KeyM: ",", Comma: ";", Period: ":" }, qwertz: { KeyY: "Z", KeyZ: "Y" } };
    const NAMES = { Space: "Space", Comma: ",", Period: ".", Semicolon: ";", BracketLeft: "[", BracketRight: "]", Escape: "Esc", Delete: "Del", Backspace: "Backspace", Home: "Home", Enter: "Enter" };
    const FROM_KEY = { " ": "Space", ",": "Comma", ".": "Period", ";": "Semicolon", "[": "BracketLeft", "]": "BracketRight" };
    let map = null, mapLayout = null;
    const lang = ((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    K.layout = /^fr(-fr|-be|-lu|-mc)?$/.test(lang) ? "azerty" : "qwerty";
    const changed = () => subs.forEach((f) => { try { f(); } catch (e) { ME.err("KEYS", e.message); } });
    // what a letter key's character says of the layout: one of the three, or only which one it is not
    const layoutOf = (code, ch) => ({ KeyQ: { A: "azerty", Q: "!azerty" }, KeyA: { Q: "azerty", A: "!azerty" }, KeyW: { Z: "azerty", W: "!azerty" }, KeyZ: { W: "azerty", Y: "qwertz", Z: "qwerty" }, KeyY: { Z: "qwertz", Y: "!qwertz" } }[code] || {})[ch];
    K.code = (e) => {
      if (e.code) return e.code;
      const k = e.key || "";
      if (/^[a-z]$/i.test(k)) return "Key" + k.toUpperCase();
      if (/^[0-9]$/.test(k)) return "Digit" + k;
      return FROM_KEY[k] || k;
    };
    K.is = (e, ...codes) => { const c = K.code(e); return codes.some((x) => c === x || (x.startsWith("Digit") && c === "Numpad" + x.slice(5))); };
    K.digit = (e) => { const m = /^(?:Digit|Numpad)(\d)$/.exec(K.code(e)); return m ? +m[1] : -1; };
    K.label = (code) => {
      const d = /^(?:Digit|Numpad)(\d)$/.exec(code);
      if (d) return d[1];
      const s = seen.get(code) || (map && mapLayout === K.layout ? map.get(code) : null);
      if (s) return s.length === 1 ? s.toUpperCase() : s;
      if (SWAP[K.layout][code]) return SWAP[K.layout][code];
      const m = /^Key([A-Z])$/.exec(code);
      return m ? m[1] : NAMES[code] || code;
    };
    K.text = (s) => s.replace(/\{(\w+)\}/g, (_, c) => K.label(c));
    K.onChange = (fn) => { subs.push(fn); };
    // what a real key press shows: its character (a letter or punctuation, not a digit: AZERTY's
    // unshifted digit row is & é " ' ...) and the layout it gives away
    K.learn = (e) => {
      if (!e.code || !e.key || e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey || /^(Digit|Numpad)/.test(e.code)) return;
      const ch = e.key.toUpperCase(), was = K.label(e.code);
      seen.set(e.code, ch);
      let L = layoutOf(e.code, ch);
      if (L && L[0] === "!") L = K.layout === L.slice(1) ? "qwerty" : null; // not that one: QWERTY
      // a new layout (the user switched): what was learned on the old one goes
      if (L && L !== K.layout) { seen.clear(); seen.set(e.code, ch); K.layout = L; changed(); } else if (was !== K.label(e.code)) changed();
    };
    // forgets what was learned (tests)
    K.reset = (layout) => { seen.clear(); K.layout = layout || (mapLayout || "qwerty"); changed(); };
    window.addEventListener("keydown", (e) => { if (e.isTrusted) K.learn(e); }, true);
    try {
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard.getLayoutMap().then((m) => {
          map = m;
          mapLayout = m.get("KeyQ") === "a" ? "azerty" : m.get("KeyY") === "z" ? "qwertz" : "qwerty";
          if (!seen.size) K.layout = mapLayout;
          changed();
        }, () => {});
      }
    } catch (e) { /* no layout map (an iframe without the permission): guess and learn */ }
  }

  // Voxels per tile edge: every bake reads ME.VS (and stores it as T.VS). An app picks one of VS_LEVELS
  // with ME.setVS before it bakes; ?vs=N overrides the app's choice. Memory and bake time grow with VS³:
  // above 24 a game offers what ME.vsCeiling allows; 64 also serves close-up asset work (it bakes the whole library
  // in about 190 s).
  ME.VS_LEVELS = [8, 12, 16, 20, 24, 32, 40, 48, 64];
  ME.setVS = (n) => { const L = ME.VS_LEVELS; ME.VS = L.reduce((b, v) => (Math.abs(v - n) < Math.abs(b - n) ? v : b), L[0]); return ME.VS; };
  ME.vsPinned = ME.params.has("vs");
  if (ME.vsPinned) ME.setVS(ME.qn("vs", 16));
  // The densest level this device should offer. Engine's measure (2026-10-24, Mossheart's gardens on a 16 GB
  // Iris Xe laptop, cold bake and the machine's commit charge): 24 bakes in ~34 s for +0.9 GB, 32 in 50-59 s
  // for +1.3-1.5 GB, 40 for +2-2.7 GB (docs/decisions/2026-10-24-density-levels.md); 48 and 64 are unmeasured
  // in the game, as no check bakes 64 on that laptop. It is 64, Maximum, on
  // every device, phones and small-memory machines included (the user: "enable 64 options on published version,
  // mobile included"; 40 opened the same way on 2026-10-26). A game's default stays below it, so 48 and 64 are
  // opt-in, and a load that dies is caught by the game's own crash guard (Mossheart's menu.js starts the next
  // boot a level coarser). The adapter argument and ME.initGPU's ME.gpuClass stay
  // for a later per-device tier. ?vsmax=N overrides it (tests).
  ME.vsCeiling = (adapter = null) => (ME.params.has("vsmax") ? ME.qn("vsmax", 24) : 64);

  // Let the page paint between bake steps, but only every ~40 ms: each real yield costs a frame, and the
  // bake calls this often. A message-channel post is not clamped like setTimeout.
  const ch = new MessageChannel(), waiting = [];
  ch.port1.onmessage = () => waiting.shift()();
  let lastYield = 0;
  ME.tick = () => {
    if (performance.now() - lastYield < 40) return Promise.resolve();
    return new Promise((r) => { waiting.push(() => { lastYield = performance.now(); r(); }); ch.port2.postMessage(0); });
  };
  ME.progress = (label, f) => {
    const bar = document.getElementById("bar"), txt = document.getElementById("bartxt");
    if (bar) bar.style.width = Math.round(f * 100) + "%";
    if (txt) txt.textContent = label;
  };
  ME.now = () => performance.now();
  // The load's stages: ME.stage(name) logs one LOAD line with the seconds since the last stage (the first counts
  // from the navigation, so it includes the scripts) and keeps them in ME.load.stages, in order; ME.stage(name,
  // { at: true }) logs a stage that ran alongside the others (the pipelines) by the time it ended instead.
  // ME.loadNote(text) puts a small line under the loading bar (the bake cache's status), which a phone can read.
  ME.load = { stages: [], last: 0 };
  ME.stage = (name, o = {}) => {
    const now = performance.now(), s = +((o.at ? now : now - ME.load.last) / 1000).toFixed(2);
    if (!o.at) ME.load.last = now;
    ME.load.stages.push([name, s, !!o.at]);
    ME.log("LOAD", name, o.at ? "at " + s + " s" : s + " s");
    return s;
  };
  ME.loadNote = (text) => {
    const box = document.querySelector("#loading .box");
    if (!box) return;
    let el = document.getElementById("loadnote");
    if (!el) { el = document.createElement("div"); el.id = "loadnote"; el.style.cssText = "margin-top:6px;opacity:.7;font:11px ui-monospace,Consolas,monospace"; box.appendChild(el); }
    el.textContent = text;
  };

  // ------------------------------------------------------------------ mat4, column-major (WGSL layout)
  const M4 = (ME.m4 = {});
  M4.fromRows = (r) => { const m = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m[j * 4 + i] = r[i][j]; return m; };
  M4.mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
  };
  M4.apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
  M4.inv = (m) => {
    const a = Array.from(m), inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    for (let i = 0; i < 16; i++) inv[i] /= det;
    return inv;
  };

  // sRGB byte -> linear float
  ME.lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
})();
