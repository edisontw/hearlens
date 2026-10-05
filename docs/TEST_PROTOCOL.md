# Test Protocol

Development-stage testing follows [DEVELOPMENT_VALIDATION_STRATEGY.md](./DEVELOPMENT_VALIDATION_STRATEGY.md). Do not run the full benchmark matrix while capture, gain control, enhancement, VAD, or segmentation parameters are still changing.


## 1. Automated DSP tests

Run without physical hardware:

- filter frequency response,
- WDRC input/output curves,
- limiter behavior,
- left/right independence,
- clipping/overflow,
- deterministic golden vectors,
- regression test: no feature can bypass final limiter.

## 2. Web/device diagnostics

Record at session start:

- requested microphone constraints,
- supported constraints,
- actual track settings,
- AudioContext sample rate,
- input channel count,
- reported latency metrics,
- current route information when available.

If critical conditions cannot be confirmed, captions may remain available but precise hearing compensation must be disabled.

## 3. End-to-end acoustic latency

Measure physically, not only from browser-reported latency:

```
reference acoustic impulse/chirp
  -> phone microphone
  -> application DSP
  -> earphone
  -> measurement microphone / ear simulator
```

Use cross-correlation and report:

- median,
- P95,
- worst case,
- wired vs Bluetooth,
- DSP off,
- WDRC on,
- noise-reduction variants.

Production transparent-hearing research should target the lowest practical latency, with <10 ms as the aspirational reference target.

## 4. Frequency response and gain

Test multiple acoustic input levels and compare measured output with target gain.

For calibrated research hardware, approximately ±5 dB target matching may be used as an initial verification tolerance, but must not be described as a regulatory specification.

## 5. Maximum-output worst case

Test combinations of:

- maximum allowed app gain,
- loud microphone input,
- enhancement makeup gain,
- EQ peaks,
- user fine tuning,
- OS volume state,
- reconnect events.

Verify limiter operation before clipping and no full-scale reconnect transient.

## 6. Caption engineering gate and formal metrics

During active development, controlled playback from a second phone may be used for relative A/B testing of gain, normalization, VAD, and STT changes. Keep playback device, volume, recording, distance, receiving-phone position, and orientation fixed. This is a repeatability tool, not a calibrated SPL source.

Manual `?gain=` testing is exploratory only. Formal caption benchmarking starts after adaptive normalization, limiter behavior, segmentation, and the selected STT path are frozen.

### Controlled source and report export

For the current engineering gate, use source ID `zh-tw-regression-v2` and record its file hash, receiving-phone distance, playback-device volume, phone orientation, and room condition. The Web Hearing Lab one-click report export is the canonical manual record format.

The report must preserve the complete session transcript and telemetry even though the on-screen rolling caption window is shorter.

### Customization / preset validation

Quick presets and advanced tuning are allowed, but every test run must record:

- preset name,
- resolved target level,
- minimum / maximum gain,
- attack / release parameters,
- enhancement / noise-suppression state,
- VAD / segmentation overrides when present,
- software commit / build.

Each preset must have a one-tap reset path to the tested default. Presets are validated as bounded policy changes around adaptive normalization, not as arbitrary device- or speaker-specific fixed gains. Formal comparisons must either use the default profile or explicitly declare the profile under test.

### Formal caption metrics

Timestamp:

- T0: acoustic speech onset,
- T1: first meaningful partial text,
- T2: stable/final text.

Primary UX latency:

```
partial_latency = T1 - T0
```

Benchmark separately for:

- Taiwan Mandarin,
- Mandarin-English code switching,
- Taiwanese/Hokkien experimental track,
- clinic vocabulary/numbers,
- older speakers.

## 7. Phone-near-talker acoustic test

Capture the same speech/noise condition with phone at:

- 20 cm,
- 50 cm,
- 1 m,
- 2 m,

and at an ear-position reference.

Scenes:

- quiet conversation,
- TV,
- restaurant/cafeteria,
- car passenger,
- clinic,
- family table.

Measure delta-SNR and perform listening tests.

## 8. Human comparison

Within-subject randomized crossover:

- A: unaided,
- B: participant's usual hearing aid,
- C: captions only,
- D: generic amplification,
- E: audiogram-aware fitting,
- F: audiogram fitting + enhancement + captions,
- G exploratory: audiogram fitting + enhancement without captions.

Primary outcome candidate: SRT50 / speech recognition in noise.

Also collect:

- keyword/sentence accuracy,
- listening effort,
- comfort,
- preference,
- caption reading correctness,
- response latency.

Use counterbalanced order and parallel sentence lists.
