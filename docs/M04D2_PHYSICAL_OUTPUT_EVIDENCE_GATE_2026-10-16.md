# M04-D2 — Physical-output evidence gate, not a playback unlock (2026-10-16)

**Starting main:** `9625aab1a2506a26d09499af8ae613e8d942506c`. This milestone makes the **remaining prerequisites executable and auditable**, rather than implementing a duplicate SW3 simulated-route policy or activating audio. It does not test actual Bluetooth latency.

## Current owner facts / no-repeat baseline

- Moto g62 Android 13 internal microphone input was observed in SW1. SW4 input clock continuity passed; occasional digital-zero amplitude intervals in uncontrolled ambient input remain a separate caution, not proof of no sound.
- AIR31 A2DP **anticipated** routing was observed in SW3 (not observed playback). It is not evidence of a safe exclusive sink or a route with no fallback.
- Offline digital limiter / gain profiles / DSP callback safety research exists, but the real Android audio output callback, headset endpoint, physical mute, independent left/right acoustic calibration and maximum output remain unavailable.
- M04-D1 real baseline from the iPhone to Realtek microphone: `direct2.wav` with 24 weak periodic chirp features; no need to repeat a `muted.wav` whose earlier 24-event train was not reliable. **Do not request another mic capture or change iPhone volume** as a prerequisite for this D2 decision.
- No Android input-only app, website, network path or output-capable DSP source was changed in D2. M01 caption service remains independent.

## Software deliverable

`tools/m04-output-safety-gate.mjs` reads a versioned **evidence manifest only**. Its current input is `testdata/results/2026-10-16-m04-output-safety-state.json`. It returns a machine-readable breakdown of the exact gates outstanding and labels each observation as software/synthetic, actual device observation, external physical measurement or calibration. It is safe to run with no Bluetooth pairing, mic, playback, or uploads:

```sh
node --test tools/m04-output-safety-gate.test.mjs
node tools/m04-output-safety-gate.mjs --evidence testdata/results/2026-10-16-m04-output-safety-state.json
```

**The output authorization fields are hard-coded `false` for ALL inputs.** Even if someone supplies a fictional full set of `PASS` physical artifacts, the most this tool can return is `EVIDENCE_COMPLETE_REQUIRES_INDEPENDENT_PHYSICAL_REVIEW`. A JSON record, file hash or successful CI job cannot prove that a microphone observed the right sound source, that AIR31 is the actual output, that no delayed phone-speaker audio escaped, or that ear-level SPL was safe. Synthetic `PASS` on a physical requirement counts as **missing**.

## Decision gate / why the next output experiment is not unlocked

These must be demonstrated before any HearLens microphone→DSP→AIR31 experimental audio output, including a test-only real-time audio loop:

| Requirement | What is known on the current Moto g62 / AIR31 |
| --- | --- |
| Built-in phone mic | SW1 field observed (not SPL calibrated) |
| Final digital limiter | M03 offline regression exists; real sink path not wired |
| Independent L/R bound and output level | Synthetic model only; no calibrated receiver response |
| Controlled soft-start/manual stop, underrun/watchdog | Model-level only |
| AIR31 truly selected for an **actively playing** output | NO: SW3 was a passive prediction |
| No unwanted phone speaker output upon A2DP disconnect | NO verified physical measurement or guaranteed atomic hardware mute |
| No leak from audio already queued to the OS when disconnect happens | NO: Android public route listener is asynchronous; software `stop/flush` is not a hardware speaker interlock |
| No leak on calls, focus loss, or output switching | NOT physically verified |
| Stable microphone/earbud acoustic feedback | NOT physically characterized |
| Independent left/right receiver-level SPL/MPO | NOT calibrated or measured |

**Architecture stop rule:** Stock Android 13 `getRoutedDevice`, a preferred device, focus callbacks and passive route audits cannot by themselves satisfy an atomic **zero phone-speaker fallback** requirement. D2 does not add another mock route simulator, because SW3 already covers those transitions. If independent physical isolation/mute on this device is unavailable, do **not** loosen the safety gate just to get a latency number. Classify S1 Moto g62 → AIR31 hearing mode **NO-GO for protected live amplification under current evidence**, while keeping AIR31 for ordinary media and keeping M01 caption assistance usable.

## Conditional future nonhuman bench (not yet authorized)

A physical bench may be designed only when a **separately independently protected route** or physically effective mute mechanism is identified and reviewed. It must isolate any unintended phone-speaker output, use a clearly observed actual Bluetooth sink, no person wearing earbuds, conservative volume, a final PCM limiter, zero auto-reconnect, a manually available stop, monitored digital clipping/dropout and acoustic feedback, and measured leakage on disconnect/call/focus/reroute **including already buffered audio**. Merely placing a mic near the earbud does not monitor the phone speaker at the same instant; a one-mic recording of ordinary chirps does not prove silence at both places. With only the existing PC Realtek microphone and without physical interlock, mark physical hard mute **unverified**, not PASS.

Once an independently protected nonhuman path exists, the existing D1 `direct/on/moved` analysis can identify an earbud-specific candidate and estimate P50/P95/jitter; the results remain uncalibrated and do not authorize a person to wear the headset. A true ear-level hearing mode needs additional calibrated output verification. No equipment purchase, new SW1–SW4 phone test or human experiment is requested by this change.

## CI and acceptance

- Run new metadata gate unit tests, including stale/duplicate evidence, synthetic route assertions, lacking artifact provenance and hypothetical full physical records (which STILL cannot authorize playback).
- Check real current evidence stays `BLOCKED`. This is the expected **PASS** condition for the software test.
- Existing Android input-only/no-output static tests and M01/M03 CI remain untouched.
