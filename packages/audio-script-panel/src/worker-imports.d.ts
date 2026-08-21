// Ambient declaration for Vite's `?worker` module-suffix import (monaco-setup.ts):
// copied verbatim from @gltf-studio/script-panel's worker-imports.d.ts — see
// that file's header comment (this package doesn't depend on the `vite` npm
// package itself just to get one ambient type either).
declare module "*?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
