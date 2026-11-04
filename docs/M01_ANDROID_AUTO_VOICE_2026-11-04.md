# M01 Android Auto capture reliability (2026-11-04)

## Evidence and decision

The owner reported that ordinary Android Auto sessions showed measurable microphone PCM
but no captions in repeated start/stop attempts (>5 s each), while switching to the
Far/Noisy preset yielded captions. In later Auto excerpts, input RMS was about
-20 to -21 dBFS and the limiter's over-ceiling sample percentage was 0%, so
low input volume and over-ceiling samples alone cannot explain the failures.
The observed 5-second `stop-flush-timeout` is a stop-drain wait, not recording length
or proof that Gemini failed. Exact platform/capture root cause remains unproven.

Before this change, the Auto preset used `raw` (requested AEC/NS/AGC off), while
Far/Noisy used `voice` (requested AEC/NS/AGC on). These are capture
*requests*; actual browser track settings remain logged, and the OS may not honor
every request. Auto was not an acoustic scene classifier.

## Implementation and compatibility

- Auto uses `voice` capture on detected Android User-Agent or Android
  Client Hints platform; iOS, iPadOS, desktop and unknown platforms retain
  the previous `raw` default. No device model allowlist or runtime
  mic/codec switch is claimed.
- `?preset=far-noisy` still selects `voice` on all platforms for
  backward compatibility, even when equal to Android Auto.
- `?capture=raw` and `?capture=voice` remain explicit research
  overrides, take priority over the platform default, and display
  Custom in the existing preset UI. Reset Auto clears overrides.
- Adaptive normalization stays unchanged; this is a capture policy
  change, not a new gain boost or an audio playback feature.
- Diagnostics continue to log requested versus actual capture settings,
  audio first chunk, and transcript events.
- Passive advisory: after first streamed audio, at least 15 seconds
  and six speech-active level reports with no recognized text, show
  a non-fatal hint. It never switches capture, reconnects, or silently
  restarts the microphone. Silence, short sessions, or a text event
  suppress the warning; the hint resets with each session.

## Verification and next evidence gates

- Automated regressions: Android Auto -> voice; iPhone/iPad/desktop Auto -> raw;
  Far -> voice; explicit raw override wins; tuned Android Auto retains voice;
  warning avoids silence/short sessions and clears after text or reset.
- CI and deployment must pass before calling the code delivered.
- No further broad volume/distance sweep is requested. One ordinary
  user-started everyday Android caption session on the new deployed
  build is enough to evaluate whether the failure is mitigated.
- If Android Voice still fails, capture the first-chunk, actual mic
  settings and Gemini send/response events; do not raise gain by default.
- A true scene-aware Auto would require a separate, evidence-gated design
  and cross-device outcome benchmarks. This patch does **not** implement one.

This is caption-only code. It does not change hearing amplification, output
routing, Bluetooth latency, calibration or the safety hard gates.
