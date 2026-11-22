# M03 Auto-FIR tail latency and gain follow-up

Base checkout: live GitHub main at `6a7850c40e93fe037435cb4b3af5e494145d6450`, including PR #145. All runs use disconnected, synthetic 48 kHz PCM.

## Reproduce

```sh
node --expose-gc tools/investigate-m03-auto-fir.mjs > tail.json
node tools/investigate-m03-auto-fir.mjs --dynamics > dynamics.json
```

The Linux tail probe runs eight fresh stereo processor pairs, each with 4.16 s warm-up and 12,000 measured unpaced 128-sample callbacks. It reuses input views and output buffers with the PR #145 integration fixture. Deadline is 2.667 ms for both ears combined. V8 GC events are joined to callback wall intervals. Linux task runtime and runnable waiting from `/proc/thread-self/schedstat` bracket each callback and also cover the adjacent timer and proc measurement overhead. The probe preserves raw miss evidence and cgroup snapshots. An off-CPU gap without runnable-wait accounting gives an unresolved scheduling or other off-CPU cause. On-thread overrun can include runtime or native overhead. It does not independently identify DSP instructions.

The original run recorded two deadline misses and a 3.169 ms maximum. It retained neither callback timestamps nor GC and scheduling data, so the original events cannot be assigned causes retrospectively. The preliminary Node thread-CPU probe produced per-callback CPU readings that could exceed wall time by milliseconds on the cloud sandbox. The results below use Linux task counters instead.

## Gain response decomposition

The 1 kHz fixture holds 0.006 peak for 4 s, 0.08 for 2 s and then returns to 0.006. The detector-off case substitutes the real detector's premeasured steady-state six-band vectors at the same 10 ms control clock. This isolates the response of the complete detector path, including its fixed bandpass and power averaging, alongside the configured 15 ms attack and 400 ms release. The zero-transition case uses the real FIR with the current target frozen per block and replays the preceding 512 input samples into its delay line. The full factorial case reproduces the actual Auto-FIR PCM exactly.

Midpoints refer to the first 10 ms RMS window that crosses halfway between the steady gains of 4.696 and 3.195 dB, aligned by the 256-sample FIR group delay. A 0 ms crossing means the first 10 ms observation window already crossed.

| Detector | FIR coefficient transition | Attack midpoint | Release midpoint |
| --- | --- | ---: | ---: |
| Steady-state vectors | Instant | 0 ms | 0 ms |
| Steady-state vectors | 50 ms | 80 ms | 70 ms |
| Real 15/400 ms detector | Instant | 10 ms | 1,080 ms |
| Real 15/400 ms detector | 50 ms | 90 ms | 1,180 ms |

At 50 ms after the up-step, detector-only smoothing yields 3.226 dB and the full path yields 4.216 dB. Repeated 10 ms commands restart the FIR morph toward its target, so the effective attack transition can exceed 50 ms even with immediate detector targets. On release, the detector is the dominant contribution. Its 400 ms coefficient operates on power, which then passes through a logarithmic level conversion, band limits and target gain mapping before the measured 1,080 ms gain midpoint. The morph adds about 100 ms to that release midpoint in this fixture.


## 128-sample callback tail

Runs use Node v24.22.3. The table reports the average of eight run means, the median of eight run P99s, and the maximum callback across all runs. Each row measures 96,000 callbacks.

The cloud sandbox's task counters were sometimes batched even with `schedstat`. A reading with runtime or runtime plus runnable wait exceeding callback wall time by more than 0.25 ms is flagged and excluded from timing attribution. The small allowance covers the adjacent reads and clock boundary mismatch. Wall-based miss counts include all callbacks. GC overlap is recorded independently of task-clock consistency.

| Host and load | Mean (ms) | Median run P99 (ms) | Worst (ms) | Misses |
| --- | ---: | ---: | ---: | ---: |
| Cloud Xeon 8573C, no added load | 0.359 | 0.799 | 10.039 | 114 / 96,000 |
| GitHub Ubuntu x64, Xeon 8370C | 0.299 | 0.339 | 0.960 | 0 / 96,000 |
| GitHub Ubuntu ARM64, CPU model unreported | 0.300 | 0.320 | 0.757 | 0 / 96,000 |
| Cloud Xeon 8573C, one pinned core shared with a busy process | 0.716 | 4.607 | 88.975 | 8,377 / 96,000 |

The ambient cloud rerun recorded 124 GC events in measured periods, with zero overlap among the 114 misses. Three misses had 2.30–2.40 ms of recorded runnable wait and would fit the deadline after subtracting that wait. Eight more had an off-CPU gap without enough recorded runnable wait to assign the cause. Thirteen were flagged as on-thread candidates, and 90 had inconsistent task clocks. Batched task accounting limits the confidence of individual on-thread assignments. Treat those as candidates for profiling rather than established DSP overruns.

The independent GitHub x64 and ARM64 runs each observed 130 GC events and no misses. On these two machines the retarget callback means were 0.309 and 0.311 ms, compared with 0.295 and 0.296 ms for the other callbacks. Their observed retarget increment was about 0.013–0.015 ms. In the ambient cloud run, retarget callbacks represented 26.7% of the workload and 27.2% of the misses. These data do not show a concentration of misses at the control update.

The pinned-core run used `taskset -c 0` for both the Node process and one continuous `yes >/dev/null` competitor. It was run before the probe started emitting the total GC-event count. The per-miss records show 63 GC overlaps, nine runnable-wait cases and 27 other off-CPU-gap cases. Most misses had inconsistent scheduler counters, so a per-cause rate for that stress run would be misleading.

[GitHub x64 and ARM64 run with raw traces](https://github.com/edisontw/hearlens/actions/runs/44928726679)

## Interpretation

The Linux ARM64 result reproduces the server throughput range. The single-core contention test shows that favorable unloaded throughput can coexist with deadline failures when scheduling time is constrained. Neither environment exercised an Android runtime, mobile processor power states, sustained device thermals or an actual mobile callback scheduler. Those factors remain unresolved for mobile applicability. A future device measurement can retain the synthetic-only scope by running the pure processor with a headless harness and collecting scheduler traces.

The follow-up adds research tooling and documentation. No production timing or gain settings were altered. It uses offline synthetic PCM without audio output.
