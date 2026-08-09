// Monaco bootstrap — the ONE module in this package that statically imports
// `monaco-editor` itself. ScriptPanel (script-panel.tsx) only ever reaches
// this file through a dynamic `import()` triggered on first mount, so Vite
// puts `monaco-editor` (a multi-hundred-KB editor, syntax/type-checking
// worker bundles included) in its own chunk, never the main app bundle —
// the "Monaco (dynamic import on first tab open)" half of this package's
// lazy-loading strategy (the other half, the parse Worker/ts-morph, is
// parse-client.ts's job).
//
// Tool choice (noted per the M5 task brief's "your call"): plain
// `monaco-editor` + a hand-wired `MonacoEnvironment.getWorker`, not
// `@monaco-editor/react`. That wrapper's default loader fetches Monaco from
// a CDN (jsdelivr/unpkg) at runtime unless reconfigured — inconsistent with
// this repo's vendoring/self-hosting posture (vendor/*.tgz, no runtime CDN
// dependencies anywhere else in the app) and a real liability for the
// Playwright e2e suite, which drives the BUILT app offline-ish via `vite
// preview`. Depending on `monaco-editor` directly and wiring the two
// workers it actually needs (the generic editor worker for
// bracket-matching/etc., the TypeScript worker for language services) by
// hand keeps every byte same-origin and Vite-bundled.
import * as monaco from "monaco-editor";
// Vite's `?worker` module-suffix import (see worker-imports.d.ts for the ambient type).
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { RUNTIME_LIB_DTS } from "@gltfi/parse-ts/dist/runtime-lib-dts.js";

// Version note: `monaco-editor` is pinned to `^0.50.0` (package.json), not
// latest — 0.55+ restructured `monaco.languages.typescript` into a
// `{ deprecated: true }` stub in favor of a new top-level `typescript`
// namespace backed by a differently-shaped worker/registration setup.
// 0.50.0 still has the classic `languages.typescript.typescriptDefaults` +
// `vs/language/typescript/ts.worker` shape this file (and every "Monaco +
// Vite" community guide) is written against.

// `monaco-editor`'s own bundled types ambiently declare
// `declare global { var MonacoEnvironment: Environment | undefined }` — but
// that is a TYPE-ONLY declaration; it creates no actual runtime binding.
// Every module (including this one) is real ES-module strict-mode code, so
// assigning a BARE `MonacoEnvironment = {...}` (an undeclared identifier)
// throws `ReferenceError: MonacoEnvironment is not defined` at runtime —
// found the hard way via e2e/script.spec.ts (the editor still rendered
// static content, since that came from React state independent of Monaco,
// but the thrown error aborted `loadMonaco()` before `editorRef` was ever
// set, so every edit silently no-opted). `globalThis.MonacoEnvironment =`
// is a plain property assignment on a real object — never throws — and is
// exactly what Monaco's own internals read it back as.
const RUNTIME_LIB_URI = "file:///node_modules/@gltfi/runtime-lib/index.d.ts";

/**
 * `monaco-editor`'s own bundled types declare `MonacoEnvironment` as an
 * ambient global (`declare global { var MonacoEnvironment: ... }`), but
 * whether that merges cleanly into a CONSUMING package's own compiled
 * program turned out to depend on exactly which of `monaco-editor`'s
 * several type entry points this package's `moduleResolution` lands on —
 * redeclaring it here directly clashed with it instead of merging
 * (`TS2451`). Reading/writing through this narrow cast sidesteps that
 * entirely without depending on monaco-editor's ambient declaration at all.
 */
function globalThisWithMonacoEnvironment(): { MonacoEnvironment?: monaco.Environment } {
  return globalThis as unknown as { MonacoEnvironment?: monaco.Environment };
}

let initialized: typeof monaco | null = null;

/**
 * Idempotent — safe to call from every ScriptPanel mount; only the first
 * call does any work. Registers `MonacoEnvironment.getWorker` (module-level
 * global, Monaco's own contract) and the ambient `@gltfi/runtime-lib` `.d.ts`
 * (`RUNTIME_LIB_DTS`, per this package's brief: "check the installed
 * .d.ts" — it is NOT re-exported from `@gltfi/parse-ts`'s package root
 * `index.d.ts`, only from the `dist/runtime-lib-dts.js` subpath used
 * internally by `parseModule`; that package sets no `"exports"` map, so the
 * subpath import above is a real, if undocumented, public seam) so
 * `rt.`/`m.`/`V.`-style completions and hovers work in the editor exactly
 * as `@gltfi/parse-ts`'s own type-checking pass sees them.
 */
export function loadMonaco(): typeof monaco {
  if (initialized) return initialized;

  globalThisWithMonacoEnvironment().MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    }
  };

  // Monaco 0.50.0 bundles its own (older) copy of the TypeScript language
  // service, whose `ScriptTarget`/`ModuleResolutionKind` enums lag the
  // workspace's own `typescript` devDependency (ES2022/"Bundler" don't
  // exist here) — ESNext/NodeJs give equivalent-enough checking behavior
  // for this editor's purposes (in-buffer diagnostics/completions only;
  // the REAL compile gate is `@gltfi/parse-ts`'s own ts-morph project,
  // parse-client.ts, which uses the workspace's real TypeScript).
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowNonTsExtensions: true
  });
  monaco.languages.typescript.typescriptDefaults.addExtraLib(RUNTIME_LIB_DTS, RUNTIME_LIB_URI);
  // GIscript source imports "@gltfi/runtime-lib" by bare specifier — the
  // ambient `declare module "@gltfi/runtime-lib" { ... }` text inside
  // RUNTIME_LIB_DTS itself is what makes that resolve for Monaco's checker
  // (same trick `@gltfi/parse-ts`'s own ts-morph project uses), so no
  // separate path-mapping compiler option is needed here.

  initialized = monaco;
  return monaco;
}
