// Monaco bootstrap for the Audio Script tab — the audio sibling of
// @gltf-studio/script-panel's monaco-setup.ts. Copied rather than shared
// (see specs/ux-audio-script.md's Implementation notes for the "shared vs
// copied" call): extracting a common monaco-bootstrap package was judged
// non-trivial today given the two packages' differing ambient-lib specifics
// (two different runtime-lib `.d.ts` modules, `@gltfi/runtime-lib` vs
// `@gltf-audiograph/runtime-lib`) and the risk of touching working,
// well-tested script-panel code for this PR's sake. This file's own
// module-scope `initialized` singleton is INDEPENDENT of script-panel's own
// — both are safe to call regardless of order or of whether both tabs are
// ever opened in the same session: `MonacoEnvironment.getWorker` and
// `typescript.typescriptDefaults.setCompilerOptions` are idempotent
// (functionally identical values each time), and `addExtraLib` accepts
// multiple ambient modules with different specifiers with no conflict — the
// global `monaco.languages.typescript.typescriptDefaults` registry is a
// single page-wide object, not scoped per caller, so both `@gltfi/runtime-
// lib`'s and `@gltf-audiograph/runtime-lib`'s ambient declarations coexist
// on it once both tabs have been opened at least once. Verified in e2e (see
// e2e/audio-script.spec.ts) with both the Script and Audio Script tabs
// opened in the same session.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { RUNTIME_LIB_DTS } from "@gltf-audiograph/parse-ts/runtime-lib-dts";

const RUNTIME_LIB_URI = "file:///node_modules/@gltf-audiograph/runtime-lib/index.d.ts";

/** See script-panel's own monaco-setup.ts for why this narrow cast (not an ambient `declare global`) is used to read/write `MonacoEnvironment`. */
function globalThisWithMonacoEnvironment(): { MonacoEnvironment?: monaco.Environment } {
  return globalThis as unknown as { MonacoEnvironment?: monaco.Environment };
}

let initialized: typeof monaco | null = null;

/** Idempotent — safe to call from every AudioScriptPanel mount; only the first call does any work. See this file's header for why it doesn't share script-panel's own singleton. */
export function loadMonacoAudio(): typeof monaco {
  if (initialized) return initialized;

  globalThisWithMonacoEnvironment().MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    }
  };

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

  initialized = monaco;
  return monaco;
}
