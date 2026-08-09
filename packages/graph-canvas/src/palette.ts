// Category -> a fixed accent color, one token per registry OpCategory (the
// 9 categories in @gltfi/kernel's registry: math/type/ref/flow/variable/
// pointer/animation/event/debug) plus "unknown" for unregistered ops.
// Deliberately not theme-derived (VS Code exposes no "categorical palette"
// token) but chosen to read fine on both light and dark editor backgrounds.
// Shared by OpNode, the MiniMap node-color callback, and NodeListFallback so
// the graph canvas and the >2000-node fallback list agree visually.
// (Carried over unchanged from the B2 webview/main.ts list view.)

import type { OpCategory } from "@gltfi/kernel";

export const CATEGORY_COLORS: Record<OpCategory | "unknown", string> = {
  math: "#4c956c",
  type: "#3c9dc9",
  ref: "#b5838d",
  flow: "#e0a458",
  variable: "#6c91bf",
  pointer: "#a66dd4",
  animation: "#d46a6a",
  event: "#e3b23c",
  debug: "#8a8a8a",
  unknown: "#8a8a8a"
};

export function categoryColor(category: OpCategory | "unknown"): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unknown;
}

// Value-edge/port color by resolved type signature. A small fixed palette
// for the common KHR_interactivity scalar/vector/matrix families, with a
// deterministic hash-based fallback for anything else (custom/pointer
// signatures, generics that never resolved) so colors stay stable across
// renders without needing to enumerate every possible signature.
const TYPE_COLORS: Record<string, string> = {
  bool: "#c586c0",
  int: "#4ec9b0",
  float: "#569cd6",
  float2: "#4fa3d1",
  float3: "#3f8fc9",
  float4: "#2f7ac0",
  float2x2: "#d19a66",
  float3x3: "#c98a4d",
  float4x4: "#c17a35",
  string: "#d7ba7d"
};

const HASH_FALLBACK_COLORS = ["#e06c75", "#98c379", "#61afef", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

export function typeColor(type: string | undefined): string {
  if (!type) return "var(--vscode-editorWidget-border, #8888)";
  const fixed = TYPE_COLORS[type];
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return HASH_FALLBACK_COLORS[hash % HASH_FALLBACK_COLORS.length]!;
}
