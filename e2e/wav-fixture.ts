// Shared by e2e/global-setup.ts and e2e/inspector-fixture.ts: a short, real,
// audible 16-bit PCM mono WAV — a sine "beep" — generated in-process (never
// a binary asset committed to the repo, per this program's "no corpus
// copying" rule) for KHR_audio_emitter `audio[]` entries (M7).
export function sineBeepWavBytes(options: { sampleRate?: number; durationSeconds?: number; frequencyHz?: number } = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 22050;
  const durationSeconds = options.durationSeconds ?? 0.3;
  const frequencyHz = options.frequencyHz ?? 440;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < sampleCount; i += 1) {
    // A short fade-out avoids a click at the buffer's end (loop=false, so
    // this only ever plays once per audition/trigger).
    const fade = 1 - i / sampleCount;
    const sample = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * 0.5 * fade;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Uint8Array(buffer);
}
