package org.hearlens.physicalzero

import android.app.Activity
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    private data class SpeakerRouteSnapshot(
        val speakerId: Int?,
        val status: String,
    )

    companion object {
        private const val MAX_DURATION_MS = 60_000
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val active = AtomicBoolean(false)
    private lateinit var status: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var audioManager: AudioManager
    private var selectedSpeakerId: Int? = null
    @Volatile private var foreground = false
    @Volatile private var activeRunToken = 0L

    private val routeCheck = object : Runnable {
        override fun run() {
            if (!active.get()) return
            val current = builtInSpeakerId()
            if (current == null || current != selectedSpeakerId) {
                status.text = "Built-in speaker route changed or unavailable; stopping."
                NativeBridge.nativeRequestStop(activeRunToken)
            } else {
                mainHandler.postDelayed(this, 250)
            }
        }
    }

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            verifySelectedRoute()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            verifySelectedRoute()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        renderUi()
        refreshRouteLabel()
    }

    override fun onStart() {
        super.onStart()
        foreground = true
        audioManager.registerAudioDeviceCallback(deviceCallback, mainHandler)
    }

    override fun onStop() {
        foreground = false
        if (active.get()) {
            status.text = "App left foreground; requesting stream stop."
            NativeBridge.nativeRequestStop(activeRunToken)
        }
        audioManager.unregisterAudioDeviceCallback(deviceCallback)
        super.onStop()
    }

    override fun onPause() {
        if (active.get()) {
            foreground = false
            status.text = "App paused; requesting stream stop."
            NativeBridge.nativeRequestStop(activeRunToken)
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        refreshRouteLabel()
    }

    override fun onDestroy() {
        foreground = false
        if (active.get()) NativeBridge.nativeRequestStop(activeRunToken)
        worker.shutdown()
        super.onDestroy()
    }

    private fun renderUi() {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(28, 30, 28, 24)
        }
        val title = TextView(this).apply {
            text = "HearLens zero-only AAudio research"
            textSize = 22f
        }
        val explanation = TextView(this).apply {
            text = "Up to ${MAX_DURATION_MS / 1000} seconds. Output buffer is cleared to zero on every callback. " +
                "No DSP, microphone, Bluetooth route, or nonzero PCM content. Device start/stop transients are not measured. " +
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
            text = "Start ${MAX_DURATION_MS / 1000}-second zero-only callback"
            contentDescription = "Start zero-only AAudio test"
            setOnClickListener { startTest() }
        }
        stopButton = Button(this).apply {
            text = "Stop now"
            contentDescription = "Stop zero-only AAudio test"
            isEnabled = false
            setOnClickListener {
                status.text = "Stop requested; draining and closing the stream…"
                NativeBridge.nativeRequestStop(activeRunToken)
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

    private fun builtInSpeakerId(): Int? {
        return inspectSpeakerRoute().speakerId
    }

    private fun inspectSpeakerRoute(): SpeakerRouteSnapshot {
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.isSink }
        val internalOutputTypes = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
        )
        val unexpected = outputs.filter { it.type !in internalOutputTypes }
        if (unexpected.isNotEmpty()) {
            val details = unexpected.joinToString { "type=${it.type},id=${it.id}" }
            return SpeakerRouteSnapshot(null, "Refused: unexpected output sink(s): $details")
        }
        val speakers = outputs.filter { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        val speaker = speakers.singleOrNull()?.takeIf { it.id > 0 }
        if (speaker == null) {
            val ids = speakers.joinToString { it.id.toString() }.ifEmpty { "none" }
            return SpeakerRouteSnapshot(
                null,
                "Refused: expected exactly one built-in speaker; found ${speakers.size} (ids=$ids).",
            )
        }
        return SpeakerRouteSnapshot(speaker.id, "Built-in speaker device id ${speaker.id} is available. The stream is not open.")
    }

    private fun refreshRouteLabel() {
        val route = inspectSpeakerRoute()
        val id = route.speakerId
        selectedSpeakerId = id
        status.text = route.status
        startButton.isEnabled = id != null && !active.get()
    }

    private fun verifySelectedRoute() {
        if (active.get()) {
            val current = builtInSpeakerId()
            if (current == null || current != selectedSpeakerId) {
                status.text = "Built-in speaker route changed or unavailable; stopping."
                NativeBridge.nativeRequestStop(activeRunToken)
            }
        } else {
            refreshRouteLabel()
        }
    }

    private fun startTest() {
        val deviceId = builtInSpeakerId()
        if (deviceId == null || !active.compareAndSet(false, true)) {
            refreshRouteLabel()
            return
        }
        selectedSpeakerId = deviceId
        val runToken = System.nanoTime().coerceAtLeast(1L)
        activeRunToken = runToken
        startButton.isEnabled = false
        stopButton.isEnabled = true
        status.text = "Opening only the selected built-in speaker; maximum 60 seconds."
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        mainHandler.postDelayed(routeCheck, 250)
        worker.execute {
            val reportText = try {
                if (!foreground) {
                    JSONObject().put("status", "NOT_RUN")
                        .put("reason", "activity was backgrounded before stream open")
                        .put("physical_audio_stream_started", false).toString()
                } else {
                    NativeBridge.nativeRunBuiltInSpeaker(deviceId, runToken)
                }
            } catch (error: Throwable) {
                JSONObject().put("status", "APP_ERROR")
                    .put("reason", error.javaClass.simpleName + ": " + error.message)
                    .put("physical_audio_stream_started", false).toString()
            }
            val stamp = java.time.Instant.now().toString().replace(':', '-')
            val resultFile = File(filesDir, "zero-callback-result-$stamp.json")
            val persistedReport = try {
                resultFile.writeText(reportText, Charsets.UTF_8)
                reportText
            } catch (error: Throwable) {
                JSONObject().put("status", "RESULT_PERSISTENCE_ERROR")
                    .put("reason", error.javaClass.simpleName + ": " + error.message)
                    .put("nativeResult", JSONObject(reportText)).toString()
            }
            active.set(false)
            mainHandler.post {
                mainHandler.removeCallbacks(routeCheck)
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                stopButton.isEnabled = false
                startButton.isEnabled = builtInSpeakerId() != null
                status.text = "Run finished: ${JSONObject(persistedReport).optString("status", "UNKNOWN")}\n" +
                    "Private result: ${resultFile.name}"
                if (persistedReport != reportText) {
                    runCatching { resultFile.writeText(persistedReport, Charsets.UTF_8) }
                }
            }
        }
    }
}
