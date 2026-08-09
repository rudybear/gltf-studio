// Typed StorageError (SP-017..SP-020): every StorageProvider method rejects
// with an instance of this class (never a bare string or generic Error) so
// callers branch on `kind` rather than string-matching messages.
import type { StorageError, StorageErrorKind } from "@gltf-studio/engine-api";

export class StorageErrorImpl extends Error implements StorageError {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.kind = kind;
  }
}

/** SP-018: `load(id)` rejects with this when `id` names no existing project. */
export function notFoundError(id: string): StorageErrorImpl {
  return new StorageErrorImpl("not-found", `No project exists with id "${id}".`);
}

/** SP-017: a write rejects with this when the backend refuses it on quota grounds. */
export function quotaExceededError(cause?: unknown): StorageErrorImpl {
  return new StorageErrorImpl("quota-exceeded", "Storage quota exceeded while writing project data.", { cause });
}

/** SP-019: a File-System-Access-backed provider rejects with this when a handle's permission was revoked. */
export function permissionRevokedError(cause?: unknown): StorageErrorImpl {
  return new StorageErrorImpl(
    "permission-revoked",
    "File System Access permission was revoked for this project's file handle.",
    { cause }
  );
}

/** True for a DOMException (or DOMException-shaped error) whose name is "QuotaExceededError". */
export function isQuotaDomError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name: unknown }).name === "QuotaExceededError";
}

/** True for a DOMException (or DOMException-shaped error) whose name indicates a revoked/denied permission. */
export function isPermissionDomError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name: unknown }).name;
  return name === "NotAllowedError" || name === "SecurityError";
}
