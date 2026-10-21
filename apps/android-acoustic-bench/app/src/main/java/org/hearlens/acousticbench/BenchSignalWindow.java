package org.hearlens.acousticbench;

import java.util.Locale;

/** Constant-memory sample-clock statistics; never stores PCM or infers acoustic output. */
public final class BenchSignalWindow {
    public static final int WINDOW_FRAMES = 4_800; // 100 ms at 48 kHz
    private long frames, zeros, zeroRun, longestZeroRun, completeWindows;
    private long strongestStartFrame = -1;
    private int windowFrames;
    private double windowSquare, strongestSquareMean;

    public void add(int sample) {
        frames++;
        if (sample == 0) {
            zeros++;
            longestZeroRun = Math.max(longestZeroRun, ++zeroRun);
        } else zeroRun = 0;
        windowSquare += (double)sample * sample;
        if (++windowFrames == WINDOW_FRAMES) {
            double mean = windowSquare / WINDOW_FRAMES;
            if (mean > strongestSquareMean) {
                strongestSquareMean = mean;
                strongestStartFrame = frames - WINDOW_FRAMES;
            }
            completeWindows++;
            windowSquare = 0;
            windowFrames = 0;
        }
    }

    static double rmsDbfs(double squareMean) {
        return squareMean <= 0 ? Double.NEGATIVE_INFINITY
            : 10 * Math.log10(squareMean / (32768.0 * 32768.0));
    }

    public double strongestCompleteRmsDbfs() { return rmsDbfs(strongestSquareMean); }
    public long strongestStartFrame() { return strongestStartFrame; }
    public long longestZeroRunFrames() { return longestZeroRun; }
    public long zeroFrames() { return zeros; }
    public long completeWindows() { return completeWindows; }
    public int tailFrames() { return windowFrames; }

    public String metrics() {
        return String.format(Locale.US,
            "source_window_ms=100 source_complete_windows=%d source_strongest_window_rms_dbfs=%.1f"
            + " source_strongest_window_start_frame=%d source_tail_frames=%d source_tail_rms_dbfs=%.1f source_zero_pct=%.3f"
            + " source_longest_zero_run_frames=%d source_longest_zero_run_ms=%.3f"
            + " source_window_scope=digital_samples_not_snr_or_mic_fault",
            completeWindows, strongestCompleteRmsDbfs(), strongestStartFrame, windowFrames,
            rmsDbfs(windowFrames == 0 ? 0 : windowSquare / windowFrames),
            frames == 0 ? 0 : 100.0 * zeros / frames,
            longestZeroRun, longestZeroRun / 48.0);
    }
}
