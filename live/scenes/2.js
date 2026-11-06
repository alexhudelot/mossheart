/* An apple tree on a round patch of grass: a flared trunk, four boughs, a lumpy canopy of leaf clumps
   (darker underneath, sunlit on top), red apples hanging at the edges and two fallen in the grass. */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
live.open({ dims: [64, 64, 72], grid: 64, name: "apple_tree" });
live.material("bark", "#6b4a2f");
live.material("barkDark", "#4a3220");
live.material("leafDark", "#2f6b2c");
live.material("leaf", "#4f8f34");
live.material("leafSun", "#86bf4a");
live.material("apple", "#c42026");
live.material("appleBlush", "#e8562a");
live.material("stem", "#3b2a18");
live.material("grass", "#5c9a3a");
live.material("grassDark", "#437a2c");
live.material("soil", "#6b5236");
live.begin("apple tree");
live.fill(null);

// ground: a disc of grass on a soil rim, with darker tufts
const cx = 32, cy = 32;
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const d = Math.hypot(x - cx, y - cy);
  if (d > 29.5) continue;
  live.set(x, y, 0, "soil");
  live.set(x, y, 1, d > 28.5 ? "soil" : rnd() < 0.18 ? "grassDark" : "grass");
  if (d < 28 && rnd() < 0.06) live.set(x, y, 2, "grassDark");
}

// trunk with a flared base and roots
live.line([cx, cy, 2], [cx + 1, cy, 24], "bark", 2.6);
live.sphere([cx, cy, 3], 3.6, "bark");
for (const [dx, dy] of [[5, 1], [-4, 3], [1, -5], [-2, -4]]) live.line([cx, cy, 3], [cx + dx, cy + dy, 2], "barkDark", 1.2);

// boughs up to the canopy clumps
const tip = [cx + 1, cy, 24];
const boughs = [[cx + 11, cy + 4, 36], [cx - 10, cy + 3, 34], [cx + 2, cy - 11, 35], [cx - 3, cy + 10, 38], [cx + 1, cy, 42]];
for (const b of boughs) live.line(tip, b, "bark", 1.6);

// canopy: overlapping clumps around the bough ends, dark inside, then a sunlit cap on each
const clumps = [];
for (const b of boughs) {
  clumps.push([b, 8.5]);
  for (let k = 0; k < 3; k++) clumps.push([[b[0] + (rnd() - 0.5) * 10, b[1] + (rnd() - 0.5) * 10, b[2] + (rnd() - 0.3) * 6], 5 + rnd() * 3]);
}
for (const [c, r] of clumps) live.sphere(c, r, "leafDark");
for (const [c, r] of clumps) live.sphere([c[0] - 0.6, c[1] - 0.6, c[2] + 1.2], r - 1, "leaf");
for (const [c, r] of clumps) live.sphere([c[0] - 1.2, c[1] - 1.2, c[2] + r * 0.45], r * 0.55, "leafSun");
// ragged edges: little holes and stray leaves
for (let k = 0; k < 220; k++) {
  const [c, r] = clumps[Math.floor(rnd() * clumps.length)];
  const t = rnd() * 2 * Math.PI, u = rnd() * 2 - 1, s = Math.sqrt(1 - u * u);
  const p = [c[0] + r * s * Math.cos(t), c[1] + r * s * Math.sin(t), c[2] + r * u].map(Math.round);
  if (rnd() < 0.5) live.clear(...p); else live.set(...p, u > 0.2 ? "leafSun" : "leaf");
}

// apples on the lower and outer side of the clumps, each with a stem
let apples = 0;
for (let k = 0; k < 400 && apples < 26; k++) {
  const [c, r] = clumps[Math.floor(rnd() * clumps.length)];
  const t = rnd() * 2 * Math.PI, u = -0.7 + rnd() * 0.9, s = Math.sqrt(1 - u * u);
  const p = [c[0] + (r + 0.6) * s * Math.cos(t), c[1] + (r + 0.6) * s * Math.sin(t), c[2] + (r + 0.6) * u];
  if (Math.hypot(p[0] - cx, p[1] - cy) < 9 || p[2] < 26) continue;
  live.sphere(p, 1.6, "apple");
  live.set(Math.round(p[0] - 1), Math.round(p[1] - 1), Math.round(p[2]), "appleBlush");
  live.set(Math.round(p[0]), Math.round(p[1]), Math.round(p[2] + 2), "stem");
  apples++;
}
// two windfalls in the grass
for (const p of [[cx + 12, cy - 6, 3], [cx - 8, cy + 13, 3]]) { live.sphere(p, 1.6, "apple"); live.set(p[0], p[1], p[2] + 2, "stem"); }

live.end();
live.commit();
return { apples, ...live.stats() };
