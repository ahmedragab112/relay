let context: AudioContext | undefined;

// A soft two-note chime so a finished turn is noticeable without leaving the app.
export function playChime(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + 0.02;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
    master.connect(context.destination);
    for (const [frequency, delay] of [[987.77, 0], [1318.51, 0.13]] as const) {
      const tone = context.createOscillator();
      const gain = context.createGain();
      const at = start + delay;
      tone.type = 'sine';
      tone.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      tone.connect(gain).connect(master);
      tone.start(at);
      tone.stop(at + 0.45);
    }
    window.setTimeout(() => master.disconnect(), 900);
  } catch {
    // Audio is a courtesy; a missing output device must not break the turn.
  }
}
