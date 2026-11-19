# M03 static minimum-phase FIR candidate — single offline screen (2026-11-19)

**Scope / decision: conditional static proof only.** This deliberately does **not** implement a new personal hearing DSP, change the existing STFT or SW2 causal processors, or authorize live output. The preceding [M03 comparison](./M03_CAUSAL_CAMFIT_OFFLINE_REVIEW_2026-11-19.md) found that the first-order residual IIR cannot replace CAMFIT/STFT (up to +5.80 dB static center-band difference and +8.86 dB in a **non-equivalent** dynamic proxy trial). This spike asks whether a different *causal static filter architecture* is numerically promising enough to justify further design.

## Reproduction

```sh
# Optional local research-only dependencies: NumPy and SciPy
python3 tools/research-m03-minphase-fir.py --selfcheck
```

Local environment used: Python with NumPy **2.3.5**, SciPy **1.17.0**, 2026-11-19. The script checks only this isolated fixture; it is not a production acceptance test or a mandatory GitHub CI task. No user-device or microphone test is involved.

Fixture: 48 kHz; octave centers 250/500/1000/2000/4000/8000 Hz; **rounded 65-coordinate CAMFIT synthetic** per-ear gain targets (capped at 12 dB) from the preceding review: left `[0,0,0,1.947,7.121,2.272]`; right `[0,0,5.694,11.947,12,4.142]` dB. Construct an **idealized** amplitude response with the existing smooth STFT crossover convention (geometric midpoints, raised-cosine blend over ±0.18 octave); this is **not** pixel-/bin-exact numerical parity against the 1024-point WOLA runtime. Use `scipy.signal.firwin2` to design odd-length linear-phase FIR, then `scipy.signal.minimum_phase(..., half=False)` to approximate a causal minimum-phase kernel while preserving the **intended magnitude**. Probe `freqz` at 16,384 frequencies; report max 250–8000 Hz error and six-center error against the *idealized target*, not a real-ear measurement.

| FIR taps | Ear | Max error at six centers | Max error 250–8000 Hz | RMS error 250–8000 Hz |
| ---: | --- | ---: | ---: | ---: |
| 257 | Left | 0.002 dB | 0.440 dB | 0.101 dB |
| 257 | Right | 0.490 dB | 2.061 dB | 0.329 dB |
| **513** | **Left** | **<0.001 dB** | **0.143 dB** | **0.031 dB** |
| **513** | **Right** | **0.005 dB** | **1.212 dB** | **0.142 dB** |
| 1025 | Left | <0.001 dB | 0.045 dB | 0.008 dB |
| 1025 | Right | <0.001 dB | 0.498 dB | 0.048 dB |

The 513-tap candidate has no **future-input** requirement when used as a causal FIR, unlike the 768-sample (16 ms at 48 kHz) STFT lookahead. However, 513 direct FIR taps correspond to **24,624,000 multiply-accumulate operations per second per ear**, about **49.2 million per second across two ears** before any compressor, coefficient-update, mixing, limiter, memory access or OS/Bluetooth overhead. This is theoretical arithmetic, **not** measured Android callback compute cost. No buffered callback, real FIR streaming, underrun, coefficient morphing or denormal handling was tested.

For 513 taps the impulse contains 95% of its **squared coefficient energy** by sample index 5 (left) or 8 (right). This is **not** filter group delay, E2E acoustic latency, permissible DSP delay or perceived echo; the minimum-phase filter is nonlinear-phase, and its frequency-dependent group delay requires its own validation. No dynamic 50/65/80 gain law was exercised.


## 2026-11-19 dynamic-design gate: wider-gain stress (research-only)

The original *two* illustrative G65 curves were a **narrow static feasibility screen**, not evidence of general personalized frequency response. A follow-up stress screen was performed using the exact synthetic CAMFIT 50/65/80 research anchors from the JavaScript reference (left thresholds 0/5/10/15/20/25 dB HL; right 10/15/20/25/30/35 dB HL). For each ear, 45 independent six-band nominal input-level vectors were screened (three uniform levels, two mixed vectors and 40 seeded random 50–80 model-level vectors). Their FIR kernels were **redesigned offline**; this was **not** actual time-varying WDRC or automatic band-level detection.

The screen also used **100 unrelated synthetic six-band gain shapes**, independently sampled from 0–12 dB. These are stress fixtures, **not CAMFIT-prescribed audiograms** or clinically representative prevalence estimates. All numbers compare **static minimum-phase FIR magnitude with the idealized smooth spectral target** at 48 kHz, 250–8000 Hz, and are not STFT output-waveform parity.

| Fixture | Filter length | Worst 250–8000 Hz magnitude error | 95th-percentile per-profile worst error |
| --- | ---: | ---: | ---: |
| CAMFIT-derived 45 per ear, 2 ears | 513 taps | Left **0.143 dB**, right **1.212 dB** | Not an independent representative sample |
| Unrelated six-band gains, n=100 | 257 taps | **6.360 dB** | 4.803 dB |
| Unrelated six-band gains, n=100 | 513 taps | **4.936 dB** | 3.679 dB |
| Unrelated six-band gains, n=100 | 1025 taps | **2.890 dB** | 2.218 dB |

The stress shows that the apparently excellent 513-tap result is **profile dependent**. The longer 1025-tap kernel reduces error but requires **98.4 million theoretical direct FIR MAC/s for both ears** at steady state, or **196.8 million MAC/s** if two full FIR branches are used for a coefficient crossfade. The 513-tap corresponding counts are 49.248 and 98.496 million MAC/s. These are upper-level arithmetic counts for naive direct implementations, **not Android CPU benchmarks**, and must not be mistaken for release-ready performance.

In a narrow, deliberately prescribed **50-ms transition** between separately designed 513-tap G50 and G80 kernels, blending outputs of two FIRs on the **same input history** was verified against directly interpolating coefficients at five samples. The maximum algebraic residual was **1.39×10⁻¹⁷**. This confirms only a linear-convolution identity: it does **not** prove click-free, artifact-free or intelligible dynamic compression, input-band envelope correctness, bounded callback compute, or safe hearing output. A physical SPL limiter, hardware route protection, and real headphone latency are still absent.

**How to reproduce the optional non-CI screen:**

~~~sh
python3 tools/research-m03-minphase-fir.py --selfcheck --dynamic-design-screen
~~~

### Revised decision

- **NO-GO** for claiming that this 513-tap FIR is a general-purpose dynamic CAMFIT replacement or integrating it with Android/audio output.
- **Research gate remains closed** until a single concrete dynamic architecture provides per-band 50/65/80 level estimation, a stable gain-update mechanism, bounded callback compute, and *multiple-profile* response accuracy. Do not keep increasing FIR tap count without a credible CPU/latency budget.
- The existing M03 STFT/WDRC remains the offline reference. M01 stays CLOSED and M04 real AIR31 hearing output stays BLOCKED/DEFERRED.

## Decision / next gate

- **GO only for a conditional offline design candidate:** the static magnitude-response fit is materially better than the current first-order IIR on these *two rounded illustrative gain shapes*. The present dataset is too narrow for a general prescription-equivalence claim.
- **NO-GO for replacing the current DSP:** no band-specific level detectors, common three-anchor 50/65/80 gain interpolation, stable time-varying filter-coefficient transitions, limiter integration, or callback CPU/memory tests have been implemented for FIR. Dynamic filter changes may create artifacts; the current static kernel says nothing about compression fidelity.
- **Next step only if justified:** specify an efficient dynamic FIR architecture, including shared per-ear gain law, envelope measurement, coefficient update/crossfade, peak limiting, and numerical acceptance on multiple synthetic profiles. Estimate genuine per-callback cost before coding. If that architecture is not attractive, **park M03 FIR** rather than accumulating unrelated tests or documents.
- **M01 remains CLOSED and M04 AIR31 remains BLOCKED / hardware experiments DEFERRED.** Physical acoustic signal identity, per-ear calibration, fail-closed routing and queued-audio mute are independent hard gates. No audio sink, playback, Android app, web UI, microphone, human subject, or live transmission is used here.

See [safety](./SAFETY.md) and [active roadmap](./ROADMAP.md).
