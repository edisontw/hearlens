# M03 synthetic syllable-envelope boundary characterization (2026-11-23)

## Purpose and baseline

Extend the existing synthetic 1 kHz level-step and 1/2 kHz strong/weak pulse characterization with a **distinct, repeatable multi-syllable amplitude envelope near a six-band crossover**. This is a descriptive comparison of the current default FIR retarget policy ("restart") against the opt-in research-only "fixed-horizon". It is not an algorithm proposal or a new hearing-output capability.

Baseline: GitHub main `216b0a51052f913c10bf21f4bb5e1d4152966825` (#148). Test implementation: `packages/dsp/offline-auto-fir.integration.test.mjs`, using the existing synthetic left-ear testkit and unchanged 48 kHz six-band detector, 480-sample control clock, 513-tap symmetric FIR, 50 ms coefficient transition and per-sample final **digital** limiter.

Reproduce on the PR branch:

```sh
node --test packages/dsp/offline-auto-fir.integration.test.mjs
```

Look for the line prefixed `M03 synthetic syllable boundary` in the test output. It prints a JSON object with the metrics for both policies. This test is included in the repository's pre-existing `npm test` invocation; no package-script change is required.

## Synthetic conditions

- Duration: **3.4 seconds**, Float32 mono PCM; no microphone, speaker, earphone or real speech.
- 1,500 Hz **continuous weak sinusoid**: −44 dBFS RMS.
- 1,400 Hz **strong sinusoid**, −23 dBFS RMS during four syllable-like intervals: 900–1140, 1380–1630, 1860–2100, and 2340–2590 ms.
- Each strong interval has a 12 ms raised-cosine onset and offset, rather than an abrupt gate.
- The 1,400/1,500 Hz carriers straddle the geometric center boundary between the 1 and 2 kHz detector/FIR bands, near 1,414 Hz. The actual FIR uses a *blended boundary region*: the carriers are not completely isolated in separate filters.
- Each render starts from a fresh processor. The primary comparison uses 480-sample callback partitions; the restart output is compared bit-for-bit against a 128-sample partition. The original integration suite separately checks broader callback partitions and two-ear isolation.

## Metrics (digital, not acoustic)

1. **Weak-carrier projected gain**: in each group-delay-aligned 10 ms window (256-sample offset), estimate the 1,500 Hz sine and cosine coefficients and compute `20 log10(projected amplitude / input weak amplitude)`. At 48 kHz, the 1,400/1,500 Hz carriers complete exactly 14/15 cycles in 10 ms; ideal stationary sinusoids are orthogonal. The reported **rangeDb** is maximum minus minimum of these projected 10 ms gain estimates. Windows are baseline 700–850 ms, syllable sequence 900–2600 ms, and recovery 2700–3100 ms.
2. **Two-carrier residual ratio, dBc**: over selected 20 ms windows in the interior of each syllable, least-squares-project the output onto both known carriers (sine and cosine), accumulate squared residual and fitted energy, then report `10 log10(residual energy / fitted energy)`. The ratio **includes intended amplitude modulation**, phase/gain changes inside the window, leakage and dynamic-FIR sidebands, as well as implementation artifacts. It is *not* THD, a perceptual quality score, an intelligibility prediction, acoustic level, or medically defined "distortion".
3. **Safety/invariance gates**: finite output within the existing 0.3 digital ceiling, no limiter activation for this stimulus, no future-input lookahead, unchanged 256-sample fixed-gain FIR group delay, no audio route/hearing authorization, and restart partition independence for 128/480 samples.

Both policies see exactly the same PCM. The test does not assert that either policy must produce smaller ripple or residual; it deliberately avoids turning one synthetic fixture into a universal perceived-quality pass/fail threshold.

## Interpretation and next decision gate

This comparison can expose cross-band gain modulation or transient residual differences missed by a single-tone step, but **cannot distinguish audibly objectionable pumping from modulation expected for this artificial envelope**. Any P1 DSP change requires replicated evidence across further independent synthetic conditions, the unchanged restart baseline, and a quantified trade-off including gain response, full-band residual, callback load, latency and limiter/fail-stop behavior.

Until such evidence appears, keep restart as the default and fixed-horizon as **NO-GO for default enablement**. M03 remains offline synthetic PCM research; M04 physical mic input SPL, L/R output calibration, actual route/mute and acoustic MPO evidence remain deferred/blocking. A digital limiter does **not** establish safe ear-level SPL. Neither a numerical result nor CI success authorizes live audio playback.
