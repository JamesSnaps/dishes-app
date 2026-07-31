// Timer chime for cooking mode.
//
// Safari (especially iOS) only allows audio that originates from a user gesture.
// We create/resume the AudioContext when a timer is started (a tap), which
// unlocks it for the chime that plays later when the timer finishes.

let audioCtx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

export function playChime() {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.05;
  const notes = [880, 1174.66, 1567.98]; // A5 → D6 → G6, rising
  for (let pass = 0; pass < 2; pass++) {
    notes.forEach((freq, i) => {
      const t = start + pass * 0.75 + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }
}
