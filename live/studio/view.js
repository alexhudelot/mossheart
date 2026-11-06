/* Studio viewport: WebGL2, one instanced cube per surface voxel of a baked volume (ME.voxelizeModel
   output: material, oct normal, AO), shaded with the engine's model lighting (src/shaders/light.js, the
   sprite form: wrapped lambert + ambient + canopy offset, AO, then each material's 16-step ramp, voxel
   grain, emissive glow). The camera is the engine's 2:1 projection (src/camera.js) or a free orbit.
   Picking is a DDA through the volume. Everything lives on window.SV. */
(function () {
  const SV = (window.SV = window.SV || {}), ME = window.ME, M4 = ME.m4;
  const SQ2 = Math.SQRT2, ENGINE_SQ = Math.SQRT1_2 / Math.cos(Math.PI / 6); // engine Z squash at 30 degrees

  // ---------------------------------------------------------------- camera
  class Cam {
    constructor() { this.yaw = 0; this.pitch = 30; this.engine = true; this.zoom = 120; this.target = [0, 0, 0.5]; this.anim = null; }
    // world -> view basis: right, up (screen), toward viewer
    basis() {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), e = ((this.engine ? 30 : this.pitch) * Math.PI) / 180, sq = this.engine ? ENGINE_SQ : 1;
      const rx = [(c - s) / SQ2, (-s - c) / SQ2, 0], fw = [(c + s) / SQ2, (c - s) / SQ2, 0];
      const up = [-fw[0] * Math.sin(e), -fw[1] * Math.sin(e), Math.cos(e) * sq], dp = [fw[0] * Math.cos(e), fw[1] * Math.cos(e), Math.sin(e)];
      return { rx, up, dp };
    }
    matrix(w, h) {
      const { rx, up, dp } = this.basis(), T = this.target, kx = (this.zoom * 2) / w, ky = (this.zoom * 2) / h, dz = 1 / 60;
      const row = (v, k) => [v[0] * k, v[1] * k, v[2] * k, -(v[0] * T[0] + v[1] * T[1] + v[2] * T[2]) * k];
      return M4.fromRows([row(rx, kx), row(up, ky), row(dp, -dz), [0, 0, 0, 1]]);
    }
    // eased 90-degree snaps, as the engine camera
    snap(dir) { const to = Math.round(this.yaw / (Math.PI / 2) + dir) * (Math.PI / 2); this.anim = { from: this.yaw, to, t0: performance.now() }; }
    update(now) {
      if (!this.anim) return false;
      const u = Math.min(1, (now - this.anim.t0) / 420), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.yaw = this.anim.from + (this.anim.to - this.anim.from) * e;
      if (u >= 1) this.anim = null;
      return true;
    }
  }
  SV.Cam = Cam;

  // ---------------------------------------------------------------- shaders
  const VS_VOX = `#version 300 es
  precision highp float; precision highp int;
  layout(location=0) in vec3 aCorner; layout(location=1) in vec3 aFaceN;
  layout(location=2) in uvec4 aInst; layout(location=3) in vec4 aNao;
  uniform mat4 uVP; uniform vec3 uOrigin; uniform float uVox; uniform vec3 uBoxO;
  out vec3 vN; out vec3 vLoc; out vec3 vFace; out vec3 vVox; flat out uint vMat; flat out uint vFlag; out float vAo;
  void main() {
    if ((aInst.w & 255u) == 0u) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // empty room in a brick's run: clipped
    vec3 cell = vec3(aInst.xyz);
    vec3 p = uOrigin + (cell + aCorner) * uVox;
    gl_Position = uVP * vec4(p, 1.0);
    vec2 e = aNao.xy * 2.0 - 1.0; vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vN = normalize(n); vLoc = aCorner; vFace = aFaceN; vVox = cell + uBoxO; vMat = aInst.w & 255u; vFlag = aInst.w >> 8u; vAo = aNao.z;
  }`;
  const FS_VOX = `#version 300 es
  precision highp float; precision highp int; precision highp sampler2D;
  in vec3 vN; in vec3 vLoc; in vec3 vFace; in vec3 vVox; flat in uint vMat; flat in uint vFlag; in float vAo;
  uniform sampler2D uRamps; uniform sampler2D uMats;
  uniform vec3 uL; uniform vec4 uLook; uniform vec4 uLook2; uniform int uMode; uniform float uTime; uniform vec3 uViewDir;
  out vec4 oCol;
  float hash13(vec3 p) { vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec3 rampC(uint m, float s) { return texture(uRamps, vec2((clamp(s, 0.0, 1.0) * 15.0 + 0.5) / 16.0, (float(m) + 0.5) / 256.0)).rgb; }
  vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  void main() {
    vec4 m0 = texelFetch(uMats, ivec2(0, int(vMat)), 0), m1 = texelFetch(uMats, ivec2(1, int(vMat)), 0);
    uint cls = uint(m1.w + 0.5);
    vec3 n = vN; float ao = vAo;
    // uLook: shade, pool, amb, aoK  uLook2: canopy light (0 shade .. 1 sun pool), spriteK, exposure, face shading
    float shade = uLook.x, pool = uLook.y, amb = uLook.z, aoK = uLook.w, cook = uLook2.x;
    float dif = dot(n, uL), wrap = m1.x, lam = max(0.0, (dif + wrap) / (1.0 + wrap));
    float lmod = -shade + (shade + pool) * cook;
    float s = amb * (0.6 + 0.4 * n.z) + (1.0 - amb) * lam + m1.z + lmod * uLook2.y;
    s -= aoK * (1.0 - ao);
    // editor aid: a touch of per-face shading so flat voxel faces read as cubes (0 = engine exact)
    s += uLook2.w * (dot(vFace, vec3(0.25, 0.45, 0.9)) - 0.55) * 0.18;
    if (cls == 2u) s += max(0.0, -dif) * cook * 0.45;
    float jit = (hash13(vVox) - 0.5) * m1.y;
    if (cls == 5u) jit += (hash13(floor(vVox / vec3(7.0, 7.0, 5.0)) + 3.1) - 0.5) * 0.35;
    vec3 col = rampC(vMat, s) * (1.0 + jit);
    col *= 1.0 + max(0.0, s - 0.9) * 1.8;
    if (cls == 3u) col = rampC(vMat, 1.0) * (1.7 + 0.35 * sin(uTime * 3.0 + vVox.x * 0.3 + vVox.y * 0.2)) * m0.w; // m0.w: the material's em gain, as the engine's light.js
    if (uMode == 1) col = m0.rgb * (1.0 + jit);
    else if (uMode == 2) col = pow(n * 0.5 + 0.5, vec3(2.2));
    else if (uMode == 3) col = vec3(ao * ao);
    else if (uMode == 4) { float h = hash13(vec3(float(vMat), 7.0, 3.0)); col = pow(0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))), vec3(2.2)) * (0.55 + 0.45 * lam); }
    col *= uLook2.z;
    // selection tint (bit 0: voxels of the selected prim, bit 1: brush preview)
    if ((vFlag & 1u) != 0u) col = mix(col, vec3(1.0, 0.62, 0.18), 0.28 + 0.1 * sin(uTime * 5.0));
    if ((vFlag & 2u) != 0u) col = mix(col, vec3(0.3, 0.8, 1.0), 0.45);
    // cube edges (editor aid)
    vec3 q = abs(vLoc - 0.5) * 2.0; vec3 fa = abs(vFace);
    float e2 = fa.x > 0.5 ? max(q.y, q.z) : fa.y > 0.5 ? max(q.x, q.z) : max(q.x, q.y);
    col *= mix(1.0, 0.72, smoothstep(0.86, 0.97, e2) * uLook2.w);
    oCol = vec4(toSrgb(col), 1.0);
  }`;
  const VS_GROUND = `#version 300 es
  precision highp float; layout(location=0) in vec2 aP; uniform mat4 uVP; uniform float uR; out vec2 vP;
  void main() { vP = aP * uR; gl_Position = uVP * vec4(vP, -0.002, 1.0); }`;
  const FS_GROUND = `#version 300 es
  precision highp float; in vec2 vP; uniform float uR; uniform float uFine; uniform vec3 uBg; uniform float uFoot; out vec4 oCol;
  float line(vec2 p, float w) { vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p); return 1.0 - clamp(min(g.x, g.y) - w, 0.0, 1.0); }
  void main() {
    float d = length(vP) / uR;
    if (d > 1.0) discard;
    float tile = line(vP + 0.5, 0.4), fine = line(vP * uFine + 0.5, 0.0) * 0.35;
    vec2 ap = abs(vP); float foot = (max(ap.x, ap.y) < 0.5 ? 1.0 : 0.0) * uFoot;
    vec3 c = mix(uBg * 1.25 + vec3(0.012, 0.018, 0.008), vec3(0.32, 0.36, 0.26), tile * 0.5 + fine * 0.25);
    c += vec3(0.05, 0.07, 0.02) * foot;
    c = mix(c, uBg, smoothstep(0.55, 1.0, d));
    oCol = vec4(c, 1.0);
  }`;

  const VS_LINE = `#version 300 es
  precision highp float; layout(location=0) in vec3 aP; layout(location=1) in vec4 aC; uniform mat4 uVP; out vec4 vC;
  void main() { vC = aC; gl_Position = uVP * vec4(aP, 1.0); }`;
  const FS_LINE = `#version 300 es
  precision highp float; in vec4 vC; out vec4 oCol; void main() { oCol = vC; }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }

  // unit cube, 6 faces x 2 triangles: corner xyz + face normal
  function cubeVerts() {
    const F = [[[1, 0, 0], [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1]], [[-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0]], [[0, 1, 0], [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0]],
      [[0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]], [[0, 0, 1], [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]], [[0, 0, -1], [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]]];
    const out = [];
    for (const [n, q] of F) for (const k of [0, 1, 2, 0, 2, 3]) out.push(q[k * 3], q[k * 3 + 1], q[k * 3 + 2], ...n);
    return new Float32Array(out);
  }

  // ---------------------------------------------------------------- view
  class View {
    constructor(canvas) {
      this.cv = canvas;
      const gl = (this.gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true }));
      if (!gl) throw new Error("WebGL2 is not available");
      this.cam = new Cam();
      this.prog = compile(gl, VS_VOX, FS_VOX);
      this.ground = compile(gl, VS_GROUND, FS_GROUND);
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      const cube = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cube); gl.bufferData(gl.ARRAY_BUFFER, cubeVerts(), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      this.ibuf = gl.createBuffer(); this.nbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_SHORT, 0, 0); gl.vertexAttribDivisor(2, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nbuf); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 0, 0); gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);
      this.gvao = gl.createVertexArray(); gl.bindVertexArray(this.gvao);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.texRamps = gl.createTexture(); this.texMats = gl.createTexture();
      this.count = 0; this.vol = null;
      this.look = { shade: 0.47, pool: 0.6, amb: 0.21, aoK: 0.36, cook: 0.45, spriteK: 1, exposure: 1.03, faces: 0.5, mode: 0, ground: true, bg: [0.045, 0.052, 0.04] };
      this.L = [-0.45, 0.36, 0.82];
    }
    // material tables from ME.Palette.build(): mats 2 x vec4 per id, ramps 16 x 256 rgba8 (sRGB)
    setTables(tables) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texRamps);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 16, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, tables.ramps);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, this.texMats);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 2, 256, 0, gl.RGBA, gl.FLOAT, tables.mats);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    // vol: { dims, box, rgba (or mat-only grid), scale (world units per voxel) }; flags(i) -> per-voxel flag bits.
    // dirty: the cell boxes [x0, y0, z0, x1, y1, z1] (inclusive) that changed in vol.rgba since the last call on
    // the same volume (live mode's edits). Then only the 8^3 bricks they touch, with a cell of margin for the
    // faces beside them, are rescanned and re-uploaded. Without it, or for another volume, everything is.
    // The instance buffer holds one run per brick. A run that outgrows its room moves to the end, and the room it
    // leaves holds empty instances (material 0, dropped by the vertex shader) until a repack.
    // A volume marked keep (live mode's space) keeps its runs while another one shows (its exact bake, a frame):
    // back on it, they are uploaded whole and its dirty boxes applied, with no rescan of the space.
    setVolume(vol, flagOf, dirty) {
      if (this.vol && this.vol !== vol && this.vol.keep && this.B) this.kept = { vol: this.vol, B: this.B };
      const k = this.kept;
      const back = !!k && k.vol === vol && this.vol !== vol;
      if (back) { this.vol = vol; this.B = k.B; }
      if (k && (k.vol === vol || vol.keep)) this.kept = null;
      const B = this.B;
      if (!dirty || !B || this.vol.rgba !== vol.rgba || this.vol.dims.join() !== vol.dims.join()) return this.fullVolume(vol, flagOf);
      this.vol = vol;
      const [nx, ny, nz] = vol.dims, cl = (v, n) => Math.min(n - 1, Math.max(0, v)) >> 3, touched = new Set(), ranges = [];
      for (const d of dirty) {
        const x0 = cl(d[0] - 1, nx), y0 = cl(d[1] - 1, ny), z0 = cl(d[2] - 1, nz), x1 = cl(d[3] + 1, nx), y1 = cl(d[4] + 1, ny), z1 = cl(d[5] + 1, nz);
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) touched.add((z * B.by + y) * B.bx + x);
      }
      this.scanned = touched.size;
      if (back) ranges.push([0, B.used]); // back on the kept runs: all of them, into the buffers as they are
      for (const b of touched) {
        const n = this.scanBrick(b, flagOf), s = B.start[b], c = B.cap[b];
        B.live += n - B.len[b];
        if (s >= 0 && n <= c) { this.writeRun(b, s, n, c); ranges.push([s, s + c]); continue; }
        if (s >= 0) { B.inst.fill(0, s * 4, (s + c) * 4); B.slot.fill(-1, s, s + c); ranges.push([s, s + c]); }
        B.start[b] = -1; B.len[b] = B.cap[b] = 0;
        if (!n) continue;
        const cap = Math.min(512, n + (n >> 1) + 8), at = B.used;
        this.growRuns(at + cap); B.used += cap;
        this.writeRun(b, at, n, cap); ranges.push([at, at + cap]);
      }
      if (B.used - B.live > Math.max(4096, B.live >> 2)) this.repack();
      else this.uploadRuns(ranges);
    }
    fullVolume(vol, flagOf, upload = true) {
      const [nx, ny, nz] = vol.dims, bx = Math.ceil(nx / 8), by = Math.ceil(ny / 8), bz = Math.ceil(nz / 8), nb = bx * by * bz;
      this.vol = vol; this.scanned = nb;
      const B = (this.B = { bx, by, bz, start: new Int32Array(nb).fill(-1), len: new Uint16Array(nb), cap: new Uint16Array(nb), used: 0, live: 0,
        inst: new Uint16Array(4096 * 4), nao: new Uint8Array(4096 * 4), slot: new Int32Array(4096).fill(-1), run: { inst: new Uint16Array(512 * 4), nao: new Uint8Array(512 * 4), slot: new Int32Array(512) } });
      for (let b = 0; b < nb; b++) {
        const n = this.scanBrick(b, flagOf);
        if (!n) continue;
        this.growRuns(B.used + n); this.writeRun(b, B.used, n, n); B.used += n; B.live += n;
      }
      if (upload) { this.gcap = 0; this.uploadRuns([]); }
    }
    // a volume's runs built without drawing them, to show later with useSet (a committed frame's): the surface
    // only, packed, with no cell indices, so it outlives the volume's colours. -> { vol: { dims, box, scale }, B }
    buildSet(vol) {
      const was = { vol: this.vol, B: this.B, scanned: this.scanned };
      this.fullVolume(vol, null, false);
      const B = this.B, n = B.used;
      const set = { vol: { dims: vol.dims.slice(), box: vol.box.slice(0, 3), scale: vol.scale }, B: { used: n, live: B.live, inst: B.inst.slice(0, n * 4), nao: B.nao.slice(0, n * 4), slot: null } };
      this.vol = was.vol; this.B = was.B; this.scanned = was.scanned;
      return set;
    }
    // shows a set from buildSet, its runs uploaded whole; a volume marked keep that was showing is kept
    useSet(s) {
      if (this.vol && this.vol !== s.vol && this.vol.keep && this.B) this.kept = { vol: this.vol, B: this.B };
      this.vol = s.vol; this.B = s.B; this.scanned = 0; this.uploadRuns([[0, s.B.used]]);
    }
    // brick b's surface cells into the scratch run; returns how many
    scanBrick(b, flagOf) {
      const B = this.B, [nx, ny, nz] = this.vol.dims, rgba = this.vol.rgba, R = B.run;
      const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && rgba[((z * ny + y) * nx + x) * 4 + 3] !== 0;
      const x0 = (b % B.bx) * 8, y0 = (Math.floor(b / B.bx) % B.by) * 8, z0 = Math.floor(b / (B.bx * B.by)) * 8;
      let n = 0;
      for (let z = z0; z < Math.min(nz, z0 + 8); z++) for (let y = y0; y < Math.min(ny, y0 + 8); y++) for (let x = x0; x < Math.min(nx, x0 + 8); x++) {
        const i = (z * ny + y) * nx + x;
        if (!rgba[i * 4 + 3]) continue;
        if (solid(x - 1, y, z) && solid(x + 1, y, z) && solid(x, y - 1, z) && solid(x, y + 1, z) && solid(x, y, z - 1) && solid(x, y, z + 1)) continue;
        const o = n * 4;
        R.inst[o] = x; R.inst[o + 1] = y; R.inst[o + 2] = z; R.inst[o + 3] = rgba[i * 4 + 3] | ((flagOf ? flagOf(i) : 0) << 8);
        R.nao[o] = rgba[i * 4]; R.nao[o + 1] = rgba[i * 4 + 1]; R.nao[o + 2] = rgba[i * 4 + 2]; R.nao[o + 3] = 0;
        R.slot[n++] = i;
      }
      return n;
    }
    // the scratch run as brick b's run at `at`, with room for cap (the rest empty)
    writeRun(b, at, n, cap) {
      const B = this.B, R = B.run;
      B.inst.set(R.inst.subarray(0, n * 4), at * 4); B.inst.fill(0, (at + n) * 4, (at + cap) * 4);
      B.nao.set(R.nao.subarray(0, n * 4), at * 4);
      B.slot.set(R.slot.subarray(0, n), at); B.slot.fill(-1, at + n, at + cap);
      B.start[b] = at; B.len[b] = n; B.cap[b] = cap;
    }
    growRuns(need) {
      const B = this.B;
      if (need <= B.slot.length) return;
      const n = Math.max(need, B.slot.length * 2), inst = new Uint16Array(n * 4), nao = new Uint8Array(n * 4), slot = new Int32Array(n).fill(-1);
      inst.set(B.inst); nao.set(B.nao); slot.set(B.slot);
      B.inst = inst; B.nao = nao; B.slot = slot;
    }
    // the runs packed tight, in brick order, and uploaded whole
    repack() {
      const B = this.B, inst = new Uint16Array(Math.max(4096, B.live) * 4), nao = new Uint8Array(inst.length), slot = new Int32Array(inst.length / 4).fill(-1);
      let at = 0;
      for (let b = 0; b < B.start.length; b++) {
        const s = B.start[b], n = B.len[b];
        if (s < 0 || !n) { B.start[b] = -1; B.len[b] = B.cap[b] = 0; continue; }
        inst.set(B.inst.subarray(s * 4, (s + n) * 4), at * 4); nao.set(B.nao.subarray(s * 4, (s + n) * 4), at * 4); slot.set(B.slot.subarray(s, s + n), at);
        B.start[b] = at; B.cap[b] = n; at += n;
      }
      Object.assign(B, { inst, nao, slot, used: at });
      this.gcap = 0; this.uploadRuns([]);
    }
    // the changed instance ranges to the GPU (everything when the buffers must grow)
    uploadRuns(ranges) {
      const gl = this.gl, B = this.B;
      if (B.used > this.gcap) {
        this.gcap = Math.ceil(B.used * 1.25) + 1024;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.bufferData(gl.ARRAY_BUFFER, this.gcap * 8, gl.DYNAMIC_DRAW); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.inst.subarray(0, B.used * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nbuf); gl.bufferData(gl.ARRAY_BUFFER, this.gcap * 4, gl.DYNAMIC_DRAW); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.nao.subarray(0, B.used * 4));
        this.uploaded = B.used;
      } else {
        ranges.sort((p, q) => p[0] - q[0]);
        const merged = [];
        for (const r of ranges) { const m = merged[merged.length - 1]; if (m && r[0] <= m[1] + 64) m[1] = Math.max(m[1], r[1]); else merged.push(r.slice()); }
        for (const [s, e] of merged) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.bufferSubData(gl.ARRAY_BUFFER, s * 8, B.inst.subarray(s * 4, e * 4));
          gl.bindBuffer(gl.ARRAY_BUFFER, this.nbuf); gl.bufferSubData(gl.ARRAY_BUFFER, s * 4, B.nao.subarray(s * 4, e * 4));
        }
        this.uploaded = merged.reduce((a, r) => a + r[1] - r[0], 0);
      }
      this.count = B.used; this.surface = B.live;
    }
    // the surface cells drawn (cell indices into vol), without the empty room
    get cells() { const B = this.B; if (!B || !B.slot) return []; const s = B.slot.subarray(0, B.used); return B.used === B.live ? s : s.filter((i) => i >= 0); }
    // update flag bits only (selection, brush preview) without rebuilding the instance list
    setFlags(flagOf) {
      if (!this.vol || !this.vol.rgba) return;
      const B = this.B, inst = B.inst, slot = B.slot, rgba = this.vol.rgba;
      for (let k = 0; k < B.used; k++) { const i = slot[k]; if (i >= 0) inst[k * 4 + 3] = rgba[i * 4 + 3] | ((flagOf ? flagOf(i) : 0) << 8); }
      const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, B.used * 4));
    }
    // line segments in world units, drawn over the voxels with depth (live mode: the space's box and floor
    // grid): Float32Array of [x, y, z, r, g, b, a] per vertex, two vertices per segment; null clears
    setLines(data) {
      const gl = this.gl;
      if (!this.lines) {
        const prog = compile(gl, VS_LINE, FS_LINE), vao = gl.createVertexArray(), buf = gl.createBuffer();
        gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
        gl.bindVertexArray(null);
        this.lines = { prog, vao, buf, count: 0 };
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lines.buf); gl.bufferData(gl.ARRAY_BUFFER, data || new Float32Array(0), gl.STATIC_DRAW);
      this.lines.count = data ? data.length / 7 : 0;
    }
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(32, Math.round(this.cv.clientWidth * dpr)), h = Math.max(32, Math.round(this.cv.clientHeight * dpr));
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      this.dpr = dpr;
    }
    get vp() { return this.cam.matrix(this.cv.width, this.cv.height); }
    // o.alpha: clear to transparent (live.shot)
    render(time, o = {}) {
      const gl = this.gl, L = this.look, vp = this.vp;
      gl.viewport(0, 0, this.cv.width, this.cv.height);
      const bg = L.bg.map((c) => Math.pow(c, 1 / 2.2));
      if (o.alpha) gl.clearColor(0, 0, 0, 0); else gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
      if (L.ground) {
        gl.disable(gl.CULL_FACE);
        const g = this.ground; gl.useProgram(g.p); gl.bindVertexArray(this.gvao);
        gl.uniformMatrix4fv(g.u.uVP, false, vp); gl.uniform1f(g.u.uR, this.groundR || 3); gl.uniform1f(g.u.uFine, this.vol ? 1 / this.vol.scale : 16);
        gl.uniform3fv(g.u.uBg, bg); gl.uniform1f(g.u.uFoot, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.CULL_FACE);
      }
      if (this.count && this.vol) {
        const p = this.prog, u = p.u, v = this.vol;
        gl.useProgram(p.p); gl.bindVertexArray(this.vao);
        gl.uniformMatrix4fv(u.uVP, false, vp);
        gl.uniform3fv(u.uOrigin, v.box.slice(0, 3).map((b) => b * v.scale)); gl.uniform1f(u.uVox, v.scale); gl.uniform3fv(u.uBoxO, v.box.slice(0, 3));
        gl.uniform3fv(u.uL, this.L);
        gl.uniform4f(u.uLook, L.shade, L.pool, L.amb, L.aoK); gl.uniform4f(u.uLook2, L.cook, L.spriteK, L.exposure, L.faces);
        gl.uniform1i(u.uMode, L.mode); gl.uniform1f(u.uTime, time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texRamps); gl.uniform1i(u.uRamps, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texMats); gl.uniform1i(u.uMats, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.count);
      }
      if (this.lines && this.lines.count) {
        const ln = this.lines;
        gl.useProgram(ln.prog.p); gl.bindVertexArray(ln.vao); gl.uniformMatrix4fv(ln.prog.u.uVP, false, vp);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.drawArrays(gl.LINES, 0, ln.count);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    }
    // world point -> CSS pixel [x, y, depth]
    project(p) {
      const m = this.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      return [((x + 1) / 2) * this.cv.clientWidth, ((1 - y) / 2) * this.cv.clientHeight, z];
    }
    // CSS pixel -> world ray { o, d } (orthographic: parallel rays)
    ray(px, py) {
      const inv = M4.inv(this.vp), nx = (px / this.cv.clientWidth) * 2 - 1, ny = 1 - (py / this.cv.clientHeight) * 2;
      const a = M4.apply(inv, [nx, ny, -1]), b = M4.apply(inv, [nx, ny, 1]), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d);
      return { o: a, d: d.map((c) => c / l), len: l };
    }
    // DDA through the current volume: first solid voxel along the ray and the face it was entered by
    pick(px, py) {
      const v = this.vol, r = this.ray(px, py);
      let groundHit = null;
      if (r.d[2] < -1e-6) { const t = -r.o[2] / r.d[2]; groundHit = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, 0]; }
      if (!v || !v.rgba) return { ground: groundHit };
      const [nx, ny, nz] = v.dims, s = v.scale, rgba = v.rgba;
      // ray in voxel units relative to the box origin
      const o = [0, 1, 2].map((a) => r.o[a] / s - v.box[a]), d = r.d;
      let t0 = 0, t1 = r.len / s;
      for (let a = 0; a < 3; a++) {
        const lo = 0, hi = v.dims[a];
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return { ground: groundHit }; continue; }
        let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 > t1) return { ground: groundHit };
      const p = o.map((c, a) => c + d[a] * (t0 + 1e-5)), c = p.map((x, a) => Math.min(v.dims[a] - 1, Math.max(0, Math.floor(x))));
      const step = d.map((x) => (x > 0 ? 1 : -1)), tD = d.map((x) => Math.abs(1 / (x || 1e-9)));
      const tM = [0, 1, 2].map((a) => (d[a] > 0 ? (c[a] + 1 - p[a]) * tD[a] : (p[a] - c[a]) * tD[a]));
      let face = [0, 0, 0];
      // entry face: the axis whose slab was entered last
      { let best = -1, ax = 2; for (let a = 0; a < 3; a++) { if (Math.abs(d[a]) < 1e-9) continue; const lo = d[a] > 0 ? (0 - o[a]) / d[a] : (v.dims[a] - o[a]) / d[a]; if (lo > best) { best = lo; ax = a; } } face[ax] = -step[ax]; }
      for (let it = 0; it < 3 * (nx + ny + nz); it++) {
        if (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= nx || c[1] >= ny || c[2] >= nz) break;
        const i = (c[2] * ny + c[1]) * nx + c[0];
        if (rgba[i * 4 + 3]) return { cell: c.slice(), index: i, face, ground: groundHit };
        const a = tM[0] < tM[1] ? (tM[0] < tM[2] ? 0 : 2) : tM[1] < tM[2] ? 1 : 2;
        c[a] += step[a]; tM[a] += tD[a]; face = [0, 0, 0]; face[a] = -step[a];
      }
      return { ground: groundHit };
    }
  }
  SV.View = View;
})();
