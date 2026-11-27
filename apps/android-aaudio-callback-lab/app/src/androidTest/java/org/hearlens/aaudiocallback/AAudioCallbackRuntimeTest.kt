package org.hearlens.aaudiocallback

import android.os.Build
import android.media.AudioManager
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AAudioCallbackRuntimeTest {
    companion object {
        private val resultSequence = AtomicInteger(0)
    }

    private fun requireAudioDisabledX86Emulator() {
        val emulator = Build.FINGERPRINT.contains("generic", ignoreCase = true) ||
            Build.FINGERPRINT.contains("emulator", ignoreCase = true) ||
            Build.MODEL.contains("sdk_gphone", ignoreCase = true)
        assertTrue("AAudio stream test is restricted to the dedicated emulator", emulator)
        assertEquals(29, Build.VERSION.SDK_INT)
        assertTrue("x86_64 emulator required", Build.SUPPORTED_ABIS.contains("x86_64"))
    }

    private fun fixture(): ByteArray {
        return InstrumentationRegistry.getInstrumentation().context.assets
            .open("portable-fixture/auto-fir-fixture.bin").use { it.readBytes() }
    }

    private fun run(durationMs: Int, verifyZero: Boolean, faultMode: Int = 0,
                    faultAfterMs: Int = 0,
                    workload: String = "NATIVE_SESSION",
                    requestedSampleRate: Int = 48_000,
                    sharingMode: Int = 0,
                    usage: Int = 0,
                    bufferPolicy: Int = 0): JSONObject {
        require(workload == "ZERO_ONLY" || workload == "NATIVE_SESSION")
        val report = NativeBridge.nativeRunFixture(
            fixture(), durationMs, verifyZero, faultMode, faultAfterMs,
            workload == "NATIVE_SESSION", requestedSampleRate, sharingMode,
            usage, bufferPolicy,
        )
        val result = JSONObject(report)
        val runId = InstrumentationRegistry.getArguments().getString("aaudioRunId") ?: "manual"
        val audioManager = InstrumentationRegistry.getInstrumentation().targetContext
            .getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
        result.put("audio_manager_output_sample_rate", audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()
            ?: JSONObject.NULL)
        result.put("audio_manager_output_frames_per_buffer", audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)?.toIntOrNull()
            ?: JSONObject.NULL)
        result.put("run_id", runId)
        val resultFile = "aaudio-result-$runId-${resultSequence.getAndIncrement()}.json"
        InstrumentationRegistry.getInstrumentation().targetContext
            .openFileOutput(resultFile, android.content.Context.MODE_PRIVATE).use {
                it.write(result.toString().toByteArray(Charsets.UTF_8))
            }
        Log.i("HearLensAAudioLab", "AAUDIO_LAB_RESULT_FILE=$runId|$resultFile")
        Log.i("HearLensAAudioLab", "AAUDIO_LAB_RESULT=$runId|$result")
        return result
    }

    private fun assertSilentCallbackIfObserved(report: JSONObject) {
        assertTrue(report.toString(), report.getString("status") in setOf(
            "PASS", "NOT_RUN", "EARLY_FAIL_STOP", "FAULT_INJECTED",
            "STREAM_ERROR", "INCOMPLETE", "CALLBACK_OVERLAP",
            "CALLBACK_LOG_OVERFLOW", "STREAM_STOP_TIMEOUT",
            "STREAM_CLOSE_ERROR",
        ))
        if (report.getBoolean("actual_callback_observed")) {
            if (report.getBoolean("zero_output_verification_enabled")) {
                assertTrue(report.toString(), report.getLong("zero_samples_verified") > 0L)
                assertEquals(0L, report.getLong("nonzero_output_samples_observed"))
            } else {
                assertEquals(0L, report.getLong("zero_samples_verified"))
                assertEquals(0L, report.getLong("nonzero_output_samples_observed"))
            }
            assertEquals(0L, report.getLong("callback_overlap_count"))
            assertEquals(0L, report.getLong("callbacks_in_flight_after_close"))
            when (report.getString("run_completion")) {
                "COMPLETE" -> {
                    assertEquals("PASS", report.getString("status"))
                    assertTrue(report.toString(), report.getBoolean("duration_complete"))
                    assertTrue(report.toString(), report.getBoolean("stream_stop_confirmed"))
                }
                "EARLY_FAIL_STOP" -> {
                    assertEquals("EARLY_FAIL_STOP", report.getString("status"))
                    assertTrue(report.toString(), report.getLong("native_session_fail_stop_count") > 0L)
                    if (report.getString("reason").contains("deadline")) {
                        assertTrue(report.toString(), report.getLong("deadline_misses") > 0L)
                    }
                    assertFalse(report.toString(), report.getBoolean("duration_complete"))
                }
                "FAULT_INJECTED" -> {
                    assertEquals("FAULT_INJECTED", report.getString("status"))
                    assertTrue(report.toString(), report.getInt("fault_mode") > 0)
                }
                "STREAM_ERROR" -> assertTrue(
                    report.toString(), report.getInt("error_callback_code") != 0,
                )
                "CALLBACK_OVERLAP" -> assertTrue(
                    report.toString(), report.getLong("callback_overlap_count") > 0L,
                )
                "CALLBACK_LOG_OVERFLOW" -> assertTrue(
                    report.toString(), report.getLong("callback_log_overflow") > 0L,
                )
                "STREAM_STOP_TIMEOUT" -> assertFalse(
                    report.toString(), report.getBoolean("stream_stop_confirmed"),
                )
                "STREAM_CLOSE_ERROR" -> assertTrue(
                    report.toString(), report.getInt("aaudio_close_result") != 0,
                )
                "INCOMPLETE" -> assertFalse(report.toString(), report.getBoolean("duration_complete"))
                else -> throw AssertionError("unknown callback run outcome: $report")
            }
        } else {
            assertEquals("NOT_RUN", report.getString("status"))
            assertEquals("NOT_RUN", report.getString("run_completion"))
        }
        assertFalse(report.toString(), report.getBoolean("microphone_used"))
        assertFalse(report.toString(), report.getBoolean("bluetooth_api_used"))
        assertFalse(report.toString(), report.getBoolean("dsp_to_audio_buffer_path"))
    }

    @Test
    fun aaudioCallbackUsesOnlyZeroOutputAndReportsActualFrames() {
        resultSequence.set(0)
        requireAudioDisabledX86Emulator()
        val arguments = InstrumentationRegistry.getArguments()
        val durationMs = arguments.getString("aaudioDurationMs")?.toIntOrNull() ?: 2_000
        val verifyZero = arguments.getString("aaudioVerifyZero")?.toBooleanStrictOrNull() ?: true
        val workload = arguments.getString("aaudioWorkload") ?: "NATIVE_SESSION"
        val requestedSampleRate = arguments.getString("aaudioSampleRate")?.toIntOrNull() ?: 48_000
        val sharingMode = when (arguments.getString("aaudioSharing") ?: "SHARED") {
            "SHARED" -> 0
            "EXCLUSIVE" -> 1
            else -> throw IllegalArgumentException("unknown AAudio sharing mode")
        }
        val usage = when (arguments.getString("aaudioUsage") ?: "MEDIA") {
            "MEDIA" -> 0
            "GAME" -> 1
            else -> throw IllegalArgumentException("unknown AAudio usage")
        }
        val bufferPolicy = when (arguments.getString("aaudioBufferPolicy") ?: "DEFAULT") {
            "DEFAULT" -> 0
            "TWO_BURSTS" -> 1
            else -> throw IllegalArgumentException("unknown AAudio buffer policy")
        }
        assertTrue("duration must be in 100..300000 ms", durationMs in 100..300_000)
        val report = run(
            durationMs, verifyZero = verifyZero, workload = workload,
            requestedSampleRate = requestedSampleRate, sharingMode = sharingMode,
            usage = usage, bufferPolicy = bufferPolicy,
        )
        assertSilentCallbackIfObserved(report)
        assertEquals(workload, report.getString("workload"))
        assertEquals(requestedSampleRate, report.getInt("requested_sample_rate"))
        assertEquals(if (sharingMode == 0) "SHARED" else "EXCLUSIVE",
            report.getString("requested_sharing_mode"))
        assertEquals(if (usage == 0) "MEDIA" else "GAME",
            report.getString("requested_usage"))
        assertEquals(if (bufferPolicy == 0) "DEFAULT" else "TWO_BURSTS",
            report.getString("requested_buffer_policy"))
        if (report.getBoolean("actual_callback_observed") &&
            report.getString("run_completion") == "COMPLETE") {
            assertTrue(report.toString(), report.getLong("run_wall_ns") >= durationMs * 900_000L)
        }
        if (report.getBoolean("actual_callback_observed")) {
            assertTrue(report.toString(), report.getInt("actual_sample_rate") > 0)
            assertTrue(report.toString(), report.getInt("frames_per_burst") > 0)
            assertTrue(report.toString(), report.getInt("buffer_size_frames") > 0)
            assertTrue(report.toString(), report.getString("actual_sharing_mode").isNotEmpty())
            assertTrue(report.toString(), report.getString("actual_performance_mode").isNotEmpty())
            if (workload == "ZERO_ONLY" || !report.getBoolean("sample_rate_matches_fixture")) {
                assertEquals(0L, report.getLong("native_session_invocations"))
                assertFalse(report.toString(), report.getBoolean("dsp_benchmark_valid"))
            } else {
                assertTrue(report.toString(), report.getLong("native_session_invocations") > 0L)
                assertTrue(report.toString(), report.getBoolean("dsp_benchmark_valid"))
            }
        }
    }

    @Test
    fun callbackStopRestartAndBackgroundInvalidationAreRecorded() {
        resultSequence.set(0)
        requireAudioDisabledX86Emulator()
        val first = run(500, verifyZero = true)
        assertSilentCallbackIfObserved(first)
        val restarted = run(500, verifyZero = true)
        assertSilentCallbackIfObserved(restarted)
        val background = run(500, verifyZero = true, faultMode = 1, faultAfterMs = 150)
        assertSilentCallbackIfObserved(background)
        assertEquals(1, background.getInt("fault_mode"))
        if (background.getBoolean("actual_callback_observed")) {
            assertTrue(background.toString(), background.getLong("run_wall_ns") < 500_000_000L)
        }
        val disconnected = run(500, verifyZero = true, faultMode = 2, faultAfterMs = 150)
        assertSilentCallbackIfObserved(disconnected)
        assertEquals(2, disconnected.getInt("fault_mode"))
    }
}
