import { useEffect, useState } from "react";
import type { PlayInspection } from "@gltf-studio/engine-api";
import { debugVirtualSourceUrl } from "@gltf-studio/play";
import { useAppStore, getActivePlayController } from "../../store/app-store";

const EMPTY_INSPECTION: PlayInspection = { time: 0, variables: {}, sentEvents: [] };

/**
 * `inspect().variables[key]` is a real `@gltfi/kernel` `Value`
 * (`{ type: ValueType, data: number[] | boolean[] | string[] }`), per both
 * engines' `getVariableByIndex` — see packages/play/src/play-controller.test.ts's
 * own `toEqual({ type: "int", data: [0] })`-shaped assertions, which document
 * this as the real, tested contract, not merely a raw scalar. A bare
 * `String(value)` on that object renders "[object Object]"; this formats a
 * single-component value as its scalar and a multi-component one (a
 * float2/float3/... or an int/bool array) as a bracketed, comma-joined list.
 */
function formatPlayValue(value: unknown): string {
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    const data = (value as { data: Array<number | boolean | string> }).data;
    return data.length === 1 ? String(data[0]) : `[${data.join(", ")}]`;
  }
  return String(value);
}

/**
 * specs/ux-viewport.md UX-309/UX-310/UX-311: the "Variables (live)" overlay,
 * bottom-right of the viewport, shown while `playing`/`paused`. `inspect()`
 * is a pull method (not reactive/pushed), so this component runs its own
 * `requestAnimationFrame` polling loop while play mode is active to show
 * live-updating values.
 *
 * data-testid pattern (documented here for a later e2e-test-writing agent):
 *   - "viewport.play-overlay" — the overlay container itself.
 *   - "viewport.play-overlay.time" — the elapsed sim time.
 *   - "viewport.play-overlay.events-count" — `sentEvents.length`.
 *   - "viewport.play-overlay.variable.${key}" — one per entry in `variables`,
 *     keyed by that variable's declared id (or numeric index) per PC-002.
 *   - "viewport.play-overlay.debug-hint" — specs/ux-debugger.md UX-1504:
 *     shown only for a session started with the compiled engine's Debug
 *     toggle checked (specs/ux-shell.md UX-130, PC-009's `debug: true`).
 */
export function PlayOverlay(): JSX.Element | null {
  const playState = useAppStore((s) => s.playState);
  const playEngine = useAppStore((s) => s.playEngine);
  const playDebug = useAppStore((s) => s.playDebug);
  const [inspection, setInspection] = useState<PlayInspection>(EMPTY_INSPECTION);

  useEffect(() => {
    if (playState === "stopped") return;
    let frame: number;
    const poll = (): void => {
      setInspection(getActivePlayController()?.inspect() ?? EMPTY_INSPECTION);
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [playState]);

  if (playState === "stopped") return null;

  const variableEntries = Object.entries(inspection.variables);
  const isDebugSession = playEngine === "compiled" && playDebug;

  return (
    <div className="play-overlay" data-testid="viewport.play-overlay">
      <h5>Variables (live)</h5>
      {isDebugSession && (
        <div className="play-overlay-row play-overlay-debug-hint" data-testid="viewport.play-overlay.debug-hint" title={debugVirtualSourceUrl(0)}>
          Debuggable — open DevTools → Sources → gltf-studio://
        </div>
      )}
      <div className="play-overlay-row" data-testid="viewport.play-overlay.time">
        <span className="key">Time</span>
        <span className="val">{inspection.time.toFixed(1)}s</span>
      </div>
      {variableEntries.map(([key, value]) => (
        <div className="play-overlay-row" data-testid={`viewport.play-overlay.variable.${key}`} key={key}>
          <span className="key">{key}</span>
          <span className="val">{formatPlayValue(value)}</span>
        </div>
      ))}
      <div className="play-overlay-row" data-testid="viewport.play-overlay.events-count">
        <span className="key">Events sent</span>
        <span className="val">{inspection.sentEvents.length}</span>
      </div>
    </div>
  );
}
