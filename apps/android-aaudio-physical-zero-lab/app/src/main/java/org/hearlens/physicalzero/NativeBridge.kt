package org.hearlens.physicalzero

internal object NativeBridge {
    init {
        System.loadLibrary("hearlens_physical_zero")
    }

    external fun nativePublishRouteSnapshot(
        runToken: Long,
        generation: Long,
        speakerId: Int,
        allowed: Boolean,
        invalidationReasonCode: Int,
    )

    external fun nativeRunBuiltInSpeaker(deviceId: Int, runToken: Long, routeGeneration: Long): String
    external fun nativeRequestStop(runToken: Long, reasonCode: Int)
}
