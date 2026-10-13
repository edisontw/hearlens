// Pure foreground-session gate. This concerns caption microphone capture only.
// It is not an output-route or physical hearing safety gate.
export class CaptionSessionInterrupted extends Error {
  constructor() {
    super("Caption session interrupted before startup completed.");
    this.name = "CaptionSessionInterrupted";
  }
}

export function assertCaptionSessionCurrent(expected, current, hidden) {
  if (!Number.isInteger(expected) || expected <= 0 ||
      expected !== current || hidden === true) {
    throw new CaptionSessionInterrupted();
  }
}

export function shouldInterruptForPageEvent(eventType, visibilityState) {
  return eventType === "pagehide" ||
    (eventType === "visibilitychange" && visibilityState === "hidden");
}
