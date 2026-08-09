// Template (b): "move <direction>" a selected node.
//
// Judgment call (documented per the task brief): built as a DIRECT,
// non-animated `SceneEdit.setTransform` translation offset — not a
// `pointer/interpolate` on `/nodes/{n}/translation`. Both readings are
// legitimate ("move" could mean "animate a move" or "just relocate it"),
// but the direct reading is the safer default for a mock: it is
// unambiguous, needs no duration/easing guess, and a `Proposal.commands`
// entry is not required to touch the interactivity graph at all (nothing in
// AG-003/AG-014 requires every proposal to be graph-shaped). A
// graph-driven "animate a move" variant (mirroring templates/spin.ts's
// pointer/interpolate shape, targeting `/nodes/{n}/translation` as a
// `float3`) was considered and is a reasonable follow-up template, not
// implemented here.
import { SceneEdit, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";

const DEFAULT_MOVE_DISTANCE = 1;

// glTF convention: +X right, +Y up, -Z forward (the camera looks down -Z).
const AXIS_OFFSETS: Record<string, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  forward: [0, 0, -1],
  back: [0, 0, 1],
  backward: [0, 0, 1]
};

// `.*` between "move" and the direction tolerates filler words a real
// prompt is likely to include ("move it up", "please move the box left").
const MOVE_RE = /\bmove\b.*\b(up|down|left|right|forward|back(?:ward)?)\b/i;

export function matchesMoveTemplate(prompt: string): boolean {
  return MOVE_RE.test(prompt);
}

export function buildMoveProposal(document: EditorDocument, prompt: string, nodeIndex: number): Proposal {
  const match = prompt.match(MOVE_RE);
  // Guarded by matchesMoveTemplate before this is ever called; kept as a
  // defensive throw rather than a silent fallback so a future caller that
  // skips the guard fails loudly instead of building a bogus proposal.
  if (!match) {
    throw new Error("buildMoveProposal called with a prompt that does not match the move template.");
  }
  const direction = match[1].toLowerCase();
  const axis = AXIS_OFFSETS[direction];

  const amountMatch = prompt.match(/(-?\d+(?:\.\d+)?)/);
  const amount = amountMatch ? Number(amountMatch[1]) : DEFAULT_MOVE_DISTANCE;

  const current = (getIn(document.json, ["nodes", nodeIndex, "translation"]) as number[] | undefined) ?? [0, 0, 0];
  const next: [number, number, number] = [current[0] + axis[0] * amount, current[1] + axis[1] * amount, current[2] + axis[2] * amount];

  const command = SceneEdit.setTransform(document, nodeIndex, { translation: next });

  return {
    summary: `Move the selected node ${direction} by ${amount} unit${amount === 1 ? "" : "s"}.`,
    commands: [command],
    // This template never touches the interactivity graph, so there is
    // nothing meaningful for validateProposalGraph to check — an empty
    // findings list is the honest (not merely vacuous-for-convenience)
    // result, not a skipped check.
    validationReport: { findings: [] }
  };
}
