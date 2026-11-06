/* WebGPU device setup, error capture and small resource helpers. */
(function () {
  const ME = window.ME;

  // Adapter requests in order: a core adapter, then a compatibility one (WebGPU on OpenGL ES / D3D11,
  // which Chrome offers on phones whose Vulkan driver it does not trust). ?compat=1 asks for compatibility
  // first, ?compat=2 also keeps the device a compatibility one (tests). ME.gpuTried records what each
  // request gave, for the failure screen.
  ME.requestAdapter = async function () {
    const core = [{ powerPreference: "high-performance" }, {}], compat = [{ featureLevel: "compatibility" }, { featureLevel: "compatibility", powerPreference: "low-power" }];
    const tries = ME.qn("compat", 0) ? compat.concat(core) : core.concat(compat);
    ME.gpuTried = [];
    for (const o of tries) {
      let a = null, err = "";
      try { a = await navigator.gpu.requestAdapter(o); } catch (e) { err = e.message; }
      ME.gpuTried.push({ opts: JSON.stringify(o), ok: !!a, err });
      if (a) return a;
    }
    return null;
  };

  // Why WebGPU cannot start here, in words a player can act on.
  ME.gpuAdvice = function () {
    const ua = navigator.userAgent, android = /Android/.test(ua), webview = /; wv\)|Version\/[\d.]+ Chrome\//.test(ua) && android;
    // Chrome 110+ freezes the UA at "Android 10; K" whatever the phone runs (a Galaxy S24+ on Android 16
    // reads as 10), so the Android version is known only from an older, unfrozen UA.
    const frozen = /Android 10; K[;)]/.test(ua);
    const chrome = +((ua.match(/Chrom(?:e|ium)\/(\d+)/) || [])[1] || 0), and = frozen ? 0 : +((ua.match(/Android (\d+)/) || [])[1] || 0);
    const tips = [];
    if (webview) tips.push("This looks like an in-app browser. Open the page in Chrome itself (menu ⋮ → Open in Chrome).");
    if (android && and && and < 12) tips.push("WebGPU on Android needs Android 12 or newer (this is Android " + and + ").");
    if (chrome && chrome < 121) tips.push("Update Chrome: WebGPU on Android needs Chrome 121+ (this is " + chrome + ").");
    // An up-to-date Chrome that offers no adapter, core or compatibility, has blocklisted this GPU (Samsung
    // Xclipse, for one: chrome://gpu, "Dawn Info", says "Blocklisted"). The flag lifts the blocklist.
    if (!tips.length) tips.push(android ? "Chrome does not enable WebGPU on this phone's GPU yet. To play anyway, open chrome://flags/#enable-unsafe-webgpu, set it to Enabled and tap Relaunch." : "This GPU or driver is not enabled for WebGPU. Update the browser and graphics driver, or try Chrome or Edge.");
    return { tips, ua, tried: ME.gpuTried || [] };
  };

  // ME.gpuMem: the bytes the device's live buffers and textures hold (mips included; a format's bytes per
  // texel from its name), the peak, and the largest buffer with its label: what a density costs on the GPU,
  // and what a ceiling above 32 checks against maxBufferSize (docs/decisions/2026-10-20-hero-density.md)
  const texelBytes = (f) => (/^(r8|stencil8)/.test(f) ? 1 : /^(rg8|r16|depth16)/.test(f) ? 2 : /^(rgba16|rg32)/.test(f) ? 8 : /^rgba32/.test(f) ? 16 : 4);
  const gpuTally = (device) => {
    const M = (ME.gpuMem = { buf: 0, tex: 0, peak: 0, nBuf: 0, nTex: 0, maxBuf: 0, maxBufLabel: "", maxUp: 0, maxUpLabel: "", nUp: 0, upMs: 0, upSplit: 0 });
    const add = (k, n, d) => { M[k] += d; M[n] += Math.sign(d); M.peak = Math.max(M.peak, M.buf + M.tex); };
    const track = (o, k, n, s) => {
      add(k, n, s);
      const ds = o.destroy.bind(o);
      let gone = false;
      o.destroy = () => { if (!gone) { gone = true; add(k, n, -s); } return ds(); };
      return o;
    };
    const cb = device.createBuffer.bind(device), ct = device.createTexture.bind(device);
    device.createBuffer = (d) => {
      if (d.size > M.maxBuf) { M.maxBuf = d.size; M.maxBufLabel = d.label || ""; }
      return track(cb(d), "buf", "nBuf", d.size || 0);
    };
    device.createTexture = (d) => {
      const z = d.size, w = z.width ?? z[0], h = z.height ?? z[1] ?? 1, n = z.depthOrArrayLayers ?? z[2] ?? 1;
      let s = 0, mw = w, mh = h, mn = n;
      for (let m = 0; m < (d.mipLevelCount || 1); m++) {
        s += mw * mh * mn * texelBytes(d.format);
        mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
        if (d.dimension === "3d") mn = Math.max(1, mn >> 1);
      }
      return track(ct(d), "tex", "nTex", s * (d.sampleCount || 1));
    };
    // Every writeTexture goes up in pieces the browser can stage. Dawn copies each call into a staging buffer whose
    // rows are padded to 256 bytes, and that buffer must fit maxBufferSize (256 MB by default): Mossheart at vs12
    // with the graft models staged 264 MB. A piece is at most ME.TEX_WRITE_MAX of padded bytes, in z-slabs, else in
    // rows of one layer, and is passed as a view of just its bytes (offset 0), so nothing past it is staged.
    // M.maxUp: the largest padded size a caller asked for, and its texture's label (the headroom against the limit).
    // M.nUp, M.upMs: the browser writeTexture calls and the ms spent in them; M.upSplit: the calls that went up in pieces.
    const q = device.queue, wt0 = q.writeTexture.bind(q), wt = (...a) => { const t = performance.now(); wt0(...a); M.nUp++; M.upMs += performance.now() - t; };
    q.writeTexture = (dst, data, lay, size) => {
      if (data instanceof ArrayBuffer) data = new Uint8Array(data);
      const w = size.width ?? size[0], h = size.height ?? size[1] ?? 1, n = size.depthOrArrayLayers ?? size[2] ?? 1;
      const bpr = lay.bytesPerRow || 0, rpi = lay.rowsPerImage || h, row = Math.ceil(bpr / 256) * 256, up = row * (rpi * (n - 1) + h);
      if (up > M.maxUp) { M.maxUp = up; M.maxUpLabel = dst.texture.label || ""; }
      const o = dst.origin || [0, 0, 0], x = o.x ?? o[0] ?? 0, y = o.y ?? o[1] ?? 0, z = o.z ?? o[2] ?? 0, off = lay.offset || 0;
      const cap = Math.max(row, Math.min(ME.TEX_WRITE_MAX, device.limits.maxBufferSize)); // a row goes up whole
      if (up <= cap || !bpr || !ArrayBuffer.isView(data)) {
        if (!ArrayBuffer.isView(data) || !bpr) return wt(dst, data, lay, size);
        const len = Math.min(bpr * (rpi * (n - 1) + h), data.byteLength - off);
        return wt(dst, new Uint8Array(data.buffer, data.byteOffset + off, Math.max(0, len)), { bytesPerRow: bpr, rowsPerImage: rpi }, [w, h, n]);
      }
      M.upSplit++;
      if (n > 1) {
        const dz = Math.max(1, Math.floor(cap / (row * rpi)));
        for (let k = 0; k < n; k += dz) q.writeTexture({ ...dst, origin: [x, y, z + k] }, data, { offset: off + k * bpr * rpi, bytesPerRow: bpr, rowsPerImage: rpi }, [w, h, Math.min(dz, n - k)]);
      } else {
        const dy = Math.max(1, Math.floor(cap / row));
        for (let k = 0; k < h; k += dy) q.writeTexture({ ...dst, origin: [x, y + k, z] }, data, { offset: off + k * bpr, bytesPerRow: bpr }, [w, Math.min(dy, h - k), 1]);
      }
    };
  };

  ME.initGPU = async function (canvas) {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser (needs Chrome/Edge 113+, Safari 26+, or Android Chrome 121+).");
    const adapter = await ME.requestAdapter();
    if (!adapter) { const e = new Error("No WebGPU adapter."); e.advice = ME.gpuAdvice(); throw e; }
    // A compatibility adapter on hardware that can do more offers core-features-and-limits, which makes the
    // device a core one. Otherwise ask for the storage-buffer and storage-texture counts the vertex and
    // fragment stages need (compatibility defaults them to 0; the adapter says what the driver allows).
    const asked = ME.gpuTried.find((t) => t.ok).opts.includes("compatibility");
    const want = ["timestamp-query", "core-features-and-limits"].filter((f) => adapter.features.has(f) && (f === "timestamp-query" ? ME.qn("ts", 1) : ME.qn("compat", 0) < 2));
    const compat = (ME.compat = asked && adapter.featureLevel !== "core" && !want.includes("core-features-and-limits"));
    const requiredLimits = {};
    if (compat)
      for (const k of ["maxStorageBuffersInVertexStage", "maxStorageBuffersInFragmentStage", "maxStorageTexturesInFragmentStage", "maxStorageTexturesInVertexStage"])
        if (k in adapter.limits && adapter.limits[k] > 0) requiredLimits[k] = adapter.limits[k];
    // Above VS 24 the terrain's buffers outgrow the default limits (at 64 on the 14-tile jar: buffers up to
    // 1.15 GB against maxBufferSize 256 MB, a 221 MB solid-cell binding against 128 MB), so ask for what the
    // adapter allows. Set ME.VS before this. At 24 and below nothing changes; a phone has no room for 64.
    // ?bigbuf=1 asks for them at every VS (the check of the other fix for the vs12 graft pool, without the render target).
    if (ME.VS > 24 || ME.qn("bigbuf", 0))
      for (const k of ["maxBufferSize", "maxStorageBufferBindingSize"]) if (adapter.limits[k] > 0) requiredLimits[k] = adapter.limits[k];
    // compatibility rules: every G-buffer target shares one write mask, so all of them write the emissive
    if (compat) ME.GBUFFER.G = ME.GBUFFER.GV;
    ME.gpuMode = compat ? "compatibility" : asked ? "compatibility adapter, core device" : "core";
    const device = await adapter.requestDevice({ requiredFeatures: want, requiredLimits });
    ME.limits = device.limits; // read by the bake's ceilings (ME.poolMaxBricks)
    gpuTally(device);
    device.addEventListener("uncapturederror", (e) => ME.err("GPU", e.error.message.slice(0, 600)));
    device.lost.then((i) => { ME.err("DEVICE LOST", i.reason, i.message); if (i.reason !== "destroyed" && ME.onDeviceLost) ME.onDeviceLost(i); });
    const ctx = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const info = adapter.info || {}, L = adapter.limits;
    // for ME.vsCeiling at the next start, before the GPU does
    try { localStorage.setItem("ME.gpuClass", JSON.stringify({ vendor: info.vendor || "", maxBuf: Math.min(L.maxBufferSize, L.maxStorageBufferBindingSize) })); } catch (e) { /* storage blocked */ }
    return { adapter, device, ctx, format, features: new Set(want), info: { vendor: info.vendor, arch: info.architecture, desc: info.description, mode: ME.gpuMode } };
  };

  // WGSL for a compatibility device (OpenGL ES / D3D11): the depth (gD) is read as a float texture, which
  // compatibility allows where it forbids loading a texture_depth_2d; flat varyings take `either` vertex;
  // the G-buffer outputs carry the emissive (zero unless set).
  ME.compatWGSL = (code) => code
    .replace(/var gD: texture_depth_2d;/g, "var gD: texture_2d<f32>;")
    .replace(/textureLoad\(gD, (.+?), 0\)/g, "textureLoad(gD, $1, 0).r")
    .replace(/@interpolate\(flat\)/g, "@interpolate(flat, either)")
    .replace(/(struct GO \{ @location\(0\) a: vec4f, @location\(1\) n: vec4f)(?!, @location\(2\))/g, "$1, @location(2) e: vec4f");

  // Shader module with compile messages forwarded to the log (with the pass name and line).
  ME.shader = function (device, label, code) {
    if (ME.compat) code = ME.compatWGSL(code);
    const mod = device.createShaderModule({ label, code });
    mod.getCompilationInfo().then((ci) => {
      for (const m of ci.messages) {
        const line = code.split("\n")[m.lineNum - 1] || "";
        (m.type === "error" ? ME.err : ME.log)("WGSL " + m.type + " [" + label + ":" + m.lineNum + "] " + m.message + " | " + line.trim().slice(0, 120));
      }
    });
    return mod;
  };

  ME.buffer = function (device, data, usage, label) {
    const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
    const b = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    b.unmap();
    return b;
  };

  // 3D texture with optional extra mips, all supplied as typed arrays (x fastest, then y, then z). The device's
  // writeTexture (gpuTally) sends each level up in pieces of at most ME.TEX_WRITE_MAX staged bytes (64 MB): one
  // writeTexture of a 512 MB brick pool would make the browser stage all of it at once.
  // ?texmax=KB lowers it, to force the split paths in a check (192 sends the vs12 brick pool up in row bands).
  ME.TEX_WRITE_MAX = ME.qn("texmax", 65536) * 1024;
  // A 3D level is one subresource, so the first piece makes Dawn zero the whole level first, and D3D12 zeroes a
  // texture that cannot be a render target through one staging buffer of the level's size (264 MB for the vs12
  // graft pool): a level over maxBufferSize is made a render target too, which Dawn clears without staging.
  ME.tex3d = function (device, label, format, dims, levels, bpp, usage = 0) {
    if (!ME.qn("bigbuf", 0) && Math.ceil(dims[0] * bpp / 256) * 256 * dims[1] * dims[2] > device.limits.maxBufferSize) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    const t = device.createTexture({ label, format, dimension: "3d", size: dims, mipLevelCount: levels.length, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | usage });
    levels.forEach((data, mip) => {
      const w = Math.max(1, dims[0] >> mip), h = Math.max(1, dims[1] >> mip), d = Math.max(1, dims[2] >> mip);
      device.queue.writeTexture({ texture: t, mipLevel: mip }, data, { bytesPerRow: w * bpp, rowsPerImage: h }, [w, h, d]);
    });
    return t;
  };

  // Fullscreen-triangle vertex stage shared by every screen pass.
  ME.FS_VS = /* wgsl */ `
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;
})();
