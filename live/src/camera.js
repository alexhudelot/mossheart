/* Camera: the generator's 2:1 projection (px.js P.proj) as an affine clip matrix.
   screen x = (X'-Y')*a, screen y = (X'+Y')*a/2 - Z*a, depth = X'+Y'+Z (bigger = nearer),
   where (X', Y') is the world rotated about the island centre. 90-degree snaps animate the turn. */
(function () {
  const ME = window.ME, M4 = ME.m4;
  const D0 = -48, D1 = 52; // depth range in X'+Y'+Z units; reversed-Z (near = 1)

  class Camera {
    constructor(cx, cy) {
      this.C = [cx, cy];
      this.k = 0; this.theta = 0; this.from = 0; this.to = 0; this.t0 = null;
      this.zoom = 30; this.pan = [0, 0];
      this.minZoom = 6; this.maxZoom = 400; // (canvas px per tile; a game scales them with its canvas DPR)
      this.D0 = D0; this.D1 = D1; this.foc = null;
    }
    snap(dir) {
      this.k += dir;
      this.from = this.theta; this.to = (this.k * Math.PI) / 2; this.t0 = ME.now();
    }
    get turning() { return this.t0 !== null; }
    // jump to quarter turn k at once (no easing): a showroom or a saved view
    turnTo(k) { this.k = k; this.theta = this.from = this.to = (k * Math.PI) / 2; this.t0 = null; }
    // Ease the view to the world point p over o.s seconds (and the zoom to o.zoom, if given). The player's
    // drag or wheel, lookAt and fit cancel it; busy says whether the view still moves (a focus or a Q/E
    // turn). A turn on the way keeps p centred.
    // s: seconds (at least 0.05); zoom: the zoom to end at (minZoom-maxZoom), null or left out to keep it
    focus(p, o = {}) { this.foc = { p: p.slice(), s: Math.max(0.05, o.s ?? 0.6), z0: this.zoom, z1: o.zoom != null ? Math.max(this.minZoom, Math.min(this.maxZoom, o.zoom)) : null, from: this.pan.slice(), t0: ME.now() }; }
    get busy() { return !!this.foc || this.t0 !== null; }
    update(now) {
      const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
      if (this.t0 !== null) {
        const u = Math.min(1, (now - this.t0) / 520);
        this.theta = this.from + (this.to - this.from) * ease(u);
        if (u >= 1) { this.theta = this.to; this.t0 = null; }
      }
      if (this.foc) {
        const F = this.foc, u = Math.min(1, (now - F.t0) / (F.s * 1000)), e = ease(u), to = this.panOf(F.p);
        this.pan = [F.from[0] + (to[0] - F.from[0]) * e, F.from[1] + (to[1] - F.from[1]) * e];
        if (F.z1 !== null) this.zoom = F.z0 + (F.z1 - F.z0) * e;
        if (u >= 1) this.foc = null;
      }
    }
    // Snap index 0..3 nearest to the current angle (used to pick pre-sorted terrain index ranges).
    snapIndex(theta = this.theta) { return (((Math.round(theta / (Math.PI / 2)) % 4) + 4) % 4); }
    // frame the valley's island, or the box cam.box = [min, max] when one is set
    fit(w, h) {
      this.foc = null;
      if (this.box) return this.fitBox(this.box[0], this.box[1], w, h);
      this.zoom = Math.min(w / 37, h / 24.5);
      this.pan = [0, -3.2];
    }
    // Frame the world box min..max (T.bounds) at the current turn, with a margin, and take the depth range
    // from it: X'+Y' about the centre stays within its xy radius times sqrt(2) at any turn, and Z within
    // the box, with room for volumes and particles above it.
    fitBox(min, max, w, h, margin = 0.92) {
      this.foc = null;
      const c = Math.cos(this.theta), s = Math.sin(this.theta), [Cx, Cy] = this.C;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, r = 0;
      for (let k = 0; k < 8; k++) {
        const x = (k & 1 ? max : min)[0] - Cx, y = (k & 2 ? max : min)[1] - Cy, z = (k & 4 ? max : min)[2];
        const X = c * x - s * y, Y = s * x + c * y, sx = X - Y, sy = z - 0.5 * (X + Y);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); r = Math.max(r, Math.hypot(x, y));
      }
      this.zoom = margin * Math.min(w / (x1 - x0), h / (y1 - y0));
      this.pan = [(x0 + x1) / 2, -(y0 + y1) / 2];
      this.D0 = -Math.SQRT2 * r + min[2] - 2; this.D1 = Math.SQRT2 * r + max[2] + 6;
    }
    // centre the view on a world point (panOf: the pan that does it, at the current turn)
    lookAt(p) { this.foc = null; this.pan = this.panOf(p); }
    panOf(p) {
      const c = Math.cos(this.theta), s = Math.sin(this.theta), x = p[0] - this.C[0], y = p[1] - this.C[1], X = c * x - s * y, Y = s * x + c * y;
      return [X - Y, 0.5 * (X + Y) - p[2]];
    }
    // The view ray under canvas pixel (px, py) of a w x h canvas: from the near plane (a) along the unit
    // vector dir, L world units to the far plane (picking: R.pick, ME.pickGround, sim.pick).
    ray(px, py, w, h) {
      const { ivp } = this.matrices(w, h), x = (px / w) * 2 - 1, y = 1 - (py / h) * 2;
      const a = M4.apply(ivp, [x, y, 1]), b = M4.apply(ivp, [x, y, 0]), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      return { a, dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L], L };
    }
    matrices(w, h) {
      const c = Math.cos(this.theta), s = Math.sin(this.theta), [Cx, Cy] = this.C;
      const R = M4.fromRows([[c, -s, 0, -c * Cx + s * Cy], [s, c, 0, -s * Cx - c * Cy], [0, 0, 1, 0], [0, 0, 0, 1]]);
      const kx = (this.zoom * 2) / w, ky = (this.zoom * 2) / h, [px, py] = this.pan, dz = 1 / (this.D1 - this.D0);
      const P = M4.fromRows([
        [kx, -kx, 0, -px * kx],
        [-0.5 * ky, -0.5 * ky, ky, py * ky],
        [dz, dz, dz, -this.D0 * dz],
        [0, 0, 0, 1],
      ]);
      const vp = M4.mul(P, R), r3 = Math.sqrt(3);
      return { vp, ivp: M4.inv(vp), vdir: [(-c - s) / r3, (s - c) / r3, -1 / r3] };
    }
    // World point -> canvas pixel (for HUD labels / tests).
    toScreen(p, w, h) { const { vp } = this.matrices(w, h), q = M4.apply(vp, p); return [(q[0] * 0.5 + 0.5) * w, (0.5 - q[1] * 0.5) * h]; }

    // Zoom by f keeping the canvas pixel m fixed (a canvas pixel is zoom * (screen - pan) + centre).
    zoomAt(m, f, el) {
      const z = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * f)), c = [el.width / 2, el.height / 2];
      for (const k of [0, 1]) this.pan[k] += (m[k] - c[k]) * (1 / this.zoom - 1 / z);
      this.zoom = z;
    }

    attach(el, onChange) {
      const ptrs = new Map();
      // client px -> canvas px (the canvas DPR is capped, so devicePixelRatio is not the ratio)
      const px = (e) => { const r = el.getBoundingClientRect(), k = el.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
      let pinch = null;
      el.addEventListener("pointerdown", (e) => {
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
        ptrs.set(e.pointerId, px(e)); pinch = null;
      });
      el.addEventListener("pointermove", (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const [x0, y0] = ptrs.get(e.pointerId), p = px(e);
        ptrs.set(e.pointerId, p);
        this.foc = null; // the player takes the camera back
        if (ptrs.size === 1) { this.pan[0] -= (p[0] - x0) / this.zoom; this.pan[1] -= (p[1] - y0) / this.zoom; }
        else if (ptrs.size === 2) {
          // two fingers: pinch zooms about their midpoint and moving them pans
          const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (pinch) {
            this.pan[0] -= (m[0] - pinch.m[0]) / this.zoom; this.pan[1] -= (m[1] - pinch.m[1]) / this.zoom;
            this.zoomAt(m, d / pinch.d, el);
          }
          pinch = { d, m };
        }
        onChange && onChange();
      });
      const up = (e) => { ptrs.delete(e.pointerId); pinch = null; };
      el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      el.addEventListener("wheel", (e) => { e.preventDefault(); this.foc = null; this.zoomAt(px(e), Math.pow(1.0015, -e.deltaY), el); onChange && onChange(); }, { passive: false });
      window.addEventListener("keydown", (e) => {
        // by position (ME.keys): the A and E keys on AZERTY
        if (ME.keys.is(e, "KeyQ")) this.snap(-1);
        if (ME.keys.is(e, "KeyE")) this.snap(1);
      });
    }
  }
  ME.Camera = Camera;
})();
