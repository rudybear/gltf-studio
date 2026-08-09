// Category -> a fixed accent color, one token per registry OpCategory (the
// 9 categories in @gltfi/kernel's registry: math/type/ref/flow/variable/
// pointer/animation/event/debug) plus "unknown" for unregistered ops, plus
// (M7) "audio" for @gltf-studio/audio-canvas's KHR_audio_graph nodes
// (specs/ux-audio-graph.md UX-601: "a category color distinct from every
// behavior-graph category color" — reusing this SAME map, rather than a
// second one, is what makes that guarantee automatic instead of something
// two files have to agree on by convention). Deliberately not theme-derived
// (VS Code exposes no "categorical palette" token) but chosen to read fine
// on both light and dark editor backgrounds. Shared by OpNode, the MiniMap
// node-color callback, and NodeListFallback so the graph canvas and the
// >2000-node fallback list agree visually. (Carried over unchanged from the
// B2 webview/main.ts list view, plus the M7 "audio" addition below.)
//
// Typed as `Record<string, string>` (not `Record<OpCategory | "unknown",
// string>`) since M7 — see map-graph.ts's `MappedNode.category` widening
// note for why. `categoryColor` falls back to a deterministic hash color
// (the same technique `typeColor` below already uses) for any category
// string this map doesn't enumerate, rather than flattening every unknown
// category to one indistinguishable gray.

export const CATEGORY_COLORS: Record<string, string> = {
  math: "#4c956c",
  type: "#3c9dc9",
  ref: "#b5838d",
  flow: "#e0a458",
  variable: "#6c91bf",
  pointer: "#a66dd4",
  animation: "#d46a6a",
  event: "#e3b23c",
  debug: "#8a8a8a",
  unknown: "#8a8a8a",
  audio: "#2f9e8f"
};

const CATEGORY_HASH_FALLBACK_COLORS = ["#e06c75", "#98c379", "#61afef", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

export function categoryColor(category: string): string {
  const fixed = CATEGORY_COLORS[category];
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return CATEGORY_HASH_FALLBACK_COLORS[hash % CATEGORY_HASH_FALLBACK_COLORS.length]!;
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
