/* Forward passes over the lit HDR image, depth read-only (and sampled for water thickness):
   water surfaces, waterfall sheets, fireflies and mist, the bell-jar glass. Plus the particle sim. */
(function () {
  const ME = window.ME, W = ME.wgsl;
  const RAMP = /* wgsl */ `
fn rampC(mat: u32, s: f32) -> vec3f { return textureSampleLevel(ramps, lin, vec2f((clamp(s, 0.0, 1.0) * 15.0 + 0.5) / 16.0, (f32(mat) + 0.5) / 256.0), 0.0).rgb; }
`;

  // Water: a height field of flow-advected ripples (two cross-faded phases so the current never
  // stretches the pattern), wind wavelets roughened where a gust passes (cat's paws) and expanding
  // rings from splashes and the falls; normals by finite differences. Depth tint from the scene below,
  // sun glints, the forest reflected at grazing angles, foam on ring crests, flow lines and shallows.
  W.water = W.common + ME.canopyTex(5) + /* wgsl */ `
@group(1) @binding(0) var gD: texture_depth_2d;
@group(1) @binding(1) var sunV: texture_3d<f32>;
@group(1) @binding(2) var lin: sampler;
@group(1) @binding(3) var ramps: texture_2d<f32>;
@group(1) @binding(4) var<storage, read> rings: array<vec4f>; // x, y, t0, amplitude
struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) f: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) f: vec3f) -> VO { var o: VO; o.pos = u.vp * vec4f(p, 1.0); o.w = p; o.f = f; return o; }
` + RAMP + /* wgsl */ `
struct Wv { h: f32, foam: f32 };
// rain rings (Weather 2): a grid of 0.4 cells, each landing a drop every 0.6 s (a downpour) to 1.6 s (a drizzle)
// at its own phase and a hashed point, more cells dropping as the rain grows; a ring spreads into the 2 x 2
// nearest cells. Procedural, so the 48 event rings stay free for splashes, critters and the falls.
fn rainRings(p: vec2f, t: f32) -> vec2f {
  let r = u.weather.x;
  if (r <= 0.0) { return vec2f(0.0); }
  let g = 0.4; let c0 = floor(p / g - 0.5); let P = mix(1.6, 0.6, r);
  var o = vec2f(0.0);
  for (var j = 0; j < 4; j++) {
    let c = c0 + vec2f(f32(j & 1), f32(j >> 1));
    let ph = t / P + hash12(c + 0.37);
    let kd = floor(ph); let age = fract(ph) * P;
    if (hash12(c + vec2f(kd * 0.131, 7.0)) > 0.25 + 0.6 * r) { continue; }
    let at = (c + 0.2 + 0.6 * vec2f(hash12(c + vec2f(kd, 3.0)), hash12(c + vec2f(5.0, kd)))) * g;
    let x = length(p - at) - age * 0.3;
    let env = exp(-age * 3.5) * exp(-x * x * 600.0) * (0.5 + 0.5 * r);
    o += vec2f(env * sin(x * 90.0) * 0.006, env * exp(-age * 6.0) * 0.5);
  }
  return o;
}
fn waves(p: vec2f, fl: vec2f, st: f32, t: f32, rough: f32) -> Wv {
  let sp = mix(0.3, 1.5, st); let per = 3.0;
  let f0 = fract(t / per); let f1 = fract(t / per + 0.5); let k0 = 1.0 - abs(2.0 * f0 - 1.0);
  let o0 = fl * sp * f0 * per; let o1 = fl * sp * f1 * per;
  let h0 = vnoise((p - o0) * 4.5) * 0.6 + vnoise((p - o0) * 10.0 + 3.1) * 0.4;
  let h1 = vnoise((p - o1) * 4.5 + 17.0) * 0.6 + vnoise((p - o1) * 10.0 + 9.3) * 0.4;
  var w: Wv;
  w.h = mix(h1, h0, k0) * mix(0.012, 0.03, st);
  let wd = u.wind.xy;
  w.h += (vnoise(p * vec2f(13.0, 9.0) - wd * t * 1.1) - 0.5) * 0.012 * (0.3 + rough);
  let n = i32(u.water2.x);
  for (var k = 0; k < n; k++) {
    let R = rings[k]; let age = t - R.z;
    let x = length(p - R.xy) - age * 0.42;
    let env = R.w * exp(-age * 1.5) * exp(-x * x * 140.0);
    w.h += env * sin(x * 46.0) * 0.012;
    w.foam += env * exp(-age * 3.0) * sstep(0.4, 1.0, sin(x * 46.0)) * 0.9;
  }
  let rr = rainRings(p, t); w.h += rr.x; w.foam += rr.y;
  return w;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let ds = textureLoad(gD, vec2i(i.pos.xy), 0);
  let thick = max(0.0, i.pos.z - ds) * u.psrc.w / 1.732;
  let t = u.vdir.w;
  let stream = i.f.z; let fl = i.f.xy;
  let rough = select(0.0, sstep(0.45, 1.0, gust(i.w.xy, t) / max(u.wind.z, 1e-3)), u.wind.z > 0.0);
  let e = 0.012;
  let W0 = waves(i.w.xy, fl, stream, t, rough);
  let hx = waves(i.w.xy + vec2f(e, 0.0), fl, stream, t, rough).h; let hy = waves(i.w.xy + vec2f(0.0, e), fl, stream, t, rough).h;
  let n = normalize(vec3f((W0.h - hx) / e, (W0.h - hy) / e, 1.0));
  let sv = textureSampleLevel(sunV, lin, sunUVW(i.w + vec3f(0.0, 0.0, 0.12)), 0.0).r;
  let cook = canopyS(i.w);
  let L = u.sun.xyz; let V = -u.vdir.xyz;
  let s = 0.5 - u.look.x * 0.6 + (u.look.x + u.look.y) * cook * sv * 0.75 - 0.2 * clamp(thick * 2.2, 0.0, 1.0) + (n.z - 0.97) * 2.5 - rough * 0.05;
  var col = rampC(u32(u.ids.y), s);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col = mix(col, rampC(u32(u.ids.x), 0.5), fres * (0.6 - rough * 0.2));
  col += vec3f(1.0, 0.88, 0.62) * pow(max(dot(reflect(-V, n), L), 0.0), mix(110.0, 40.0, rough)) * sv * (0.2 + cook) * 7.0;
  // flow lines: thin streaks carried by the current, broken up so they read as moving water
  let fd = normalize(fl + vec2f(1e-4, 0.0)); let fm = length(fl);
  let streak = vnoise(vec2f(dot(i.w.xy, vec2f(-fd.y, fd.x)) * 15.0, dot(i.w.xy, fd) * 2.2 - t * mix(0.4, 2.0, stream)));
  let lines = sstep(0.68, 0.88, streak) * min(fm, 1.0) * (0.12 + 0.3 * stream);
  let shore = sstep(0.05, 0.0, thick) * (0.5 + 0.5 * vnoise(i.w.xy * 22.0 + vec2f(t * 0.7)));
  let foam = clamp(shore + lines + W0.foam, 0.0, 1.0);
  col = mix(col, rampC(u32(u.ids.z), 0.86 + 0.14 * cook * sv) * (1.0 + cook * sv * 0.4), foam);
  let alpha = clamp(0.3 + 0.55 * (1.0 - exp(-thick * 2.2)) + fres * 0.3, 0.0, 0.9);
  return vec4f(col, max(alpha, foam));
}
`;

  // the water on a map with water looks (T.looks): the vertex carries its look (f.w), a looked quad is drawn
  // by lake() with its kind's clarity, tint, absorb, calm and glint (binding 6), look 0 by the code above.
  // A map without looks compiles W.water as it is, so its frames stay the same byte for byte.
  W.waterL = ME.variant(W.water, [
    [/* wgsl */ `struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) f: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) f: vec3f) -> VO {`, /* wgsl */ `@group(1) @binding(6) var<storage, read> looks: array<vec4f>; // per look: clarity, absorb, calm, glint | tint, caustics
struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) f: vec4f };
@vertex fn vs(@location(0) p: vec3f, @location(1) f: vec4f) -> VO {`],
    [/* wgsl */ `@fragment fn fs(i: VO) -> @location(0) vec4f {
  let ds = textureLoad(gD, vec2i(i.pos.xy), 0);`, /* wgsl */ `// a looked water's ripples: waves() with the flow and the wind slowed and flattened by calm (the rings keep
// the real clock, so their ages stay right)
fn wavesL(p: vec2f, fl: vec2f, st: f32, t: f32, rough: f32, calm: f32) -> Wv {
  let tc = t * (1.0 - 0.7 * calm); let a = 1.0 - 0.75 * calm;
  let sp = mix(0.3, 1.5, st); let per = 3.0;
  let f0 = fract(tc / per); let f1 = fract(tc / per + 0.5); let k0 = 1.0 - abs(2.0 * f0 - 1.0);
  let o0 = fl * sp * f0 * per; let o1 = fl * sp * f1 * per;
  let h0 = vnoise((p - o0) * 4.5) * 0.6 + vnoise((p - o0) * 10.0 + 3.1) * 0.4;
  let h1 = vnoise((p - o1) * 4.5 + 17.0) * 0.6 + vnoise((p - o1) * 10.0 + 9.3) * 0.4;
  var w: Wv;
  w.h = mix(h1, h0, k0) * mix(0.012, 0.03, st) * a;
  w.h += (vnoise(p * vec2f(13.0, 9.0) - u.wind.xy * tc * 1.1) - 0.5) * 0.012 * (0.3 + rough) * a;
  let n = i32(u.water2.x);
  for (var k = 0; k < n; k++) {
    let R = rings[k]; let age = t - R.z;
    let x = length(p - R.xy) - age * 0.42;
    let env = R.w * exp(-age * 1.5) * exp(-x * x * 140.0);
    w.h += env * sin(x * 46.0) * 0.012;
    w.foam += env * exp(-age * 3.0) * sstep(0.4, 1.0, sin(x * 46.0)) * 0.9;
  }
  let rr = rainRings(p, t); w.h += rr.x; w.foam += rr.y;
  return w;
}
// a looked water (a water kind's clarity, tint, absorb, calm, glint): the floor seen through it, tinted toward
// the deep colour with the thickness of water along the view ray, the sky reflected by fresnel, the sun's glint
fn lake(i: VO, li: u32) -> vec4f {
  let L0 = looks[li * 2u]; let L1 = looks[li * 2u + 1u];
  let clar = L0.x; let absorb = max(L0.y, 0.02); let calm = L0.z; let glint = L0.w;
  let ds = textureLoad(gD, vec2i(i.pos.xy), 0);
  let thick = max(0.0, i.pos.z - ds) * u.psrc.w / 1.732;
  let t = u.vdir.w;
  let stream = i.f.z; let fl = i.f.xy;
  let rough = select(0.0, sstep(0.45, 1.0, gust(i.w.xy, t) / max(u.wind.z, 1e-3)), u.wind.z > 0.0) * (1.0 - calm);
  let e = 0.012;
  let W0 = wavesL(i.w.xy, fl, stream, t, rough, calm);
  let hx = wavesL(i.w.xy + vec2f(e, 0.0), fl, stream, t, rough, calm).h; let hy = wavesL(i.w.xy + vec2f(0.0, e), fl, stream, t, rough, calm).h;
  let n = normalize(vec3f((W0.h - hx) / e, (W0.h - hy) / e, 1.0));
  let sv = textureSampleLevel(sunV, lin, sunUVW(i.w + vec3f(0.0, 0.0, 0.12)), 0.0).r;
  let cook = canopyS(i.w);
  let L = u.sun.xyz; let V = -u.vdir.xyz;
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let absb = 1.0 - exp(-thick / absorb);
  let body = clamp(absb + (1.0 - clar) * 0.35 * (1.0 - absb), 0.0, 1.0);
  let deep = L1.rgb * (0.35 + 0.65 * clamp(0.4 + 0.6 * cook * sv, 0.0, 1.0));
  let sky = rampC(u32(u.ids.x), 0.5);
  let spec = vec3f(1.0, 0.88, 0.62) * pow(max(dot(reflect(-V, n), L), 0.0), mix(160.0, 60.0, rough)) * sv * (0.2 + cook) * 7.0 * glint;
  let fd = normalize(fl + vec2f(1e-4, 0.0)); let fm = length(fl);
  let streak = vnoise(vec2f(dot(i.w.xy, vec2f(-fd.y, fd.x)) * 15.0, dot(i.w.xy, fd) * 2.2 - t * mix(0.4, 2.0, stream)));
  let lines = sstep(0.68, 0.88, streak) * min(fm, 1.0) * (0.12 + 0.3 * stream) * (1.0 - 0.8 * calm);
  let shore = sstep(0.05, 0.0, thick) * (0.5 + 0.5 * vnoise(i.w.xy * 22.0 + vec2f(t * 0.7))) * (1.0 - 0.6 * calm);
  let foam = clamp(shore + lines + W0.foam, 0.0, 1.0);
  // premultiplied: the body and the reflection over the floor, the glint added; the blend multiplies back by a
  let a = clamp(body * (1.0 - fres) + fres * 0.9, 0.0, 0.98);
  var col = (deep * body * (1.0 - fres) + sky * fres * 0.9 + spec) / max(a, 1e-3);
  col = mix(col, rampC(u32(u.ids.z), 0.86 + 0.14 * cook * sv) * (1.0 + cook * sv * 0.4), foam);
  return vec4f(col, max(a, foam));
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let li = u32(i.f.w + 0.5);
  if (li != 0u) { return lake(i, li); }
  let ds = textureLoad(gD, vec2i(i.pos.xy), 0);`],
  ]);

  // Falls: ropes of water that wobble sideways as they pour, accelerating streaks, a glassy lip, a ragged
  // sheet edge and boiling foam at the plunge; lit by the canopy. k: its water look's falls gains (speed,
  // foam, thick), 1 each for today's falls, which then draw as before.
  W.falls = W.common + ME.canopyTex(3) + /* wgsl */ `
@group(1) @binding(0) var sunV: texture_3d<f32>;
@group(1) @binding(1) var lin: sampler;
@group(1) @binding(2) var ramps: texture_2d<f32>;
struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) uv: vec4f, @location(2) n: vec3f, @location(3) @interpolate(flat) k: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) uv: vec4f, @location(2) n: vec4f, @location(3) k: vec3f) -> VO {
  var o: VO; o.pos = u.vp * vec4f(p, 1.0); o.w = p; o.uv = uv; o.n = n.xyz; o.k = k; return o;
}
` + RAMP + /* wgsl */ `
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let t = u.vdir.w * i.k.x; let un = i.uv.y; let v = i.uv.z; let dz = i.uv.w - v;
  // falling distance grows ~quadratically, so streaks stretch and speed up towards the bottom
  let fall = dz * (1.0 + dz * 0.8);
  let uu = i.uv.x + 0.035 * sin(fall * 5.0 - t * 4.3 + i.uv.x * 7.0) * sstep(0.0, 0.3, dz);
  let rope = vnoise(vec2f(uu * 5.0, fall * 0.5 - t * 1.6));
  let str = vnoise(vec2f(uu * 9.0, fall * 1.1 - t * 3.0)) * 0.5 + vnoise(vec2f(uu * 23.0, fall * 2.4 - t * 4.2)) * 0.3 + rope * 0.2;
  var s = 0.7 + 0.6 * (str - 0.5) + sstep(0.55, 0.8, rope) * 0.12;
  if (dz < 0.07) { s = max(s, 0.86 + (vnoise(vec2f(uu * 12.0, t)) - 0.5) * 0.1); }
  // the plunge foam: a foam gain above 1 makes the band taller and whiter
  let foamH = (0.16 + 0.12 * vnoise(vec2f(uu * 18.0, t * 2.3)) + 0.05 * sin(t * 6.0 + uu * 30.0)) * i.k.y;
  if (v < foamH) { s = 0.82 + vnoise(vec2f(uu * 40.0, v * 40.0 - t * 9.0)) * 0.12 + vnoise(vec2f(uu * 90.0 + t * 3.0, v * 70.0)) * 0.06 + max(0.0, i.k.y - 1.0) * 0.08; }
  let sv = textureSampleLevel(sunV, lin, sunUVW(i.w + i.n * 0.2), 0.0).r;
  let cook = canopyS(i.w);
  s += -0.22 + 0.45 * cook * sv;
  let col = rampC(u32(u.ids.z), s) * (1.0 + max(0.0, s - 0.85) * 2.2);
  // ragged sides that flicker as the sheet breaks up
  let rag = 0.1 + 0.08 * vnoise(vec2f(fall * 3.0 - t * 2.5, un * 3.0));
  let edge = sstep(0.0, rag, un) * sstep(1.0, 1.0 - rag, un);
  return vec4f(col, min(1.0, (0.68 + 0.32 * str) * i.k.z) * edge);
}
`;

  // Fireflies (blinking, HDR so they bloom) and mist puffs at the plunge pools, as additive billboards.
  W.sparks = W.common + /* wgsl */ `
struct Pt { p: vec4f, v: vec4f };
@group(1) @binding(0) var<storage, read> pts: array<Pt>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) c: vec4f };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let P = pts[ii];
  var q = QUAD; let c = q[vi];
  var o: VO; o.uv = c; o.c = vec4f(0.0);
  if (P.p.w <= 0.0) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  let fly = ii < u32(u.part.x + u.part.y);
  let t = u.vdir.w; let seed = P.v.w;
  var size = 0.05; var col = vec4f(0.0);
  if (fly) {
    let blink = pow(max(0.0, sin(t * (1.3 + seed * 1.7) + seed * 40.0)), 3.0);
    col = vec4f(vec3f(0.85, 1.0, 0.4) * (0.15 + 4.0 * blink), 1.0);
  } else if (((ii - u32(u.part.x + u.part.y)) & 1u) == 0u) {
    // spray droplet: a tiny bright bead fading as it falls back
    size = 0.018;
    col = vec4f(vec3f(0.9, 0.97, 1.0) * 1.4 * clamp(P.p.w * 2.0, 0.0, 1.0), 1.0);
  } else {
    let age = clamp(1.0 - P.p.w / 3.0, 0.0, 1.0);
    size = 0.1 + age * 0.28;
    col = vec4f(vec3f(0.8, 0.92, 0.9) * 0.06 * sin(age * 3.14159), 0.0);
  }
  let right = normalize(u.ivp[0].xyz); let up = normalize(u.ivp[1].xyz);
  o.pos = u.vp * vec4f(P.p.xyz + (right * c.x + up * c.y) * size, 1.0);
  o.c = col;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let k = select(exp(-r2 * 2.5), exp(-r2 * 9.0) + 0.15 * exp(-r2 * 2.0), i.c.w > 0.5);
  return vec4f(i.c.rgb * k, 0.0);
}
`;

  // The rim spill's spray (W6): each particle after the mist is an axis-aligned voxel cube, water-tinted or
  // white foam, that shrinks and fades below the plinth (its sources as in W.partsim's spray)
  W.spray = W.common + /* wgsl */ `
struct Pt { p: vec4f, v: vec4f };
@group(1) @binding(0) var<storage, read> pts: array<Pt>;
@group(1) @binding(1) var<storage, read> srcs: array<vec4f>;
@group(1) @binding(2) var ramps: texture_2d<f32>;
@group(1) @binding(3) var lin: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) c: vec4f };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
` + RAMP + /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let P = pts[ii];
  var o: VO; o.c = vec4f(0.0); o.pos = vec4f(2.0, 2.0, 0.0, 1.0);
  // six faces of six vertices; a face turned away from the view is dropped (the cubes blend, so their
  // backs would show through)
  let f = vi / 6u; let ax = f / 2u; let sg = select(-1.0, 1.0, (f & 1u) == 1u);
  var nrm = vec3f(0.0); nrm[ax] = sg;
  if (P.p.w <= 0.0 || dot(P.v.xyz, P.v.xyz) == 0.0 || dot(nrm, u.vdir.xyz) > 0.0) { return o; }
  let so = u32(u.look4.w) + 4u * u32(P.v.w);
  let B = srcs[so + 1u]; let C = srcs[so + 2u]; let D = srcs[so + 3u];
  let below = clamp((D.y - P.p.z) / B.w, 0.0, 1.0);
  let fade = (1.0 - below) * clamp(P.p.w * 3.0, 0.0, 1.0);
  if (fade <= 0.0) { return o; }
  let seed = fract(P.v.w);
  let foam = fract(seed * 7.31) < C.w;
  let size = D.x * (0.6 + 0.8 * fract(seed * 13.7)) * (1.0 - 0.5 * below);
  var q = QUAD; let c = q[vi % 6u];
  var l = vec3f(c, sg);
  if (ax == 0u) { l = vec3f(sg, c); } else if (ax == 1u) { l = vec3f(c.x, sg, c.y); }
  o.pos = u.vp * vec4f(P.p.xyz + l * size * 0.5, 1.0);
  // lit from the sun's side; the falls' ramp sets the brightness (so it dims at night), C.rgb the water's hue
  let lam = 0.55 + 0.45 * max(0.0, dot(nrm, u.sun.xyz));
  let w = vec3f(0.3, 0.5, 0.2);
  let water = C.rgb * (dot(rampC(u32(u.ids.z), 0.6), w) / max(dot(C.rgb, w), 0.02));
  o.c = vec4f(select(water, rampC(u32(u.ids.z), 0.95), foam) * lam, select(0.85, 0.95, foam) * fade);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return i.c; }
`;

  // App sprites written by the CPU each frame (Renderer.sprites, ME.SpriteBatch): one storage entry per
  // sprite, a = position + size, b = second point (or bar size in pixels + fill) + kind, c = colour *
  // intensity. Kinds (ME.SPRITE) 0-5 are additive and depth tested: 0 glow orb, 1 ring, 2 beam, 3 streak,
  // 4 puff, 5 ground ring. Kind 10 is an alpha-blended gauge bar drawn over everything, sized in render pixels.
  W.sprites = W.common + /* wgsl */ `
struct Sp { a: vec4f, b: vec4f, c: vec4f };
@group(1) @binding(0) var<storage, read> sps: array<Sp>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) c: vec4f, @location(2) @interpolate(flat) k: vec2f };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let S = sps[ii]; let kind = u32(S.b.w + 0.5);
  var q = QUAD; let c = q[vi];
  var o: VO; o.uv = c; o.c = S.c; o.k = vec2f(f32(kind), S.b.z);
  let right = normalize(u.ivp[0].xyz); let up = normalize(u.ivp[1].xyz);
  if (kind == 2u || kind == 3u) {
    let ax = S.b.xyz - S.a.xyz;
    let side = normalize(cross(ax, u.vdir.xyz) + vec3f(1e-5, 0.0, 0.0));
    o.pos = u.vp * vec4f(mix(S.a.xyz, S.b.xyz, c.y * 0.5 + 0.5) + side * c.x * S.a.w, 1.0);
  } else if (kind == 5u) {
    o.pos = u.vp * vec4f(S.a.xyz + vec3f(c * S.a.w, 0.0), 1.0);
  } else if (kind == 10u) {
    let p = u.vp * vec4f(S.a.xyz, 1.0);
    o.pos = vec4f(p.xy + c * S.b.xy * u.res.zw * 2.0 * p.w, p.w, p.w);
  } else {
    o.pos = u.vp * vec4f(S.a.xyz + (right * c.x + up * c.y) * S.a.w, 1.0);
  }
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let kind = u32(i.k.x + 0.5); let r2 = dot(i.uv, i.uv);
  if (kind == 10u) {
    // gauge bar: a dark slot with a 1-ish pixel rim, filled from the left
    let x = i.uv.x * 0.5 + 0.5;
    let rim = max(abs(i.uv.x), abs(i.uv.y)) > 0.72;
    if (rim) { return vec4f(0.06, 0.05, 0.04, 0.85); }
    if (x <= i.k.y) { return vec4f(i.c.rgb * (0.85 + 0.25 * (1.0 - abs(i.uv.y))), 1.0); }
    return vec4f(0.16, 0.13, 0.12, 0.8);
  }
  var k = 0.0;
  switch kind {
    case 0u: { if (r2 > 1.0) { discard; } k = exp(-r2 * 4.0) * 0.8 + exp(-r2 * 18.0) * 1.6; }
    case 1u, 5u: { let r = sqrt(r2); if (r > 1.0) { discard; } k = exp(-pow((r - 0.8) / 0.11, 2.0)); }
    case 2u: { let a = i.uv.x * i.uv.x; k = (exp(-a * 5.0) * 0.6 + exp(-a * 40.0) * 1.4) * sstep(1.0, 0.8, abs(i.uv.y)); }
    case 3u: { let a = i.uv.x * i.uv.x; k = exp(-a * 9.0) * (i.uv.y * 0.5 + 0.5); }
    default: { if (r2 > 1.0) { discard; } k = (1.0 - r2) * (1.0 - r2) * 0.6; }
  }
  return vec4f(i.c.rgb * k * i.c.a, 0.0);
}
`;

  // Bell-jar glass: additive fresnel sheen, two soft window reflections and a bright rim.
  W.glass = W.common + /* wgsl */ `
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) w: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> VO { var o: VO; o.pos = u.vp * vec4f(p, 1.0); o.n = n; o.w = p; return o; }
// rain on the glass (Weather 2), on its surface in arc length around the centre by height: beads in a fine
// grid, and drops running down columns of it at their own pace with a short trail above the head, more of
// both as the rain grows. The caller weights it toward grazing angles, where water on glass catches light.
fn glassRain(w: vec3f) -> f32 {
  let r = u.weather.x;
  if (r <= 0.0) { return 0.0; }
  let d = w.xy - u.geo.xy;
  let s = atan2(d.y, d.x) * max(u.geo.z, 0.5); let t = u.vdir.w;
  let bq = vec2f(s, w.z) / 0.07; let bc = floor(bq); let bh = hash12(bc + 11.0);
  let bo = fract(bq) - (0.25 + 0.5 * vec2f(hash12(bc + 2.0), hash12(bc + 5.0)));
  let bead = sstep(0.12 + 0.1 * bh, 0.04, length(bo)) * step(bh, 0.4 * r);
  let cw = 0.11; let col = floor(s / cw); let hc = hash12(vec2f(col, 41.0));
  let P = 2.5 + 4.0 * hc; let ph = t / P + hc; let cyc = floor(ph);
  let H = max(u.geo.w - u.misc2.z, 0.5);
  let zd = u.geo.w - fract(ph) * H * 1.15;
  let on = step(hash12(vec2f(col, cyc + 3.0)), 0.55 * r);
  let dx = (fract(s / cw) - 0.3 - 0.4 * hash12(vec2f(col, cyc))) * cw;
  let dz = w.z - zd;
  let head = sstep(0.022, 0.008, length(vec2f(dx, dz * 0.7)));
  let trail = sstep(0.008, 0.002, abs(dx)) * sstep(0.0, 0.02, dz) * sstep(0.4, 0.0, dz) * 0.5;
  return bead * 0.45 + max(head, trail) * on;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let V = -u.vdir.xyz; var n = normalize(i.n);
  let nd = dot(n, V); let front = nd > 0.0;
  if (!front) { n = -n; }
  let ndv = abs(nd);
  let fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  let right = normalize(u.ivp[0].xyz); let up = normalize(u.ivp[1].xyz);
  let n2 = normalize(vec2f(dot(n, right), dot(n, up)) + vec2f(1e-4));
  var win = sstep(0.93, 0.99, dot(n2, normalize(vec2f(0.55, 0.83)))) * 0.8 + sstep(0.97, 0.997, dot(n2, normalize(vec2f(-0.3, 0.95)))) * 0.35;
  win *= (0.2 + 0.8 * (1.0 - ndv)) * select(0.0, 1.0, front);
  let rim = pow(1.0 - ndv, 7.0) * 0.3;
  let base = select(0.3, 1.0, front);
  let wet = glassRain(i.w) * (0.25 + 0.75 * (1.0 - ndv)) * 0.3;
  return vec4f(vec3f(0.92, 0.98, 0.9) * (fres * 0.22 + win * 0.16 + rim + wet) * base * u.misc.x, 0.0);
}
`;

  // Particle sim: leaves fall with flutter and settle on the voxels, fireflies wander near their
  // towers and the water, mist rises from the plunge pools.
  W.partsim = W.common + /* wgsl */ `
struct Pt { p: vec4f, v: vec4f };
@group(1) @binding(0) var<storage, read_write> pts: array<Pt>;
@group(1) @binding(1) var<storage, read> srcs: array<vec4f>;
@group(1) @binding(2) var dens: texture_3d<f32>;
@group(1) @binding(3) var lin: sampler;
fn rnd(i: u32, k: f32) -> f32 { return hash12(vec2f(f32(i) * 0.731 + k * 1.37, fract(u.vdir.w * 0.0137) * 911.0 + k * 3.1)); }
// a rim spill's spray (W6), its four sources at look4.w + 4 * floor(seed) (Renderer.buildParticles): voxels
// leave the sheet's foot on the plinth, skip on its top, fly off its edge and fall into the void, scattering
fn spray(i: u32, P: ptr<function, Pt>, dt: f32) {
  let o = u32(u.look4.w) + 4u * u32((*P).v.w);
  let A = srcs[o]; let B = srcs[o + 1u]; let D = srcs[o + 3u];
  let n = B.xy; let tg = vec2f(-n.y, n.x);
  if ((*P).p.w <= 0.0) {
    let side = (rnd(i, 1.0) * 2.0 - 1.0) * A.w; let out = 0.4 + rnd(i, 2.0) * 0.9;
    (*P).p = vec4f(A.xy + tg * side + n * 0.03, A.z + 0.02 + rnd(i, 3.0) * 0.06, 1.2 + rnd(i, 4.0) * 1.6);
    (*P).v = vec4f(n * out + tg * (rnd(i, 6.0) - 0.5) * 0.5, 0.25 + rnd(i, 7.0) * 0.7, floor((*P).v.w) + rnd(i, 5.0) * 0.999);
    return;
  }
  var p = (*P).p.xyz; var v = (*P).v.xyz;
  if (dot(v, v) == 0.0) { return; } // parked at the start, its wait running down
  v.z -= 3.6 * dt;
  // below the plinth the air takes them apart: a slow sideways scatter and some drag
  let below = clamp((D.y - p.z) / max(B.w, 0.1), 0.0, 1.0);
  let sd = fract((*P).v.w) * 97.0;
  v = vec3f(v.xy + vec2f(sin(sd + p.z * 3.1), cos(sd * 1.7 + p.z * 2.3)) * below * 1.4 * dt, v.z * (1.0 - below * 0.6 * dt));
  p += v * dt;
  // on the plinth's top (less than B.z past the foot): a skip that loses most of the speed
  if (p.z < A.z && (*P).p.z >= A.z && dot(p.xy - A.xy, n) < B.z) { p.z = A.z; v = vec3f(v.xy * 0.75, abs(v.z) * 0.35); }
  var life = (*P).p.w;
  if (p.z < D.y - B.w * 1.2) { life = 0.0; }
  (*P).p = vec4f(p, life); (*P).v = vec4f(v, (*P).v.w);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  let nLeaf = u32(u.part.x); let nFly = u32(u.part.y); let nMist = u32(u.part.z);
  if (i >= nLeaf + nFly + nMist + u32(u.look4.z)) { return; }
  var P = pts[i];
  let dt = u.part.w; let t = u.vdir.w;
  P.p.w -= dt;
  let nls = max(u32(u.psrc.x), 1u); let nfs = max(u32(u.psrc.y), 1u); let nms = max(u32(u.psrc.z), 1u);
  if (i < nLeaf) {
    if (P.p.w <= 0.0) {
      let s = srcs[i % nls];
      let a = rnd(i, 1.0) * 6.283; let r = sqrt(rnd(i, 2.0)) * s.w;
      P.p = vec4f(s.x + cos(a) * r, s.y + sin(a) * r, s.z - rnd(i, 3.0) * 0.5, 6.0 + rnd(i, 4.0) * 8.0);
      P.v = vec4f(0.0, 0.0, -0.2, rnd(i, 5.0));
    } else if (dot(P.v.xyz, P.v.xyz) > 1e-8) {
      let uvw = (P.p.xyz - u.grid.xyz) * u.grid.w / u.dims.xyz;
      if (textureSampleLevel(dens, lin, uvw, 0.0).r > 0.5) {
        P.v = vec4f(0.0, 0.0, 0.0, P.v.w);
      } else {
        let seed = P.v.w;
        let g = gust(P.p.xy, t);
        let drift = u.wind.xy * (0.06 + 0.42 * g);
        P.v = vec4f(sin(t * 1.7 + seed * 40.0) * 0.2 + drift.x, cos(t * 1.3 + seed * 23.0) * 0.16 + drift.y, -0.21 - 0.07 * sin(t * 2.3 + seed * 9.0) + 0.08 * g, seed);
        P.p = vec4f(P.p.xyz + P.v.xyz * dt, P.p.w);
      }
    }
  } else if (i < nLeaf + nFly) {
    let s = srcs[nls + (i - nLeaf) % nfs];
    if (P.p.w <= 0.0) {
      P.p = vec4f(s.x + (rnd(i, 1.0) - 0.5) * s.w, s.y + (rnd(i, 2.0) - 0.5) * s.w, s.z + rnd(i, 3.0) * 0.9, 4.0 + rnd(i, 4.0) * 6.0);
      P.v = vec4f(0.0, 0.0, 0.01, rnd(i, 5.0));
    } else {
      let seed = P.v.w;
      let w = vec3f(sin(t * 0.9 + seed * 31.0), cos(t * 0.7 + seed * 17.0), sin(t * 1.3 + seed * 11.0) * 0.5) * 0.28;
      let pull = (vec3f(s.x, s.y, s.z + 0.5) - P.p.xyz) * 0.25;
      P.v = vec4f(w + pull, seed);
      P.p = vec4f(P.p.xyz + P.v.xyz * dt, P.p.w);
    }
  } else if (i >= nLeaf + nFly + nMist) {
    spray(i, &P, dt);
  } else {
    // plunge pools: every other particle is a spray droplet thrown up and pulled back by gravity
    let mi = i - nLeaf - nFly; let isDrop = (mi & 1u) == 0u;
    let s = srcs[nls + nfs + mi % nms];
    if (P.p.w <= 0.0) {
      if (isDrop) {
        let a = rnd(i, 6.0) * 6.283; let sp = 0.2 + rnd(i, 7.0) * 0.45;
        P.p = vec4f(s.x + (rnd(i, 1.0) - 0.5) * s.w, s.y + (rnd(i, 2.0) - 0.5) * s.w, s.z + 0.03, 0.45 + rnd(i, 4.0) * 0.5);
        P.v = vec4f(cos(a) * sp, sin(a) * sp, 0.6 + rnd(i, 8.0) * 0.7, rnd(i, 5.0));
      } else {
        P.p = vec4f(s.x + (rnd(i, 1.0) - 0.5) * s.w, s.y + (rnd(i, 2.0) - 0.5) * s.w, s.z + 0.02, 1.5 + rnd(i, 4.0) * 1.5);
        P.v = vec4f((rnd(i, 6.0) - 0.5) * 0.25, (rnd(i, 7.0) - 0.5) * 0.25, 0.16 + rnd(i, 8.0) * 0.12, rnd(i, 5.0));
      }
    } else {
      if (isDrop) { P.v.z -= 3.0 * dt; }
      P.p = vec4f(P.p.xyz + P.v.xyz * dt, P.p.w);
    }
  }
  pts[i] = P;
}
`;
})();
