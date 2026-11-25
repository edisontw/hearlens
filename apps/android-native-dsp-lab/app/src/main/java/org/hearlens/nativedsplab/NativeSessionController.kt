package org.hearlens.nativedsplab

/** Owns a synthetic-only Native session. No audio device or sink is exposed here. */
internal class NativeSessionController : AutoCloseable {
    private var handle = NativeBridge.nativeCreateSession()
    private var authorized = false
    private var closed = false
    private var lastGeneration = NativeBridge.nativeGeneration(handle)

    @get:Synchronized
    val generation: Long
        get() = if (closed) lastGeneration else NativeBridge.nativeGeneration(handle)

    @get:Synchronized
    val isAuthorized: Boolean
        get() {
            if (closed || !authorized || !NativeBridge.nativeSessionIsCurrent(handle)) {
                authorized = false
                return false
            }
            return true
        }

    @Synchronized
    fun startSynthetic(routeStamp: Long): Boolean {
        if (closed || routeStamp <= 0L) return false
        val current = NativeBridge.nativeGeneration(handle)
        val started = NativeBridge.nativeStartSession(handle, current, routeStamp)
        authorized = started
        return started
    }

    @Synchronized
    fun processSynthetic(pcm: FloatArray?): Int {
        if (closed || !isAuthorized) return 0
        val frames = NativeBridge.nativeProcessSynthetic(handle, pcm)
        if (!NativeBridge.nativeSessionIsCurrent(handle)) authorized = false
        return frames
    }

    @Synchronized
    fun stop() {
        invalidate()
    }

    @Synchronized
    fun reset() {
        invalidate()
    }

    @Synchronized
    fun settingsChanged() {
        invalidate()
    }

    @Synchronized
    fun syntheticRouteChanged(routeStamp: Long) {
        if (closed) return
        lastGeneration = NativeBridge.nativeRouteChanged(handle, routeStamp)
        authorized = false
    }

    @Synchronized
    fun simulateQueueOverflow() {
        if (closed) return
        lastGeneration = NativeBridge.nativeQueueOverflow(handle)
        authorized = false
    }

    private fun invalidate() {
        if (closed) return
        lastGeneration = NativeBridge.nativeInvalidateSession(handle)
        authorized = false
    }

    @Synchronized
    override fun close() {
        if (closed) return
        lastGeneration = NativeBridge.nativeInvalidateSession(handle)
        NativeBridge.nativeDestroySession(handle)
        handle = 0L
        authorized = false
        closed = true
    }
}
