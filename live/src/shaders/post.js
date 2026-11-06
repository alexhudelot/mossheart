/* Post: 3-level bloom (13-tap down, tent up), then composite: shafts in the beam colour, haze,
   a soft shoulder that keeps the palette exact below it, vignette, sRGB. Debug views live here too. */
(function () {
  const ME = window.ME, W = ME.wgsl;

  W.bloomDown = W.common + ME.FS_VS + /* wgsl */ `
@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var lin: sampler;
override FIRST: bool = false;
fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, lin, uv, 0.0).rgb; }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  let uv = fc.xy * 2.0 * ts;
  var c = (s(uv + ts * vec2f(-1.0, -1.0)) + s(uv + ts * vec2f(1.0, -1.0)) + s(uv + ts * vec2f(-1.0, 1.0)) + s(uv + ts * vec2f(1.0, 1.0))) * 0.125
        + (s(uv + ts * vec2f(-2.0, -2.0)) + s(uv + ts * vec2f(2.0, -2.0)) + s(uv + ts * vec2f(-2.0, 2.0)) + s(uv + ts * vec2f(2.0, 2.0))) * 0.03125
        + (s(uv + ts * vec2f(0.0, -2.0)) + s(uv + ts * vec2f(-2.0, 0.0)) + s(uv + ts * vec2f(2.0, 0.0)) + s(uv + ts * vec2f(0.0, 2.0))) * 0.0625
        + s(uv) * 0.125;
  if (FIRST) {
    let br = max(c.r, max(c.g, c.b)); let th = u.misc2.w; let kn = th * 0.5;
    var rq = clamp(br - th + kn, 0.0, 2.0 * kn); rq = rq * rq / (4.0 * kn + 1e-4);
    c *= max(rq, br - th) / max(br, 1e-4);
  }
  return vec4f(c, 1.0);
}
`;
  W.bloomUp = W.common + ME.FS_VS + /* wgsl */ `
@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var lin: sampler;
fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, lin, uv, 0.0).rgb; }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  let uv = fc.xy * 0.5 * ts;
  let c = (s(uv + ts * vec2f(-1.0, -1.0)) + s(uv + ts * vec2f(1.0, -1.0)) + s(uv + ts * vec2f(-1.0, 1.0)) + s(uv + ts * vec2f(1.0, 1.0))
        + 2.0 * (s(uv + ts * vec2f(0.0, -1.0)) + s(uv + ts * vec2f(-1.0, 0.0)) + s(uv + ts * vec2f(1.0, 0.0)) + s(uv + ts * vec2f(0.0, 1.0)))
        + 4.0 * s(uv)) / 16.0;
  return vec4f(c * select(1.0, 1.0, u.res.x > 0.0), 1.0); // keeps u in the auto layout (group 0 is bound for every pipeline)
}
`;

  W.composite = W.common + ME.FS_VS + /* wgsl */ `
@group(1) @binding(0) var hdr: texture_2d<f32>;
@group(1) @binding(1) var bloomT: texture_2d<f32>;
@group(1) @binding(2) var shaftT: texture_2d<f32>;
@group(1) @binding(3) var lin: sampler;
@group(1) @binding(4) var gA: texture_2d<f32>;
@group(1) @binding(5) var gN: texture_2d<f32>;
@group(1) @binding(6) var gD: texture_depth_2d;
@group(1) @binding(7) var sunV: texture_3d<f32>;
fn toSrgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn shoulder(x: vec3f) -> vec3f { let k = 0.8; return select(k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), x, x <= vec3f(k)); }
fn heat(x: f32) -> vec3f { let t = clamp(x, 0.0, 1.0); return clamp(vec3f(1.5 * t, 1.5 * (1.0 - abs(t - 0.5) * 2.0) + 0.1 * (1.0 - t), 1.2 * (1.0 - t * 1.6)), vec3f(0.0), vec3f(1.0)); }
// Rain (Weather 2): streak layers at fixed view depths, 1 at a drizzle to 3 in a downpour (u.weather4.x caps
// them, R.rainLayers: 2 on compat, 1 on a phone), each fading in over its third of the rain channel. A layer is a grid of
// columns in the camera's right and up axes at its world point (so the streaks stay with the world as the
// view pans and grow as it zooms in), one hashed drop per cell falling down the screen and slanting with the
// wind. It shows only in front of the scene (reverse Z: its depth above the scene's) and is lit by the sun
// volume at its point: the haze colour where the sky reaches it, the sun's where the sun does.
fn rain(uv: vec2f, sd: f32) -> vec3f {
  let r = u.weather.x;
  let n = min(i32(ceil(r * 3.0 - 0.01)), i32(u.weather4.x));
  if (n <= 0) { return vec3f(0.0); }
  let right = normalize(u.ivp[0].xyz); let up = normalize(u.ivp[1].xyz);
  let wpp = length(u.ivp[0].xyz) * 2.0 * u.outres.z; // world units per canvas pixel
  let wd = vec3f(u.wind.xy, 0.0) * (0.35 + 1.4 * u.weather3.w);
  let slant = dot(wd, right) * 0.45;
  let t = u.vdir.w;
  var acc = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let fi = f32(i);
    let ld = 0.8 - fi * 0.24; // near to far
    if (ld <= sd) { continue; }
    let k = clamp(r * 3.0 - fi, 0.0, 1.0);
    let P = (u.ivp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, ld, 1.0)).xyz;
    let sc = 1.0 - fi * 0.22; // far layers: thinner, shorter, slower
    let cw = 0.16 * sc; let ch = mix(0.9, 1.5, r) * sc;
    let y = dot(P, up); let x = dot(P, right) + y * slant;
    let col = floor(x / cw); let h = hash12(vec2f(col, fi * 17.0 + 3.0));
    let yy = (y + t * (5.5 + 2.5 * h) * sc) / ch + h * 13.0;
    let cell = floor(yy); let fy = fract(yy);
    let h2 = hash12(vec2f(col + 31.0 * fi, cell));
    if (h2 > 0.3 + 0.45 * r) { continue; }
    let len = mix(0.22, 0.5, r) * (0.7 + 0.6 * h2);
    let dx = (fract(x / cw) - (0.25 + 0.5 * hash12(vec2f(cell, col + 7.0)))) * cw;
    let w = 0.006 * sc;
    let ax = sstep(w + wpp, 0.0, abs(dx)) * min(1.0, w / wpp + 0.25);
    let ay = sstep(0.0, 0.06, fy) * sstep(len, len * 0.45, fy) * (0.45 + 0.55 * sstep(len, 0.0, fy));
    let a = ax * ay * k;
    if (a <= 0.002) { continue; }
    let sv = textureSampleLevel(sunV, lin, sunUVW(P), 0.0);
    // (out of the sky's reach the haze colour goes to a blue-grey of its brightness: a warm haze tinted the
    // streaks under the canopy tan)
    let hz = mix(vec3f(dot(u.fog.rgb, vec3f(0.3, 0.5, 0.2))) * vec3f(0.86, 0.96, 1.16), u.fog.rgb, sv.g);
    acc += (hz * (0.35 + 0.65 * sv.g) * 0.5 + pow(u.beamCol.rgb, vec3f(1.6)) * sv.r * 0.35 + vec3f(0.027, 0.03, 0.034)) * a;
  }
  return acc * 0.7;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * u.outres.zw;
  let mode = i32(u.look3.x + 0.5);
  if (mode > 0) {
    let px = min(vec2i(uv * u.res.xy), vec2i(u.res.xy) - 1);
    let d = textureLoad(gD, px, 0);
    let A = textureLoad(gA, px, 0); let N = textureLoad(gN, px, 0);
    let p = (u.ivp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0)).xyz;
    let n = octDec(N.xy);
    var c = vec3f(0.05);
    if (d > 0.0) {
      switch mode {
        case 1: { c = toSrgb(A.rgb); }
        case 2: { c = n * 0.5 + 0.5; }
        case 3: { c = vec3f(A.a * mix(1.0, textureSampleLevel(sunV, lin, sunUVW(p + n * 0.2), 0.0).g, 0.65)); }
        case 4: { c = vec3f(fract(d * 40.0) * 0.3 + d * 0.7); }
        case 5: { let sv = textureSampleLevel(sunV, lin, sunUVW(p + n * 0.2), 0.0); c = vec3f(sv.r, sv.g * 0.6, 0.15); }
        case 6: { c = select(vec3f(0.12), heat((N.w - floor(N.w / 1000.0) * 1000.0) / 96.0), N.w >= 1.0); }
        default: { c = vec3f(canopy(p, true)); }
      }
    }
    return vec4f(c, 1.0);
  }
  var c = textureSampleLevel(hdr, lin, uv, 0.0).rgb;
  c += textureSampleLevel(bloomT, lin, uv, 0.0).rgb * u.look3.z;
  c += pow(u.beamCol.rgb, vec3f(1.6)) * textureSampleLevel(shaftT, lin, uv, 0.0).r * u.look3.y;
  c = mix(c, u.fog.rgb, u.fog.w);
  if (u.weather.x > 0.0) { c += rain(uv, textureLoad(gD, min(vec2i(uv * u.res.xy), vec2i(u.res.xy) - 1), 0)); }
  c = shoulder(c * u.look3.w);
  let q = (uv - 0.5) * vec2f(1.0, 0.86);
  c *= 1.0 - u.beamCol.w * pow(clamp(length(q) * 1.3, 0.0, 1.0), 2.4);
  return vec4f(toSrgb(clamp(c, vec3f(0.0), vec3f(1.0))), 1.0);
}
`;
})();
