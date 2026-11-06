# Vendored Mossheart generator

Copied unchanged on 2026-10-18 from `C:\ClaudeWorkspace\mossheart-art\pixel\gen\` (round-5 "Momiji Light" state):

px.js, px3.js, models.js, styles.js, models2.js, models3.js, styles2.js, styles3.js, styles4.js, styles5.js

Loaded in gen.html's order. `build.js` and `zoom.js` (the 2D renderer and its UI) are not needed.
The engine reads the scene from `window.STYLES.find(s => s.id === "mf-valley")` and the models from
`window.MODELS`. The two private SDF functions (`evalModel`, `dPrim`) are ported verbatim in `src/sdf.js`
instead of patching these files, so they can be re-copied whenever the art changes.
