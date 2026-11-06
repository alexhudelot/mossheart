/* Day and dusk: blends the lighting settings from the current (day) values toward ME.DUSK.
   set.dusk (0..1) holds a fixed blend; set.cycle (seconds, 0 = off) loops day -> dusk -> day instead.
   The day values are captured when the blend leaves 0 and again after a preset, so presets and ?set=
   still define the day look; at dusk the emissive towers and point lights carry the scene.
   At night the shaft pass multiplies shaftK by 1 + moonK·moon³ (src/passes.js; moonK 5, so x6 at full night),
   haze and blur included: a level that raises its night shaftK gets six times that too. */
(function () {
  const ME = window.ME;
  ME.DUSK = { shade: 0.75, amb: 0.06, pool: 0.2, shaftK: 0.05, bloomK: 1.8, exposure: 0.72, vignette: 0.8 };

  ME.DayCycle = class {
    constructor(R) {
      this.R = R; this.day = null;
      const apply = R.applyPreset.bind(R);
      R.applyPreset = (name) => { this.reset(); return apply(name); };
    }
    reset() {
      if (this.day) Object.assign(this.R.set, this.day);
      this.day = null;
    }
    update(time) {
      const s = this.R.set, d = s.cycle > 0 ? 0.5 - 0.5 * Math.cos((time / s.cycle) * Math.PI * 2) : Math.max(0, Math.min(1, s.dusk));
      this.dusk = d;
      if (!this.day) {
        if (d <= 0) return;
        this.day = {};
        for (const k in ME.DUSK) this.day[k] = s[k];
      }
      for (const k in ME.DUSK) s[k] = this.day[k] + (ME.DUSK[k] - this.day[k]) * d;
      if (d <= 0) this.day = null; // back to the exact day values
    }
  };
})();
