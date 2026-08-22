// The Audio Script tab (specs/ux-audio-script.md UX-1400): Monaco over the
// current KHR_audio_graph graph's audio-script. Owns the whole graph<->code
// round trip for the Audio Script tab's purposes — nothing outside this file
// calls `@gltf-audiograph/{ir,emit-ts,parse-ts,verify}` or
// `AudioGraphEdit.replaceAudioGraph`/`SceneEdit.setAudioSourceProperty` for
// them. Mirrors @gltf-studio/script-panel's script-panel.tsx one transpiler
// over, with two deliberate fidelity reductions (both documented in
// specs/ux-audio-script.md's Implementation notes rather than silently
// dropped):
//   1. Cross-highlight here is a plain "select + reveal" on the identifier
//      range — no persistent amber decoration, no auto-fade timer, no
//      click-elsewhere echo tracking. `audio-cross-highlight.ts`'s lookup
//      itself is simpler AND more reliable than the interactivity side's
//      (direct index -> identifier, no ambiguous string search), but the
//      surrounding UI polish script-panel.tsx built up over several rounds
//      of e2e-driven bug fixes was judged not worth re-deriving for this
//      PR's scope — a real gap, not a hidden one.
//   2. No pointer-path-link provider: audio-script identifiers never inline
//      a glTF pointer path the way `pointer/set`/`pointer/interpolate`
//      GIscript calls do, so there is nothing for `pointer-links.ts`'s
//      approach to find here.
import { useEffect, useRef, useState } from "react";
import { AudioGraphEdit, SceneEdit, combineCommandParts, makeCommandId, getIn, type AudioGraphSpec, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import { exportAudioGraph, type AudioIRModule, type Diagnostic, type EmitterBlockLike } from "@gltf-audiograph/ir";
import type * as Monaco from "monaco-editor";
import { buildAudioEmitView, namesForAudioModule } from "./emit-view.js";
import { checkAudioEquivalence, type AudioEquivalenceResult } from "./equivalence.js";
import { findHighlightForAudioNode, findHighlightForAudioSource, offsetToLineColumn } from "./audio-cross-highlight.js";
import { AudioParseClient } from "./parse-client.js";

const PARSE_DEBOUNCE_MS = 300;
const MARKER_OWNER = "gltf-studio-audio-script";

export type AudioScriptPanelProps = {
  document: EditorDocument;
  /** Which `extensions.KHR_audio_graph.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  /** specs/ux-audio-script.md UX-1400: the audio-graph canvas's selection, pre-resolved by the caller (AudioScriptTabPanel.tsx) via `@gltf-studio/audio-canvas`'s `identifyMappedNode` — a `graph.nodes[]` index, or `null` when nothing/a non-node entity is selected. Kept as a bare number here (not `AudioEntity`) so this package takes no dependency on `@gltf-studio/audio-canvas`. */
  selectedNodeIndex: number | null;
  /** Same idea, for a selected synthetic `audio-buffer-source` canvas entity (a `KHR_audio_emitter` source index) — mutually exclusive with `selectedNodeIndex` (the canvas selects at most one entity). */
  selectedSourceIndex: number | null;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  onToast?: (text: string) => void;
  /** specs/ux-audio-script.md UX-1400: the "→ Audio graph" jump from a diagnostic naming a `graph.nodes[]` index (only `importAudioGraph`'s own diagnostics carry one — a hand-edited buffer's parse diagnostics are script-position-only, not graph-index-only, so this never fires for those). */
  onJumpToAudioGraphNode?: (nodeIndex: number) => void;
};

type Mode = "view" | "edit";
type ParseStatus = "clean" | "error" | "pending";

/** Test-only seam (no UX-### requirement covers it — same pattern as script-panel's `window.__gltfStudioScriptTest`). */
export interface GltfStudioAudioScriptTestHook {
  setValue(text: string): void;
  getCode(): string;
  getSelectedText(): string | null;
  getMarkerLines(): number[];
  /**
   * e2e-only: reads the CURRENT document's raw JSON. Unlike
   * `AudioGraphTabPanel.tsx`'s own `window.__gltfStudioAudioGraphTest`
   * (only installed while the plain-conditionally-mounted Audio graph tab
   * is itself active), this tab is mounted-but-hidden (UX-1408) so this
   * hook stays installed and useful for asserting the document's
   * `KHR_audio_graph` state from the Audio Script tab without first
   * switching tabs.
   */
  getDocumentJson(): unknown;
}

declare global {
  interface Window {
    __gltfStudioAudioScriptTest?: GltfStudioAudioScriptTestHook;
  }
}

function diagnosticLine(d: Diagnostic, lineCount: number): number {
  const line = d.line ?? 1;
  return Math.min(Math.max(line, 1), lineCount);
}

function emitterBlockOf(document: EditorDocument): EmitterBlockLike | undefined {
  return getIn(document.json, ["extensions", "KHR_audio_emitter"]) as EmitterBlockLike | undefined;
}

export function AudioScriptPanel({
  document,
  graphIndex = 0,
  dispatchCommand,
  selectedNodeIndex,
  selectedSourceIndex,
  onLog,
  onToast,
  onJumpToAudioGraphNode
}: AudioScriptPanelProps): JSX.Element {
  const graphs = getIn(document.json, ["extensions", "KHR_audio_graph", "graphs"]) as unknown[] | undefined;
  const hasGraph = graphs !== undefined && graphs.length > graphIndex;
  const rawGraph = hasGraph ? graphs![graphIndex] : undefined;

  const [mode, setMode] = useState<Mode>("view");
  const [code, setCode] = useState<string>("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [sourceNames, setSourceNames] = useState<Record<number, string>>({});
  const [parseStatus, setParseStatus] = useState<ParseStatus>("clean");
  const [equiv, setEquiv] = useState<AudioEquivalenceResult>({ status: "equiv" });
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [monacoReady, setMonacoReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const parseClientRef = useRef<AudioParseClient | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCleanModuleRef = useRef<AudioIRModule | null>(null);
  /** The current document graph's own imported module — used only to derive `docSources` for `checkAudioEquivalence` (see that module's own header) and kept fresh independent of `mode`. */
  const documentModuleRef = useRef<AudioIRModule | null>(null);
  const codeRef = useRef(code);
  /** Kept fresh every render (not just on mount) so the e2e `getDocumentJson()` hook below always reads the LATEST document, not whichever one was current when the hook-install effect (mount-only) last ran. */
  const documentRef = useRef(document);
  documentRef.current = document;
  /**
   * Bug fix (r2 migration's canvas -> script round-trip e2e, "round trip: a
   * graph built purely via the canvas palette..."): the parse-worker
   * `onResult` callback below lives inside a MOUNT-ONCE effect (`[]` deps)
   * — without these two refs it closes over `rawGraph`/`mode` from
   * whichever render happened to be current when the panel FIRST mounted,
   * not the CURRENT one. This tab stays mounted-but-hidden across tab
   * switches (UX-1408), so any later external edit to the document's audio
   * graph (e.g. via the Audio graph canvas, while this tab isn't even
   * visible) left `onResult` comparing a freshly-reparsed buffer against
   * that STALE original graph the instant a parse happened to resolve —
   * spuriously flipping the EQUIV badge to DIVERGED with a real (but
   * meaningless) diff, and never correcting itself since nothing re-runs
   * that effect afterward. Kept fresh every render, exactly like
   * `documentRef` immediately above.
   */
  const rawGraphRef = useRef(rawGraph);
  rawGraphRef.current = rawGraph;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const isProgrammaticContentSetRef = useRef(false);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const loggedErrorKeyRef = useRef<string>("");

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // UX-1400: regenerate the Emit view whenever the document's audio graph
  // changes; while editing, re-evaluate EQUIV against the (possibly
  // changed) document graph instead, without discarding the buffer.
  useEffect(() => {
    if (!rawGraph) {
      documentModuleRef.current = null;
      if (mode === "view") {
        setCode("// Import or create a KHR_audio_graph graph to see its generated script.\n");
        setNames({});
        setSourceNames({});
        setDiagnostics([]);
        setEquiv({ status: "equiv" });
        setParseStatus("clean");
      }
      return;
    }
    const view = buildAudioEmitView(rawGraph, graphIndex, emitterBlockOf(document));
    documentModuleRef.current = view.module;
    if (mode === "view") {
      setCode(view.code);
      setNames(view.names);
      setSourceNames(view.sourceNames);
      setDiagnostics(view.diagnostics);
      setEquiv({ status: "equiv" });
      setParseStatus("clean");
    } else if (lastCleanModuleRef.current) {
      setEquiv(checkAudioEquivalence(rawGraph, view.module, lastCleanModuleRef.current));
    }
  }, [document, graphIndex, mode]);

  function applyMarkers(diags: Diagnostic[]) {
    const monacoApi = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!monacoApi || !model) return;
    const lineCount = model.getLineCount();
    const markers: Monaco.editor.IMarkerData[] = diags
      .filter((d) => d.severity === "error")
      .map((d) => {
        const line = diagnosticLine(d, lineCount);
        const startColumn = d.column ?? 1;
        // `span` is a character-offset range into the whole source text;
        // its length approximates the token width on THIS line (accurate
        // for the common single-line-token case parse-ts's diagnostics
        // report, per gltf-studio #31's structured-position work on the
        // interactivity side) — falls back to the whole line when absent.
        const endColumn = d.span ? startColumn + (d.span.end - d.span.start) : model.getLineMaxColumn(line);
        return {
          severity: monacoApi.MarkerSeverity.Error,
          message: d.message,
          startLineNumber: line,
          startColumn,
          endLineNumber: line,
          endColumn
        };
      });
    monacoApi.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }

  function logDiagnostics(diags: Diagnostic[]) {
    const errors = diags.filter((d) => d.severity === "error");
    const key = errors.map((d) => `${d.code}:${d.message}`).join("|");
    if (errors.length === 0) {
      loggedErrorKeyRef.current = "";
      return;
    }
    if (key === loggedErrorKeyRef.current) return;
    loggedErrorKeyRef.current = key;
    errors.forEach((d) => onLog?.("error", `Audio script: ${d.message}`));
  }

  // Parse worker lifecycle: one AudioParseClient per mount.
  useEffect(() => {
    const client = new AudioParseClient({
      onResult: (result) => {
        setDiagnostics(result.diagnostics);
        applyMarkers(result.diagnostics);
        logDiagnostics(result.diagnostics);
        const hasErrors = result.diagnostics.some((d) => d.severity === "error");
        if (hasErrors) {
          setParseStatus("error");
          return;
        }
        setParseStatus("clean");
        lastCleanModuleRef.current = result.module;
        const derived = namesForAudioModule(result.module);
        setNames(derived.names);
        setSourceNames(derived.sourceNames);
        // See rawGraphRef/modeRef's doc comment above: both read fresh
        // (never stale-closed) values, and `mode === "edit"` guards against
        // a parse that was in flight when the tab flipped back to "view" —
        // that mode's own `[document, graphIndex, mode]` effect already
        // owns EQUIV in that case (always "equiv" while merely viewing).
        if (modeRef.current === "edit" && rawGraphRef.current && documentModuleRef.current) {
          setEquiv(checkAudioEquivalence(rawGraphRef.current, documentModuleRef.current, result.module));
        }
      },
      onError: (message) => {
        onLog?.("error", `Audio script parse worker: ${message}`);
      }
    });
    parseClientRef.current = client;
    return () => {
      client.dispose();
      parseClientRef.current = null;
    };
  }, []);

  function scheduleParse(value: string): void {
    setParseStatus("pending");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      parseClientRef.current?.request(value);
    }, PARSE_DEBOUNCE_MS);
  }

  // Monaco mount (dynamic import so `monaco-editor` never lands in the main
  // app bundle — see monaco-setup.ts's header comment).
  useEffect(() => {
    let cancelled = false;
    let contentSub: Monaco.IDisposable | undefined;
    (async () => {
      try {
        const { loadMonacoAudio } = await import("./monaco-setup.js");
        const monacoApi = loadMonacoAudio();
        if (cancelled || !containerRef.current) return;
        monacoRef.current = monacoApi;

        const model = monacoApi.editor.createModel(codeRef.current, "typescript", monacoApi.Uri.parse("file:///audio-script-tab-module.ts"));
        const editor = monacoApi.editor.create(containerRef.current, {
          model,
          readOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 12,
          scrollBeyondLastLine: false
        });
        editorRef.current = editor;
        contentSub = editor.onDidChangeModelContent(() => {
          const value = editor.getValue();
          codeRef.current = value;
          setCode(value);
          // Bug fix (r2 migration, surfaced by e2e/audio-script.spec.ts's
          // canvas-authored-graph round-trip test): a PROGRAMMATIC `editor
          // .setValue(code)` call (the "keep buffer in sync with the view-
          // mode `code` state" effect below) fires this same event — without
          // this guard, every view-mode document change (e.g. building a
          // graph on the Audio graph canvas while this tab sits mounted-but-
          // hidden, UX-1408) ALSO scheduled a background parse+EQUIV
          // comparison against `documentModuleRef.current`, whose async
          // result could resolve AFTER a LATER document change and briefly
          // (or, with no further doc change, permanently) show a bogus
          // DIVERGED badge over a document the view path itself already
          // reported as EQUIV. `isProgrammaticContentSetRef` already existed
          // for exactly this purpose but was never consulted here.
          if (isProgrammaticContentSetRef.current) return;
          scheduleParse(value);
        });
        setMonacoReady(true);
      } catch (err) {
        onLog?.("error", `Audio script editor failed to load: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      contentSub?.dispose();
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: mode !== "edit" });
  }, [mode, monacoReady]);

  // Keep the Monaco buffer's text in sync with externally-driven `code` changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === code) return;
    isProgrammaticContentSetRef.current = true;
    editor.setValue(code);
    queueMicrotask(() => {
      isProgrammaticContentSetRef.current = false;
    });
  }, [code, monacoReady]);

  // UX-1400: cross-highlight from an audio-graph-canvas selection — a plain
  // select + reveal (see this file's header for the deliberate fidelity
  // reduction vs. script-panel's persistent-decoration/fade-timer machinery).
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) return;
    const match =
      selectedNodeIndex !== null
        ? findHighlightForAudioNode(names, code, selectedNodeIndex)
        : selectedSourceIndex !== null
          ? findHighlightForAudioSource(sourceNames, code, selectedSourceIndex)
          : null;
    decorationsRef.current?.clear();
    decorationsRef.current = null;
    if (!match) return;
    const start = offsetToLineColumn(code, match.offset);
    const end = offsetToLineColumn(code, match.offset + match.length);
    const range = new monacoApi.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    editor.revealRangeInCenter(range);
    editor.setSelection(new monacoApi.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    decorationsRef.current = editor.createDecorationsCollection([
      { range, options: { className: "audio-script-jump-highlight", isWholeLine: false } }
    ]);
  }, [selectedNodeIndex, selectedSourceIndex, monacoReady, names, sourceNames, code]);

  // e2e test hook.
  useEffect(() => {
    window.__gltfStudioAudioScriptTest = {
      setValue: (text: string) => editorRef.current?.setValue(text),
      getCode: () => codeRef.current,
      getSelectedText: () => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (!editor || !selection || selection.isEmpty()) return null;
        return editor.getModel()?.getValueInRange(selection) ?? null;
      },
      getMarkerLines: () => {
        const monacoApi = monacoRef.current;
        const model = editorRef.current?.getModel();
        if (!monacoApi || !model) return [];
        return monacoApi.editor
          .getModelMarkers({ owner: MARKER_OWNER, resource: model.uri })
          .map((m) => m.startLineNumber)
          .sort((a, b) => a - b);
      },
      getDocumentJson: () => documentRef.current.json
    };
    return () => {
      delete window.__gltfStudioAudioScriptTest;
    };
  }, []);

  function toggleMode(): void {
    if (mode === "view") {
      setMode("edit");
      scheduleParse(codeRef.current);
    } else {
      setMode("view");
    }
  }

  function handleApply(): void {
    if (parseStatus !== "clean" || !lastCleanModuleRef.current || !rawGraph) return;
    const { graph: exportedGraph, sources: exportedSources } = exportAudioGraph(lastCleanModuleRef.current);

    const graphCommand = AudioGraphEdit.replaceAudioGraph(document, graphIndex, exportedGraph as unknown as AudioGraphSpec);
    // r2: oscillator sources round-trip through KHR_audio_emitter, not
    // KHR_audio_graph (see equivalence.ts's header) — SceneEdit
    // .setAudioSourceProperty's `propertyPath` accepts an EMPTY array to
    // wholesale-replace `sources[sourceIndex]`, which is exactly what
    // `exportAudioGraph`'s per-source `entry` already is (spec-shaped,
    // ready to splice — see @gltf-audiograph/ir's export.ts header). Only
    // fires for a script that actually declares an `a.oscillator(...)`
    // source; most graphs produce zero entries here and Apply is just the
    // one `replaceAudioGraph` command, same as the interactivity side.
    const sourceCommands = exportedSources.map(({ source, entry }) => SceneEdit.setAudioSourceProperty(document, source, [], entry));
    const command: Command =
      sourceCommands.length === 0
        ? graphCommand
        : (() => {
            const combined = combineCommandParts([graphCommand, ...sourceCommands]);
            return { id: makeCommandId("apply-audio-script"), label: "Apply audio script", patches: combined.patches, inverse: combined.inverse };
          })();

    dispatchCommand(command);
    setEquiv({ status: "equiv" });
    onLog?.("info", `Applied audio script to audio graph ${graphIndex}.`);
    onToast?.("Applied audio script → audio graph.");
  }

  const canApply = parseStatus === "clean" && lastCleanModuleRef.current !== null && rawGraph !== undefined;
  const badgeDiverged = equiv.status === "diverged";
  const errorDiagnostics = diagnostics.filter((d) => d.severity === "error");

  return (
    <div className="audio-script-panel" data-testid="audio-script.panel">
      {hasGraph ? (
        <div className="audio-script-toolbar" data-testid="audio-script.toolbar">
          <button className="audio-script-btn" data-testid="audio-script.edit-toggle" onClick={toggleMode}>
            {mode === "edit" ? "Done" : "Edit"}
          </button>
          <button className="audio-script-btn audio-script-btn-primary" data-testid="audio-script.apply" disabled={!canApply} onClick={handleApply}>
            Apply → Audio graph
          </button>
          <span
            className={`audio-script-badge ${badgeDiverged ? "diverged" : "equiv"}`}
            data-testid="audio-script.equiv-badge"
            title={badgeDiverged ? (equiv.status === "diverged" ? (equiv.firstDivergence ?? "structural difference detected") : "") : "Script matches the audio graph."}
          >
            {badgeDiverged ? "DIVERGED ⚠" : "EQUIV ✓"}
          </span>
          {parseStatus === "error" && (
            <span className="audio-script-parse-status" data-testid="audio-script.parse-status">
              {errorDiagnostics.length} error{errorDiagnostics.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      ) : (
        // Honest empty state (mirrors script-panel's UX-714) — no toolbar,
        // no live editor buffer. The container node is kept in the DOM
        // (hidden via CSS) for the same reason script-panel's is: Monaco is
        // only ever created once, on this component's first mount.
        <p className="audio-script-empty-state" data-testid="audio-script.empty-state">
          No audio graph in this asset — add nodes from the audio palette.
        </p>
      )}
      <div className="audio-script-editor-wrap" data-testid="audio-script.code" ref={containerRef} style={hasGraph ? undefined : { display: "none" }} />
      {hasGraph && errorDiagnostics.length > 0 && (
        <ul className="audio-script-diagnostics" data-testid="audio-script.diagnostics">
          {errorDiagnostics.map((d, i) => (
            <li key={i}>
              {d.message}
              {d.nodeIndex !== undefined && onJumpToAudioGraphNode && (
                <button className="audio-script-jump-btn" data-testid="audio-script.diagnostic-jump" onClick={() => onJumpToAudioGraphNode(d.nodeIndex!)}>
                  → Audio graph
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
