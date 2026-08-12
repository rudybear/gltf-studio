import { describe, expect, it } from "vitest";
import { canonicalSpliceRoot } from "./splice-root.js";

/**
 * @spec DOC-022
 * @spec DOC-038
 */
describe("canonicalSpliceRoot", () => {
  it("truncates a node property patch to its node root (plan's own example)", () => {
    expect(canonicalSpliceRoot("/nodes/3/translation/0")).toBe("/nodes/3");
  });

  it("truncates an interactivity graph patch to its graph root (plan's own example)", () => {
    expect(canonicalSpliceRoot("/extensions/KHR_interactivity/graphs/2/nodes/5/values/a")).toBe(
      "/extensions/KHR_interactivity/graphs/2"
    );
  });

  it("truncates a KHR_audio_graph patch to its graph root (DOC-057, rule 1b — same rationale as KHR_interactivity)", () => {
    expect(canonicalSpliceRoot("/extensions/KHR_audio_graph/graphs/0/nodes/1/params/gain")).toBe(
      "/extensions/KHR_audio_graph/graphs/0"
    );
  });

  it("truncates a KHR_audio_emitter patch to the whole extension object (plan's own example)", () => {
    expect(canonicalSpliceRoot("/extensions/KHR_audio_emitter/emitters/0/gain")).toBe("/extensions/KHR_audio_emitter");
  });

  it("truncates every other top-level array root to its element (DOC-038 rule 3)", () => {
    expect(canonicalSpliceRoot("/materials/1/pbrMetallicRoughness/baseColorFactor/0")).toBe("/materials/1");
    expect(canonicalSpliceRoot("/meshes/0/primitives/0/material")).toBe("/meshes/0");
    expect(canonicalSpliceRoot("/scenes/0/nodes/0")).toBe("/scenes/0");
    expect(canonicalSpliceRoot("/animations/2/samplers/0")).toBe("/animations/2");
  });

  it("truncates any unlisted extension to the extension object as a whole (DOC-038 rule 2)", () => {
    expect(canonicalSpliceRoot("/extensions/KHR_lights_punctual/lights/0/intensity")).toBe(
      "/extensions/KHR_lights_punctual"
    );
  });

  it("falls back to the top-level key for scalar/registry roots (DOC-038 rule 4)", () => {
    expect(canonicalSpliceRoot("/scene")).toBe("/scene");
    expect(canonicalSpliceRoot("/asset/version")).toBe("/asset");
    expect(canonicalSpliceRoot("/extensionsUsed/0")).toBe("/extensionsUsed");
    expect(canonicalSpliceRoot("/extras/someCustomField")).toBe("/extras");
  });

  it("a graph canvas node's extras.gltfi.{x,y} (DOC-027) truncates to the owning graph root, same as any other graph-node field", () => {
    expect(canonicalSpliceRoot("/extensions/KHR_interactivity/graphs/0/nodes/4/extras/gltfi/x")).toBe(
      "/extensions/KHR_interactivity/graphs/0"
    );
  });

  it("is total: an empty pointer (root) truncates to the root", () => {
    expect(canonicalSpliceRoot("")).toBe("/");
  });
});
