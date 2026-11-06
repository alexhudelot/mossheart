/* Easy close for a game's pop-ups (moved here from Mossheart's view/dismiss.js, 2026-11-05, so DeckChess
   shares it): every dismissible pop-up closes three ways, a tap
   outside it, its ✕ (a 44px target on a phone) or a swipe on a touch screen (down for sheets and cards, any
   way for the modals; the panel follows the finger and snaps back short of the threshold). Esc stays with
   its owners (a game's menu and main). ME.Dismiss.add(el, o) wires one:
     o.close()   closes it (the owner's own close, so its state stays right)
     o.panel     what carries the ✕ and follows the finger (default el)
     o.hit       a selector: taps inside a match are not "outside" (default: inside o.panel)
     o.veil      el is a backdrop over the game: a click on it outside o.panel closes
     o.outside   el floats over the game: a tap anywhere outside it closes and is swallowed, so it never
                 reaches the meadow; o.open() says whether it is showing, o.skip(target) spares its toggle
     o.dir       "down" (default) or "any"
     o.x         false: no ✕ of ours (the panel has its own, the game tip)
     o.tab       a choice (the gifts, the run's end): it never closes, it minimises to a tab of that label
                 at the bottom that brings it back; the owner drops the tab with ME.Dismiss.untab(el)
   ME.Dismiss.drag(el, [{x, y, t}, ...]) runs a swipe from plain points, for the flows. The ✕ is .x and the
   tab #dztab, styled by the game (Mossheart: game.css); a choice's ✕ is a – (it minimises). */
(function () {
  const ME = window.ME;
  // (ME.Dismiss.scrollers: a selector of the inner lists that scroll, which keep a swipe while they can)
  const LOCK = 8, FAR = 60, FLICK = 0.5, FLICK_MIN = 20;
  const wired = new Map();
  let eatClick = 0, eatId = null, eatAt = null;

  // a choice minimised: one tab at a time
  let tab = null, tabFor = null;
  const untab = (el) => { if (tab && (!el || tabFor === el)) { tab.remove(); tab = null; tabFor = null; } };
  const minimise = (el, label) => {
    el.classList.remove("show"); untab();
    tab = document.createElement("button");
    tab.id = "dztab"; tab.className = "btn"; tab.textContent = label + " ▴"; tabFor = el;
    tab.addEventListener("click", () => { untab(); el.classList.add("show"); });
    (document.getElementById("ui") || document.body).appendChild(tab);
  };

  // the swipe, from plain points: start, move (true once it is a swipe of ours), end
  const swipe = {
    start(w, p, target) { w.sw = { x: p.x, y: p.y, t: p.t, lx: p.x, ly: p.y, lt: p.t, on: false, off: false, target }; },
    move(w, p) {
      const s = w.sw;
      if (!s || s.off) return false;
      const dx = p.x - s.x, dy = p.y - s.y;
      if (!s.on) {
        if (Math.hypot(dx, dy) < LOCK) return false;
        const vert = Math.abs(dy) >= Math.abs(dx);
        if (w.o.dir !== "any" && !(vert && dy > 0)) { s.off = true; return false; }
        // an inner list that can still scroll that way keeps the gesture
        const sc = s.target && s.target.closest && D.scrollers && s.target.closest(D.scrollers);
        if (sc && w.panel.contains(sc) && vert) {
          const up = sc.scrollTop > 0, down = sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1;
          if ((dy > 0 && up) || (dy < 0 && down)) { s.off = true; return false; }
        }
        s.on = true; w.panel.style.transition = "none";
      }
      const tx = w.o.dir === "any" ? dx : 0, ty = w.o.dir === "any" ? dy : Math.max(0, dy);
      w.panel.style.translate = `${tx}px ${ty}px`;
      w.panel.style.opacity = String(Math.max(0.35, 1 - Math.hypot(tx, ty) / 400));
      s.vx = (p.x - s.lx) / Math.max(1, p.t - s.lt); s.vy = (p.y - s.ly) / Math.max(1, p.t - s.lt);
      s.lx = p.x; s.ly = p.y; s.lt = p.t; s.tx = tx; s.ty = ty;
      return true;
    },
    end(w) {
      const s = w.sw; w.sw = null;
      if (!s || !s.on) return false;
      const d = Math.hypot(s.tx, s.ty), v = w.o.dir === "any" ? Math.hypot(s.vx, s.vy) : s.vy;
      eatClick = performance.now() + 400; eatId = null; eatAt = null;
      if (d > FAR || (v > FLICK && d > FLICK_MIN)) { reset(w.panel, false); close(w); return true; }
      reset(w.panel, true);
      return false;
    },
  };
  const reset = (panel, ease) => {
    panel.style.transition = ease ? "translate 0.18s ease-out, opacity 0.18s" : "none";
    panel.style.translate = ""; panel.style.opacity = "";
    if (ease) setTimeout(() => { panel.style.transition = ""; }, 200); else panel.style.transition = "";
  };
  const close = (w) => { if (w.o.tab) minimise(w.el, w.o.tab); else w.o.close(); };

  function add(el, o) {
    if (!el) return;
    const panel = o.panel || el, w = { el, o, panel, sw: null };
    wired.set(el, w);
    if (getComputedStyle(panel).position === "static") panel.style.position = "relative";
    const x = document.createElement("button");
    x.className = "x"; x.type = "button"; x.textContent = o.tab ? "–" : "✕"; x.setAttribute("aria-label", o.tab ? "Minimise" : "Close");
    x.addEventListener("click", (e) => { e.stopPropagation(); close(w); });
    if (o.x !== false) panel.appendChild(x);
    // (a target no longer in the page was inside: a click that re-renders what it hit, Settings' tabs and
    // options, reaches the veil after its button is gone)
    const inside = (t) => !t.isConnected || (o.hit ? !!t.closest(o.hit) : panel.contains(t)) || t === x;
    if (o.veil) el.addEventListener("click", (e) => { if (performance.now() < eatClick) return; if (!inside(e.target)) close(w); });
    if (o.outside) {
      document.addEventListener("pointerdown", (e) => {
        if (!o.open() || el.contains(e.target) || (o.skip && o.skip(e.target))) return;
        e.preventDefault(); e.stopPropagation();
        eatId = e.pointerId; eatAt = e.target; eatClick = performance.now() + 700;
        close(w);
      }, true);
    }
    // touch: the panel follows the finger. The rest of the touch is heard on what it began on, not the panel: a
    // card that re-renders mid-swipe (the docked plant card on each dew tick) drops that node from the page, and
    // a touch's later events go to it alone, never bubbling up to the panel
    const pt = (e) => { const t = e.changedTouches[0]; return { x: t.clientX, y: t.clientY, t: performance.now() }; };
    // Chrome picks at touchstart whether a touch may block scrolling, from the listeners already there: this one
    // keeps the target's touchmoves cancelable, so a swipe-close never pulls to refresh or scrolls the card
    panel.addEventListener("touchmove", () => {}, { passive: false });
    panel.addEventListener("touchstart", (e) => {
      if (w.off) w.off();
      if (e.touches.length !== 1) { w.sw = null; return; }
      const t = e.target;
      swipe.start(w, pt(e), t);
      const move = (e) => { if (swipe.move(w, pt(e))) e.preventDefault(); };
      const end = () => { w.off(); swipe.end(w); };
      const cancel = () => { w.off(); if (w.sw && w.sw.on) reset(panel, true); w.sw = null; };
      t.addEventListener("touchmove", move, { passive: false }); t.addEventListener("touchend", end); t.addEventListener("touchcancel", cancel);
      w.off = () => { w.off = null; t.removeEventListener("touchmove", move); t.removeEventListener("touchend", end); t.removeEventListener("touchcancel", cancel); };
    }, { passive: true });
  }

  // the tap that closed a panel (or ended a swipe) stops here: its pointerup and click never reach the game
  const eat = (e) => {
    if (performance.now() >= eatClick) return;
    if (e.type === "pointerup" && e.pointerId !== eatId) return;
    if (e.type === "click") {
      if (e.target.closest && e.target.closest(".x, #dztab")) return;
      // (one click only, on what the closing tap hit: a quick next tap elsewhere, the wave button right after
      // closing the sky panel, goes through)
      if (eatAt && e.target !== eatAt) return;
      eatClick = 0;
    }
    e.preventDefault(); e.stopPropagation();
  };
  document.addEventListener("pointerup", eat, true);
  document.addEventListener("click", eat, true);

  // a swipe from plain points (the flows): true if it closed
  function drag(el, pts) {
    const w = wired.get(el);
    if (!w || pts.length < 2) return false;
    swipe.start(w, pts[0], w.panel);
    for (const p of pts.slice(1)) swipe.move(w, p);
    return swipe.end(w);
  }

  const D = ME.Dismiss = { add, drag, untab, tabbed: () => tabFor, scrollers: "" };
})();
