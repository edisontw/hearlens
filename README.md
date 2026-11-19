# HearLens

**HearLens** is a research-oriented hearing-assistance and communication-accessibility project.

The initial product hypothesis is:

> Bringing the phone closer to the talker + low-latency captions + conservative audiogram-aware sound processing may improve everyday communication for adults with mild-to-moderate hearing difficulty.

Current work order: [active roadmap](docs/ROADMAP.md). Earlier milestone instructions are
preserved as history and should not trigger repeated field measurements.

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
- Prefer the phone built-in microphone and ordinary Bluetooth output for the existing-device feasibility study.
- Do not assume Bluetooth is low latency. Establish output detectability before attempting acoustic delay measurement.
- No new hardware purchase, mandatory wired-earbud baseline or external microphone is required for the active phase.
- No amplified microphone signal may fall back to the phone speaker if a headset disconnects.
- A final output limiter, gain ramping and per-ear safety limits are architecture requirements from the first DSP implementation.

## Repository plan

- `docs/` — product, research, safety, architecture and validation decisions
- `apps/web/` — caption-first Web MVP and browser/device diagnostics
- `packages/` — reusable hearing, audiogram, DSP and caption logic as implementation begins
- `services/gemini-token/` — MN4 ephemeral-token broker for direct Gemini Live transcription; microphone audio bypasses the VM
- `services/stt-proxy/` — optional Google Cloud streaming STT bridge for later comparison
- `tests/` — deterministic DSP vectors, device-bench protocols and human-test definitions

## Current milestone status (2026-11-19)

- **M01 captions — CLOSED / maintenance.** Owner confirmed Moto g62 Android Chrome everyday-use PASS. Do not schedule additional routine caption tests or polish work; reopen only upon a new reproducible substantial problem.
- **M03 personalized DSP — OFFLINE RESEARCH.** Audiogram, CAMFIT research targets, STFT WDRC and causal DSP prototypes exist. The causal version is not equivalent to CAMFIT-driven STFT and must not be substituted for personalized hearing output. See [2026-11-19 measured offline comparison](docs/M03_CAUSAL_CAMFIT_OFFLINE_REVIEW_2026-11-19.md).
- **M04 AIR31/A2DP — BLOCKED for open-ear live assistance; physical recording DEFERRED.** An Android playing-A2DP route does not establish earbud acoustic output or latency. No worn hearing amplification is authorized.

[Active roadmap](docs/ROADMAP.md) is the current work-order index. Older milestone handoffs and [2026-11-02 continuous-delivery policy](docs/CONTINUOUS_DELIVERY_PLAN_2026-11-02.md) are retained as historical context, not instructions to restart M01 testing or spend fixed effort percentages.

## Safety / intended use

HearLens is currently a **research prototype** for communication assistance. It is not presented as a clinically fitted hearing aid, treatment for hearing loss, or replacement for professional assessment.

See [docs/SAFETY.md](docs/SAFETY.md) before implementing any audio-output feature.

## Historical M04 software-first SW1 Android mic probe

A separate **input-only** Android diagnostic app now lives at [apps/android-mic-probe](apps/android-mic-probe/README.md). It probes actual phone/Bluetooth headset microphone routing and short foreground PCM level statistics, **without producing any output audio, saving raw speech or using network permission**. This is a development diagnostics APK, not part of the website or an approved hearing amplifier. See [M04 software-first feasibility](docs/M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md) and [SAFETY](docs/SAFETY.md). Hardware POCs remain deferred.
