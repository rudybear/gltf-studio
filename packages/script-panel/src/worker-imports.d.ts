// Ambient declaration for Vite's `?worker` module-suffix import (monaco-setup.ts):
// Vite rewrites `import X from "./y?worker"` into a `new () => Worker`
// constructor at build time; this package doesn't depend on the `vite` npm
// package itself (whose bundled `client.d.ts` would otherwise provide this)
// just to get one ambient type, so it's declared locally instead.
declare module "*?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
