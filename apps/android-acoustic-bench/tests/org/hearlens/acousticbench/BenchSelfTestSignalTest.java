package org.hearlens.acousticbench;

public final class BenchSelfTestSignalTest {
    private static void check(boolean ok,String what){if(!ok)throw new AssertionError(what);}
    public static void main(String[] args) {
        BenchSelfTestSignal signal=new BenchSelfTestSignal();
        check(signal.totalFrames()==312_000,"6.5-second finite self-test");
        check(BenchSelfTestSignal.CHIRP_COUNT==6,"six chirps");
        check(signal.sampleAt(-1)==0 && signal.sampleAt(signal.totalFrames())==0,"outside zero");
        BenchOutputProfile profile=new BenchOutputProfile(BenchOutputProfile.Level.L1_MEASURE);
        int rawPeak=0,pcmPeak=0;
        for(long i=0;i<signal.totalFrames();i++){
            int raw=signal.sampleAt(i);
            check(raw==signal.sampleAt(i),"deterministic");
            check(Math.abs(raw)<=64,"generated raw bound");
            rawPeak=Math.max(rawPeak,Math.abs(raw));
            short output=profile.process(raw);
            check(Math.abs((int)output)<=768,"L1 digital limiter");
            pcmPeak=Math.max(pcmPeak,Math.abs((int)output));
            if(i<48_000)check(output==0,"one-second ramp starts silently");
        }
        check(rawPeak>=50 && pcmPeak>0,"measurable digital chirps");
        for(int event=0;event<BenchSelfTestSignal.CHIRP_COUNT;event++) {
            long first=(BenchSelfTestSignal.FIRST_CHIRP_MS+
                event*BenchSelfTestSignal.PERIOD_MS)*48L;
            long energy=0;
            for(long i=first;i<first+BenchSelfTestSignal.CHIRP_MS*48L;i++)
                energy+=Math.abs(signal.sampleAt(i));
            check(energy>1000,"event energy "+event);
            check(signal.sampleAt(first+BenchSelfTestSignal.CHIRP_MS*48L)==0,
                "silence between chirps");
        }
        check(profile.frames()==signal.totalFrames(),"meter frame count");
        check(profile.metrics().contains("level=L1_MEASURE"),"fixed L1");
        System.out.println("M04-D6 bounded deterministic output chirps: PASS");
    }
}
