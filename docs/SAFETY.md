# Safety

Safety requirements apply from the first audio-output implementation.

## Intended use during research

HearLens is currently a research-oriented communication-assistance prototype. It is not presented as a replacement for a clinically fitted hearing aid or as treatment for hearing loss.

## Population boundary for self-fit research

Initial self-fit experiments should be restricted conservatively to adults with stable mild-to-moderate hearing difficulty.

Professional evaluation path / exclusion from self-fit MVP includes:

- severe or profound hearing loss,
- sudden hearing change,
- marked unilateral/asymmetric loss,
- suspected conductive or mixed loss without professional assessment,
- concerning ear symptoms,
- unusually low uncomfortable-loudness tolerance.

## Mandatory audio safety controls

Any live hearing-output implementation MUST include:

1. final output limiter after all other processing,
2. per-ear maximum gain,
3. controlled gain ramp on start,
4. controlled ramp on reconnect,
5. immediate hearing-path mute on headset disconnect,
6. **no automatic amplified output to the phone speaker**,
7. clipping detection,
8. audio underrun/watchdog logging,
9. supported-device and calibration-profile identifiers,
10. requested and actual AGC/AEC/noise-suppression state logging,
11. independent left/right profiles,
12. regression tests proving no processing stage can bypass the final limiter.

## Calibration truthfulness

On uncalibrated hardware:

- a digital limiter can constrain digital full scale,
- it cannot guarantee ear-level dB SPL,
- digital filter gain is not REIG,
- a calculated profile is not real-ear verification.

Do not label uncalibrated processing as clinical fitting.

## Privacy defaults

- Audiogram: local storage where feasible.
- Transcript: memory-only rolling buffer by default.
- Audio recording: off by default.
- Cloud STT: disclose clearly before use.
- Analytics: no raw speech by default.
- Do not collect identity fields that are unnecessary to the function.

## Fail-safe principle

When route state, calibration state or audio constraints are uncertain, captions may continue but hearing amplification must fail closed.
