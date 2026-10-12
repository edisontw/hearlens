# HearLens SW1 — Android input-only microphone / route probe

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
