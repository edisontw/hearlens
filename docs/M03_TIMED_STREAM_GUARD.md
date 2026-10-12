# M03 Part I — Offline sample-clock fault guard and throughput

**Scope: synthetic PCM, simulated sample-time, no live audio/output device.** This module is a test harness for the offline M03H stateful WDRC engine, not a real microphone callback, acoustic safety feature, or permission to turn on hearing amplification.

## API / contract

`createOfflineTimedWDRC(dspConfig, {deadlineSlackSamples: 256})`

- `push({startSample, samples})` takes a packet carrying its **sample offset within the current session epoch**. The first packet must start at sample 0. Every next packet must start exactly where the prior packet ended. Only finite Float32 mono PCM, 1–4096 samples, is accepted.
- `observeCaptureClock(sampleClock)` accepts a monotonic **caller-supplied simulated capture-clock sample counter**. If this clock advances past accepted source samples by more than `deadlineSlackSamples` (0–4096; default 256), the adapter signals a synthetic underrun. At 16 kHz, 256 sample units = 16 ms. This is **not** a real clock synchronization, callback-deadline certification, or a measured device-latency budget. Samples may arrive before the simulated clock in tests.
- `signalUnderrun()` explicitly faults the session when a simulated scheduler declares underflow.
- `finish()` drains the completed, continuous segment only. A faulted session cannot finish or emit new samples.
- `reset()` is the only recovery path: clear both the wrapper's sample-time epoch and underlying DSP input/overlap/gain state, and start again from sample offset **0**. No automatic crossfade, reamplification or route reconnect exists.

### Fail-stop policies

| Trigger | Fault code | Behavior |
|---|---|---|
| startSample greater than expected | `missing-samples` | Fail; discard pending DSP, emit nothing from offending call |
| startSample less than expected, retransmit or reordering | `overlap-or-reorder` | Fail; never silently de-duplicate or splice |
| malformed packet, invalid chunk/timestamp | `malformed-packet`, `invalid-chunk`, `invalid-timestamp` | Fail closed; no partial acceptance |
| capture clock runs backwards | `clock-regression` | Fail; do not infer physical clock correction |
| capture clock exceeds accepted input by configured slack | `simulated-underrun` | Fail; do not invent or time-stretch audio |
| explicit underrun signal | `explicit-underrun` | Fail |
| underlying DSP rejects the block | `underlying-dsp-rejected` | Reset internal DSP; fail |
| invalid finalization | `invalid-finalization` | Fail |

All faults reset the DSP's queued overlap/gain state before the session becomes faulted, and disallow new PCM until an explicit `reset()`. Fault count and last reason are exposed as small metadata only. **Already emitted PCM cannot be recalled.** A future real hearing-output route must separately implement immediate hardware mute, no amplified phone-speaker fallback, calibrated per-ear limits, and safe reconnect ramps. The offline fault code itself cannot mute headphones.

## Tests and reproducibility

Run `npm test` (includes `packages/dsp/offline-wdrc.timed.test.mjs`) to verify:

- Deterministic, byte-exact Float32 output agreement with original full-clip reference for valid timestamped streams, both ears and hard/smooth settings.
- Missing, repeated, overlapping and out-of-order sample ranges, invalid timestamps and wrong packet format, PCM NaN/excess amplitude, and oversize chunks all fault with **no newly returned PCM**.
- Logical capture-clock tolerance/underrun, explicit underrun and clock regression.
- Fault blocks `push` and `finish`; explicit reset permits a fresh sample epoch with independently clean gain state.
- Sustained 204,800 input samples with fixed underlying **1024-sample input and overlap rings**; no full-clip historical PCM cache.
- Both modes still enforce final post-WOLA digital ceiling.

The new benchmark `npm run benchmark:stream` runs 6 seconds of synthetic 16 kHz / 256-sample blocks by default. Optional `node tools/benchmark-offline-stream.mjs [seconds 1–12] [sampleRate 16000|24000|48000] [chunk 128|256|1024|4096]` varies the workload. It reports wall-clock CPU time, observed P50/P95/max `push` duration, and Node heap snapshots. It deliberately records **no CI acceptance threshold on timing or heap usage**, because GitHub runner capacity, V8 garbage collection and CPU contention vary. Node heap samples **do not equal allocation-per-callback or the total audio engine working set**. The sample counter is synthetic, and the measured `push` duration is **not** mic-to-ear audio latency.

## Important remaining limitations

- This is a source-sequence watchdog **model**. It is not a hardware sensor for actual microphone dropouts, OS scheduling gaps, Bluetooth jitter, device clock drift or USB headset disconnect. No concealment/safe silence frames, headset route mute or reconnect ramp has been implemented.
- The Part H engine uses reusable fixed-size PCM/WOLA rings but **still allocates FFT arrays and result buffers for every frame/chunk**. Low CPU wall-clock time on Linux alone does not guarantee glitch-free Web Audio, low battery drain, deterministic callback P95 or no garbage-collection pauses.
- A digital PCM ceiling is not an acoustic maximum output. NAL-NL2/DSL fitting and calibrated per-ear MPO are not implemented.

**Next M03 Part J:** reduce per-frame allocations and test scheduling/heap stability, then formalize a fail-closed hardware route state machine (muted until validated route and calibration; fail immediately when route is lost). Preserve M01 captions; do not retest HTC distance benchmarks in response to an offline DSP change.
