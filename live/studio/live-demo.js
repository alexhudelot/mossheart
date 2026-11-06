/* The live-mode demo: a pulsing sphere in 8 frames on a stone plinth, with an emissive core seen through a
   cut-away wedge (docs/decisions/2026-10-22-voxel-live.md, section 5). It runs as a function body with
   live in scope, so the bridge and the live self-test run the same code:
     .\tools\voxel-live.ps1 -Open; .\tools\voxel-live.ps1 -File games\MossheartEngine\studio\live-demo.js
   It draws each frame as one undo step, commits it, waits a moment so a watcher sees it grow, then plays
   the flipbook and returns the last frame's hash. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
live.open({ dims: [48, 48, 48], grid: 48, name: "live_demo" });
live.material("demoShell", "#4f9fc4");
live.material("demoCore", { ramp: ["#ff9a3c", 6, 0.25, 0.85, 0.3, 1.1], em: 1 });
const c = [24, 24, 20];
for (let f = 0; f < 8; f++) {
  const r = 11 + 5 * Math.sin((f / 8) * 2 * Math.PI);
  live.begin("frame " + f);
  live.fill(null);
  live.box([10, 10, 0], [37, 37, 1], "stone");
  live.line([24, 24, 2], [24, 24, 8], "stone", 2.5);
  live.sphere(c, r, "demoShell");
  live.sphere(c, r * 0.55, "demoCore");
  live.box([24, 24, 20], [47, 47, 47], null); // the wedge facing the 2:1 camera shows the core
  live.end();
  live.commit();
  await wait(80);
}
live.play(10);
return live.hash();
