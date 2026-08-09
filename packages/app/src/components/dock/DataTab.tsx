import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import {
  breadcrumbSegments,
  crossReferenceTarget,
  isNumericSegment,
  parseDataPointer,
  resolveContainer
} from "../../lib/data-tab";

/**
 * specs/ux-data-tab.md UX-800..807: a read-only view of the raw authored
 * glTF JSON around whatever pointer path the rest of the editor last
 * pointed at (scene tree / viewport selection passively, per UX-805; asset
 * browser rows force-switch here, UX-806/UX-211). No editing affordance
 * (UX-804).
 */
export function DataTab(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dataPointer = useAppStore((s) => s.dataPointer);
  const navigateData = useAppStore((s) => s.navigateData);

  const pointer = useMemo(() => parseDataPointer(dataPointer || "/nodes/0"), [dataPointer]);
  const container = document ? resolveContainer(document.json, pointer.containerPath) : undefined;
  const segments = breadcrumbSegments(pointer);

  if (!document || !dataPointer) {
    return (
      <div className="data-tab-wrap" data-testid="data.panel">
        <div className="empty-note" data-testid="data.empty">
          Select a node, mesh, material, or animation to inspect its raw glTF JSON.
        </div>
      </div>
    );
  }

  return (
    <div className="data-tab-wrap" data-testid="data.panel">
      <div className="data-breadcrumb" data-testid="data.breadcrumb">
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          if (isNumericSegment(segment)) {
            const pathSoFar = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={i}>
                <button className="data-breadcrumb-link" data-testid={`data.breadcrumb.link.${i}`} onClick={() => navigateData(pathSoFar)}>
                  {segment}
                </button>
                {!isLast && <span className="data-breadcrumb-static">/</span>}
              </span>
            );
          }
          return (
            <span key={i}>
              <span className="data-breadcrumb-static">{segment}</span>
              {!isLast && <span className="data-breadcrumb-static">/</span>}
            </span>
          );
        })}
      </div>
      {/* `key` forces a full remount (and therefore fresh, all-collapsed twisty
          state throughout the tree) whenever the container itself changes,
          exactly matching UX-801's "resets whenever the container changes,
          not preserved across navigation" without hand-rolled reset logic. */}
      <div className="data-view" data-testid="data.view" key={pointer.containerPath}>
        {container === undefined ? (
          <div className="empty-note" data-testid="data.not-found">
            Nothing at {pointer.containerPath}.
          </div>
        ) : (
          <JsonContainer container={container} highlightProp={pointer.highlightProp} onNavigate={navigateData} />
        )}
      </div>
    </div>
  );
}

function JsonContainer({
  container,
  highlightProp,
  onNavigate
}: {
  container: unknown;
  highlightProp: string | undefined;
  onNavigate: (pointer: string) => void;
}): JSX.Element {
  if (container === null || typeof container !== "object") {
    return <span className="data-val">{JSON.stringify(container)}</span>;
  }
  const entries: Array<[string | number, unknown]> = Array.isArray(container)
    ? container.map((v, i) => [i, v] as [number, unknown])
    : Object.entries(container as Record<string, unknown>);

  return (
    <>
      {entries.map(([key, value]) => (
        <JsonLine key={String(key)} keyPath={[key]} value={value} depth={0} highlighted={key === highlightProp} onNavigate={onNavigate} />
      ))}
    </>
  );
}

function JsonLine({
  keyPath,
  value,
  depth,
  highlighted,
  onNavigate
}: {
  keyPath: Array<string | number>;
  value: unknown;
  depth: number;
  highlighted: boolean;
  onNavigate: (pointer: string) => void;
}): JSX.Element {
  const isContainer = value !== null && typeof value === "object";
  const [expanded, setExpanded] = useState(false); // UX-801: collapsed by default
  const crossRef = crossReferenceTarget(keyPath, value);
  const lineRef = useRef<HTMLDivElement>(null);
  const key = keyPath[keyPath.length - 1];

  useEffect(() => {
    // UX-803: highlight + scroll the named property's line into view.
    if (highlighted) lineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <div>
      <div
        ref={lineRef}
        className={`data-line${highlighted ? " data-line-highlight" : ""}`}
        style={{ paddingLeft: depth * 16 }}
        data-testid={depth === 0 ? `data.line.${key}` : undefined}
      >
        {isContainer ? (
          <button className="data-twisty" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="data-twisty-spacer" />
        )}
        <span className="data-key">{typeof key === "number" ? `[${key}]` : key}</span>
        {": "}
        {isContainer ? (
          <span className="data-val dim">{Array.isArray(value) ? `Array(${(value as unknown[]).length})` : "Object"}</span>
        ) : crossRef ? (
          <button className="data-link" onClick={() => onNavigate(crossRef)}>
            {String(value)}
          </button>
        ) : (
          <span className="data-val">{JSON.stringify(value)}</span>
        )}
      </div>
      {isContainer && expanded && (
        <div className="data-children">
          {(Array.isArray(value)
            ? value.map((v, i) => [i, v] as [number, unknown])
            : Object.entries(value as Record<string, unknown>)
          ).map(([k, v]) => (
            <JsonLine key={String(k)} keyPath={[...keyPath, k]} value={v} depth={depth + 1} highlighted={false} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}
