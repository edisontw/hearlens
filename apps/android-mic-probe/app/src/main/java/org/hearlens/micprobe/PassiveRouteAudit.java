package org.hearlens.micprobe;

import java.util.Arrays;
import java.util.Objects;

/**
 * Passive prediction audit only. No playback handle, audio buffer, route request,
 * audio-focus request, or authorization capability exists in this class.
 * A MONITORING state DOES NOT mean that hearing output is safe.
 */
public final class PassiveRouteAudit {
    public enum State { IDLE, MONITORING, FAULTED, COMPLETE }

    public static final class Endpoint {
        public final String kind;
        public final int id;

        public Endpoint(String kind, int id) {
            this.kind = Objects.requireNonNull(kind);
            this.id = id;
        }

        @Override public boolean equals(Object other) {
            if (!(other instanceof Endpoint)) return false;
            Endpoint endpoint = (Endpoint) other;
            return id == endpoint.id && kind.equals(endpoint.kind);
        }

        @Override public int hashCode() { return Objects.hash(kind, id); }

        @Override public String toString() { return kind + "#" + id; }
    }

    private State state = State.IDLE;
    private Endpoint target;
    private long lastSequence = -1;
    private int samples;
    private String detail = "never_started";

    public State state() { return state; }
    public int samples() { return samples; }
    public String detail() { return detail; }
    public Endpoint target() { return target; }

    // A predicted Bluetooth route never grants permission to play sound.
    public boolean outputAuthorized() { return false; }

    public void resetByUser() {
        state = State.IDLE;
        target = null;
        lastSequence = -1;
        samples = 0;
        detail = "explicit_user_reset";
    }

    public void begin(long sequence, Endpoint[] media, Endpoint[] accessibility, boolean normalMode) {
        if (state != State.IDLE) {
            fault("manual_reset_required");
            return;
        }
        Endpoint selected = validate(media, accessibility, normalMode);
        if (selected == null || sequence < 0) {
            fault("start_prediction_missing_ambiguous_or_not_bluetooth");
            return;
        }
        target = selected;
        lastSequence = sequence;
        samples = 1;
        state = State.MONITORING;
        detail = "predictive_route_only";
    }

    public void observe(long sequence, Endpoint[] media, Endpoint[] accessibility, boolean normalMode) {
        if (state != State.MONITORING) return;
        if (sequence <= lastSequence) {
            fault("stale_or_repeated_observation");
            return;
        }
        lastSequence = sequence;
        Endpoint selected = validate(media, accessibility, normalMode);
        if (selected == null || !selected.equals(target)) {
            fault("anticipated_route_changed_or_unavailable");
            return;
        }
        samples++;
    }

    public void interrupt(String reason) {
        if (state == State.MONITORING) fault("interrupt_" + reason);
    }

    public void finish() {
        if (state == State.MONITORING) {
            state = State.COMPLETE;
            detail = "observation_window_complete_NOT_physical_route_verification";
        }
    }

    private void fault(String reason) {
        state = State.FAULTED;
        target = null;
        detail = reason;
    }

    private static Endpoint validate(Endpoint[] media, Endpoint[] accessibility, boolean normalMode) {
        if (!normalMode || media == null || accessibility == null ||
            media.length != 1 || accessibility.length != 1) return null;
        Endpoint candidate = media[0];
        if (candidate == null || !candidate.equals(accessibility[0]) || candidate.id < 0) return null;
        if (!Arrays.asList("BLUETOOTH_A2DP", "BLE_HEADSET").contains(candidate.kind)) return null;
        return candidate;
    }
}
