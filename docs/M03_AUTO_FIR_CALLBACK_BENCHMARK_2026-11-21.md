# M03 offline stereo Auto-FIR callback benchmark

## Reproduce

From this revision, with Node 22 or later:

```sh
git worktree add --detach ../hearlens-m03-baseline 321ac62cc6e6279da81e34f1dd5222bba09aec50
node --expose-gc tools/benchmark-m03-auto-fir.mjs ../hearlens-m03-baseline > m03-auto-fir.json
npm test
```

The argument loads the original direct-convolution FIR from the baseline worktree. Omitting it runs the current implementation and STFT reference. The benchmark processes 4.16 s of warm-up followed by 32 s of synthetic 48 kHz stereo PCM per row. It repeats the integration fixture with a 137-sample offset on the right. Each callback times both ears sequentially using prebuilt input views and reusable destinations. The detector-only case includes nominal level reads, and FIR-only includes retargeting on the same 480-sample clock using prefetched detector readings. Full Auto-FIR invokes the real adapter. The STFT case uses the M03 stateful WOLA reference with smooth crossover, the same target fixture and limiter, and the same numerical detector time constants and nominal RMS reference. STFT applies its time constants to gain, while Auto-FIR smooths detector energy and then crossfades coefficients.

Mean, nearest-rank P95/P99 and max are wall time. RTF is summed callback wall time divided by 32 s. A deadline miss is a callback exceeding its nominal audio duration. Process CPU time includes measurement and GC overhead during the loop. Memory values are process-wide, with the fixture, harness and input views already present before processor construction. Peak is sampled every 64 callbacks and at the end. Explicit GC brackets timing, with an additional post-run GC reading. The JSON includes all memory snapshots. Benchmark values characterize this host and workload, without audio device scheduling or acoustic measurements.

## Latency and storage

The 513-tap FIR has a 256-sample (5.33 ms) frozen-gain group delay and zero future-input lookahead. Retargeting uses a 480-sample (10 ms) clock and a 50 ms coefficient transition, which can restart midfade. The STFT uses 1024/256 frame/hop sizes, with 768 samples (16 ms) of hop-relative lookahead. Its first output hop requires 1024 input samples (21.33 ms) before accounting for callback boundaries. These describe different aspects of software latency.

The persistent FIR typed-array backing stores for two ears plus one shared basis total 45,144 B in the direct implementation and 28,768 B in the symmetric implementation. Full Auto-FIR adds 672 B for detector/control typed arrays. The two STFT processors retain 100,660 B of typed arrays for their windows, rings, bins, gains and scratch. These counts exclude JS objects, caller buffers and temporary allocations.

## Measured host results

Node v24.22.3 on linux/x64, Intel Xeon Platinum 8573C. The 128/480/1024 sample cases contain 12,000/3,200/1,500 measured callbacks per row and have 2.667/10/21.333 ms budgets.

| Samples | Stereo workload | Mean ms | P95 ms | P99 ms | Max ms | RTF | Misses | CPU ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 128 | Detector only | 0.0209 | 0.0235 | 0.0727 | 0.5527 | 0.00782 | 0 | 278.5 |
| 128 | FIR only, symmetric | 0.2519 | 0.3361 | 0.5291 | 4.3874 | 0.09448 | 2 | 3071.8 |
| 128 | FIR only, direct | 0.6274 | 0.8049 | 1.1263 | 8.0756 | 0.23527 | 8 | 7545.3 |
| 128 | Auto-FIR, symmetric | 0.2825 | 0.3762 | 0.6016 | 3.1693 | 0.10594 | 2 | 3419.9 |
| 128 | Auto-FIR, direct | 0.6472 | 0.8206 | 1.1536 | 4.8769 | 0.24270 | 7 | 7796.9 |
| 128 | STFT | 0.0729 | 0.1945 | 0.2768 | 2.7368 | 0.02733 | 1 | 890.2 |
| 480 | Detector only | 0.0762 | 0.1127 | 0.2057 | 1.5141 | 0.00762 | 0 | 259.0 |
| 480 | FIR only, symmetric | 0.9734 | 1.2628 | 2.1990 | 5.6362 | 0.09734 | 0 | 3131.7 |
| 480 | FIR only, direct | 2.4158 | 2.9560 | 4.5006 | 12.6835 | 0.24158 | 1 | 7752.4 |
| 480 | Auto-FIR, symmetric | 1.0832 | 1.4562 | 2.2736 | 3.6939 | 0.10832 | 0 | 3491.6 |
| 480 | Auto-FIR, direct | 2.5077 | 3.1293 | 4.5150 | 18.8798 | 0.25077 | 3 | 8050.1 |
| 480 | STFT | 0.2805 | 0.4023 | 0.6122 | 10.7429 | 0.02805 | 1 | 925.1 |
| 1024 | Detector only | 0.2079 | 0.3182 | 0.4634 | 1.7891 | 0.00975 | 0 | 317.1 |
| 1024 | FIR only, symmetric | 2.0652 | 2.4967 | 4.5855 | 11.1926 | 0.09680 | 0 | 3104.8 |
| 1024 | FIR only, direct | 5.0734 | 5.8327 | 7.8711 | 16.6724 | 0.23781 | 0 | 7619.2 |
| 1024 | Auto-FIR, symmetric | 2.1514 | 2.5497 | 3.1201 | 4.1023 | 0.10085 | 0 | 3234.6 |
| 1024 | Auto-FIR, direct | 5.1886 | 5.9294 | 7.0323 | 34.6794 | 0.24321 | 1 | 7787.8 |
| 1024 | STFT | 0.5907 | 0.7371 | 1.0206 | 5.8285 | 0.02769 | 0 | 886.4 |

| Samples | Stereo workload | heapUsed start → sampled peak (MiB) | arrayBuffers start → sampled peak (MiB) |
| ---: | --- | ---: | ---: |
| 128 | Detector only | 7.882 → 12.020 | 14.404 → 14.404 |
| 128 | FIR only, symmetric | 7.986 → 16.026 | 14.419 → 14.419 |
| 128 | FIR only, direct | 7.986 → 16.060 | 14.423 → 14.423 |
| 128 | Auto-FIR, symmetric | 8.019 → 16.085 | 14.419 → 14.419 |
| 128 | Auto-FIR, direct | 8.029 → 24.084 | 14.423 → 14.423 |
| 128 | STFT | 8.055 → 24.035 | 14.499 → 14.499 |
| 480 | Detector only | 5.864 → 21.725 | 14.339 → 14.339 |
| 480 | FIR only, symmetric | 5.880 → 21.937 | 14.355 → 14.355 |
| 480 | FIR only, direct | 5.906 → 21.627 | 14.359 → 14.359 |
| 480 | Auto-FIR, symmetric | 5.936 → 21.762 | 14.355 → 14.355 |
| 480 | Auto-FIR, direct | 5.934 → 21.887 | 14.359 → 14.359 |
| 480 | STFT | 5.930 → 20.662 | 14.435 → 14.435 |
| 1024 | Detector only | 5.492 → 21.061 | 14.330 → 14.330 |
| 1024 | FIR only, symmetric | 5.543 → 20.760 | 14.346 → 14.346 |
| 1024 | FIR only, direct | 5.513 → 21.229 | 14.350 → 14.350 |
| 1024 | Auto-FIR, symmetric | 5.543 → 20.910 | 14.346 → 14.346 |
| 1024 | Auto-FIR, direct | 5.545 → 21.412 | 14.350 → 14.350 |
| 1024 | STFT | 5.574 → 21.458 | 14.426 → 14.426 |

## Gain dynamics and equivalence

For a 1 kHz tone stepping from 0.006 to 0.08 peak at 1 s and returning at 2 s, the table shows 10 ms RMS gain in dB. FIR output is aligned by 256 samples. STFT output is already indexed to the input timeline, before its emitted-prefix availability delay.

| Window start (ms) | Left Auto-FIR | Left STFT | Right Auto-FIR | Right STFT |
| ---: | ---: | ---: | ---: | ---: |
| 900 | 4.696 | 4.221 | 7.696 | 6.917 |
| 1000 | 4.685 | 3.790 | 7.685 | 6.681 |
| 1010 | 4.621 | 3.503 | 7.621 | 6.448 |
| 1030 | 4.415 | 3.277 | 7.415 | 6.263 |
| 1050 | 4.216 | 3.218 | 7.216 | 6.214 |
| 1100 | 3.831 | 3.197 | 6.831 | 6.197 |
| 1900 | 3.196 | 3.197 | 6.196 | 6.197 |
| 2000 | 3.200 | 3.194 | 6.200 | 6.195 |
| 2050 | 3.201 | 3.385 | 6.201 | 6.385 |
| 2100 | 3.218 | 3.539 | 6.218 | 6.539 |
| 2250 | 3.303 | 3.901 | 6.303 | 6.901 |
| 2500 | 3.477 | 4.271 | 6.477 | 7.271 |
| 2900 | 3.759 | 4.540 | 6.759 | 7.540 |

At 1.9 s, the two algorithms agree within 0.002 dB in both ears. In this stimulus STFT reduces gain faster on the up-step and recovers faster on the down-step. At 2.9 s it has recovered about 0.78 dB more in either ear. The algorithms have distinct level estimation, smoothing and overlap behavior, so timing ratios and gain traces describe this specific comparison.

The original six basis responses differ from their mirrored coefficients by at most 7.77e-15 in Float64. The optimization stores one half plus the center and uses a duplicated history ring for contiguous paired reads. The mirrored halves have the same raised-cosine retargeting at every sample. Pairing cuts the convolution from 513 to 257 multiplications per sample per ear. The change is isolated to the FIR core.

| Ear | Input | Max absolute Float32 output error | RMS error |
| --- | --- | ---: | ---: |
| left | Integration fixture | 4.27e-15 | 4.98e-16 |
| left | Gain-step tone | 5.24e-16 | 5.98e-17 |
| right | Integration fixture | 6.02e-15 | 7.05e-16 |
| right | Gain-step tone | 1.86e-09 | 4.91e-12 |

Both inputs are bit-identical across 128/480/1024 partitions within the symmetric implementation. Integration tests also exercise one-sample and 4096-sample partitions, interleaved ears with one side silent, reset and fail-stop. The existing FIR regression covers midfade retargeting, impulse delay, static targets and digital clipping.

## Decision and handoff

Keep the symmetric FIR. Full Auto-FIR uses 56–59% less mean callback wall time and isolated FIR uses about 60% less across the three sizes. STFT still uses about 3.6–3.9× less process CPU time than symmetric Auto-FIR in this host run. Its persistent DSP backing stores are larger, and it buffers future input. The two 128-sample Auto-FIR misses remain visible in the benchmark.

For the next offline phase, repeat the callback-tail measurements across hosts and with synthetic workloads that stress sustained and rapidly changing retargeting. Use the STFT gain-step traces to distinguish the effect of detector smoothing from coefficient transitions. This phase covers offline synthetic PCM exclusively. The digital limiter bounds sample amplitude. Safe SPL requires separate acoustic evidence.
