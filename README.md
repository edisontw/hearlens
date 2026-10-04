# HearLens

**HearLens** is a research-oriented hearing-assistance and communication-accessibility project.

The initial product hypothesis is:

> Bringing the phone closer to the talker + low-latency captions + conservative audiogram-aware sound processing may improve everyday communication for adults with mild-to-moderate hearing difficulty.

## Product direction

HearLens is **caption-first**, not a browser-based replacement for a hearing aid.

The project is intentionally split into three capability layers:

1. **Caption Assistant** — live captions, a rolling recent transcript, "What did they just say?", and guidance to place the phone closer to the sound source.
2. **Experimental Hearing DSP** — per-ear audiogram profiles, multiband processing, WDRC and a final limiter. This remains experimental unless the input/output path is calibrated.
3. **Calibrated Hearing Compensation** — supported hardware, measured SPL, reliable routing, low-latency/background operation and clinical validation. This is expected to require native applications and a medical-device quality/regulatory pathway.

## MVP principles

- Web-first, but **not Web-only**.
- The browser is used to validate captions, UX, device diagnostics and experimental DSP.
- Do not claim absolute ear-level SPL on uncalibrated hardware.
- Do not depend on browser background/screen-off execution for a production hearing path.
- Do not use Bluetooth as the reference low-latency hearing path.
- Initial calibrated hardware work should use a small supported-device matrix, beginning with a specified Android phone + wired USB-C earbud.
- No amplified microphone signal may fall back to the phone speaker if a headset disconnects.
- A final output limiter, gain ramping and per-ear safety limits are architecture requirements from the first DSP implementation.

## Repository plan

- `docs/` — product, research, safety, architecture and validation decisions
- `apps/web/` — caption-first Web MVP and browser/device diagnostics
- `packages/` — reusable hearing, audiogram, DSP and caption logic as implementation begins
- `services/stt-proxy/` — server-side Google Cloud streaming STT bridge; cloud credentials never belong in browser code
- `tests/` — deterministic DSP vectors, device-bench protocols and human-test definitions

## Current status

**M01 — Caption Hearing Lab**

The Web Hearing Lab is runnable on GitHub Pages. Current work focuses on:

- microphone permission and capture diagnostics,
- requested vs. actual audio constraints,
- device/sample-rate/latency information,
- caption backend abstraction with Browser SpeechRecognition as an optional fallback,
- a server-side Google Cloud streaming STT benchmark path,
- rolling recent-caption state,
- large-text senior-friendly interaction.

Live hearing amplification is deliberately not the first feature.

## Safety / intended use

HearLens is currently a **research prototype** for communication assistance. It is not presented as a clinically fitted hearing aid, treatment for hearing loss, or replacement for professional assessment.

See [docs/SAFETY.md](docs/SAFETY.md) before implementing any audio-output feature.
