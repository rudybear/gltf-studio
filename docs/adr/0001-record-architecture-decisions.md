# 1. Record architecture decisions

Status: active

## Context

The program plan (`gltf-studio` — see the plan document that seeded this repo) commits to a
"living project state" development model: requirements, UX, and architecture are all expected to
change, and the discipline is that they change *in the repo*, in the same PR as the code that
depends on them, rather than drifting away from a one-time planning document.

## Decision

We record architecturally significant decisions as numbered ADRs in `docs/adr/`, one file per
decision, using a lightweight status + supersede-chain convention:

- Each ADR file is named `NNNN-title-with-dashes.md`, numbered sequentially, never renumbered or
  deleted once merged.
- Each ADR states a `Status` at the top: `active`, or `superseded by ADR-NNNN` once a later
  decision replaces it.
- A superseding ADR must say `Supersedes ADR-NNNN` in its own header and explain what changed and
  why. The old ADR is edited only to flip its status line — its original Context/Decision text is
  left intact as a historical record.
- Specs (`/specs/*.md`) that depend on an architectural decision link the ADR by number in prose,
  so "why is this requirement shaped this way" is always one click from "what changed it."

## Consequences

"Why" never goes stale: instead of a decision's rationale living only in a chat log or a plan
document that stops being updated, it's a versioned file the repo's own history explains. Reversing
a decision is itself a normal PR (new ADR + status-line edit on the old one), not a special
out-of-band process.
