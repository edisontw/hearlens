package org.hearlens.micprobe;

import java.util.Locale;

/**
 * SW4: timing observation for INPUT-ONLY AudioRecord metadata.
 *
 * All timestamps must use the SAME MONOTONIC clock. A timestamp age or
 * sample-clock skew is NOT mic acoustic capture latency, and says NOTHING
 * about actual Bluetooth headset output, codec or speaker fallback.
 *
 * No Android APIs, PCM samples, audio sinks, network or device permissions.
 * This small pure-Java reducer is executable with javac/java in CI.
 */
public final class CaptureClockAudit {
    public enum State {
        UNAVAILABLE, FIRST_SAMPLE, STABLE, STALE, INVALID, DISCONTINUITY
    }

    public static final class Snapshot {
        public final State state;
        public final String detail;
        public final long framePosition;
        public final double timestampAgeMs;
        public final double frameClockDeltaMs;

        private Snapshot(State state, String detail, long framePosition,
                         double timestampAgeMs, double frameClockDeltaMs) {
            this.state = state;
            this.detail = detail;
            this.framePosition = framePosition;
            this.timestampAgeMs = timestampAgeMs;
            this.frameClockDeltaMs = frameClockDeltaMs;
        }

        public String toLog() {
            return String.format(Locale.US,
                "input_clock state=%s detail=%s timestampAgeMs=%.3f"
                + " frameClockDeltaMs=%.3f frame=%d"
                + " acoustic_input_latency=UNMEASURED bt_output_latency=UNMEASURED"
                + " acoustic_mpo=UNMEASURED",
                state, detail, timestampAgeMs, frameClockDeltaMs, framePosition);
        }
    }

    // Permissive observations, NOT pass thresholds or safety limits.
    private static final long MAX_TIMESTAMP_AGE_NS = 5_000_000_000L;
    private static final long FUTURE_TOLERANCE_NS = 50_000_000L;
    private static final double LARGE_CLOCK_DIVERGENCE_MS = 200.0;

    private long previousFrames = -1;
    private long previousTimestampNanos = -1;
    private int previousSampleRate = -1;

    public void reset() {
        previousFrames = -1;
        previousTimestampNanos = -1;
        previousSampleRate = -1;
    }

    public Snapshot observe(boolean timestampAvailable, long framePosition,
                            long timestampNanos, long observedNanos, int sampleRate) {
        if (!timestampAvailable) {
            reset();
            return snapshot(State.UNAVAILABLE, "android_timestamp_not_provided",
                -1, Double.NaN, Double.NaN);
        }
        // Reject nonpositive timestamps, invalid frame/rate and clocks far
        // in the future. Report stale instead of silently accepting it.
        if (framePosition < 0 || timestampNanos <= 0 || observedNanos <= 0 ||
            sampleRate < 8000 || sampleRate > 192000 ||
            timestampNanos > observedNanos + FUTURE_TOLERANCE_NS) {
            reset();
            return snapshot(State.INVALID, "invalid_or_future_monotonic_timestamp",
                framePosition, Double.NaN, Double.NaN);
        }
        double ageMs = (observedNanos - timestampNanos) / 1_000_000.0;
        if (observedNanos - timestampNanos > MAX_TIMESTAMP_AGE_NS) {
            reset();
            return snapshot(State.STALE, "old_timestamp_not_capture_latency",
                framePosition, ageMs, Double.NaN);
        }
        if (previousFrames < 0) {
            remember(framePosition, timestampNanos, sampleRate);
            return snapshot(State.FIRST_SAMPLE, "baseline_only", framePosition, ageMs, Double.NaN);
        }

        final long deltaFrames = framePosition - previousFrames;
        final long deltaNanos = timestampNanos - previousTimestampNanos;
        if (sampleRate != previousSampleRate || deltaFrames <= 0 || deltaNanos <= 0) {
            // A jump or duplicate invalidates comparison, but this metadata
            // observation never controls or authorizes audio output.
            remember(framePosition, timestampNanos, sampleRate);
            return snapshot(State.DISCONTINUITY, "sample_clock_not_monotonic",
                framePosition, ageMs, Double.NaN);
        }
        final double frameDurationMs = 1000.0 * deltaFrames / sampleRate;
        final double elapsedClockMs = deltaNanos / 1_000_000.0;
        final double skewMs = frameDurationMs - elapsedClockMs;
        remember(framePosition, timestampNanos, sampleRate);
        if (Math.abs(skewMs) > LARGE_CLOCK_DIVERGENCE_MS) {
            return snapshot(State.DISCONTINUITY, "frame_time_divergence",
                framePosition, ageMs, skewMs);
        }
        return snapshot(State.STABLE, "monotonic_timestamp_pair_not_latency",
            framePosition, ageMs, skewMs);
    }

    private void remember(long frames, long nanos, int rate) {
        previousFrames = frames;
        previousTimestampNanos = nanos;
        previousSampleRate = rate;
    }

    private static Snapshot snapshot(State state, String detail, long frames,
                                     double ageMs, double skewMs) {
        return new Snapshot(state, detail, frames, ageMs, skewMs);
    }
}
