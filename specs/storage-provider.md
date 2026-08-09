# storage-provider

Owns: `packages/engine-api/src/storage-provider.ts`, `packages/contract-tests/src/storage-provider.ts`
(see `specs/ownership.json`).

`StorageProvider` is the persistence abstraction (Phase A of the program plan): all project
persistence goes through this interface so auth/cloud/sharing arrive later without editor rework.
Concrete implementations at v1 are IndexedDB and File System Access; an HTTP implementation is
planned later. This spec supersedes the `SP-###` requirements seeded directly into
`specs/engine-api.md` at M0 (SP-001, SP-004 move here verbatim, same IDs, per `specs/README.md`'s
"numbers are never reused" rule) and adds the full set of requirements the seed file called out as
a follow-up task.

Prefix: `SP`. Numbers below continue from the two IDs seeded in `specs/engine-api.md`
(SP-001, SP-004); this file now owns the entire `SP` numbering space going forward.

## Requirements

### Moved from specs/engine-api.md (verbatim, same IDs)

- [SP-001] (active) All project persistence goes through `StorageProvider` (`listProjects/create/load/save`); concrete implementations at v1 are IndexedDB and File System Access, with an HTTP implementation planned later, and editor code must depend only on the interface, never on a concrete implementation.
- [SP-004] (active) `StorageProvider.autosaveJournal(id, sinceRev, patches)` is patch-shaped (RFC 6902 `JsonPatchOp[]`), doubling as the future backend sync wire format; `loadJournal` returns the same patch-journal shape for crash recovery (crash recovery ≡ sync protocol). (`id` added at M2 — the signature as originally seeded from `specs/engine-api.md` omitted it, but a per-project append-only journal cannot be addressed without one; see `loadJournal(id)`, which always took it.)

### Project lifecycle semantics

- [SP-005] (active) `create(meta)` assigns the new project an id that no prior `create()` call on the same provider instance has returned (id uniqueness).
- [SP-006] (active) The id assigned by `create()` for a project never changes across that project's subsequent `load()`/`save()` calls (id stability).
- [SP-007] (active) A project created via `create()` is included in the result of any `listProjects()` call made afterward, identified by the id `create()` assigned.

### save() signature and semantics

- [SP-008] (active) `save(id, data)` writes `data.container` as exactly the byte output of `writeContainer` — `save` performs no independent serialization of its own; the bytes it persists are whatever the document layer's save path (see `specs/document-model.md`) already produced via `writeContainer`.
- [SP-009] (active) `save(id, data)` additionally writes `data.sidecar` (the per-project sidecar state — panel layout, camera bookmarks, per `specs/document-model.md`'s state-homes policy) in the same call that writes the container bytes.
- [SP-010] (active) A `load(id)` call following a successful `save(id, data)` returns a `ProjectData` whose `container` bytes and `sidecar` are exactly what that `save` call wrote (round-trip).

### ProjectMeta / ProjectData shapes

- [SP-011] (active) `ProjectMeta` has fields `id: string`, `name: string`, `createdAt: string`, `updatedAt: string`, and an optional `thumbnail?: Blob`.
- [SP-012] (active) `ProjectData` has fields `meta: ProjectMeta`, `container: Uint8Array` (the `writeContainer` byte output), and `sidecar: unknown` — `StorageProvider` persists and returns `sidecar` opaquely, without interpreting its contents.

### Capabilities flags

- [SP-013] (active) `StorageProvider.capabilities` is exactly `{ fileHandles: boolean; remote: boolean }`; `fileHandles` is `true` only for a File-System-Access-backed provider, `remote` is `true` only for the future HTTP-backed provider.

### Journal semantics

- [SP-014] (active) `autosaveJournal(id, sinceRev, patches)` appends `patches` to `id`'s append-only journal, scoped to the rev-window starting at `sinceRev`; it never removes or reorders previously appended entries.
- [SP-015] (active) Journal replay is defined as: load the project's base `ProjectData` via `load(id)`, then apply `loadJournal(id)`'s `patches` to it in the order they were appended.
- [SP-016] (active) A successful `save(id, data)` clears that project's journal — the newly saved container/sidecar becomes the new base, leaving no patches to replay from it.

### Error semantics

- [SP-017] (active) A `StorageProvider` method rejects with a `StorageError` whose `kind` is `"quota-exceeded"` when the underlying storage backend refuses a write because of a quota limit.
- [SP-018] (active) `load(id)` rejects with a `StorageError` whose `kind` is `"not-found"` when `id` does not correspond to any existing project.
- [SP-019] (active) A File-System-Access-backed provider's method rejects with a `StorageError` whose `kind` is `"permission-revoked"` when the underlying file handle's permission has been revoked since it was granted.
- [SP-020] (active) `StorageError` is a distinct error type carrying a `kind` field drawn from the fixed `StorageErrorKind` enum, so callers can branch on error kind rather than string-matching messages.

## Open questions

- OPEN: `listProjects()`'s result ordering (e.g. by `updatedAt`, `createdAt`, `name`, or raw insertion order) is not specified by the plan. SP-005/SP-006 pin down id uniqueness/stability but not list order.
- OPEN: autosave cadence/trigger policy for `autosaveJournal` (debounce interval, whether it is time-based or edit-count-based) is not specified by the plan beyond the general "document frozen during play" invariant (`specs/document-model.md`'s DOC-030), which implies no new patches are produced *during* play but does not itself state an explicit `StorageProvider`-layer autosave cadence.
- OPEN: `loadJournal(id)`'s behavior for a project with an empty journal (no patches appended since its last save) is not specified by the plan — whether it resolves to `{ sinceRev: <current rev>, patches: [] }` or something else is left to a future PR.
- OPEN(SP-create-signature-tbd carried over): `create()`'s full input validation semantics (e.g. behavior on a duplicate `name`, or on partially-invalid `meta`) are not specified by the plan beyond id assignment (SP-005/SP-006).
- OPEN: `sidecar`'s internal shape (the actual panel-layout/camera-bookmark fields) is opaque to `StorageProvider` per SP-012 and belongs to `editor-core`/the future `app` package; this spec does not enumerate it.
