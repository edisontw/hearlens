# SW2 — Phone-microphone-first software-only DSP latency ceiling (2026-10-12)

**Scope/priority:** The user selects phone **built-in microphone** as the main capture source, **everyday Bluetooth earbuds** as future output; earbud microphone/SCO and new hardware POCs are parked. SW1 phone microphone worked at an observed Android 13 **48 kHz, mono** client/device format. See [SW1 field evidence](./SW1_FOLLOWUP_PHONE_MIC_PRIMARY_2026-10-12.md). This SW2 stage is *100% synthetic/offline*; there is **no Android AudioTrack, Bluetooth stream, microphone-to-ear audio, calibration or human listening test** in this change. Existing M03WDRC is unchanged.

## Engineering question

Before spending more time refining M03's 1024/256 STFT reference: how much **strictly algorithmic input lookahead** can a simpler phone-side DSP remove, what does this cost in filter coloration and WDRC behavior, and which parts of the overall latency cannot be improved by changing DSP alone?

### Comparison scope

| Property | Existing M03H–L reference | SW2 alternate research processor |
|---|---|---|
| Algorithm | 1024-point 256-hop WOLA/STFT synthetic WDRC, optional smooth bin weighting | Sequential first-order IIR low-pass/residual splits, synthetic per-band envelope + gain compression |
| Six or eight bands | Both in M03 | Both (5 or 7 user-supplied ordered split frequencies) |
| Explicit delay from lookahead at 48 kHz | **768 samples = 16.000 ms** | **0 samples = 0 ms future-data lookahead** |
| Frequency-dependent phase/group delay | Must be characterized | **Exists** for nonflat filter gains; **not zero** simply because no block lookahead |
| Signal/spectral quality | M03E/F has synthetic seam findings, not yet production-grade | Crude first-order crossover; exact unity-gain sum via telescope but nonuniform slope/phase, **not production-grade** |
| Dynamic processing | M03 synthetic 50/65/80 dB SPL anchors with synthetic dBFS reference and temporal smoothing | Synthetic downward compression ratio 1–4 with dBFS-only threshold, attacks 2–100 ms, releases 20–2000 ms; **not comparable fitting law** |
| Input/output | Synthetic supplied Float32 PCM, no hardware sink | Synthetic supplied Float32 PCM, **no device access** or sink |
| Final limiting | Digital post-DSP ceiling only | Digital post-sum clamp, **not dB SPL nor acoustic MPO** |
| Valid equivalence inference | **Cannot compare fitting/clinical benefit** between different algorithms/target laws | Can compare basic reconstruction, numerical stability, CPU observation and *additional sample buffering only* |

An identical 48 kHz audio signal is used in the offline report. The new causal split has no delay queue and returns exactly one sample per input sample. **That does not demonstrate zero filter delay**: IIR filters have phase-dependent delay and broad nonideal crossover responses; every OS capture/output callback, hardware DAC, Bluetooth codec/transmission, packet buffer and earbud DSP/render also contributes delay.

### First-order reconstruction mechanism

For consecutive boundaries \(f_1,\ldots,f_{B-1}\), each band is a low-pass response of the previous residual, with the last band being the remaining residual. For each sample, \(y=\sum_b g_b x_b\). If every gain equals unity, the sum telescopes to the input (up to floating-point rounding), and no FFT/full-frame delay is needed. As soon as gains differ, filterbank phase, wide transition regions and residual interactions change timbre. **Do not classify this as a complete transparent/open-ear hearing-aid filterbank.**

No NAL-NL2/DSL formula, audiogram-to-SPL conversion, calibrated output nor user-hearing gain is constructed. The synthetic compressor is deliberately independent of prior prescription anchor data to prevent mistakenly interpreting uncalibrated dBFS as dB SPL.

## Reproducible evidence

Source:
- [packages/dsp/offline-causal-wdrc.mjs](../packages/dsp/offline-causal-wdrc.mjs): isolated per-ear causal 6/8-band research unit, persistent reused state, prevalidated independent Float32 source/destination, final digital limiter, fail-stop/reset.
- [packages/dsp/offline-causal-wdrc.test.mjs](../packages/dsp/offline-causal-wdrc.test.mjs): identity at unequal chunk sizes including one-sample chunks, impulse, independent left/right, reset determinism, simulated level-dependent WDRC, limiter and negative checks, no live audio APIs.
- [tools/characterize-sw2-causal.mjs](../tools/characterize-sw2-causal.mjs): deterministic machine-readable report with *zero-buffer* reference, synthetic flat vs asymmetric-gain tone responses and impulse energy-centroid **explicitly NOT frequency-dependent group delay**; optional Node host timing comparison.
- Existing M03 code and CI synthetic reports are preserved.

Run:
~~~bash
npm test
npm run characterize:causal
npm run benchmark:causal
~~~

The baseline deterministic report is gated in GitHub CI. The first successful run (2026-10-12; [PR #44 CI run 38271890743](https://github.com/edisontw/hearlens/actions/runs/38271890743)) produced the following **synthetic mathematical** observations at 48 kHz:

| Probe | Recorded result | Meaning |
|---|---:|---|
| Flat, zero-dB gains, 250–8000 Hz | **0.0000 dB** at every 10 tested tone frequencies | Verified synthetic unity reconstruction; does **not** validate different gain shapes |
| Shaped six-band test, 250 Hz | **+0.4501 dB** | Nonideal broad filter transition for invented shape |
| Shaped six-band test, 1400 Hz | **+4.1408 dB** | Crossover coloration must still be assessed |
| Shaped six-band test, 2800 Hz | **+5.0257 dB** | Synthetic tone response, not target-prescription accuracy |
| Shaped six-band test, 8000 Hz | **+3.6057 dB** | Interactions across sequential residual bands |
| Shaped impulse energy centroid | **0.1007 samples** | NOT group delay, acoustic latency or proof of transparent response |

There is no physical Bluetooth stream, no measured headset latency and no output safety approval. CPU/heap/timing probes are **non-gating, host-specific**; Node Linux values cannot be represented as Android callback P50/P95 or Bluetooth acoustic timing. The two candidate algorithms use **different** computational formulas and gain laws and are **not** matched-compression fittings. To evaluate actual artifact audibility, future work needs a calibrated output-safe audio test and listening methods; no present user retest is needed.

## Honest latency budget

\[
T_{\rm mic\to ear}=T_{\rm acoustic+ADC}
+T_{\rm OS,capture}
+T_{\rm DSP,buffer/lookahead}
+T_{\rm DSP,compute}
+T_{\rm OS,playback}
+T_{\rm Bluetooth,codec+transport}
+T_{\rm earbud,buffer+DAC}.
\]

What we can substantiate now:
- **Known synthetic/reference component:** M03 extra lookahead = **16 ms at 48 kHz**, assuming real 48 kHz in that M03 rendering path.
- **Candidate property:** SW2 causal extra *future-input* lookahead = **0 ms**. Input capture is still performed in frames/chunks and group delay is frequency-dependent.
- **Unknown:** all actual radio/earbud and physical E2E components. Codec frame durations and Android \`AudioRecord.getTimestamp\` alone do not provide physical acoustic E2E. Existing AIR31 output was only **listed available**, never probed as active PCM playback route.
- **Cannot conclude:** that a possible 16-ms DSP gain makes Bluetooth low-latency enough for open-fit conversational amplification, or that it solves direct-sound plus delayed electronic-sound interference. In many routes, phone/BT buffering could dominate, but its magnitude is **not measured here**.

Keep digital limiting distinct from absolute calibrated ear-level SPL. The first-order research prototype is useful to establish a **software algorithmic lower bound and signal quality tradeoff**, not a ready-to-use hearing assistant.

## Safety and scope gates

1. No real microphone connection and **no Bluetooth/audio output**; no change to existing M01 caption or M03 synthetic paths.
2. No unverified phone-speaker fallback, no unclipped calibration shortcut, no assumption that digital full scale bounds real ear dB SPL. See [SAFETY.md](./SAFETY.md).
3. Preserve synthetic model failing closed on invalid float PCM and requiring explicit reset; static tests prohibit device capture/output/network APIs.
4. Next SW2 follow-up should **investigate IIR cross-band phase/group delay, sweep coloration, transient artifacts, low CPU per callback, and stricter compression-envelope behavior**, and decide if a better multiband crossover is justified — **without user recording repeats**. Then SW3 can simulate input→Bluetooth-output route interruption policy with **no playback**. No user-hardware POC is reactivated.
5. If software-only limitations mean real-time transparent hearing cannot be validated, retain captions and optional known first-party transparency; do not claim medical-grade hearing output.

**Decision: GO for algorithm characterization / further software-only refinement; NO-GO for claims of true Bluetooth low-delay acoustic hearing, per-ear MPO or human-use playback.**
