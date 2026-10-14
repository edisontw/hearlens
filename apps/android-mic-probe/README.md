# HearLens SW1 / SW3 / SW4 — Android input-only microphone and route diagnostics

**Purpose:** inspect what an ordinary Android app can actually capture from a phone microphone or paired Bluetooth headset microphone, before designing mobile DSP. This is a **separate debug-only app**. It does **not** run through the HearLens website and has **no output audio path, speech recognizer, audio file output, network or background audio service**.

## Build

Use JDK 17, Android SDK platform 35 and Gradle 8.9 (Android Gradle Plugin 8.7.3). From this directory:

```sh
gradle --no-daemon assembleDebug
# install only on a test phone with Developer Options and USB debugging:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Alternatively, the GitHub Actions **Android SW1 Probe** workflow builds the same unsigned *debug* APK as a CI artifact. It is not a production release, should not be distributed as an assistive hearing product, and is only usable when manually installed on a user's own Android phone.

## Short test protocol — microphone only

1. Open **HearLens Mic Probe**, pair ordinary earbuds in Android settings if available. Keep the app in the foreground and read the local disclosure. Grant Android microphone / nearby Bluetooth permissions when asked. Nothing is sampled until you tap a start button.
2. With **system default input**, run a 10–30 second MIC probe. Note observed input route and the device format. Output devices listed as AVAILABLE are **not** proof of actual playback route; no playback is created.
3. Choose **BUILTIN_MIC** explicitly and repeat MIC. If the route is rejected or switched, note the fail-stop event.
4. If the Bluetooth headset microphone appears among **input** devices (not just an A2DP output), choose it and start MIC; on Android 12+ the app requests a matching communication output to enable the headset mic, then restores the original audio mode after stopping. If no unambiguous paired communication sink exists, the tool fails closed instead of guessing. Switching to voice-call profile can reduce microphone bandwidth.
5. Repeat with **VOICE_RECOGNITION** and **UNPROCESSED**. The tool logs whether UNPROCESSED is **advertised**, and client/device format and effect **counts** when exposed by Android. A requested flag cannot prove that the real captured waveform was completely unprocessed. Do not interpret the dBFS values as calibrated SPL.
6. Stop or allow the 30-second auto-stop. Switch/turn off Bluetooth while recording only if practical: the selected input should fail-stop on route mismatch/unplug. Leave the app: `onPause` stops the microphone. Tap **Share diagnostic JSON** only after stopping and review the destination, since the report contains phone and device model names.
7. Repeat on a second headset or phone **only if** SW1 discovers meaningful route differences. A screenshot / exported diagnostic metadata is enough; **do not upload raw speech**.

## Captured versus NOT captured

**Reported (metadata):** Android API/phone, available inputs and outputs, UNPROCESSED advertised flag, explicitly requested vs observed input, client PCM 48 kHz mono request, actual device config when accessible, active mic count, per-second RMS/peak dBFS/clipping, sample count, capture timestamp result, capture errors and physical disconnect notifications.

**Not measured:** actual Bluetooth acoustic end-to-end latency, phone **output** route during app playback, direct+processed mixing, headset DSP microphone topology, absolute environmental SPL, maximum ear SPL, WDRC benefit, codec transport, and whether another app could route audio safely. No microphone samples leave the read buffer. Recording format reported as 48 kHz **client** PCM can reflect OS resampling; always prefer `AudioRecordingConfiguration.getFormat()` for reported device format.

**Limitations:** `setPreferredDevice` and `setCommunicationDevice` are requests, not guarantees. On Android 11 or earlier the tool intentionally does not initiate legacy SCO routing; test ordinary phone input and diagnostic listings. Headset HFP/LE microphone behavior differs between models. Mic-direction setting is just an UNSPECIFIED baseline hint (not yet a directional sweep); raw synchronized earbud ANC/transparency microphones are **not** exposed by this app.

**Safety:** no real-time amplified sound, no AudioTrack, no acoustic output, no internet permission or background microphone service. This cannot validate calibrated MPO or safe physical speaker fallback. The original HearLens M03L fail-stop remains synthetic, and the output safety gate in `docs/SAFETY.md` remains fully blocked.

## Field protocol update (2026-10-12)

Two Android field sessions from moto g62 5G / AIR31 have confirmed **phone** builtin microphone input at 48 kHz mono. User's fixed speech playback lasted approximately 11–13 s/trial. See [updated SW1 analysis](../../docs/SW1_FOLLOWUP_PHONE_MIC_PRIMARY_2026-10-12.md). **Do not request a Bluetooth SCO microphone test as a mandatory next step:** user chose *phone mic primary*, earbud mic optional later. MIC was functional when voice played; no more UNPROCESSED or multi-distance repeats now. SW2 software-only processing latency/quality analysis is next. The no-output safety contract is unchanged.

## SW3-Native passive MEDIA-output route prediction (2026-10-13)

Same Android diagnostic APK now offers **「檢查媒體輸出預測（完全不播放）」**. On Android API 33+ (including moto g62 5G Android 13), `AudioManager.getAudioDevicesForAttributes` returns outputs **anticipated** for MEDIA/speech and ASSISTANCE_ACCESSIBILITY/speech. It does not play sound or certify the *active* audio output route, codec, latency, headset wearing state, no-speaker-fallback or calibrated MPO. Android <33 shows `UNAVAILABLE_API_BELOW_33` for this query. The communication-device selector is logged **separately** and is not assumed to be media playback. The OS device callback can miss non-device-list media routing changes or arrive after a physical reroute.

**No need to start a microphone capture or play a second phone's speech** to use this passive output prediction. On a newly built debug APK, optionally connect normal Bluetooth earbuds, open app, press the new button and export one JSON metadata log. The previous SW1 APK does not contain this button. Keep all hearing-output safety gates blocked. See [SW3-Native evidence boundary](../../docs/SW3_NATIVE_ANDROID_OUTPUT_OBSERVABILITY_2026-10-13.md).

## SW3 Native app update confusion: fixed on 2026-10-13

The original SW3-Native APK accidentally reused the SW1 package version (`versionCode=1`, `versionName=0.1.0-sw1`) and the same workflow artifact name, `hearlens-sw1-android-input-only-debug`. Its new diagnostic button was below the input selector and device-refresh control, which may require scrolling on a small phone. An accepted "Update" prompt **does not prove the user installed the newest build**.

**Fix:** now `versionCode=2`, `versionName=0.2.0-sw3-native`; app icon/Android label is `HearLens SW3 Route Probe`; on-screen title `HearLens SW3-Native · v0.2.0`, with a `2026-10-13 · Route Probe · NO PLAYBACK` label and a `probe_build=20261013-sw3-native-v0.2.0` export log entry. The passive `檢查媒體輸出預測（完全不播放）` button now appears **before** all microphone controls and the route-prediction status is directly under it. The new GitHub Actions artifact is uniquely named `hearlens-sw3-native-v0.2.0-route-probe` and contains `hearlens-sw3-native-v0.2.0-debug.apk`.

**Installation:** These are GitHub Actions-generated Android **debug** APKs; different runners may use different **debug signing certificates** unless a stable signing key is explicitly configured. An in-place Android Update across different signing certificates may fail, so do **not** assume update is reliable. To ensure the correct build, download the **versioned** ZIP from the corresponding successful CI run, extract that **versioned** APK, remove the old **HearLens Mic Probe** if Android refuses the update, and install the new one. Removing a diagnostic APK loses app-local state; previous metadata JSON should be shared/exported separately if needed. The app does not store raw PCM. Prefer verifying the app screen version and `probe_build` field rather than Android's generic Update screen. No recording or audio playback is needed for SW3-Native.

This remains a **passive prediction-only** utility; it does NOT observe a playing track, measure Bluetooth mic-to-ear delay or enforce physical speaker mute.

## SW3-C passive route observation audit (v0.3.0, 2026-10-13)

The next versioned debug build adds a manually started **30-second SILENT route-prediction watch**, checking API33 MEDIA + ACCESSIBILITY predictions at 1-second intervals and on device added/removed notifications. All observations are **anticipated** routes, *not* the playing AudioTrack route. A speaker, SCO, changing/ambiguous/missing predicted device, non-normal audio mode or background transition latches an **observation fault** until manual restart. Stable samples do not prove hard mute; Android focus state, physical speaker playback, codec delay, acoustic output and ear SPL are **unmeasured**. This audit **never authorizes hearing playback**.

Version code 3, version name `0.3.0-sw3-audit`; main screen build marker `20261013-sw3-native-v0.3.0`; Android Actions artifact `hearlens-sw3-native-v0.3.0-passive-audit` contains `hearlens-sw3-native-v0.3.0-debug.apk`. Signing warning above continues to apply. The previous SW3-Native v0.2.0 Motorola + AIR31 passive single-button field verification already PASSED. **No mandatory new phone trial, speech playback or microphone test is requested**. For full API capability decision and safety limits, see [SW3-C](../../docs/SW3C_ANDROID_ROUTE_CONTROL_DECISION_2026-10-13.md).

## SW3-Native one-button AIR31 field result (2026-10-13)

Motorola moto g62 5G Android 13 / API33 with AIR31 paired: versioned `SW3-Native v0.2.0` ran successfully and on activity resume, device-added and the explicit user button, both media/speech and accessibility/speech anticipated device lists pointed at `BLUETOOTH_A2DP#135 (AIR31)`. **No output PCM or microphone recording occurred in this session.** Field scope is complete; **do not repeat the voice experiment or mandatory SCO input tests**. Actual playing device, acoustic delay and physical speaker-fallback suppression remain unknown. [Field evidence](../../docs/SW3_NATIVE_AIR31_FIELD_RESULT_2026-10-13.md).

## SW4 Input Clock diagnostic update (v0.4.0, 2026-10-14)

The app retains all existing SW1 and SW3 functions and adds **metadata-only Android input sample-clock diagnostics** to the existing user-initiated, foreground MIC capture. When the ~1-second level log is emitted, the app observes `AudioRecord.getTimestamp(AudioTimestamp.TIMEBASE_MONOTONIC)` and matching Java `System.nanoTime()`. The `SW4_input_clock` record reports `timestampAgeMs`, `frameClockDeltaMs` and classification (`FIRST_SAMPLE`, `STABLE`, `DISCONTINUITY`, `STALE`, `UNAVAILABLE`, or `INVALID`).

**Important:** `timestampAgeMs` is the age of Android's input timestamp when polled. It is **not microphone analog/acoustic/ADC latency**, not the Bluetooth microphone-to-ear end-to-end time and not a physical sound output measure. `frameClockDeltaMs` reflects the consistency of successive frame-clock/time pairs, not real-ear latency. Existing one-second RMS/peak dBFS measurements are still **not calibrated SPL**.

The new build identity is `HearLens SW4 Input Clock · v0.4.0`, `versionCode=4`, exported `probe_build=20261014-sw4-input-clock-v0.4.0`. Download the versioned GitHub Actions artifact `hearlens-sw4-input-clock-v0.4.0-diagnostics` containing `hearlens-sw4-input-clock-v0.4.0-debug.apk`. Some GitHub debug builds use different signing certificates: if updating fails, export desired previous diagnostics and uninstall only the prior probe app before installing SW4. Verify the displayed app version.

**Optional test only.** Existing SW1 Motorola phone microphone and SW3 AIR31 media-route prediction tests are accepted; no further fixed speech clip, distance matrix, headset microphone test or Bluetooth audio playback is needed for SW4 code acceptance. A short ambient input-only MIC capture is sufficient *if* SW4 timestamp evidence is ever required. The default route-prediction button remains completely silent.

See [SW4 test scope and proposed acoustically instrumented nonhuman Bluetooth/SPL GO-NO-GO bench](../../docs/SW4_ANDROID_INPUT_CLOCK_AND_ACOUSTIC_BENCH_DECISION_2026-10-14.md). Actual A2DP/LE playback latency, acoustic left/right MPO and physical no-speaker-fallback mute are **not** validated by SW4; hearing amplification remains disabled.
