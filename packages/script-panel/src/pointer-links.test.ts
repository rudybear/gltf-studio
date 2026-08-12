import { describe, expect, it } from "vitest";
import { findPointerPathLinks } from "./pointer-links.js";

describe("findPointerPathLinks (specs/ux-usage-mapping.md UX-1119)", () => {
  it("finds a /nodes/{N} pointer path literal, offset/length pointing at the text WITHOUT quotes", () => {
    const code = 'function onSelect() {\n  rt.ptrSet("/nodes/3/translation", [1, 2, 3]);\n}\n';
    const [match] = findPointerPathLinks(code);
    expect(match).toBeDefined();
    expect(match!.pointerPath).toBe("/nodes/3/translation");
    expect(code.slice(match!.offset, match!.offset + match!.length)).toBe("/nodes/3/translation");
    // Not including the surrounding quotes.
    expect(code[match!.offset - 1]).toBe('"');
    expect(code[match!.offset + match!.length]).toBe('"');
  });

  it("finds every family @gltf-studio/usage-index resolves: /materials, /meshes, /animations, and KHR_audio_emitter emitters/sources", () => {
    const code = [
      'rt.ptrSet("/materials/2/pbrMetallicRoughness/baseColorFactor", c);',
      'rt.ptrGet("/meshes/1/weights/0");',
      'rt.ptrSet("/extensions/KHR_audio_emitter/sources/0/playing", true);',
      'rt.ptrSet("/extensions/KHR_audio_emitter/emitters/0/gain", 0.5);'
    ].join("\n");
    const matches = findPointerPathLinks(code);
    expect(matches.map((m) => m.pointerPath)).toEqual([
      "/materials/2/pbrMetallicRoughness/baseColorFactor",
      "/meshes/1/weights/0",
      "/extensions/KHR_audio_emitter/sources/0/playing",
      "/extensions/KHR_audio_emitter/emitters/0/gain"
    ]);
  });

  it("finds multiple occurrences across the whole document, in source order", () => {
    const code = 'rt.ptrSet("/nodes/0/scale", a);\nrt.ptrSet("/nodes/1/scale", b);\n';
    const matches = findPointerPathLinks(code);
    expect(matches.map((m) => m.pointerPath)).toEqual(["/nodes/0/scale", "/nodes/1/scale"]);
  });

  it("does not match an unrelated quoted string that isn't a pointer path", () => {
    const code = 'rt.emit("some-custom-event", {});\nconst label = "not/a/pointer";\n';
    expect(findPointerPathLinks(code)).toEqual([]);
  });

  it("returns an empty array for code with no pointer-path literals at all", () => {
    expect(findPointerPathLinks("function onStart() {}\n")).toEqual([]);
  });
});
