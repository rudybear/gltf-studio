# Specs

This directory is the requirements source of truth (Phase P0 of the program plan — see
`docs/adr/0001-record-architecture-decisions.md` for the supersede-chain convention this
directory's sibling, `docs/adr/`, follows). Requirements, UX, and architecture are all expected to
change over the project's life; the discipline here is that they change *in the repo*, in the same
PR as the code/tests that implement the change, rather than living in a one-time planning document.

## One file per module

Each module gets one spec file, e.g. `specs/engine-api.md`. `specs/ownership.json` maps source path
globs to the spec file that owns them, so CI can require a spec diff when owned code changes (see
"Drift detection" below).

## Requirement line format

Every requirement is its own single physical line (do not wrap it across multiple lines — the
parser is line-based), in this exact shape:

```
- [DOC-001] (active) <normative statement>
```

- **ID**: a short module prefix + a zero-padded number, e.g. `DOC-001`, `RH-002`, `SP-004`,
  `AGH-001`. Prefixes are assigned per module (see each spec file's own convention note); numbers
  are never reused, even after a requirement retires.
- **Status**: one of:
  - `active` — currently binding; agents implement/test against it.
  - `retired` — superseded or removed; kept in the file (never delete a requirement line) so the ID
    is permanently known and citing it becomes a hard drift-check failure, not a silent no-op.
  - `changed-in:#<PR>` — reserved for a future PR-linked transitional status once the repo has PR
    history to link to; not used yet at M0.
- **Statement**: a single normative sentence (or short clause) describing the obligation. Keep it
  testable — if you can't picture the test, the requirement is probably not specific enough yet.

Requirements are edited, split, and retired freely, but only via PRs that also update whatever
tests cite them (`scripts/check-drift.mjs` enforces this in CI; see below).

## Test citation convention

A test "cites" a requirement by including the requirement's ID in one of two places:

1. Its test title (the string passed to `it`/`test`/`it.todo`), e.g.
   `it("patchScene returns \"needs-reload\" for a structural patch (RH-001)", ...)`.
2. A `/** @spec RH-001 */` docblock anywhere in the test file (useful when several tests in one
   file all exercise the same requirement, or the requirement doesn't map to one single test
   title).

`scripts/check-drift.mjs` scans test files for anything matching a requirement-ID-shaped token
(`[A-Z]{2,6}-\d{3,4}`) and cross-references it against every spec file's requirement registry. It
scans every `*.test.{ts,mjs,js}` file under `packages/`, plus (special case) every source file
under `packages/contract-tests/src/` — that package's `describe*Contract` factories build their
`it.todo(...)` titles from an exported obligations array rather than a string literal at the call
site, so the citing IDs live in the array, not a `*.test.ts`-named file.

## Drift detection (CI)

`node scripts/check-drift.mjs` fails the build when:

1. **A test cites an ID that doesn't exist in any spec file** ("unknown ID").
2. **A test cites an ID whose status is `retired`.**
3. **A spec file has a malformed requirement-line-shaped line** (starts like `- [ID] (...)` but
   doesn't match the full format above — e.g. bad status word, missing parens, lowercase ID).
4. **(PR context only, `GITHUB_BASE_REF` set)** a file under one of `specs/ownership.json`'s globs
   changed vs the PR's base branch, but no spec file changed in the same diff. Skipped locally and
   on plain `push` builds (no base ref to diff against).

   Run `node scripts/check-drift.mjs --simulate-pr[=<base>]` (default base `main`) to arm this
   exact check locally, without `GITHUB_BASE_REF` set — it diffs `origin/<base>...HEAD` the same
   way CI does. This is what `pnpm check:fast`/`pnpm check:ci` and the `pre-push` git hook use, so
   contributors catch ownership-drift failures before ever opening a PR, instead of finding out
   only on the PR's first CI run.

**Orphan active requirements** (status `active`, cited by zero tests) are **warn-only** for now —
printed in the report but do not fail the build. This will flip to a hard failure on a per-module
basis once that module's implementation slice lands (see the `// ORPHAN_CHECK` flag in
`scripts/check-drift.mjs`); at M0 every requirement here is intentionally pre-implementation.

## Generated status

`node scripts/gen-status.mjs` regenerates `/STATUS.md` (never hand-edit it) with, per spec file:
total/active/retired requirement counts, and per requirement the test files citing it (or a `⚠
uncited` marker). `node scripts/gen-status.mjs --check` (what CI runs) fails if `/STATUS.md` is
stale relative to what regenerating would produce.

## Task briefs

`node scripts/gen-brief.mjs <SPEC-ID...>` prints a markdown brief to stdout: the current text of
each cited requirement, which spec file it lives in, and the `ownership.json` globs for that spec
— the exact context an implementing agent needs, generated fresh from HEAD so it's never a stale
copy-paste of a requirement that has since changed.
