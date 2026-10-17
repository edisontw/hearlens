package org.hearlens.acousticbench;

public final class BenchOutputProfileTest {
    private static void check(boolean ok, String reason) {
        if(!ok)throw new AssertionError(reason);
    }
    public static void main(String[] args) {
        check(BenchOutputProfile.Level.values().length == 3,"only three known levels");
        check(BenchOutputProfile.Level.fromIndex(0) ==
            BenchOutputProfile.Level.L0_BASELINE,"default baseline");
        boolean invalid = false;
        try {BenchOutputProfile.Level.fromIndex(3);}catch(IllegalArgumentException e){invalid=true;}
        check(invalid,"reject unknown profile");

        int lastCap=0;
        float lastVolume=0;
        for(BenchOutputProfile.Level level:BenchOutputProfile.Level.values()) {
            check(level.cap >= lastCap && level.trackVolume>=lastVolume,"monotonic tiers");
            check(level.gain <=24 && level.cap<=1536 && level.trackVolume<=0.35f,
                "bounded digital-only experiment");
            lastCap=level.cap;lastVolume=level.trackVolume;

            BenchOutputProfile meter = new BenchOutputProfile(level);
            short first = meter.process(Short.MAX_VALUE);
            check(first == 0,"ramp must begin muted even for clipped input");
            for(int i=1;i<BenchOutputProfile.SAMPLE_RATE+100;i++) {
                short out=meter.process((i&1)==0 ? Short.MIN_VALUE:Short.MAX_VALUE);
                check(Math.abs((int)out)<=level.cap,"never exceed PCM cap");
            }
            check(meter.limitedSamples()>0,"limit exceedance recorded");
            check(meter.frames()==BenchOutputProfile.SAMPLE_RATE+100,"count captured frames");
            String metrics=meter.metrics();
            for(String name:new String[]{"raw_rms_dbfs=","raw_peak_dbfs=",
                "out_pcm_rms_dbfs=","out_pcm_peak_dbfs=","limited_pct=",
                "track_volume=","output_scope=pre_track_scalar_pre_os_volume_not_acoustic_spl"})
                check(metrics.contains(name),"missing digital metric "+name);
        }
        BenchOutputProfile quiet =
            new BenchOutputProfile(BenchOutputProfile.Level.L1_MEASURE);
        for(int i=0;i<100;i++)quiet.process(0);
        check(quiet.limitedSamples()==0,"silence does not artificially limit");
        check(quiet.metrics().contains("out_pcm_rms_dbfs=-inf"),
            "no fabricated measured sound on silence");
        boolean invalidPcm=false;
        try{quiet.process(40000);}catch(IllegalArgumentException e){invalidPcm=true;}
        check(invalidPcm,"reject non-PCM16");
        System.out.println("M04-D5 bounded output profiles/meters: PASS");
    }
}
