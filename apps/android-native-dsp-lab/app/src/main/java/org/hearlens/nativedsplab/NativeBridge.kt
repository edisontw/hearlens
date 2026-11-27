package org.hearlens.nativedsplab

internal object NativeBridge {
    init {
        System.loadLibrary("hearlens_native")
    }

    external fun nativeVersion(): String
    external fun nativeRunPortableFixture(fixture: ByteArray): ByteArray?
    external fun nativeRunSessionMatrix(): String?
    external fun nativeCreateSession(): Long
    external fun nativeDestroySession(handle: Long)
    external fun nativeGeneration(handle: Long): Long
    external fun nativeStartSession(handle: Long, expectedGeneration: Long, routeStamp: Long): Boolean
    external fun nativeSessionIsCurrent(handle: Long): Boolean
    external fun nativeProcessSynthetic(handle: Long, pcm: FloatArray?): Int
    external fun nativeInvalidateSession(handle: Long): Long
    external fun nativeRouteChanged(handle: Long, routeStamp: Long): Long
    external fun nativeQueueOverflow(handle: Long): Long
}
