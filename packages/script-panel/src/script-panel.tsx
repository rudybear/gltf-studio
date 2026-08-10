// The Script tab (specs/ux-script.md UX-7xx): Monaco over the current
// behavior graph's GIscript. Owns the whole graph<->code round trip —
// nothing outside this file calls `@gltfi/parse-ts`/`@gltfi/emit-ts`/
// `@gltfi/verify` or `GraphEdit.replaceGraph` for the Script tab's purposes.
//
// Mode model: "view" (default, UX-700/UX-701's read-only Emit view,
// regenerated whenever the document's graph changes) and "edit" (UX-707), a
// real Monaco buffer whose every change is parsed off-thread (parse-client.ts,
// UX-709), compared against the document graph for EQUIV/DIVERGED
// (equivalence.ts, UX-710), and can be committed back via Apply -> Graph
// (UX-711).
import { useEffect, useRef, useState } from "react";
import { GraphEdit, getIn, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import { exportGraph, type Diagnostic, type Graph, type IRModule } from "@gltfi/ir";
import type { EmitNames } from "@gltfi/emit-ts";
import type * as Monaco from "monaco-editor";
import { buildEmitView, namesForModule } from "./emit-view.js";
import { checkEquivalence, type EquivalenceResult } from "./equivalence.js";
import { findHighlightForNode, offsetToLineColumn } from "./cross-highlight.js";
import { ParseClient } from "./parse-client.js";

const PARSE_DEBOUNCE_MS = 300;
const MARKER_OWNER = "gltf-studio-script";

export type ScriptPanelProps = {
  document: EditorDocument;
  /** Which `extensions.KHR_interactivity.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  /** Behavior-graph-canvas selection (app-store's `selectedGraphNodeIndex`) — drives UX-712 cross-highlight. */
  selectedNodeIndex: number | null;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  onToast?: (text: string) => void;
};

type Mode = "view" | "edit";
type ParseStatus = "clean" | "error" | "pending";

/**
 * Test-only seam (no UX-### requirement covers it — same pattern as
 * BehaviorGraphPanel.tsx's `window.__gltfStudioGraphTest`): drives the
 * Monaco buffer the same way a real keystroke would (Monaco fires the same
 * `onDidChangeModelContent` event for a programmatic `setValue`), avoiding
 * a flaky raw-keyboard-into-a-contenteditable-widget e2e interaction for
 * "type this GIscript edit" the same way `GraphCanvasTestHook.simulateConnect`
 * avoids a flaky pixel-perfect port-to-port drag.
 */
export interface GltfStudioScriptTestHook {
  setValue(text: string): void;
  getCode(): string;
  /** e2e-only (specs/ux-usage-mapping.md UX-1108): the Monaco editor's current text selection, or `null` when nothing is selected — lets a test assert UX-712's cross-highlight actually selected the expected identifier, not just that SOME selection changed. */
  getSelectedText(): string | null;
}

declare global {
  interface Window {
    __gltfStudioScriptTest?: GltfStudioScriptTestHook;
  }
}

function extractDiagnosticLine(message: string): number | null {
  // Best-effort only: @gltfi/parse-ts's `Diagnostic` (model.ts) carries no
  // structured line/column field. TS-checker diagnostics (GI001) embed
  // "(line N)" in the message text; structural GI1xx errors embed
  // "<file>:<line>: `...`" instead (see parse-ts's `fail()` helper) — both
  // are parsed out of the message string itself, which is inherently
  // fragile (a message that happens to contain neither pattern falls back
  // to line 1). The Console line (logDiagnostics below) always shows the
  // full, unambiguous message regardless of whether this extraction works.
  const lineMatch = /\(line (\d+)\)/.exec(message) ?? /:(\d+):\s*`/.exec(message);
  if (!lineMatch) return null;
  const line = Number(lineMatch[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

export function ScriptPanel({ document, graphIndex = 0, dispatchCommand, selectedNodeIndex, onLog, onToast }: ScriptPanelProps): JSX.Element {
  const graphs = getIn(document.json, ["extensions", "KHR_interactivity", "graphs"]) as Graph[] | undefined;
  const hasGraph = graphs !== undefined && graphs.length > graphIndex;
  const rawGraph = hasGraph ? graphs![graphIndex] : undefined;

  const [mode, setMode] = useState<Mode>("view");
  const [code, setCode] = useState<string>("");
  const [names, setNames] = useState<EmitNames | null>(null);
  const [parseStatus, setParseStatus] = useState<ParseStatus>("clean");
  const [equiv, setEquiv] = useState<EquivalenceResult>({ status: "equiv" });
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [currentModule, setCurrentModule] = useState<IRModule | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const parseClientRef = useRef<ParseClient | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCleanModuleRef = useRef<IRModule | null>(null);
  const codeRef = useRef(code);
  const loggedErrorKeyRef = useRef<string>("");

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // UX-700/UX-701: regenerate the Emit view whenever the document's graph
  // changes, while in view mode.
  useEffect(() => {
    if (mode !== "view") return;
    if (!rawGraph) {
      setCode("// Import or create a KHR_interactivity graph to see its generated script.\n");
      setNames(null);
      setCurrentModule(null);
      setDiagnostics([]);
      setEquiv({ status: "equiv" });
      setParseStatus("clean");
      return;
    }
    const view = buildEmitView(rawGraph, graphIndex);
    setCode(view.code);
    setNames(view.names);
    setCurrentModule(view.module);
    setDiagnostics(view.diagnostics);
    setEquiv({ status: "equiv" });
    setParseStatus("clean");
  }, [document, graphIndex, mode]);

  // UX-710: while editing, re-evaluate EQUIV against the (possibly changed)
  // document graph WITHOUT re-parsing the buffer if only the graph moved
  // (e.g. the user edited the Behavior graph canvas directly).
  useEffect(() => {
    if (mode !== "edit" || !rawGraph || !lastCleanModuleRef.current) return;
    setEquiv(checkEquivalence(rawGraph, lastCleanModuleRef.current));
  }, [document, graphIndex, mode]);

  function applyMarkers(diags: Diagnostic[]) {
    const monacoApi = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!monacoApi || !model) return;
    const markers: Monaco.editor.IMarkerData[] = diags
      .filter((d) => d.severity === "error")
      .map((d) => {
        const line = extractDiagnosticLine(d.message) ?? 1;
        const clampedLine = Math.min(line, model.getLineCount());
        return {
          severity: monacoApi.MarkerSeverity.Error,
          message: d.message,
          startLineNumber: clampedLine,
          startColumn: 1,
          endLineNumber: clampedLine,
          endColumn: model.getLineMaxColumn(clampedLine)
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
    errors.forEach((d) => onLog?.("error", `Script: ${d.message}`));
  }

  // Parse worker lifecycle: one ParseClient per mount.
  useEffect(() => {
    const client = new ParseClient({
      onResult: (result) => {
        setDiagnostics(result.diagnostics);
        applyMarkers(result.diagnostics);
        logDiagnostics(result.diagnostics);
        const hasErrors = result.diagnostics.some((d) => d.severity === "error");
        if (hasErrors) {
          // UX-710: a currently-failing parse leaves the badge at its
          // last-known state rather than flipping it.
          setParseStatus("error");
          return;
        }
        setParseStatus("clean");
        lastCleanModuleRef.current = result.module;
        setCurrentModule(result.module);
        setNames(namesForModule(result.module));
        if (rawGraph) setEquiv(checkEquivalence(rawGraph, result.module));
      },
      onError: (message) => {
        onLog?.("error", `Script parse worker: ${message}`);
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

  // Monaco mount (UX-707): dynamic import so `monaco-editor` never lands in
  // the main app bundle — see monaco-setup.ts's header comment.
  useEffect(() => {
    let cancelled = false;
    let contentSub: Monaco.IDisposable | undefined;
    (async () => {
      try {
        const { loadMonaco } = await import("./monaco-setup.js");
        const monacoApi = loadMonaco();
        if (cancelled || !containerRef.current) return;
        monacoRef.current = monacoApi;
        const model = monacoApi.editor.createModel(codeRef.current, "typescript", monacoApi.Uri.parse("file:///script-tab-module.ts"));
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
          scheduleParse(value);
        });
        setMonacoReady(true);
      } catch (err) {
        // Surfaced via the Console rather than left as a silent no-op
        // editor (the failure mode a raw unhandled rejection here would
        // otherwise produce — a hard lesson from e2e/script.spec.ts's own
        // debugging: an earlier `MonacoEnvironment` bug threw exactly here
        // and every downstream symptom — edits doing nothing, the badge
        // never updating — looked unrelated until this was caught and
        // logged instead of swallowed).
        onLog?.("error", `Script editor failed to load: ${err instanceof Error ? err.message : String(err)}`);
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

  // Keep the Monaco buffer's readOnly flag in sync with `mode`.
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: mode !== "edit" });
  }, [mode, monacoReady]);

  // Keep the Monaco buffer's text in sync with externally-driven `code`
  // changes (view-mode regeneration, mode toggles) — a no-op when `code`
  // changed BECAUSE of the editor's own `onDidChangeModelContent` above
  // (its value already matches).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === code) return;
    editor.setValue(code);
  }, [code, monacoReady]);

  // UX-712: best-effort cross-highlight from a Behavior-graph-canvas selection.
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || selectedNodeIndex === null || !currentModule || !names) return;
    const match = findHighlightForNode(currentModule, names, code, selectedNodeIndex);
    if (!match) return;
    const start = offsetToLineColumn(code, match.offset);
    const end = offsetToLineColumn(code, match.offset + match.length);
    const range = new monacoApi.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    editor.revealRangeInCenter(range);
    editor.setSelection(range);
  }, [selectedNodeIndex, monacoReady]);

  // e2e test hook (see GltfStudioScriptTestHook doc comment above).
  useEffect(() => {
    window.__gltfStudioScriptTest = {
      setValue: (text: string) => editorRef.current?.setValue(text),
      getCode: () => codeRef.current,
      getSelectedText: () => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (!editor || !selection || selection.isEmpty()) return null;
        return editor.getModel()?.getValueInRange(selection) ?? null;
      }
    };
    return () => {
      delete window.__gltfStudioScriptTest;
    };
  }, []);

  function toggleMode(): void {
    if (mode === "view") {
      setMode("edit");
      // Establish a real baseline via the same pipeline as any other edit,
      // rather than assuming the just-shown Emit view is clean.
      scheduleParse(codeRef.current);
    } else {
      setMode("view"); // The view-mode effect above discards any unapplied edits and regenerates `code` from the current graph.
    }
  }

  function handleApply(): void {
    if (parseStatus !== "clean" || !lastCleanModuleRef.current || !rawGraph) return;
    const exported = exportGraph(lastCleanModuleRef.current).graph;
    const command = GraphEdit.replaceGraph(document, graphIndex, exported as unknown as Graph);
    dispatchCommand(command);
    setEquiv({ status: "equiv" });
    onLog?.("info", `Applied script to graph ${graphIndex}.`);
    onToast?.("Applied script → graph.");
  }

  const canApply = parseStatus === "clean" && lastCleanModuleRef.current !== null && rawGraph !== undefined;
  const badgeDiverged = equiv.status === "diverged";
  const errorDiagnostics = diagnostics.filter((d) => d.severity === "error");

  return (
    <div className="script-panel" data-testid="script.panel">
      {hasGraph ? (
        <div className="script-toolbar" data-testid="script.toolbar">
          <button className="script-btn" data-testid="script.edit-toggle" disabled={!rawGraph} onClick={toggleMode}>
            {mode === "edit" ? "Done" : "Edit"}
          </button>
          <button className="script-btn script-btn-primary" data-testid="script.apply" disabled={!canApply} onClick={handleApply}>
            Apply → Graph
          </button>
          <span
            className={`script-badge ${badgeDiverged ? "diverged" : "equiv"}`}
            data-testid="script.equiv-badge"
            title={badgeDiverged ? equivalenceTooltip(equiv) : "Script matches the graph."}
          >
            {badgeDiverged ? "DIVERGED ⚠" : "EQUIV ✓"}
          </span>
          {parseStatus === "error" && (
            <span className="script-parse-status" data-testid="script.parse-status">
              {errorDiagnostics.length} error{errorDiagnostics.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      ) : (
        // UX-714: an honest empty state — no toolbar, no (even placeholder-only) Monaco buffer
        // shown — rather than a technically-live editor whose one line of "content" was itself
        // just a stand-in comment. The `.script-editor-wrap` node below is NOT removed from the
        // DOM (only hidden via CSS): `containerRef` is attached to it once, on this component's
        // first mount (see the Monaco-mount effect below), and Monaco is never re-created for a
        // later graph that appears on the same mounted ScriptPanel instance (e.g. the user adds
        // the asset's first graph node via the Behavior graph tab while this tab sits mounted-but-
        // hidden) — conditionally unmounting this node here would orphan `containerRef` and leave
        // that future graph with no editor at all to show its generated code in.
        <p className="script-empty-state" data-testid="script.empty-state">
          No behavior graph in this asset — add nodes from the graph palette or ask Copilot.
        </p>
      )}
      <div className="script-editor-wrap" data-testid="script.code" ref={containerRef} style={hasGraph ? undefined : { display: "none" }} />
      {hasGraph && errorDiagnostics.length > 0 && (
        <ul className="script-diagnostics" data-testid="script.diagnostics">
          {errorDiagnostics.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function equivalenceTooltip(result: EquivalenceResult): string {
  if (result.status === "equiv") return "Script matches the graph.";
  const changes = result.declarationChanges.length > 0 ? result.declarationChanges.join("; ") : (result.firstDivergence ?? "structural difference detected");
  return `Diverged: ${changes}`;
}
