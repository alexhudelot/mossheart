/* Lighting: the sun visibility volume (replaces shadow maps for the static world), unit shadow disks,
   the deferred lighting pass and the half-resolution light shafts. */
(function () {
  const ME = window.ME, W = ME.wgsl;

  // r = transmittance towards the sun, g = sky visibility (7 upward directions), per coarse cell.
  // The rays' march (steps, growth per step; the first step is one cell). R.sunRegion (passes.js) derives a
  // carve's region from these reaches, so a change here moves the region with it.
  const SV = (ME.SUNVOL = { sun: [80, 1.035], up: [14, 1.3], slant: [12, 1.3], slantXY: 0.8 }); // slantXY: the slanted sky ray's horizontal share (its z is sqrt(1 - slantXY^2), so any value stays a unit ray)
  // the distance in cells of a march's last sample (sunvol's march: samples at t = 1, 2, 2 + g, ...)
  SV.reach = ([n, g]) => 1 + (Math.pow(g, n - 1) - 1) / (g - 1);
  W.sunvol = W.common + /* wgsl */ `
@group(1) @binding(0) var occT: texture_3d<f32>;
@group(1) @binding(1) var lin: sampler;
@group(1) @binding(2) var outT: texture_storage_3d<rgba8unorm, write>;
// the cells this dispatch recomputes, lo..hi inclusive (the whole volume, or a carve's region a slab at a time)
struct SunBox { lo: vec4u, hi: vec4u }
@group(1) @binding(3) var<uniform> sb: SunBox;
fn march(p: vec3f, dir: vec3f, n: i32, s0: f32, grow: f32, sigma: f32) -> f32 {
  var T = 1.0; var t = s0; var st = s0;
  let top = u.cgrid.z + u.cdims.z / u.cgrid.w;
  for (var i = 0; i < n; i++) {
    let q = p + dir * t;
    let uvw = sunUVW(q);
    if (q.z > top || any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) { break; }
    T *= exp(-textureSampleLevel(occT, lin, uvw, 0.0).r * sigma * st);
    if (T < 0.01) { return 0.0; }
    t += st; st *= grow;
  }
  return T;
}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = vec3u(u.cdims.xyz);
  let id = gid + sb.lo.xyz;
  if (any(id >= N) || any(id > sb.hi.xyz)) { return; }
  let cell = 1.0 / u.cgrid.w;
  let p = u.cgrid.xyz + (vec3f(id) + 0.5) * cell;
  let sun = march(p, u.sun.xyz, ${SV.sun[0]}, cell, ${SV.sun[1]}, 34.0);
  var sky = 2.0 * march(p, vec3f(0.0, 0.0, 1.0), ${SV.up[0]}, cell, ${SV.up[1]}, 18.0);
  for (var k = 0; k < 6; k++) {
    let a = f32(k) * 1.0472 + 0.3;
    sky += march(p, normalize(vec3f(cos(a) * ${SV.slantXY}, sin(a) * ${SV.slantXY}, ${Math.sqrt(1 - SV.slantXY * SV.slantXY).toFixed(6)})), ${SV.slant[0]}, cell, ${SV.slant[1]}, 18.0);
  }
  textureStore(outT, id, vec4f(sun, sky / 8.0, 0.0, 1.0));
}
`;

  // Deferred lighting. Ramp mode shades like the generator: a scalar s = form + sun pool - canopy shade
  // - AO is looked up in the material's own hue-shifted ramp (shadows lean violet, light leans gold).
  W.lighting = W.common + ME.FS_VS + ME.canopyTex(10) + /* wgsl */ `
@group(1) @binding(0) var gA: texture_2d<f32>;
@group(1) @binding(1) var gN: texture_2d<f32>;
@group(1) @binding(2) var gD: texture_depth_2d;
@group(1) @binding(3) var sunV: texture_3d<f32>;
@group(1) @binding(4) var lin: sampler;
@group(1) @binding(5) var<storage, read> mats: array<vec4f>;
@group(1) @binding(6) var ramps: texture_2d<f32>;
@group(1) @binding(7) var<storage, read> lights: array<vec4f>;  // (pos, radius) (colour, k) per light
@group(1) @binding(8) var<storage, read> lgrid: array<u32>;    // 8 light slots per map cell
@group(1) @binding(9) var<storage, read> wlev: array<f32>;     // water surface z per map cell (-99 dry)
@group(1) @binding(11) var gE: texture_2d<f32>;                  // light emitted by marked volumes (hookMark)
@group(1) @binding(12) var fieldT: texture_2d<f32>;              // the app's scalar field over the map (Renderer.setField)
@group(1) @binding(13) var cellT: texture_2d<f32>;               // the app's rgba per map tile (Renderer.setCells)
fn fieldAt(xy: vec2f) -> f32 { return textureSampleLevel(fieldT, lin, xy / u.field.xy, 0.0).r; }
fn cellAt(c: vec2i) -> vec4f { if (any(c < vec2i(0)) || any(c >= vec2i(u.field.xy))) { return vec4f(0.0); } return textureLoad(cellT, c, 0); }
//#hooks shade overlay
// sunlight focused by the moving surface: bright threads where two drifting noise layers cross
fn caustic(q0: vec2f, t: f32) -> f32 {
  let q = q0 * 4.2;
  let a = vnoise(q + vec2f(t * 0.31, t * 0.22)) + vnoise(q * 1.6 + vec2f(-t * 0.27, t * 0.35) + 5.3);
  let b = vnoise(q * 2.3 + vec2f(t * 0.4, -t * 0.3) + 11.7);
  return pow(clamp(1.0 - abs(a - 1.0) * 2.6, 0.0, 1.0), 3.0) * (0.6 + 0.6 * b);
}

fn rampC(mat: u32, s: f32) -> vec3f { return textureSampleLevel(ramps, lin, vec2f((clamp(s, 0.0, 1.0) * 15.0 + 0.5) / 16.0, (f32(mat) + 0.5) / 256.0), 0.0).rgb; }
// styles5 falls() backdrop: forest({ lo: 0.05, k: 0.5, trunks: TRUNKS, bokeh }) in styles4.js
fn forest(uv: vec2f) -> f32 {
  let x = uv.x; let y = uv.y;
  var s = 0.05 + 0.5 * exp(-((x - 0.5) * (x - 0.5) * 3.2 + (y - 0.5) * (y - 0.5) * 2.6)) - 0.12 * pow(1.0 - y, 3.0);
  var TR = array<vec3f, 6>(vec3f(0.05, 0.035, 0.6), vec3f(0.16, 0.022, 0.45), vec3f(0.3, 0.05, 0.55), vec3f(0.71, 0.03, 0.5), vec3f(0.83, 0.055, 0.6), vec3f(0.95, 0.025, 0.45));
  for (var i = 0; i < 6; i++) {
    let tr = TR[i];
    let d = abs(x - tr.x - sin(y * 5.0 + tr.x * 11.0) * 0.006) / (tr.y * (1.0 + 0.3 * y));
    if (d < 1.0) { s = s * (1.0 - tr.z * (1.0 - pow(d, 6.0))) + select(0.0, 0.025, d > 0.6 && x < tr.x); }
  }
  var BK = array<vec4f, 5>(vec4f(0.12, 0.1, 0.03, 0.16), vec4f(0.24, 0.05, 0.02, 0.14), vec4f(0.62, 0.06, 0.035, 0.1), vec4f(0.9, 0.14, 0.025, 0.16), vec4f(0.77, 0.03, 0.018, 0.12));
  for (var i = 0; i < 5; i++) {
    let b = BK[i];
    let d = length(vec2f(x - b.x, (y - b.y) * 0.9)) / b.z;
    if (d < 1.0) { s += b.w * select(1.0, 1.25, d > 0.86) * (1.0 - d * d * 0.4); }
  }
  return s;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * u.res.zw;
  let d = textureLoad(gD, px, 0);
  if (d <= 0.0) { return vec4f(rampC(u32(u.ids.x), forest(uv)), 1.0); }
  let p = (u.ivp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0)).xyz;
  let A = textureLoad(gA, px, 0); let N = textureLoad(gN, px, 0);
  let n = octDec(N.xy); let mat = u32(N.z + 0.5); let aux = N.w;
  let m0 = mats[mat * 2u]; let m1 = mats[mat * 2u + 1u]; let cls = u32(m1.w + 0.5);
  let L = u.sun.xyz; let V = -u.vdir.xyz;
  let sv = textureSampleLevel(sunV, lin, sunUVW(p + n * 0.2), 0.0);
  let vis = sv.r;
  // canopy off: the canopy's average openness (~0.04) without the dapple, not open sky
  let cook = canopyS(p);
  let ao = A.a * mix(1.0, sv.g, 0.65);
  let dif = dot(n, L); let wrap = m1.x;
  let lam = max(0.0, (dif + wrap) / (1.0 + wrap));
  let amb = u.look.z; let shade = u.look.x; let pool = u.look.y;
  let lmod = -shade + (shade + pool) * cook * vis; // P.lightMod
  var s: f32;
  if (aux >= 1.0 || aux < -0.5) {
    // models and leaves: the generator's sprite form (renderModel), canopy offset scaled by spriteK
    s = amb * (0.6 + 0.4 * n.z) + (1.0 - amb) * lam * (0.35 + 0.65 * vis) + m1.z + lmod * u.look4.x;
    // soft knee above 1: a sun pool (lmod ~0.65) on full sun put models at s ~1.5, past the ramp's top, and the
    // boost below then clipped them white (Thornbloom, the lanterns); s <= 1 is unchanged, the rest rolls off to 1.08
    let sk = max(0.0, s - 1.0); s -= sk - sk / (1.0 + sk / 0.08);
  } else {
    // terrain form: tops sit at ~0.56, walls 0.3 + 0.5 * (facing the sun horizontally), undersides darker;
    // sun pools on walls weighted by facing * sideK, then cast shadow
    let wallF = max(0.0, dot(n.xy, normalize(L.xy + vec2f(1e-5))));
    let topW = sstep(0.2, 0.9, n.z);
    s = mix(0.3 + 0.5 * wallF, 0.56, topW) - 0.14 * max(0.0, -n.z) + (amb - 0.22) + m1.z;
    let kSun = mix(min(1.0, wallF * u.shadow2.z), 1.0, topW);
    s += -shade + (shade + pool) * cook * vis * kSun - u.shadow2.w * (1.0 - vis);
    // moss carpet: soft clumps and fine grain, as the generator's velvet tops; gusts comb the fibres
    // into travelling bands of sheen
    if (cls == 1u) {
      s += ((fbm2(p.xy * 1.6) - 0.5) * 0.3 + (vnoise(p.xy * 46.0) - 0.5) * 0.09) * u.look4.y * topW;
      s += (gust(p.xy, u.vdir.w) - (0.55 + 0.42 * (0.5 - u.wind.w)) * u.wind.z) * 0.09 * topW * (0.55 + 0.45 * vnoise(p.xy * 5.0));
    }
  }
  s -= u.look.w * (1.0 - ao);
  // under water: caustics dancing on the bed (and the koi), dimming with depth
  let wc = vec2i(floor(p.xy));
  if (u.water2.y > 0.5 && all(wc >= vec2i(0)) && all(wc < vec2i(u.water2.zw))) {
    let dep = wlev[u32(wc.y * i32(u.water2.z) + wc.x)] - p.z;
    if (dep > 0.005) {
      s += caustic(p.xy, u.vdir.w) * 0.34 * (0.25 + cook * vis) * exp(-dep * 2.5) * sstep(0.005, 0.04, dep);
      s -= min(dep, 0.4) * 0.3;
    }
  }
  var trans = 0.0;
  if (cls == 2u) { trans = max(0.0, -dif) * vis * cook * 0.45; s += trans; }
  if (cls == 1u) { s += pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.22 * (0.35 + cook * vis); }
  var col: vec3f;
  if (u.look2.y > 0.5) {
    col = rampC(mat, s) * (A.rgb / max(m0.rgb, vec3f(0.003)));
  } else {
    col = A.rgb * (vec3f(1.0, 0.85, 0.6) * 2.4 * (lam * vis * (0.15 + 0.85 * cook) + trans) + vec3f(0.18, 0.3, 0.2) * ao * 0.8);
  }
  col *= 1.0 + max(0.0, s - 0.9) * 1.8;
  // rain (Weather 2) on the terrain and the models, not the sim's instances: wet darkens where the sky reaches
  // (sv.g), moss less, with a faint sheen on wet walls; the up-facing open ground splashes, a hashed point per
  // 0.25 cell crowning for 0.15 s once a cycle (1.4 s in a drizzle to 0.5 s in a downpour) at its own phase
  if (aux < 1000.0 && (u.weather2.x > 0.0 || u.weather.x > 0.0)) {
    let wetK = u.weather2.x * sv.g * select(1.0, 0.55, cls == 1u);
    col *= 1.0 - 0.28 * wetK;
    col += vec3f(0.9, 0.95, 1.0) * pow(max(dot(reflect(-V, n), L), 0.0), 24.0) * wetK * (1.0 - sstep(0.2, 0.9, n.z)) * 0.08 * vis;
    let r = u.weather.x;
    if (r > 0.0 && n.z > 0.7) {
      let g = 0.25; let c = floor(p.xy / g); let P = mix(1.4, 0.5, r);
      let ph = u.vdir.w / P + hash12(c + 19.0); let age = fract(ph) * P;
      if (age < 0.15 && hash12(c + vec2f(floor(ph) * 0.173, 4.0)) < 0.2 + 0.6 * r) {
        let at = (c + 0.2 + 0.6 * vec2f(hash12(c + vec2f(floor(ph), 8.0)), hash12(c + vec2f(2.0, floor(ph))))) * g;
        let x = length(p.xy - at) - age * 0.45;
        col += u.fog.rgb * sstep(0.014, 0.0, abs(x)) * (1.0 - age / 0.15) * r * sv.g * 0.45;
      }
    }
  }
  if (cls == 3u) { col = rampC(mat, 1.0) * (1.7 + 0.35 * sin(u.vdir.w * 3.0 + p.x * 5.0 + p.y * 3.0)) * m0.w; } // m0.w: the material's em gain
  _ = fieldT; _ = cellT; // bound even when the hooks ignore them
  col = hookShade(col, p, n, cls, aux >= 1000.0);
  // point lights binned per map cell on the CPU: at most 8 candidates per pixel
  let gc = vec2i(floor(p.xy - u.lgrid.xy));
  if (all(gc >= vec2i(0)) && all(gc < vec2i(u.lgrid.zw))) {
    let cb = u32(gc.y * i32(u.lgrid.z) + gc.x) * 8u;
    for (var k = 0u; k < 8u; k++) {
      let li = lgrid[cb + k];
      if (li == 0xffffffffu) { break; }
      let lp = lights[li * 2u]; let lc = lights[li * 2u + 1u];
      let dv = lp.xyz - p; let dist = length(dv);
      if (dist > lp.w) { continue; }
      let fi = f32(li);
      let flick = 0.84 + 0.16 * sin(u.vdir.w * 6.1 + fi * 2.3) * sin(u.vdir.w * 2.3 + fi);
      let f = 1.0 - dist / lp.w;
      col += A.rgb * lc.rgb * (f * f * lc.w * flick * max(0.0, dot(n, dv / max(dist, 1e-3)) * 0.7 + 0.3));
    }
  }
  if (aux >= 1.0) { col += textureLoad(gE, px, 0).rgb; }
  col = hookOverlay(col, p, n, aux >= 1000.0);
  return vec4f(col, 1.0);
}
`;

  // the lighting on a map with water looks (T.looks): each looked cell's caustic gain and how much its water
  // dims the floor (wlev's second and third planes). A map without looks compiles W.lighting as it is, so
  // its frames stay the same byte for byte.
  W.lightingL = ME.variant(W.lighting, [[/* wgsl */ `      s += caustic(p.xy, u.vdir.w) * 0.34 * (0.25 + cook * vis) * exp(-dep * 2.5) * sstep(0.005, 0.04, dep);
      s -= min(dep, 0.4) * 0.3;
`, /* wgsl */ `      let wNC = u32(u.water2.z * u.water2.w); let wci = u32(wc.y * i32(u.water2.z) + wc.x);
      let wcg = wlev[wNC + wci]; let wdk = wlev[2u * wNC + wci];
      if (wcg == 1.0 && wdk == 1.0) {
        s += caustic(p.xy, u.vdir.w) * 0.34 * (0.25 + cook * vis) * exp(-dep * 2.5) * sstep(0.005, 0.04, dep);
        s -= min(dep, 0.4) * 0.3;
      } else {
        // a looked water: its caustic gain, and clear water dims the floor less with depth
        s += caustic(p.xy, u.vdir.w) * 0.34 * wcg * (0.25 + cook * vis) * exp(-dep * 2.5 * wdk) * sstep(0.005, 0.04, dep);
        s -= min(dep, 0.4) * 0.3 * wdk;
      }
`]]);

  // Light shafts: march the view ray between the canopy plane and the surface at half resolution (coarser
  // past 1080p's pixel count: passes.js resize). Each
  // sample is lit where its sun ray passes a canopy gap (so shafts take the gaps' ragged shapes and sway
  // with them), broken into rays by a streak pattern fixed along the sun direction, shadowed by the sun
  // volume and weighted by haze that thickens towards the ground. Jittered, then a separable blur.
  W.shafts = W.common + ME.canopyTex(4) + /* wgsl */ `
const NS = 8; // samples per ray (jittered per pixel and frame, then blurred)
@group(1) @binding(0) var gD: texture_depth_2d;
@group(1) @binding(1) var sunV: texture_3d<f32>;
@group(1) @binding(2) var lin: sampler;
@group(1) @binding(3) var outT: texture_storage_2d<rgba16float, write>;
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
// The span (fractions of a..b) inside the frame: the jar's glass cylinder under its half-ellipsoid dome, or
// the box's sides (u.geo.z its half x, -u.look2.z its half y). Outside it the sun volume clamps to its edge,
// so the air off the island would be lit and the canopy's streaks drawn there as bands. Empty when x > y.
fn hitSphere(o: vec3f, v: vec3f, R: f32) -> vec2f {
  let A = dot(v, v); let B = dot(o, v); let C = dot(o, o) - R * R;
  if (A < 1e-8) { if (C <= 0.0) { return vec2f(-1e9, 1e9); } return vec2f(1.0, 0.0); } // a ray along the axis: all inside or none
  let D = B * B - A * C;
  if (D < 0.0) { return vec2f(1.0, 0.0); }
  let s = sqrt(D); return vec2f(-B - s, -B + s) / A;
}
fn inSlab(o: f32, v: f32, h: f32) -> vec2f {
  if (abs(v) < 1e-6) { if (abs(o) <= h) { return vec2f(-1e9, 1e9); } return vec2f(1.0, 0.0); }
  let p = (-h - o) / v; let q = (h - o) / v; return vec2f(min(p, q), max(p, q));
}
fn inFrame(a: vec3f, b: vec3f) -> vec2f {
  let o = a - vec3f(u.geo.xy, u.geo.w); let v = b - a; let R = u.geo.z; let H = u.look2.z;
  if (H < 0.0) { let x = inSlab(o.x, v.x, R); let y = inSlab(o.y, v.y, -H); return vec2f(max(x.x, y.x), min(x.y, y.y)); }
  var c = hitSphere(vec3f(o.xy, 0.0), vec3f(v.xy, 0.0), R);
  if (H <= 0.0) { return c; }
  if (abs(v.z) > 1e-6) { let s = -o.z / v.z; if (v.z < 0.0) { c.x = max(c.x, s); } else { c.y = min(c.y, s); } }
  else if (o.z > 0.0) { c = vec2f(1.0, 0.0); }
  let k = R / H; let e = hitSphere(vec3f(o.xy, o.z * k), vec3f(v.xy, v.z * k), R);
  if (c.x > c.y) { return e; }
  if (e.x > e.y) { return c; }
  return vec2f(min(c.x, e.x), max(c.y, e.y));
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let hs = textureDimensions(outT);
  if (id.x >= hs.x || id.y >= hs.y) { return; }
  let full = vec2i(textureDimensions(gD));
  let k = i32(round(f32(full.x) / f32(hs.x))); // the target's divisor: 2, or 3+ past 1080p's pixels (passes.js)
  // the ray at its texel's centre, where the composite reads it; k = 2 keeps the top-left pixel (desktop hashes)
  let fp = min(vec2i(id.xy) * k + select(vec2i(0), vec2i(k / 2), k > 2), full - 1);
  let d = textureLoad(gD, fp, 0);
  let uv = (vec2f(fp) + 0.5) / vec2f(full);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = (u.ivp * vec4f(ndc, 1.0, 1.0)).xyz;
  let b = (u.ivp * vec4f(ndc, max(d, 0.0), 1.0)).xyz;
  let dz = b.z - a.z;
  var t0 = 0.0; var t1 = 1.0;
  if (dz < -1e-4) { t0 = clamp((u.canopy3.x - a.z) / dz, 0.0, 1.0); t1 = clamp((u.misc2.z - a.z) / dz, 0.0, 1.0); }
  let fr = inFrame(a, b); t0 = max(t0, fr.x); t1 = min(t1, fr.y);
  var I = 0.0;
  if (t1 > t0) {
    let jit = fract(ign(vec2f(id.xy)) + u.misc2.x * 0.618034);
    let tm = u.vdir.w;
    for (var i = 0; i < NS; i++) {
      let p = mix(a, b, mix(t0, t1, (f32(i) + jit) / f32(NS)));
      let q = canopyQ(p, tm);
      let cg = canopyT4(q); let c = cg.y;
      if (c <= 0.0) { continue; }
      let streak = cg.z;
      let haze = exp(-max(0.0, p.z - u.canopy3.z) / u.canopy3.y);
      I += c * streak * haze * textureSampleLevel(sunV, lin, sunUVW(p), 0.0).r;
    }
    I *= length(b - a) * (t1 - t0) / f32(NS);
  }
  textureStore(outT, vec2i(id.xy), vec4f(I, 0.0, 0.0, 1.0));
}
`;
  W.blur = W.common + /* wgsl */ `
@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var dstT: texture_storage_2d<rgba16float, write>;
override DIRX: bool = true;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let hs = vec2i(textureDimensions(dstT));
  let p = vec2i(id.xy);
  if (p.x >= hs.x || p.y >= hs.y) { return; }
  let dir = select(vec2i(0, 1), vec2i(1, 0), DIRX);
  let r = select(3, 5, u.res.x > 1200.0 && f32(hs.x * 3) > u.res.x); // (3 on a target coarser than half)
  var acc = 0.0; var ws = 0.0;
  for (var k = -r; k <= r; k++) {
    let w = exp(-f32(k * k) / f32(r * r) * 2.0);
    acc += textureLoad(src, clamp(p + dir * k, vec2i(0), hs - 1), 0).r * w; ws += w;
  }
  textureStore(dstT, p, vec4f(acc / ws, 0.0, 0.0, 1.0));
}
`;
})();
