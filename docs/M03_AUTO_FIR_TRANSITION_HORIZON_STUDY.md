# M03 Auto-FIR transition horizon study

This is an offline synthetic 48 kHz study on the PR #145 fixed-basis stereo Auto-FIR. The optional `transitionRetargetPolicy: "fixed-horizon"` setting keeps the 50 ms coefficient transition on its original sample-clock horizon while replacing the transition destination with each new detector target. It is opt-in. The existing default, `"restart"`, remains unchanged.

## Reproduce

```sh
node tools/characterize-m03-transition-horizon.mjs > transition-horizon.json
node --test packages/dsp/offline-dynamic-fir.test.mjs packages/dsp/offline-auto-fir.integration.test.mjs
```

Both policies process the same 12 s, 1 kHz PCM signal. The peak amplitude is 0.006 until 4 s, 0.08 from 4–6 s, then 0.006. Auto-FIR receives targets from the real synthetic six-band detector every 480 samples. FIR output is aligned by its fixed 256-sample delay before analysis. The midpoint is halfway between the 3 s and 5.5 s steady gain measurements. Midpoint timing has 10 ms window resolution.

Transient residual is the energy left after fitting and subtracting the 1 kHz fundamental from each aligned 10 ms output window, expressed relative to fundamental RMS power in dBc. The report gives the arithmetic mean of window dB values, the dB of mean residual power, and the worst window. It includes intended gain modulation and filter sidebands. It is a comparable signal metric for this fixture, without a perceptual acceptance threshold. Gain pumping is peak-to-peak and standard deviation of 10 ms gain estimates during the 5.0–5.9 s high-level hold. The monotonicity check counts 10 ms gain reversals larger than 0.02 dB. The code also checks output ceiling, left/right independence, callback partitions and reset/fail-stop.

## Gain and transient results

Both ears produced the same dynamics within rounding. Their absolute target gain traces differ by 3 dB, as expected from the separate fixture profiles.

| Retarget policy | Attack midpoint | Release midpoint | Attack residual, mean power | Attack worst window | Release residual, mean power | High-hold gain pumping |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Restart each target (current default) | 90 ms | 1,180 ms | -51.41 dBc | -39.22 dBc | -31.60 dBc | 0.000079 dB peak-to-peak |
| Preserve original 50 ms horizon | 30 ms | 1,080 ms | -43.53 dBc | -31.63 dBc | -31.60 dBc | <0.000001 dB peak-to-peak |

Both gain traces were monotonic at the 0.02 dB criterion. The candidate advances the attack midpoint by 60 ms and the release midpoint by 100 ms. It raises aggregate attack residual power by 7.88 dB and the worst-window residual by 7.59 dB. Release transient residual is essentially unchanged. The high-hold gain ripple is negligible for both policies.

The candidate's sample peak stayed below the 0.3 digital ceiling in this signal and did not trigger the limiter. The dedicated regression also drives bounded extreme PCM into the candidate and verifies clipping, fail-stop, and reset. Both ears remain isolated. Output is bit-identical across callback partitions of 1, 128, 480, 1024 and 4096 samples. The mode does not buffer future input. Frozen-gain group delay remains 256 samples.

## Decision

**NO-GO for changing the default transition policy.** The method materially shortens the response but the attack sideband residual also rises on this tone. The study establishes the tradeoff and preserves the candidate behind an explicit offline research option. A broader stimulus set and a meaningful transient quality criterion are not yet available to justify enabling it by default. No clinical or listening claim follows from these synthetic measurements.

## Architecture summary

The PR #145 comparison used the same stereo synthetic workload on Node 24.22.3. Its independent callback means were 0.282, 1.083 and 2.151 ms for the symmetric FIR at 128, 480 and 1024 samples. The stateful STFT means were 0.073, 0.280 and 0.591 ms. Thus, STFT used roughly 3.6–3.9 times less host CPU in that run.

| Property | Auto-FIR | Stateful STFT reference |
| --- | --- | --- |
| Fixed-gain signal delay | 256 samples, 5.33 ms | 768-sample hop-relative input lookahead, 16 ms |
| Earliest frame output | causal input with FIR delay | needs 1024 samples, 21.33 ms of input, before callback boundaries |
| Persistent stereo DSP typed-array backing stores | about 29,440 B, including detector | about 100,660 B |
| Gain update behavior | 480-sample detector/control clock and coefficient morph | 256-sample hop gain estimate and WOLA overlap |
| Step response in the earlier comparison | 50 ms FIR coefficient transition plus detector smoothing | STFT envelope and gain smoothing |

STFT is faster on this host and has a smaller nominal input-block delay than its first-output requirement suggests. It consumes more persistent typed-array storage and its gain-step trajectory differs from Auto-FIR. The existing FIR remains a compact, causal option for this offline software comparison. These machine-dependent timings do not establish mobile callback reliability.

No actual audio route or playback was used. The digital limiter bounds sample values and does not establish safe SPL.
