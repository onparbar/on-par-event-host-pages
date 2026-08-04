export type SoundAlertState = "off" | "enabling" | "on" | "error";

export const AUDIO_ALERT_ERROR =
  "This browser could not enable alert sounds. Select Retry sound alerts to try again.";

export function soundAlertButtonLabel(state: SoundAlertState) {
  switch (state) {
    case "enabling":
      return "Enabling sound alerts…";
    case "on":
      return "Sound alerts on";
    case "error":
      return "Retry sound alerts";
    case "off":
      return "Enable sound alerts";
  }
}

export async function ensureAudioContextRunning(
  context: Pick<AudioContext, "resume" | "state">,
) {
  if (context.state !== "running") {
    await context.resume();
  }
  if (context.state !== "running") {
    throw new Error("Audio context did not enter the running state.");
  }
}

export async function playAlertTone(context: AudioContext) {
  await ensureAudioContextRunning(context);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(740, now);
  oscillator.frequency.setValueAtTime(980, now + 0.22);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.setValueAtTime(0.18, now + 0.38);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.55);
}
