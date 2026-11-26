package org.hearlens.physicalzero

internal object NativeBridge {
    init {
        System.loadLibrary("hearlens_physical_zero")
    }

    external fun nativeRunBuiltInSpeaker(deviceId: Int, runToken: Long): String
    external fun nativeRequestStop(runToken: Long)
}
