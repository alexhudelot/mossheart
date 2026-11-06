/* Materials: name -> 8-bit id, resolved through the style's mats/ramps exactly like px.js does
   (mat.ramp || name). Each material gets a base albedo (its ramp near s = 0.6 + bias), a lighting
   class, and its whole hue-shifted ramp resampled to 16 steps for the ramp-shading mode. */
(function () {
  const ME = window.ME, P = window.PX;
  // lighting classes; which material is which comes from the content (ME.content.materialClass)
  const CLS = (ME.CLS = { DEFAULT: 0, MOSS: 1, FOLIAGE: 2, EMISSIVE: 3, WATER: 4, ROCK: 5, BARK: 6, SKIN: 7 });
  // per-voxel albedo jitter by class (the "voxel grain")
  const VAR = [0.1, 0.12, 0.18, 0, 0.04, 0.16, 0.14, 0.06];

  class Palette {
    constructor(st) { this.st = st; this.names = [null]; this.ids = {}; this.missing = new Set(); }
    // a material by name; a kind that leaves one out gets the content's defaultMaterial (else the style's first
    // ramp), never a material named undefined (the Architect's #127 note). The engine names no material itself
    // (check-layers)
    id(name) {
      if (name === undefined) name = this.defaultName();
      if (name === undefined) throw new Error("a material left out, and no ME.content.defaultMaterial");
      let i = this.ids[name];
      if (i !== undefined) return i;
      i = this.names.length;
      if (i > 255) throw new Error("more than 255 materials");
      this.names.push(name); this.ids[name] = i;
      return i;
    }
    // the name id(undefined) takes (the bake workers number their materials by name, src/bake-models.js)
    defaultName() { return (ME.content && ME.content.defaultMaterial) ?? Object.keys(this.st.ramps || {})[0]; }
    mat(name) { return Object.assign({ ramp: name }, this.st.mats[name] || {}); }
    ramp(name) {
      const M = this.mat(name);
      let spec = this.st.ramps[M.ramp];
      if (!spec) { this.missing.add(name); spec = this.st.ramps.stone; }
      return P.makeRamp(spec);
    }
    // GPU tables: mats = 2 x vec4 per id [albedo.rgb(linear), emissive gain] [wrap, jitter, bias, class];
    // a material's em is a gain on its glow (0.5 dims it; 1 or true is the full glow; class EMISSIVE without em: 1), 0 for the others
    // ramps = 16 x 256 rgba8 (sRGB) rows.
    build() {
      const emGain = (em) => (em === true ? 1 : Math.max(0, +em || 0));
      const mats = new Float32Array(256 * 8), ramps = new Uint8Array(16 * 256 * 4), byName = (ME.content && ME.content.materialClass) || {};
      for (let i = 1; i < this.names.length; i++) {
        const name = this.names[i], M = this.mat(name), r = this.ramp(name), n = r.length;
        const cls = M.em ? CLS.EMISSIVE : M.cls ?? CLS[byName[name]] ?? CLS.DEFAULT; // mats may give their class number (cls)
        const s0 = Math.min(1, Math.max(0, 0.6 + (M.bias || 0))), c = r[Math.round(s0 * (n - 1))];
        mats.set([ME.lin(c[0]), ME.lin(c[1]), ME.lin(c[2]), emGain(M.em ?? (cls === CLS.EMISSIVE ? 1 : 0)), M.wrap ?? 0.25, VAR[cls], M.bias || 0, cls], i * 8);
        for (let j = 0; j < 16; j++) {
          const g = (j / 15) * (n - 1), a = Math.floor(g), b = Math.min(n - 1, a + 1), t = g - a;
          for (let k = 0; k < 3; k++) ramps[(i * 16 + j) * 4 + k] = Math.round(r[a][k] + (r[b][k] - r[a][k]) * t);
          ramps[(i * 16 + j) * 4 + 3] = 255;
        }
      }
      return { mats, ramps };
    }
  }
  ME.Palette = Palette;
})();
