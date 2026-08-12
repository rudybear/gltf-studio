import { useEffect } from "react";
import { useAppStore } from "../../store/app-store.js";

function formatKB(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
}

/**
 * specs/ux-shell.md UX-126: the share dialog -- always offers `share.download`
 * (identical delivery to `topbar.export`), plus either a copyable link
 * (`share.link-output`/`share.copy-link`, when the gzipped asset fits under
 * the size limit) or an explanatory `share.too-large-note` when it doesn't.
 * Mounted once at `App.tsx`'s top level, driven by the store's `shareDialog`
 * (`null` = not rendered).
 */
export function ShareDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.shareDialog);
  const closeShareDialog = useAppStore((s) => s.closeShareDialog);
  const downloadShareAsset = useAppStore((s) => s.downloadShareAsset);
  const copyShareLink = useAppStore((s) => s.copyShareLink);

  useEffect(() => {
    if (!dialog) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") closeShareDialog();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, closeShareDialog]);

  if (!dialog) return null;

  return (
    <div
      className="modal-overlay open"
      data-testid="share.dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeShareDialog();
      }}
    >
      <div className="mf-modal share-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Share</h3>
          <button className="close-x" data-testid="share.close-x" onClick={closeShareDialog}>
            ✕
          </button>
        </div>
        <div className="modal-body mf-body">
          {dialog.status === "building" && <p>Preparing…</p>}

          {dialog.status === "error" && <p data-testid="share.error">Couldn&rsquo;t prepare this asset for sharing: {dialog.message}</p>}

          {(dialog.status === "ready" || dialog.status === "too-large" || dialog.status === "error") && (
            <p>
              <button
                className="btn"
                data-testid="share.download"
                disabled={!("blob" in dialog)}
                onClick={() => {
                  void downloadShareAsset();
                }}
              >
                Download {dialog.filename}
              </button>
            </p>
          )}

          {dialog.status === "ready" && (
            <>
              <p>Anyone with this link can open a copy of this project (the asset itself travels inside the link — no server involved):</p>
              <input className="field share-link-output" data-testid="share.link-output" readOnly value={dialog.url} onFocus={(e) => e.currentTarget.select()} />
              <p>
                <button
                  className="btn primary"
                  data-testid="share.copy-link"
                  onClick={() => {
                    void copyShareLink();
                  }}
                >
                  Copy link
                </button>
              </p>
              <p className="mf-hint">({formatKB(dialog.gzippedBytes)} compressed)</p>
            </>
          )}

          {dialog.status === "too-large" && (
            <p className="mf-hint" data-testid="share.too-large-note">
              This asset is {formatKB(dialog.gzippedBytes)} compressed — too large to fit in a shareable link. Use the download above and share the
              file directly instead.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
