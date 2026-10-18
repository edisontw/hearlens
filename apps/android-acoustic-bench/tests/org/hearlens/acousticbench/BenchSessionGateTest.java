package org.hearlens.acousticbench;

public final class BenchSessionGateTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static BenchSessionGate armed() {
        BenchSessionGate gate = new BenchSessionGate();
        check(gate.begin(13,1000,true),"must arm");
        check(gate.state()==BenchSessionGate.State.SILENT_ROUTE_CHECK,"silent initial stage");
        return gate;
    }
    private static void noResume(BenchSessionGate gate) {
        check(gate.state()==BenchSessionGate.State.STOPPED,"must latch STOP");
        check(!gate.check(13,true,true,true,1100),"cannot restart on reconnect");
        check(!gate.begin(13,1200,true),"new explicit object needed");
    }
    public static void main(String[] args) {
        BenchSessionGate gate=armed();
        check(gate.check(13,true,true,true,1010),"exact physical A2DP gate");
        check(gate.state()==BenchSessionGate.State.RUNNING,"running only after route check");
        check(gate.tick(39999),"inside 40 second window");
        check(!gate.tick(41000),"timed out");
        check("timeout".equals(gate.reason()),"latched timeout");
        noResume(gate);

        gate=armed();
        check(!gate.check(13,false,true,true,1100),"deny phone speaker");
        check("lost_a2dp_route".equals(gate.reason()),"fault reason");
        noResume(gate);
        gate=armed();
        check(!gate.check(18,true,true,true,1100),"deny changed endpoint");
        noResume(gate);
        gate=armed();
        check(!gate.check(13,true,false,true,1100),"deny headset mic");
        noResume(gate);
        gate=armed();
        check(!gate.check(13,true,true,false,1100),"deny lost focus");
        noResume(gate);
        gate=armed();
        check(!gate.check(-1,false,true,true,1100),"deny unknown route");
        noResume(gate);
        gate=armed();
        gate.stop("manual_stop");
        gate.stop("late_callback");
        check("manual_stop".equals(gate.reason()),"first-stop reason retained");
        noResume(gate);

        gate=new BenchSessionGate();
        check(!gate.begin(13,0,false),"must confirm not worn");
        noResume(gate);
        gate=new BenchSessionGate();
        check(!gate.begin(-1,0,true),"must specify paired endpoint");
        noResume(gate);
        gate=armed();
        check(gate.checkOutputOnly(13,true,true,1010),"output-only exact A2DP");
        check(!gate.checkOutputOnly(13,false,true,1100),"output route loss");
        check("lost_a2dp_route".equals(gate.reason()),"route stop reason");
        noResume(gate);
        gate=armed();
        check(!gate.checkOutputOnly(13,true,false,1100),"output-only audio focus lost");
        check("audio_focus_lost".equals(gate.reason()),"focus stop reason");
        noResume(gate);
        System.out.println("M04-D6 Java off-ear route gate: PASS");
    }
}
