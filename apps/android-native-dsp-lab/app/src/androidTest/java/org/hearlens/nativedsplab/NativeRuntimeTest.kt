package org.hearlens.nativedsplab

import android.content.pm.PackageManager
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeRuntimeTest {
    @Test
    fun appLaunchesAndRequestsNoPermissions() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        )
        val requestedPermissions = info.requestedPermissions
        assertTrue(requestedPermissions == null || requestedPermissions.isEmpty())

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals("org.hearlens.nativedsplab", activity.packageName)
                assertTrue(NativeBridge.nativeVersion().contains("C++17"))
            }
        }
    }

    @Test
    fun nativeJniMatchesPortableJavascriptOracleThresholds() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val fixture = assets.open("portable-fixture/auto-fir-fixture.bin").use { it.readBytes() }
        val oracle = assets.open("portable-fixture/auto-fir-js-oracle.bin").use { it.readBytes() }
        val manifestBytes = assets.open("portable-fixture/manifest.json").use { it.readBytes() }
        val manifest = manifestBytes.toString(Charsets.UTF_8)

        val actual = NativeBridge.nativeRunPortableFixture(fixture)
        assertNotNull(actual)
        val result = PortableOutputVerifier.verify(manifest, fixture, oracle, actual!!)
        assertTrue(result.maxPcmError <= result.pcmMaxErrorThreshold)
        assertTrue(result.rmsPcmError <= result.pcmRmsErrorThreshold)
        assertTrue(result.maxNominalLevelError <= result.nominalLevelMaxErrorThreshold)
    }

    @Test
    fun nativeSessionFaultMatrixPassesInTheAndroidProcess() {
        val summary = NativeBridge.nativeRunSessionMatrix()
        assertNotNull(summary)
        assertTrue(summary!!.contains("2000 concurrent invalidations PASS"))
    }

    @Test
    fun concurrentNativeFaultMatricesAreSerialized() {
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = List(2) {
                executor.submit(Callable { NativeBridge.nativeRunSessionMatrix() })
            }
            for (future in futures) {
                val summary = future.get(30, TimeUnit.SECONDS)
                assertNotNull(summary)
                assertTrue(summary!!.contains("2000 concurrent invalidations PASS"))
            }
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun startResetRouteChangesAndFaultsFailClosed() {
        val session = NativeSessionController()
        val cleanPcm = FloatArray(256) { 0.02f }
        try {
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))
            assertFalse(session.startSynthetic(0L))
            assertTrue(session.startSynthetic(42L))
            assertTrue(session.startSynthetic(42L))
            assertEquals(128, session.processSynthetic(cleanPcm))

            assertFalse(session.startSynthetic(43L))
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))
            assertTrue(session.startSynthetic(43L))

            val startedGeneration = session.generation
            session.reset()
            assertTrue(session.generation > startedGeneration)
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))

            assertTrue(session.startSynthetic(42L))
            session.syntheticRouteChanged(43L)
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))
            assertTrue(session.startSynthetic(43L))
            session.settingsChanged()
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))

            assertTrue(session.startSynthetic(43L))
            session.simulateQueueOverflow()
            assertFalse(session.isAuthorized)
            assertEquals(0, session.processSynthetic(cleanPcm))

            for (bad in listOf(Float.NaN, Float.POSITIVE_INFINITY)) {
                assertTrue(session.startSynthetic(43L))
                assertEquals(0, session.processSynthetic(floatArrayOf(bad, 0f)))
                assertFalse(session.isAuthorized)
                assertEquals(0, session.processSynthetic(cleanPcm))
            }
        } finally {
            session.close()
        }
    }

    @Test
    fun activityRecreationAndBackgroundInvalidateWithoutAutoRestart() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var retained: NativeSessionController
            scenario.onActivity { activity ->
                retained = activity.sessionController
                assertTrue(retained.startSynthetic(42L))
                assertTrue(retained.isAuthorized)
            }

            scenario.recreate()
            scenario.onActivity { activity ->
                assertSame(retained, activity.sessionController)
                assertFalse(activity.sessionController.isAuthorized)
                assertEquals(0, activity.sessionController.processSynthetic(FloatArray(256) { 0.02f }))
                assertTrue(activity.sessionController.startSynthetic(42L))
            }

            scenario.moveToState(Lifecycle.State.CREATED)
            scenario.onActivity { activity ->
                assertFalse(activity.sessionController.isAuthorized)
            }
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { activity ->
                assertFalse(activity.sessionController.isAuthorized)
                assertEquals(0, activity.sessionController.processSynthetic(FloatArray(256) { 0.02f }))
            }
        }
    }

}
