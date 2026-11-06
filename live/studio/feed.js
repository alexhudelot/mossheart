/* Voxel Live on Pages: the feed. The page polls ../scene.json ({ n, title, prompt, file, at }); when n changes
   it fetches the scene script (a live.run body, as tools/voxel-live.ps1 -File takes) and runs it. ?s=N pins
   scene N (scenes/N.js) and stops polling. A badge shows the scene, its prompt and when it landed. */
(function () {
  const POLL_MS = 15000;
  const q = new URLSearchParams(location.search);
  const pin = q.get("s");
  let seen = null, busy = false;
  const badge = document.createElement("div");
  badge.id = "feed-badge";
  badge.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:50;max-width:min(92vw,640px);" +
    "padding:8px 12px;border-radius:10px;background:rgba(18,22,20,.82);color:#e8efe9;font:13px/1.4 system-ui,sans-serif;" +
    "box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:auto;white-space:pre-wrap";
  const say = (t) => { badge.textContent = t; };
  const fresh = (u) => fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" }); };

  async function show(meta) {
    busy = true;
    say("Loading #" + meta.n + " " + meta.title + "…");
    try {
      const r = await fresh("../" + meta.file);
      if (!r.ok) throw new Error(meta.file + ": HTTP " + r.status);
      const res = await window.live.run(await r.text());
      const err = res.startsWith("error") ? "\n⚠ " + res.slice(6) : "";
      say("#" + meta.n + " " + meta.title + (meta.prompt ? "\n“" + meta.prompt + "”" : "") + "\n" + when(meta.at) + (pin ? " · pinned" : " · watching for new scenes") + err);
    } catch (e) { say("Couldn't load #" + meta.n + ": " + (e.message || e)); }
    busy = false;
  }

  async function tick() {
    if (busy || !window.live || !window.live.ready) return;
    try {
      const r = await fresh("../scene.json");
      if (!r.ok) throw new Error("scene.json: HTTP " + r.status);
      const m = await r.json();
      if (m.n !== seen) { seen = m.n; await show(m); }
    } catch (e) { if (seen === null) say("No scene yet (" + (e.message || e) + ")"); }
  }

  function start() {
    document.body.append(badge);
    if (pin) {
      fresh("../history.json").then((r) => r.json()).then((h) => {
        const m = h.find((x) => String(x.n) === pin);
        if (m) show(m); else say("No scene #" + pin);
      }).catch((e) => say("Couldn't read history: " + (e.message || e)));
      return;
    }
    tick();
    setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }
  const wait = () => (window.live && window.live.ready ? start() : setTimeout(wait, 100));
  wait();
})();
