package org.hearlens.nativedsplab

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    internal lateinit var sessionController: NativeSessionController
        private set

    private lateinit var report: TextView
    private var nextSyntheticRoute = 42L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionController = lastNonConfigurationInstance as? NativeSessionController
            ?: NativeSessionController()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        val scroll = ScrollView(this).apply { addView(content) }
        report = TextView(this).apply { textSize = 16f }
        content.addView(report, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        addButton(content, "啟動合成 session（不連接音訊）") {
            val started = sessionController.startSynthetic(nextSyntheticRoute)
            show("synthetic_start=$started route_stamp=$nextSyntheticRoute")
        }
        addButton(content, "處理 128 frames 合成 PCM") {
            val result = sessionController.processSynthetic(FloatArray(256) { 0.02f })
            show("synthetic_frames=$result output_sink=none")
        }
        addButton(content, "模擬路由中斷 metadata") {
            nextSyntheticRoute++
            sessionController.syntheticRouteChanged(nextSyntheticRoute)
            show("route_metadata_changed=true; explicit_start_required=true")
        }
        addButton(content, "停止／Reset") {
            sessionController.reset()
            show("reset=true; explicit_start_required=true")
        }
        addButton(content, "執行 Native session fault matrix") {
            report.text = "正在執行合成 Native regression…"
            Thread {
                val result = runCatching { NativeBridge.nativeRunSessionMatrix() }
                    .getOrNull() ?: "FAIL: Native session check failed"
                runOnUiThread { show(result.trim()) }
            }.start()
        }
        setContentView(scroll)
        show()
    }

    override fun onPause() {
        sessionController.stop()
        super.onPause()
        show("lifecycle=paused; session_invalidated=true; auto_resume=false")
    }

    @Suppress("DEPRECATION")
    override fun onRetainNonConfigurationInstance(): Any = sessionController

    override fun onDestroy() {
        if (!isChangingConfigurations) sessionController.close()
        super.onDestroy()
    }

    private fun addButton(parent: LinearLayout, label: String, action: () -> Unit) {
        parent.addView(Button(this).apply {
            text = label
            setOnClickListener { action() }
        }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun show(message: String? = null) {
        if (!::report.isInitialized) return
        val current = message?.let { "$it\n\n" } ?: ""
        val version = runCatching { NativeBridge.nativeVersion() }.getOrElse { "JNI load failed: ${it.message}" }
        report.text = current +
            "HearLens Native DSP Lab — research harness\n" +
            "Native: $version\n" +
            "Session generation: ${sessionController.generation}\n" +
            "Synthetic session authorized: ${sessionController.isAuthorized}\n" +
            "Audio input/output APIs: not present\n" +
            "Physical output authorization: false\n" +
            "M04 AIR31/A2DP real hearing: BLOCKED"
    }
}
