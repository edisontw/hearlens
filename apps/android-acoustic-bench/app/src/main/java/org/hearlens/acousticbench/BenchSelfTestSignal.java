package org.hearlens.acousticbench;

/** Deterministic 48-kHz off-ear chirps; NO microphone input. */
public final class BenchSelfTestSignal {
    public static final int SAMPLE_RATE=48_000;
    public static final int CHIRP_MS=40;
    public static final int CHIRP_COUNT=6;
    public static final int FIRST_CHIRP_MS=1_250;
    public static final int PERIOD_MS=800;
    public static final int TOTAL_MS=6_500;
    private static final int CHIRP_FRAMES=CHIRP_MS*SAMPLE_RATE/1000;
    private static final int FIRST_FRAME=FIRST_CHIRP_MS*SAMPLE_RATE/1000;
    private static final int PERIOD_FRAMES=PERIOD_MS*SAMPLE_RATE/1000;
    private static final int TOTAL_FRAMES=TOTAL_MS*SAMPLE_RATE/1000;

    public long totalFrames(){return TOTAL_FRAMES;}
    public int sampleAt(long frame) {
        if(frame<0 || frame>=TOTAL_FRAMES)return 0;
        long relative=frame-FIRST_FRAME;
        if(relative<0)return 0;
        long event=relative/PERIOD_FRAMES;
        if(event>=CHIRP_COUNT)return 0;
        int local=(int)(relative%PERIOD_FRAMES);
        if(local>=CHIRP_FRAMES)return 0;
        double t=local/(double)SAMPLE_RATE;
        double duration=CHIRP_MS/1000.0;
        double phase=2*Math.PI*(900*t+0.5*(3800-900)*t*t/duration);
        double window=0.5*(1-Math.cos(2*Math.PI*local/(CHIRP_FRAMES-1)));
        // Existing L1 gain, slow ramp and limiter enforce +/-768 PCM16 output.
        return (int)Math.round(64*window*Math.sin(phase));
    }
}
