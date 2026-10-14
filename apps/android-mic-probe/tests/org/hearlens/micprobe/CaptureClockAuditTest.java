package org.hearlens.micprobe;

/**
 * Hermetic JVM tests for SW4 Input Clock Audit; run with javac/java.
 */
public final class CaptureClockAuditTest {
    private static void require(boolean ok, String reason) {
        if (!ok) throw new AssertionError(reason);
    }
    private static void close(double value, double expected, double tolerance, String reason) {
        require(Math.abs(value - expected) <= tolerance,
            reason + " observed=" + value + " expected=" + expected);
    }
    private static void check(CaptureClockAudit.Snapshot sample,
                              CaptureClockAudit.State state, String msg) {
        require(sample.state == state, msg + " returned " + sample.state);
        require(sample.toLog().contains("bt_output_latency=UNMEASURED"),
            "must not imply Bluetooth acoustic latency");
        require(sample.toLog().contains("acoustic_mpo=UNMEASURED"),
            "must not imply calibrated acoustic gain or MPO");
        require(sample.toLog().contains("acoustic_input_latency=UNMEASURED"),
            "timestamp age is NOT mic-to-ear delay");
    }

    public static void main(String[] args) {
        CaptureClockAudit audit = new CaptureClockAudit();
        // Timestamp observations on the same monotonic clock; frame progression
        // of 48,000 represents one second at 48 kHz.
        check(audit.observe(true, 1_000, 1_000_000_000L, 1_025_000_000L, 48_000),
              CaptureClockAudit.State.FIRST_SAMPLE, "first");
        CaptureClockAudit.Snapshot stable = audit.observe(
            true, 49_000, 2_000_000_000L, 2_028_000_000L, 48_000);
        check(stable, CaptureClockAudit.State.STABLE, "stable input sample clock");
        close(stable.timestampAgeMs, 28, 1e-9, "timestamp age");
        close(stable.frameClockDeltaMs, 0, 1e-9, "clock skew");
        require(stable.toLog().contains("timestampAgeMs=28.000"), "explicit units");
        // 1% clock inconsistency means 10ms per one-second observation:
        // report it rather than pretending this is acoustic delay.
        CaptureClockAudit.Snapshot skew = audit.observe(
            true, 97_000, 3_010_000_000L, 3_035_000_000L, 48_000);
        check(skew, CaptureClockAudit.State.STABLE, "small metadata clock difference");
        close(skew.frameClockDeltaMs, -10, 1e-9, "signed drift");
        check(audit.observe(true, 145_000, 4_500_000_000L, 4_530_000_000L, 48_000),
              CaptureClockAudit.State.DISCONTINUITY, "large inconsistent frame clock");
        check(audit.observe(true, 145_000, 4_500_000_000L, 4_550_000_000L, 48_000),
              CaptureClockAudit.State.DISCONTINUITY, "repeated timestamp");
        check(audit.observe(true, 149_000, 4_600_000_000L, 4_610_000_000L, 48_000),
              CaptureClockAudit.State.STABLE, "baseline resumes");
        check(audit.observe(false, 0, 0, 5_000_000_000L, 48_000),
              CaptureClockAudit.State.UNAVAILABLE, "no Android timestamp");
        check(audit.observe(true, 2_000, 5_000_000_000L, 5_030_000_000L, 48_000),
              CaptureClockAudit.State.FIRST_SAMPLE, "unavailable resets baseline");
        audit.reset();
        check(audit.observe(true, 3_000, 5_500_000_000L, 5_550_000_000L, 48_000),
              CaptureClockAudit.State.FIRST_SAMPLE, "new capture resets baseline");
        check(audit.observe(true, 2_900, 6_000_000_000L, 6_025_000_000L, 48_000),
              CaptureClockAudit.State.DISCONTINUITY, "regressing frames");
        check(audit.observe(true, 26_900, 6_500_000_000L, 6_525_000_000L, 48_000),
              CaptureClockAudit.State.STABLE, "new monotonic pair after reset");
        check(audit.observe(true, 50_900, 7_000_000_000L, 7_025_000_000L, 16_000),
              CaptureClockAudit.State.DISCONTINUITY, "changed sample-rate reference");
        check(audit.observe(true, -1, 7_500_000_000L, 7_550_000_000L, 48_000),
              CaptureClockAudit.State.INVALID, "negative frame");
        check(audit.observe(true, 500, 0L, 8_000_000_000L, 48_000),
              CaptureClockAudit.State.INVALID, "unknown nanos");
        check(audit.observe(true, 500, 8_100_000_000L, 8_000_000_000L, 48_000),
              CaptureClockAudit.State.INVALID, "future timestamp");
        check(audit.observe(true, 500, 1_000_000_000L, 8_000_000_000L, 48_000),
              CaptureClockAudit.State.STALE, "old timestamp");
        check(audit.observe(true, 500, 8_050_000_000L, 8_000_000_000L, 48_000),
              CaptureClockAudit.State.FIRST_SAMPLE, "50ms tolerated timestamp tolerance");
        check(audit.observe(true, 500, 8_100_000_000L, 8_100_000_000L, 0),
              CaptureClockAudit.State.INVALID, "impossible sample rate");
        System.out.println("SW4 INPUT_CLOCK_AUDIT PASS: no audio, no speaker, no BT delay claim");
    }
}
