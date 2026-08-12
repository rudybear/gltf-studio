/**
 * Small stylized SVG preview icons for the empty-project starter gallery
 * (specs/ux-shell.md UX-120, supersedes UX-119, Viewport.tsx). Inline SVG
 * (not a captured screenshot PNG) on purpose — no headless-capture build
 * step, nothing to regenerate/go-stale when either sample asset changes, and
 * it costs the bundle a few hundred bytes of JSX instead of image bytes.
 * Each is a loose, schematic caricature of its card (not a faithful render)
 * purely to give the two cards a visually distinct identity at a glance.
 */

const VIEWBOX = "0 0 96 64";

/**
 * UX-120: a minimal ground-plane grid with no scene content on it at all —
 * deliberately empty, matching the card's real zero-node document, unlike
 * the retired Playground card's populated-scene caricature. A faint
 * dashed-outline "add something" cube hints at `+ Add` without depicting
 * actual scene content that doesn't exist yet.
 */
export function EmptyScenePreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="Empty scene preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      {/* Ground grid, in perspective */}
      <g stroke="var(--border)" strokeWidth="1" fill="none">
        <line x1="8" y1="50" x2="88" y2="50" />
        <line x1="16" y1="42" x2="80" y2="42" />
        <line x1="24" y1="34" x2="72" y2="34" />
        <line x1="48" y1="26" x2="18" y2="50" />
        <line x1="48" y1="26" x2="34" y2="50" />
        <line x1="48" y1="26" x2="48" y2="50" />
        <line x1="48" y1="26" x2="62" y2="50" />
        <line x1="48" y1="26" x2="78" y2="50" />
      </g>
      {/* A dashed, unfilled cube outline -- the "nothing here yet, use + Add" hint */}
      <rect x="40" y="30" width="16" height="14" rx="1" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 2" />
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
