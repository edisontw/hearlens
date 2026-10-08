# Development and Validation Strategy

Updated: 2026-10-07

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

### First controlled v2 baseline — 2026-10-06

A valid controlled run using `zh-tw-regression-v2`, Gemini Live, 1 m distance, and playback-volume field `40` showed:

- adaptive gain at 8.00x for every retained level sample,
- speech estimate around -66.8 dBFS,
- noise floor around -78 dBFS,
- no limiter reduction,
- 0.00% clipped samples,
- good preservation of the main daily-content sentences and numeric details.

This showed that the previous -30 dBFS target was not functioning as a practical normalization target under the tested capture path: the controller simply remained at its 8x ceiling. Because the successful effective speech level was approximately -48.7 dBFS after 8x gain, the next controller revision uses -48 dBFS as the engineering target. This keeps weak 1 m speech at the bounded ceiling while allowing closer/stronger speech to reduce gain automatically.

See `testdata/results/2026-10-06-zh-tw-regression-v2-1m-40.md`.

A follow-up 0.5 m / playback-volume 40 run on build `20261006-adaptive-target2` validated adaptive back-off: the retained gain ranged from 1.00x to 6.28x, with active-speech samples roughly 2.19x–6.02x, while limiter reduction and clipping remained zero. This is the first controlled evidence that the -48 dBFS target behaves adaptively rather than acting as a fixed 8x preamp.

See `testdata/results/2026-10-06-zh-tw-regression-v2-0.5m-40.md`.

The 2 m / playback-volume 40 follow-up completed the distance gate. Median retained adaptive gain was approximately 7.65x and 9/10 retained active-speech samples were at or above 7x, yet recognition degraded sharply while limiter reduction and clipping remained zero. Several speech peaks still reached roughly -36 to -40 dBFS after normalization. This shifts the next engineering question from scalar gain to far-field SNR / reverberation / front-end enhancement.

See `testdata/results/2026-10-06-zh-tw-regression-v2-2m-40.md`.

### Next front-end A/B: browser voice processing

Before introducing custom denoising DSP, test the platform capture stack as the lowest-cost reversible intervention. The default remains `capture=raw`, with echo cancellation, noise suppression, and automatic gain control requested off. The experimental `?capture=voice` profile requests these browser voice-processing constraints on the actual Gemini capture stream.

The exported test report records `runtime.captureMode`, and device diagnostics record the requested, supported, and actual track settings. This is important because browsers may ignore unsupported processing constraints.

Decision rule:

- if the 2 m voice-processing run materially restores transcript completeness without unstable gain, clipping, or obvious speech distortion, retain it as a candidate `Far/Noisy` front-end policy;
- if it does not help, return to raw capture and evaluate custom conservative enhancement rather than stacking unverified processing.

### Voice-capture repeat decision — 2026-10-07

Two controlled 2 m / playback-volume 40 runs on the same iPhone showed materially more continuous recognition with voice capture than the raw 2 m baseline. The second run confirmed that the actual Gemini capture stream had `echoCancellation=true`, while clipping and limiter reduction remained zero.

This is sufficient to promote voice capture into a user-selectable `Far / Noisy` quick preset on the current Web prototype. It is **not** sufficient to replace raw capture in Auto because the evidence is device-specific.

Current policy:

- Auto -> raw capture,
- Far / Noisy -> voice capture,
- explicit `?capture=` remains an engineering override and is logged as a custom profile,
- Near / Normal presets are intentionally **not added** at this stage: the 0.5 m run already backs adaptive gain down automatically, while the 1 m run remains accurate under the same Auto/raw policy. There is no measured need yet for a different target, gain range, or capture mode.

This closes the Near/Normal labeling question for the current input policy. Re-open it only if controlled telemetry shows a repeatable failure mode that Auto cannot absorb.

Before considering voice capture for Auto, validate the existing Far / Noisy preset on at least one additional receiving device. Record a human-readable receiving-device label/model in the exported report in addition to browser metadata and actual capture settings.

See `testdata/results/2026-10-07-zh-tw-regression-v2-2m-40-voice-repeat.md`.

### Second-device Far/Noisy validation — HTC U23 — 2026-10-07

A controlled A/B on an HTC U23 used build `20261007-device-gate1`, source `zh-tw-regression-v2`, playback-volume field `40`, and an actual receiving distance of **2 m**. The exported reports were mistakenly labeled `1 m` / `1m`; the tester confirmed after the run that both trials were performed at 2 m. Preserve the original report metadata and record this as a post-run correction rather than silently rewriting the raw report.

Results:

- Auto/raw produced only one short final fragment despite substantial non-clipped input/output levels.
- Far/Noisy/voice produced multiple coherent final segments spanning instructions, time, everyday-item content, numeric content, and the closing sentence.
- On the HTC U23 voice capture actually reported `echoCancellation=true`, `noiseSuppression=true`, and `autoGainControl=true`.
- Limiter reduction and clipping remained zero in the retained telemetry.

Decision: the Far/Noisy benefit now has evidence on a second receiving device and is not limited to the first iPhone test path. The cross-device Far/Noisy gate is therefore **passed**.

Do **not** yet make voice capture the global Auto default. The HTC U23 voice path is more aggressive than the tested iPhone path because NS and AGC are actually enabled. The next smallest safety gate is one controlled **1 m Auto vs Far/Noisy A/B on the HTC U23**. If voice capture preserves or improves normal-distance recognition without clipping or obvious distortion, reconsider whether Auto should use voice capture or an automatic capture-selection policy.

See `testdata/results/2026-10-07-zh-tw-regression-v2-2m-40-htc-u23.md`.

### HTC U23 normal-distance safety A/B — 1 m — 2026-10-07

A second controlled A/B on the same HTC U23 used build `20261007-device-gate1`, source `zh-tw-regression-v2`, receiving distance **1 m**, playback-volume field `40`, and the same room setup.

The exported metadata was incomplete: the Auto/raw report omitted receiver, distance, playback volume, and notes; the Far/Noisy report recorded `distance: "1m"` but omitted receiver and playback volume. The operator supplied the missing controlled-test context after the run. Preserve the raw reports unchanged and treat this result note as the completed metadata record.

Results:

- Auto/raw retained only two short fragmented finals from the first half of the source.
- Far/Noisy/voice retained a long coherent final from the beginning through the third instruction, substantially more complete than Auto/raw.
- HTC U23 voice capture again reported `echoCancellation=true`, `noiseSuppression=true`, and `autoGainControl=true`.
- Retained telemetry showed no limiter reduction and 0.00% clipping, despite substantially stronger voice-processed peaks.

Decision: **PASS** for the HTC U23 1 m safety A/B. Voice capture did not show an obvious 1 m penalty in this controlled run and materially improved transcript continuity.

This does not by itself justify changing the global Auto policy for every browser/device combination. Keep the user-facing policy unchanged for now:

- Auto -> raw capture,
- Far / Noisy -> voice capture.

The preset/capture behavior is now stable enough to stop adding distance-specific labels or repeating the same distance matrix. The next product-development work should return to bounded advanced tuning / profile export rather than continue retesting the same capture question.

See `testdata/results/2026-10-07-zh-tw-regression-v2-1m-40-htc-u23.md`.

## Bounded advanced tuning / reproducible profile layer — 2026-10-07

The current caption pipeline now has a collapsed engineering-only tuning layer. It does not expose arbitrary sliders. A versioned `tuning=v1` URL profile only accepts allow-listed values:

- adaptive target: `-54 / -51 / -48 / -45 dBFS`,
- minimum adaptive gain: `1 / 1.5 / 2x`,
- maximum adaptive gain: `4 / 6 / 8x`,
- response: `fast / balanced / steady`,
- capture policy: follow the quick preset, or explicitly request `raw` / `voice`.

The default resolved profile remains exactly the validated current controller: target `-48 dBFS`, gain `1–8x`, attack/release `350/120 ms`, limiter ceiling `0.95`, and the existing noise-floor / speech-level settings.

Safety/reproducibility rules:

- limiter and noise-floor parameters are not URL/UI controls,
- unsupported values fall back to the current defaults,
- choosing Auto/Far-Noisy or pressing reset clears bounded-tuning overrides,
- applying a profile creates a versioned URL configuration,
- the test report records the complete resolved tuning profile in addition to the provider-emitted input profile,
- profile changes are disabled while a recognition session is active,
- do not create speaker-specific profiles; use this layer only for bounded, question-specific engineering comparisons.

This closes the previously planned bounded customization layer. Do not reopen the completed raw-vs-voice distance matrix solely because the UI now exposes reproducible profiles.

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

## M01 client-observed caption startup telemetry

The Web lab records first-partial and first-final startup timing for engineering diagnostics. When the provider exposes an `audio-first-chunk` event, that event is the preferred client-side reference; otherwise the timer falls back to session start.

This is not the formal speech-to-caption latency benchmark. It does not establish acoustic speech onset, network decomposition, or comparable end-to-end latency across uncontrolled devices / rooms. The formal benchmark below remains the place to measure first-partial and final latency against a controlled source after the processing path is frozen.

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

1. Treat the 2026-10-08 iPhone intake as **pre-fix diagnostic evidence**, not the final M01 benchmark set; only 11 reports were present and the Auto / 1 m repeat-2 report was missing.
2. The intake exposed systematic long-source finalization loss even at 0.5 m. Pause the 24-run benchmark until the Gemini stop/drain fix passes the two-run preflight gate.
3. After deploying the stop/drain fix, run only one 0.5 m Auto and one 0.5 m Far/Noisy preflight with the full locked 45.554 s source. Confirm the retained transcript reaches the closing sentence.
4. If the preflight passes, freeze that build as the new benchmark-v1 build and restart the 24-run controlled matrix. Do not mix pre-fix and post-fix runs in one formal set.
5. Use `docs/M01_FORMAL_BENCHMARK.md` as the sole formal M01 controlled protocol and score every valid report with the versioned scorer.
6. Keep client-observed first-audio-to-caption timing as engineering telemetry until a locked speech-onset reference exists.
7. Do not reopen gain, Near/Normal preset, or raw-vs-voice tuning unless post-fix telemetry shows a reproducible regression.
8. After the controlled M01 benchmark is summarized, move real-speaker / noisy-scene / proximity-SNR validation to M02.

