package org.hearlens.micprobe;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioRecordingConfiguration;
import android.media.AudioRouting;
import android.media.AudioTimestamp;
import android.media.MediaRecorder;
import android.media.MicrophoneDirection;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * SW1 deliberately INPUT ONLY. No AudioTrack, MediaPlayer, file PCM or network sink.
 * AudioRecord samples are reduced to periodic non-reconstructive level statistics in RAM.
 */
public final class MainActivity extends Activity {
    private static final int REQUEST_CAPTURE = 1001;
    private static final int RATE = 48000;
    private static final int MAX_EVENTS = 250;
    private static final long MAX_CAPTURE_MS = 30_000L;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final List<String> events = new ArrayList<>();
    private final List<Choice> choices = new ArrayList<>();
    private final SimpleDateFormat time = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US);

    private AudioManager manager;
    private AudioRecord recorder;
    private AudioRouting.OnRoutingChangedListener routingListener;
    private boolean communicationRequested;
    private boolean communicationModeChanged;
    private int priorAudioMode;
    private int requestedSource = MediaRecorder.AudioSource.MIC;
    private int requestedInputId = -1;
    private AudioDeviceInfo selectedInput;
    private Spinner sourcePicker;
    private TextView status;
    private TextView history;
    private TextView hint;
    private TextView outputRouteStatus;
    private Button stopButton;
    private final PassiveRouteAudit outputAudit = new PassiveRouteAudit();
    private long auditSequence;
    private long auditDeadlineMs;
    private boolean beginAuditOnInspect;
    private TextView auditStatus;
    private final Runnable auditPoll = new Runnable() {
        @Override public void run() {
            if (outputAudit.state() != PassiveRouteAudit.State.MONITORING) return;
            if (android.os.SystemClock.elapsedRealtime() >= auditDeadlineMs) {
                outputAudit.finish();
                log("SW3_ROUTE_AUDIT state=COMPLETE samples=" + outputAudit.samples()
                    + "; prediction_window_only=true; physical_output_unverified=true");
                showAuditStatus();
                return;
            }
            inspectOutputRoute("audit-periodic-poll");
            if (outputAudit.state() == PassiveRouteAudit.State.MONITORING) {
                ui.postDelayed(this, 1000L);
            }
        }
    };

    private static final class Choice {
        final int id;
        final String title;
        Choice(int id, String title) { this.id = id; this.title = title; }
        @Override public String toString() { return title; }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        priorAudioMode = manager.getMode();
        buildScreen();
        log("app_open android=" + Build.VERSION.SDK_INT + " device=" + Build.MANUFACTURER + "/" + Build.MODEL);
        log("probe_build=20261013-sw3-native-v0.3.0; predicted_output_only=true; passive_audit=true");
        log("recording_scope=input_only; raw_PCM=discarded; output=DISABLED");
        refreshDevices();
        manager.registerAudioDeviceCallback(deviceCallback, ui);
    }

    private void buildScreen() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 28);
        scroll.addView(root);
        setContentView(scroll);

        TextView title = new TextView(this);
        title.setText("HearLens SW3-Native · v0.3.0");
        title.setTextSize(22);
        root.addView(title);
        TextView buildLabel = new TextView(this);
        buildLabel.setText("2026-10-13 · Route Audit · NO PLAYBACK");
        buildLabel.setTextSize(13);
        root.addView(buildLabel);

        // Visible without scrolling: the primary SW3 action is above the
        // optional legacy SW1 microphone selector/recording controls.
        addButton(root, "檢查媒體輸出預測（完全不播放）", v -> inspectOutputRoute("user-button"));
        outputRouteStatus = new TextView(this);
        outputRouteStatus.setTextSize(15);
        outputRouteStatus.setPadding(0, 10, 0, 8);
        outputRouteStatus.setText("輸出路由：尚未查詢；無實際播放可供驗證。");
        root.addView(outputRouteStatus);
        addButton(root, "開始 30 秒無聲路由監測（僅預測）", v -> startPassiveAudit());
        auditStatus = new TextView(this);
        auditStatus.setTextSize(15);
        auditStatus.setPadding(0, 8, 0, 8);
        root.addView(auditStatus);
        showAuditStatus();

        hint = new TextView(this);
        hint.setText("僅查詢 Android 預計的聲音輸出裝置；不播放、不錄音、不上傳。以下麥克風收音功能僅供其他研究，這次不需要使用。");
        hint.setTextSize(14);
        hint.setPadding(0, 8, 0, 8);
        root.addView(hint);
        sourcePicker = new Spinner(this);
        root.addView(sourcePicker);
        addButton(root, "重新偵測音訊裝置", v -> {
            if (!running.get()) refreshDevices();
            inspectOutputRoute("manual-refresh");
        });
        addButton(root, "開始 — MIC（預設）", v -> startRequest(MediaRecorder.AudioSource.MIC));
        addButton(root, "開始 — UNPROCESSED（要求未處理）", v -> startRequest(MediaRecorder.AudioSource.UNPROCESSED));
        addButton(root, "開始 — VOICE_RECOGNITION", v -> startRequest(MediaRecorder.AudioSource.VOICE_RECOGNITION));
        stopButton = addButton(root, "停止收音", v -> stopCapture("user_stop"));
        addButton(root, "分享診斷 JSON（需自行確認）", v -> shareReport());

        status = new TextView(this);
        status.setTextSize(16);
        status.setPadding(0, 18, 0, 10);
        root.addView(status);
        history = new TextView(this);
        history.setTextSize(12);
        history.setTextIsSelectable(true);
        root.addView(history);
        updateUi();
    }

    private Button addButton(LinearLayout parent, String title, View.OnClickListener fn) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(title);
        button.setOnClickListener(fn);
        parent.addView(button);
        return button;
    }

    private void refreshDevices() {
        if (running.get()) return;
        Choice previous = sourcePicker == null ? null : (Choice) sourcePicker.getSelectedItem();
        int keepInput = previous == null ? -1 : previous.id;
        choices.clear();
        choices.add(new Choice(-1, "系統預設輸入（不強制）"));
        try {
            for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                choices.add(new Choice(device.getId(),
                    typeName(device.getType()) + " #" + device.getId() + " · " + device.getProductName()));
            }
            log("inputs=" + deviceList(manager.getDevices(AudioManager.GET_DEVICES_INPUTS)));
            log("outputs_available_NOT_routed=" + deviceList(manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)));
            if (Build.VERSION.SDK_INT >= 31) {
                log("communication_outputs_available=" + deviceList(
                    manager.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0])));
            }
            log("UNPROCESSED_advertised=" + manager.getProperty(
                AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED));
        } catch (SecurityException error) {
            log("device_enumeration_permission_denied");
        }
        ArrayAdapter<Choice> adapter = new ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, choices);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sourcePicker.setAdapter(adapter);
        for (int i = 0; i < choices.size(); i++) {
            if (choices.get(i).id == keepInput) {
                sourcePicker.setSelection(i);
                break;
            }
        }
    }

    /**
     * SW3-Native passive route observation, with NO playback and NO AudioTrack.
     * Android 13 getAudioDevicesForAttributes() predicts the devices that a
     * future AudioTrack using the supplied attributes may choose.
     * It is NOT the actual routed device of an active output stream.
     */
    private void inspectOutputRoute(String reason) {
        String media = "UNAVAILABLE_API_BELOW_33";
        String accessibility = "UNAVAILABLE_API_BELOW_33";
        AudioDeviceInfo[] mediaDevices = null;
        AudioDeviceInfo[] accessDevices = null;
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                AudioAttributes mediaAttrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                AudioAttributes accessAttrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                mediaDevices = manager.getAudioDevicesForAttributes(mediaAttrs)
                    .toArray(new AudioDeviceInfo[0]);
                accessDevices = manager.getAudioDevicesForAttributes(accessAttrs)
                    .toArray(new AudioDeviceInfo[0]);
                media = deviceList(mediaDevices);
                accessibility = deviceList(accessDevices);
            }
        } catch (RuntimeException error) {
            media = "UNAVAILABLE_" + error.getClass().getSimpleName();
            accessibility = "UNAVAILABLE_" + error.getClass().getSimpleName();
        }
        log("SW3_OUTPUT_PREDICTION reason=" + reason + " API33_USAGEMEDIA_SPEECH=" + media
            + " API33_ACCESSIBILITY_SPEECH=" + accessibility);
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                log("SW3_COMMUNICATION_SELECTED_NOT_MEDIA_ROUTE="
                    + safeDevice(manager.getCommunicationDevice()));
            } catch (RuntimeException error) {
                log("SW3_COMMUNICATION_SELECTED_UNAVAILABLE=" + error.getClass().getSimpleName());
            }
        }
        if (beginAuditOnInspect || outputAudit.state() == PassiveRouteAudit.State.MONITORING) {
            PassiveRouteAudit.Endpoint[] mediaEndpoints = toAuditEndpoints(mediaDevices);
            PassiveRouteAudit.Endpoint[] accessEndpoints = toAuditEndpoints(accessDevices);
            // Audio mode is a limited passive hint, NOT a reliable call/focus state.
            boolean normalMode = manager.getMode() == AudioManager.MODE_NORMAL;
            if (beginAuditOnInspect) {
                outputAudit.begin(++auditSequence, mediaEndpoints, accessEndpoints, normalMode);
            } else {
                outputAudit.observe(++auditSequence, mediaEndpoints, accessEndpoints, normalMode);
            }
            log("SW3_ROUTE_AUDIT reason=" + reason + " state=" + outputAudit.state()
                + " detail=" + outputAudit.detail() + " samples=" + outputAudit.samples()
                + "; current_playback_route=UNKNOWN; playback_authorized="
                + outputAudit.outputAuthorized() + "; focus_state=UNOBSERVED");
            showAuditStatus();
            if (outputAudit.state() != PassiveRouteAudit.State.MONITORING) {
                ui.removeCallbacks(auditPoll);
            }
        }
        log("SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK;"
            + " speaker_fallback_prevention=NOT_VERIFIED;"
            + " bluetooth_codec_latency=NOT_MEASURED;"
            + " true_earbud_wear_state=UNKNOWN");
        if (outputRouteStatus != null) {
            outputRouteStatus.setText("輸出路由預測（不是實際播放）"
                + "\n一般媒體語音：" + media
                + "\n輔助使用語音：" + accessibility
                + "\n實際輸出：未播放，無法驗證；不可據此啟用助聽擴音。");
        }
    }

    private static PassiveRouteAudit.Endpoint[] toAuditEndpoints(AudioDeviceInfo[] info) {
        if (info == null) return null;
        PassiveRouteAudit.Endpoint[] result = new PassiveRouteAudit.Endpoint[info.length];
        for (int i = 0; i < info.length; i++) {
            result[i] = new PassiveRouteAudit.Endpoint(typeName(info[i].getType()),
                info[i].getId());
        }
        return result;
    }

    private void showAuditStatus() {
        if (auditStatus == null) return;
        auditStatus.setText("無聲預測監測：" + outputAudit.state()
            + "（" + outputAudit.samples() + " 次）；" + outputAudit.detail()
            + "\n注意：監測通過也不能授權播放或驗證硬體靜音。");
    }

    private void startPassiveAudit() {
        if (running.get()) {
            log("SW3_ROUTE_AUDIT_START_DENIED microphone_capture_running");
            return;
        }
        ui.removeCallbacks(auditPoll);
        // This is an explicit user-only reset of an OBSERVATION, not an audio safety gate.
        outputAudit.resetByUser();
        beginAuditOnInspect = true;
        try {
            inspectOutputRoute("audit-user-start");
        } finally {
            beginAuditOnInspect = false;
        }
        if (outputAudit.state() == PassiveRouteAudit.State.MONITORING) {
            auditDeadlineMs = android.os.SystemClock.elapsedRealtime() + 30_000L;
            ui.postDelayed(auditPoll, 1000L);
        }
    }

    private void startRequest(int source) {
        if (outputAudit.state() == PassiveRouteAudit.State.MONITORING) {
            outputAudit.interrupt("microphone_probing_started");
            ui.removeCallbacks(auditPoll);
            showAuditStatus();
        }
        if (running.get() || recorder != null) {
            log("start_ignored_capture_active");
            return;
        }
        requestedSource = source;
        Choice chosen = (Choice) sourcePicker.getSelectedItem();
        requestedInputId = chosen == null ? -1 : chosen.id;
        List<String> absent = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            absent.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= 31 &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            absent.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (!absent.isEmpty()) {
            log("permission_request user_initiated");
            requestPermissions(absent.toArray(new String[0]), REQUEST_CAPTURE);
            return;
        }
        beginCapture();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code != REQUEST_CAPTURE) return;
        for (int value : grants) {
            if (value != PackageManager.PERMISSION_GRANTED) {
                log("permission_denied; capture_not_started");
                return;
            }
        }
        if (grants.length != permissions.length) {
            log("permission_incomplete; capture_not_started");
            return;
        }
        refreshDevices();
        beginCapture();
    }

    private AudioDeviceInfo lookupInput(int id) {
        if (id == -1) return null;
        for (AudioDeviceInfo info : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (info.getId() == id) return info;
        }
        return null;
    }

    private static boolean isHeadsetInput(AudioDeviceInfo device) {
        if (device == null) return false;
        return device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            (Build.VERSION.SDK_INT >= 31 && device.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET);
    }

    private AudioDeviceInfo correspondingCommunicationSink(AudioDeviceInfo input) {
        if (Build.VERSION.SDK_INT < 31) return null;
        List<AudioDeviceInfo> possible = new ArrayList<>();
        for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) {
            if (isHeadsetInput(device) && device.isSink()) possible.add(device);
        }
        if (possible.size() == 1) return possible.get(0);
        // When several headsets are present, do not guess which one is paired with the mic.
        for (AudioDeviceInfo candidate : possible) {
            if (candidate.getProductName().toString().equals(input.getProductName().toString())) {
                return candidate;
            }
        }
        return null;
    }

    private void beginCapture() {
        if (running.get() || recorder != null) return;
        selectedInput = lookupInput(requestedInputId);
        if (requestedInputId != -1 && selectedInput == null) {
            log("requested_input_disappeared; refresh_and_retry");
            return;
        }
        try {
            if (isHeadsetInput(selectedInput)) {
                if (Build.VERSION.SDK_INT < 31) {
                    log("headset_probe_needs_API31_communication_device; no legacy_SCO_auto_start");
                    selectedInput = null;
                    return;
                }
                AudioDeviceInfo sink = correspondingCommunicationSink(selectedInput);
                if (sink == null) {
                    log("no_unambiguous_paired_communication_sink; capture_not_started");
                    selectedInput = null;
                    return;
                }
                priorAudioMode = manager.getMode();
                manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                communicationModeChanged = true;
                communicationRequested = manager.setCommunicationDevice(sink);
                log("communication_route_request=" + communicationRequested + " target=" + safeDevice(sink));
                if (!communicationRequested) {
                    restoreCommunication();
                    selectedInput = null;
                    return;
                }
            }

            int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException("unsupported capture format: " + minimum);
            AudioFormat format = new AudioFormat.Builder()
                .setSampleRate(RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
            AudioRecord rec = new AudioRecord.Builder()
                .setAudioSource(requestedSource)
                .setAudioFormat(format)
                .setBufferSizeInBytes(Math.max(minimum * 2, RATE / 5))
                .build();
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                rec.release();
                throw new IllegalStateException("AudioRecord did not initialize");
            }
            if (selectedInput != null) {
                boolean accepted = rec.setPreferredDevice(selectedInput);
                log("preferred_input_request=" + accepted + " " + safeDevice(selectedInput));
                if (!accepted) {
                    rec.release();
                    throw new IllegalStateException("selected device not accepted");
                }
            } else {
                log("preferred_input_request=default");
            }
            if (Build.VERSION.SDK_INT >= 29) {
                boolean direction = rec.setPreferredMicrophoneDirection(
                    MicrophoneDirection.MIC_DIRECTION_UNSPECIFIED);
                log("direction_unspecified_hint_accepted=" + direction);
            }
            routingListener = router -> {
                if (recorder != null) {
                    AudioDeviceInfo observed = recorder.getRoutedDevice();
                    log("route_changed observed=" + safeDevice(observed));
                    if (selectedInput != null &&
                        (observed == null || observed.getId() != selectedInput.getId())) {
                        stopCapture("selected_input_route_changed");
                    }
                }
            };
            rec.addOnRoutingChangedListener(routingListener, ui);
            recorder = rec;
            rec.startRecording();
            if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("recording state did not start");
            }
            running.set(true);
            log("capture_started requested_source=" + sourceName(requestedSource) +
                " client_hz=" + rec.getSampleRate() + " client_channels=" + rec.getChannelCount() +
                " actual_input=" + safeDevice(rec.getRoutedDevice()));
            captureMetadata(rec);
            Thread worker = new Thread(() -> readLevels(rec), "HearLens-SW1-InputOnly");
            worker.start();
        } catch (Exception error) {
            log("capture_start_failed=" + error.getClass().getSimpleName() + ":" + error.getMessage());
            AudioRecord failed = recorder;
            recorder = null;
            if (failed != null) {
                try { failed.release(); } catch (Exception ignored) { }
            }
            running.set(false);
            restoreCommunication();
        }
        updateUi();
    }

    private void captureMetadata(AudioRecord rec) {
        if (Build.VERSION.SDK_INT >= 29) {
            AudioRecordingConfiguration config = rec.getActiveRecordingConfiguration();
            if (config != null) {
                log("recording_config client=" + formatName(config.getClientFormat()) +
                    " device=" + formatName(config.getFormat()) +
                    " effects=" + config.getEffects().size() +
                    " client_effects=" + config.getClientEffects().size() +
                    " silenced=" + config.isClientSilenced());
            } else {
                log("recording_config unavailable");
            }
        }
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                log("active_mic_count=" + rec.getActiveMicrophones().size());
            } catch (IOException | SecurityException e) {
                log("active_mic_info_unavailable=" + e.getClass().getSimpleName());
            }
        }
        log("NOTE: no claim of acoustic_SNR, unprocessed_raw_mic, BT_codec or mic-to-ear_latency");
    }

    private void readLevels(AudioRecord rec) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] buffer = new short[960];
        long started = android.os.SystemClock.elapsedRealtime();
        long windowStart = started;
        long samples = 0, clipped = 0, totalFrames = 0;
        double sumSquares = 0;
        int peak = 0;
        String finishReason = "capture_finished";
        try {
            while (running.get()) {
                int size = rec.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
                if (size <= 0) {
                    // AudioRecord.stop() may unblock READ_BLOCKING with 0.
                    // When Stop was explicitly requested this is expected, not a mic fault.
                    finishReason = running.get() ? "read_error_" + size : "capture_stopped";
                    break;
                }
                totalFrames += size;
                samples += size;
                for (int i = 0; i < size; i++) {
                    int amplitude = Math.abs((int) buffer[i]);
                    if (amplitude > peak) peak = amplitude;
                    if (amplitude >= 32767) clipped++;
                    sumSquares += ((double) amplitude) * amplitude;
                    buffer[i] = 0; // discard each captured PCM sample immediately
                }
                long now = android.os.SystemClock.elapsedRealtime();
                if (manager.getMode() == AudioManager.MODE_IN_CALL ||
                    (Build.VERSION.SDK_INT >= 30 && manager.getMode() == AudioManager.MODE_CALL_SCREENING)) {
                    finishReason = "call_audio_mode";
                    break;
                }
                if (now - windowStart >= 1000) {
                    double rms = samples == 0 ? 0 : Math.sqrt(sumSquares / samples);
                    double dbfs = 20 * Math.log10(Math.max(rms / 32768.0, 1e-9));
                    double peakDbfs = 20 * Math.log10(Math.max(peak / 32768.0, 1e-9));
                    AudioTimestamp timestamp = new AudioTimestamp();
                    int timestampStatus = rec.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC);
                    String route = safeDevice(rec.getRoutedDevice());
                    log(String.format(Locale.US,
                        "level: rms_dBFS=%.1f peak_dBFS=%.1f clipped=%d samples=%d input=%s tsStatus=%d frames=%d",
                        dbfs, peakDbfs, clipped, samples, route, timestampStatus,
                        timestampStatus == AudioRecord.SUCCESS ? timestamp.framePosition : -1));
                    samples = 0;
                    clipped = 0;
                    sumSquares = 0;
                    peak = 0;
                    windowStart = now;
                }
                if (now - started >= MAX_CAPTURE_MS) {
                    finishReason = "30s_auto_stop";
                    break;
                }
                if (selectedInput != null) {
                    AudioDeviceInfo actual = rec.getRoutedDevice();
                    if (actual == null || actual.getId() != selectedInput.getId()) {
                        finishReason = "input_route_mismatch";
                        break;
                    }
                }
            }
        } catch (Exception error) {
            finishReason = "capture_exception_" + error.getClass().getSimpleName();
        } finally {
            running.set(false);
            try { rec.stop(); } catch (Exception ignored) { }
            if (routingListener != null) rec.removeOnRoutingChangedListener(routingListener);
            rec.release();
            final String result = finishReason;
            final long frames = totalFrames;
            ui.post(() -> {
                if (recorder == rec) recorder = null;
                log("capture_end reason=" + result + " pcm_frames_read=" + frames);
                restoreCommunication();
                selectedInput = null;
                updateUi();
                refreshDevices();
            });
        }
    }

    private void stopCapture(String why) {
        if (!running.getAndSet(false)) return;
        log("stop_requested=" + why);
        AudioRecord rec = recorder;
        if (rec != null) {
            try { rec.stop(); } catch (Exception ignored) { }
        }
        updateUi();
    }

    private void restoreCommunication() {
        if (!communicationRequested && !communicationModeChanged) return;
        try {
            if (communicationRequested && Build.VERSION.SDK_INT >= 31) {
                manager.clearCommunicationDevice();
            }
            if (communicationModeChanged) manager.setMode(priorAudioMode);
            log("communication_route_restored; prior_mode=" + priorAudioMode);
        } finally {
            communicationRequested = false;
            communicationModeChanged = false;
        }
    }

    private final AudioDeviceCallback deviceCallback = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            log("devices_added=" + deviceList(added) + "; AVAILABLE is not ACTIVE output");
            if (!running.get()) refreshDevices();
            inspectOutputRoute("devices-added");
        }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            log("devices_removed=" + deviceList(removed));
            if (running.get() && selectedInput != null) {
                for (AudioDeviceInfo device : removed) {
                    if (device.getId() == selectedInput.getId()) {
                        stopCapture("selected_mic_unplugged");
                        break;
                    }
                }
            }
            if (!running.get()) refreshDevices();
            inspectOutputRoute("devices-removed");
        }
    };

    private static String sourceName(int source) {
        if (source == MediaRecorder.AudioSource.UNPROCESSED) return "UNPROCESSED";
        if (source == MediaRecorder.AudioSource.VOICE_RECOGNITION) return "VOICE_RECOGNITION";
        return "MIC";
    }

    private static String typeName(int type) {
        if (type == AudioDeviceInfo.TYPE_BUILTIN_MIC) return "BUILTIN_MIC";
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return "BLUETOOTH_SCO";
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return "BLUETOOTH_A2DP";
        if (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET) return "BLE_HEADSET";
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET) return "WIRED_HEADSET";
        if (type == AudioDeviceInfo.TYPE_USB_DEVICE) return "USB_DEVICE";
        if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return "BUILTIN_SPEAKER";
        return "TYPE_" + type;
    }

    private static String safeDevice(AudioDeviceInfo device) {
        if (device == null) return "null_or_not_active";
        return typeName(device.getType()) + "#" + device.getId();
    }

    private static String deviceList(AudioDeviceInfo[] list) {
        List<String> text = new ArrayList<>();
        for (AudioDeviceInfo item : list) {
            text.add(safeDevice(item) + "(" + item.getProductName() +
                ";sr=" + Arrays.toString(item.getSampleRates()) +
                ";channels=" + Arrays.toString(item.getChannelCounts()) + ")");
        }
        return text.toString();
    }

    private static String formatName(AudioFormat format) {
        if (format == null) return "null";
        return "hz=" + format.getSampleRate() + "/channels=" + format.getChannelCount() +
            "/encoding=" + format.getEncoding();
    }

    private void log(String value) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            ui.post(() -> log(value));
            return;
        }
        String entry = time.format(new Date()) + " " + value;
        events.add(entry);
        if (events.size() > MAX_EVENTS) events.remove(0);
        updateUi();
    }

    private void updateUi() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            ui.post(this::updateUi);
            return;
        }
        if (status == null || history == null) return;
        status.setText(running.get() ? "輸入診斷進行中（無音訊輸出）" : "停止／未收音");
        if (stopButton != null) stopButton.setEnabled(running.get());
        StringBuilder text = new StringBuilder();
        for (int i = Math.max(0, events.size() - 55); i < events.size(); i++) {
            text.append(events.get(i)).append('\n');
        }
        history.setText(text.toString());
    }

    private void shareReport() {
        if (running.get()) {
            log("stop_capture_before_export");
            return;
        }
        try {
            JSONObject report = new JSONObject();
            report.put("schema", "hearlens-sw1-input-probe-v1");
            report.put("onlyMetadata", true);
            report.put("noPCM", true);
            report.put("noOutput", true);
            report.put("androidApi", Build.VERSION.SDK_INT);
            report.put("phoneManufacturer", Build.MANUFACTURER);
            report.put("phoneModel", Build.MODEL);
            JSONArray observations = new JSONArray();
            for (String event : events) observations.put(event);
            report.put("events", observations);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_TEXT, report.toString(2));
            startActivity(Intent.createChooser(send, "自行選擇分享診斷資料"));
        } catch (Exception e) {
            log("metadata_export_error=" + e.getClass().getSimpleName());
        }
    }

    @Override protected void onResume() {
        super.onResume();
        inspectOutputRoute("activity-resumed");
    }

    @Override protected void onPause() {
        outputAudit.interrupt("app_background");
        ui.removeCallbacks(auditPoll);
        showAuditStatus();
        stopCapture("app_left_foreground");
        super.onPause();
    }

    @Override protected void onDestroy() {
        ui.removeCallbacks(auditPoll);
        outputAudit.interrupt("activity_destroyed");
        stopCapture("activity_destroyed");
        manager.unregisterAudioDeviceCallback(deviceCallback);
        super.onDestroy();
    }
}
