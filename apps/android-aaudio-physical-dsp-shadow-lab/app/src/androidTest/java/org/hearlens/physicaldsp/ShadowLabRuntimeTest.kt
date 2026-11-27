package org.hearlens.physicaldsp

import android.content.pm.PackageManager
import android.util.Log
import java.io.File
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class ShadowLabRuntimeTest {
    @Test
    fun nativeNoAudioBenchmarkMeasuresFirstSteadyControlAndGenerationCallbacks() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val fixture = instrumentation.context.assets
            .open("portable-fixture/auto-fir-fixture.bin").use { it.readBytes() }
        val report = NativeBridge.nativeRunNoAudioBenchmark(fixture)
        assertNotNull(report)

        val json = JSONObject(report!!)
        assertEquals("NO_AUDIO_NATIVE_DSP_BENCHMARK", json.getString("contract"))
        assertEquals(false, json.getBoolean("physical_stream_opened"))
        assertEquals(0, json.getInt("aaudio_open_calls"))
        assertEquals(false, json.getBoolean("audio_output_connected_to_dsp"))
        assertEquals(true, json.getBoolean("strict_callback_deadlines"))
        assertTrue(json.getJSONArray("records").length() >= 6)

        val records = json.getJSONArray("records")
        var sawFirst = false
        var sawSteady = false
        var sawGeneration = false
        var sawVariable = false
        for (index in 0 until records.length()) {
            val record = records.getJSONObject(index)
            val scenario = record.getString("scenario")
            assertTrue(record.has("thread_cpu_available"))
            if (scenario.startsWith("new_instance_first")) sawFirst = true
            if (scenario.startsWith("steady_and_control_update")) sawSteady = true
            if (scenario.startsWith("new_generation_first")) sawGeneration = true
            if (scenario.startsWith("variable_64_128")) sawVariable = true
            assertEquals(record.getInt("frames") * 2,
                record.getInt("zero_samples_verified"))
            assertEquals(0, record.getInt("nonzero_samples_observed"))
        }
        assertTrue(sawFirst)
        assertTrue(sawSteady)
        assertTrue(sawGeneration)
        assertTrue(sawVariable)
        val profile = json.getString("optimization_profile")
        assertTrue(profile == "O0" || profile == "O2")
        val appCache = instrumentation.targetContext.cacheDir
        assertTrue(appCache.isDirectory || appCache.mkdirs())
        File(appCache, "n07-no-audio-$profile.json").writeText(report, Charsets.UTF_8)
        Log.i("HearLensN07Benchmark", report)
    }

    @Test
    fun appLaunchesWithoutAudioPermissionsOrStartingAStream() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        )
        val requestedPermissions = info.requestedPermissions
        assertTrue(requestedPermissions == null || requestedPermissions.isEmpty())

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals("org.hearlens.physicaldsp", activity.packageName)
                assertTrue(!activity.isFinishing)
            }
        }
    }

    @Test
    fun nativeAutoFirMatchesCanonicalJavascriptOracleAndManifest() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val fixture = assets.open("portable-fixture/auto-fir-fixture.bin").use { it.readBytes() }
        val oracle = assets.open("portable-fixture/auto-fir-js-oracle.bin").use { it.readBytes() }
        val manifest = assets.open("portable-fixture/manifest.json").use {
            it.readBytes().toString(Charsets.UTF_8)
        }

        val actual = NativeBridge.nativeRunPortableFixture(fixture)
        assertNotNull(actual)
        val result = PortableOutputVerifier.verify(manifest, fixture, oracle, actual!!)
        assertTrue(result.maxPcmError <= result.pcmMaxErrorThreshold)
        assertTrue(result.rmsPcmError <= result.pcmRmsErrorThreshold)
        assertTrue(result.maxNominalLevelError <= result.nominalLevelMaxErrorThreshold)
    }

    @Test
    fun nativeSessionFaultRegressionPassesInTheAndroidProcess() {
        val summary = NativeBridge.nativeRunSessionMatrix()
        assertNotNull(summary)
        assertTrue(summary!!.contains("2000 concurrent invalidations PASS"))
    }

    @Test
    fun callbackReportIsAtomicallyPublishedOnlyAsACompleteFinalFile() {
        val directory = File(
            InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "report-store-${System.nanoTime()}",
        )
        assertTrue(directory.mkdirs())
        val fileName = "dsp-shadow-callback-result-test.json"
        val report = "{\"status\":\"PASS\",\"callback_records\":12000}"
        val result = PhysicalDspShadowReportStore.publish(directory, fileName, report)

        assertEquals(report, result.readText(Charsets.UTF_8))
        assertTrue(result.isFile)
        assertTrue(directory.listFiles().orEmpty().none { it.name == ".$fileName.tmp" })
    }
}
