# M04 software-first reassessment — phone DSP, Bluetooth output and microphone capture (2026-10-12)

**User decision:** **Defer ALL custom hardware / ODM / chipset purchasing, firmware work, bench rigs and physical hardware POCs.** Investigate the strongest achievable **software-only** system using ordinary phones and consumer Bluetooth earbuds. Do not silently reinstate hardware POC as the next step. This newer priority **supersedes M04-A's POC order**, not its conclusions about proprietary DSP APIs, physical latency or safety requirements. Source of truth at start: `main` `b5deb1663706291e38beaca7ee845912c2ee3037`.

**No ear-level amplification authorized.** Continue M01 captions independently. See [SAFETY.md](./SAFETY.md); the first software experiments must be input-only, offline, simulator-only and/or diagnostics with audio output disconnected/disabled.

## Direct response to architecture question

**YES:** a third-party Android/iOS Native app can take PCM from a permitted microphone, apply independent L/R multiband EQ, low-delay filterbank, WDRC, denoising, compression and a final digital limiter, then ask the OS to send the *processed output stream* to Bluetooth earbuds. This does **not** require privileged programming of earbud-internal transparency DSP. This is an actual, technically supported software-processing topology, not the same as modifying in-ear transparency.

**But:** audio capture choice, OS buffers/mixer, Bluetooth negotiated profile/codec, retransmission and earbud presentation/render queues determine the unmeasured acoustic input→ear delay; phone DSP cannot eliminate sink buffering or make open-fit direct-sound coexistence automatically natural. Digital dBFS limiting does not establish ear-canal SPL safety.

## Three software-only candidate configurations

| Route | Captured mic | Phone processing | Earbud output | Strength | Blocker / practical conclusion |
|---|---|---|---|---|---|
| **S1 — phone mic → phone DSP → Bluetooth stereo** | `AudioRecord` built-in mic (Android), `AVAudioSession` built-in mic (iOS); actual route checked | Full software algorithm and stereo L/R gains | A2DP or actually negotiated LE Audio media | Fully conventional App architecture; control processing and input profile, usable in stationary remote mic / optional use | Phone is not necessarily near talker; BT latency and direct/delayed mixing remain; **GO for software investigation, CONDITIONAL for nearby conversation** |
| **S2 — earbud telephony/recording mic → Bluetooth uplink → phone DSP → Bluetooth downlink** | Headset mic via HFP or supported LE audio input; Apple supported AirPods high-quality recording on iOS 26+ | Full phone DSP (but limited by mic and route quality) | Usually coupled voice/chat route rather than free stereo A2DP | Mic sits near ear and user carries no external mic | Two wireless legs, possible mono/narrow bandwidth and heavy call-mode prefiltering; **GO for input/API discovery; CONDITIONAL/no evidence of transparent live hearing** |
| **S3 — first-party headset transparency/hearing settings + M01 captions** | Earbud's *own* firmware mic loop (not available as App raw ambient PCM) | HearLens app not in acoustic loop; captions/recall and instructions in phone | Manufacturer's local ambient output | Physically closer to daily open-ear and avoids phone BT audio loop | No ordinary third-party cross-brand WDRC fitting API; vendor user's own hearing settings only; **GO for practical capability inventory, NOT bespoke fitting** |

**No generic S4 shortcut** where an App obtains each ANC/transparency microphone over Bluetooth as low-latency raw multichannel PCM. Accessible **headset communication input** is not the device-internal transparency/beamforming microphone bus.

## Verified public software API capabilities

### Android

- `AudioRecord.setPreferredDevice(AudioDeviceInfo)` supports request for a capture input, and `AudioRouting.getRoutedDevice`/listeners show actual route. `AudioDeviceInfo` exposes builtin mic, Bluetooth SCO, BLE headset/aid, A2DP output types. The requested route is not guaranteed to remain active; log **observed capture and output separately**.
- `MediaRecorder.AudioSource.UNPROCESSED` is available only if the device implements it; otherwise it may behave like DEFAULT. Check `AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED`. `VOICE_RECOGNITION` may avoid AGC/NS on supported implementations; request/actual processing and recorded spectra still need to be checked.
- `AudioRecord.setPreferredMicrophoneDirection` and `setPreferredMicrophoneFieldDimension` (API 29+) allow **hints** for mic directivity; they do not expose synchronized raw inputs from all phone or earbud mics, nor promise beamforming improvement.
- `Oboe/AAudio` low-latency and exclusive requests can reduce *phone-side* overhead. Actual output device Bluetooth path may remain much slower than phone speaker/USB; `Oboe.calculateLatencyMillis` may miss delays outside the OS' modeled endpoints.
- `AudioManager.setCommunicationDevice` governs communication device policy where appropriate; do not switch to a communication route just to obtain earbuds mic without recording what it does to output sampling/channel topology.
- Google **Sound Amplifier** supports phone-mic → Bluetooth as a first-party precedent, **explicitly warns some Bluetooth devices delay audio**, and notes its separate-ear adjustment on Bluetooth applies to **phone media, not phone microphone capture**. Do not assume first-party app settings prove generic third-party per-ear mic loop behavior.

Official references:
- https://developer.android.com/reference/android/media/AudioRecord
- https://developer.android.com/reference/android/media/AudioRouting
- https://developer.android.com/reference/android/media/AudioDeviceInfo
- https://developer.android.com/reference/android/media/MicrophoneDirection
- https://developer.android.com/media/platform/mediarecorder
- https://source.android.com/docs/core/audio/latency/app
- https://developer.android.com/develop/connectivity/bluetooth/ble-audio/overview
- https://support.google.com/accessibility/android/answer/9157755

### iOS

- `AVAudioSession(.playAndRecord, .allowBluetoothA2DP)` permits Bluetooth A2DP playback (which is output-only); phone built-in microphone input can be used in a properly configured, checked session. When HFP is selected with `allowBluetooth`, Apple documents **input and output routing together** to the hands-free Bluetooth device. Enabling both A2DP and HFP options may prioritize HFP on the same headset. Always log `currentRoute` rather than trusting a requested configuration.
- **Important new exception (iOS 26+):** Apple introduced `AVAudioSession.CategoryOptions.bluetoothHighQualityRecording` / `AVCaptureSession.configuresApplicationAudioSessionForBluetoothHighQualityRecording` to expose **higher-bandwidth headset microphone capture on *supported* AirPods**, available via public API. `AVInputPickerInteraction` also improves the mic selection UI. This is a **recording input feature**, **not** AirPods ANC raw mic bus access, programmable local WDRC or proven low-delay ambient loop. Apple explicitly warns high-quality recording **may increase input latency** and isn't recommended for real-time communication. It is currently not available in EU; verify exact supported model/OS/region.
- Existing iPhone **Live Listen** is a first-party phone mic→AirPods/Beats mode, but doesn't grant HearLens internal earbud DSP or acoustic timing control.

Official references:
- https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp
- https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetooth
- https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/bluetoothhighqualityrecording
- https://developer.apple.com/videos/play/wwdc2025/251/
- https://developer.apple.com/documentation/avfoundation/avcapturesession/configuresapplicationaudiosessionforbluetoothhighqualityrecording
- https://support.apple.com/en-ie/102479

### Web vs native boundary

- Existing Web Audio offline M03 architecture is useful for algorithmic verification and M01 caption path; Web `getUserMedia` can request capture constraints and `AudioWorklet` can process sound, but browsers do not grant robust per-route identity, codec, microphone direction, simultaneous high-bandwidth BLE headset mic+sink selection or fail-closed physical output route enforcement across Android/iOS.
- **Software-first does not mean browser-only**. A very small **Android native diagnostics-only** capability slice is justified *before* building full amplification; it can show system routes and capture metrics without producing playback. iOS source selection discovery follows when iOS 26+/supported hardware available.
- Do not force STT reruns or replace caption provider to pursue this.

## Software ceiling: latency budget and DSP strategy

`T_e2e = T_capture + T_OS_input + T_DSP_buffer/filter + T_OS_output + T_encode + T_BT_transport + T_earbud_decode/render`. For S2 (earbud mic), add an **upstream** headset radio/profile/capture/decode path before phone DSP. Therefore better speech pickup position **may** cost an extra round trip. No source provides a universal phone+headphone E2E under a given codec: all numbers until acoustic measurement are *models/assumptions only*.

Existing M03H–L 1024 sample frame, 256 hop, 768 sample lookahead = **16 ms at 48 kHz** *algorithmic* delay. Optimizing Android callback/DSP can remove overhead but cannot fix post-DSP Bluetooth buffering. Possible lower-latency DSP candidate: minimum-phase IIR/multirate band-pass + limited-band WDRC/soft gain smoothing; **do not replace the validated STFT reference yet**. Prove numerical behavior, distortion and CPU in an isolated software comparison, with no actual ear output. A native C++ path might reduce app-side time; it cannot assert user-transparent listening by itself.

**Direct-sound caution:** For open-ear use, `ear = direct sound + delayed electronically amplified sound`. Level/frequency overlap causes coloration / later echo. Software spectral restriction to needed high-frequency bands, conservative gain, and carefully chosen existing earbud transparency mode could reduce perceived interference; **neither is proof of safe low latency**. No mandatory ear sealing; no extra microphone; don't make holding phone near speaker a mandatory primary scenario.

## Software-only work order — NO external hardware POC

1. **SW0 — capability matrix (desk + repo, this document):** freeze S1/S2/S3 feature gates, per-platform API limits and what is measured vs estimated. **DONE.**
2. **SW1 — isolated diagnostics-only Android route/capture probe (priority 1):** no output callback or speaker PCM; `RECORD_AUDIO` and required Bluetooth permissions with clear consent; enumerate mic and output device types, actual `AudioRecord` route, profiles/sample rates/channels, UNPROCESSED capability, direction acceptance, interruptions/one-ear removal, headset vs builtin microphone selection and capture envelope/noise processing. Export route/events metadata without saving raw speech by default. Record Android version/phone/earbud model+firmware manually. Never assume an API-selected preferred device is actual.
3. **SW2 — offline latency/quality ceiling (priority 2):** estimate lower bounds for each route based on known frame sizes, measured/software callback buffering, CPU cost; compare existing M03 STFT with a tiny causal IIR/WDRC design **only if it materially changes the modeled end-to-end budget**. Test recorded/synthetic input→DSP outputs to file, no real-time Bluetooth playback. Report estimated vs verified parameters separately.
4. **SW3 — simulated route policy safety (priority 3):** extend *no-output* fail-closed model for S1/S2 route-change, mic switch, interrupted call, reconnect, one-ear loss, sample-rate/bandwidth change, Bluetooth disabled, background/screen-off; ensure it never exports PCM to a speaker sink.
5. **SW4 — iOS mic capture API study / input-only native probe:** specifically evaluate `playAndRecord+A2DP` vs HFP and iOS 26 high-quality AirPods recording capability, including actual route and any increase of latency on supported phones.
6. **Physical hardware bench gate LATER, only if user changes priority.** Software-only diagnostics can determine if an input route and processing implementation exists, not the actual acoustic E2E delay or ear-level output safety. No ear amplification until separately approved physical no-speaker-fallback and calibrated per-ear MPO.

## Acceptance matrix for software-only stages

| Gate | Satisfying evidence | Unsafe/unjustified claim to avoid |
|---|---|---|
| Actual mic route | OS-reported input device + log, supported platform/input combo | "Earbud ANC microphones exposed" |
| Headset input processing | Audio source mode, sample rate/channels, signal-processing indicators and *repeated* controlled capture probes | "Unprocessed" solely from a requested flag |
| Stereo L/R processing | Offline golden PCM vectors proving independent gains/limiter | "Independent in-ear SPL fitting" |
| Latency budget | Algorithmic timing/CPU and OS timestamps labeled accordingly | "Acoustic E2E ≤20 ms" without ear output measurement |
| S2 bidirectional path | Verified profile/input+output route and bandwidth on exact device | "Low latency" based on LE logo |
| Caption independence | M01 remains functional, no new audio output | Clinical hearing aid replacement |
| Safety | Output disconnected / no-PCM diagnostics; hard-block production hearing path | Uncalibrated real-ear output or silent route proof from a mock |

## Decision summary

**Current top priority: phone DSP and mic-routing software feasibility, NOT local-earbud SDK/ODM procurement.** S1 is the easiest controllable software baseline; S2 best explores already-integrated near-ear microphones but may be worse for delay; S3 is a realistic user-first fallback leveraging manufacturer's local transparency feature and independent HearLens captions. Preserve the prior M04-A manufacturer-local-DSP study for future context; no present hardware work.

## SW1 implementation note — 2026-10-12

SW1 input-only Android probe is implemented in [apps/android-mic-probe](../apps/android-mic-probe/README.md). This separate Gradle project builds a **debug diagnostic APK**. It has no output-audio engine, no INTERNET permission, no recording files, 30-second foreground-only recording limit, and opt-in metadata share. It requests input route and separately logs observed `AudioRecord.getRoutedDevice()`, `AudioRecordingConfiguration` format and effects, RMS/peak statistics, Android mic source, and input/output **availability** (not actual output playing route). Android 12+ may request a matching communication sink **only for selected Bluetooth input**, clearing route after capture; no legacy SCO initiation. Strict stop on disconnect, route mismatch or leaving app.

**Evidence stage:** implement/CI compilation and no-output source checks first; **actual Android phone/earbud verification pending**. The program cannot measure acoustic E2E latency, true mic signal linearity, individual ANC raw microphones, or calibrated hearing-output SPL; all real-ear amplification gates remain blocked. No M03 playback and no extra hardware POC were added.
