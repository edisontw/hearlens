package org.hearlens.acousticbench;

public final class BenchPlaybackProgressTest {
    private static void check(boolean v,String msg){if(!v)throw new AssertionError(msg);}
    private static void throwsIllegal(Runnable r,String msg){
        boolean failed=false;
        try{r.run();}catch(IllegalArgumentException|IllegalStateException ex){failed=true;}
        check(failed,msg);
    }
    public static void main(String[] args) {
        BenchPlaybackProgress p=new BenchPlaybackProgress(1440,480,100);
        check(p.queuedFrames()==960,"priming included in playback target");
        check(!p.drained(),"never complete before drain begins");
        p.accepted(312000);
        p.startDrain(7000);
        check(!p.drained(),"accepted PCM is not played PCM");
        check(!p.canQueue(),"producer bounded by playback head");
        check(!p.stalled(1800),"progress window");
        check(p.stalled(1901),"stuck playback cursor");
        check(p.drainTimedOut(10501),"bounded drain");
        p.observe(200000,7100);
        check(!p.drained(),"partially played is not done");
        p.observe(313440,7600);
        check(p.drained(),"full playback cursor passed PCM and silence");
        check(p.queuedFrames()==0,"no remaining OS-visible PCM");
        check(!p.drainTimedOut(20000),"completed does not time out");
        throwsIllegal(()->p.observe(313441,7601),"head cannot advance beyond writes");
        throwsIllegal(()->p.observe(100,7601),"head regression rejected");
        BenchPlaybackProgress partial=new BenchPlaybackProgress(0,0,0);
        partial.accepted(9600);
        check(!partial.canQueue(),"throttle when queue reaches 200ms");
        partial.observe(480,100);
        check(partial.canQueue(),"resume only after head advances");
        throwsIllegal(()->partial.accepted(-1),"negative accepted frames");
        System.out.println("M04-D6.1 playback cursor and bounded drain: PASS");
    }
}
