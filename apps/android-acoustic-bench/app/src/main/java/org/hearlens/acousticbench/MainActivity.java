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
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Separate M04-D5/M04-D6 research fixture: non-worn, digitally bounded
 * microphone loop OR independent known-chirp A2DP self-test.
 * NOT a hearing aid or route isolation guarantee.
 * The existing SW4 input-only probe and caption website remain untouched.
 */
public final class MainActivity extends Activity {
    private static final int RATE = 48000;
    private static final int FRAMES = 480; // 10ms
    private static final int REQUEST_PERMISSIONS = 417;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final StringBuilder report = new StringBuilder(2048);
    private final AtomicBoolean active = new AtomicBoolean(false);
    private final Object outputLock = new Object();

    private AudioManager manager;
    private AudioFocusRequest focusRequest;
    private volatile AudioTrack playback;
    private volatile AudioRecord capture;
    private Thread worker;
    private AudioDeviceCallback deviceCallback;
    private AudioRouting.OnRoutingChangedListener routeListener;
    private BenchSessionGate gate;
    private volatile int selectedId = -1;
    private long startedAt;
    private long writtenFrames;
    private int droppedWrites;
    private int missedReads;
    private volatile long playbackSubmittedFrames;
    private volatile long playbackHeadFrames;
    private volatile long playbackPrimingFrames;
    private volatile int writeZeroCount;
    private volatile int writePartialCount;
    private volatile boolean drainConfirmed;
    private TextView status;
    private CheckBox offEar;
    private CheckBox volumeLow;
    private RadioGroup outputLevels;
    private RadioGroup testModes;
    private volatile boolean selfTestActive;
    private volatile String lastActualRoute = "not_observed";
    private volatile BenchOutputProfile currentProfile;
    private Button startButton;
    private Button stopButton;
    private volatile boolean focusHeld;
    private volatile boolean runningForeground;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = (int)(16 * getResources().getDisplayMetrics().density);
        root.setPadding(p,p,p,p);
        TextView title = new TextView(this);
        title.setText("HearLens M04-D6.1｜AIR31 桌面輸出自測");
        title.setTextSize(20);
        root.addView(title);
        TextView warning = new TextView(this);
        warning.setText("僅限非配戴實驗。將 AIR31 放在桌上、遠離耳朵。請先調低 Android 媒體音量，避免麥克風與耳機靠近回授。\n"
            + "Bluetooth 斷線會嘗試立即停止，但已送進系統的聲音仍可能短暫從手機喇叭播出。"
            + " 不存音訊、不上傳、不使用聽力圖增益。D6 自產 Chirp 約 6.5 秒，等待播放進度確認；原麥克風測試最長 40 秒。");
        warning.setTextSize(15);
        root.addView(warning);
        TextView modeHelp = new TextView(this);
        modeHelp.setText("模式：D6 自產 Chirp 不使用手機麥克風；D5 原始模式才做麥克風即時輸出。");
        root.addView(modeHelp);
        testModes = new RadioGroup(this);
        testModes.setOrientation(RadioGroup.VERTICAL);
        RadioButton selfOption = new RadioButton(this);
        selfOption.setId(9001);
        selfOption.setText("D6 AIR31 Output Self-Test｜App 自產 Chirp（預設，L1 固定）");
        testModes.addView(selfOption);
        RadioButton micOption = new RadioButton(this);
        micOption.setId(9000);
        micOption.setText("HearLens M04-D5 Microphone Loop｜Moto 麥克風即時輸出（舊模式）");
        testModes.addView(micOption);
        testModes.check(9001);
        root.addView(testModes);
        TextView levelHelp = new TextView(this);
        levelHelp.setText("非配戴測量輸出檔位（逐級測試；每次開始前選擇）。此設定不是實際耳內聲壓。");
        root.addView(levelHelp);
        outputLevels = new RadioGroup(this);
        outputLevels.setOrientation(RadioGroup.VERTICAL);
        for (int i=0; i<BenchOutputProfile.Level.values().length; i++) {
            BenchOutputProfile.Level level = BenchOutputProfile.Level.fromIndex(i);
            RadioButton option = new RadioButton(this);
            option.setId(8000+i);
            option.setText(level.label + "｜gain " + level.gain + "x，PCM ±"
                + level.cap + "，track " + level.trackVolume);
            outputLevels.addView(option);
        }
        outputLevels.check(8000); // explicit conservative initial baseline
        outputLevels.setOnCheckedChangeListener((group,id) -> {
            if (active.get()) return;
            if (offEar!=null)offEar.setChecked(false);
            if (volumeLow!=null)volumeLow.setChecked(false);
        });
        root.addView(outputLevels);
        offEar = new CheckBox(this);
        offEar.setText("確認 AIR31 沒有戴在任何人的耳朵上");
        root.addView(offEar);
        volumeLow = new CheckBox(this);
        volumeLow.setText("已調低手機媒體音量，耳機遠離手機麥克風");
        root.addView(volumeLow);
        testModes.setOnCheckedChangeListener((group,id) -> {
            if (active.get()) return;
            outputLevels.check(id == 9001 ? 8001 : 8000);
            offEar.setChecked(false);
            volumeLow.setChecked(false);
            refreshUi();
        });
        outputLevels.check(8001); // D6 safe default L1; no L2 in self-test
        startButton = new Button(this);
        startButton.setText("開始 D6 6.5 秒 Chirp 自測");
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
        log("build=m04d61-v0.3.1 target=Moto_g62_Android13 AIR31_A2DP");
        log("audio_output=NOT_CALIBRATED no_physical_speaker_isolation_guarantee=true");
        refreshUi();
    }

    private boolean selfTestSelected() { return testModes.getCheckedRadioButtonId() == 9001; }
    private boolean safeSelfTestMediaVolume() {
        int max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int current = manager.getStreamVolume(AudioManager.STREAM_MUSIC);
        return max > 0 && current > 0 && current * 5 <= max; // <= 20%, 3/15
    }

    private void requestStart() {
        if (active.get()) return;
        if (!offEar.isChecked() || !volumeLow.isChecked()) {
            log("blocked=off_ear_and_low_volume_confirmation_required");
            return;
        }
        boolean needsMicPermission = !selfTestSelected();
        boolean micMissing = needsMicPermission &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED;
        boolean btMissing = android.os.Build.VERSION.SDK_INT >= 31 &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED;
        if (micMissing || btMissing) {
            if (micMissing && btMissing) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_PERMISSIONS);
            } else if (micMissing) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_PERMISSIONS);
            } else {
                requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_PERMISSIONS);
            }
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
        final boolean selfTest = selfTestSelected();
        if (selfTest && !safeSelfTestMediaVolume()) {
            log("blocked=self_test_requires_nonzero_media_volume_at_or_below_20pct");
            return;
        }
        int levelIndex = outputLevels.getCheckedRadioButtonId()-8000;
        if (levelIndex < 0 || levelIndex >= BenchOutputProfile.Level.values().length) {
            log("blocked=invalid_measurement_level");
            return;
        }
        if (selfTest && levelIndex != 1) {
            log("blocked=self_test_l1_only");
            return;
        }
        final BenchOutputProfile selectedProfile =
            new BenchOutputProfile(BenchOutputProfile.Level.fromIndex(levelIndex));
        final AudioDeviceInfo bt;
        final AudioDeviceInfo mic;
        try {
            bt = findUniqueA2dp();
            mic = selfTest ? null : findBuiltinMic();
        } catch (SecurityException e) {
            log("blocked=bluetooth_permission");
            return;
        }
        if (bt == null || (!selfTest && mic == null)) {
            log("blocked=exactly_one_a2dp_and_optional_builtin_mic_required");
            return;
        }
        if (selfTest && !String.valueOf(bt.getProductName()).toUpperCase(Locale.ROOT).contains("AIR31")) {
            log("blocked=self_test_requires_air31_product_name");
            return;
        }
        selectedId = bt.getId();
        startedAt = SystemClock.elapsedRealtime();
        gate = new BenchSessionGate();
        if (!gate.begin(selectedId,startedAt,
                offEar.isChecked() && volumeLow.isChecked())) {
            log("blocked=" + gate.reason());
            return;
        }
        currentProfile = selectedProfile;
        selfTestActive = selfTest;
        lastActualRoute = "not_observed";
        active.set(true);
        outputLevels.setEnabled(false);
        for (int i=0; i<outputLevels.getChildCount();i++)
            outputLevels.getChildAt(i).setEnabled(false);
        writtenFrames = 0;
        droppedWrites = 0;
        missedReads = 0;
        playbackSubmittedFrames = 0;
        playbackHeadFrames = 0;
        playbackPrimingFrames = 0;
        writeZeroCount = 0;
        writePartialCount = 0;
        drainConfirmed = false;
        log("test_mode=" + (selfTest ? "OUTPUT_SELF_TEST" : "MICROPHONE_LOOP")
            + " source=" + (selfTest ? "APP_GENERATED_CHIRP_NO_MIC" : "BUILTIN_MIC_LIVE")
            + " duration_limit_ms=" + (selfTest ? BenchSelfTestSignal.TOTAL_MS : BenchSessionGate.SESSION_MS));
        log("start_a2dp_id=" + selectedId + " name=" + bt.getProductName()
            + " level=" + selectedProfile.level().name()
            + " media_volume=" + manager.getStreamVolume(AudioManager.STREAM_MUSIC)
            + "/" + manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
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
        worker = new Thread(() -> {
            if (selfTest) runSelfTestLoop(bt);
            else runAudioLoop(bt,mic);
        }, "M04-OffEar-Audio");
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
        final BenchOutputProfile profile = currentProfile;
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
            track.setVolume(profile.level().trackVolume);
            log("active_route=A2DP#" + selectedId + " input=BUILTIN_MIC#" + input.getId()
                + " level=" + profile.level().name()
                + " gain=" + profile.level().gain + " cap_pcm16=" + profile.level().cap
                + " track_volume=" + profile.level().trackVolume);
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
                    short v = profile.process(in[i]);
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

    /**
     * D6 output-only diagnostic: there is deliberately NO AudioRecord, no
     * microphone permission and no microphone samples in this path.
     * The deterministic signal goes through the same L1 process(), ramp,
     * limiter, A2DP routing and fail-stop lifecycle as the existing loop.
     */
    /**
     * D6.1: distinguish AudioTrack acceptance from its observed playback cursor.
     * The cursor is an OS software/driver signal, NOT proof of acoustic output.
     */
    private void runSelfTestLoop(AudioDeviceInfo bt) {
        final BenchOutputProfile profile = currentProfile;
        final BenchSelfTestSignal signal = new BenchSelfTestSignal();
        AudioTrack track = null;
        try {
            int minOut = AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_STEREO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if(minOut <= 0) throw new IllegalStateException("unsupported_output_format");
            track = new AudioTrack.Builder().setAudioAttributes(mediaAttributes())
                    .setAudioFormat(outputFormat()).setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(Math.max(minOut,FRAMES*4*4)).build();
            if(track.getState()!=AudioTrack.STATE_INITIALIZED)
                throw new IllegalStateException("track_init");
            if(!track.setPreferredDevice(bt))
                throw new IllegalStateException("output_preference_rejected");
            synchronized(outputLock) {
                if(!active.get())return;
                playback=track;
                track.setVolume(0f);
                track.play();
            }

            short[] silence=new short[FRAMES*2];
            long primedFrames=0;
            int stable=0;
            long routeStart=SystemClock.elapsedRealtime();
            while(active.get() && stable<3 &&
                    SystemClock.elapsedRealtime()-routeStart<1200) {
                int n=track.write(silence,0,silence.length,AudioTrack.WRITE_NON_BLOCKING);
                if(n<0)throw new IllegalStateException("silent_write_error_"+n);
                primedFrames+=n/2;
                AudioDeviceInfo routed=track.getRoutedDevice();
                if(routed!=null) {
                    if(routed.getType()!=AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                            routed.getId()!=selectedId)
                        throw new IllegalStateException("silent_route_not_air31");
                    stable++;
                }
                SystemClock.sleep(35);
            }
            if(!active.get() || stable<3)
                throw new IllegalStateException("silent_route_unknown");
            if(!gate.checkOutputOnly(selectedId,true,focusHeld,SystemClock.elapsedRealtime()))
                throw new IllegalStateException("pre_output_gate_fault");
            if(!safeSelfTestMediaVolume())
                throw new IllegalStateException("media_volume_changed");

            long now=SystemClock.elapsedRealtime();
            long initialHead=Integer.toUnsignedLong(track.getPlaybackHeadPosition());
            BenchPlaybackProgress progress=new BenchPlaybackProgress(primedFrames,initialHead,now);
            playbackSubmittedFrames=primedFrames;
            playbackHeadFrames=initialHead;
            playbackPrimingFrames=primedFrames;
            track.setVolume(profile.level().trackVolume);
            lastActualRoute="A2DP#"+selectedId;
            log("active_route=A2DP#"+selectedId+" input=NONE source=APP_GENERATED_CHIRP"
                +" level="+profile.level().name()
                +" gain="+profile.level().gain+" cap_pcm16="+profile.level().cap
                +" track_volume="+profile.level().trackVolume
                +" chirp_count="+BenchSelfTestSignal.CHIRP_COUNT
                +" chirp_ms="+BenchSelfTestSignal.CHIRP_MS
                +" playback_head_initial="+initialHead
                +" priming_frames="+primedFrames);
            routeListener=routing->checkActualRoutes();
            track.addOnRoutingChangedListener(routeListener,ui);

            short[] out=new short[FRAMES*2];
            long produced=0;
            while(active.get() && produced<signal.totalFrames()) {
                now=SystemClock.elapsedRealtime();
                if(!runningForeground || !normalMode() || !safeSelfTestMediaVolume()) {
                    abort("self_test_foreground_call_or_volume_change");break;
                }
                AudioDeviceInfo route=track.getRoutedDevice();
                boolean exact=route!=null && route.getId()==selectedId &&
                    route.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_A2DP;
                lastActualRoute=route==null?"UNKNOWN":(route.getType()+"#"+route.getId());
                if(!gate.checkOutputOnly(route==null?-1:route.getId(),exact,focusHeld,now)){
                    abort(gate.reason());break;
                }
                progress.observe(Integer.toUnsignedLong(track.getPlaybackHeadPosition()),now);
                playbackHeadFrames=progress.playedFrames();
                if(progress.stalled(now)){
                    abort("self_test_playback_head_stalled");break;
                }
                if(!progress.canQueue()){
                    SystemClock.sleep(5);continue; // bounded queue: no unpaced fast forwarding
                }

                for(int i=0;i<FRAMES;i++) {
                    short v=profile.process(signal.sampleAt(produced+i));
                    out[2*i]=v;
                    out[2*i+1]=v;
                }
                produced+=FRAMES;
                int offset=0;
                long lastAcceptedAt=SystemClock.elapsedRealtime();
                while(active.get() && offset<out.length) {
                    now=SystemClock.elapsedRealtime();
                    int done=track.write(out,offset,out.length-offset,AudioTrack.WRITE_NON_BLOCKING);
                    if(done<0){abort("output_write_error_"+done);break;}
                    if(done==0){
                        droppedWrites++;writeZeroCount++;
                        if(now-lastAcceptedAt>BenchPlaybackProgress.STALL_MS){
                            abort("self_test_write_stalled");break;
                        }
                        SystemClock.sleep(5);
                    }else{
                        offset+=done;
                        writtenFrames+=done/2;
                        progress.accepted(done/2);
                        playbackSubmittedFrames=progress.submittedFrames();
                        if(offset<out.length){droppedWrites++;writePartialCount++;}
                        lastAcceptedAt=now;
                    }
                    if(!runningForeground || !normalMode() || !safeSelfTestMediaVolume()){
                        abort("self_test_interrupted_during_write");break;
                    }
                    AudioDeviceInfo duringWrite=track.getRoutedDevice();
                    if(duringWrite==null ||
                            duringWrite.getType()!=AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                            duringWrite.getId()!=selectedId){
                        abort("self_test_route_lost_during_write");break;
                    }
                    if(!gate.checkOutputOnly(selectedId,true,focusHeld,now)){
                        abort(gate.reason());break;
                    }
                }
                java.util.Arrays.fill(out,(short)0);
            }
            if(active.get()){
                long drainStarted=SystemClock.elapsedRealtime();
                progress.startDrain(drainStarted);
                log("self_test_pcm_submitted accepted_frames="+writtenFrames
                    +" priming_frames="+primedFrames
                    +" total_submitted_frames="+progress.submittedFrames()
                    +" head_frames="+progress.playedFrames()
                    +" drain_timeout_ms="+BenchPlaybackProgress.DRAIN_TIMEOUT_MS);
                while(active.get()){
                    now=SystemClock.elapsedRealtime();
                    if(!runningForeground || !normalMode() || !safeSelfTestMediaVolume()){
                        abort("self_test_interrupted_during_drain");break;
                    }
                    AudioDeviceInfo route=track.getRoutedDevice();
                    boolean exact=route!=null && route.getId()==selectedId &&
                        route.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_A2DP;
                    lastActualRoute=route==null?"UNKNOWN":(route.getType()+"#"+route.getId());
                    if(!gate.checkOutputOnly(route==null?-1:route.getId(),exact,focusHeld,now)){
                        abort(gate.reason());break;
                    }
                    progress.observe(Integer.toUnsignedLong(track.getPlaybackHeadPosition()),now);
                    playbackHeadFrames=progress.playedFrames();
                    if(progress.drained()){
                        drainConfirmed=true;
                        log("self_test_android_playback_drain_confirmed=true"
                            +" accepted_frames="+progress.submittedFrames()
                            +" played_frames="+progress.playedFrames()
                            +" drain_elapsed_ms="+(now-drainStarted)
                            +" acoustic_output_verified=false");
                        abort("self_test_complete");
                        break;
                    }
                    if(progress.stalled(now)){
                        abort("self_test_playback_head_stalled_during_drain");break;
                    }
                    if(progress.drainTimedOut(now)){
                        abort("self_test_drain_timeout");break;
                    }
                    SystemClock.sleep(15);
                }
            }
        }catch(SecurityException e){
            abort("permission_revoked");
        }catch(Exception e){
            abort("self_test_error_"+e.getClass().getSimpleName()
                +"_"+(e.getMessage()==null?"unknown":e.getMessage()));
        }finally{
            if(track!=null){
                try{track.setVolume(0f);}catch(Exception ignored){}
                try{if(routeListener!=null)track.removeOnRoutingChangedListener(routeListener);}
                catch(Exception ignored){}
                try{track.pause();track.flush();track.stop();}catch(Exception ignored){}
                try{track.release();}catch(Exception ignored){}
            }
            synchronized(outputLock){playback=null;}
            if(active.get())abort("self_test_loop_ended");
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
        BenchSessionGate localGate = gate;
        if(localGate == null) { abort("no_route_gate"); return; }
        if(localGate.state() == BenchSessionGate.State.RUNNING) {
            if(!localGate.tick(SystemClock.elapsedRealtime())) {
                abort("timer_ended"); return;
            }
            checkActualRoutes();
        } else if(localGate.state() == BenchSessionGate.State.STOPPED ||
                SystemClock.elapsedRealtime()-startedAt >= BenchSessionGate.SESSION_MS) {
            abort("silent_route_timeout"); return;
        }
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
        BenchOutputProfile profile = currentProfile;
        if(profile != null) log("digital_levels " + profile.metrics());
        log("stop=" + (gate==null?why:gate.reason())
            + " elapsed_ms=" + (SystemClock.elapsedRealtime()-startedAt)
            + " test_mode=" + (selfTestActive ? "OUTPUT_SELF_TEST" : "MICROPHONE_LOOP")
            + " selected_a2dp_id=" + selectedId
            + " last_actual_route=" + lastActualRoute
            + " media_volume=" + manager.getStreamVolume(AudioManager.STREAM_MUSIC)
            + "/" + manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            + " mic_frames=" + (selfTestActive ? 0 : writtenFrames)
            + " attempted_pcm_frames=" + writtenFrames
            + " dropped_writes=" + droppedWrites
            + " write_retry_zero=" + writeZeroCount
            + " write_retry_partial=" + writePartialCount
            + " track_submitted_frames=" + playbackSubmittedFrames
            + " track_played_frames=" + playbackHeadFrames
            + " track_priming_frames=" + playbackPrimingFrames
            + " android_drain_confirmed=" + drainConfirmed
            + " acoustic_output_verified=false"
            + " missed_reads=" + missedReads
            + " no_audio_file=true speaker_zero_leak_not_proven=true");
        ui.post(() -> {
            if (!active.get()) {
                offEar.setChecked(false);
                volumeLow.setChecked(false);
            }
            refreshUi();
        });
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
        if(testModes!=null) {
            testModes.setEnabled(!active.get());
            for(int i=0;i<testModes.getChildCount();i++)
                testModes.getChildAt(i).setEnabled(!active.get());
        }
        startButton.setText(selfTestSelected()
            ? "開始 D6 6.5 秒 Chirp 自測" : "開始 D5 40 秒麥克風測試");
        stopButton.setEnabled(active.get());
        if(outputLevels!=null) {
            outputLevels.setEnabled(!active.get());
            for(int i=0;i<outputLevels.getChildCount();i++)
                outputLevels.getChildAt(i).setEnabled(!active.get());
            if(selfTestSelected())
                for(int i=0;i<outputLevels.getChildCount();i++)
                    outputLevels.getChildAt(i).setEnabled(false); // D6 always L1
        }
    }
    @Override public void onPause() {
        runningForeground=false;
        abort("app_left_foreground");
        super.onPause();
    }
    @Override public void onResume() {super.onResume();runningForeground=true;}
    @Override public void onDestroy() {abort("activity_destroyed");super.onDestroy();}
}
