# M03 Part J — Scratch reuse and synthetic-only route safety model

**Research scope: no microphone/earphone route, no actual hardware mute, no safe acoustic output.**

## 1. Reuse DSP numerical scratch

\`packages/dsp/offline-wdrc.stateful.mjs\` reuses four typed buffers across all frames per engine: 2 × 1024 FFT real/imag, and 2 × 6–8 band detector-energy/gain arrays. Resetting real/imag and detector energy at the beginning of each frame preserves the reference FFT/WOLA numerical sequence. Existing exact Float32 reference regression checks still run in CI for both ears, Hard/Smooth, and 16/24/48 kHz. An additional longer irregular-chunk test ensures parity after sustained scratch reuse. Original \`renderOfflineWDRC\` remains untouched.

This removes **these four per-frame Float64Array allocations only**. It does **not** remove allocations for each returned chunk, array-of-output samples, \`targetGainAtInput\` structures, other normalized target lookups, garbage collection, or scheduling jitter. Do not claim total allocation freedom or true hardware latency improvement. The existing non-gating \`npm run benchmark:stream\` is a Node22/Linux batch compute probe and records P50/P95 as observations, not clinical, platform, battery, or callback eligibility thresholds.

## 2. Synthetic route authorization simulation

\`packages/dsp/offline-route-safety.mjs\` implements an **independent pure state machine** (\`createOfflineRouteSafetyModel\`) that returns metadata only, **not audio PCM and not a Web Audio device controller**.

State flow: \`muted\` → (mock wired-headphone route identifier) → (mock calibration/profile identifiers) → explicit simulated user arm → \`ramping\` (factor starts at zero) → \`active\`. Every input route change, speaker/unknown route, lost route or underlying-DSP fault forces \`faulted\` with simulated authorization false and factor zero. There is **no automatic reconnect**: explicit \`reset\`, new supported route, fresh mock attestation and explicit user arm required. Simulated ramp can advance only through explicit bounded sample counts.

Important distinction: \`syntheticOutputAuthorized\` and \`mockRampFactor\` are **pure-model variables**. This code does **not** mute a real device, select headphones, monitor physical disconnect, validate a calibration ID externally, determine ear SPL or output a production limiter/MPO. The mock \`syntheticOnly: true\` flag deliberately distinguishes fixture metadata from genuine clinical or device calibration.

### Fail-closed model gates

- A phone speaker, unknown route kind or route change can never become authorized under the model.
- No route, missing mock calibration/profile, a mismatched ID, or no explicit start denies simulated output.
- Start and restart ramp from zero; loss or underlying failure removes authorization synchronously in this in-memory model.
- Reconnection after a fault requires reset and full attestation again.
- Passing model tests does **not** establish measured muting latency, fail-safe speaker routing or acoustic protection.

## Next milestone

M03 Part K should measure allocation hotspots and sustained-run performance with realistic Web Audio callback shapes, define the real route-specific adapter contract and *then* implement physically verified wired-headphone disconnect handling, start/reconnect ramp, and independent calibrated per-ear output/MPO. All mandatory controls in [SAFETY.md](./SAFETY.md) remain blocking for real amplification.

M01 captions, Gemini STT, browser capture presets and Github Pages are untouched; no phone distance-matrix retest required.
