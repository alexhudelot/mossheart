/* Studio I/O: MagicaVoxel .vox read/write, downloads, file picking and the local asset library
   (localStorage, so a page reload or the engine's ?gallery=studio can see the assets). */
(function () {
  const SV = (window.SV = window.SV || {}), P = window.PX;

  // ---------------------------------------------------------------- MagicaVoxel .vox
  // MagicaVoxel's default palette: a 6-level colour cube (blue fastest, white first), then 10-step
  // red, green, blue and grey ramps. Entry k is colour index k + 1.
  function defaultPalette() {
    const lv = [0xff, 0xcc, 0x99, 0x66, 0x33, 0x00], rp = [0xee, 0xdd, 0xbb, 0xaa, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11], out = [];
    for (const r of lv) for (const g of lv) for (const b of lv) if (r || g || b) out.push([r, g, b, 255]);
    for (const c of [0, 1, 2]) for (const v of rp) { const q = [0, 0, 0, 255]; q[c] = v; out.push(q); }
    for (const v of rp) out.push([v, v, v, 255]);
    out.push([0, 0, 0, 0]);
    return out;
  }
  // -> { size: [x, y, z], voxels: [[x, y, z, colourIndex]], palette: [[r, g, b, a]] x 256 } (first model)
  SV.readVox = function (buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (tag(0) !== "VOX ") throw new Error("not a MagicaVoxel file");
    let size = null, voxels = null, palette = null, o = 8;
    const end = buf.byteLength;
    // MAIN's children are a flat chunk list: walk them all
    if (tag(o) === "MAIN") o += 12 + dv.getInt32(o + 4, true);
    while (o + 12 <= end) {
      const id = tag(o), n = dv.getInt32(o + 4, true), c = o + 12;
      if (id === "SIZE" && !size) size = [dv.getInt32(c, true), dv.getInt32(c + 4, true), dv.getInt32(c + 8, true)];
      else if (id === "XYZI" && !voxels) {
        const cnt = dv.getInt32(c, true); voxels = [];
        for (let i = 0; i < cnt; i++) voxels.push([u8[c + 4 + i * 4], u8[c + 5 + i * 4], u8[c + 6 + i * 4], u8[c + 7 + i * 4]]);
      } else if (id === "RGBA") { palette = []; for (let i = 0; i < 256; i++) palette.push([u8[c + i * 4], u8[c + i * 4 + 1], u8[c + i * 4 + 2], u8[c + i * 4 + 3]]); }
      o = c + n + dv.getInt32(o + 8, true);
    }
    if (!size || !voxels) throw new Error("no model in .vox file");
    return { size, voxels, palette: palette || defaultPalette() };
  };
  SV.writeVox = function (size, voxels, palette) {
    if (size.some((s) => s > 256)) throw new Error(".vox models are at most 256 voxels on a side (this one is " + size.join("x") + ")");
    const sizeC = 12, xyziC = 4 + voxels.length * 4, rgbaC = 1024, kids = 3 * 12 + sizeC + xyziC + rgbaC;
    const buf = new ArrayBuffer(8 + 12 + kids), dv = new DataView(buf), u8 = new Uint8Array(buf);
    let o = 0;
    const tag = (s) => { for (let i = 0; i < 4; i++) u8[o++] = s.charCodeAt(i); }, i32 = (v) => { dv.setInt32(o, v, true); o += 4; };
    tag("VOX "); i32(150);
    tag("MAIN"); i32(0); i32(kids);
    tag("SIZE"); i32(sizeC); i32(0); i32(size[0]); i32(size[1]); i32(size[2]);
    tag("XYZI"); i32(xyziC); i32(0); i32(voxels.length);
    for (const v of voxels) { u8[o++] = v[0]; u8[o++] = v[1]; u8[o++] = v[2]; u8[o++] = v[3]; }
    tag("RGBA"); i32(rgbaC); i32(0);
    for (let i = 0; i < 256; i++) { const c = palette[i] || [0, 0, 0, 0]; u8[o++] = c[0]; u8[o++] = c[1]; u8[o++] = c[2]; u8[o++] = c[3] ?? 255; }
    return buf;
  };

  // A material for an imported colour: its hue and saturation, lightness spread so the ramp's albedo
  // point (s = 0.6, see src/palette.js) lands on the colour itself.
  SV.rampFor = function (rgb) {
    const [, , l] = P.toHsl(rgb), lo = Math.min(0.9, Math.max(0.03, l - 0.33)), hi = Math.min(0.98, Math.max(lo + 0.1, lo + 0.55));
    return [P.toHex(rgb), 6, +lo.toFixed(3), +hi.toFixed(3), 0.3];
  };

  // ---------------------------------------------------------------- files
  SV.download = function (name, data, type = "application/octet-stream") {
    const blob = data instanceof Blob ? data : new Blob([data], { type }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  SV.pickFile = (accept) => new Promise((res) => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept;
    inp.onchange = () => res(inp.files[0] || null); inp.click();
  });

  // ---------------------------------------------------------------- local library
  const LIB = "mossheart.studio.library", CUR = "mossheart.studio.current";
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  SV.store = {
    all: () => get(LIB, {}),
    save(doc) { const l = get(LIB, {}); l[doc.name] = doc; return put(LIB, l); },
    remove(name) { const l = get(LIB, {}); delete l[name]; return put(LIB, l); },
    current: () => get(CUR, null),
    setCurrent: (rec) => put(CUR, rec),
    preview: (docs, focus) => put(window.MossAsset.PREVIEW_KEY, { docs, focus, at: Date.now() }),
  };
})();
