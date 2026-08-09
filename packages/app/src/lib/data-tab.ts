// Data (glTF) tab addressing (specs/ux-data-tab.md, UX-800..807): a
// deliberately narrow model — a fixed set of container shapes (`/nodes/{i}`,
// `/meshes/{i}`, `/materials/{i}`, `/animations/{i}`) plus one optional
// highlighted property one level inside the container — not a general JSON
// pointer walker (see that spec's "Open questions").
export interface DataPointer {
  /** e.g. "/nodes/3" — always exactly `/{arrayName}/{index}`. */
  containerPath: string;
  /** Set when the pointer named a specific property one level inside the container (UX-803). */
  highlightProp?: string;
}

export function parseDataPointer(pointer: string): DataPointer {
  const segments = pointer.split("/").filter((s) => s.length > 0);
  const containerSegments = segments.slice(0, 2);
  const rest = segments.slice(2);
  return {
    containerPath: "/" + containerSegments.join("/"),
    highlightProp: rest.length > 0 ? rest[0] : undefined
  };
}

export function breadcrumbSegments(pointer: DataPointer): string[] {
  const parts = pointer.containerPath.split("/").filter((s) => s.length > 0);
  if (pointer.highlightProp) parts.push(pointer.highlightProp);
  return parts;
}

export function isNumericSegment(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/** Resolves the container value a pointer's `containerPath` names, within the document's raw json. */
export function resolveContainer(json: unknown, containerPath: string): unknown {
  const segments = containerPath.split("/").filter((s) => s.length > 0);
  let current: unknown = json;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    const key = isNumericSegment(segment) ? Number(segment) : segment;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * UX-802: a numeric value under a recognized cross-reference key renders as
 * a clickable link instead of a plain number. `keyPath` is the chain of
 * object/array keys from the container root down to this value (e.g.
 * `["mesh"]`, or `["primitives", "0", "material"]`, or `["channels", "0",
 * "target", "node"]`).
 */
export function crossReferenceTarget(keyPath: Array<string | number>, value: unknown): string | undefined {
  if (typeof value !== "number") return undefined;
  const lastKey = keyPath[keyPath.length - 1];
  const parentKey = keyPath[keyPath.length - 2];
  if (lastKey === "mesh") return `/meshes/${value}`;
  if (lastKey === "material") return `/materials/${value}`;
  if (lastKey === "node" && parentKey === "target") return `/nodes/${value}`;
  return undefined;
}
