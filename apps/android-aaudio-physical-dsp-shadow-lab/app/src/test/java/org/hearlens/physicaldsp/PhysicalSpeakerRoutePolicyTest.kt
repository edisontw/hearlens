package org.hearlens.physicaldsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhysicalSpeakerRoutePolicyTest {
    private fun snapshot(
        generation: Long = 7,
        beforeMode: Int? = PhysicalSpeakerRoutePolicy.MODE_NORMAL,
        afterMode: Int? = PhysicalSpeakerRoutePolicy.MODE_NORMAL,
        inventory: List<RouteDeviceSnapshot>? = listOf(speaker),
        predicted: List<RouteDeviceSnapshot>? = listOf(speaker),
        error: String? = null,
    ) = RouteSnapshot(generation, beforeMode, afterMode, inventory, predicted, error)

    companion object {
        private val speaker = RouteDeviceSnapshot(3, RouteDeviceKind.BUILTIN_SPEAKER)
        private val earpiece = RouteDeviceSnapshot(4, RouteDeviceKind.BUILTIN_EARPIECE)
        private val telephony = RouteDeviceSnapshot(9, RouteDeviceKind.TELEPHONY)
        private val context = RouteRunContext(runToken = 50, routeGeneration = 7, speakerId = 3)
    }

    @Test fun builtInSpeakerAndEarpieceInventoryAreAllowedOnlyWithSpeakerPrediction() {
        val result = PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, earpiece)),
        )
        assertTrue(result.allowed)
        assertEquals(3, result.speakerId)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, earpiece), predicted = listOf(earpiece)),
        ).allowed)
    }

    @Test fun attachedTelephonyEndpointIsInventoryOnly() {
        val result = PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, earpiece, telephony)),
        )
        assertTrue(result.allowed)
        assertEquals(3, result.speakerId)
        assertTrue(result.reason.contains("inventory-only"))
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, telephony), predicted = listOf(telephony)),
        ).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.actualStreamDeviceMatches(3, telephony.id))
    }

    @Test fun communicationOrOtherAudioModeIsRejected() {
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(beforeMode = 3, afterMode = 3)).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(beforeMode = 0, afterMode = 3)).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(beforeMode = null)).allowed)
    }

    @Test fun bluetoothUsbWiredAndUnknownInventoryAreRejected() {
        val disallowed = listOf(
            RouteDeviceKind.BLUETOOTH,
            RouteDeviceKind.USB,
            RouteDeviceKind.WIRED,
            RouteDeviceKind.UNKNOWN,
            RouteDeviceKind.OTHER,
        )
        disallowed.forEachIndexed { index, kind ->
            val extra = RouteDeviceSnapshot(20 + index, kind)
            assertFalse("$kind must be refused", PhysicalSpeakerRoutePolicy.evaluate(
                snapshot(inventory = listOf(speaker, extra)),
            ).allowed)
        }
    }

    @Test fun multipleSpeakerIDsAndMultiplePredictedRoutesAreRejected() {
        val secondSpeaker = RouteDeviceSnapshot(8, RouteDeviceKind.BUILTIN_SPEAKER)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, secondSpeaker)),
        ).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(predicted = listOf(speaker, secondSpeaker)),
        ).allowed)
    }

    @Test fun nonSpeakerPredictedRoutesAndMismatchedIDsAreRejected() {
        val nonSpeakers = listOf(
            RouteDeviceKind.BLUETOOTH,
            RouteDeviceKind.USB,
            RouteDeviceKind.WIRED,
            RouteDeviceKind.UNKNOWN,
            RouteDeviceKind.BUILTIN_EARPIECE,
            RouteDeviceKind.TELEPHONY,
        )
        nonSpeakers.forEachIndexed { index, kind ->
            assertFalse("$kind must not be a MEDIA target", PhysicalSpeakerRoutePolicy.evaluate(
                snapshot(predicted = listOf(RouteDeviceSnapshot(20 + index, kind))),
            ).allowed)
        }
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(predicted = listOf(RouteDeviceSnapshot(5, RouteDeviceKind.BUILTIN_SPEAKER))),
        ).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(inventory = listOf(speaker, telephony, telephony)),
        ).allowed)
    }

    @Test fun emptyFailedAndUnavailableRouteQueriesAreRejected() {
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(predicted = emptyList())).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(predicted = null)).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(inventory = null)).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(snapshot(error = "security/runtime query error")).allowed)
    }

    @Test fun openStartAndRuntimeRouteChangesFailTheAnchoredGeneration() {
        assertTrue(PhysicalSpeakerRoutePolicy.evaluate(snapshot(), context, currentRunToken = 50).allowed)
        val changed = snapshot(
            generation = 8,
            inventory = listOf(RouteDeviceSnapshot(6, RouteDeviceKind.BUILTIN_SPEAKER)),
            predicted = listOf(RouteDeviceSnapshot(6, RouteDeviceKind.BUILTIN_SPEAKER)),
        )
        val result = PhysicalSpeakerRoutePolicy.evaluate(changed, context, currentRunToken = 50)
        assertFalse(result.allowed)
        assertNull(result.speakerId)
        assertFalse(PhysicalSpeakerRoutePolicy.actualStreamDeviceMatches(3, 6))
    }

    @Test fun staleGenerationAndStopRestartTokensAreRejected() {
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(generation = 6), context, currentRunToken = 50,
        ).allowed)
        assertFalse(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(), context, currentRunToken = 51,
        ).allowed)
        val restarted = context.copy(runToken = 51, routeGeneration = 7)
        assertTrue(PhysicalSpeakerRoutePolicy.evaluate(
            snapshot(), restarted, currentRunToken = 51,
        ).allowed)
    }
}
