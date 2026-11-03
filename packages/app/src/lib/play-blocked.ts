import { PLAY_GRAPH_INDEX, type ValidationDiagnostic } from "@gltf-studio/play";

/** UX-132: one validation error from a refused Play attempt (a `ValidationDiagnostic` narrowed to what the panel renders). */
export interface PlayBlockedDiagnostic {
  code: string;
  message: string;
  section: string;
  /** Graph node index the error is attributed to, when it has one -- the row then offers a jump to that node. */
  nodeIndex?: number;
  /** Which `graphs[]` entry the error belongs to; defaults to PLAY_GRAPH_INDEX (the graph Play always runs). */
  graphIndex: number;
  /** JSON path inside the graph, e.g. `nodes[3].configuration`. */
  path?: string;
}

/** UX-132: what `AppState.playBlocked` holds. */
export interface PlayBlockedInfo {
  /** `"extension"`: the whole KHR_interactivity extension is rejected (e.g. the default graph is invalid); `"graph"`: one graph. */
  scope: "graph" | "extension";
  diagnostics: PlayBlockedDiagnostic[];
}

/** Narrows an `InteractivityValidationError` to the error-severity diagnostics the "Play blocked" panel lists. */
export function toPlayBlockedInfo(err: { scope: "graph" | "extension"; diagnostics: ValidationDiagnostic[] }): PlayBlockedInfo {
  return {
    scope: err.scope,
    diagnostics: err.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => ({
        code: d.code,
        message: d.message,
        section: d.section,
        ...(d.nodeIndex !== undefined ? { nodeIndex: d.nodeIndex } : {}),
        graphIndex: d.graphIndex ?? PLAY_GRAPH_INDEX,
        ...(d.path !== undefined ? { path: d.path } : {})
      }))
  };
}
