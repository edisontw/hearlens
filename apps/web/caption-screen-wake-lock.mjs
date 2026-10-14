/**
 * Optional foreground-only Screen Wake Lock for active caption sessions.
 *
 * A wake-lock failure NEVER blocks captions. The generation check prevents an
 * asynchronous request from keeping the screen awake after Stop/pagehide.
 * Never reacquire automatically after a hidden page or a system release.
 * This controls the screen only, not audio output or physical hearing safety.
 */
export function createCaptionScreenWakeLock({
  requestWakeLock = null,
  onState = () => {},
} = {}) {
  let generation = 0;
  let wanted = false;
  let sentinel = null;
  let state = "idle";

  function setState(next) {
    state = next;
    onState(next);
  }

  async function releaseCandidate(candidate) {
    try {
      await candidate?.release?.();
    } catch {
      // Browser can revoke a sentinel before release resolves.
    }
  }

  async function start() {
    if (wanted) return state;
    wanted = true;
    const token = ++generation;

    if (typeof requestWakeLock !== "function") {
      setState("unsupported");
      return state;
    }

    setState("requesting");
    try {
      // Invoke immediately; don't defer a potential user-activation API.
      const candidate = await requestWakeLock("screen");
      if (!candidate || typeof candidate.release !== "function") {
        throw new TypeError("Missing WakeLockSentinel");
      }

      if (!wanted || token !== generation) {
        await releaseCandidate(candidate);
        return "cancelled";
      }

      sentinel = candidate;
      candidate.addEventListener?.("release", () => {
        if (sentinel !== candidate || token !== generation || !wanted) return;
        sentinel = null;
        setState("released");
      }, { once: true });
      setState("held");
      return state;
    } catch {
      if (wanted && token === generation) setState("unavailable");
      return "unavailable";
    }
  }

  function stop() {
    wanted = false;
    generation += 1;
    const previous = sentinel;
    sentinel = null;
    setState("idle");
    if (previous) void releaseCandidate(previous);
  }

  return { start, stop, getState: () => state };
}
