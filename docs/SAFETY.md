# Safety

Safety requirements apply from the first audio-output implementation.

## Intended use during research

HearLens is currently a research-oriented communication-assistance prototype. It is not presented as a replacement for a clinically fitted hearing aid or as treatment for hearing loss.

## Population boundary for self-fit research

Initial self-fit experiments should be restricted conservatively to adults with stable mild-to-moderate hearing difficulty.

Professional evaluation path / exclusion from self-fit MVP includes:

- severe or profound hearing loss,
- sudden hearing change,
- marked unilateral/asymmetric loss,
- suspected conductive or mixed loss without professional assessment,
- concerning ear symptoms,
- unusually low uncomfortable-loudness tolerance.

## Mandatory audio safety controls

Any live hearing-output implementation MUST include:

1. final output limiter after all other processing,
2. per-ear maximum gain,
3. controlled gain ramp on start,
4. controlled ramp on reconnect,
5. immediate hearing-path mute on headset disconnect,
6. **no automatic amplified output to the phone speaker**,
7. clipping detection,
8. audio underrun/watchdog logging,
9. supported-device and calibration-profile identifiers,
10. requested and actual AGC/AEC/noise-suppression state logging,
11. independent left/right profiles,
12. regression tests proving no processing stage can bypass the final limiter.

## Output route hard gate (M03K architecture, not implemented)

The offline route simulation and preallocated DSP output buffer **do not control actual headphones**. Neither a mock authorization flag nor a browser route callback guarantees that amplified audio cannot fall back to a phone speaker. No live hearing playback may be enabled until a target-device native route/mute mechanism has passed *physical* disconnect and unintended-speaker-output tests. Left/right acoustic MPO requires independent measured device calibration and a final post-processing limiter on each channel. Details: [M03K_CALLBACK_ROUTE_ARCHITECTURE.md](./M03K_CALLBACK_ROUTE_ARCHITECTURE.md).

M03L adds a strictly offline mock Port with **no raw PCM output/sink API**. It enforces fail-stop *model* semantics only; it cannot detect a physical headset change or mute a real output. See [M03L_CALLBACK_PORT_MODEL.md](./M03L_CALLBACK_PORT_MODEL.md). All real hardware and per-ear MPO gates above remain blocking.

## Calibration truthfulness

On uncalibrated hardware:

- a digital limiter can constrain digital full scale,
- it cannot guarantee ear-level dB SPL,
- digital filter gain is not REIG,
- a calculated profile is not real-ear verification.

Do not label uncalibrated processing as clinical fitting.

## Privacy defaults

- Audiogram: local storage where feasible.
- Transcript: memory-only rolling buffer by default.
- Audio recording: off by default.
- Cloud STT: disclose clearly before use.
- Analytics: no raw speech by default.
- Do not collect identity fields that are unnecessary to the function.

## Fail-safe principle

When route state, calibration state or audio constraints are uncertain, captions may continue but hearing amplification must fail closed.

## M01 caption capture foreground lifecycle (2026-10-13)

[Mobile lifecycle fail-stop](./M01_MOBILE_LIFECYCLE_FAILSTOP_2026-10-13.md) terminates foreground captions on page hidden/pagehide or microphone-track ended/persistently muted, with no automatic resume, and discards asynchronous permission results after cancellation. This is a *caption microphone resource/privacy guard*, **not** proof that a mobile OS always delivers timely background notifications or physical output/mute protection. The existing no-hearing-output hard gate remains unchanged.

## SW1 microphone-route diagnostics (2026-10-12)

[Android SW1 input-only probe](../apps/android-mic-probe/README.md) is intentionally a **separate foreground-only diagnostics APK** and has **no AudioTrack/output PCM path, network permission or saved microphone audio**. It does not exercise or release any of the hearing amplification gates above. In particular, observing `AudioRecord.getRoutedDevice()` verifies a requested **input** route, not the physical output route, speaker fallback or ear-level MPO. Do not interpret the SW1 APK as permission to connect the existing M03L synthetic DSP mock to real playback.

## SW2 causal research-only DSP (2026-10-12)

[SW2 causal IIR/WDRC](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md) is an isolated **synthetic/offline** processor with no device connection or audio sink. Its zero **future-input lookahead** does **not** mean zero phase/group delay or any measured microphone-to-ear Bluetooth delay. Its post-sum PCM limiter is not calibrated ear-level SPL/MPO. All mandatory physical output route, hard-mute, left/right acoustic calibration and clinical checks remain **blocked**. Do not wire SW2 output to the experimental Android input-only probe or any Bluetooth headphone route.

## SW3 Bluetooth output-policy simulation (2026-10-13)

[SW3 route model](./SW3_BLUETOOTH_OUTPUT_FAIL_CLOSED_MODEL_2026-10-13.md) is a **count-only synthetic fixture**, not Bluetooth output authorization. A2DP/LE endpoints, headset identities, two-ear state and calibration/profile IDs are **mock metadata**. The tested failure cases (speaker fallback, disconnect, HFP change, phone call, focus/background, stale route, one-ear removal, reconnect) revoke model permission, **but Android may route previously queued sound to a phone speaker before an app receives any notification**. No current Android route, sample timestamp, software flag or CI test proves physical hard mute or calibrated ear SPL. The user has deferred hardware POCs; real hearing playback stays prohibited.

## SW3-C Android passive route audit (2026-10-13)

[SW3-C native no-output route audit](./SW3C_ANDROID_ROUTE_CONTROL_DECISION_2026-10-13.md) watches MEDIA/accessibility **predicted** routes during a user-started 30-second foreground window. It latches prediction faults and never grants playback: `outputAuthorized()` is always false. A stable watch or an AudioTrack preferred/routed-device query cannot demonstrate physical speaker isolation or a hardware mute. Live hearing output remains strictly prohibited; the earlier AIR31 field PASS does not need repetition.

## SW3-Native Android media-output observability (2026-10-13)

[SW3-Native passive output prediction](./SW3_NATIVE_ANDROID_OUTPUT_OBSERVABILITY_2026-10-13.md) uses the public API 33+ `AudioManager.getAudioDevicesForAttributes` **without generating or playing sound**. It returns the **anticipated** devices for given AudioAttributes, not the actual output of a playing AudioTrack. The available-device list and communication-selected route are separate concepts. Callback time cannot establish no-speaker-fallback physical mute, Bluetooth latency or calibrated ear SPL. This source change **must not** enable headphone/amplification output or modify the mandatory hardware gates above. SW1 source PCM continues to be immediately discarded.

## SW4 native input-clock diagnostic limitations (2026-10-14)

[Input timing and acoustic bench decision](./SW4_ANDROID_INPUT_CLOCK_AND_ACOUSTIC_BENCH_DECISION_2026-10-14.md) adds Android INPUT-ONLY metadata: `AudioRecord` MONOTONIC timestamp age and frame-time skew; no output permission, raw voice recording, network or device speaker playback. **Neither metric is sound-to-PCM capture latency, Bluetooth presentation latency, measured microphone dB SPL nor earphone acoustic MPO**. Sample clock health, even if stable, cannot release any hearing-output gate. The *nonhuman* calibrated acoustic playback and physical fail-closed route tests remain unperformed/deferred; input-only SW4 code must not trigger them automatically. No new mandatory repeat of the user-accepted SW1/SW3 phone tests.

## M04-D2 output physical-evidence hard gate (2026-10-16)

[The M04-D2 evidence gate](./M04D2_PHYSICAL_OUTPUT_EVIDENCE_GATE_2026-10-16.md) introduces a **metadata-only, never-authorizing** repository guard. Synthetic route-policy assertions and SW3 predicted A2DP cannot satisfy physical speaker mute, queued-output isolation, real audio-route identity or calibrated left/right MPO. The CLI and CI may report complete **reviewable evidence**, but cannot grant a nonhuman or human playback license. In particular, all output authorization remains false regardless of evidence content. Until an independently verified physical no-speaker-fallback protection is possible on the Moto g62 / AIR31, live hearing amplification remains BLOCKED.

## M04-D3 — Research-only off-ear test acceptance (2026-10-17)

Per [M04-D3 owner decision](./M04D3_NONHUMAN_BLUETOOTH_BENCH_DECISION_2026-10-17.md), the proof that Android will **never** route even buffered audio to the phone speaker is **not required as an entry condition for a deliberately low-level nonhuman/off-ear measurement**. The owner accepts a possibility of brief phone-speaker leakage on Bluetooth failure. This narrow test exception does not waive the mandatory route-stop response, gain cap and limiter, manual stop, short session timeout, visible monitoring, or no-auto-resume requirements; the native test path must first be implemented and tested. Actual route checks while the track is playing are required, not passive predictions alone.

**Do not reinterpret this as authorization for headphones worn by a person, audiogram-based live amplification or a clinical assistive-hearing claim.** Those retain the physical output, feedback, binaural calibration, maximum level and other hearing-output acceptance requirements. The M04-D2 evidence gate remains a strict account of unverified physical safety; passing its metadata tests has never enabled sound output.
