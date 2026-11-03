# 3. Vendor @gltfi/* and the three.js adapter as tarballs, not npm ranges

Status: active

## Context

`gltf-studio` reuses substantial code from the `gltf-interactivity` transpiler monorepo
(`@gltfi/kernel`, `@gltfi/ir`, `@gltfi/gltf`, `@gltfi/emit-ts`, `@gltfi/parse-ts`, `@gltfi/verify`,
`@gltfi/runtime`, `@gltfi/runtime-lib`) and the `@gltfi/three-adapter` package from
`gltf-interactivity-three`. None of these are published to npm yet (blocked on an `npm login` step
outside this repo's control — see `gltf-interactivity-three`'s `INTEGRATION-NOTES.md` F7 for the
history). `gltf-interactivity-three` and `gltf-interactivity-vscode` already solved this exact
problem with a vendoring script; this ADR adopts the same pattern rather than inventing a new one.

## Decision

`scripts/refresh-vendor.mjs` builds the sibling monorepos (`../gltf-interactivity`,
`../gltf-interactivity-three`, assumed checked out next to this repo — the existing convention)
and `pnpm pack`s each vendored package into `vendor/*.tgz`, committed to git. `pnpm-workspace.yaml`
declares an `overrides` entry per vendored package name pointing at its tarball, so any
occurrence of that package name anywhere in the dependency graph — direct or transitive — resolves
to the exact committed bytes regardless of the semver range a consumer declares.

At M0, nothing in this workspace depends on the vendored packages yet (`engine-api` and
`contract-tests` are types-only/dependency-free per the program plan's M0 scope) — the overrides
are wired and inert. Running `refresh-vendor.mjs` against the real sibling monorepos and producing
valid, correctly-scoped tarballs is what "proves the pipeline" for M0; the packages doing real
`import`s of `@gltfi/*` (`engine-three`, `script-panel`, `play`, etc.) arrive in later milestones.

## Consequences

Zero registry dependency for these packages, and pinned exact bytes (no surprise upstream changes
mid-milestone). The tradeoff is a manual refresh step (`pnpm refresh:vendor`) whenever the sibling
monorepos' relevant packages change, and a larger git history from committed tarballs — accepted as
a one-line migration to ordinary npm ranges once publishing unblocks (no code changes needed, only
`pnpm-workspace.yaml`'s `overrides` and each consumer's declared range).

## Addendum (2026-11-02): `@gltfi/runtime` now comes from npm

`@gltfi/runtime@0.1.0` is published to npm (a self-contained, zero-dependency ES2020 bundle of the
reference interpreter). It is no longer vendored: `packages/play` and the root workspace declare
`"@gltfi/runtime": "^0.1.0"`, `vendor/gltfi-runtime-0.0.1.tgz` and its `GLTFI_PACKAGES` entry in
`scripts/refresh-vendor.mjs` are removed, and `pnpm-workspace.yaml` carries a `"^0.1.0"` range
override (not a tarball) so the vendored `@gltfi/three-adapter` and `@gltfi/parse-ts`, which still
declare the exact `0.0.1`, resolve to the registry release as well. All other packages named in
this ADR (including `@gltfi/runtime-lib`, also on npm) stay vendored; the Decision above is
otherwise unchanged.

2026-11-03: `@gltfi/runtime` bumped to `^0.1.1` (range override and `minimumReleaseAgeExclude` now `@gltfi/runtime@0.1.1`); the vendored `@gltfi/*` tarballs were re-packed from the monorepo at gltf-interactivity 0.3.0 (3b5c146). `@gltfi/runtime-lib@0.1.1` is on npm too but stays vendored so it remains byte-matched to the vendored `emit-ts` output.
