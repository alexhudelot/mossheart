/* G-buffer passes. All three voxel forms write the same targets:
   location 0 = albedo (rgba8unorm-srgb, a = AO), location 1 = oct normal xy, material id, aux
   (aux: 0 terrain, 1+steps for ray-marched volumes, +1000 for units, -1 for leaves). */
(function () {
  const ME = window.ME, W = ME.wgsl;

  // Greedy-meshed terrain. Normals come from the occupancy mip gradient (rounds every lip, the
  // generator's st.bevel), AO from occupancy sampled along the normal, voxel grain from a hash.
  W.terrain = W.common + /* wgsl */ `
@group(1) @binding(0) var dens: texture_3d<f32>;
@group(1) @binding(1) var lin: sampler;
@group(1) @binding(2) var<storage, read> mats: array<vec4f>;

struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) @interpolate(flat) dm: u32 };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f };

@vertex fn vs(@location(0) v: vec4u) -> VO {
  var o: VO;
  let p = vec3f(v.xyz) / u.grid.w + u.grid.xyz;
  o.pos = u.vp * vec4f(p, 1.0); o.w = p; o.dm = v.w;
  return o;
}
fn dens3(t: vec3f, lod: f32) -> f32 { return textureSampleLevel(dens, lin, t / u.dims.xyz, lod).r; }
fn faceN(d: u32) -> vec3f {
  switch d {
    case 0u: { return vec3f(1.0, 0.0, 0.0); }
    case 1u: { return vec3f(-1.0, 0.0, 0.0); }
    case 2u: { return vec3f(0.0, 1.0, 0.0); }
    case 3u: { return vec3f(0.0, -1.0, 0.0); }
    default: { return vec3f(0.0, 0.0, 1.0); }
  }
}
@fragment fn fs(i: VO) -> GO {
  let mat = i.dm >> 3u;
  let fnm = faceN(i.dm & 7u);
  let tv = (i.w - u.grid.xyz) * u.grid.w;
  let vox = floor(tv - fnm * 0.5);
  // tetrahedral gradient: 4 taps instead of 6 central differences (same scale: 2h per axis)
  let h = 0.87; let ka = vec3f(1.0, -1.0, -1.0); let kb = vec3f(-1.0, -1.0, 1.0); let kc = vec3f(-1.0, 1.0, -1.0); let kd = vec3f(1.0);
  let g = (ka * dens3(tv + ka * h, 0.0) + kb * dens3(tv + kb * h, 0.0) + kc * dens3(tv + kc * h, 0.0) + kd * dens3(tv + kd * h, 0.0)) * 0.5;
  var n = fnm;
  let gl = length(g);
  if (gl > 0.01) {
    n = normalize(mix(fnm, -g / gl, u.look2.x * sstep(0.01, 0.08, gl)));
    if (dot(n, fnm) < 0.2) { n = fnm; }
  }
  let o1 = dens3(tv + n * 2.2, 0.0);
  let o2 = dens3(tv + n * 5.0, 1.0);
  let ao = clamp(1.0 - 1.1 * max(0.0, o1 - 0.04) - 0.9 * max(0.0, o2 - 0.03), 0.12, 1.0);
  let m0 = mats[mat * 2u]; let m1 = mats[mat * 2u + 1u];
  let cls = u32(m1.w + 0.5);
  var jit = (hash13(vox) - 0.5) * m1.y;
  if (cls == 5u) { jit += (hash13(floor(vox / vec3f(7.0, 7.0, 5.0)) + 3.1) - 0.5) * 0.35; }
  if (cls == 1u) { jit += (fbm2(i.w.xy * 3.0 + vec2f(i.w.z)) - 0.5) * 0.22; }
  var o: GO;
  o.a = vec4f(m0.rgb * max(0.2, 1.0 + jit), ao);
  o.n = vec4f(octEnc(n), f32(mat), 0.0);
  return o;
}
`;
  // The variant drawn once the app has carved terrain voxels (Renderer.carve): faces of carved cells go.
  W.terrainCarve = W.terrain.replace("@fragment fn fs(i: VO) -> GO {", "@group(1) @binding(3) var<storage, read> carved: array<u32>;\n@fragment fn fs(i: VO) -> GO {")
    .replace("let vox = floor(tv - fnm * 0.5);", "let vox = floor(tv - fnm * 0.5);\n  let vi = vec3i(vox); let ci = u32((vi.z * i32(u.dims.y) + vi.y) * i32(u.dims.x) + vi.x);\n  if (((carved[ci >> 5u] >> (ci & 31u)) & 1u) != 0u) { discard; }");
  if (!W.terrainCarve.includes("discard")) throw new Error("terrainCarve: the terrain shader changed");

  // Ray-marched voxel volumes on instanced proxy boxes: two-level DDA (8^3 bricks, then voxels) in the
  // model's local voxel space, writing the true hit depth. Instances carry an affine transform, so
  // flips, yaw, squash and wind shear cost nothing extra.
  W.volume = W.common + /* wgsl */ `
struct Inst { a0: vec4f, a1: vec4f, a2: vec4f, b0: vec4f, b1: vec4f, b2: vec4f, info: vec4u };
// base.xyz the atlas corner, base.w the voxels' low bound lo (10 bits an axis), dims.xyz their high bound hi,
// dims.w the 2x-down copy's entry (0 none): the proxy box spans lo..hi, not the model's whole box.
// ext.x 1 + the entry this one dissolves in from (0 none: R.swapModel), ext.y the fade (f32 bits, 0..1: the
// share of pixels already drawn from this entry); off maps that entry's voxels l to this one's: (l + off.xyz) * off.w
struct Model { base: vec4u, dims: vec4u, ext: vec4u, off: vec4f };
@group(1) @binding(0) var pool: texture_3d<f32>;   // occupied 8^3 bricks, S x S per layer (S 16 or 32: its width / 8)
@group(1) @binding(1) var bricks: texture_3d<u32>; // per brick of the layout: bits 24..31 its occupied 4^3 octants, 0 for none (empty, or an interior brick the CPU keeps: bake-models.js); bits 0..23 1 + its pool slot
@group(1) @binding(2) var<storage, read> insts: array<Inst>;
@group(1) @binding(3) var<storage, read> models: array<Model>;
@group(1) @binding(4) var<storage, read> mats: array<vec4f>;

struct VO { @builtin(position) pos: vec4f, @location(0) l: vec3f, @location(1) @interpolate(flat) ii: u32, @location(2) @interpolate(flat) mk: vec2u };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) e: vec4f, @builtin(frag_depth) depth: f32 };
// a marked instance's look (the app's hookMark, or hookMarkAlb with the albedo): albedo tint (a = mix) and emitted light
struct Mark { tint: vec4f, emit: vec3f };
//#hooks mark markAlb

const CUBE = array<vec3f, 36>(
  vec3f(0,0,0), vec3f(0,1,0), vec3f(0,1,1), vec3f(0,0,0), vec3f(0,1,1), vec3f(0,0,1),
  vec3f(1,0,0), vec3f(1,1,1), vec3f(1,1,0), vec3f(1,0,0), vec3f(1,0,1), vec3f(1,1,1),
  vec3f(0,0,0), vec3f(1,0,1), vec3f(1,0,0), vec3f(0,0,0), vec3f(0,0,1), vec3f(1,0,1),
  vec3f(0,1,0), vec3f(1,1,0), vec3f(1,1,1), vec3f(0,1,0), vec3f(1,1,1), vec3f(0,1,1),
  vec3f(0,0,0), vec3f(1,0,0), vec3f(1,1,0), vec3f(0,0,0), vec3f(1,1,0), vec3f(0,1,0),
  vec3f(0,0,1), vec3f(1,1,1), vec3f(1,0,1), vec3f(0,0,1), vec3f(0,1,1), vec3f(1,1,1));

fn xf(I: Inst, l: vec3f) -> vec3f { let h = vec4f(l, 1.0); return vec3f(dot(I.a0, h), dot(I.a1, h), dot(I.a2, h)); }
fn nrmW(I: Inst, n: vec3f) -> vec3f { return normalize(I.b0.xyz * n.x + I.b1.xyz * n.y + I.b2.xyz * n.z); }
// the model drawn: the instance's (k 1), or its 2x-down copy (M.dims.w, k 2) while the copy's voxels come out at most
// u.shadow2.x canvas pixels (R.set.vlod). The view is orthographic: one size for the whole instance.
fn lodOf(I: Inst) -> vec2u {
  let mi = I.info.x; let lo = models[mi].dims.w;
  if (lo == 0u || u.shadow2.x <= 0.0) { return vec2u(mi, 1u); }
  let hp = 0.5 * u.outres.xy; // (canvas px: dynres moves u.res, and keying on it would loop with it)
  let ax = (u.vp * vec4f(I.a0.x, I.a1.x, I.a2.x, 0.0)).xy * hp;
  let ay = (u.vp * vec4f(I.a0.y, I.a1.y, I.a2.y, 0.0)).xy * hp;
  let az = (u.vp * vec4f(I.a0.z, I.a1.z, I.a2.z, 0.0)).xy * hp;
  let px = sqrt(max(max(dot(ax, ax), dot(ay, ay)), dot(az, az))); // one model voxel, in canvas px
  return select(vec2u(mi, 1u), vec2u(lo, 2u), 2.0 * px <= u.shadow2.x);
}

fn loOf(M: Model) -> vec3f { return vec3f(f32(M.base.w & 1023u), f32((M.base.w >> 10u) & 1023u), f32(M.base.w >> 20u)); }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let I = insts[ii];
  var o: VO;
  // faces turned away from the (orthographic) view collapse: with frag_depth there is no early-z, so
  // their fragments would otherwise all run up to the back-face discard. Faces: -x +x -y +y -z +z.
  let f = vi / 6u; let vd = u.vdir.xyz;
  let rl = vec3f(dot(I.b0.xyz, vd), dot(I.b1.xyz, vd), dot(I.b2.xyz, vd));
  if (select(-1.0, 1.0, (f & 1u) == 1u) * rl[f >> 1u] > 0.0) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  var cube = CUBE;
  let mk = lodOf(I); let M = models[mk.x];
  var lo = loOf(M); var hi = vec3f(M.dims.xyz);
  // while it dissolves in, the proxy box also covers the entry it replaces
  if (M.ext.x != 0u) { let O = models[M.ext.x - 1u]; lo = min(lo, (loOf(O) + M.off.xyz) * M.off.w); hi = max(hi, (vec3f(O.dims.xyz) + M.off.xyz) * M.off.w); }
  let l = lo + cube[vi] * (hi - lo);
  o.pos = u.vp * vec4f(xf(I, l * f32(mk.y)), 1.0); o.l = l; o.ii = ii; o.mk = mk;
  return o;
}

@fragment fn fs(i: VO) -> GO {
  let I = insts[i.ii]; var M = models[i.mk.x]; let kf = f32(i.mk.y); // (kf: one voxel in the instance's model voxels)
  // a swap's dissolve (R.swapModel): the pixels past the fade on a fixed dither still march the old entry,
  // in its own voxels (ro), mapped back (om) for the hit's position
  var ro = i.l; var om = vec4f(0.0, 0.0, 0.0, 1.0); var old = false;
  if (M.ext.x != 0u && fract(52.9829189 * fract(dot(i.pos.xy, vec2f(0.06711056, 0.00583715)))) >= bitcast<f32>(M.ext.y)) { om = M.off; M = models[M.ext.x - 1u]; ro = i.l / om.w - om.xyz; old = true; }
  let dims = vec3f(M.dims.xyz); let idims = vec3i(M.dims.xyz);
  let vd = u.vdir.xyz;
  let rd = normalize(vec3f(dot(I.b0.xyz, vd), dot(I.b1.xyz, vd), dot(I.b2.xyz, vd)));
  // a zero component keeps the sign the march steps by (sgn below): a model yawed onto a view diagonal
  // (3pi/4) has rd.x exactly 0, and +1e-6 against sgn -1 sent t backwards and missed the whole model
  let zax = abs(rd) < vec3f(1e-6);
  let inv = 1.0 / select(rd, select(vec3f(-1e-6), vec3f(1e-6), rd > vec3f(0.0)), zax);
  let ta = (loOf(M) - ro) * inv; let tb = (dims - ro) * inv;
  let tmin = min(ta, tb); let tmax = max(ta, tb);
  let tEnter = max(max(tmin.x, tmin.y), tmin.z);
  let tExit = min(min(tmax.x, tmax.y), tmax.z);
  if (tEnter < -0.05) { discard; } // back face: the front face fragment marches this pixel
  var axis = 0;
  if (tmin.x >= tmin.y && tmin.x >= tmin.z) { axis = 0; } else if (tmin.y >= tmin.z) { axis = 1; } else { axis = 2; }
  let pos = rd > vec3f(0.0);
  let sgn = select(vec3f(-1.0), vec3f(1.0), pos);
  let isg = vec3i(sgn);
  let tDelta = abs(inv);
  let bbase = vec3i(M.base.xyz / 8u);
  var t = max(tEnter, 0.0) + 1e-3;
  // the pool slab S = 2^psh bricks a side (bake-models.js POOL_SLAB, POOL_SLAB_MAX)
  let psh = countTrailingZeros(textureDimensions(pool, 0).x) - 3u; let pmsk = (1u << psh) - 1u;
  var steps = 0u; var hit = false; var cell = vec3i(0); var pb = vec3i(0);
  loop {
    if (t >= tExit || steps > 200u) { break; }
    let p = ro + rd * t;
    let br = vec3i(floor(p / 8.0));
    let slot = textureLoad(bricks, bbase + br, 0).r;
    if ((slot >> 24u) == 0u) {
      // a zero axis (zax) never crosses a plane: a ray starting exactly on one got t 0 there and stalled
      let tb2 = select((vec3f(br) * 8.0 + select(vec3f(0.0), vec3f(8.0), pos) - ro) * inv, vec3f(1e30), zax);
      if (tb2.x <= tb2.y && tb2.x <= tb2.z) { axis = 0; } else if (tb2.y <= tb2.z) { axis = 1; } else { axis = 2; }
      t = min(min(tb2.x, tb2.y), tb2.z) + 1e-3;
      steps += 1u;
      continue;
    }
    let k = (slot & 0xFFFFFFu) - 1u; let om = slot >> 24u;
    pb = vec3i(vec3u(k & pmsk, (k >> psh) & pmsk, k >> (2u * psh)) * 8u);
    cell = vec3i(floor(p));
    var tMax = select((vec3f(cell) + select(vec3f(0.0), vec3f(1.0), pos) - ro) * inv, vec3f(1e30), zax);
    var oc = vec3i(-1);
    loop {
      if (any(cell < vec3i(0)) || any(cell >= idims)) { t = tExit; break; }
      steps += 1u;
      // an empty 4^3 octant of the brick (om): jump to where the ray leaves it, as for an empty brick
      let co = cell >> vec3u(2u);
      if (any(co != oc)) {
        oc = co; let ob = co & vec3i(1);
        if (((om >> u32(ob.x + ob.y * 2 + ob.z * 4)) & 1u) == 0u) {
          let te = select((vec3f(co) * 4.0 + select(vec3f(0.0), vec3f(4.0), pos) - ro) * inv, vec3f(1e30), zax);
          if (te.x <= te.y && te.x <= te.z) { axis = 0; } else if (te.y <= te.z) { axis = 1; } else { axis = 2; }
          t = min(min(te.x, te.y), te.z) + 1e-3;
          if (t >= tExit || steps > 200u) { break; }
          cell = vec3i(floor(ro + rd * t));
          if (any((cell >> vec3u(3u)) != br)) { break; }
          tMax = select((vec3f(cell) + select(vec3f(0.0), vec3f(1.0), pos) - ro) * inv, vec3f(1e30), zax);
          continue;
        }
      }
      if (textureLoad(pool, pb + (cell & vec3i(7)), 0).a > 0.0) { hit = true; break; }
      if (tMax.x < tMax.y && tMax.x < tMax.z) { t = tMax.x; cell.x += isg.x; tMax.x += tDelta.x; axis = 0; }
      else if (tMax.y < tMax.z) { t = tMax.y; cell.y += isg.y; tMax.y += tDelta.y; axis = 1; }
      else { t = tMax.z; cell.z += isg.z; tMax.z += tDelta.z; axis = 2; }
      if (any((cell >> vec3u(3u)) != br) || steps > 200u) { t += 1e-3; break; }
    }
    if (hit) { break; }
  }
  if (!hit) { discard; }
  let v = textureLoad(pool, pb + (cell & vec3i(7)), 0);
  var lp = ro + rd * t; if (old) { lp = (lp + om.xyz) * om.w; }
  let hw = xf(I, lp * kf);
  var fl = vec3f(0.0);
  fl[axis] = -sgn[axis];
  let n = normalize(mix(nrmW(I, fl), nrmW(I, octDec(v.xy * 2.0 - 1.0)), 0.8));
  let mat = u32(v.a * 255.0 + 0.5);
  let m0 = mats[mat * 2u]; let m1 = mats[mat * 2u + 1u];
  let hc = hash13(vec3f(cell) * select(kf, 1.0, old) + f32(I.info.x) * 7.0);
  let jit = (hc - 0.5) * m1.y;
  var nn = n;
  // foliage: every leaf voxel tilts on its own in the wind, so crowns shimmer as they sway
  if (u32(m1.w + 0.5) == 2u) {
    let tm = u.vdir.w; let g = gust(hw.xy, tm);
    nn = normalize(n + (0.12 + 0.3 * g) * vec3f(sin(tm * (4.0 + hc * 3.0) + hc * 40.0), cos(tm * (3.3 + hc * 2.0) + hc * 27.0), 0.0));
  }
  var o: GO;
  o.a = vec4f(m0.rgb * (1.0 + jit), v.b);
  o.n = vec4f(octEnc(nn), f32(mat), 1.0 + f32(steps) + f32(I.info.y) * 1000.0);
  o.e = vec4f(0.0);
  let mb = I.info.z; let mv = bitcast<f32>(I.info.w);
  if (mb != 0u || mv > 0.0) {
    let ctr = select(vec3f(cell) + 0.5, (vec3f(cell) + 0.5 + om.xyz) * om.w, old); // the voxel's centre, in this entry's voxels
    let g = hookMarkAlb(mb, mv, n, (ctr * kf - 0.5) / u.grid.w, hc, f32(i.ii), o.a.rgb);
    o.a = vec4f(mix(o.a.rgb, g.tint.rgb, g.tint.a), o.a.a);
    o.e = vec4f(g.emit, 1.0);
  }
  o.depth = (u.vp * vec4f(hw, 1.0)).z;
  return o;
}
`;

  // Grass and reed blades: one voxel thick, stacked in three segments that bend with height under the
  // gust field plus each blade's own flutter. 5 faces per segment (inner tops collapsed), 90 vertices.
  W.grass = W.common + /* wgsl */ `
@group(1) @binding(0) var<storage, read> blades: array<vec4f>;
@group(1) @binding(1) var<storage, read> mats: array<vec4f>;
@group(1) @binding(2) var fieldT: texture_2d<f32>;
@group(1) @binding(3) var lin: sampler;
fn fieldAt(xy: vec2f) -> f32 { return textureSampleLevel(fieldT, lin, xy / u.field.xy, 0.0).r; }
//#hooks wilt
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) zf: f32, @location(2) @interpolate(flat) ms: vec2u };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f };
const BOX = array<vec3f, 30>(
  vec3f(1,0,0), vec3f(1,1,0), vec3f(1,1,1), vec3f(1,0,0), vec3f(1,1,1), vec3f(1,0,1),
  vec3f(0,0,0), vec3f(0,1,1), vec3f(0,1,0), vec3f(0,0,0), vec3f(0,0,1), vec3f(0,1,1),
  vec3f(0,1,0), vec3f(0,1,1), vec3f(1,1,1), vec3f(0,1,0), vec3f(1,1,1), vec3f(1,1,0),
  vec3f(0,0,0), vec3f(1,0,0), vec3f(1,0,1), vec3f(0,0,0), vec3f(1,0,1), vec3f(0,0,1),
  vec3f(0,0,1), vec3f(1,0,1), vec3f(1,1,1), vec3f(0,0,1), vec3f(1,1,1), vec3f(0,1,1));
const FN = array<vec3f, 5>(vec3f(1,0,0), vec3f(-1,0,0), vec3f(0,1,0), vec3f(0,-1,0), vec3f(0,0,1));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let B = blades[ii]; let pk = u32(B.w);
  let mat = pk >> 8u; let hv = f32((pk >> 4u) & 15u); let sd = f32(pk & 15u) / 16.0;
  // 3 segments x (the x side and the y side facing the view) + the top: blades are axis-aligned boxes
  // and the camera orthographic, so the other two sides are never visible
  var seg = 2u; var face = 4u; var kv = vi - 36u;
  if (vi < 36u) {
    seg = vi / 12u; let s6 = (vi % 12u) / 6u; kv = vi % 6u;
    face = select(select(2u, 3u, u.vdir.y > 0.0), select(0u, 1u, u.vdir.x > 0.0), s6 == 0u);
  }
  let k = face * 6u + kv;
  var bx = BOX; var fns = FN;
  let c = bx[k];
  var o: VO;
  // wilted blades (the app's hookWilt) shrink and flop over; the phony uses keep the field bound when
  // the hook ignores it
  _ = fieldT; _ = lin;
  let bl = clamp(hookWilt(B.xy), 0.0, 1.0);
  let vsz = 1.0 / u.grid.w; let Hh = hv * vsz * (1.0 - 0.45 * bl); let t = u.vdir.w;
  let zf = (f32(seg) + c.z) / 3.0;
  let wd = u.wind.xy; let wp = vec2f(-wd.y, wd.x);
  let g = gust(B.xy, t);
  let fl = sin(t * (3.1 + sd * 2.3) + sd * 40.0 + B.x * 1.7 + B.y * 1.3) * (0.18 + 0.2 * g) * u.wind.z * (1.0 - 0.6 * bl);
  let bend = (g * 0.75 + fl) * zf * zf * Hh * 0.9 + bl * zf * zf * Hh * 0.8;
  let off = wd * bend + wp * fl * 0.35 * zf * zf * Hh;
  let w = vsz * select(0.9, 0.75, hv > 7.0);
  let lp = vec3f((c.x - 0.5) * w + off.x, (c.y - 0.5) * w + off.y, zf * Hh - bend * bend / max(Hh, 1e-3) * 0.5);
  o.pos = u.vp * vec4f(B.xyz + lp, 1.0);
  o.n = fns[face] + vec3f(wd * bend * 1.5 / max(Hh, 1e-3), 0.0) * select(0.0, 1.0, face == 4u);
  o.zf = zf; o.ms = vec2u(mat, u32(sd * 16.0));
  return o;
}
@fragment fn fs(i: VO) -> GO {
  let mat = i.ms.x; let sd = f32(i.ms.y) / 16.0;
  let m0 = mats[mat * 2u];
  var o: GO;
  o.a = vec4f(m0.rgb * (0.7 + 0.55 * i.zf) * (0.9 + 0.2 * sd), mix(0.5, 1.0, i.zf));
  o.n = vec4f(octEnc(normalize(normalize(i.n) + vec3f(0.0, 0.0, 0.45))), f32(mat), -1.0);
  return o;
}
`;

  // grass on a map with flooded tiles: a blade under its cell's water sways with the current, not the wind
  // (binding 4: per map cell, the water level and its flow). Other maps compile W.grass as it is.
  W.grassL = ME.variant(W.grass, [
    [/* wgsl */ `@group(1) @binding(3) var lin: sampler;
fn fieldAt(`, /* wgsl */ `@group(1) @binding(3) var lin: sampler;
@group(1) @binding(4) var<storage, read> wcell: array<vec4f>; // per map cell: water level (-99 dry), flow x, y
fn fieldAt(`],
    [/* wgsl */ `  let wd = u.wind.xy; let wp = vec2f(-wd.y, wd.x);
  let g = gust(B.xy, t);
  let fl = sin(t * (3.1 + sd * 2.3) + sd * 40.0 + B.x * 1.7 + B.y * 1.3) * (0.18 + 0.2 * g) * u.wind.z * (1.0 - 0.6 * bl);
`, /* wgsl */ `  var wd = u.wind.xy;
  var g = gust(B.xy, t);
  var fl = sin(t * (3.1 + sd * 2.3) + sd * 40.0 + B.x * 1.7 + B.y * 1.3) * (0.18 + 0.2 * g) * u.wind.z * (1.0 - 0.6 * bl);
  // under its cell's water: the current instead of the wind (along the flow, or a slow drift in still water),
  // a steady lean and a sinuous sway whose phase climbs the blade
  let wci = vec2i(floor(B.xy));
  if (u.water2.y > 0.5 && all(wci >= vec2i(0)) && all(wci < vec2i(u.water2.zw))) {
    let Wc = wcell[u32(wci.y * i32(u.water2.z) + wci.x)];
    if (Wc.x > B.z + 0.01) {
      let fm = length(Wc.yz); let dr = sd * 6.283 + t * 0.07;
      wd = select(vec2f(cos(dr), sin(dr)), Wc.yz / max(fm, 1e-4), fm > 0.01);
      g = 0.3 + 0.12 * sin(t * 0.6 + sd * 9.0 + B.x * 0.9 + B.y * 0.7);
      fl = sin(t * 1.3 + sd * 30.0 + B.x * 1.1 + B.y * 0.8 - zf * 3.0) * 0.3 * (1.0 - 0.6 * bl);
    }
  }
  let wp = vec2f(-wd.y, wd.x);
`],
  ]);

  // Falling maple leaves: tumbling alpha-tested quads lit like everything else.
  W.leaves = W.common + /* wgsl */ `
struct Pt { p: vec4f, v: vec4f };
@group(1) @binding(0) var<storage, read> pts: array<Pt>;
@group(1) @binding(1) var<storage, read> mats: array<vec4f>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) n: vec3f };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let P = pts[ii];
  var o: VO;
  var q = QUAD; let c = q[vi];
  o.uv = c; o.n = vec3f(0.0, 0.0, 1.0);
  if (P.p.w <= 0.0) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  let seed = P.v.w; let t = u.vdir.w;
  var nrm = normalize(vec3f(sin(seed * 6.283 + t * (1.5 + seed)) * 0.8, cos(seed * 3.1 + t * 1.1) * 0.8, 0.6));
  if (dot(P.v.xyz, P.v.xyz) < 1e-8) { nrm = vec3f(0.0, 0.0, 1.0); }
  let e1 = normalize(cross(nrm, vec3f(0.31, 0.95, 0.0)));
  let e2 = cross(nrm, e1);
  let w = P.p.xyz + (e1 * c.x + e2 * c.y) * 0.075 + vec3f(0.0, 0.0, 0.012);
  o.pos = u.vp * vec4f(w, 1.0);
  if (dot(nrm, u.vdir.xyz) > 0.0) { nrm = -nrm; }
  o.n = nrm;
  return o;
}
@fragment fn fs(i: VO) -> GO {
  let r = length(i.uv); let a = atan2(i.uv.y, i.uv.x);
  if (r > 0.5 + 0.5 * pow(abs(cos(a * 2.5)), 0.7)) { discard; }
  let mid = u32(u.ids.w);
  var o: GO;
  o.a = vec4f(mats[mid * 2u].rgb * (0.9 + 0.2 * r), 1.0);
  o.n = vec4f(octEnc(normalize(i.n)), f32(mid), -1.0);
  return o;
}
`;
})();
