// Small shared byte-buffer helpers. Split out because both
// indexeddb-storage.ts and filesystem-storage.ts need to hand a `Uint8Array`
// view to APIs (structured clone, `Blob`) that want a plain, exactly-sized
// `ArrayBuffer` — a view's own `.buffer` may be a larger, shared backing
// buffer (e.g. a subarray), so this always copies the exact `[byteOffset,
// byteOffset + byteLength)` range rather than assuming `.buffer` already
// matches.
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}
