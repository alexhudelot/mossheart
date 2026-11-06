/* Dynamic resolution: holds the frame budget by moving set.scale in 0.05 steps between 0.55 and 1.
   With GPU timestamps it aims the measured GPU time at a budget (time ~ pixels ~ scale^2). Without
   them (Android Chrome) only the frame interval is known, and vsync hides any headroom: it drops
   fast when frames run late and probes back up slowly, remembering where the last probe failed.
   A resize rebuilds every screen target, so changes are at least a second apart.
   The GPU time is the median of the readings taken at the current scale (5 at least, about 100 frames; a
   reading every 20 frames), not the last one: one carve or resize reads 40-50 ms against a 10 ms mean, and a
   single reading moved the scale 52-61 times a wave (Engine's boss-wave probe, 2026-10-23). It steps down at
   most 15% at a time above 1.15 x budget, and back up 0.05 at a time, 3 s apart, below 0.7 x budget, never to
   a scale that was just too slow for 20 s (as without timestamps). The gap between the two thresholds is wider
   than a step's change in pixels, so a step cannot undo itself. */
(function () {
  const ME = window.ME;

  ME.DynRes = class {
    constructor(R) {
      this.R = R; this.min = 0.55; this.max = 1; this.budget = ME.qn("budget", 12);
      this.ema = 16.7; this.t = 0; this.ceil = this.max; this.ceilT = 0; this.samples = []; this.last = null; this.changes = 0;
    }
    // once per frame with the interval since the previous one (ms)
    update(now, dtMs) {
      const s = this.R.set;
      if (!s.autoScale || dtMs > 100) return; // off, or back from a hidden tab
      this.ema += (dtMs - this.ema) * 0.05;
      // a new reading counts for this scale once frames drawn at it can have been read (300 ms after a change)
      const g = this.R.gpuMs;
      if (g && g !== this.last) { this.last = g; if (g.total > 0 && now - this.t > 300) { this.samples.push(g.total); if (this.samples.length > 15) this.samples.shift(); } }
      if (now - this.t < 1000) return;
      let next = s.scale;
      if (g && g.total > 0) {
        if (this.samples.length < 5) return;
        const q = this.samples.slice().sort((a, b) => a - b), m = q.length & 1 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2;
        if (m > this.budget * 1.15) { next = s.scale * Math.max(0.85, Math.sqrt(this.budget / m)); this.ceil = s.scale - 0.05; this.ceilT = now; }
        else if (m < this.budget * 0.7 && now - this.t > 3000) next = Math.min(s.scale + 0.05, s.scale * Math.sqrt(this.budget / m));
        if (now - this.ceilT > 20000) this.ceil = this.max;
        next = Math.min(next, this.ceil);
      } else {
        if (this.ema > 18.5) { next = s.scale - 0.1; this.ceil = s.scale - 0.05; this.ceilT = now; }
        else if (this.ema < 17.2 && now - this.t > 3000) next = s.scale + 0.05;
        if (now - this.ceilT > 20000) this.ceil = this.max;
        next = Math.min(next, this.ceil);
      }
      next = Math.min(this.max, Math.max(this.min, Math.round(next * 20) / 20));
      if (Math.abs(next - s.scale) > 0.01) { s.scale = next; this.t = now; this.ema = 16.7; this.samples.length = 0; this.changes++; }
    }
  };
})();
