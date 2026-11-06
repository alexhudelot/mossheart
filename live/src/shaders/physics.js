/* Voxel physics v2 (ME.VoxelPhysics): a pool of loose voxels, each one terrain voxel in size, that fly,
   bounce, come to rest and pile up on the voxel world.
   One bitset holds every solid cell: the terrain (from the terrain voxels at init) and the cells
   held by resting voxels, so a collision test is one load and a voxel can only claim a free cell.
   Flying voxels walk the grid cell by cell along their motion (DDA: nothing thin is ever skipped, at any
   speed; SUBSTEP is the v1 fixed-substep mover, kept for comparison). A resting voxel with no support falls
   again; a granular one slides off a heap edge into a free cell diagonally below. With SLEEP, a resting
   voxel that has checked its cell sleeps until a neighbouring cell is given back (a wake bit per cell).
   With LIST, the step also writes the faces worth drawing (facing the camera, not against a solid cell,
   on screen) for one indirect draw.
   Water: under the surface voxels sink slowly (drag, buoyancy) and drift with the current; light
   non-granular ones (leaves) float. A voxel that hits the surface fast enough logs an impact (args.ev),
   which the CPU turns into a ring on the water and a spray of droplets a frame later. Droplets never
   rest: they end where they touch the ground or the water.
   Sand: a granular voxel on a heap's edge steps into the free cell diagonally below (gives its cell back,
   claims the next); a share of the grains (pp.a.z, from the angle of repose) also step two cells out and
   one down, so piles settle between 27 and 45 degrees. Carved terrain cells are given back by physCarve.
   Voxel (32 bytes): p = position (world) + life left (s); v = velocity; k = material (bits 0-7), state
   (8-9: 0 free, 1 flying, 2 resting, 3 asleep), granular (10), air drag x4 per s (11-16), seed (17-22),
   droplet (23), tumble angle in 1/256 turns (24-31). A resting voxel holds the cell it sits in until its
   last FADE seconds, when it shrinks away.
   Dug sand stays: a grain carved out of the terrain carries the life KEEP (it never expires). Once it has
   slept SETTLE_S seconds on the terrain itself (ter: the terrain cells alone, so never on loose voxels
   that will go) it goes back into the terrain: it lists its cell and material (args.settled) and is
   marked SETTLED, still drawn and still holding its cell; the CPU writes it into T.grid and, from step
   pp.e.y on, the slot is free and the cell stays solid as terrain. A clear leaves dug sand be. */
(function () {
  const ME = window.ME, W = ME.wgsl;

  const VOX = /* wgsl */ `
struct Vox { p: vec4f, v: vec3f, k: u32 };
// a = dt, gravity, share of grains sliding two cells out (angle of repose), restitution; b = ground
// friction per 1/60 s, settle speed, clock, wind pull; c = voxels in use, spawn count, ring slot of the
// first spawn, flags (1 = clear all, 2 = for a terrain reset); d = grid dims, capacity; g = grid origin,
// voxels per unit; h = dig: centre, radius (0 = none); e = this step's number, the last step whose
// settled grains the CPU has written into the terrain
struct PP { a: vec4f, b: vec4f, c: vec4u, d: vec4u, g: vec4f, h: vec4f, e: vec4u };
const FADE = 0.5;
const KEEP_MIN = 1e8; const SETTLED = 4e9; const SETTLED_MIN = 3e9; const SETTLE_S = 1.5; const SETCAP = 2048u;
// dug terrain sand still loose (not yet back in the terrain)
fn keeps(V: Vox) -> bool { return V.p.w > KEEP_MIN && V.p.w < SETTLED_MIN; }
fn stateOf(k: u32) -> u32 { return (k >> 8u) & 3u; }
fn withState(k: u32, s: u32) -> u32 { return (k & ~(3u << 8u)) | (s << 8u); }
fn angleOf(k: u32) -> f32 { return f32(k >> 24u) * (6.2831853 / 256.0); }
fn isDrop(k: u32) -> bool { return (k & (1u << 23u)) != 0u; }
fn spinAxis(k: u32) -> vec3f {
  let s = f32((k >> 17u) & 63u);
  return normalize(vec3f(hash12(vec2f(s, 1.0)), hash12(vec2f(s, 2.0)), hash12(vec2f(s, 3.0))) - 0.5 + vec3f(0.0, 0.0, 1e-3));
}
fn rot(x: vec3f, k: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return x * c + cross(k, x) * s + k * dot(k, x) * (1.0 - c); }
`;
  // cells and the solid bitset (both compute shaders bind pp, occ and wake)
  const CELLS = /* wgsl */ `
override SLEEP: bool = true;
fn cellOf(p: vec3f) -> vec3i { return vec3i(floor((p - pp.g.xyz) * pp.g.w)); }
fn inGrid(c: vec3i) -> bool { return all(c >= vec3i(0)) && all(c < vec3i(pp.d.xyz)); }
fn cellIdx(c: vec3i) -> u32 { return u32((c.z * i32(pp.d.y) + c.y) * i32(pp.d.x) + c.x); }
// solid = terrain or held; below the grid is floor, around it is air
fn solid(c: vec3i) -> bool {
  if (!inGrid(c)) { return c.z < 0; }
  let i = cellIdx(c);
  return (atomicLoad(&occ[i >> 5u]) & (1u << (i & 31u))) != 0u;
}
// claims a free cell; false when it is terrain or another voxel got there first
fn claim(i: u32) -> bool { let b = 1u << (i & 31u); return (atomicOr(&occ[i >> 5u], b) & b) == 0u; }
fn markWake(c: vec3i) { if (inGrid(c)) { let i = cellIdx(c); atomicOr(&wake[i >> 5u], 1u << (i & 31u)); } }
// a cell given back; wakes the resting voxels it held up (above), now lets slide (beside, diagonally
// above, two out and one above) or now shows a face of (all six neighbours: their cached open faces change)
fn release(i: u32) {
  atomicAnd(&occ[i >> 5u], ~(1u << (i & 31u)));
  if (SLEEP) {
    let c = vec3i(i32(i % pp.d.x), i32((i / pp.d.x) % pp.d.y), i32(i / (pp.d.x * pp.d.y)));
    var D = array<vec3i, 4>(vec3i(1, 0, 0), vec3i(-1, 0, 0), vec3i(0, 1, 0), vec3i(0, -1, 0));
    markWake(c + vec3i(0, 0, 1)); markWake(c - vec3i(0, 0, 1));
    for (var k = 0; k < 4; k++) { markWake(c + D[k]); markWake(c + D[k] + vec3i(0, 0, 1)); markWake(c + D[k] * 2 + vec3i(0, 0, 1)); }
  }
}
`;

  // the indirect draw's arguments, then the water impacts (x, y, surface z, speed) and the grains gone back
  // into the terrain (cell, material) since the CPU last copied them, and the dug grains lost (off the grid,
  // or with no cell to go back to); the CPU zeroes the counts then. ter = the terrain alone (no loose voxel).
  const ARGS = /* wgsl */ `
struct Args { verts: u32, inst: atomic<u32>, first: u32, firstInst: u32, evN: atomic<u32>, setN: atomic<u32>, lostN: atomic<u32>, e3: u32, ev: array<vec4f, 64>, settled: array<vec2u, SETCAP> };
fn terrainAt(c: vec3i) -> bool {
  if (!inGrid(c)) { return c.z < 0; }
  let i = cellIdx(c);
  return (atomicLoad(&ter[i >> 5u]) & (1u << (i & 31u))) != 0u;
}
// A dug grain at rest in cell c goes back into the terrain: only on the terrain (or the floor), never on
// loose voxels that will go, and only once listed (the list full, it tries again next step).
fn settleAt(c: vec3i, mat: u32) -> bool {
  if (!terrainAt(c - vec3i(0, 0, 1))) { return false; }
  let ci = cellIdx(c);
  let n = atomicAdd(&args.setN, 1u);
  if (n >= SETCAP) { return false; }
  args.settled[n] = vec2u(ci, mat);
  atomicOr(&ter[ci >> 5u], 1u << (ci & 31u));
  return true;
}
fn lostGrain() { atomicAdd(&args.lostN, 1u); }
`;

  // New voxels into the ring slots from pp.c.z on; a slot still holding a cell gives it back first.
  W.physSpawn = W.common + VOX + CELLS + ARGS + /* wgsl */ `
@group(1) @binding(0) var<uniform> pp: PP;
@group(1) @binding(1) var<storage, read_write> vx: array<Vox>;
@group(1) @binding(2) var<storage, read_write> occ: array<atomic<u32>>;
@group(1) @binding(3) var<storage, read_write> wake: array<atomic<u32>>;
@group(1) @binding(4) var<storage, read> spawns: array<Vox>;
@group(1) @binding(5) var<storage, read_write> args: Args;
@group(1) @binding(6) var<storage, read_write> ter: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  _ = &wake; _ = u.grid;
  if (id.x >= pp.c.y) { return; }
  let slot = (pp.c.z + id.x) % pp.d.w;
  let old = vx[slot]; let nw = spawns[id.x];
  // a droplet takes only a free slot or another droplet's: it never evicts a live voxel
  if (isDrop(nw.k) && stateOf(old.k) != 0u && !isDrop(old.k)) { return; }
  // nor is loose dug sand ever evicted: the new voxel is dropped, and new dug sand stays in the terrain
  // where it came from (its cell, given back this step, is claimed again)
  if (stateOf(old.k) != 0u && keeps(old)) {
    if (keeps(nw)) {
      let c = cellOf(nw.p.xyz);
      var kept = false;
      if (inGrid(c)) { let ci = cellIdx(c); if (claim(ci)) { kept = settleAt(c, nw.k & 255u); if (!kept) { release(ci); } } }
      if (!kept) { lostGrain(); }
    }
    return;
  }
  // a settled grain's cell is terrain now: it stays solid
  if (stateOf(old.k) >= 2u && old.p.w > FADE && old.p.w < SETTLED_MIN) { release(cellIdx(cellOf(old.p.xyz))); }
  vx[slot] = nw;
}
`;

  // Terrain cells the CPU carved out (dig, collapse: their sand became loose grains) given back to the
  // solid bitset; release wakes the voxels they held up. cells = count, then the cell indices.
  W.physCarve = W.common + VOX + CELLS + /* wgsl */ `
@group(1) @binding(0) var<uniform> pp: PP;
@group(1) @binding(1) var<storage, read_write> occ: array<atomic<u32>>;
@group(1) @binding(2) var<storage, read_write> wake: array<atomic<u32>>;
@group(1) @binding(3) var<storage, read> cells: array<u32>;
@group(1) @binding(4) var<storage, read_write> ter: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  _ = &wake; _ = u.grid;
  if (id.x >= cells[0]) { return; }
  let i = cells[id.x + 1u];
  release(i);
  atomicAnd(&ter[i >> 5u], ~(1u << (i & 31u)));
}
`;

  W.physStep = W.common + VOX + CELLS + ARGS + /* wgsl */ `
override DDA: bool = true;
override LIST: bool = true;
@group(1) @binding(0) var<uniform> pp: PP;
@group(1) @binding(1) var<storage, read_write> vx: array<Vox>;
@group(1) @binding(2) var<storage, read_write> occ: array<atomic<u32>>;
@group(1) @binding(3) var<storage, read_write> wake: array<atomic<u32>>;
@group(1) @binding(4) var<storage, read_write> list: array<u32>;
@group(1) @binding(5) var<storage, read_write> args: Args;
@group(1) @binding(7) var<storage, read_write> ter: array<atomic<u32>>;
@group(1) @binding(6) var<storage, read> wat: array<vec4f>; // per map tile: surface z (-99 dry), current (units/s), stream

fn waterAt(p: vec2f) -> vec4f {
  let c = vec2i(floor(p));
  if (any(c < vec2i(0)) || any(c >= vec2i(u.water2.zw))) { return vec4f(-99.0, 0.0, 0.0, 0.0); }
  return wat[u32(c.y * i32(u.water2.z) + c.x)];
}
fn logImpact(p: vec2f, z: f32, s: f32) { let i = atomicAdd(&args.evN, 1u); if (i < 64u) { args.ev[i] = vec4f(p, z, s); } }

struct Mv { p: vec3f, v: vec3f, ground: bool };
// Exact traversal: step from cell face to cell face along the motion; a solid cell ahead stops that axis
// (bounce with restitution) and the rest of the step carries on along the others (sliding).
fn moveDDA(p0: vec3f, v0: vec3f, dt: f32) -> Mv {
  var g = (p0 - pp.g.xyz) * pp.g.w;
  var v = v0; var left = dt; var ground = false;
  for (var it = 0; it < 64; it++) {
    if (left <= 0.0) { break; }
    let vg = v * pp.g.w;
    let c = vec3i(floor(g));
    var tb = vec3f(1e30);
    for (var q = 0; q < 3; q++) {
      if (vg[q] > 1e-6) { tb[q] = (f32(c[q]) + 1.0 - g[q]) / vg[q]; }
      else if (vg[q] < -1e-6) { tb[q] = (g[q] - f32(c[q])) / -vg[q]; }
    }
    var a = 0;
    if (tb.y < tb[a]) { a = 1; }
    if (tb.z < tb[a]) { a = 2; }
    let th = tb[a];
    if (th >= left) { g += vg * left; break; }
    g += vg * th; left -= th;
    let s = select(-1, 1, vg[a] > 0.0);
    var nc = c; nc[a] += s;
    let face = f32(c[a]) + select(0.0, 1.0, s > 0);
    if (solid(nc)) {
      g[a] = face - f32(s) * 1e-3;
      if (a == 2 && s < 0) { ground = true; }
      v[a] = -v[a] * pp.a.w;
    } else { g[a] = face + f32(s) * 1e-4; }
  }
  return Mv(g / pp.g.w + pp.g.xyz, v, ground);
}
// v1's mover: per-axis substeps of under half a voxel, at most 12 a frame (faster voxels can skip a
// thin wall)
fn moveSub(p0: vec3f, v0: vec3f, dt: f32) -> Mv {
  var p = p0; var v = v0; var ground = false;
  let vsz = 1.0 / pp.g.w;
  let n = clamp(u32(ceil(max(abs(v.x), max(abs(v.y), abs(v.z))) * dt / (vsz * 0.45))), 1u, 12u);
  let h = dt / f32(n);
  for (var s = 0u; s < n; s++) {
    for (var a = 0; a < 3; a++) {
      var q = p;
      q[a] += v[a] * h;
      if (solid(cellOf(q))) {
        if (a == 2 && v.z < 0.0) { ground = true; }
        v[a] = -v[a] * pp.a.w;
      } else { p = q; }
    }
  }
  return Mv(p, v, ground);
}

// faces not against a solid cell (bit f = face f: -x +x -y +y -z +z)
fn openFaces(c: vec3i) -> u32 {
  var m = 0u;
  for (var f = 0u; f < 6u; f++) {
    var o = vec3i(0); o[f / 2u] = select(-1, 1, (f & 1u) == 1u);
    if (!solid(c + o)) { m |= 1u << f; }
  }
  return m;
}
// a sleeping voxel keeps its open faces in its (unused) velocity: one normal float's low mantissa bits
fn cachedOpen(V: Vox) -> u32 { return bitcast<u32>(V.v.x) & 63u; }
fn withOpen(m: u32) -> vec3f { return vec3f(bitcast<f32>(0x3f800000u | m), 0.0, 0.0); }
// faces worth drawing: the three facing the camera, minus, for a resting voxel, those against a solid
// cell (asleep: from its cache, no lookups); none off screen
fn drawFaces(V: Vox) -> u32 {
  let clip = u.vp * vec4f(V.p.xyz, 1.0);
  if (any(abs(clip.xy) > vec2f(1.02))) { return 0u; }
  let st = stateOf(V.k);
  var ld = u.vdir.xyz;
  if (st == 1u) { ld = rot(ld, spinAxis(V.k), -angleOf(V.k)); }
  var front = 0u;
  for (var a = 0u; a < 3u; a++) { front |= 1u << (a * 2u + select(0u, 1u, ld[a] < 0.0)); }
  if (st == 1u || V.p.w <= FADE) { return front; }
  if (st == 3u) { return front & cachedOpen(V); }
  return front & openFaces(cellOf(V.p.xyz));
}

// one voxel's step; returns its faces to draw (LIST)
fn update(i: u32) -> u32 {
  var V = vx[i];
  let st = stateOf(V.k);
  if (st == 0u) { return 0u; }
  // a clear leaves dug sand be (it settles as ever); a terrain reset (flag 2) takes everything
  let reset = (pp.c.w & 2u) != 0u;
  let clearing = (pp.c.w & 1u) != 0u && (reset || !keeps(V));
  if (V.p.w > SETTLED_MIN) {
    // back in the terrain: drawn until the CPU has it in T.grid, then the slot goes (the cell stays solid)
    if (reset || u32(V.v.z) <= pp.e.y) { V.k = withState(V.k, 0u); vx[i] = V; return 0u; }
    if (LIST) { return drawFaces(V); } return 0u;
  }
  let dt = pp.a.x;
  let was = V.p.w;
  V.p.w -= dt;
  let held = st >= 2u && was > FADE;
  if (V.p.w <= 0.0 || clearing) {
    if (held) { release(cellIdx(cellOf(V.p.xyz))); }
    V.k = withState(V.k, 0u); vx[i] = V; return 0u;
  }

  if (st >= 2u) {
    let c = cellOf(V.p.xyz); let ci = cellIdx(c);
    if (V.p.w <= FADE) {
      // shrinking away: gives its cell back once, stays put
      if (held) { release(ci); }
      vx[i] = V;
      if (LIST) { return drawFaces(V); } return 0u;
    }
    // dug out: thrown up and away from the dig's centre (the grains around then slide into the hole)
    let dg = V.p.xyz - pp.h.xyz;
    if (pp.h.w > 0.0 && length(dg) < pp.h.w) {
      release(ci); V.k = withState(V.k, 1u);
      V.v = vec3f(normalize(dg.xy + vec2f(1e-4, 0.0)) * (0.3 + 0.5 * hash13(vec3f(f32(i), pp.b.z, 5.3))), 0.9);
      vx[i] = V;
      if (LIST) { return drawFaces(V); } return 0u;
    }
    var check = st == 2u;
    if (st == 3u) {
      let b = 1u << (ci & 31u);
      if ((atomicLoad(&wake[ci >> 5u]) & b) != 0u) { atomicAnd(&wake[ci >> 5u], ~b); check = true; }
      // dug sand asleep long enough (v.y = when it fell asleep) goes back into the terrain
      else if (keeps(V) && pp.b.z - V.v.y > SETTLE_S && settleAt(c, V.k & 255u)) { V.p.w = SETTLED; V.v.z = f32(pp.e.x); }
    }
    if (check) {
      // stays while held up (else it falls); a granular voxel on a heap's edge steps into the free cell
      // diagonally below, and the share pp.a.z of the grains also two cells out and one down: piles settle
      // at the angle of repose. A step gives the cell back and claims the next one (or, beaten to it,
      // falls where it stands).
      let fall = !solid(c - vec3i(0, 0, 1));
      var to = c;
      if (!fall && (V.k & (1u << 10u)) != 0u) {
        var D = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(-1, 0), vec2i(0, -1));
        let r0 = u32(hash13(vec3f(f32(i), pp.b.z * 13.0, 7.7)) * 4.0);
        let far = (f32((V.k >> 17u) & 63u) + 0.5) / 64.0 < pp.a.z;
        for (var k = 0u; k < 4u; k++) {
          let d = vec3i(D[(r0 + k) & 3u], 0);
          let side = c + d;
          if (solid(side)) { continue; }
          if (!solid(side - vec3i(0, 0, 1))) { to = side - vec3i(0, 0, 1); break; }
          if (far && !solid(side + d) && !solid(side + d - vec3i(0, 0, 1))) { to = side + d - vec3i(0, 0, 1); break; }
        }
      }
      if (fall) { release(ci); V.k = withState(V.k, 1u); V.v = vec3f(0.0); }
      else if (any(to != c)) {
        release(ci);
        if (inGrid(to) && claim(cellIdx(to))) {
          if (SLEEP && LIST) { for (var f = 0u; f < 6u; f++) { var o = vec3i(0); o[f / 2u] = select(-1, 1, (f & 1u) == 1u); markWake(to + o); } }
          V.p = vec4f(pp.g.xyz + (vec3f(to) + 0.5) / pp.g.w, V.p.w); V.k = withState(V.k, 2u); V.v = vec3f(0.0);
        } else { V.k = withState(V.k, 1u); V.v = vec3f(0.0); }
      }
      else if (SLEEP) { V.k = withState(V.k, 3u); var w = vec3f(0.0); if (LIST) { w = withOpen(openFaces(c)); } w.y = pp.b.z; V.v = w; }
      else if (keeps(V) && settleAt(c, V.k & 255u)) { V.p.w = SETTLED; V.v.z = f32(pp.e.x); }
    }
    vx[i] = V;
    if (LIST) { return drawFaces(V); } return 0u;
  }

  // flying: gravity, air drag, a little wind; under water heavy drag and buoyancy (slow sinking) and the
  // current; light non-granular voxels (leaves) float at the surface
  var v = V.v; var p = V.p.xyz;
  let drop = isDrop(V.k);
  let wa = waterAt(p.xy);
  let under = p.z < wa.x;
  v.z -= pp.a.y * dt;
  var drag = f32((V.k >> 11u) & 63u) * 0.25;
  let floats = drag >= 2.0 && (V.k & (1u << 10u)) == 0u;
  if (under) {
    if (floats) { v.z += pp.a.y * dt + ((wa.x - 0.3 / pp.g.w - p.z) * 30.0 - v.z * 4.0) * dt; }
    else { drag += 5.0; v.z += pp.a.y * 0.65 * dt; }
  }
  v *= exp(-drag * dt);
  if (under) { v = vec3f(mix(v.xy, wa.yz, 1.0 - exp(-2.5 * dt)), v.z); }
  v = vec3f(v.xy + u.wind.xy * gust(p.xy, u.vdir.w) * pp.b.w * min(drag, 4.0) * dt, v.z);
  let vIn = v.z;
  // inside a solid cell (born inside the ground, or where another voxel just came to rest or stepped):
  // out to the free cell above or beside it (a side picked at random, so a clump caught in one cell
  // scatters instead of marching off in file), else up to the first free cell; it stops falling there
  // (lifting a grain through a whole heap would drop it back on the top, again and again)
  let c0 = cellOf(p);
  if (solid(c0)) {
    var D4 = array<vec3i, 4>(vec3i(1, 0, 0), vec3i(0, 1, 0), vec3i(-1, 0, 0), vec3i(0, -1, 0));
    var out = vec3i(0);
    if (!solid(c0 + vec3i(0, 0, 1))) { out = vec3i(0, 0, 1); }
    else {
      let r0 = u32(hash13(vec3f(f32(i), pp.b.z * 17.0, 2.9)) * 4.0);
      for (var q = 0u; q < 4u; q++) { let d = D4[(r0 + q) & 3u]; if (!solid(c0 + d)) { out = d; break; } }
    }
    if (all(out == vec3i(0))) {
      var k = 2;
      loop { if (k >= 32 || !solid(c0 + vec3i(0, 0, k))) { break; } k++; }
      out = vec3i(0, 0, k);
    }
    // to the middle of that cell, a little off it at random (grains that met in one spot part ways)
    let jt = vec2f(hash13(vec3f(f32(i), pp.b.z, 4.7)), hash13(vec3f(f32(i), pp.b.z, 6.1))) - 0.5;
    p = pp.g.xyz + (vec3f(c0 + out) + vec3f(0.5 + 0.6 * jt, 0.5)) / pp.g.w;
    v.z = max(v.z, 0.0);
  }
  var m: Mv;
  if (DDA) { m = moveDDA(p, v, dt); } else { m = moveSub(p, v, dt); }
  p = m.p; v = m.v;
  if (m.ground) { let f = pow(pp.b.x, dt * 60.0); v = vec3f(v.xy * f, v.z); }
  var c = cellOf(p);
  if (!inGrid(c)) { if (keeps(V)) { lostGrain(); } V.k = withState(V.k, 0u); vx[i] = V; return 0u; }
  // through the water surface on the way down: a splash (the CPU adds the ring and the droplets)
  let wz = waterAt(p.xy).x;
  if (!under && p.z < wz) {
    if (drop) { V.k = withState(V.k, 0u); vx[i] = V; return 0u; }
    if (vIn < -0.6) { logImpact(p.xy, wz, -vIn); }
  }
  if (drop && m.ground) { V.k = withState(V.k, 0u); vx[i] = V; return 0u; }
  // tumble at a rate that follows the speed (angle in 1/256 turns, stochastically rounded)
  let sp = length(v);
  let rate = 4.0 + 6.0 * f32((V.k >> 17u) & 7u) / 7.0;
  let a1 = f32(V.k >> 24u) + sp * dt * rate * (256.0 / 6.2831853) + hash13(vec3f(f32(i), pp.b.z, 3.1));
  V.k = (V.k & 0x00ffffffu) | ((u32(a1) & 255u) << 24u);
  if (m.ground && sp < pp.b.y && V.p.w > FADE) {
    // beaten to its cell (another voxel came to rest or stepped there this step): the cell above it,
    // which that voxel now holds up
    var claimed = claim(cellIdx(c));
    let up = c + vec3i(0, 0, 1);
    if (!claimed && inGrid(up) && claim(cellIdx(up))) { c = up; claimed = true; }
    if (claimed) {
      // the sleeping neighbours re-check, so their cached open faces lose the one this voxel now covers
      if (SLEEP && LIST) { for (var f = 0u; f < 6u; f++) { var o = vec3i(0); o[f / 2u] = select(-1, 1, (f & 1u) == 1u); markWake(c + o); } }
      V.k = withState(V.k & 0x00ffffffu, 2u);
      p = pp.g.xyz + (vec3f(c) + 0.5) / pp.g.w; v = vec3f(0.0);
    } else { v.z = 0.8; }
  }
  V.p = vec4f(p, V.p.w); V.v = v;
  vx[i] = V;
  if (LIST) { return drawFaces(V); } return 0u;
}

var<workgroup> wCount: atomic<u32>;
var<workgroup> wBase: u32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
  _ = &wake; _ = &list; _ = &args;
  var faces = 0u;
  if (id.x < pp.c.x) { faces = update(id.x); }
  if (LIST) {
    // append the visible faces: one global atomic per workgroup
    let off = atomicAdd(&wCount, countOneBits(faces));
    workgroupBarrier();
    if (li == 0u) { wBase = atomicAdd(&args.inst, atomicLoad(&wCount)); }
    workgroupBarrier();
    var o = wBase + off;
    for (var f = 0u; f < 6u; f++) { if ((faces & (1u << f)) != 0u) { list[o] = (id.x << 3u) | f; o++; } }
  }
}
`;

  // Loose voxels into the G-buffer, shaded like terrain voxels (aux 0). Flying ones tumble and are a touch
  // smaller; all shrink away in their last FADE seconds. Three ways to draw them (VoxelPhysics draw mode):
  // cubes (36 vertices each), faces (the 3 facing the camera, 18) and list (only the faces the step listed,
  // one indirect draw); splat is its own module below.
  W.physDraw = W.common + VOX + /* wgsl */ `
@group(1) @binding(0) var<storage, read> vx: array<Vox>;
@group(1) @binding(1) var<storage, read> mats: array<vec4f>;
@group(1) @binding(2) var<storage, read> list: array<u32>;
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) @interpolate(flat) mi: vec2u, @location(2) ao: f32 };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f };
const CUBE = array<vec3f, 36>(
  vec3f(0,0,0), vec3f(0,1,0), vec3f(0,1,1), vec3f(0,0,0), vec3f(0,1,1), vec3f(0,0,1),
  vec3f(1,0,0), vec3f(1,1,1), vec3f(1,1,0), vec3f(1,0,0), vec3f(1,0,1), vec3f(1,1,1),
  vec3f(0,0,0), vec3f(1,0,1), vec3f(1,0,0), vec3f(0,0,0), vec3f(0,0,1), vec3f(1,0,1),
  vec3f(0,1,0), vec3f(1,1,0), vec3f(1,1,1), vec3f(0,1,0), vec3f(1,1,1), vec3f(0,1,1),
  vec3f(0,0,0), vec3f(1,0,0), vec3f(1,1,0), vec3f(0,0,0), vec3f(1,1,0), vec3f(0,1,0),
  vec3f(0,0,1), vec3f(1,1,1), vec3f(1,0,1), vec3f(0,0,1), vec3f(0,1,1), vec3f(1,1,1));
const FN = array<vec3f, 6>(vec3f(-1,0,0), vec3f(1,0,0), vec3f(0,-1,0), vec3f(0,1,0), vec3f(0,0,-1), vec3f(0,0,1));
fn faceVert(i: u32, f: u32, vi: u32) -> VO {
  let V = vx[i];
  var o: VO;
  let st = stateOf(V.k);
  if (st == 0u || f > 5u) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  var cube = CUBE; var fns = FN;
  let rest = st >= 2u;
  let sz = select(select(0.9, 0.55, isDrop(V.k)), 1.0, rest) * clamp(V.p.w / FADE, 0.0, 1.0) / u.grid.w;
  let ax = spinAxis(V.k); let ang = select(angleOf(V.k), 0.0, rest);
  let w = V.p.xyz + rot((cube[f * 6u + vi] - 0.5) * sz, ax, ang);
  o.pos = u.vp * vec4f(w, 1.0);
  o.n = rot(fns[f], ax, ang);
  o.mi = vec2u(V.k & 255u, i);
  o.ao = select(0.82, 1.0, f == 5u);
  return o;
}
@vertex fn vsCubes(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO { return faceVert(ii, vi / 6u, vi % 6u); }
// the face along axis vi/6 that faces the camera
@vertex fn vsFaces(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let V = vx[ii]; let a = vi / 6u;
  var ld = u.vdir.xyz;
  if (stateOf(V.k) == 1u) { ld = rot(ld, spinAxis(V.k), -angleOf(V.k)); }
  return faceVert(ii, a * 2u + select(0u, 1u, ld[a] < 0.0), vi % 6u);
}
@vertex fn vsList(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO { let e = list[ii]; return faceVert(e >> 3u, e & 7u, vi); }
@fragment fn fs(i: VO) -> GO {
  let mat = i.mi.x;
  let m0 = mats[mat * 2u]; let m1 = mats[mat * 2u + 1u];
  let jit = (hash12(vec2f(f32(i.mi.y % 4096u), 5.3)) - 0.5) * m1.y;
  var o: GO;
  o.a = vec4f(m0.rgb * max(0.2, 1.0 + jit), i.ao);
  o.n = vec4f(octEnc(normalize(i.n)), f32(mat), 0.0);
  return o;
}
`;

  // Splat: one screen quad over each voxel's projected box; the fragment intersects the view ray with the
  // (tumbling) box and writes the true depth and face, like the volume pass does for models.
  W.physSplat = W.common + VOX + /* wgsl */ `
@group(1) @binding(0) var<storage, read> vx: array<Vox>;
@group(1) @binding(1) var<storage, read> mats: array<vec4f>;
struct VO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f, @location(1) @interpolate(flat) i: u32, @location(2) @interpolate(flat) cz: f32 };
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @builtin(frag_depth) depth: f32 };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
struct Box { c: vec3f, h: f32, ax: vec3f, ang: f32 };
fn boxOf(V: Vox) -> Box {
  let rest = stateOf(V.k) >= 2u;
  return Box(V.p.xyz, 0.5 * select(select(0.9, 0.55, isDrop(V.k)), 1.0, rest) * clamp(V.p.w / FADE, 0.0, 1.0) / u.grid.w, spinAxis(V.k), select(angleOf(V.k), 0.0, rest));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let V = vx[ii];
  var o: VO;
  if (stateOf(V.k) == 0u) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  let B = boxOf(V);
  let cc = u.vp * vec4f(B.c, 1.0);
  var ext = vec2f(0.0);
  for (var j = 0; j < 3; j++) { var e = vec3f(0.0); e[j] = B.h; ext += abs((u.vp * vec4f(rot(e, B.ax, B.ang), 0.0)).xy); }
  var q = QUAD;
  let xy = cc.xy + q[vi] * ext;
  o.pos = vec4f(xy, cc.z, 1.0); o.ndc = xy; o.i = ii; o.cz = cc.z;
  return o;
}
@fragment fn fs(i: VO) -> GO {
  let V = vx[i.i]; let B = boxOf(V);
  let ro = rot((u.ivp * vec4f(i.ndc, i.cz, 1.0)).xyz - B.c, B.ax, -B.ang);
  let rd = rot(u.vdir.xyz, B.ax, -B.ang);
  let inv = 1.0 / select(rd, vec3f(1e-6), abs(rd) < vec3f(1e-6));
  let t1 = (-B.h - ro) * inv; let t2 = (B.h - ro) * inv;
  let tn = min(t1, t2); let tf = max(t1, t2);
  let t0 = max(max(tn.x, tn.y), tn.z);
  if (t0 > min(min(tf.x, tf.y), tf.z)) { discard; }
  var a = 0;
  if (tn.y >= tn[a]) { a = 1; }
  if (tn.z >= tn[a]) { a = 2; }
  var ln = vec3f(0.0); ln[a] = -sign(rd[a]);
  let hit = B.c + rot(ro + rd * t0, B.ax, B.ang);
  let mat = V.k & 255u;
  let m0 = mats[mat * 2u]; let m1 = mats[mat * 2u + 1u];
  let jit = (hash12(vec2f(f32(i.i % 4096u), 5.3)) - 0.5) * m1.y;
  var o: GO;
  o.a = vec4f(m0.rgb * max(0.2, 1.0 + jit), select(0.82, 1.0, a == 2 && ln.z > 0.0));
  o.n = vec4f(octEnc(rot(ln, B.ax, B.ang)), f32(mat), 0.0);
  o.depth = (u.vp * vec4f(hit, 1.0)).z;
  return o;
}
`;
})();
