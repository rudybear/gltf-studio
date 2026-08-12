/**
 * specs/ux-usage-mapping.md UX-1116: the small ⚡ ambient reference badge
 * shown on a scene-tree/asset-browser row referenced by behavior — a plain,
 * memo-cheap presentational component (the row it's inside already
 * memoized/derived its own `count` from `useUsageIndexes`; this component
 * itself does no derivation) shared by `SceneTree.tsx` and `AssetBrowser.tsx`
 * so the badge's markup/testid/tooltip shape is defined exactly once.
 */
export function UsageBadge({ count, testId, onClick }: { count: number; testId: string; onClick: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <button
      type="button"
      className="usage-badge"
      data-testid={testId}
      title={`${count} reference${count === 1 ? "" : "s"}`}
      onClick={(e) => {
        e.stopPropagation(); // never also trigger the row's own onClick (select/navigate-to-data-tab)
        onClick(e);
      }}
    >
      ⚡
    </button>
  );
}
