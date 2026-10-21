package org.hearlens.acousticbench;

import java.util.Locale;

/**
 * D5 off-ear measurement profiles and pre-OS PCM accounting.
 * Pure JVM code; no device volume, ear SPL, or hardware speaker guarantees.
 */
public final class BenchOutputProfile {
    public enum Level {
        L0_BASELINE("L0 基準", 8, 384, 0.15f),
        L1_MEASURE("L1 測量", 16, 768, 0.25f),
        L2_MEASURE("L2 測量", 24, 1536, 0.35f);

        public final String label;
        public final int gain;
        public final int cap;
        public final float trackVolume;

        Level(String label, int gain, int cap, float trackVolume) {
            this.label = label;
            this.gain = gain;
            this.cap = cap;
            this.trackVolume = trackVolume;
        }
        public static Level fromIndex(int index) {
            if (index < 0 || index >= values().length)
                throw new IllegalArgumentException("unknown level");
            return values()[index];
        }
    }

    public static final int SAMPLE_RATE = 48000;
    private final Level level;
    private final BenchSignalWindow sourceWindow = new BenchSignalWindow();
    private long frames;
    private long limitedSamples;
    private double rawSquare;
    private double outSquare;
    private int rawPeak;
    private int outPeak;

    public BenchOutputProfile(Level level) {
        if (level == null) throw new IllegalArgumentException("level");
        if (level.gain < 1 || level.gain > 24 ||
            level.cap <= 0 || level.cap > 1536 ||
            level.trackVolume < 0 || level.trackVolume > 0.35f)
            throw new IllegalArgumentException("unsafe_profile");
        this.level = level;
    }

    public Level level() { return level; }
    public long frames() { return frames; }
    public long limitedSamples() { return limitedSamples; }

    public short process(int pcm16) {
        if (pcm16 < Short.MIN_VALUE || pcm16 > Short.MAX_VALUE)
            throw new IllegalArgumentException("invalid_pcm16");
        sourceWindow.add(pcm16);
        int boosted = pcm16 * level.gain;
        int capped = Math.max(-level.cap, Math.min(level.cap, boosted));
        if (capped != boosted) limitedSamples++;
        double ramp = Math.min(1.0, frames / (double) SAMPLE_RATE);
        short emitted = (short) Math.round(capped * ramp);
        rawPeak = Math.max(rawPeak, Math.abs(pcm16));
        outPeak = Math.max(outPeak, Math.abs((int) emitted));
        rawSquare += (double) pcm16 * pcm16;
        outSquare += (double) emitted * emitted;
        frames++;
        return emitted;
    }

    private static String dbfs(double v) {
        if (v <= 0) return "-inf";
        return String.format(Locale.US, "%.1f",20 * Math.log10(v / 32768.0));
    }

    public String sourceWindowMetrics() { return sourceWindow.metrics(); }

    /** Nominal scalar arithmetic only; Android/earbud volume and acoustic transfer are unknown. */
    public String attenuationBudget() {
        return "track_scalar_db=" + dbfs(32768.0 * level.trackVolume)
            + " nominal_post_track_cap_dbfs=" + dbfs(level.cap * level.trackVolume)
            + " os_media_index_is_not_db=true acoustic_spl=UNKNOWN";
    }

    /** Original fields are pre-track; nominal post-track fields do not measure the OS output. */
    public String metrics() {
        double rawRms = frames == 0 ? 0 : Math.sqrt(rawSquare / frames);
        double outRms = frames == 0 ? 0 : Math.sqrt(outSquare / frames);
        return "level=" + level.name()
            + " gain=" + level.gain
            + " cap_pcm16=" + level.cap
            + " track_volume=" + level.trackVolume
            + " raw_rms_dbfs=" + dbfs(rawRms)
            + " raw_peak_dbfs=" + dbfs(rawPeak)
            + " out_pcm_rms_dbfs=" + dbfs(outRms)
            + " out_pcm_peak_dbfs=" + dbfs(outPeak)
            + " limited_pct=" + String.format(Locale.US, "%.3f",
                    frames == 0 ? 0 : (100.0 * limitedSamples / frames))
            + " nominal_post_track_rms_dbfs=" + dbfs(outRms * level.trackVolume)
            + " nominal_post_track_peak_dbfs=" + dbfs(outPeak * level.trackVolume)
            + " nominal_post_track_scope=scalar_estimate_pre_os_not_acoustic"
            + " pcm_frames=" + frames
            + " output_scope=pre_track_scalar_pre_os_volume_not_acoustic_spl";
    }
}
