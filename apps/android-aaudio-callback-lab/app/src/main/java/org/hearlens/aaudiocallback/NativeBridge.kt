package org.hearlens.aaudiocallback

internal object NativeBridge {
    init {
        System.loadLibrary("hearlens_aaudio_callback")
    }

    external fun nativeRunFixture(
        fixture: ByteArray,
        durationMs: Int,
        verifyZeroOutput: Boolean,
        faultMode: Int,
        faultAfterMs: Int,
    ): String
}
