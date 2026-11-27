package org.hearlens.physicaldsp

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class MainActivity : Activity() {
    private data class RouteCapture(
        val snapshot: RouteSnapshot,
        val fingerprint: String,
    )

    companion object {
        private const val MAX_DURATION_MS = 60_000
        private const val ROUTE_POLL_INTERVAL_MS = 100L
        private const val MAX_ROUTE_EVENTS = 256
        private const val STOP_REASON_NONE = 0
        private const val STOP_REASON_USER = 1
        private const val STOP_REASON_ROUTE_POLICY = 2
        private const val STOP_REASON_LIFECYCLE = 3
        private val NEXT_RUN_TOKEN = AtomicLong(System.nanoTime().coerceAtLeast(1L))
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val routeThread = HandlerThread("dsp-shadow-route-control").apply { start() }
    private val routeHandler = Handler(routeThread.looper)
    private val routeExecutor = Executor { command -> routeHandler.post(command) }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val active = AtomicBoolean(false)
    private val routeInvalidationRequested = AtomicBoolean(false)
    private val routeGeneration = AtomicLong(1L)
    private val routeMonitorPollCount = AtomicLong(0L)
    private val routeEvents = CopyOnWriteArrayList<JSONObject>()
    private val routeStateLock = Any()
    private lateinit var status: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var audioManager: AudioManager
    @Volatile private var selectedSpeakerId: Int? = null
    @Volatile private var foreground = false
    @Volatile private var activeRunToken = 0L
    @Volatile private var activeRouteContext: RouteRunContext? = null
    @Volatile private var activeRouteFingerprint: String? = null
    @Volatile private var lastRouteFingerprint: String? = null
    @Volatile private var latestRouteCapture: RouteCapture? = null
    @Volatile private var routeObserversReady = false
    private var deviceCallbackRegistered = false
    private var modeListenerRegistered = false
    private var modeListenerHandle: Any? = null
    @Volatile private var lastObservedAudioMode: Int? = null
    private val mediaAttributes: AudioAttributes by lazy {
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
    }

    private val routeMonitor = object : Runnable {
        override fun run() {
            val context = activeRouteContext
            if (!active.get() || context == null) return
            routeMonitorPollCount.incrementAndGet()
            captureAndObserve("periodic_route_poll")
            if (active.get() && activeRouteContext?.runToken == context.runToken) {
                routeHandler.postDelayed(this, ROUTE_POLL_INTERVAL_MS)
            }
        }
    }

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            onDeviceInventoryChanged("audio device added: ${describeDevices(addedDevices)}")
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            onDeviceInventoryChanged("audio device removed: ${describeDevices(removedDevices)}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        renderUi()
        refreshRouteLabel("activity_created")
    }

    override fun onStart() {
        super.onStart()
        foreground = true
        routeObserversReady = false
        try {
            audioManager.registerAudioDeviceCallback(deviceCallback, routeHandler)
            deviceCallbackRegistered = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                modeListenerHandle = AudioModeChangedListenerApi31.register(
                    audioManager,
                    routeExecutor,
                    ::onAudioModeChanged,
                )
                modeListenerRegistered = true
            }
            routeObserversReady = Build.VERSION.SDK_INT >= 33 && modeListenerRegistered
        } catch (error: Throwable) {
            recordRouteEvent("route_observer_registration_failed", error.javaClass.simpleName, latestRouteCapture)
            if (deviceCallbackRegistered) {
                runCatching { audioManager.unregisterAudioDeviceCallback(deviceCallback) }
                deviceCallbackRegistered = false
            }
            if (modeListenerRegistered && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                runCatching {
                    AudioModeChangedListenerApi31.unregister(audioManager, modeListenerHandle)
                }
                modeListenerHandle = null
                modeListenerRegistered = false
            }
        }
        routeHandler.post {
            val capture = captureAndObserve("route_observers_started")
            mainHandler.post { updateRouteUi(capture) }
        }
    }

    override fun onStop() {
        foreground = false
        activeRouteContext?.let { context ->
            invalidateActiveRun(
                context,
                STOP_REASON_LIFECYCLE,
                "activity left foreground",
                latestRouteCapture,
            )
        }
        routeHandler.removeCallbacks(routeMonitor)
        if (deviceCallbackRegistered) {
            audioManager.unregisterAudioDeviceCallback(deviceCallback)
            deviceCallbackRegistered = false
        }
        if (modeListenerRegistered && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioModeChangedListenerApi31.unregister(audioManager, modeListenerHandle)
            modeListenerHandle = null
            modeListenerRegistered = false
        }
        routeObserversReady = false
        super.onStop()
    }

    override fun onPause() {
        if (active.get()) {
            foreground = false
            activeRouteContext?.let { context ->
                invalidateActiveRun(
                    context,
                    STOP_REASON_LIFECYCLE,
                    "activity paused",
                    latestRouteCapture,
                )
            }
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        refreshRouteLabel("activity_resumed")
    }

    override fun onDestroy() {
        foreground = false
        activeRouteContext?.let { context ->
            invalidateActiveRun(
                context,
                STOP_REASON_LIFECYCLE,
                "activity destroyed",
                latestRouteCapture,
            )
        }
        routeHandler.removeCallbacksAndMessages(null)
        worker.shutdown()
        routeThread.quitSafely()
        super.onDestroy()
    }

    private fun renderUi() {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(28, 30, 28, 24)
        }
        val title = TextView(this).apply {
            text = "HearLens physical DSP-shadow callback research"
            textSize = 22f
        }
        val explanation = TextView(this).apply {
            text = "Up to ${MAX_DURATION_MS / 1000} seconds. Output buffer is cleared to zero on every callback. " +
                "Synthetic Auto-FIR/NativeSession output stays private and is discarded. No microphone, Bluetooth, " +
                "external route, nonzero output, or hearing function is used. Device start/stop transients are not measured. " +
                "The route monitor checks Android policy and the AAudio device ID; this is not a hardware-route guarantee. " +
                "Start only for the approved test."
            textSize = 16f
            setPadding(0, 18, 0, 18)
        }
        status = TextView(this).apply {
            textSize = 15f
            text = "Checking built-in speaker…"
            contentDescription = "Physical test status"
        }
        startButton = Button(this).apply {
            text = "Start ${MAX_DURATION_MS / 1000}-second DSP-shadow zero-output callback"
            contentDescription = "Start DSP-shadow AAudio test"
            isEnabled = false
            setOnClickListener { startTest() }
        }
        stopButton = Button(this).apply {
            text = "Stop now"
            contentDescription = "Stop DSP-shadow AAudio test"
            isEnabled = false
            setOnClickListener {
                status.text = "Stop requested; draining and closing the stream…"
                NativeBridge.nativeRequestStop(activeRunToken, STOP_REASON_USER)
                stopButton.isEnabled = false
            }
        }
        column.addView(title)
        column.addView(explanation)
        column.addView(status)
        column.addView(startButton)
        column.addView(stopButton)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    private fun captureSnapshot(): RouteSnapshot {
        val errors = mutableListOf<String>()
        val modeBefore = try {
            audioManager.mode
        } catch (error: Throwable) {
            errors += "mode_before:${error.javaClass.simpleName}"
            null
        }
        val inventory = try {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .filter { it.isSink }
                .map(::toRouteDeviceSnapshot)
        } catch (error: Throwable) {
            errors += "inventory:${error.javaClass.simpleName}"
            null
        }
        val predicted = if (Build.VERSION.SDK_INT >= 33) {
            try {
                audioManager.getAudioDevicesForAttributes(mediaAttributes)
                    .map(::toRouteDeviceSnapshot)
            } catch (error: Throwable) {
                errors += "MEDIA_prediction:${error.javaClass.simpleName}"
                null
            }
        } else {
            errors += "MEDIA_prediction_requires_API_33"
            null
        }
        val modeAfter = try {
            audioManager.mode
        } catch (error: Throwable) {
            errors += "mode_after:${error.javaClass.simpleName}"
            null
        }
        return RouteSnapshot(
            generation = routeGeneration.get(),
            audioModeBeforeQueries = modeBefore,
            audioModeAfterQueries = modeAfter,
            outputInventory = inventory,
            mediaPredictedRoute = predicted,
            queryError = errors.takeIf { it.isNotEmpty() }?.joinToString(","),
        )
    }

    private fun toRouteDeviceSnapshot(device: AudioDeviceInfo): RouteDeviceSnapshot {
        val kind = when (device.type) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> RouteDeviceKind.BUILTIN_SPEAKER
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> RouteDeviceKind.BUILTIN_EARPIECE
            AudioDeviceInfo.TYPE_TELEPHONY -> RouteDeviceKind.TELEPHONY
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_BLE_BROADCAST -> RouteDeviceKind.BLUETOOTH
            AudioDeviceInfo.TYPE_USB_ACCESSORY,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET -> RouteDeviceKind.USB
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> RouteDeviceKind.WIRED
            AudioDeviceInfo.TYPE_UNKNOWN -> RouteDeviceKind.UNKNOWN
            else -> RouteDeviceKind.OTHER
        }
        return RouteDeviceSnapshot(device.id, kind)
    }

    private fun routeFingerprint(snapshot: RouteSnapshot): String {
        fun devices(value: List<RouteDeviceSnapshot>?): String = value
            ?.sortedWith(compareBy<RouteDeviceSnapshot> { it.id }.thenBy { it.kind.name })
            ?.joinToString(",") { "${it.id}:${it.kind.name}" }
            ?: "QUERY_UNAVAILABLE"
        return listOf(
            snapshot.audioModeBeforeQueries?.toString() ?: "MODE_UNAVAILABLE",
            snapshot.audioModeAfterQueries?.toString() ?: "MODE_UNAVAILABLE",
            devices(snapshot.outputInventory),
            devices(snapshot.mediaPredictedRoute),
            snapshot.queryError ?: "NO_QUERY_ERROR",
        ).joinToString("|")
    }

    private fun captureAndObserve(source: String): RouteCapture {
        val raw = captureSnapshot()
        val fingerprint = routeFingerprint(raw)
        var changed = false
        val context: RouteRunContext?
        val snapshot: RouteSnapshot
        synchronized(routeStateLock) {
            val previous = lastRouteFingerprint
            if (previous != null && previous != fingerprint) {
                routeGeneration.incrementAndGet()
                changed = true
            }
            lastRouteFingerprint = fingerprint
            snapshot = raw.copy(generation = routeGeneration.get())
            context = activeRouteContext
        }
        val capture = RouteCapture(snapshot, fingerprint)
        latestRouteCapture = capture
        if (changed) recordRouteEvent("route_snapshot_changed", source, capture)

        if (active.get() && context != null) {
            val decision = PhysicalSpeakerRoutePolicy.evaluate(
                snapshot,
                expected = context,
                currentRunToken = activeRunToken,
            )
            val baselineChanged = fingerprint != activeRouteFingerprint
            if (!decision.allowed || baselineChanged) {
                invalidateActiveRun(
                    context,
                    STOP_REASON_ROUTE_POLICY,
                    if (baselineChanged) "route snapshot changed during the run" else decision.reason,
                    capture,
                )
            } else {
                NativeBridge.nativePublishRouteSnapshot(
                    context.runToken,
                    snapshot.generation,
                    decision.speakerId ?: -1,
                    true,
                    STOP_REASON_NONE,
                )
            }
        }
        if (source == "activity_created" || source == "activity_resumed" ||
            source == "route_observers_started" || source == "pre_open_final_check" ||
            source == "run_complete") {
            recordRouteEvent("route_snapshot", source, capture)
        }
        return capture
    }

    private fun onDeviceInventoryChanged(event: String) {
        val context = activeRouteContext
        val capture = captureAndObserve("audio_device_callback")
        if (active.get() && context != null) {
            invalidateActiveRun(context, STOP_REASON_ROUTE_POLICY, event, capture)
        } else {
            mainHandler.post { updateRouteUi(capture) }
        }
    }

    private fun refreshRouteLabel(source: String) {
        val capture = captureAndObserve(source)
        updateRouteUi(capture)
    }

    private fun updateRouteUi(capture: RouteCapture) {
        val decision = PhysicalSpeakerRoutePolicy.evaluate(capture.snapshot)
        selectedSpeakerId = decision.speakerId
        status.text = if (decision.allowed) {
            "${decision.reason}. Speaker ID ${decision.speakerId}; stream is not open."
        } else {
            "Refused: ${decision.reason}. Stream is not open."
        }
        startButton.isEnabled = decision.allowed && !active.get() &&
            activeRouteContext == null && routeObserversReady
    }

    private fun startTest() {
        if (!routeObserversReady || Build.VERSION.SDK_INT < 33) {
            refreshRouteLabel("start_refused_observers_unavailable")
            status.text = "Refused: API 33 route prediction and mode listener are required."
            return
        }
        val initialCapture = captureAndObserve("start_button_gate")
        val initialDecision = PhysicalSpeakerRoutePolicy.evaluate(initialCapture.snapshot)
        val deviceId = initialDecision.speakerId
        if (!initialDecision.allowed || deviceId == null || !foreground ||
            !active.compareAndSet(false, true)) {
            updateRouteUi(initialCapture)
            return
        }

        routeEvents.clear()
        routeInvalidationRequested.set(false)
        routeMonitorPollCount.set(0L)
        val runToken = NEXT_RUN_TOKEN.incrementAndGet().coerceAtLeast(1L)
        val context = RouteRunContext(
            runToken = runToken,
            routeGeneration = initialCapture.snapshot.generation,
            speakerId = deviceId,
        )
        activeRunToken = runToken
        activeRouteContext = context
        activeRouteFingerprint = initialCapture.fingerprint
        lastObservedAudioMode = initialCapture.snapshot.audioModeAfterQueries
        NativeBridge.nativePublishRouteSnapshot(
            runToken,
            context.routeGeneration,
            deviceId,
            true,
            STOP_REASON_NONE,
        )
        recordRouteEvent("run_baseline", "DSP_SHADOW built-in speaker", initialCapture)
        startButton.isEnabled = false
        stopButton.isEnabled = true
        status.text = "Final route/generation check pending; maximum 60 seconds."
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        routeHandler.removeCallbacks(routeMonitor)
        routeHandler.post(routeMonitor)

        worker.execute {
            val reportText = try {
                val finalCapture = captureAndObserve("pre_open_final_check")
                val finalDecision = PhysicalSpeakerRoutePolicy.evaluate(
                    finalCapture.snapshot,
                    expected = context,
                    currentRunToken = activeRunToken,
                )
                when {
                    !foreground -> {
                        invalidateActiveRun(context, STOP_REASON_LIFECYCLE, "backgrounded before AAudio open", finalCapture)
                        notRunReport("lifecycle invalidation before AAudio open")
                    }
                    !finalDecision.allowed || routeInvalidationRequested.get() ||
                        finalCapture.fingerprint != activeRouteFingerprint -> {
                        invalidateActiveRun(context, STOP_REASON_ROUTE_POLICY, finalDecision.reason, finalCapture)
                        notRunReport("route or generation rejected by final pre-open check")
                    }
                    else -> {
                        NativeBridge.nativePublishRouteSnapshot(
                            runToken,
                            context.routeGeneration,
                            deviceId,
                            true,
                            STOP_REASON_NONE,
                        )
                        val fixture = assets.open("portable-fixture/auto-fir-fixture.bin")
                            .use { it.readBytes() }
                        NativeBridge.nativeRunDspShadow(
                            fixture,
                            deviceId,
                            runToken,
                            context.routeGeneration,
                        )
                    }
                }
            } catch (error: Throwable) {
                JSONObject().put("status", "APP_ERROR")
                    .put("reason", error.javaClass.simpleName + ": " + error.message)
                    .put("physical_audio_stream_started", false).toString()
            }

            active.set(false)
            routeHandler.removeCallbacks(routeMonitor)
            val finalCapture = runCatching { captureAndObserve("run_complete") }
                .getOrElse { latestRouteCapture }
            synchronized(routeStateLock) {
                if (activeRouteContext?.runToken == runToken) {
                    activeRouteContext = null
                    activeRouteFingerprint = null
                }
            }
            val persistedReport = attachRouteEvidence(reportText, context, finalCapture)
            val stamp = Instant.now().toString().replace(':', '-')
            val resultFile = File(filesDir, "dsp-shadow-callback-result-$stamp.json")
            val finalText = try {
                resultFile.writeText(persistedReport, Charsets.UTF_8)
                persistedReport
            } catch (error: Throwable) {
                JSONObject().put("status", "RESULT_PERSISTENCE_ERROR")
                    .put("reason", error.javaClass.simpleName + ": " + error.message)
                    .put("nativeResult", runCatching { JSONObject(reportText) }.getOrNull())
                    .put("routeEvidence", routeEvidenceJson(context, finalCapture))
                    .toString(2)
            }
            mainHandler.post {
                if (activeRouteContext != null && activeRouteContext?.runToken != runToken) return@post
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                stopButton.isEnabled = false
                val finalDecision = finalCapture?.let { PhysicalSpeakerRoutePolicy.evaluate(it.snapshot) }
                selectedSpeakerId = finalDecision?.speakerId
                startButton.isEnabled = routeObserversReady && !active.get() &&
                    activeRouteContext == null && finalDecision?.allowed == true
                status.text = "Run finished: ${JSONObject(finalText).optString("status", "UNKNOWN")}\n" +
                    "Private result: ${resultFile.name}"
            }
        }
    }

    private fun invalidateActiveRun(
        context: RouteRunContext,
        reasonCode: Int,
        reason: String,
        capture: RouteCapture?,
    ) {
        if (!active.get() || activeRouteContext?.runToken != context.runToken) return
        if (!routeInvalidationRequested.compareAndSet(false, true)) return
        val invalidGeneration = routeGeneration.incrementAndGet()
        NativeBridge.nativePublishRouteSnapshot(
            context.runToken,
            invalidGeneration,
            context.speakerId,
            false,
            reasonCode,
        )
        NativeBridge.nativeRequestStop(context.runToken, reasonCode)
        recordRouteEvent("fail_stop_requested", reason, capture)
        mainHandler.post {
            status.text = "Fail-stop requested: $reason; draining and closing."
            stopButton.isEnabled = false
        }
    }

    private fun notRunReport(reason: String): String = JSONObject()
        .put("status", "NOT_RUN")
        .put("reason", reason)
        .put("physical_audio_stream_started", false)
        .toString()

    private fun attachRouteEvidence(
        reportText: String,
        context: RouteRunContext,
        finalCapture: RouteCapture?,
    ): String = runCatching {
        JSONObject(reportText)
            .put("route_policy_scope", "STANDALONE_PHYSICAL_DSP_SHADOW_APK")
            .put("route_policy_generation", context.routeGeneration)
            .put("route_policy_monitor", "AudioManager inventory + API 33 MEDIA prediction + mode listener/poll + AAudio device ID control-thread polling")
            .put("route_policy_poll_count", routeMonitorPollCount.get())
            .put("route_policy_hardware_guarantee", false)
            .put("route_policy_final_snapshot", finalCapture?.let(::snapshotJson) ?: JSONObject.NULL)
            .put("route_policy_events", JSONArray().apply { routeEvents.forEach { put(JSONObject(it.toString())) } })
            .toString(2)
    }.getOrElse {
        JSONObject().put("status", "ROUTE_EVIDENCE_SERIALIZATION_ERROR")
            .put("reason", it.javaClass.simpleName + ": " + it.message)
            .put("nativeResult", runCatching { JSONObject(reportText) }.getOrNull())
            .put("routeEvidence", routeEvidenceJson(context, finalCapture))
            .toString(2)
    }

    private fun routeEvidenceJson(context: RouteRunContext, capture: RouteCapture?): JSONObject = JSONObject()
        .put("routePolicyScope", "STANDALONE_PHYSICAL_DSP_SHADOW_APK")
        .put("routeGeneration", context.routeGeneration)
        .put("monitorPollCount", routeMonitorPollCount.get())
        .put("hardwareRouteGuarantee", false)
        .put("finalSnapshot", capture?.let(::snapshotJson) ?: JSONObject.NULL)
        .put("events", JSONArray().apply { routeEvents.forEach { put(JSONObject(it.toString())) } })

    private fun snapshotJson(capture: RouteCapture): JSONObject {
        fun array(devices: List<RouteDeviceSnapshot>?): JSONArray = JSONArray().apply {
            devices?.forEach { put(JSONObject().put("id", it.id).put("kind", it.kind.name)) }
        }
        return JSONObject()
            .put("generation", capture.snapshot.generation)
            .put("audioModeBeforeQueries", capture.snapshot.audioModeBeforeQueries ?: JSONObject.NULL)
            .put("audioModeAfterQueries", capture.snapshot.audioModeAfterQueries ?: JSONObject.NULL)
            .put("outputInventory", capture.snapshot.outputInventory?.let(::array) ?: JSONObject.NULL)
            .put("mediaPredictedRoute", capture.snapshot.mediaPredictedRoute?.let(::array) ?: JSONObject.NULL)
            .put("queryError", capture.snapshot.queryError ?: JSONObject.NULL)
            .put("fingerprint", capture.fingerprint)
            .put("telephonyInventoryOnly", capture.snapshot.outputInventory
                ?.any { it.kind == RouteDeviceKind.TELEPHONY } == true)
    }

    private fun recordRouteEvent(type: String, reason: String, capture: RouteCapture?) {
        val event = JSONObject()
            .put("elapsedRealtimeNanos", SystemClock.elapsedRealtimeNanos())
            .put("wallClockUtc", Instant.now().toString())
            .put("event", type)
            .put("reason", reason)
            .put("snapshot", capture?.let(::snapshotJson) ?: JSONObject.NULL)
        routeEvents += event
        while (routeEvents.size > MAX_ROUTE_EVENTS) routeEvents.removeAt(0)
    }

    private fun describeDevices(devices: Array<out AudioDeviceInfo>): String =
        devices.joinToString { "type=${it.type},id=${it.id},sink=${it.isSink}" }.ifEmpty { "none" }

    private fun onAudioModeChanged(mode: Int) {
        val capture = captureAndObserve("audio_mode_changed_listener")
        val context = activeRouteContext
        if (active.get() && context != null) {
            recordRouteEvent("audio_mode_changed", "newMode=$mode", capture)
            if (mode != AudioManager.MODE_NORMAL || lastObservedAudioMode != mode) {
                invalidateActiveRun(
                    context,
                    STOP_REASON_ROUTE_POLICY,
                    "AudioManager mode changed during the run (mode=$mode)",
                    capture,
                )
            }
        }
        lastObservedAudioMode = mode
    }
}
