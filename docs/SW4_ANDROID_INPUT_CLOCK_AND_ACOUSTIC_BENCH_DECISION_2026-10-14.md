# SW4 — Android input clock observability + physical-acoustic measurement decision (2026-10-14)

**Status: instrumented input-only APK and moto g62 5G Android 13 SW4 input-clock field check PASS (2026-10-14). Bluetooth acoustic output, calibrated SPL/MPO, real mic acoustic latency and hearing-path authorization remain unverified.**

SW4 actual field evidence: [26/26 timestamps valid, 25 consecutive STABLE, 0 clock faults; separately 20/26 all-zero digital level windows with no controlled stimulus](./SW4_MOTO_G62_INPUT_CLOCK_FIELD_RESULT_2026-10-14.md). This closes **input timestamp instrumentation field acceptance only**, not microphone acoustic performance or hearing-output safety. No repeat speech or headset-mic trial is required.

## Objective and choice of next stage

As of M03 Part Q, HearLens can calculate audiogram→CAMFIT nonlinear research gains→synthetic-only WDRC→digital PCM limiter, while all real hearing output is deliberately blocked. Earlier Android SW1 validated actual phone microphone input on a moto g62 5G (Android 13/API 33); SW3 single-button media route *prediction* found paired AIR31 A2DP but cannot observe a playing track. To avoid more synthetic-only work or repeating voice-distance benchmarks, SW4 adds a practical **input clock observability tool**, and specifies what physical test equipment would be indispensable to answer the remaining acoustic questions.

**Product direction remains unchanged:** primary microphone = phone internal mic; preferred future output = ordinary Bluetooth earbuds. No requirement to move the phone to the talker, occlude the ears, wear an external microphone or use earbuds as the microphone. No physical hearing-output proof or custom hardware prototype is forced in this milestone.

## Deliverable — SW4 Android input clock metadata

The existing separate debug-only Android app, now `HearLens SW4 Input Clock · v0.4.0` (versionCode **4**), preserves all SW1 input capture and SW3 route prediction/30 s passive route-audit features.

During an explicitly user-started **input-only** MIC / VOICE_RECOGNITION capture, the Android `AudioRecord.getTimestamp(AudioTimestamp.TIMEBASE_MONOTONIC)` is sampled once per ~1-second level-statistics interval. A separate pure-Java `CaptureClockAudit` observes:

- `timestampAgeMs = observationSystemNanoTime − audioTimestamp.nanoTime`: how old the Android-provided input timestamp appears **when sampled**, not when sound reached the microphone.
- `frameClockDeltaMs = 1000×ΔframePosition/sampleRate − ΔtimestampNanos/10⁶`: signed clock continuity difference across successive **valid** input timestamps; **not** microphone ADC latency, audio capture-to-user-visible processing delay or Bluetooth transport latency.
- `state` in `UNAVAILABLE` / `FIRST_SAMPLE` / `STABLE` / `STALE` / `INVALID` / `DISCONTINUITY`: purely **diagnostic** classifications, not routing/production safety authorization. Missing status resets the timing baseline; invalid, duplicate, regressing, future, too-old or impossible timestamps never silently become measurements.
- Android source, actual routed **input** device, client/device format, per-second RMS/peak **dBFS** and clipping counts still appear in the report. These remain *digital amplitudes*, not absolute environmental SPL, SNR or speech intelligibility.

All sample buffers continue to be overwritten with zero after in-memory statistics; no saved/replayed raw voice PCM, no audio output sink, no network permission, and no background audio service. App foreground exit and capture auto-stop remain. Existing SW3 output-route predictions remain unrelated to actual playing audio. All new timing log entries explicitly state `acoustic_input_latency=UNMEASURED`, `bt_output_latency=UNMEASURED`, `acoustic_mpo=UNMEASURED`.

Run JVM tests via GitHub Actions Android workflow, and produce an unambiguous artifact:

- Android debug APK: `hearlens-sw4-input-clock-v0.4.0-debug.apk`
- Actions artifact: `hearlens-sw4-input-clock-v0.4.0-diagnostics`.
- Header and share log: `20261014-sw4-input-clock-v0.4.0`

**Installation:** existing SW3 and new SW4 builds may not share the same debug-signing certificate across GitHub runners. Confirm header **v0.4.0** and exported `probe_build`, not merely an Android "Update" prompt. If signature differs, uninstall the old diagnostic APK only after exporting any wanted non-PCM logs. Diagnostic app uninstall does not modify the HearLens website or other Android apps.

### User action — optional, not a new benchmark requirement

The previous SW1 phone-mic capture and SW3 AIR31 route-prediction findings are already accepted. No new mandatory measurements follow from this code change. On a compatible Android phone, **if future input timing evidence is useful**, install SW4, leave Bluetooth-earbud-mic testing skipped, select default or builtin mic and press **MIC** for up to 30 s, then share metadata JSON after stopping. **No second sound source is required** just to audit input timestamp continuity; ambient input is sufficient. Do not attempt to use this app as an assistive output, and no need to repeat the previous fixed speech clip/distance matrix.

## What can be established with existing software alone

| Question | Existing evidence / capability | Unresolved |
| --- | --- | --- |
| Does the phone microphone return PCM? | SW1 phone input at 48 kHz, RMS/peak dBFS, client/device format and input route | Absolute acoustic dB SPL; actual input SNR; exact ADC/acoustic capture latency |
| Does Android provide a continuous input clock? | **SW4 added**: input timestamp availability, monotonic timestamp age, frame-time relative skew and faults | Actual physical delay from sound entering the phone to DSP |
| Does Android anticipate ordinary Bluetooth media output? | SW3 API 33+ A2DP prediction for AIR31 | **Actual** output route while playback is active, codec/presentation latency, speaker fallback |
| Do synthetic DSP math and limiter run? | M03Q offline model and Node CI | Real headphone transfer gain, ear-coupler dB SPL/MPO, harmonic/intermodulation and real-time glitches |
| Does physical unplug cause immediate mute? | SW3 simulated policy and predicted-route audit only | Real hardware mute latency, possible buffered speaker playback |

No software timestamp alone can convert these unknowns into ear-level acoustic measurements.

## Physical measurements — staged and only when approved

This is the proposed **minimum bench**, not a request to buy equipment or enable audio now.

1. **Phone microphone input transfer (dB SPL→dBFS).** Requires a known/reference acoustic stimulus, controlled phone/mic geometry and a **calibrated sound-level meter or measurement microphone** adjacent to the phone. Use several *measured* levels (e.g., quiet/speech/loud) and frequency regions with recorded Android input source, processing flags and ambient noise. Repeat to characterize AGC/nonlinearity; **do not calibrate from one guessed volume-slider value, another phone's speaker setting or a single full-band RMS**. Pure ambient input-clock SW4 observations do not satisfy this.
2. **Receiver output transfer and independent ear safety.** Needs a suitable **ear simulator / calibrated coupler** with microphone, documented earbud seating and volume, measured frequency-dependent L/R response and maximum physically achievable SPL. AirPods/AIR31 with different fit, Android media volume, operating mode or firmware need distinct calibration validity. A digital 0.8 limiter or `100 dB` CAMFIT arithmetic cap is **not** a physical maximum output level.
3. **Nonhuman Bluetooth latency and direct/processed mixing.** Under a separately approved, output-protected bench workflow, produce a known low-level test signal and capture the acoustic reference near phone microphone plus the earbud-on-coupler signal on the **same synchronized recording interface**. Cross-correlate several trials to estimate acoustic arrival interval / jitter for one headset, route and codec; account for upstream room propagation. Do not derive an end-to-end ear latency by adding only Android media timestamps or median Bluetooth specifications.
4. **No-phone-speaker-fallback verification.** While that protected bench is in place, instrument both headphone and phone speaker acoustic outputs and attempt disconnect, radio toggle, incoming call, focus loss, app background/kill and forced route change. Test with a hardware independent output mute/kill option and stop if unwanted speaker energy is measured. Ordinary Android route callbacks/predictions can arrive after rerouting, so cannot certify a pre-fallback hard mute.
5. **GO/NO-GO:** no live on-ear amplification until real input/output calibration, independently bounded **left and right acoustic MPO**, verified zero speaker fallback under faults, device/profile identity, startup/reconnect ramp and latency/artifact acceptance are demonstrated. Any staged bench output would require a **new explicit safety approval** and is **not added to SW4**.

**Research safety:** direct environmental sound + delayed Bluetooth amplified sound can interfere (comb filtering / echo). Pure software may not overcome a very large A2DP presentation delay in open-fit daily conversation. Measure first; do not demand ear sealing, near-talker phone placement, headset mic or extra microphone as a product prerequisite.

## Next project decision

After this SW4 instrumentation milestone, the first genuine product constraint to resolve is whether common Bluetooth earbuds allow acceptable **physical** end-to-end acoustic delay and a verifiable no-speaker-fallback safety path at all. When hardware bench work is explicitly prioritized, execute a **nonhuman** low-level output-latency + route/fallback + L/R acoustic SPL measurement—not another round of CAMFIT arithmetic parity or repeated speech transcription trials. Until then, leave hearing playback disabled and continue caption usability without reopening M01.
