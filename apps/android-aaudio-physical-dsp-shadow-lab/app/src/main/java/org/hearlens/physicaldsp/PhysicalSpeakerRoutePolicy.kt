package org.hearlens.physicaldsp

/** Android-independent route policy for synthetic host tests. */
internal enum class RouteDeviceKind {
    BUILTIN_SPEAKER,
    BUILTIN_EARPIECE,
    TELEPHONY,
    BLUETOOTH,
    USB,
    WIRED,
    UNKNOWN,
    OTHER,
}

internal data class RouteDeviceSnapshot(
    val id: Int,
    val kind: RouteDeviceKind,
)

internal data class RouteSnapshot(
    val generation: Long,
    val audioModeBeforeQueries: Int?,
    val audioModeAfterQueries: Int?,
    val outputInventory: List<RouteDeviceSnapshot>?,
    val mediaPredictedRoute: List<RouteDeviceSnapshot>?,
    val queryError: String? = null,
)

internal data class RouteRunContext(
    val runToken: Long,
    val routeGeneration: Long,
    val speakerId: Int,
)

internal data class RouteDecision(
    val allowed: Boolean,
    val speakerId: Int?,
    val reason: String,
)

internal object PhysicalSpeakerRoutePolicy {
    // AudioManager.MODE_NORMAL is the stable Android API value 0.
    const val MODE_NORMAL = 0

    fun evaluate(
        snapshot: RouteSnapshot,
        expected: RouteRunContext? = null,
        currentRunToken: Long? = null,
    ): RouteDecision {
        if (expected != null && currentRunToken != expected.runToken) {
            return refuse("stale run token")
        }
        if (expected != null && snapshot.generation != expected.routeGeneration) {
            return refuse("stale route generation")
        }
        if (!snapshot.queryError.isNullOrBlank()) {
            return refuse("route query failed: ${snapshot.queryError}")
        }
        if (snapshot.audioModeBeforeQueries == null ||
            snapshot.audioModeAfterQueries == null) {
            return refuse("audio mode query unavailable")
        }
        if (snapshot.audioModeBeforeQueries != MODE_NORMAL ||
            snapshot.audioModeAfterQueries != MODE_NORMAL) {
            return refuse("audio mode changed or is not MODE_NORMAL")
        }

        val inventory = snapshot.outputInventory
            ?: return refuse("output inventory query unavailable")
        if (inventory.any { it.id <= 0 } || inventory.map { it.id }.toSet().size != inventory.size) {
            return refuse("output inventory contains invalid or duplicate device IDs")
        }
        val unexpected = inventory.filter {
            it.kind !in setOf(
                RouteDeviceKind.BUILTIN_SPEAKER,
                RouteDeviceKind.BUILTIN_EARPIECE,
                RouteDeviceKind.TELEPHONY,
            )
        }
        if (unexpected.isNotEmpty()) {
            return refuse("output inventory contains non-local or unknown endpoint(s)")
        }
        if (inventory.count { it.kind == RouteDeviceKind.BUILTIN_SPEAKER } != 1) {
            return refuse("output inventory must contain exactly one built-in speaker")
        }
        if (inventory.count { it.kind == RouteDeviceKind.TELEPHONY } > 1) {
            return refuse("multiple telephony system endpoints are not classified")
        }

        val predicted = snapshot.mediaPredictedRoute
            ?: return refuse("MEDIA predicted-route query unavailable")
        if (predicted.size != 1) {
            return refuse("MEDIA predicted route must contain exactly one device")
        }
        val predictedDevice = predicted.single()
        if (predictedDevice.kind != RouteDeviceKind.BUILTIN_SPEAKER ||
            predictedDevice.id <= 0) {
            return refuse("MEDIA predicted route is not a built-in speaker")
        }
        val inventorySpeaker = inventory.single { it.kind == RouteDeviceKind.BUILTIN_SPEAKER }
        if (predictedDevice.id != inventorySpeaker.id) {
            return refuse("MEDIA predicted speaker does not match the unique inventory speaker")
        }
        if (expected != null && predictedDevice.id != expected.speakerId) {
            return refuse("built-in speaker ID changed during the active run")
        }
        return RouteDecision(
            allowed = true,
            speakerId = predictedDevice.id,
            reason = if (inventory.any { it.kind == RouteDeviceKind.TELEPHONY }) {
                "unique MEDIA built-in speaker; telephony endpoint is inventory-only"
            } else {
                "unique MEDIA built-in speaker"
            },
        )
    }

    fun actualStreamDeviceMatches(expectedSpeakerId: Int, actualDeviceId: Int): Boolean =
        expectedSpeakerId > 0 && actualDeviceId == expectedSpeakerId

    private fun refuse(reason: String) = RouteDecision(false, null, reason)
}
