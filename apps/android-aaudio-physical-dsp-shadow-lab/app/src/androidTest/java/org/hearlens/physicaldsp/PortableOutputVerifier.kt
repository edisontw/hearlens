package org.hearlens.physicaldsp

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.sqrt

internal object PortableOutputVerifier {
    data class Result(
        val maxPcmError: Double,
        val rmsPcmError: Double,
        val maxNominalLevelError: Double,
        val pcmMaxErrorThreshold: Double,
        val pcmRmsErrorThreshold: Double,
        val nominalLevelMaxErrorThreshold: Double,
    )

    fun verify(manifestText: String, fixture: ByteArray, oracle: ByteArray, actual: ByteArray): Result {
        val manifest = JSONObject(manifestText)
        assertEquals("none", manifest.getString("audioRoute"))
        assertEquals(false, manifest.getBoolean("hearingOutputAuthorized"))
        assertEquals(manifest.getJSONObject("sha256").getString("fixture"), sha256(fixture))
        assertEquals(manifest.getJSONObject("sha256").getString("jsOracleResult"), sha256(oracle))
        assertEquals(oracle.size, actual.size)

        val samplesPerEar = manifest.getInt("samplesPerEar")
        val updatesPerEar = manifest.getInt("controlUpdatesPerEar")
        val limiterCeiling = manifest.getDouble("limiterCeiling")
        val pcmMaxErrorThreshold = manifest.getDouble("pcmMaxErrorThreshold")
        val pcmRmsErrorThreshold = manifest.getDouble("pcmRmsErrorThreshold")
        val nominalLevelMaxErrorThreshold = manifest.getDouble("nominalLevelMaxErrorThreshold")
        val expected = ByteBuffer.wrap(oracle).order(ByteOrder.LITTLE_ENDIAN)
        val observed = ByteBuffer.wrap(actual).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(0x334f4c48, observed.getInt(0))
        assertEquals(samplesPerEar, observed.getInt(4))
        assertEquals(updatesPerEar, observed.getInt(8))

        val pcmStart = 12
        val pcmCount = samplesPerEar * 2
        var maxPcmError = 0.0
        var sumSquaredPcmError = 0.0
        for (index in 0 until pcmCount) {
            val expectedSample = expected.getFloat(pcmStart + index * 4)
            val actualSample = observed.getFloat(pcmStart + index * 4)
            assertTrue("Native PCM must be finite at $index", actualSample.isFinite())
            assertTrue("Native limiter ceiling exceeded at $index", abs(actualSample) <= limiterCeiling)
            val error = abs(actualSample - expectedSample).toDouble()
            maxPcmError = maxOf(maxPcmError, error)
            sumSquaredPcmError += error * error
        }
        val rmsPcmError = sqrt(sumSquaredPcmError / pcmCount)
        assertTrue("PCM max error $maxPcmError exceeds oracle threshold", maxPcmError <= pcmMaxErrorThreshold)
        assertTrue("PCM RMS error $rmsPcmError exceeds oracle threshold", rmsPcmError <= pcmRmsErrorThreshold)

        var offset = pcmStart + pcmCount * 4
        for (ear in 0 until 2) {
            for (field in 0 until 11) {
                assertEquals("Native diagnostics ear=$ear field=$field", expected.getLong(offset), observed.getLong(offset))
                offset += 8
            }
            val expectedPeak = expected.getDouble(offset)
            val actualPeak = observed.getDouble(offset)
            assertTrue("Native peak diagnostic ear=$ear", abs(actualPeak - expectedPeak) <= pcmMaxErrorThreshold)
            offset += 8
        }
        assertEquals("JNI allocation probe unavailable sentinel", -1L, observed.getLong(offset))
        offset += 8

        var maxNominalLevelError = 0.0
        for (ear in 0 until 2) {
            for (event in 0 until updatesPerEar) {
                assertEquals("Control update index ear=$ear event=$event", expected.getLong(offset), observed.getLong(offset))
                offset += 8
                for (band in 0 until 6) {
                    val expectedLevel = expected.getDouble(offset)
                    val actualLevel = observed.getDouble(offset)
                    maxNominalLevelError = maxOf(maxNominalLevelError, abs(actualLevel - expectedLevel))
                    offset += 8
                }
            }
        }
        assertEquals("Portable result protocol length", actual.size, offset)
        assertTrue("Nominal level error $maxNominalLevelError exceeds oracle threshold", maxNominalLevelError <= nominalLevelMaxErrorThreshold)

        return Result(maxPcmError, rmsPcmError, maxNominalLevelError,
            pcmMaxErrorThreshold, pcmRmsErrorThreshold, nominalLevelMaxErrorThreshold)
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }
}
