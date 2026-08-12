/**
 * specs/ux-tour.md UX-1203: the tour's "seen/dismissed/completed" state is
 * inherently app-level, not project-level — the first-visit banner
 * (`UX-1201`) must be able to render before any project is even open, when
 * there is no project `id` to key a `StorageProvider.save(id, data)` call
 * off of (`packages/engine-api/src/storage-provider.ts` is entirely
 * project-scoped). `ProjectData.sidecar` (`specs/storage-provider.md`,
 * meant for exactly this kind of small persisted UI state) has no working
 * read/write path anywhere in this codebase today — its only call site
 * (`app-store.ts`) hardcodes `sidecar: null` — so there is nothing to
 * plug a per-project flag into even if this state WERE project-scoped.
 * A single dedicated `localStorage` record, read/written only through this
 * module, is the deliberately small alternative: one seam, not scattered
 * `localStorage.getItem` calls across the tour engine/banner/top-bar button.
 */

const STORAGE_KEY = "gltf-studio.tour.v1";

export interface TourStorageRecord {
  bannerDismissed: boolean;
  completed: boolean;
}

const DEFAULT_RECORD: TourStorageRecord = { bannerDismissed: false, completed: false };

function safeParse(raw: string | null): TourStorageRecord {
  if (!raw) return { ...DEFAULT_RECORD };
  try {
    const parsed = JSON.parse(raw) as Partial<TourStorageRecord>;
    return {
      bannerDismissed: parsed.bannerDismissed === true,
      completed: parsed.completed === true
    };
  } catch {
    return { ...DEFAULT_RECORD };
  }
}

/** Reads the current record; a missing/corrupt record reads as "never seen" (both flags false). */
export function readTourStorage(): TourStorageRecord {
  if (typeof localStorage === "undefined") return { ...DEFAULT_RECORD };
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

function write(record: TourStorageRecord): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** UX-1202: persists the banner's dismissal so it never reappears in this browser. */
export function markBannerDismissed(): void {
  write({ ...readTourStorage(), bannerDismissed: true });
}

/**
 * UX-1204: reaching and closing the tour's final step marks it complete.
 * Also implies the banner is dismissed (a completed tour has nothing left
 * for the banner to offer).
 */
export function markTourCompleted(): void {
  write({ bannerDismissed: true, completed: true });
}
