# SW3 — Phone microphone → Bluetooth earbud output: no-PCM route safety model

**Implemented stage:** Pure JavaScript/Node deterministic **metadata-only** policy fixture. **No live audio, Bluetooth connection, AudioTrack, microphone capture, PCM buffers, audio output callback, network, user listening or output calibration** is added. SW3 preserves the previous M03L wired-only output port untouched. User direction remains **phone built-in microphone** for input and ordinary **Bluetooth earbuds for eventual output**; earbud microphone, separate microphone and hardware POC deferred.

## Why a second model, not loosening the M03 route guard?

- M03J/M03L `packages/dsp/offline-route-safety.mjs` only accepts mock `wired-headphones` and protects synthetic sample buffers from being exposed. Altering it to allow Bluetooth would unintentionally suggest that existing synthetic sample-processing is ready for physical Bluetooth output. **It is not.**
- SW3 is a **new independent count-only policy** with no PCM argument/return/sink. An audio callback must never use this policy alone as authority to send signal to Android AudioTrack; the policy is **not a physical security boundary**.
- `packages/dsp/offline-bluetooth-output-policy.mjs` defines two **simulated** allowed endpoint kinds (`bluetooth-a2dp`, `bluetooth-le`). Bluetooth SCO/HFP is rejected as a replacement output mode because communication mode may silently change quality and routing. LE mode is only a synthetic enum here; **AIR31 was observed as available A2DP/SCO, not demonstrated to support actual LE Audio output**.

## Tested snapshot shape

Every synthetic state snapshot explicitly carries:

- observation sequence (`seq`) increasing on each chunk;
- **observed** `phone-built-in-mic` input ID, client 48 kHz mono (consistent with one SW1 phone);
- **observed** Bluetooth A2DP or LE output ID, 48 kHz stereo and per-route-generation token;
- Bluetooth connection flag, audio focus, call state, app foreground state, DSP health;
- an **externally supplied, modeled** two-ear-presence count;
- separately matching mock calibration/profile identifiers (strings, **not SPL calibration**).

No route selection request, headset icon, paired device list or previous observation alone authorizes the modeled output. Any mismatch rejects the current metadata chunk and latches a nonrecoverable model fault until explicitly reset. Missing or repeated observation sequence likewise fails stop. The strict model deliberately **requires 48 kHz input and output and two reported earbuds** as one *research fixture*, **not** as an assertion that Android must expose those facts or that all real earbuds support it.

## State machine and reconnect

`muted` → `ramping` → `active` on **fresh mock observation + explicit synthetic user start**. Ramp starts at zero and advances by supplied synthetic sample counts. **All states describe simulated authorization ONLY.**

Any routed-output change (phone speaker fallback, SCO/HFP switch, different headset, sample-rate/channel change, generation change), phone input change, Bluetooth disconnection, ear-count mismatch, telephony call, focus loss, app background/pause, timestamp discontinuity or DSP fault moves to `faulted` and clears the simulated authorization/ramp.

`faulted` → `muted` requires **explicit reset**, a new fresh mock device observation, mock profile identity and user start. No automatic reconnect or preserved ramp. A transient interrupted by one-ear removal is blocked in this conservative modeled state.

**Known physical shortcoming:** a real Android route notification might arrive *after* audio has already fallen back to the phone speaker, and some Android versions/headsets **do not expose physical earbud-presence or meaningful output delay via public API**. No quantity here establishes hardware-enforced no-speaker-fallback. A JS fail-stop flag cannot retract already queued physical output. A later native output adapter must independently enforce actual route pinning and hard mute with physical tests.

## Reproducible matrix

```bash
npm test
npm run report:sw3
```

The deterministic report `hearlens-sw3-bluetooth-output-route-policy-v1` covers normal mocked A2DP and LE routes, input/output device mismatch, A2DP→SCO/HFP changes, speaker fallback, Bluetooth disabled/disconnect, phone calls, focus/background, sample rate/channel changes, stale observations, one-ear changes, DSP underrun, capture clock, reconnect and reset. Unit tests verify failing events do not advance accepted-count metadata, synthetic permission revokes, no PCM API is exposed, and manual start is required after reset. Existing M03 and SW2-A/B tests are unchanged.

No audio heard by a user, digital fitting improvement, real-ear SPL, output loudness, Bluetooth playback latency, physical mute propagation time or codec selection can be deduced. Reports contain no raw speech, captured voice, addresses, human tests or ear output.

## Exit decision and priority

**SW3 simulator passes only when CI does.** Passing unit tests is a **software safety-policy milestone, not a safety approval**. Next efficient stage: software/API-only design and possibly a **route-observation-only Android probe with no amplified PCM output** to discover what can genuinely be observed and which properties remain inaccessible, before considering any nonhuman acoustic physical test *only if the user reauthorizes hardware POC*. If Android publicly observable signals cannot guarantee hard mute/no-speaker-fallback, the safe product may remain caption-first and use manufacturer-provided earbud transparency/hearing assistance when independently available.

Live hearing amplification is still **NO-GO** until independent physical headset-route and hard-mute validation and per-ear measured maximum ear-level output under `docs/SAFETY.md`. Hardware POCs remain deferred.
