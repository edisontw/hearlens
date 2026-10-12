# M04 Bluetooth-first hearing feasibility — decision record (2026-10-12)

## M04-A evidence decision (2026-10-12)

**Read [M04A_EARBUD_LOCAL_DSP_FEASIBILITY_2026-10-12.md](./M04A_EARBUD_LOCAL_DSP_FEASIBILITY_2026-10-12.md) first.** This initial phone-mic → Bluetooth study is retained as the controlled **measurement/optional remote-mic** track, *not* the default continuous face-to-face hearing architecture. Public Android/iOS/Bluetooth HAP/VCP APIs do **not** provide generic arbitrary-earbud local multiband WDRC/transparent mic controls. Preferred research path: near-ear built-in microphone → firmware/ODM-controlled local low-delay DSP → open-ear receiver, with phone/BLE for settings and independent captions. Procurement/physical calibration are still blockers; no live output is authorized.

## Product direction

**User preference: Bluetooth earbuds/headphones first for convenience and everyday adoption.** The former wired-only M04 plan is superseded. Keep a known wired USB-C headset solely as a controlled latency, route and frequency-response reference, not as the target product requirement.

**Decision is about which route to evaluate first, NOT permission to turn on amplification.** Current M03J–L safety models are synthetic; no Android/earbud sound route, measured acoustic safety, true physical mute or per-ear MPO exists. M01 caption-only functionality is independent and can continue during route failure.

## Why Bluetooth remains in scope

Existing commercial use cases establish feasibility in principle: Android Sound Amplifier supports wired/Bluetooth headphones, phone microphone and remote-phone-near-TV use; Apple Live Listen supports using an iPhone microphone with compatible AirPods/Beats. However, Google explicitly warns that some Bluetooth headphones delay or degrade sound. Android 13+ includes LE Audio/LC3 framework support, but actual hardware, firmware and negotiated transport must be verified rather than assumed.

- Google Android Sound Amplifier: https://support.google.com/accessibility/android/answer/9157755
- Apple Live Listen: https://support.apple.com/en-euro/102479
- Android LE Audio overview: https://developer.android.com/develop/connectivity/bluetooth/ble-audio/overview
- Comparative headphone/codec delay: https://www.rtings.com/headphones/learn/wired-vs-wireless-headphones

The **microphone must remain the PHONE's microphone** near the talker, with headset serving as output only; Bluetooth bidirectional call profiles can cause system capture device/quality changes. Never assume selecting a headset output preserves a phone input route.

## Key challenge: total time and sound mixing

Bluetooth audio buffering/codec adds device-dependent latency on top of capture, processing and output scheduling. Older SBC/AAC systems can add well over 100 ms; LE Audio may reduce it but **no guaranteed value** follows from a codec or logo. The current DSP 1024/256 STFT algorithmic lookahead (768 samples = 48 ms at 16 kHz, 16 ms at 48 kHz) is only one part of the microphone-to-ear delay and must not be presented as measured device performance.

Different use cases require separate feasibility judgments:

1. **Remote-phone-near-talker/TV**: Bluetooth convenience and improved microphone proximity may justify a delay that users can tolerate.
2. **Face-to-face with residual direct hearing**: direct acoustic sound plus delayed processed output may produce perceived echo/comb-filter coloration, making otherwise-acceptable streaming delay unsuitable for continuous hearing enhancement.
3. **Caption-only**: no amplified-ear timing is needed; keep independently usable even when audio is unavailable.

Do not invent a universal safe/usable millisecond threshold. Predefine criteria with listening studies and physical measurements, not only software timestamps.

## Proposed shortest validation sequence (without live hearing amplification)

1. Record exact Android phone/OS, one Bluetooth earbud model/firmware, paired transport/codec (LE Audio vs classic A2DP as actually routed), volume and acoustic mode (ANC/transparency/EQ). Keep one wired USB-C control pair.
2. Run a **low-level instrumented signal-loopback / coupler measurement** in an isolated, controlled setup (not on a human) for whole microphone-to-ear latency P50/P95, max observed delay, frame gaps, stability and residual acoustic gain/frequency response at a defined volume. Compare Bluetooth vs wired; do not use codec-specific marketing estimates.
3. Probe phone microphone preservation, output routing and interruption: pairing, one-ear loss, whole-set loss, reconnect, switching to speaker/another BT device, call and focus events, background and power transitions. Check both logical Android callbacks and **physical phone-speaker output**. Android `ACTION_AUDIO_BECOMING_NOISY` warns that A2DP disconnect can reroute to speaker; a preferred output device alone does not prove the actual route. Physical silence/no-leak evidence remains mandatory.
4. Obtain independently calibrated left/right coupler response and worst-case output under fixed hardware/volume/earbud DSP modes; determine limits from evidence and protocol before implementing a non-bypassable post-processing per-ear MPO limiter and controlled startup/ramp. Speaker fallback must fail closed before any potentially unsafe output. Do not assume acoustic calibration transfers across earbud models, fit, ANC modes or volume.
5. **Go/no-go:** if actual Bluetooth delay or hard-mute route behavior fails, preserve caption mode and consider low-latency wired research route and/or device-local transparency processing. Avoid adding ear-level amplification to the browser by shortcut.

## Platform engineering notes

- Android: inspect `AudioRecord` routed input and `AudioTrack` actual routed output separately; `setPreferredDevice` expresses preference, not actual routing guarantee. Listen to device/route changes and interruption, while understanding a callback can arrive too late to prevent a fallback. Native design must provide testable enforced silence.
- Avoid declaring generic browser Web Audio sufficient to enforce physical no-speaker fallback. Native Android may be essential for policy, lifecycle and measurement.
- Verify LE Audio support at BOTH endpoints; an Android 13+ version alone is not proof that a particular pairing actually uses LC3/LE.
- No M01 HTC/iPhone STT benchmark rerun is required to plan Bluetooth. Test M04 physical output independently, then revisit subjective multi-scene user evaluations.

## Remaining hard blockers

**Not implemented:** real native route control/hardware mute, output to Bluetooth or wired devices, actual acoustic calibration, independent per-ear MPO, phone-measured callback GC/deadline and microphone-to-ear P50/P95. M03 synthetic tests never certify these.
