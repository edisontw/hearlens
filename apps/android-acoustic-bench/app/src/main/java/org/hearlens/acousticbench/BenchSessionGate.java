package org.hearlens.acousticbench;

/**
 * Pure state machine used by the separate off-ear bench. It provides a
 * fail-stop software response, not physical phone-speaker isolation.
 */
public final class BenchSessionGate {
    public enum State { IDLE, SILENT_ROUTE_CHECK, RUNNING, STOPPED }
    public static final int SESSION_MS = 40_000;
    private State state = State.IDLE;
    private int endpointId = -1;
    private long deadlineMs = -1;
    private String reason = "idle";

    public synchronized boolean begin(int btDeviceId, long nowMs, boolean offEarConfirmed) {
        if (state != State.IDLE || !offEarConfirmed || btDeviceId < 0 || nowMs < 0)
            return stop("start_not_authorized");
        endpointId = btDeviceId;
        deadlineMs = nowMs + SESSION_MS;
        state = State.SILENT_ROUTE_CHECK;
        reason = "silent_route_check";
        return true;
    }
    public synchronized boolean check(int actualDeviceId, boolean isA2dp,
                                      boolean builtInMic, boolean focusOk, long nowMs) {
        if (state != State.SILENT_ROUTE_CHECK && state != State.RUNNING) return false;
        if (nowMs < 0 || nowMs >= deadlineMs) return stop("timeout");
        if (!isA2dp || actualDeviceId != endpointId) return stop("lost_a2dp_route");
        if (!builtInMic) return stop("lost_builtin_mic");
        if (!focusOk) return stop("audio_focus_lost");
        state = State.RUNNING;
        reason = "off_ear_only_active";
        return true;
    }
    /** D6 bypasses microphone entirely; require only actual A2DP and audio focus. */
    public synchronized boolean checkOutputOnly(int actualDeviceId, boolean isA2dp,
                                                boolean focusOk, long nowMs) {
        if (state != State.SILENT_ROUTE_CHECK && state != State.RUNNING) return false;
        if (nowMs < 0 || nowMs >= deadlineMs) return stop("timeout");
        if (!isA2dp || actualDeviceId != endpointId) return stop("lost_a2dp_route");
        if (!focusOk) return stop("audio_focus_lost");
        state = State.RUNNING;
        reason = "off_ear_only_active";
        return true;
    }
    public synchronized boolean tick(long nowMs) {
        if (state != State.RUNNING) return false;
        if (nowMs < 0 || nowMs >= deadlineMs) return stop("timeout");
        return true;
    }
    public synchronized boolean stop(String why) {
        if (state != State.STOPPED) {
            state = State.STOPPED;
            reason = why == null ? "stop_unknown" : why;
        }
        return false;
    }
    public synchronized State state() { return state; }
    public synchronized String reason() { return reason; }
    public synchronized int endpointId() { return endpointId; }
}
