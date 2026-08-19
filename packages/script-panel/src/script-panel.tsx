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
import { findHighlightForNode, offsetToLineColumn, type FindHighlightOptions, type HighlightMatch } from "./cross-highlight.js";
import { findPointerPathLinks } from "./pointer-links.js";
import { ParseClient } from "./parse-client.js";

/**
 * specs/ux-usage-mapping.md UX-1119: the Monaco "command:" URI this
 * module's link provider points every pointer-path link at, and the one
 * standalone command registered (once, module-scope) to handle a click on
 * any of them — Monaco's default link opener recognizes a `command:` scheme
 * URI specially and dispatches it through `editor.registerCommand`'s global
 * command service, the standard way to make a Monaco link DO something
 * other than navigate to a real URL (the same trick VS Code's own webviews
 * use). Registered once per page load (guarded by `pointerLinkCommandRegistered`
 * below), not once per `ScriptPanel` mount — `monaco.editor.registerCommand`
 * has no notion of "already registered, replace the handler," so this
 * module keeps exactly one mutable handler ref for it to always call
 * through, and every mounted `ScriptPanel` instance (there is normally only
 * ever one, the Script tab is a singleton) just repoints that ref.
 */
const POINTER_LINK_COMMAND_ID = "gltf-studio.usage.jumpScriptPointerToScene";
let pointerLinkCommandRegistered = false;
let pointerLinkClickHandler: ((pointerPath: string) => void) | null = null;

const PARSE_DEBOUNCE_MS = 300;
const MARKER_OWNER = "gltf-studio-script";
/**
 * specs/ux-script.md UX-712/UX-1108 (refined): how long the persistent
 * "you jumped here" decoration stays visible with no further interaction
 * before it clears itself — a plain, undocumented-forever highlight would
 * eventually just look like permanent (and increasingly meaningless, once
 * the user has moved on) chrome; 5s is enough to register as "this is what
 * that action pointed at" without outliving the moment. A deliberately
 * simple instantaneous clear at this mark, not an animated fade — see
 * `clearJumpHighlight`'s doc comment.
 */
const JUMP_HIGHLIGHT_FADE_MS = 5000;

export type ScriptPanelProps = {
  document: EditorDocument;
  /** Which `extensions.KHR_interactivity.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  /** Behavior-graph-canvas selection (app-store's `selectedGraphNodeIndex`) — drives UX-712 cross-highlight. */
  selectedNodeIndex: number | null;
  /**
   * specs/ux-usage-mapping.md UX-1108: the Inspector's → Script jump,
   * app-store's `scriptNodeFocusRequest` — a durable, seq-bumped request
   * (NOT a one-shot event) so a jump fired before this component/Monaco
   * even exists yet is still honored once ready (see the focus-application
   * effect below), and carrying an explicit `pointerPath` fallback needle
   * for `pointer/set`/`pointer/interpolate` nodes, which have no
   * `sourceNodeIds` identifier for the plain `selectedNodeIndex`-driven
   * UX-712 effect to resolve on its own (`cross-highlight.ts`'s header
   * comment).
   */
  focusRequest?: {
    graphIndex: number;
    nodeIndex: number;
    pointerPath: string | null;
    enclosingHandlerNodeIndex: number | null;
    seq: number;
  } | null;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  onToast?: (text: string) => void;
  /**
   * specs/ux-usage-mapping.md UX-1119: fired when the user clicks a Monaco
   * pointer-path link (`pointer-links.ts`) — the reverse direction of
   * UX-1108's Inspector → Script jump. `app-store.ts`'s
   * `jumpScriptPointerToScene` resolves `pointerPath` back to a graph node
   * and drives the scene-tree/viewport selection + amber reference
   * highlight from there; this component itself has no glTF-document
   * knowledge to do that resolution on its own (it only knows emitted TEXT).
   */
  onPointerLinkClick?: (pointerPath: string) => void;
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
  /**
   * e2e-only (specs/ux-script.md UX-712/UX-1108 refined): the 1-based line
   * number the persistent jump-highlight decoration currently occupies, or
   * `null` when no jump-highlight decoration is active (never jumped yet,
   * already cleared by an edit/click-elsewhere, faded after
   * `JUMP_HIGHLIGHT_FADE_MS`, or the jumped-to reference no longer resolves
   * after a regen). A real visual e2e test needs this to compute WHICH
   * on-screen pixels to sample — `getSelectedText()` alone proves the API
   * state is right but, per this fix's own bug report, can pass while a
   * user visually sees nothing.
   */
  getJumpHighlightLineNumber(): number | null;
  /**
   * e2e-only: the on-screen (viewport-relative CSS px) rectangle a given
   * 1-based model line currently renders at, or `null` if that line isn't
   * currently laid out (e.g. the model is empty). Lets a visual e2e test
   * turn "line N" into a `page.screenshot({ clip })`/pixel-sampling region
   * without reimplementing Monaco's own line-to-pixel geometry.
   */
  getLineScreenRect(lineNumber: number): { top: number; left: number; width: number; height: number } | null;
  /**
   * e2e-only (specs/ux-usage-mapping.md UX-1119): every pointer-path link
   * `pointer-links.ts` currently finds in the emitted code — lets a test
   * assert WHICH links exist without depending on Monaco's own link-widget
   * DOM (a thin, hover/modifier-key-gated target real browsers render
   * differently across platforms).
   */
  getPointerLinks(): string[];
  /**
   * e2e-only: invokes `onPointerLinkClick` for `pointerPath` exactly as the
   * real Monaco "command:" URI click does (`registerCommand`'s handler
   * calls the SAME module-scope `pointerLinkClickHandler` this seam calls
   * directly) — same "avoid a flaky pixel-perfect interaction, exercise the
   * real result-producing code path instead" precedent `setValue`/
   * `simulateConnect` above already establish for this file/`graph-canvas`
   * respectively. Returns `false` (no-op) if `pointerPath` isn't among the
   * links `getPointerLinks()` currently reports, so a test typo doesn't
   * silently pass by clicking nothing.
   */
  clickPointerLink(pointerPath: string): boolean;
  /**
   * e2e-only (regression coverage for structured-diagnostic-position gutter
   * markers, gltf-studio #31): the 1-based `startLineNumber` of every error
   * marker `applyMarkers` currently has installed via
   * `monaco.editor.setModelMarkers`, in ascending order. Lets a test assert
   * a known-bad script's markers land on the EXACT line the error is on
   * (per `@gltfi/ir`'s `Diagnostic.line`) rather than only that some marker
   * exists somewhere.
   */
  getMarkerLines(): number[];
}

declare global {
  interface Window {
    __gltfStudioScriptTest?: GltfStudioScriptTestHook;
  }
}

/**
 * Best-effort FALLBACK only, for diagnostics that predate/lack a structured
 * position. `@gltfi/ir`'s `Diagnostic` (model.ts, since gltf-studio #31)
 * carries an optional structured `line` field wherever the producing stage
 * (`@gltfi/parse-ts`'s ts-morph-backed `fail()`/raw-TS-diagnostic passes)
 * actually knows a location — `diagnosticLine` below prefers that. This
 * regex path only fires when `d.line` is `undefined` (e.g. a `fail()` with
 * no AST node to anchor on): TS-checker diagnostics (GI001) embed
 * "(line N)" in the message text; structural GI1xx errors embed
 * "<file>:<line>: `...`" instead (see parse-ts's `fail()` helper). Fragile
 * by nature (a message that happens to contain neither pattern falls back to
 * line 1) — kept only as a safety net, not the primary source of truth. The
 * Console line (logDiagnostics below) always shows the full, unambiguous
 * message regardless of whether this extraction works.
 */
function extractDiagnosticLine(message: string): number | null {
  const lineMatch = /\(line (\d+)\)/.exec(message) ?? /:(\d+):\s*`/.exec(message);
  if (!lineMatch) return null;
  const line = Number(lineMatch[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

/**
 * The line a marker for diagnostic `d` should land on: `d.line` (structured,
 * 1-based, populated by `@gltfi/parse-ts` for every GI0xx/GI1xx diagnostic
 * anchored on a real AST node — see `@gltfi/ir`'s `Diagnostic` doc comment)
 * when present, else the regex-on-message fallback above, else line 1.
 */
function diagnosticLine(d: Diagnostic): number {
  return d.line ?? extractDiagnosticLine(d.message) ?? 1;
}

export function ScriptPanel({ document, graphIndex = 0, dispatchCommand, selectedNodeIndex, focusRequest, onLog, onToast, onPointerLinkClick }: ScriptPanelProps): JSX.Element {
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
  /** UX-1108: the last `focusRequest.seq` this effect has already acted on — prevents re-applying the same jump on every unrelated re-render (e.g. a later `monacoReady`/`code` change after the jump already landed), while still re-firing for a genuinely NEW request even if it targets the same node/graph (seq always changes, `app-store.ts`'s `requestScriptNodeFocus` bumps it unconditionally). */
  const lastAppliedFocusSeqRef = useRef<number>(0);
  /** UX-712's own analogue of `lastAppliedFocusSeqRef` above: the last plain canvas-selection `selectedNodeIndex` this effect has already jumped to — without this, the effect (which also depends on `code`/`currentModule`/`names` so it can re-jump to a NEWLY-selected node the instant those become ready) would otherwise re-reveal/re-focus/re-select on every unrelated emit-view regen for as long as the SAME node stays selected, which is exactly the "yanks the user's view/focus around" failure mode this fix is about ending, not reintroducing on a second code path. `undefined` (never `null`, which IS a legitimate "nothing selected" value) as the "never applied yet" sentinel. */
  const lastAppliedSelectionNodeRef = useRef<number | null | undefined>(undefined);
  /**
   * specs/ux-script.md UX-712/UX-1108 (refined "character-precise, visibly-
   * decorated script jump"): a persistent, focus-independent decoration
   * marking the exact character range a jump last landed on — Monaco's OWN
   * selection highlight (`editor.setSelection` below) looks fine while the
   * editor has real DOM focus, but renders via the much fainter
   * `editor.inactiveSelectionBackground` the instant focus is anywhere else,
   * which — for a jump ARRIVING from outside the editor (the Inspector's
   * "-> Script" button) — is exactly the state a user is actually looking
   * at unless something else forces focus first. This ref holds the
   * `IEditorDecorationsCollection` so it can be `.clear()`ed/replaced by
   * later jumps, edits, clicks-elsewhere, or the fade timer below.
   */
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  /** Handle for the `JUMP_HIGHLIGHT_FADE_MS` auto-clear timer, so a NEW jump (or any other clear trigger) can cancel a still-pending fade from a PREVIOUS one rather than letting it fire late and clear the new jump's decoration out from under it. */
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * What the currently-active decoration (if any) actually points at —
   * re-used by the "regen re-resolve" effect below to re-run
   * `findHighlightForNode` against freshly emitted `code` and move the
   * decoration to wherever that same reference now lands (or clear it, if
   * it no longer resolves at all — e.g. the referencing node was deleted).
   * `null` whenever no jump-highlight decoration is currently active — the
   * single source of truth `clearJumpHighlight`/`applyJumpHighlight` below
   * both keep in sync with `decorationsRef`, rather than tracking "is a
   * highlight showing" as a second, independently-maintained boolean.
   */
  const lastHighlightTargetRef = useRef<{ nodeIndex: number; options?: FindHighlightOptions } | null>(null);
  /**
   * The exact `Selection` `applyJumpHighlight` below just asked Monaco to
   * set, so the cursor-selection listener that implements "clears on
   * click-elsewhere" can recognize that VERY event (its own `setSelection`
   * call firing `onDidChangeCursorSelection`) as self-inflicted rather than
   * a real click, and only clear on the NEXT (genuinely user-driven) change.
   * `null` once that self-inflicted event has been seen once, or whenever
   * no jump-highlight decoration is active at all.
   */
  const expectedSelectionRef = useRef<{ startLine: number; startCol: number; endLine: number; endCol: number } | null>(null);
  /**
   * Set for the duration of THIS component's own programmatic
   * `editor.setValue(code)` call (the "keep the buffer in sync with
   * externally-driven `code`" effect below) so the shared
   * `onDidChangeModelContent` listener can tell that content change apart
   * from a genuine user keystroke — only the latter should clear the jump
   * highlight per this fix's "(4) ... clears on user edit" semantics; a
   * regen-driven `setValue` is handled by the separate re-resolve effect
   * instead (moving/keeping the decoration, not discarding it).
   */
  const isProgrammaticContentSetRef = useRef(false);

  /**
   * specs/ux-script.md UX-712/UX-1108: clears the persistent jump-highlight
   * decoration (if any) and everything tracking it — the one place all four
   * clear triggers (a NEW jump superseding it, a genuine user edit, a click
   * elsewhere in the buffer, and the `JUMP_HIGHLIGHT_FADE_MS` timer) funnel
   * through, so "is a highlight currently active" has exactly one source of
   * truth (`lastHighlightTargetRef`) rather than drifting across several.
   */
  function clearJumpHighlight(): void {
    decorationsRef.current?.clear();
    decorationsRef.current = null;
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    lastHighlightTargetRef.current = null;
    expectedSelectionRef.current = null;
    // Also collapses Monaco's own (native) selection down to a plain caret
    // at wherever it currently sits — otherwise, for the FADE trigger
    // specifically (no real user interaction happens at all), the jump's
    // original full-range selection would just sit there un-cleared
    // forever once the amber decoration vanishes, which reads as only
    // HALF cleared. A no-op for the click-elsewhere/user-edit triggers
    // (the click/keystroke that caused THIS call already moved the real
    // selection to wherever it is now — collapsing it to its own current
    // position changes nothing observable).
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    const currentSelection = editor?.getSelection();
    if (editor && monacoApi && currentSelection) {
      editor.setSelection(new monacoApi.Selection(currentSelection.positionLineNumber, currentSelection.positionColumn, currentSelection.positionLineNumber, currentSelection.positionColumn));
    }
  }

  /** The actual decoration pair `applyJumpHighlight` and the regen re-resolve effect below both build: an exact-range inline treatment (the precise matched characters) plus a whole-line tint + gutter bar (so the highlight reads at a glance even for a short/scrolled-off-screen-horizontally identifier) — both using the SAME amber `--warn`/`--ref-soft` reference color UX-1110's scene-tree/viewport reference highlight already uses, so "this is what behavior referenced" is one consistent visual language across the app rather than a different color per surface. */
  function buildJumpDecorations(monacoApi: typeof Monaco, range: Monaco.Range): Monaco.editor.IModelDeltaDecoration[] {
    return [
      {
        range,
        options: {
          className: "gi-jump-highlight-range",
          stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      },
      {
        range: new monacoApi.Range(range.startLineNumber, 1, range.endLineNumber, 1),
        options: {
          isWholeLine: true,
          className: "gi-jump-highlight-line",
          linesDecorationsClassName: "gi-jump-highlight-gutter",
          stickiness: monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }
    ];
  }

  /**
   * Sets Monaco's own (native) selection to `range` with the caret at its
   * START (`applyJumpHighlight`'s own doc comment explains the anchor/
   * position split) and re-arms `expectedSelectionRef` so the click-
   * elsewhere listener recognizes THIS call's own resulting
   * `onDidChangeCursorSelection` event as self-inflicted rather than a real
   * click — shared by `applyJumpHighlight` (a fresh jump) and the regen
   * re-resolve effect below (which keeps the selection honest across a
   * regen too, so `getSelectedText()` stays a meaningful check post-regen,
   * not just the decoration) so click-elsewhere detection keeps working no
   * matter which of the two last touched the selection.
   */
  function setJumpSelection(editor: Monaco.editor.IStandaloneCodeEditor, monacoApi: typeof Monaco, start: { lineNumber: number; column: number }, end: { lineNumber: number; column: number }): void {
    // Armed BEFORE calling `setSelection` — Monaco fires
    // `onDidChangeCursorSelection` SYNCHRONOUSLY from within that call, so
    // setting this AFTER would let the listener see the OLD (stale/absent)
    // expectation and misidentify this very call's own resulting event as
    // a real click-elsewhere instead of the echo it actually is.
    expectedSelectionRef.current = { startLine: start.lineNumber, startCol: start.column, endLine: end.lineNumber, endCol: end.column };
    const selection = new monacoApi.Selection(end.lineNumber, end.column, start.lineNumber, start.column);
    editor.setSelection(selection);
  }

  /**
   * Applies a FRESH jump (specs/ux-script.md UX-712/UX-1108, refined):
   * reveals the range centered in the viewport, focuses the editor and
   * places the caret at the range's START while keeping the full range
   * itself selected (`setJumpSelection`'s own doc comment explains the
   * anchor/position split — the e2e `getSelectedText()` hook keeps seeing
   * the full matched text), and paints the persistent amber decoration
   * (`buildJumpDecorations`) that does NOT depend on that focus/selection
   * state to stay visible. Called only when a NEW jump actually happens (a
   * new `selectedNodeIndex` or a new `focusRequest.seq`) — never merely
   * because an unrelated emit-view regen re-ran this component's effects
   * (see the re-resolve effect below for that case, which repositions the
   * decoration alone, without re-stealing focus/re-scrolling on every such
   * regen).
   */
  function applyJumpHighlight(match: HighlightMatch, target: { nodeIndex: number; options?: FindHighlightOptions }, currentCode: string): void {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) return;

    const start = offsetToLineColumn(currentCode, match.offset);
    const end = offsetToLineColumn(currentCode, match.offset + match.length);
    const range = new monacoApi.Range(start.lineNumber, start.column, end.lineNumber, end.column);

    editor.revealRangeInCenter(range);
    setJumpSelection(editor, monacoApi, start, end);
    editor.focus();

    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(buildJumpDecorations(monacoApi, range));
    lastHighlightTargetRef.current = target;

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      clearJumpHighlight();
    }, JUMP_HIGHLIGHT_FADE_MS);
  }

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // UX-1119: keeps the module-scope pointer-link click handler pointed at
  // THIS mount's latest `onPointerLinkClick` prop — the Monaco command
  // registered below (module-scope, once per page load) always calls
  // through this ref rather than closing over a stale prop from whichever
  // render happened to be current when it was registered.
  useEffect(() => {
    pointerLinkClickHandler = onPointerLinkClick ?? null;
    return () => {
      if (pointerLinkClickHandler === (onPointerLinkClick ?? null)) pointerLinkClickHandler = null;
    };
  }, [onPointerLinkClick]);

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
        const line = diagnosticLine(d);
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
    let cursorSub: Monaco.IDisposable | undefined;
    (async () => {
      try {
        const { loadMonaco } = await import("./monaco-setup.js");
        const monacoApi = loadMonaco();
        if (cancelled || !containerRef.current) return;
        monacoRef.current = monacoApi;

        // UX-1119: registered ONCE per page load (Monaco has no notion of
        // "already registered, replace the handler" for either API) — a
        // later remount of this component just keeps calling through the
        // SAME command/provider via `pointerLinkClickHandler`'s module-scope
        // ref (kept current by the effect above), never re-registering.
        if (!pointerLinkCommandRegistered) {
          pointerLinkCommandRegistered = true;
          monacoApi.editor.registerCommand(POINTER_LINK_COMMAND_ID, (_accessor: unknown, pointerPath: string) => {
            pointerLinkClickHandler?.(pointerPath);
          });
          monacoApi.languages.registerLinkProvider("typescript", {
            provideLinks(linkModel) {
              const text = linkModel.getValue();
              const links: Monaco.languages.ILink[] = findPointerPathLinks(text).map((found) => {
                const start = offsetToLineColumn(text, found.offset);
                const end = offsetToLineColumn(text, found.offset + found.length);
                return {
                  range: new monacoApi.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                  tooltip: `Select "${found.pointerPath}" in the scene`,
                  url: `command:${POINTER_LINK_COMMAND_ID}?${encodeURIComponent(JSON.stringify([found.pointerPath]))}`
                };
              });
              return { links };
            }
          });
        }

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
          // specs/ux-script.md UX-712/UX-1108 (refined) "(4) ... clears on
          // user edit": a content change NOT caused by this component's own
          // programmatic `setValue` (`isProgrammaticContentSetRef`, armed
          // around the "keep buffer in sync with `code`" effect's own call
          // AND kept armed through the regen re-resolve effect's own
          // reselection right after it — see that ref's own doc comment)
          // is a genuine keystroke — the jump highlight no longer reliably
          // corresponds to anything once the buffer diverges from what was
          // actually jumped to. Deliberately just READS the flag rather
          // than consuming (resetting) it here: this listener and the
          // cursor one below both need to see the SAME "this whole regen
          // is still in flight" window, and Monaco's relative firing order
          // between its content-changed and cursor-changed notifications
          // for one `setValue` call is not a documented guarantee — whichever
          // of the two consumed it first would have made the other
          // misfire. A deferred (microtask) reset in the setter effect
          // itself is the single point that clears it, once, after both
          // listeners (and any effect using `setJumpSelection` afterward)
          // have had their turn.
          if (!isProgrammaticContentSetRef.current) clearJumpHighlight();
        });
        // "(4) ... clears on ... click-elsewhere": any cursor/selection
        // change that ISN'T either (a) caused by this component's own
        // programmatic content regeneration (`isProgrammaticContentSetRef`
        // — a full `setValue` incidentally resets the cursor to 1,1 as a
        // side effect, which is not a real click and must not be treated
        // as one) or (b) the very one `applyJumpHighlight`/the regen
        // re-resolve effect's own `setJumpSelection` just made
        // (`expectedSelectionRef`, a one-shot "ignore the immediately next
        // event" arm — see its own doc comment) clears the highlight.
        // Comparing the raw selection shape (rather than trusting e.g.
        // `event.reason`) works regardless of exactly which internal
        // Monaco code path a given programmatic-vs-mouse-vs-keyboard cursor
        // move reports.
        cursorSub = editor.onDidChangeCursorSelection((event) => {
          if (isProgrammaticContentSetRef.current) return; // this whole event is a side effect of a regen in flight — not a click
          const pendingEcho = expectedSelectionRef.current;
          if (pendingEcho) {
            expectedSelectionRef.current = null; // consume — only the IMMEDIATELY next event is ever checked against it
            const sel = event.selection;
            const isOwnSetSelectionEcho =
              sel.selectionStartLineNumber === pendingEcho.endLine &&
              sel.selectionStartColumn === pendingEcho.endCol &&
              sel.positionLineNumber === pendingEcho.startLine &&
              sel.positionColumn === pendingEcho.startCol;
            if (isOwnSetSelectionEcho) return; // this WAS the self-inflicted echo — not a click, nothing to clear
          }
          if (lastHighlightTargetRef.current !== null) clearJumpHighlight();
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
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      contentSub?.dispose();
      cursorSub?.dispose();
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
  // (its value already matches). Arms `isProgrammaticContentSetRef` right
  // before `setValue` so the content-change AND cursor-selection listeners
  // can both tell every event `setValue` itself triggers (a real content-
  // changed notification, PLUS an incidental cursor-reset-to-1,1 as a side
  // effect of replacing the whole buffer) apart from a genuine user
  // keystroke/click (UX-712/UX-1108's "clears on user edit"/"click-
  // elsewhere"). Reset via a DEFERRED microtask, not synchronously right
  // after this call, and NOT by either listener consuming it themselves:
  // this same `code` change also re-runs the regen re-resolve effect
  // (declared later in this component, so it runs AFTER this one within
  // the same synchronous effect-flush) which calls `setJumpSelection` —
  // that call's OWN resulting cursor event must ALSO still see this flag
  // as armed, or it would look like a real click-elsewhere and wipe the
  // very highlight that effect just recomputed. A microtask fires only
  // once every effect in this flush (this one included) has already run,
  // so it clears the flag exactly once, after everyone who needed to see
  // it armed has had their turn — earlier synchronous-reset and listener-
  // self-consumption attempts here both raced one of the two listeners
  // and lost often enough to silently wipe highlights on real regens.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === code) return;
    isProgrammaticContentSetRef.current = true;
    editor.setValue(code);
    queueMicrotask(() => {
      isProgrammaticContentSetRef.current = false;
    });
  }, [code, monacoReady]);

  // UX-712: best-effort cross-highlight from a Behavior-graph-canvas
  // selection made DIRECTLY on the canvas (no `focusRequest` involved) —
  // handler/proc/stateSlot-kind nodes only, resolved via `sourceNodeIds`
  // alone (no pointer-path fallback here: a plain canvas click carries no
  // pointer-path text to fall back to, only a bare `nodeIndex`). Guarded by
  // `lastAppliedSelectionNodeRef` so this only actually JUMPS (reveal +
  // focus + persistent decoration, `applyJumpHighlight`) on a genuinely NEW
  // `selectedNodeIndex` — this effect's OTHER deps (`code`/`currentModule`/
  // `names`) exist so a selection made before those are ready still gets
  // applied the moment they are, not so every later unrelated emit-view
  // regen re-steals focus/re-scrolls for as long as the same node stays
  // selected (the separate re-resolve effect below repositions the
  // decoration alone for that case).
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || !currentModule || !names) return;
    if (selectedNodeIndex === lastAppliedSelectionNodeRef.current) return;
    lastAppliedSelectionNodeRef.current = selectedNodeIndex;
    if (selectedNodeIndex === null) return;
    const match = findHighlightForNode(currentModule, names, code, selectedNodeIndex);
    if (!match) return; // UX-712's documented fidelity gap (temp-kind/unmappable nodes) — no highlight, but an EXISTING one (e.g. from a prior UX-1108 jump) is deliberately left alone rather than clobbered by an unrelated selection that itself produced nothing.
    applyJumpHighlight(match, { nodeIndex: selectedNodeIndex }, code);
  }, [selectedNodeIndex, monacoReady, currentModule, names, code]);

  // UX-1108: applies a durable → Script jump request once THIS component is
  // actually ready to act on it (Monaco mounted AND the emit view current
  // for the request's own graph) — the queuing fix for the cold-start race
  // (this panel is `React.lazy`-mounted on the Script tab's first open,
  // `BottomDock.tsx`, and Monaco itself loads via a further inner dynamic
  // import above; a request fired before either exists must not be dropped).
  // Re-runs on every readiness-relevant dependency change rather than only
  // on `focusRequest` itself changing, so a request that arrives before
  // `monacoReady`/`currentModule`/`names` are set gets a second (third, ...)
  // chance the moment they do — `lastAppliedFocusSeqRef` makes each actual
  // application idempotent (never re-jumps on an unrelated later re-run,
  // for the same reason `lastAppliedSelectionNodeRef` guards the UX-712
  // effect above).
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastAppliedFocusSeqRef.current) return;
    if (focusRequest.graphIndex !== graphIndex) return; // the graph-switch this same jump requested hasn't propagated to this prop yet — wait for it (this effect re-runs when `graphIndex` changes).
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || !monacoReady || !currentModule || !names) return; // not ready yet — stays queued, re-evaluated when these become ready.

    lastAppliedFocusSeqRef.current = focusRequest.seq;
    const options: FindHighlightOptions = { pointerPath: focusRequest.pointerPath, enclosingHandlerNodeIndex: focusRequest.enclosingHandlerNodeIndex };
    const match = findHighlightForNode(currentModule, names, code, focusRequest.nodeIndex, options);
    if (!match) {
      // A genuinely unmappable reference (e.g. the Inspector's disabled-
      // button case was somehow bypassed, or the graph changed underneath
      // the request) — logged, not silently swallowed, per this file's own
      // "an unhandled failure here looks like unrelated symptoms" lesson
      // (see the Monaco-mount effect's own comment above). Also clears any
      // STALE highlight from a previous, different jump rather than leaving
      // it looking like it answers this one.
      onLog?.("warn", `Script: no corresponding line found for the selected node in graph ${focusRequest.graphIndex}.`);
      clearJumpHighlight();
      return;
    }
    applyJumpHighlight(match, { nodeIndex: focusRequest.nodeIndex, options }, code);
  }, [focusRequest, graphIndex, monacoReady, currentModule, names, code, onLog]);

  // specs/ux-script.md UX-712/UX-1108 (refined): re-resolves the ACTIVE jump
  // highlight's target (`lastHighlightTargetRef`) against freshly emitted
  // `code` whenever it changes for ANY reason (a document edit elsewhere
  // regenerating the view-mode emit, a mode toggle, ...) — this is the fix
  // for this bug report's finding (b): the previous implementation had
  // nothing here at all, so `editor.setValue(code)` (the "keep the buffer
  // in sync" effect above) silently wiped the selection/decoration on the
  // very next regen after a jump landed. Moves BOTH the persistent
  // decoration and the plain Monaco selection (`setJumpSelection`) to the
  // freshly-resolved location — keeping the selection honest too (not just
  // the decoration) is what keeps `getSelectedText()` a meaningful
  // assertion after a regen, not merely the visual layer. Deliberately does
  // NOT re-reveal the viewport or re-focus the editor, though — only
  // `applyJumpHighlight` (a genuinely NEW jump) does that; a silent
  // `setSelection` alone causes no scroll/focus side effect on its own, so
  // this still never yanks the user's screen/focus around on an unrelated
  // regen. If the reference no longer resolves at all (e.g. the
  // referencing graph node was deleted), the highlight is cleared outright
  // — a stale decoration/selection pointing at unrelated/wrong text would
  // be worse than none.
  useEffect(() => {
    const target = lastHighlightTargetRef.current;
    if (!target || !currentModule || !names) return;
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) return;
    const match = findHighlightForNode(currentModule, names, code, target.nodeIndex, target.options);
    if (!match) {
      clearJumpHighlight();
      return;
    }
    const start = offsetToLineColumn(code, match.offset);
    const end = offsetToLineColumn(code, match.offset + match.length);
    const range = new monacoApi.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(buildJumpDecorations(monacoApi, range));
    setJumpSelection(editor, monacoApi, start, end);
    // Not resetting `fadeTimerRef` here on purpose: a regen doesn't reset
    // the fade clock — an unrelated document edit shouldn't extend how long
    // an already-stale-looking highlight lingers. `target` (a ref) is
    // deliberately excluded from the dependency array below: this effect
    // re-runs when `code`/`currentModule`/`names` change, not when the
    // ref's own content changes (a plain ref mutation triggers no
    // re-render to run an effect from in the first place).
  }, [code, currentModule, names]);

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
      },
      getJumpHighlightLineNumber: () => {
        const target = lastHighlightTargetRef.current;
        const decorations = decorationsRef.current;
        const editor = editorRef.current;
        if (!target || !decorations || !editor) return null;
        const ranges = decorations.getRanges();
        return ranges.length > 0 ? ranges[0]!.startLineNumber : null;
      },
      getLineScreenRect: (lineNumber: number) => {
        const editor = editorRef.current;
        const domNode = editor?.getDomNode();
        if (!editor || !domNode) return null;
        const visible = editor.getScrolledVisiblePosition({ lineNumber, column: 1 });
        if (!visible) return null;
        const rect = domNode.getBoundingClientRect();
        return { top: rect.top + visible.top, left: rect.left, width: rect.width, height: visible.height };
      },
      getPointerLinks: () => findPointerPathLinks(codeRef.current).map((l) => l.pointerPath),
      clickPointerLink: (pointerPath: string) => {
        const found = findPointerPathLinks(codeRef.current).some((l) => l.pointerPath === pointerPath);
        if (!found) return false;
        pointerLinkClickHandler?.(pointerPath);
        return true;
      },
      getMarkerLines: () => {
        const monacoApi = monacoRef.current;
        const model = editorRef.current?.getModel();
        if (!monacoApi || !model) return [];
        return monacoApi.editor
          .getModelMarkers({ owner: MARKER_OWNER, resource: model.uri })
          .map((m) => m.startLineNumber)
          .sort((a, b) => a - b);
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
