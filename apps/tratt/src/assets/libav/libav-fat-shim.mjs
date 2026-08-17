// Polyfill `global` (Node.js) for browser module workers before loading the
// fat libav.js WASM which uses `global._scriptDir` to declare a global var.
self.global = self;
await import('./libav-6.0.0-nightly.29.f420ff.ffmpeg.6.1.1-fat.wasm.mjs');
