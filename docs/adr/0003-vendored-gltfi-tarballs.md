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
