# SW2-B — Causal six-band phase, crossover, transient and WDRC artifact characterization

**Scope:** fixed phone microphone input model (48 kHz, mono confirmed in SW1 on one Motorola); output stays **synthetic offline only**. Bluetooth earbud output remains a future requirement, not active. Earbud microphone/ODM/hardware POCs continue **deferred**. This supplements [SW2-A](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md), does not change M03 reference or authorize real-ear playback.

## What can now be characterized accurately

The SW2-A sequential residual first-order IIR can be analyzed as a **linear time-invariant system only when gains are frozen** (compression ratios = 1, final limiter inactive). For each boundary `f_k`, its exact transfer is `L_k(z)=(1-a_k)/(1-a_k z^-1)`, `a_k=exp(-2*pi*f_k/Fs)`. Each successive band is the previous residual times `L_k`, and the final band is the final residual. Complex band responses combine after their static, signed amplitude gains.

SW2-B computes an **analytic complex frequency response**, phase and **group delay from a local phase derivative**. It then validates that transfer **independently** against the direct DFT of a real processor-generated synthetic impulse. Group delay is a *frequency-dependent static-filter* property and may be **negative** at some gain shapes due to interference; it is **not total output latency** or proof of a physically advanced acoustic wave. It **does not apply unchanged to the nonlinear, time-varying WDRC compressor**.

A dense log-frequency sweep 250–8000 Hz and fixed ±5 Hz around the five crossover frequencies characterizes static response and the absence/presence of discontinuities. This alone does not establish acceptable speech tonality, low distortion, hearing-impaired speech clarity or absolute gain fitting.

## Deterministic checks

- **Flat identity:** all six or eight band gains 0 dB, magnitude 0 dB, phase/group delay nearly zero across supported test frequencies; this is *mathematical filterbank cancellation*, not realistic hearing compensation.
- **Static asymmetric profile:** six artificial gains `[0,2,4,6,3,0]` dB with boundaries `350/700/1400/2800/5600` Hz, fixed `ratio=1`. Report range of magnitude and phase/group delay, local 10-Hz crossover gain step and direct-DFT/analytic complex parity.
- **Transient causality:** delayed synthetic impulse with no pre-onset output, postcursor energy fractions (10 ms and 50 ms); output after an impulse is not equivalent to measurable psychoacoustic echo.
- **Dynamic compressor:** fixed 1100 Hz low→high→low input amplitude, 6-band synthetic compressor ratio 2, 8 ms requested attack and 180 ms requested release. Report late/early per-segment **RMS gain** rather than confusing nominal envelope parameters with clinically measured compression timing.
- **Negative tests:** invalid frequencies/parameters, six/eight band support, no browser/native microphone output/network APIs in the characterization module. No real speech data or device audio is used.

Run: `npm test`, `npm run characterize:phase`, optionally `npm run characterize:causal` for the SW2-A context. CI requires all existing M03 and SW2-A tests as well. The phase/sweep report is deterministic; prior `npm run benchmark:causal` Node host timings remain **non-gating and not equivalent to Android CPU scheduling, Bluetooth latency or acoustics**.

## Interpretation and next gate

These calculations distinguish the **zero additional future-input lookahead** of a causal stream from the nonzero static filter phase/group delay. SW2-A had shown 16 ms M03 STFT lookahead at 48 kHz (768 samples), but reducing this one algorithmic term by up to 16 ms **does not imply** that ordinary A2DP/LE earbuds are suitable for transparent face-to-face hearing.

**Decision rule:** if shaped IIR phase/group delay, wide crossovers, transient tails or compression trajectories are too irregular, **do not ship the crude first-order split**. Follow with an offline matched-fit higher-order or alternative crossover design that balances phase, response smoothness, gain error, and CPU. An existing STFT mode remains a reference, not a safety-approved path. Finish SW3 **no-PCM/no-playback** route-disconnect/state simulation before any software output-route planning. Actual acoustic output, physically verified no-speaker-fallback and independently calibrated L/R MPO are blocking; no user phone test required in SW2-B.

## First verified deterministic findings (PR #45)

[CI run 38280967933](https://github.com/edisontw/hearlens/actions/runs/38280967933) **PASS**, including the existing M03/SW2-A test suite and new SW2-B transfer/impulse/WDRC tests. The following are **software-only deterministic findings**, not physical output or human-audibility measurements.

| Synthetic metric | Result | Interpretation |
|---|---|---|
| All frozen band gains 0 dB | Transfer **0 dB** and group delay **0 ms** | Telescoping identity, independent of hardware |
| Fixed six-band gains `[0,2,4,6,3,0]` dB | Magnitude **+0.4501 to +5.0262 dB**, 250–8000 Hz | Smooth but **broad/blurred** response, not exact per-band prescription |
| Local gain step across ±5 Hz crossover positions | Maximum magnitude **0.03925 dB** at the 700 Hz boundary | No abrupt 10-Hz discontinuity in this synthetic configuration, but broad transition and phase effects remain |
| Frozen-profile **static filter** phase derivative | `−3.81708 … +1.25808 samples` (48 kHz), or `−0.07952 … +0.02621 ms` | Mathematical *group delay* of LTI filter shape, **not** total streaming latency; negative values are possible due to phase interference |
| Complex frequency response vs actual causal processor impulse DFT | Six frequency points absolute complex error **≤9×10⁻⁸** | Independent parity check of transfer equation against implementation |
| Impulse at sample 512 | **0 pre-onset energy**; nonflat setting **2.403% energy after onset sample** | Causal output with a postcursor; metric does not establish audible echo |
| Quiet→loud→quiet synthetic sine | Gain **+10.0 dB before**, **−3.02 dB late loud**, **−3.01 dB early return**, **+5.65 dB late return** | Large compression/gain recovery swing in this invented profile; recovery may be too slow for speech, **not yet validated** |
| Extra future-input DSP lookahead | STFT reference **16 ms**, causal baseline **0 ms** | Only algorithmic lookahead; radio/earbud/output route remain entirely unmeasured |

**Crucial distinction:** the small positive/negative *static-filter* group-delay numbers above are **not** a guarantee of tiny total algorithmic phase/group delay in the *active nonlinear WDRC*, nor of low-latency Bluetooth acoustic playback. `SW2` has not exercised `AudioTrack`, a Bluetooth output route, a speaker disconnect, calibrated per-ear MPO, real-world intelligibility or a person wearing headphones.

**Decision:** SW2-B analysis is complete. The first-order residual filter is still a **research baseline rather than an accepted hearing-output filter**. The broad crossover response and slow compression recovery are the major algorithmic cautions. Avoid repeated synthetic micro-optimizations until the app's phone-mic→Bluetooth-output routing and fail-closed semantics are better understood. **Next SW3:** no-PCM output-route fault simulation (A2DP/LE endpoint change, phone speaker fallback, focus/call interruption, reconnect) with no real playback. Further SW2-C filter/attack-release redesign is conditional on that route assessment. Hardware POCs stay deferred.

**Status:** SW2-B research characterization **CI PASS**, no human/real-ear listening or hardware POC.
