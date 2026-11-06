# Voxel Studio v1

`studio/index.html` views and edits voxel assets for the Mossheart Engine. Open it in Edge or Chrome. It needs WebGL2, has no build step, and works from `file://`.

## Viewing

The library lists every model the engine knows. Groups:
- studio assets, the asset-set showrooms (towers per level, Heart Tree hurt states, enemies, props) and the mockup themes
- critter flipbooks (`ME.content.critters`), the Momiji Valley placements and the generator's models

A model is baked by the engine's own voxeliser (`ME.voxelizeModel` with `ME.Palette`) at 16 voxels per tile, with the content pack's lighting classes and model sizes. It is drawn with the engine's model lighting: wrapped lambert, ambient, canopy offset, baked AO, each material's 16-step ramp, voxel grain and emissive glow. The camera uses the engine's 2:1 projection, with 90° snaps and an optional free orbit. Flipbooks play over `o.t`. Debug views: albedo, normals, AO, material ids. The status line shows voxel counts and the asset's cost in the engine's brick pool.

## Editing

You edit studio assets. "New asset" starts one. "Fork" turns any library model into an editable copy: its prims become shapes and its `detail` painting is kept by reference. A fork bakes voxel-identical to its source, which the self-test checks. Tools:
- **Shapes:** the generator's sphere, ellipsoid, capsule, box and cylinder. Each has smooth blend, carve (with a cut material), rotation, displacement, mirror in y and a looping motion over the asset's frames. Click a shape to select it. Drag its handles: the square moves it, the coloured dots move it along an axis, the gold dots resize it. Drags snap to the voxel grid.
- **Voxels:** add, erase, paint, bucket fill and pick, with a sphere or cube brush. Alt+click picks a material. Add also works on the ground.
- **Materials:** all ramps from every style. You can make your own from the generator's ramp spec (base colour, steps, dark/light L, hue shift, saturation), with a lighting class and an emissive flag that gives the material a point light in scenes.
- **Detail rules:** "material X facing up past n.z, where noise > t, becomes Y", the declarative form of the generator's detail functions.
- Undo/redo (Ctrl+Z / Ctrl+Y) and a local library (localStorage). The current asset is autosaved.

**Import / export:**
- Asset `.json`.
- An engine script `.js` holding one asset, or a pack of all of them (`assets/pack.js`).
- MagicaVoxel `.vox` in both directions. An import becomes a voxel layer with one material per colour.
- PNG.

"Preview in engine" opens `index.html?gallery=studio`, with the asset beside the ones in the pack.

Keys (by position: on AZERTY they are where QWERTY has them, and the buttons show your layout's letters): V select · A add · X erase · P paint · F fill (frame when selecting) · I pick · `,` `.` (or Q E) turn 90° · Space play · `[` `]` brush · Del delete shape · Ctrl+D duplicate · Ctrl+S save · Esc deselect. Right drag orbits, middle or Shift drag pans, the wheel zooms.

## Asset format (`src/asset-format.js`)

A studio asset is a JSON document (`"format": "mossheart-asset", "version": 1`). The full schema is in the file header. It holds:
- shapes
- a voxel layer: an RLE grid of material slots and erased cells, at `grid` cells per model unit (16 × k by default, aligned with the engine's voxels)
- per-voxel paint, detail rules, its own materials, `k`, `frames`
- an optional `base` model whose `detail` it inherits

`MossAsset.register(doc)` makes the document an ordinary generator model:
- `MODELS[name] = (o) => MossAsset.build(doc, o)`
- its materials go into every loaded style
- it becomes a volume deco with `ME.FRAMES` flipbook frames, and its source joins the bake-cache key (`ME.ASSET_SRC`)

From then on the engine treats it like any other model. You can place it in a style's `deco` list or show it with `?gallery=studio`. A forked model keeps its source's `r`/`h`, which the game uses for proxies and cameras. These grow only when edits would leave the voxeliser's scan box.

The only engine change is a function primitive in `src/sdf.js` (`k: 5`, `p.f(dx, dy, dz)`, which may set `p.m`). A voxel layer compiles to one such prim: a signed distance field sampled at cell centres from a Euclidean distance transform. Erased cells become a second, carving prim. So a large `.vox` import stays one prim, and the voxeliser's empty-brick test stays conservative. The vendored pixel generator (`px.js`) has no function prim. It draws shape-only assets but not voxel layers.

## Live mode

`index.html?live=1` gives the whole window to one viewport and a voxel API, `window.live`, which the page and an agent both call. The design is `docs/decisions/2026-10-22-voxel-live.md`. The agent reaches the page through `tools/voxel-live.ps1` at the repo root, over the DevTools protocol. There is no server.

**The space** is one box of cells, `dims` at `grid` cells per tile, with its anchor at the ground centre. The default is a sprite: 64³ at grid 64. `live.open({ tile: true, grid: 16, h: 2 })` gives a 16 × 16 × 32 tile volume. Each axis has at most 128 cells, and a space holds at most 64 frames and 254 materials. Its limit is a cell budget: at most 256 cells per axis and 8,388,608 (2²³) in all, so 256 × 256 × 128, 192³ or a tall 96 × 96 × 256 fits; `grid` is at most 128. A committed frame keeps 2 bytes a cell of its tight box (its slots and its layer) and 12 a surface cell (the viewer's set, which playback uploads as it is), not its colours; frames hold at most 256 MB in all (`stats().frameMB`). An edit re-sends to the viewer only the bricks it reshaded. Above 2²⁰ solid cells (about 0.4 s of bake), or a tight box of more than 2²¹ cells (a hollow room), the idle exact bake is skipped and the live shading stays (`stats().exactSkipped`), as it does for a committed frame that big; `live.exact()` bakes it on request (it blocks, about 1.5 s for 4 M solid cells), for the exact look before a shot. While a frame or the exact bake shows, the viewer keeps the live space's set, so the next edit still re-sends only its bricks.

**The viewport** has:
- the studio's camera and lighting: drag orbits, Shift drag pans, the wheel zooms, `,` `.` turn 90°, F frames the space;
- the space's wire box, and floor lines at every cell, every 8 cells (the brick edges) and the tile edges;
- a stats overlay: dims, solid and surface voxels, occupied 8³ bricks, frames and playback, the last call and its ms, calls per second, undo depth, the shading tier, and an error the draw loop caught (it keeps drawing);
- a frame strip: click a frame to show it. Space plays or stops, ← → step through the frames, and Ctrl+Z / Ctrl+Y undo and redo.

It draws only after a change, while the camera moves or while playing. `live.drawn()` resolves after the next frame drawn with nothing left to upload, `{ frame, ms }`, and fails after 2 s when the page is not drawing.

**Shading** comes in two tiers. After every call, the changed box plus 7 cells is reshaded from occupancy: normals from the 26 neighbours, and AO at the voxeliser's radii. 250 ms after the last call, and for every committed frame, the engine's own bake (`MossAsset.build` + `ME.voxelizeModel` at `vs = grid`) replaces that shading.

**The API.** Cells are integer `[x, y, z]`, with z up and `[0, 0, 0]` at the space's min corner. A cell's centre is its integer point. `m` is a material name, and `null` clears. Cells outside the space are clipped and counted. Every call is synchronous and returns a small JSON value. An edit returns `{ changed, clipped, ms }` and is one undo step. Bad input throws, and the message names the argument.

| Call | Does |
|---|---|
| `open({ dims, grid, tile, h, name, label })` | a new space: drops the canvas, frames and undo |
| `set(x, y, z, m)` · `clear(x, y, z)` · `get(x, y, z)` | one voxel |
| `box(a, b, m)` · `fill(m, a?, b?)` | a box (inclusive corners); `fill` defaults to the whole space |
| `sphere(c, r, m)` · `line(a, b, m, r = 0)` | cells within `r` of `c`; a 3D DDA, or a capsule when `r > 0`. `c`, `a` and `b` may be fractional: the DDA rounds the points along the exact segment, the capsule measures to it. |
| `flood(x, y, z, m)` | 6-connected bucket fill of that cell's region |
| `patch(layer)` · `read(a?, b?, enc = "rle")` | the batch: an asset-format layer `{ o, n, mats, rle \| b64 }` in space cells, x fastest. **Values are 1-based: 0 leaves a cell, 1–254 set `mats[v − 1]`, 255 clears.** So `{ mats: ["skin", "hair"] }` writes skin as 1 and hair as 2. `patch` returns `unused`, the names in `mats` that no cell used. It adds a `warn` (also logged) when 0 and 255 both occur and the last name is unused, the pattern of values written 0-based. `read` writes empty cells as 255, so `patch(read(a, b))` restores a box. |
| `material(name, spec)` · `materials({ name: spec, … })` · `mats()` | own materials: `"#rrggbb"`, or the format's (and the palette's own) material object `{ ramp, em?, cls?, wrap?, bias? }`, passed whole: `live.material(n, { ramp: TC.palette.ramps[n], ...TC.palette.mats[n] })`. `ramp` is any ramp the palette takes: a generator spec `[hex, steps, darkL, lightL, hueShift, sat]`, or a list of colours of any length (16 keeps cel bands exactly). `materials` installs many at once and returns `{ names, own }`. `em` is the glow's gain: 1 (or `true`) the full glow, about 0.5 keeps a pale neon's hue at its core, 0 none; the viewer and the engine both scale the glow by it, and the studio's material editor sets it as "glow". A name takes a palette id only when a cell first uses it. |
| `commit(i?)` · `show(i)` · `drop(i)` · `frames()` | frames: commit the canvas, load a frame into it (stops playback), remove one, list `{ i, solid, hash }` |
| `model(name, o?, { tall, vs, at, open, clip })` · `put(vol, at?)` | a library model in one call: `ME.modelOf(name, o)` (`window.MODELS[name](o)` with its scale) voxelised through the page's palette and put standing on cell `at` (the space's anchor by default), as one undo step. `tall` is its height in cells, else `vs` its voxels per tile, else the space's `grid`. `open: true` first opens a space fitted to it at `grid = vs` (so `vs` at most 128, the grid's limit). `clip: [z0, z1]` keeps only the cells `z0..z1` above its lowest (a bust), standing on `at`. `name` may be a `[name, o]` pair, with the options second. Returns `{ changed, clipped, solid, mats, missing, name, vs, dims, hash }`; `missing` lists materials the palette lacks, drawn as stone. `put` takes a volume already voxelised: `{ dims, rgba, names, box? }`, `ME.voxelizeModel`'s output plus `names[id]`, the palette's names. |
| `animate({ frames, fps?, loop?, replace?, tall, vs, at, open, clip }, fn)` · `tween(keys, t, ease?)` | a flipbook of poses in one call: `fn(t, i)` gives frame `i`'s model, `{ name, o }` or `[name, o]`, with `t = i / frames` (a loop's last frame leads back to the first; `loop: false` gives `i / (frames - 1)`, ending on 1). Each frame is voxelised as `model` does, all at one density (`tall`: frame 0's height), drawn over the canvas as it was and committed as frame `i`. Committed frames are replaced only with `replace: true` (undo does not bring them back). `open` fits a space to all of them. Frames are voxelised one at a time (with `open`, first measured, and kept up to 64 MB). The canvas is left on the last frame, and one undo takes it back. Returns `{ frames, fps, vs, at, hashes, clipped, missing, ms, msPerFrame }`. `tween(keys, t, ease = "inOut")` gives the pose at `t` from `keys: [{ t, pose }]`: numbers lerped (nested objects and arrays too), anything else the earlier key's; `ease` is `linear`, `in`, `out`, `inOut` or a function on 0..1. It needs no space: `live.animate({ frames: 16, tall: 30, open: true }, (t) => ["mushroom", { t }])`, or a pose per frame with `(t) => [name, live.tween(keys, t)]`. |
| `play(fps = 12)` · `stop()` | play the committed frames |
| `begin(label)` · `end()` · `undo()` · `redo()` | one undo step for the calls between; up to 100 steps or 64 MB of before-images |
| `view({ fit, fill, yaw, pitch, zoom, target, engine })` | the camera, at once. `fit: "solid"` frames the solid cells' tight box and `"space"` the whole space, so that it takes `fill` (0.85) of the view. `yaw` and `pitch` are in degrees (a `pitch` leaves the engine's 30° view), `target` in space cells, `zoom` in device pixels per cell (CSS pixels × `devicePixelRatio`, as `shot` counts them); `engine: true` is the engine's view. Returns `{ yaw, pitch, zoom, target, engine }`; with no argument it only reads. |
| `shot({ w, h, alpha, lines })` | a PNG data URL of the viewport alone, drawn in the call with the latest edit: `w × h` pixels (the canvas's size by default, at most 2048 each) at the view's framing (the same share of the height), transparent with `alpha`, with the box and floor lines only with `lines` |
| `hash()` · `stats()` · `drawn()` | FNV-1a 32 of the canvas (below); what the overlay shows, with `cells`, `frameMB` (of `frameMBMax`), `pool` (`{ bricks, max, warn }`: the bricks a save of these frames takes in the engine's pool, its ceiling, and `warn` past a quarter of it, also logged once), `error` (the draw loop's last caught error and its count, or null); a promise of the next frame drawn with the latest edit |
| `exact()` | the exact bake of the canvas now, whatever its size (the idle bake skips big spaces); it blocks while it bakes. `{ ms, solid }` |
| `save({ name, label })` · `load(doc)` | the live document: a flipbook of the committed frames (the canvas when none), kept in the local library (a cache: a model is saved once it is on disk, below). `load` takes it back; its space is the union of the frames' layers, kept centred on the anchor. |
| `models()` · `loadSaved(name)` · `saveModel({ name, label })` · `deleteModel(name)` · `modelsFolder()` | the saved models on disk (below), all async: the folder's `[{ name, label, frames, dims, grid, kb, modified }]`, newest first; one loaded by name and framed; `save` written to the folder as `NAME.json` (`{ name, file, frames, kb }`); a file removed; and the folder (`{ dir, chosen, write, other, note }`). Writing needs the folder chosen in the picker; without it they fail, naming the bridge command. |

`hash()` is FNV-1a 32 over the canvas's tight box. It hashes, in this order:
- the box's anchor-relative min corner and its size (int32 LE);
- each cell in x, y, z order, as 0 or 1 + the rank of its material among the sorted names in use;
- those names, joined by `\n`.

So it depends on neither slot order nor the space's size, and a frame hashes the same after `save` and `load`.

**A live document** is an ordinary studio asset:

```
{ format: "mossheart-asset", version: 1, name, label, k: 1, grid, frames: n, fps, prims: [], vox: [layer × n], mats }
```

Each layer is its frame's tight box. `MossAsset.register(doc)` makes it a flipbook model (`ME.FRAMES[name] = n`).

**Saved models live on disk**, one `NAME.json` per model (the document `save` returns) in the models folder, `C:\ClaudeWorkspace\voxel-live-models` (beside the repository, outside git and the Edge profile; the page's `?models=`, the bridge's `-ModelsDir`). The folder is the source of truth; the local library only caches.
- **The picker:** the overlay's **Models** button lists the folder, newest first (name, label, frames, dims, size, date). A click loads one and frames it. **Delete** asks again in place, then removes the file. **Save** asks for a name (an identifier, by default the space's) and a label, and writes `NAME.json`, replacing it. Escape closes the picker; while it is closed, the viewer's keys work as before. At phone width it fills the width.
- **How the page reaches the folder:** it reads by `fetch` of `file:///` (the viewer runs with `--allow-file-access-from-files`) and lists from Chromium's directory listing. It writes and deletes through a folder handle (the File System Access API): the first Save, Delete or **Folder…** asks you to pick the folder once, and the handle is kept in IndexedDB. A later session asks again for write permission on the first click. Without a handle the folder is read-only in the page: the picker says so and names the bridge command.
- **What can fail:** a missing folder, or a page without file access, makes the list say "can't read the models folder ...". A refused or failed write says "not on disk" in the picker and in the stats panel (`saved NAME · not on disk: why`); the stats panel says "on disk" once the file is written. A folder picked other than the models folder is named in a warning.

**The bridge** (from the repo root):

```
.\tools\voxel-live.ps1 -Open                                    # starts the viewer if needed (Edge on port 9900, profile %LOCALAPPDATA%\lab-voxel-live), reloads, live.open
.\tools\voxel-live.ps1 -Open -Tile -Grid 16 -H 2                # a tile volume
.\tools\voxel-live.ps1 -Eval "live.sphere([32,32,24], 14, 'moss')"
.\tools\voxel-live.ps1 -File games\MossheartEngine\studio\live-demo.js   # the demo: a pulsing sphere in 8 frames
.\tools\voxel-live.ps1 -Eval "live.read()" -Out cells.json      # large values into a file
.\tools\voxel-live.ps1 -Save hero -Label "Hero idle"           # live.save to the models folder as hero.json (-ModelsDir to change it)
.\tools\voxel-live.ps1 -Load hero                              # hero.json into live.load, framed
.\tools\voxel-live.ps1 -Models ; .\tools\voxel-live.ps1 -Delete hero   # the folder as JSON, newest first; a file removed (no viewer needed)
.\tools\voxel-live.ps1 -Save asset.json ; .\tools\voxel-live.ps1 -Load asset.json   # a path (with \, / or .json) instead of a name
.\tools\voxel-live.ps1 -Shot view.png                           # what the viewer shows, once it has drawn the last edit
.\tools\voxel-live.ps1 -Eval "live.view({ fit: 'solid' })"      # frame the figure
.\tools\voxel-live.ps1 -Shot hero.png -Clean -W 1024 -H 1024 -Alpha   # the viewport alone, transparent
.\tools\voxel-live.ps1 -Owner Art-Tactics -Eval "live.hash()"   # name yourself for the lease; -Take takes the viewer over
.\tools\voxel-live.ps1 -Open -Game Tactics                      # a game's page: its art and palette, then live.model("name", {}, { tall: 120 })
.\tools\voxel-live.ps1 -Close
```

- `-Eval` and `-File` evaluate as the DevTools console does (CDP's REPL mode): the last expression's value prints as JSON, and top-level `await` works. Code with a top-level `return` (a function body, like `live-demo.js`) runs through `live.run` instead and prints what it returns. As in the console, top-level `const` and `let` persist between calls on the same page, and a later call may declare them again. An exception prints its message and exits 1.
- **The lease.** One owner uses the viewer at a time. The owner is `-Owner <role>`, else `$env:LAB_ROLE`, else the Claude session. Every call renews the lease in `%LOCALAPPDATA%\lab-voxel-live.lock`. Another owner's call fails at once, naming the owner and their last call. The lease lapses after 15 idle minutes, `-Take` takes it over, and `-Close` frees it (closing another owner's viewer needs `-Take`). The page title shows the owner. `-Headless` takes no lease.
- `-Shot <f.png> -Clean [-W n] [-H n] [-Alpha]` writes `live.shot`: the viewport alone, without the panels. `-H` is the shot's height here and the tile's height with `-Tile`, so the two go in separate calls.
- **A game's page:** `index.html?live=1&game=<folder under games/>` (the bridge's `-Open -Game <folder>`) skips Momiji's content and asset set and loads the game's `content/manifest.js`. That file sets `window.STUDIO_GAME = { files, style(q) }`: the page loads `files` from the game's folder, in order, and builds its palette from `style(q)`, where `q` is the page's query (a game may read `?map=` or `?mood=`). `live.game` names the game. The engine never names a game, so the game owns this list.
- Each call costs a PowerShell start and a socket connect, about 0.3–0.5 s. So batch with `patch`, or loop inside one `-File` script.
- The viewer is a visible window on its own profile, outside the headless GPU lock, and costs no GPU while idle. `-Headless -Port <n>` is for checks: it runs headless under the lock on a fresh profile.
- The viewer keeps drawing while it is covered or minimized: `-Open` launches Edge with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`. `-Open` starts Edge only when nothing answers on port 9900, so a viewer started before these flags keeps its old ones: run `-Close`, then `-Open`, once. Idle, it still draws nothing.
- `-Shot` waits for `live.drawn()` first, so the shot shows the last edit. It fails after 2 s if the page is not drawing.

## Files

| | |
|---|---|
| `index.html` | the page, its styles, and the script list: the generator, the engine's bake pieces (no WebGPU renderer), the content pack, the asset kit and set, the asset format and pack |
| `studio.js` | state, library, bake, tools, panels, undo; `?selftest=1` and `?shots=` |
| `view.js` | the WebGL2 viewport: one instanced cube per surface voxel, the engine's model lighting, camera, DDA picking |
| `io.js` | MagicaVoxel `.vox` read and write, downloads, file picking, the local asset library (localStorage) |
| `live.js` | live mode (`?live=1`): the space, its shading, overlay and frame strip, `window.live`, and its `?selftest=1` |
| `live-demo.js` | the live demo, run by `tools/voxel-live.ps1 -File` and by the live self-test |

## Checks

From `games/MossheartEngine`:

```
.\tools\run.ps1 -Page studio/index.html                    # self-test: every library model bakes, forks are voxel-identical, voxel layer / paint / mirror / motion / rotation, .vox and script round trips, pointer flow (select, handle drag, add, Ctrl+Z), panels
.\tools\run.ps1 -Page studio/index.html -Extra "live=1&selftest=1"   # live mode: a fixed script of every call to a known hash, read/patch (rle, b64), undo/redo, clipping, commit/save/load, the format round trip, register, a 64³ timing case, the demo, playback that starts late and a draw error the loop survives, drawn(), view() and shot(), the patch warning, materials(), model() (tall, open, clip, one undo step), put(), animate() (frames through model()'s path, over the canvas, one undo step) and tween()
.\tools\run.ps1 -Page studio/index.html -Extra "live=1&selftest=1&game=Tactics"   # a game's page: every model its files define, through live.model and the game's palette, with no material missing
.\tools\run.ps1 -Page studio/index.html -Shots "ms_heart,doc:studio_hokora"   # studio viewport PNGs
.\tools\run.ps1 -Shots "l,a-studio_toro,a-studio_hokora" -Extra "gallery=studio&units=0"   # the pack in the engine
```
