package org.hearlens.physicaldsp

internal object NativeBridge {
    init {
        System.loadLibrary("hearlens_physical_dsp_shadow")
    }

    external fun nativePublishRouteSnapshot(
        runToken: Long,
        generation: Long,
        speakerId: Int,
        allowed: Boolean,
        invalidationReasonCode: Int,
    )

    external fun nativeRequestStop(runToken: Long, reasonCode: Int)
    external fun nativeRunDspShadow(fixture: ByteArray, deviceId: Int, runToken: Long, routeGeneration: Long): String
    external fun nativeRunPortableFixture(fixture: ByteArray): ByteArray?
    external fun nativeRunSessionMatrix(): String?
    external fun nativeRunNoAudioBenchmark(fixture: ByteArray): String?
}
