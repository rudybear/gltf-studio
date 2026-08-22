// Ambient declaration for Vite's `?url` module-suffix import
// (esbuild.worker.ts's `esbuild-wasm/esbuild.wasm?url`) — same "this package
// doesn't depend on the `vite` npm package itself just to get one ambient
// type" rationale as packages/script-panel/src/worker-imports.d.ts's own
// `*?worker` declaration.
declare module "*?url" {
  const url: string;
  export default url;
}
