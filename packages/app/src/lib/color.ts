// `<input type="color">` works in hex (`#rrggbb`, 0-255 per channel, no
// alpha); glTF's `baseColorFactor` is `[r, g, b, a]` linear-ish floats in
// [0, 1] (specs/ux-inspector.md UX-405's base-color picker). These two pure
// helpers are the only place that conversion happens.
export function hexToRgb01(hex: string): [number, number, number] {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const clean = match ? match[1] : "ffffff";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

export function rgb01ToHex([r, g, b]: readonly [number, number, number] | number[]): string {
  const toByte = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}
