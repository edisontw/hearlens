# SW1 field follow-up — phone microphone first (2026-10-12)

**Latest explicit user product decision:** The **phone's built-in microphone is the primary speech capture** for HearLens. Ordinary **Bluetooth earbuds/headphones are the preferred eventual audio-output accessory**, not the default capture device. Bluetooth headset mic capture is **deferred** until a demonstrable need arises. Do **not** request extra AIR31 SCO/earbud mic tests as a next prerequisite. Hardware POCs remain deferred. Primary daily goal is natural same-room conversation; placing the phone near the talker, ear sealing and extra microphones are not product requirements.

**Source:** Second user-exported `hearlens-sw1-input-probe-v1` event log for Motorola moto g62 5G (Android 13/API 33), connected AIR31, local 2026-10-12 23:18–23:21 +0800. The user says **a fixed speech recording played approximately 11–13 seconds per trial**. Timing was not encoded in the probe, so the approximate playback intervals below are inferred from level changes. This is **not** a synchronized, sound-isolated, calibrated quality experiment. No user PCM is retained in project source.

## Actual observed capture routes

All three captures reported `actual_input=BUILTIN_MIC#15`, **default** input preference, `client_hz=48000 client_channels=1`, same device 48 kHz/mono PCM16, `active_mic_count=1`, `effects=0 client_effects=0 silenced=false`, and `clipped=0`. **A zero reported Android effects count does not prove vendor DSP is disabled.** AIR31 remained present as an available SCO input and A2DP output but was **not used as a recording input**. No audio was output to it.

| Requested AudioSource | Capture interval +0800 | Inferred playback-associated level windows (13 x ~1 s) | RMS dBFS median of those windows | Peak dBFS median | Observation |
|---|---|---|---:|---:|---|
| MIC | 23:19:31–23:19:52 | 23:19:38–23:19:50 | **−61.3** | **−38.9** | Initial 5+ s near digital silence, then clear amplitude during fixed-speech playback; **MIC is functional**, earlier near-silent run cannot establish its failure |
| UNPROCESSED | 23:20:11–23:20:33 | 23:20:18–23:20:30 | **−62.7** | **−43.6** | `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED=false`; result does **not** imply raw unprocessed capture; no benefit established |
| VOICE_RECOGNITION | 23:20:46–23:21:05 | 23:20:52–23:21:04 | **−47.9** | **−27.7** | ~13.4 dB higher **RMS digital level** than MIC in inferred speech portion; intelligibility, actual SNR, physical mic selection and signal coloration **not evaluated** |

Method: median over the 13 reported one-second summaries within each **approximate** speech interval; not RMS of a concatenated waveform. The intervals include any low-amplitude speech gaps or residual room sounds and may not exactly cover the actual clip onset/end. Full-session medians are **not comparable** because recording ran ~19–22 s whereas playback only lasted ~11–13 s. The large ~58.5 dB *previous* full-session difference was confounded by near-silence in the earlier MIC capture, **not** validated as the `AudioSource` gain difference.

## What this proves — and does not

- **PASS:** phone's internal mic produces plausible time-varying 48 kHz mono samples in all three modes with no observed clipping. Prior hypothesis of globally broken MIC mode is **not supported**.
- **OBSERVATION, not algorithm selection:** VOICE_RECOGNITION has substantially greater digital amplitude for this trial. That could reflect OS source-dependent processing/gain or differing conditions; **higher level is not proof of better speech recognition, SNR, hearing efficacy or low latency**. Keep MIC as reference and VOICE_RECOGNITION as an alternative candidate; do not multiply STT or output-gain defaults based solely on dBFS.
- **NOT REQUIRED:** Further AIR31 mic checks, UNPROCESSED retries (device does not advertise it), another receiving handset, another distance sweep or rerunning the pre-existing STT benchmarks merely because of this observation.
- **NOT MEASURED:** Bluetooth playback route under an active hearing stream, E2E acoustic latency, individual L/R acoustic gain or output limits, software safe mute on physical fallback, direct/delayed sound mixing.
- **Probe logging minor defect:** The two user-stopped recordings ended with `capture_end reason=read_error_0` following `stop_requested=user_stop`; a zero-length read after user-initiated `AudioRecord.stop()` must be classified as **expected stop**, not hardware capture error. This log fix should **not** change sample processing or permit output.

## Updated SW2 software-only work order

1. **SW2-A: phone-mic-only DSP latency budget**: model the known **48 kHz input** path; compare current M03 1024/256 STFT algorithmic lookahead 768/48000 = **16 ms** with a causal/minimum-phase multiband path on **synthetic/offline PCM only**. Report latency component **model vs measurement** distinctions and distortion/CPU evidence. Do **not** claim or estimate a verified whole Bluetooth acoustic delay from software timestamps.
2. **SW2-B: input source characterization without user burden**: use the above 13-s relative level observations as evidence that the phone mic works, not a requirement for more manual tests. Keep user-selectable fallback MIC/VOICE_RECOGNITION mode in engineering research; defer determining the best setting until a controlled intelligibility-relevant measurement is justified. No automatic adjustment of M01 STT presets by this small dataset.
3. **SW3: route fail-closed simulation** should now target the **phone microphone → phone DSP → Bluetooth audio-output** case (A2DP/LE actually observed only once an output-protected bench exists). Any future phone speaker fallback, uncalibrated headset SPL and in-ear output remain **blocked** by `SAFETY.md`.
4. **Headset mic capture S2, iOS high-quality headset capture and custom earbud firmware:** optional future alternatives, **not** next-stage acceptance blockers.

### Stage decision

**GO to software-only SW2 analysis without further phone capture requests. NO-GO for physical hearing amplification; no hardware POC.** This update supersedes the narrow third-AIR31-mic-test instruction in the first SW1 field observation, but keeps that original record historically intact.
