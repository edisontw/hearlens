# SW1 — First Android microphone route field observation (2026-10-12)

**Source:** first user-supplied `hearlens-sw1-input-probe-v1` opt-in JSON event log, local timestamps 2026-10-12 22:53–22:56 +0800; metadata only, no raw microphone PCM retained. Keep this report as the baseline to **avoid repeated unnecessary testing**. Full exported metadata was supplied in HearLens ChatGPT project conversation, not stored in this public repository to avoid unnecessary exposure of every timestamp/device identifier.

**Status:** genuine phone runtime observations of **capture**, NOT evidence of acoustic mic-to-ear output, validated speech intelligibility, SNR, Bluetooth output route, device acoustic safety or cross-device performance.

## Test context

- Phone: **Motorola moto g62 5G**, Android API 33 (Android 13).
- Paired Bluetooth headset reported by Android: **AIR31**.
- Probe schema: `hearlens-sw1-input-probe-v1`, `noPCM=true`, `noOutput=true`.
- Available inputs include `BUILTIN_MIC#15`, `BUILTIN_MIC#16` and `BLUETOOTH_SCO#101(AIR31)`, plus other Android device types; **AIR31 was AVAILABLE, not routed during these two recordings**.
- Available outputs include `BLUETOOTH_SCO#99(AIR31)` and `BLUETOOTH_A2DP#104(AIR31)`. These are **device availability listings, not actual playback route**; SW1 has no playback.
- `AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` returned `false` throughout. Do not keep retrying UNPROCESSED in this initial field gate.

## Captures and results

| Capture | Time +0800 | Requested input/source | Observed input | Client + device format | RMS dBFS (per-second median) | Peak dBFS (per-second median) | Clipped samples | Stop |
|---|---|---|---|---|---:|---:|---:|---|
| 1 | 22:54:56–22:55:26 | default / MIC | BUILTIN_MIC#15 | 48 kHz mono PCM16, device=48 kHz mono | **−107.4** (29 reporting windows) | **−84.3** | 0 in all reporting windows | 30 s auto stop |
| 2 | 22:55:55–22:56:16 | default / VOICE_RECOGNITION | BUILTIN_MIC#15 | 48 kHz mono PCM16, device=48 kHz mono | **−48.9** (21 reporting windows) | **−30.5** | 0 in all reporting windows | user stop, roughly 21 s |

- Both reported recording config `silenced=false`, `effects=0`, `client_effects=0` and `active_mic_count=1`; effects count **does not exclude vendor/firmware DSP or a different physical capsule/beamforming mode**.
- First capture RMS windows ranged from −180.0 to −63.3 dBFS. Several windows were near the numerical silence floor; recurring peak ≈−84.3 dBFS (a few PCM16 counts). Second capture was much more consistent: RMS −57.7 to −46.5 dBFS.
- Median RMS difference = **58.5 dB**, enormous relative to the nominally identical `BUILTIN_MIC#15` route. **Do not attribute this solely to the AudioSource mode** without confirming controlled source playback, placement, capture privacy/OS state, and the active physical mic. Both captures used **system default selection**, not explicitly chosen `BUILTIN_MIC#15`.
- `start_ignored_capture_active` during the first run just shows an attempted second Start while the 30-second recording was still active, not a successful mode change.
- A metadata export was attempted during the second run and was rejected correctly (`stop_capture_before_export`), then user Stop succeeded.

## Current interpretation and GO/NO-GO

1. **PASS: Android foreground native AudioRecord actually delivered samples**, timestamp status SUCCESS; no clipped samples, no crash reported.
2. **PASS: AIR31 exposes an Android SCO communication mic input and an A2DP output endpoint on this paired phone**. Whether it can be used concurrently for suitable quality, and actual resulting sample rate, **remain UNKNOWN** because headset input was not selected in the supplied log.
3. **OBSERVED ANOMALY:** default MIC had near-digital-silence signal, whereas VOICE_RECOGNITION had ordinary recorded numerical levels, with the **same reported logical routing**. This could reflect an application/source/physical mic difference *or* dissimilar voice playback/testing conditions. It does **not** demonstrate better speech quality or voice recognition performance.
4. **NO claim about measured Bluetooth listening latency, hearing gain, actual headset output, stereo independence, direct/delayed mixing, calibrated SPL, or microphone quality**. SW1 produces **no sound**.
5. **NO need for additional phones, speech-recognition benchmarks, different distances or custom hardware POCs** to proceed to the next small gate.

> **2026-10-12 update:** The second field trial and explicit user priority now supersede this historic requested SW1-B checklist. MIC works during the fixed-speech playback window; the product uses **phone microphone first**, and AIR31 headset input testing is **deferred**. Do not ask the user to repeat the three tests below. See [latest 13-second speech-window analysis](./SW1_FOLLOWUP_PHONE_MIC_PRIMARY_2026-10-12.md).

## Smallest useful follow-up — SW1-B, only if user able (HISTORICAL / SUPERSEDED)

Use the **same fixed audio clip on a second phone** at fixed volume and fixed positions (around 1 m is adequate), starting playback before each capture; keep the diagnostic phone in foreground. In the input selector **explicitly** choose `BUILTIN_MIC#15` instead of the default, and record:

1. **MIC** for ~10 s, stop. If signal again reads near −100 dBFS despite voice playing, the MIC routing/settings anomaly is reproducible.
2. **VOICE_RECOGNITION** for ~10 s with the *same clip and geometry*, stop. Compare observed route, actual format, and level statistics, not just gain.
3. Select **`BLUETOOTH_SCO#101(AIR31)`** and test **MIC** for ~10 s. Watch for `communication_route_request`, `preferred_input_request`, and the **observed** route. If selecting it fails or no stable input appears, record that and **do not keep toggling**.
4. Stop before **Share diagnostic JSON**; export **one merged session** if possible. No need to test UNPROCESSED on this handset; no extra microphones, sealed earphones, or near-speaker handset positioning as daily product requirements.

These are **capture-source feasibility tests**; do not loop PCM back to AIR31 or expose ear-level amplification. Next SW2 can model software DSP lower bounds while waiting for optional captures. Only a physically validated, fail-closed no-speaker-fallback output route and independently calibrated per-ear MPO could eventually permit hearing output, and hardware POCs remain user-deferred.
