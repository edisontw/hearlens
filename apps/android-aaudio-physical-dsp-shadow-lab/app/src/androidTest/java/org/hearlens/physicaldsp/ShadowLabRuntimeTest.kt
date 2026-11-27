package org.hearlens.physicaldsp

import android.content.pm.PackageManager
import java.io.File
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShadowLabRuntimeTest {
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
