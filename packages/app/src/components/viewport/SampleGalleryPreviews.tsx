/**
 * Small stylized SVG preview icons for the empty-project starter gallery
 * (specs/ux-shell.md UX-119, Viewport.tsx). Inline SVG (not a captured
 * screenshot PNG) on purpose — no headless-capture build step, nothing to
 * regenerate/go-stale when either sample asset changes, and it costs the
 * bundle a few hundred bytes of JSX instead of image bytes. Each is a loose,
 * schematic caricature of its scene (not a faithful render) purely to give
 * the two cards a visually distinct identity at a glance.
 */

const VIEWBOX = "0 0 96 64";

export function PlaygroundPreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="Playground preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      <rect x="6" y="46" width="84" height="4" rx="2" fill="var(--border)" />
      {/* SpinningCube (red) */}
      <rect x="16" y="30" width="16" height="16" rx="2" fill="#c0453d" />
      {/* ButtonSphere (green) */}
      <circle cx="48" cy="38" r="9" fill="#3f9e5c" />
      {/* TogglePillar (blue) */}
      <rect x="68" y="18" width="10" height="28" rx="2" fill="#3d6fc0" />
      {/* Lamp glow */}
      <circle cx="48" cy="14" r="4" fill="#e8d27a" opacity="0.85" />
    </svg>
  );
}

export function RacerPreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="R4 Racer preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      {/* Track ring */}
      <ellipse cx="48" cy="34" rx="38" ry="22" fill="none" stroke="var(--border)" strokeWidth="10" />
      <ellipse cx="48" cy="34" rx="38" ry="22" fill="none" stroke="#555" strokeWidth="4" strokeDasharray="3 4" />
      {/* Car */}
      <rect x="70" y="30" width="8" height="5" rx="1.5" fill="#c0453d" />
      {/* Rival */}
      <rect x="62" y="24" width="7" height="4" rx="1.5" fill="#7a7a7a" />
      {/* Steer pads */}
      <rect x="8" y="14" width="7" height="6" rx="1.5" fill="#d8a23a" />
      <rect x="8" y="44" width="7" height="6" rx="1.5" fill="#d8a23a" />
    </svg>
  );
}
