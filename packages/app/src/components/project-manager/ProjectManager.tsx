import { useEffect, useMemo, useState } from "react";
import type { ProjectMeta } from "@gltf-studio/engine-api";
import { useAppStore } from "../../store/app-store.js";

/** Formats an ISO timestamp as a short, locale-aware "updated" label — no relative-time library pulled in just for this. */
function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function ThumbnailImg({ thumbnail }: { thumbnail: Blob | undefined }): JSX.Element {
  const url = useMemo(() => (thumbnail ? URL.createObjectURL(thumbnail) : null), [thumbnail]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  if (!url) return <div className="pm-row-thumb pm-row-thumb-placeholder" aria-hidden="true" />;
  return <img className="pm-row-thumb" src={url} alt="" />;
}

/**
 * specs/ux-shell.md UX-122: the project manager dialog -- lists every saved
 * project (SP-022's updatedAt-descending order) with open/rename/duplicate/
 * delete, plus a "New project" action that reuses UX-120's exact empty-scene
 * starter. Mounted once at `App.tsx`'s top level, like `MissingFilesDialog`/
 * `PointerPickerDialog` -- driven entirely by the store's
 * `projectManagerOpen` (`false` = not rendered).
 */
export function ProjectManager(): JSX.Element | null {
  const open = useAppStore((s) => s.projectManagerOpen);
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = useAppStore((s) => s.projectId);
  const closeProjectManager = useAppStore((s) => s.closeProjectManager);
  const newProjectFromManager = useAppStore((s) => s.newProjectFromManager);
  const openProjectFromManager = useAppStore((s) => s.openProjectFromManager);
  const renameProject = useAppStore((s) => s.renameProject);
  const duplicateProject = useAppStore((s) => s.duplicateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      if (confirmDeleteId) setConfirmDeleteId(null);
      else closeProjectManager();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, confirmDeleteId, closeProjectManager]);

  if (!open) return null;

  function startRename(project: ProjectMeta): void {
    setRenamingId(project.id);
    setRenameValue(project.name);
  }

  function commitRename(id: string): void {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name) void renameProject(id, name);
  }

  const confirmTarget = confirmDeleteId ? (projects.find((p) => p.id === confirmDeleteId) ?? null) : null;

  return (
    <div
      className="modal-overlay open"
      data-testid="project-manager.dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeProjectManager();
      }}
    >
      <div className="pm-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Projects</h3>
          <button className="close-x" data-testid="project-manager.close-x" onClick={closeProjectManager}>
            ✕
          </button>
        </div>

        <div className="modal-foot pm-toolbar">
          <button
            className="btn primary"
            data-testid="project-manager.new"
            onClick={() => {
              void newProjectFromManager();
            }}
          >
            + New project
          </button>
        </div>

        <div className="modal-body pm-body">
          {projects.length === 0 ? (
            <div className="pm-empty" data-testid="project-manager.empty">
              <p>No saved projects yet.</p>
              <button
                className="btn primary"
                data-testid="project-manager.empty.new"
                onClick={() => {
                  void newProjectFromManager();
                }}
              >
                + New project
              </button>
            </div>
          ) : (
            <ul className="pm-list">
              {projects.map((project, index) => (
                <li
                  key={project.id}
                  className={`pm-row${project.id === currentProjectId ? " pm-row-current" : ""}`}
                  data-testid={`project-manager.row.${index}`}
                >
                  <ThumbnailImg thumbnail={project.thumbnail} />
                  <div className="pm-row-info">
                    {renamingId === project.id ? (
                      <input
                        className="field pm-rename-input"
                        data-testid={`project-manager.row.${index}.rename-input`}
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(project.id);
                          else if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span className="pm-row-name" data-testid={`project-manager.row.${index}.name`}>
                        {project.name}
                      </span>
                    )}
                    <span className="pm-row-updated">Updated {formatUpdatedAt(project.updatedAt)}</span>
                  </div>
                  <div className="pm-row-actions">
                    <button
                      className="btn small"
                      data-testid={`project-manager.row.${index}.open`}
                      onClick={() => {
                        void openProjectFromManager(project.id);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className="btn small"
                      data-testid={`project-manager.row.${index}.rename`}
                      onClick={() => startRename(project)}
                    >
                      Rename
                    </button>
                    <button
                      className="btn small"
                      data-testid={`project-manager.row.${index}.duplicate`}
                      onClick={() => {
                        void duplicateProject(project.id);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      className="btn small danger"
                      data-testid={`project-manager.row.${index}.delete`}
                      onClick={() => setConfirmDeleteId(project.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {confirmTarget && (
        <div
          className="modal-overlay open pm-confirm-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDeleteId(null);
          }}
        >
          <div className="pm-confirm-modal" role="alertdialog" aria-modal="true" data-testid="project-manager.delete-confirm">
            <p>
              Delete &ldquo;{confirmTarget.name}&rdquo;? This can&rsquo;t be undone.
            </p>
            <div className="modal-foot">
              <button className="btn" data-testid="project-manager.delete-confirm.cancel" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <div className="topbar-spacer" />
              <button
                className="btn danger"
                data-testid="project-manager.delete-confirm.confirm"
                onClick={() => {
                  void deleteProject(confirmTarget.id);
                  setConfirmDeleteId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
