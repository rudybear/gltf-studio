import type { NodeIconType } from "../../lib/gltf-scene";

// Simplified versions of the mockup's per-type SVG icons (docs/ux/mockups/mockup-v5.html's
// ICONS map) — same shapes, trimmed for a plain React component.
const PATHS: Record<NodeIconType, JSX.Element> = {
  mesh: (
    <path d="M8 1.3 14 4.6v6.8L8 14.7 2 11.4V4.6Z M8 8v6.7M8 8 2 4.6M8 8l6-3.4" />
  ),
  light: (
    <>
      <circle cx="8" cy="7.2" r="3.6" />
      <path d="M8 1v1.4M8 13v1.4M2.4 7.2H1M15 7.2h-1.4M3.6 2.8l1 1M11.4 2.8l-1 1" />
    </>
  ),
  camera: (
    <>
      <rect x="1.3" y="4.5" width="13.4" height="9" rx="1.4" />
      <circle cx="8" cy="9" r="2.5" />
      <path d="M5.3 4.5 6.4 2.3h3.2l1.1 2.2" />
    </>
  ),
  "audio-emitter": (
    <>
      <path d="M2 6.2h2.3L8 3.2v9.6L4.3 9.8H2Z" />
      <path d="M10.6 5.6a4 4 0 0 1 0 4.8M12.7 4a6.5 6.5 0 0 1 0 8" />
    </>
  ),
  group: <path d="M1.3 4.3h4l1.2 1.5h8.2v6.9h-13.4Z" />,
  clip: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.4 5.2 11 8l-4.6 2.8Z" />
    </>
  )
};

export function NodeIcon({ type }: { type: NodeIconType }): JSX.Element {
  return (
    <span className="tree-icon">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2">
        {PATHS[type]}
      </svg>
    </span>
  );
}
