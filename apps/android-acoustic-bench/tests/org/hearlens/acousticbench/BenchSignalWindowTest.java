package org.hearlens.acousticbench;

public final class BenchSignalWindowTest {
    private static void check(boolean ok, String why) {
        if (!ok) throw new AssertionError(why);
    }
    public static void main(String[] args) {
        BenchSignalWindow w = new BenchSignalWindow();
        check(w.strongestCompleteRmsDbfs() == Double.NEGATIVE_INFINITY, "empty is not signal");
        // 900 ms silence + one 100 ms test signal: whole-record RMS is 10 dB lower.
        for (int i=0; i<43_200; i++) w.add(0);
        for (int i=0; i<4_800; i++) w.add(3277);
        check(Math.abs(w.strongestCompleteRmsDbfs() + 20) < 0.01,
            "short signal survives long silence in window metric");
        check(w.strongestStartFrame()==43_200, "strongest burst locatable on sample clock");
        check(w.completeWindows()==10 && w.zeroFrames()==43_200, "sample accounting");
        check(w.longestZeroRunFrames()==43_200, "zero run crosses window boundaries");
        for (int i=0; i<100; i++) w.add(16384);
        check(w.tailFrames()==100 && w.completeWindows()==10, "partial tail kept separate");
        check(Math.abs(w.strongestCompleteRmsDbfs()+20)<0.01, "tail does not bias complete windows");
        check(w.metrics().contains("source_tail_rms_dbfs=-6.0"), "short final burst not lost");
        BenchSignalWindow silence = new BenchSignalWindow();
        for (int i=0; i<9_600; i++) silence.add(0);
        check(silence.metrics().contains("source_zero_pct=100.000"), "silence exact zeros");
        BenchSignalWindow negative = new BenchSignalWindow();
        for (int i=0; i<4_800; i++) negative.add(Short.MIN_VALUE);
        check(negative.strongestCompleteRmsDbfs()==0, "negative full scale does not overflow");
        check(negative.zeroFrames()==0, "nonzero constant is not declared silent");
        System.out.println("M04-D6.2 sample-window diagnostics: PASS");
    }
}
