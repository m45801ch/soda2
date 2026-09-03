export function indicatorClass(aiOptimizeRecording, cloudAsrActive, commandMode) {
  if (aiOptimizeRecording) return "pill-ai";
  if (commandMode) return "pill-command";
  if (cloudAsrActive) return "pill-cloud";
  return "pill-recording";
}

export function truncateLiveText(text, maxChars = 20) {
  const s = typeof text === "string" ? text : "";
  if (s.length <= maxChars) return s;
  return "…" + s.slice(-(maxChars - 1));
}
