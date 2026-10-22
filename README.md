# Mossheart

A cozy botanic roguelike tower defence in a voxel bell jar.

**Play:** https://alexhudelot.github.io/mossheart/

Also hosted here for now, until they get their own repositories:

- **Tactics**, a cyberpunk voxel tactics game on the same engine: https://alexhudelot.github.io/mossheart/tactics/
- **Voxel Studio**, the engine's asset studio: https://alexhudelot.github.io/mossheart/studio/

They run in Chrome or Edge with WebGPU, on a computer or on Android 12+ (Chrome 121+), and in Safari 26+.
Some phone GPUs (Samsung Xclipse, for one) are blocklisted in Chrome: turn on
`chrome://flags/#enable-unsafe-webgpu`, tap Relaunch, and reload.

Mossheart's controls: drag to pan, wheel to zoom, Q/E to turn, 1–4 to pick a seed, space to start a wave.

`index.html`, `tactics/index.html` and `studio/index.html` are one-file builds (every script inlined; Tactics' portraits beside it).
The source lives in a private repository; this one only hosts the builds.
