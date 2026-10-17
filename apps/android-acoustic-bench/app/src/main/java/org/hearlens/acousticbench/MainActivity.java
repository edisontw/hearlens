package org.hearlens.acousticbench;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioRouting;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Separate M04-D4 research fixture: non-worn, short, digitally bounded
 * microphone -> A2DP loop. NOT a hearing aid or route isolation guarantee.
 * The existing SW4 input-only probe and caption website remain untouched.
 */
public final class MainActivity extends Activity {
    private static final int RATE = 48000;
    private static final int FRAMES = 480; // 10ms
    private static final int DIGITAL_LIMIT = 384; // about -38.6 dBFS before track volume
    private static final float TRACK_VOLUME = 0.15f;
    private static final int DIGITAL_GAIN = 8; // bounded test signal, not audiogram fitting
    private static final int REQUEST_PERMISSIONS = 417;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final StringBuilder report = new StringBuilder(2048);
    private final AtomicBoolean active = new AtomicBoolean(false);
    private final Object outputLock = new Object();

    private AudioManager manager;
    private AudioFocusRequest focusRequest;
    private AudioTrack playback;
    private AudioRecord capture;
    private Thread worker;
    private AudioDeviceCallback deviceCallback;
    private AudioRouting.OnRoutingChangedListener routeListener;
    private BenchSessionGate gate;
    private int selectedId = -1;
    private long startedAt;
    private long writtenFrames;
    private int droppedWrites;
    private int missedReads;
    private TextView status;
    private CheckBox offEar;
    private CheckBox volumeLow;
    private Button startButton;
    private Button stopButton;
    private boolean focusHeld;
    private boolean runningForeground;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = (int)(16 * getResources().getDisplayMetrics().density);
        root.setPadding(p,p,p,p);
        TextView title = new TextView(this);
        title.setText("HearLens M04-D4｜AIR31 桌面延遲測試");
        title.setTextSize(20);
        root.addView(title);
        TextView warning = new TextView(this);
        warning.setText("僅限非配戴實驗。將 AIR31 放在桌上、遠離耳朵。請先調低 Android 媒體音量，避免麥克風與耳機靠近回授。\n"
            + "Bluetooth 斷線會嘗試立即停止，但已送進系統的聲音仍可能短暫從手機喇叭播出。"
            + " 不存音訊、不上傳、不使用聽力圖增益。最長 40 秒。");
        warning.setTextSize(15);
        root.addView(warning);
        offEar = new CheckBox(this);
        offEar.setText("確認 AIR31 沒有戴在任何人的耳朵上");
        root.addView(offEar);
        volumeLow = new CheckBox(this);
        volumeLow.setText("已調低手機媒體音量，耳機遠離手機麥克風");
        root.addView(volumeLow);
        startButton = new Button(this);
        startButton.setText("開始 40 秒桌面測試");
        root.addView(startButton);
        stopButton = new Button(this);
        stopButton.setText("立即停止");
        root.addView(stopButton);
        Button shareButton = new Button(this);
        shareButton.setText("分享診斷文字（沒有錄音）");
        root.addView(shareButton);
        status = new TextView(this);
        status.setTextIsSelectable(true);
        status.setTextSize(13);
        root.addView(status);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        startButton.setOnClickListener(v -> requestStart());
        stopButton.setOnClickListener(v -> abort("user_pressed_stop"));
        shareButton.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, report.toString());
            startActivity(Intent.createChooser(intent,"分享 M04 測試紀錄"));
        });
        runningForeground = true;
        log("build=m04d4-v0.1.0 target=Moto_g62_Android13 AIR31_A2DP");
        log("audio_output=NOT_CALIBRATED no_physical_speaker_isolation_guarantee=true");
        refreshUi();
    }

    private void requestStart() {
        if (active.get()) return;
        if (!offEar.isChecked() || !volumeLow.isChecked()) {
            log("blocked=off_ear_and_low_volume_confirmation_required");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED ||
            (android.os.Build.VERSION.SDK_INT >= 31 &&
             checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED)) {
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_PERMISSIONS);
            } else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                    REQUEST_PERMISSIONS);
            return;
        }
        startSession();
    }

    @Override public void onRequestPermissionsResult(int requestCode,
            String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_PERMISSIONS) {
            boolean accepted = results.length > 0;
            for (int result: results) accepted &= (result == PackageManager.PERMISSION_GRANTED);
            if (accepted && runningForeground && offEar.isChecked() && volumeLow.isChecked())
                startSession();
            else log("blocked=permissions_denied_or_background");
        }
    }

    private AudioDeviceInfo findUniqueA2dp() {
        AudioDeviceInfo result = null;
        for (AudioDeviceInfo item: manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (item.getType() != AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) continue;
            if (result != null) return null; // no arbitrary device selection
            result = item;
        }
        return result;
    }
    private AudioDeviceInfo findBuiltinMic() {
        for (AudioDeviceInfo item: manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (item.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) return item;
        }
        return null;
    }
    private boolean normalMode() { return manager.getMode() == AudioManager.MODE_NORMAL; }

    private synchronized void startSession() {
        if (active.get() || !runningForeground || !normalMode()) {
            log("blocked=active_background_or_call");
            return;
        }
        final AudioDeviceInfo bt;
        final AudioDeviceInfo mic;
        try {
            bt = findUniqueA2dp();
            mic = findBuiltinMic();
        } catch (SecurityException e) {
            log("blocked=bluetooth_permission");
            return;
        }
        if (bt == null || mic == null) {
            log("blocked=exactly_one_a2dp_and_builtin_mic_required");
            return;
        }
        selectedId = bt.getId();
        startedAt = SystemClock.elapsedRealtime();
        gate = new BenchSessionGate(selectedId,startedAt,
            offEar.isChecked() && volumeLow.isChecked());
        if (!gate.begin(selectedId,startedAt,true)) {
            log("blocked=" + gate.reason());
            return;
        }
        active.set(true);
        writtenFrames = 0;
        droppedWrites = 0;
        missedReads = 0;
        log("start_a2dp_id=" + selectedId + " name=" + bt.getProductName());
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(mediaAttributes())
            .setOnAudioFocusChangeListener(change -> {
                if (change != AudioManager.AUDIOFOCUS_GAIN) abort("audio_focus_interrupted");
            }).build();
        int focus = manager.requestAudioFocus(focusRequest);
        if (focus != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            abort("audio_focus_denied");
            return;
        }
        focusHeld = true;
        deviceCallback = new AudioDeviceCallback() {
            @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] gone) {
                for (AudioDeviceInfo dev: gone)
                    if (dev.getId()==selectedId) { abort("a2dp_disconnected"); break; }
            }
        };
        manager.registerAudioDeviceCallback(deviceCallback,ui);
        worker = new Thread(() -> runAudioLoop(bt,mic),"M04-OffEar-Audio");
        worker.start();
        ui.postDelayed(this::monitor,100);
        refreshUi();
    }

    private AudioAttributes mediaAttributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }
    private static AudioFormat inputFormat() {
        return new AudioFormat.Builder().setSampleRate(RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
    }
    private static AudioFormat outputFormat() {
        return new AudioFormat.Builder().setSampleRate(RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
    }

    private void runAudioLoop(AudioDeviceInfo bt,AudioDeviceInfo mic) {
        AudioTrack track = null;
        AudioRecord record = null;
        try {
            int minOut = AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_STEREO,
                    AudioFormat.ENCODING_PCM_16BIT);
            int minIn = AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if (minOut <= 0 || minIn <= 0) throw new IllegalStateException("unsupported_pcm_format");
            track = new AudioTrack.Builder().setAudioAttributes(mediaAttributes())
                    .setAudioFormat(outputFormat()).setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(Math.max(minOut,FRAMES*4*4)).build();
            if (track.getState()!=AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("track_init");
            if (!track.setPreferredDevice(bt)) throw new IllegalStateException("output_preference_rejected");
            record = new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(inputFormat())
                    .setBufferSizeInBytes(Math.max(minIn,FRAMES*2*4)).build();
            if (record.getState()!=AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("record_init");
            if (!record.setPreferredDevice(mic))
                throw new IllegalStateException("phone_mic_preference_rejected");
            synchronized(outputLock) {
                if (!active.get()) return;
                playback = track;
                capture = record;
                track.setVolume(0f); // silent before routed output proven
                track.play();
            }
            final short[] silence = new short[FRAMES*2];
            int stable = 0;
            long routeStart = SystemClock.elapsedRealtime();
            while (active.get() && stable < 3 && SystemClock.elapsedRealtime()-routeStart < 1200) {
                track.write(silence,0,silence.length,AudioTrack.WRITE_NON_BLOCKING);
                AudioDeviceInfo routed = track.getRoutedDevice();
                if (routed != null) {
                    if (routed.getType()!=AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                        routed.getId()!=selectedId)
                        throw new IllegalStateException("silent_route_not_air31");
                    stable++;
                }
                SystemClock.sleep(35);
            }
            if (!active.get() || stable < 3) throw new IllegalStateException("silent_route_unknown");
            record.startRecording();
            if (record.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)
                throw new IllegalStateException("record_not_started");
            AudioDeviceInfo input = record.getRoutedDevice();
            if (input==null || input.getType()!=AudioDeviceInfo.TYPE_BUILTIN_MIC)
                throw new IllegalStateException("not_builtin_mic");
            if (!gate.check(selectedId,true,true,focusHeld,SystemClock.elapsedRealtime()))
                throw new IllegalStateException("pre_output_gate_fault");
            track.setVolume(TRACK_VOLUME);
            log("active_route=A2DP#" + selectedId + " input=BUILTIN_MIC#" + input.getId()
                + " gain=" + DIGITAL_GAIN + " cap_pcm16=" + DIGITAL_LIMIT
                + " track_volume=" + TRACK_VOLUME);
            routeListener = routing -> checkActualRoutes();
            track.addOnRoutingChangedListener(routeListener,ui);
            short[] in = new short[FRAMES];
            short[] out = new short[FRAMES*2];
            long lastInput = SystemClock.elapsedRealtime();
            while (active.get()) {
                long now = SystemClock.elapsedRealtime();
                if (!gate.tick(now) || !normalMode() ||
                    now-lastInput > 800) {
                    abort("timeout_call_or_mic_watchdog");
                    break;
                }
                AudioDeviceInfo output = track.getRoutedDevice();
                AudioDeviceInfo source = record.getRoutedDevice();
                boolean exact = output!=null && output.getId()==selectedId &&
                    output.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_A2DP;
                boolean builtIn = source!=null && source.getType()==AudioDeviceInfo.TYPE_BUILTIN_MIC;
                if (!gate.check(output==null?-1:output.getId(),exact,builtIn,
                        focusHeld,now)) {
                    abort(gate.reason()); break;
                }
                int n = record.read(in,0,in.length,AudioRecord.READ_NON_BLOCKING);
                if (n < 0) { abort("mic_read_error_" + n); break; }
                if (n==0) { missedReads++; SystemClock.sleep(2); continue; }
                lastInput = now;
                for (int i=0;i<n;i++) {
                    int sample = in[i]*DIGITAL_GAIN;
                    sample = Math.max(-DIGITAL_LIMIT,Math.min(DIGITAL_LIMIT,sample));
                    float ramp = Math.min(1f,writtenFrames/(float)RATE);
                    short v = (short)Math.round(sample*ramp);
                    out[2*i]=v;
                    out[2*i+1]=v;
                    in[i]=0;
                }
                if (!active.get()) break;
                int done = track.write(out,0,n*2,AudioTrack.WRITE_NON_BLOCKING);
                if (done<0) { abort("output_write_error_" + done); break; }
                if (done<n*2) droppedWrites++;
                java.util.Arrays.fill(out,(short)0);
                writtenFrames+=n;
            }
        } catch (SecurityException e) {
            abort("permission_revoked");
        } catch (Exception e) {
            abort("audio_error_" + e.getClass().getSimpleName()
                + "_" + (e.getMessage()==null?"unknown":e.getMessage()));
        } finally {
            if (track != null) {
                try { track.setVolume(0f); } catch(Exception ignored){}
                try { if(routeListener!=null)track.removeOnRoutingChangedListener(routeListener); }
                catch(Exception ignored){}
                try { track.pause(); track.flush(); track.stop(); } catch(Exception ignored){}
                try {track.release();} catch(Exception ignored){}
            }
            if (record != null) {
                try {record.stop();} catch(Exception ignored){}
                try {record.release();} catch(Exception ignored){}
            }
            synchronized(outputLock) { playback=null;capture=null; }
            if(active.get()) abort("audio_loop_ended");
        }
    }

    private void checkActualRoutes() {
        if(!active.get())return;
        AudioTrack t=playback;
        if(t==null)return;
        AudioDeviceInfo dev=t.getRoutedDevice();
        if(dev==null || dev.getType()!=AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                dev.getId()!=selectedId) abort("route_changed");
    }
    private void monitor() {
        if(!active.get())return;
        if (!runningForeground || !normalMode()) {
            abort("background_or_phone_call"); return;
        }
        if(gate == null || !gate.tick(SystemClock.elapsedRealtime())) {
            abort("timer_ended");return;
        }
        checkActualRoutes();
        if(active.get())ui.postDelayed(this::monitor,100);
    }
    private void abort(String why) {
        if(!active.compareAndSet(true,false))return;
        if(gate!=null) gate.stop(why);
        synchronized(outputLock) {
            if(playback!=null){
                try {playback.setVolume(0f);}catch(Exception ignored){}
                try {playback.pause();playback.flush();playback.stop();}catch(Exception ignored){}
            }
            if(capture!=null)try {capture.stop();}catch(Exception ignored){}
        }
        if(deviceCallback!=null){
            try {manager.unregisterAudioDeviceCallback(deviceCallback);}catch(Exception ignored){}
            deviceCallback=null;
        }
        if(focusHeld && focusRequest!=null){
            manager.abandonAudioFocusRequest(focusRequest);
            focusHeld=false;
        }
        log("stop=" + why + " elapsed_ms=" + (SystemClock.elapsedRealtime()-startedAt)
            + " mic_frames=" + writtenFrames + " dropped_writes=" + droppedWrites
            + " no_audio_file=true speaker_zero_leak_not_proven=true");
    }
    private void log(String line) {
        String timestamp = String.format(Locale.US,"%d",SystemClock.elapsedRealtime());
        synchronized(report){report.append(timestamp).append(" ").append(line).append("\n");}
        ui.post(this::refreshUi);
    }
    private void refreshUi() {
        if(status==null)return;
        status.setText(report.toString());
        startButton.setEnabled(!active.get());
        stopButton.setEnabled(active.get());
    }
    @Override public void onPause() {
        runningForeground=false;
        abort("app_left_foreground");
        super.onPause();
    }
    @Override public void onResume() {super.onResume();runningForeground=true;}
    @Override public void onDestroy() {abort("activity_destroyed");super.onDestroy();}
}
