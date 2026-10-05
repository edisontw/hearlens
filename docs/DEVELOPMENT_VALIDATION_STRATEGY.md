# Development and Validation Strategy

Updated: 2026-10-05

## Purpose

HearLens should not be tuned to one phone, one speaker, one room, or one manually selected gain value.

The development process therefore separates:

1. fast engineering calibration used to discover the useful operating range,
2. short regression gates used while the audio pipeline is still changing,
3. cross-device / cross-speaker validation after the pipeline is stable,
4. formal benchmark work only after the relevant processing chain is frozen.

This avoids spending large amounts of time on measurements that become invalid after a change to gain control, noise reduction, VAD, chunking, microphone behavior, or the test device.

## Core rule

Do not optimize a product constant such as `gain=6` or `gain=8` for a specific test phone.

The product target is device-tolerant input normalization:

```
microphone PCM
  -> level / noise-floor telemetry
  -> speech-aware adaptive gain
  -> limiter
  -> optional speech enhancement
  -> STT
```

The parameters that should eventually be stable across devices are target level, gain limits, attack/release behavior, limiter ceiling, and speech/noise decision rules. A fixed manual gain is an engineering probe, not the final control strategy.

## Fast customization layer

Adaptive behavior remains the default, but HearLens should allow fast, reversible customization because real users, phones, speakers, and environments vary.

Use two levels of control:

1. **Quick presets for normal users**
   - Auto / Recommended,
   - Near / face-to-face,
   - Normal room,
   - Far / quiet room,
   - Noisy environment.

   Presets must adjust bounded controller targets or policy choices rather than replace adaptive normalization with a hard-coded raw gain.

2. **Advanced tuning for testing / power users**
   - target speech level,
   - minimum / maximum adaptive gain,
   - attack / release speed,
   - noise-suppression strength,
   - VAD / segmentation sensitivity when supported,
   - provider/model-specific options where justified.

Requirements:

- one-tap reset to the tested default,
- visible indication when a non-default preset is active,
- all values constrained to validated ranges,
- settings can be changed quickly without rebuilding the app,
- settings should be exportable / reproducible as a small profile or URL/config snapshot during development,
- test logs must record the active preset and resolved parameter values,
- avoid per-speaker manual tuning as the normal workflow,
- device-specific overrides are allowed only when telemetry demonstrates a repeatable hardware bias,
- future hearing-output gain controls must remain downstream of safety limits and must never bypass the final limiter.

The purpose of customization is to handle edge cases and user preference quickly without turning every new device or speaker into a new calibration project.

## Current evidence

Verified on the current Android Chrome test path:

- Gemini 3.5 Transcribe Live end-to-end path works.
- Ephemeral-token broker and constrained Live WebSocket setup work.
- Traditional Chinese display conversion works.
- At 20-50 cm, informal Taiwan Mandarin accuracy was above roughly 90%.
- At 1 m, recognition quality changes materially with input gain.
- Exploratory single-run observations included approximately 75% at 1x, 85% at 3x, an anomalous 10% at 6x, and 90% at 8x.
- The 1 m raw signal in these tests was often around -60 to -70 dBFS RMS, with no clipping even at 8x.

These figures are engineering observations only. They are not a benchmark result because the speaker, acoustic output, and session conditions were not controlled. In particular, the 6x result demonstrates that single-run percentages can be dominated by uncontrolled variation.

## Stage A - prove the pipeline

Goal: establish that the architecture functions before optimizing quality.

Required gates:

- token provisioning works,
- WebSocket setup completes,
- microphone capture works,
- PCM reaches the STT backend,
- interim and final captions are received,
- Traditional Chinese display works,
- start / stop / restart behavior is reliable.

Use only a few short manual tests. Do not run a large accuracy matrix here.

Status: substantially complete for the current Gemini browser path.

## Stage B - build device-tolerant input normalization

Goal: remove dependence on a manually selected fixed gain.

Implement and instrument:

- raw RMS,
- raw peak,
- output peak,
- clipping percentage,
- estimated noise floor,
- speech-active level estimate,
- adaptive input gain,
- bounded gain range,
- attack / release smoothing,
- final limiter.

The adaptive controller should raise weak distant speech and back off automatically for close or loud speech.

Do not select the controller solely from one phone. Use a small number of representative devices only after the algorithm exists.

## Stage C - short controlled engineering gates

Once adaptive normalization is implemented, use a second phone or fixed playback source to reproduce the same speech signal.

A phone loudspeaker is acceptable for relative A/B engineering tests but is not a calibrated acoustic source and must not be interpreted as an absolute SPL benchmark.

Recommended quick gate:

- one fixed recording (currently `zh-tw-regression-v2`),
- fixed playback device and volume,
- fixed receiving-phone position and orientation,
- 0.5 m / 1 m / 2 m,
- a small number of repeats,
- record recognition output plus audio telemetry,
- export one versioned test-report JSON object per run.

Purpose: detect regressions and decide the next engineering direction, not produce publication-quality performance estimates.

Decision rules:

- If normalization raises distant-speech accuracy reliably, continue refining adaptive gain.
- If normalized level is adequate but accuracy remains poor, investigate SNR and speech enhancement.
- If repeated sessions vary widely under the same controlled input, investigate VAD, segmentation, chunk timing, reconnect behavior, and STT session state before adding more gain.
- If clipping occurs, fix gain control / limiter behavior before further recognition testing.

## Stage D - speech enhancement only when justified

Do not add denoising merely because distance performance is imperfect.

First distinguish:

- insufficient signal level,
- poor signal-to-noise ratio,
- microphone directionality,
- browser / OS audio processing,
- VAD or segmentation instability,
- STT model limitations.

Then compare enhancement variants as an ablation:

- OFF,
- conservative / lightweight enhancement,
- stronger experimental enhancement.

Keep the normalized clean path as the baseline.

## Stage E - cross-device robustness

After the input pipeline is stable, test a small representative device set.

Initial target:

- 2-3 Android phones with different microphone / OS behavior,
- later iOS Safari when the browser path is ready.

The test asks whether the same adaptive controller works acceptably without per-device retuning.

A device-specific profile may be considered later only if telemetry shows a systematic hardware-specific bias that normalization cannot absorb.

## Stage F - speaker and real-scene robustness

Only after device behavior is stable should testing expand to:

- different speaker loudness,
- male / female voices,
- older speakers,
- faster / slower speech,
- Taiwan Mandarin accent variation,
- Mandarin-English code switching,
- clinic vocabulary,
- family / TV / restaurant / car / clinic scenes.

These are STT and acoustic-robustness tests. They should not trigger separate hand-tuned gain values for each speaker.

## Stage G - formal benchmark

Run the full benchmark only after freezing the relevant version of:

- capture constraints,
- resampling,
- adaptive normalization,
- limiter,
- optional enhancement,
- VAD / segmentation,
- STT provider / model,
- Traditional Chinese display handling.

At that point the benchmark matrix can include:

| Dimension | Initial formal set |
| --- | --- |
| Device | 2-3 representative phones |
| Source | controlled recording + real speakers |
| Distance | 0.5 m / 1 m / 2 m |
| Environment | quiet + representative indoor noise |
| Speech | daily Mandarin / numbers and names / clinic terms / code switching |
| Metrics | CER or character accuracy, missed-utterance rate, first-partial latency, final latency, clipping / level telemetry |

Formal results must record the software commit / build and test configuration so later algorithm changes create a new benchmark version rather than silently invalidating old data.

## Regression philosophy

During active development, use the smallest test that answers the current engineering question.

Examples:

- WebSocket change -> setup / reconnect gate.
- Gain-controller change -> controlled level + clipping + short STT gate.
- Noise-reduction change -> clean/noisy A/B.
- VAD change -> repeated identical playback and missed-utterance rate.
- STT-provider change -> fixed corpus and latency / error comparison.

Do not repeat the entire formal benchmark after every small code change.

## Immediate next path

1. Stop manual fixed-gain optimization as a product decision.
2. Implement adaptive input normalization with noise-floor / speech-level telemetry and limiter protection.
3. Add a bounded quick-preset / advanced-tuning layer with reset and config logging.
4. Run a short controlled 0.5 / 1 / 2 m playback gate.
5. If level is normalized but recognition remains poor, isolate SNR / enhancement.
6. If identical trials remain unstable, isolate VAD / segmentation / session behavior.
7. After the audio path is stable, run cross-device tests.
8. Then expand to multiple speakers and real acoustic scenes.
9. Freeze a version before the formal benchmark.
