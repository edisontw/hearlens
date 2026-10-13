package org.hearlens.micprobe;

/** Run with javac/java on a desktop JDK; no Android runtime or sound is used. */
public final class PassiveRouteAuditTest {
    private static final PassiveRouteAudit.Endpoint A2DP =
        new PassiveRouteAudit.Endpoint("BLUETOOTH_A2DP", 135);
    private static final PassiveRouteAudit.Endpoint SPEAKER =
        new PassiveRouteAudit.Endpoint("BUILTIN_SPEAKER", 3);
    private static final PassiveRouteAudit.Endpoint SCO =
        new PassiveRouteAudit.Endpoint("BLUETOOTH_SCO", 138);

    private static void expect(boolean check, String label) {
        if (!check) throw new AssertionError(label);
    }
    private static PassiveRouteAudit.Endpoint[] one(PassiveRouteAudit.Endpoint x) {
        return new PassiveRouteAudit.Endpoint[]{x};
    }
    private static PassiveRouteAudit fresh() {
        PassiveRouteAudit audit = new PassiveRouteAudit();
        expect(!audit.outputAuthorized(), "idle must not grant output");
        return audit;
    }

    public static void main(String[] args) {
        PassiveRouteAudit a = fresh();
        a.begin(1, one(A2DP), one(A2DP), true);
        expect(a.state() == PassiveRouteAudit.State.MONITORING, "start should observe A2DP");
        a.observe(2, one(A2DP), one(A2DP), true);
        expect(a.samples() == 2, "fresh matching observation");
        expect(!a.outputAuthorized(), "monitoring must never authorize playback");
        a.finish();
        expect(a.state() == PassiveRouteAudit.State.COMPLETE, "completed observation only");
        expect(!a.outputAuthorized(), "completion must not authorize output");
        a.begin(3, one(A2DP), one(A2DP), true);
        expect(a.state() == PassiveRouteAudit.State.FAULTED, "no automatic restart");
        a.resetByUser();
        a.begin(4, one(A2DP), one(A2DP), true);
        a.observe(5, one(SPEAKER), one(SPEAKER), true);
        expect(a.state() == PassiveRouteAudit.State.FAULTED, "speaker fallback latches fault");
        a.observe(6, one(A2DP), one(A2DP), true);
        expect(a.state() == PassiveRouteAudit.State.FAULTED, "reconnect cannot auto-rearm");
        expect(!a.outputAuthorized(), "fault still blocks output");

        String[] labels = {"no media", "split predicted outputs", "SCO", "multi-sink", "call mode"};
        PassiveRouteAudit.Endpoint[][] candidates = {
            {}, one(A2DP), one(SCO), {A2DP, SPEAKER}, one(A2DP)
        };
        PassiveRouteAudit.Endpoint[][] access = {
            one(A2DP), one(SPEAKER), one(SCO), one(A2DP), one(A2DP)
        };
        for (int i = 0; i < labels.length; i++) {
            PassiveRouteAudit x = fresh();
            x.begin(1, candidates[i], access[i], i != 4);
            expect(x.state() == PassiveRouteAudit.State.FAULTED, labels[i]);
        }

        PassiveRouteAudit stale = fresh();
        stale.begin(12, one(A2DP), one(A2DP), true);
        stale.observe(12, one(A2DP), one(A2DP), true);
        expect(stale.state() == PassiveRouteAudit.State.FAULTED, "stale poll");
        PassiveRouteAudit absent = fresh();
        absent.begin(1, one(A2DP), one(A2DP), true);
        absent.observe(2, null, null, true);
        expect(absent.state() == PassiveRouteAudit.State.FAULTED, "missing prediction");
        PassiveRouteAudit wrongDevice = fresh();
        wrongDevice.begin(1, one(A2DP), one(A2DP), true);
        wrongDevice.observe(2, one(new PassiveRouteAudit.Endpoint("BLUETOOTH_A2DP", 136)),
            one(new PassiveRouteAudit.Endpoint("BLUETOOTH_A2DP", 136)), true);
        expect(wrongDevice.state() == PassiveRouteAudit.State.FAULTED, "new device id");
        PassiveRouteAudit background = fresh();
        background.begin(1, one(A2DP), one(A2DP), true);
        background.interrupt("app_background");
        expect(background.state() == PassiveRouteAudit.State.FAULTED, "background abort");
        expect(!background.outputAuthorized(), "all paths never authorize sound");
        System.out.println("SW3 passive Android route-prediction audit: PASS (no AudioTrack or output)");
    }
}
