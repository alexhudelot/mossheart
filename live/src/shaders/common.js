/* Shared WGSL: the per-frame uniform block (mirrored by ME.UOFF), hashing/noise, octahedral normals,
   sun-volume addressing, the wind field and the canopy light: the sun reaches the jar through an
   overhead layer of foliage. Its gaps (anchored at the style's beam spots, plus smaller random ones)
   make the light pools and shafts; leaves inside the gaps dapple them; gusts sway it all. */
(function () {
  const ME = window.ME;
  ME.wgsl = ME.wgsl || {};

  // float offsets into the uniform buffer (vec4 aligned)
  ME.UOFF = { vp: 0, ivp: 16, vdir: 32, sun: 36, res: 40, grid: 44, dims: 48, cgrid: 52, cdims: 56, look: 60, look2: 64, look3: 68, fog: 72, beamCol: 76, canopy: 80, canopy2: 84, shadow: 88, shadow2: 92, beams: 96, beamK: 128, ids: 136, misc: 140, outres: 144, part: 148, psrc: 152, geo: 156, misc2: 160, look4: 164, wind: 168, canopy3: 172, water2: 176, lgrid: 180, field: 184, weather: 188, weather2: 192, weather3: 196, wclear: 200, weather4: 216, user: 220 };
  // vec4 slots of app data at the end of the block (u.user[k], Renderer.user) for the shader hooks
  ME.USER_SLOTS = 6;
  ME.USIZE = ME.UOFF.user + 4 * ME.USER_SLOTS;

  // Wind: a steady breeze plus gust fronts rolling across the jar along the wind direction.
  // Mirrored exactly by WGSL gust() so trees (CPU) and grass, moss and canopy (GPU) move together.
  // gs (R.set.gust, 0..1) is how much of the wind comes in fronts: a breeze of 0.6*(1 - gs) under fronts of
  // 0.9*(0.5 + gs), so 0.5 is the original mix. ME.gustOf reads it from a settings object (0.5 if unset).
  ME.WIND_DIR = [0.85, -0.527];
  ME.gustOf = (s) => { const v = s.gust == null ? 0.5 : +s.gust; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5; };
  ME.gust = (x, y, t, k, gs = 0.5) => {
    const [wx, wy] = ME.WIND_DIR, a = x * wx + y * wy, c = -x * wy + y * wx, ph = a * 0.45 - t * 1.1;
    const g = Math.pow(0.5 + 0.5 * Math.sin(ph + 1.7 * Math.sin(ph * 0.37 + t * 0.13)), 3);
    const cr = 0.65 + 0.35 * Math.sin(c * 0.7 + t * 0.11) * Math.sin(c * 0.31 - t * 0.07);
    return k * (0.6 * (1 - gs) + 0.9 * (0.5 + gs) * g * cr);
  };

  ME.wgsl.common = /* wgsl */ `
struct U {
  vp: mat4x4f, ivp: mat4x4f,
  vdir: vec4f,    // world view direction (towards the scene), w = time
  sun: vec4f,     // L (towards the sun), w = canopy wind offset
  res: vec4f,     // render w, h, 1/w, 1/h
  grid: vec4f,    // voxel grid origin, voxels per unit
  dims: vec4f,    // voxel grid dims, frame
  cgrid: vec4f,   // coarse/sun grid origin, cells per unit
  cdims: vec4f,   // coarse dims, light count
  look: vec4f,    // shade, pool, amb, aoK
  look2: vec4f,   // bevelK, rampMode, dome height (a box frame: minus its half y), canopyOn
  look3: vec4f,   // debugView, shaftK, bloomK, exposure
  fog: vec4f,     // fog rgb, haze
  beamCol: vec4f, // beam rgb, vignette
  canopy: vec4f,  // leaf layer opacity 1, 2, leaf scale 1, 2
  canopy2: vec4f, // random gap threshold, the clouds' drift phase (wind strength x seconds), random gap brightness, gap rim softness
  shadow: vec4f,  // canopy texture: plane origin xy, 1/size, -
  shadow2: vec4f, // vlod (R.set.vlod), beam count, sideK, shadowK
  beams: array<vec4f, 8>,   // x y z r: foot points of the style's sun pools
  beamK: array<vec4f, 2>,
  ids: vec4f,     // material ids: sky, water, fall, maple
  misc: vec4f,    // glass, water, particles, shafts toggles
  outres: vec4f,  // canvas w, h, 1/w, 1/h
  part: vec4f,    // leaf, firefly, mist counts, dt
  psrc: vec4f,    // source counts (leaf, firefly, mist), depth range D1-D0
  geo: vec4f,     // the frame: centre xy, glass radius (box: half x), glass top
  misc2: vec4f,   // frame, shaft z top, shaft z bottom, bloom threshold
  look4: vec4f,   // spriteK, moss mottling, spray count, spray first source
  wind: vec4f,    // direction xy, strength, gust share
  canopy3: vec4f, // canopy plane height, shaft haze height, haze base z, moon (0 day .. 1 night)
  water2: vec4f,  // ripple count, caustics strength, water-level grid size, -
  lgrid: vec4f,   // light grid origin xy, size wh
  field: vec4f,   // app ground maps: map size wh (tiles), field texels per tile, -
  weather: vec4f, // R.weather: rain, snow, fog, flash (0 without weather)
  weather2: vec4f, // wet, cover, cloud, fog height
  weather3: vec4f, // fog base z, low fog, petals, wind channel
  wclear: array<vec4f, 4>, // fog clearings: x, y, radius, softness (radius 0 = unused)
  weather4: vec4f, // rain streak layers (R.rainLayers: 3; 2 on compat, 1 on a phone), -, -, -
  user: array<vec4f, ${ME.USER_SLOTS}>, // app data for the shader hooks (Renderer.user)
};
@group(0) @binding(0) var<uniform> u: U;

fn sstep(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn hash13(p: vec3f) -> f32 { var p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  let a = hash12(i); let b = hash12(i + vec2f(1.0, 0.0)); let c = hash12(i + vec2f(0.0, 1.0)); let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fbm2(p: vec2f) -> f32 {
  var a = 0.0; var f = 1.0; var amp = 0.5; var n = 0.0;
  for (var i = 0; i < 3; i++) { a += vnoise(p * f + vec2f(f32(i) * 17.0)) * amp; n += amp; f *= 2.03; amp *= 0.5; }
  return a / n;
}
fn octEnc(n: vec3f) -> vec2f {
  let m = n / (abs(n.x) + abs(n.y) + abs(n.z));
  if (m.z >= 0.0) { return m.xy; }
  let s = select(vec2f(-1.0), vec2f(1.0), m.xy >= vec2f(0.0));
  return (1.0 - abs(m.yx)) * s;
}
fn octDec(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}
fn sunUVW(p: vec3f) -> vec3f { return (p - u.cgrid.xyz) * u.cgrid.w / u.cdims.xyz; }
fn beamKOf(i: i32) -> f32 {
  let v = u.beamK[i / 4]; let j = i % 4;
  return select(select(select(v.w, v.z, j == 2), v.y, j == 1), v.x, j == 0);
}
// Breeze plus gust fronts (ME.gust mirrors this); u.wind.w is the gust share (R.set.gust).
fn gust(p: vec2f, t: f32) -> f32 {
  let wd = u.wind.xy; let a = dot(p, wd); let c = dot(p, vec2f(-wd.y, wd.x)); let ph = a * 0.45 - t * 1.1;
  let g = pow(0.5 + 0.5 * sin(ph + 1.7 * sin(ph * 0.37 + t * 0.13)), 3.0);
  let cr = 0.65 + 0.35 * sin(c * 0.7 + t * 0.11) * sin(c * 0.31 - t * 0.07);
  let gs = u.wind.w;
  return u.wind.z * (0.6 * (1.0 - gs) + 0.9 * (0.5 + gs) * g * cr);
}
// Where the sun ray through p crosses the canopy plane, swayed by the wind (branches lean downwind
// in a gust and swing back).
fn canopyQ(p: vec3f, t: f32) -> vec2f {
  let L = u.sun.xyz;
  let q = p.xy + (u.canopy3.x - p.z) * L.xy / max(L.z, 0.2);
  let g = gust(q * 0.5, t);
  let wd = u.wind.xy; let wp = vec2f(-wd.y, wd.x);
  return q - wd * (g * 0.24 + 0.05 * sin(t * 0.7 + q.y * 0.3) * u.wind.z) - wp * 0.05 * sin(t * 0.53 + q.x * 0.21) * u.wind.z;
}
// Openness of the canopy at q: irregular gaps at the style's pool spots, plus smaller random gaps
// (weighted by rk: surfaces get them, shafts do not, so the air is not striped everywhere).
// x = with the random gaps, y = pool gaps only.
fn canopyGaps(q: vec2f, rk: f32) -> vec2f {
  let L = u.sun.xyz; var open = 0.0;
  let nb = i32(u.shadow2.y);
  for (var i = 0; i < nb; i++) {
    let bm = u.beams[i];
    let c = bm.xy + (u.canopy3.x - bm.z) * L.xy / max(L.z, 0.2);
    let d = q - c; let r = length(d);
    if (r > bm.w * 1.9) { continue; }
    let fi = f32(i) * 1.7; let ang = atan2(d.y, d.x);
    // lobed, warped outline: no two pools alike, none a disc
    let lobes = 1.0 + 0.2 * sin(ang * 2.0 + fi) + 0.13 * sin(ang * 3.0 + fi * 2.3) + 0.08 * sin(ang * 5.0 - fi);
    let warp = (vnoise(d * 1.5 + vec2f(fi * 7.0, fi * 3.0)) - 0.5) * 0.65;
    open = max(open, sstep(1.0, 1.0 - u.canopy2.w, r / (bm.w * (lobes + warp))) * beamKOf(i));
  }
  if (rk <= 0.0) { return vec2f(open); }
  let fg = fbm2(q * 0.75 + vec2f(3.1, 7.7));
  return vec2f(max(open, sstep(u.canopy2.x, u.canopy2.x + 0.08, fg) * u.canopy2.z * rk), open);
}
// One layer of leaves: each cell may hold a pointed leaf that flutters on its own.
fn leafLayer(q: vec2f, t: f32, seed: f32) -> f32 {
  let i = floor(q); let f = fract(q); var m = 0.0; let w = u.wind.z;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2f(f32(x), f32(y));
      let h = hash12(i + o + vec2f(seed * 17.0, 3.0));
      if (h > 0.66) { continue; }
      let h2 = hash12(i + o + vec2f(seed * 31.0 + 5.0, 9.0));
      let a = h2 * 6.283 + 0.4 * w * sin(t * (2.0 + h * 3.0) + h * 20.0);
      let c = o + 0.5 + (vec2f(h, h2) - 0.5) * 0.6 + 0.07 * w * vec2f(sin(t * 3.1 + h * 9.0), cos(t * 2.7 + h2 * 9.0));
      let d = f - c; let cs = cos(a); let sn = sin(a);
      let e = vec2f(d.x * cs + d.y * sn, -d.x * sn + d.y * cs) / vec2f(0.62, 0.36);
      // far leaves cast soft shadows (penumbra), so the gaps between them read as round sun flecks
      m = max(m, sstep(1.25, 0.55, length(e) * (1.0 + 0.25 * abs(e.x))));
    }
  }
  return m;
}
// Sun reaching p through the canopy, 0..1. full = with leaves (surfaces); shafts use the gaps with a
// cheap streak breakup instead.
fn canopy(p: vec3f, full: bool) -> f32 {
  let t = u.vdir.w;
  return canopyAt(canopyQ(p, t), t).x;
}
// The canopy at plane point q: x = sun through gaps and leaves (surfaces), y = pool gaps only (shafts).
// Evaluated once per frame into the canopy texture (u.shadow = its plane origin xy and 1/size).
fn canopyAt(q: vec2f, t: f32) -> vec2f {
  let g = canopyGaps(q, 1.0);
  if (g.x <= 0.0) { return g; }
  let l1 = leafLayer(q * u.canopy.z, t, 1.0);
  let l2 = leafLayer(q * u.canopy.w + vec2f(5.2, 1.3) - u.wind.xy * gust(q * 0.5, t) * 0.12, t, 2.0);
  return vec2f(g.x * (1.0 - u.canopy.x * l1) * (1.0 - u.canopy.y * l2), g.y);
}
fn canopyUV(q: vec2f) -> vec2f { return (q - u.shadow.xy) * u.shadow.z; }
`;
  // a shader's variant: each [a, b] puts b in place of a, which must occur exactly once (a stale a would
  // otherwise compile the base shader silently)
  ME.variant = (code, edits) =>
    edits.reduce((s, [a, b]) => {
      const i = s.indexOf(a);
      if (i < 0 || s.indexOf(a, i + 1) >= 0) throw new Error("ME.variant: not exactly once: " + a.slice(0, 60));
      return s.slice(0, i) + b + s.slice(i + a.length);
    }, code);
  // Canopy texture binding + lookup for a pass (needs a filtering sampler named lin). Off the
  // texture the canopy is closed: gaps only exist above the island.
  ME.canopyTex = (b) => /* wgsl */ `
@group(1) @binding(${b}) var canT: texture_2d<f32>;
fn canopyT4(q: vec2f) -> vec4f {
  let uv = canopyUV(q);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(canT, lin, uv, 0.0);
}
fn canopyT(q: vec2f) -> vec2f { return canopyT4(q).xy; }
fn canopyS(p: vec3f) -> f32 { if (u.look2.w < 0.5) { return 0.04; } return canopyT(canopyQ(p, u.vdir.w)).x; }
`;

  // Canopy texture: the full canopy evaluated once per frame over the plane domain.
  ME.wgsl.canopytex = ME.wgsl.common + /* wgsl */ `
@group(1) @binding(0) var outT: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outT);
  if (id.x >= n.x || id.y >= n.y) { return; }
  let q = u.shadow.xy + (vec2f(id.xy) + 0.5) / (vec2f(n) * u.shadow.z);
  // b: the streaks inside the shafts (fixed along the plane, so they can live here too), with a slow
  // shimmer that swells across the plane (not a flicker); the moon's are softer, less broken into rays
  let t = u.vdir.w;
  let streak = 0.35 + 0.65 * sstep(0.28, 0.72, vnoise(q * 2.3)) * (0.7 + 0.3 * vnoise(q * 6.1));
  let shim = 0.86 + 0.14 * sin(t * 0.45 + q.x * 0.31 + 1.3 * sin(t * 0.23 + q.y * 0.27));
  var c = canopyAt(q, t);
  // R.weather's clouds: soft banks drifting with the wind (faster in a gale: u.canopy2.y) dim both the sun and
  // the shafts (none at 0)
  let cl = u.weather2.z;
  if (cl > 0.0) {
    let th = 1.0 - 1.3 * cl;
    c *= 1.0 - 0.85 * sstep(th - 0.15, th + 0.15, fbm2(q * 0.09 + u.wind.xy * u.canopy2.y * 0.3));
  }
  textureStore(outT, id.xy, vec4f(c, mix(streak, 0.75, 0.5 * u.canopy3.w) * shim, 1.0));
}
`;

  // Shader hooks: the extension points an app (a game) fills with its own WGSL, passed to the Renderer as
  // opts.hooks = { name: source }. Each source defines the function below with the same signature; the
  // defaults leave the scene untouched. Hooks may read u.user[k] (Renderer.user), u.field and, where
  // noted, fieldAt(xy) (the app's scalar field map, Renderer.setField) and cellAt(cell) (its per-tile
  // rgba map, Renderer.setCells). Units are flagged instances (sim.put flags = 1: moving actors).
  ME.SHADER_HOOKS = {
    // volume pass, on instances put with a mark (sim.put mark bits / markV): returns an albedo tint
    // (rgb, a = mix) and emitted light. n world normal, lp model-local position (tiles), hc a per-voxel
    // hash, seed a per-instance number.
    mark: "fn hookMark(bits: u32, v: f32, n: vec3f, lp: vec3f, hc: f32, seed: f32) -> Mark { return Mark(vec4f(0.0), vec3f(0.0)); }",
    // the one the volume pass calls: hookMark plus alb, the voxel's albedo before the tint (its material
    // colour with the per-voxel jitter), e.g. to scale a glow by the body colour. The default is hookMark.
    markAlb: "fn hookMarkAlb(bits: u32, v: f32, n: vec3f, lp: vec3f, hc: f32, seed: f32, alb: vec3f) -> Mark { return hookMark(bits, v, n, lp, hc, seed); }",
    // lighting pass, before the point lights: re-colours a lit pixel (cls = material class, ME.CLS).
    // fieldAt and cellAt are available.
    shade: "fn hookShade(col: vec3f, p: vec3f, n: vec3f, cls: u32, unit: bool) -> vec3f { return col; }",
    // lighting pass, last: draws over the final colour (ground markers, overlays). fieldAt and cellAt
    // are available.
    overlay: "fn hookOverlay(col: vec3f, p: vec3f, n: vec3f, unit: bool) -> vec3f { return col; }",
    // grass vertex: how wilted the blades rooted at xy are, 0..1 (shorter, limper, bent over).
    // fieldAt is available.
    wilt: "fn hookWilt(xy: vec2f) -> f32 { return 0.0; }",
  };
  // Splices the app's hooks (or the defaults) into a shader at its "//#hooks name name" line.
  ME.withHooks = (code, hooks = {}) => code.replace(/^\/\/#hooks (.*)$/m, (_, names) => names.trim().split(/\s+/).map((k) => hooks[k] || ME.SHADER_HOOKS[k]).join("\n"));
})();
