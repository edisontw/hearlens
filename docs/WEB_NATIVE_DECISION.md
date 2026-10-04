# Web vs Native Decision

## Strategy

**Web-first, not Web-only.**

Use Web for rapid validation of communication assistance and experimental signal processing. Move to native when reliability, routing or lifecycle control becomes a product requirement.

## Web MVP

Supported goals:

- microphone capture,
- large live captions,
- rolling 15–30 second transcript,
- "What did they just say?",
- microphone/device diagnostics,
- requested vs actual capture constraints,
- sample rate/channel information,
- browser latency telemetry,
- audiogram profile entry,
- experimental multiband DSP in foreground,
- research-only STT/DSP backends behind interfaces.

## Web stop conditions

Do not require Web to guarantee:

- absolute SPL on arbitrary hardware,
- fixed USB-C routing,
- low-latency Bluetooth transport,
- screen-off/background hearing,
- reliable iOS output-sink selection,
- raw synchronized phone microphone arrays,
- medical-grade hearing compensation.

## Native triggers

Move a capability to native when it needs:

- reliable output/input routing,
- robust headset attach/detach handling,
- background or screen-locked continuous hearing,
- deterministic low-latency audio,
- audio-focus/interruption recovery,
- reproducible on-device STT,
- external USB-C directional microphone control,
- LE Audio/device capability integration,
- stronger battery/thermal control.

## Platform direction

### Android

Highest-priority native target once Web proves value, because it offers a practical path to low-latency audio, USB-C reference hardware and on-device speech recognition.

### iOS

Caption Web MVP remains useful. Native iOS becomes appropriate when reliable speech recognition, audio-session routing and hearing output are required.

## Architectural rule

Reusable logic should not depend directly on browser UI APIs.

Keep domain logic separable into:

- captions/transcript state,
- audiogram/profile models,
- DSP parameter generation,
- device/calibration metadata,
- validation fixtures.

Web and native clients should consume these shared concepts rather than redefine them.
