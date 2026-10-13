# SW3-C — Native output-route control boundary and passive fault audit (2026-10-13)

## Decision and scope

**Software-only stage. No playback or amplified hearing output.** This phase follows the verified SW3-Native v0.2.0 AIR31/Motorola Android 13 field result: both MEDIA/speech and ACCESSIBILITY/speech were *anticipated* to route to AIR31 A2DP. That field gate is complete; do **not** repeat it. Phone **built-in mic** remains the intended input and ordinary **Bluetooth headphones** the preferred future output. Do not revive earbud-mic/SCO, external microphone or hardware POC as part of this change.

**Engineering decision:** On stock Android public APIs, there is no demonstrated atomic contract that *both* (1) locks an app's media PCM exclusively to an A2DP/LE headset and (2) physically prevents any already-queued or newly rerouted audio from reaching a phone speaker during A2DP loss. Therefore a route prediction or even a late route-change event **cannot authorize hearing playback**. The current status is **NO-GO for live amplification**. This does not mean Bluetooth is ruled out for the product or for captions; it means actual physical route and calibrated output remain separate gates.

## What Android can and cannot establish (API 33 baseline)

| Android API | Available evidence | Cannot establish |
| --- | --- | --- |
| `AudioManager.getDevices(GET_DEVICES_OUTPUTS)` | Available/attached sink IDs/types | Selected media sink, physical mute or speaker isolation |
| `AudioManager.getAudioDevicesForAttributes()` (33+) | Anticipated sinks for MEDIA / ACCESSIBILITY speech | A playing track's **actual** route; route stability |
| `AudioTrack.setPreferredDevice()` (23+) | Preferred output **request** | Exclusive media-route lock; guaranteed actual device |
| `AudioTrack.getRoutedDevice()` (23+) | Current route *when track is actually playing* | Silent pre-play validation; race-free hard mute or full multi-sink proof |
| `AudioTrack.getRoutedDevices()` (36+) | All known currently routed devices *when playing* | Applicable to Motorola Android 13/API33 (it is not) or hard mute |
| `AudioRouting.OnRoutingChangedListener` (24+) | Notification that a playing track's route changed | A synchronous pre-reroute callback or draining/kill of queued Bluetooth audio |
| `AudioDeviceCallback` (23+) | Audio device connected / disconnected | Every logical media-route switch; notification before speaker fallback |
| `AudioManager.requestAudioFocus()` / focus-change listener | Focus ownership and change notifications for a requesting app | Physical output route, earbud-worn state, mute guarantee |
| `AudioManager.getMode()` | Coarse audio mode hint | Reliable call lifecycle/focus or physical headset path |
| `setCommunicationDevice()` (31+) | Communication route selection for communication use | Locking MEDIA/speech to A2DP |

Android references: [AudioManager](https://developer.android.com/reference/android/media/AudioManager), [AudioTrack](https://developer.android.com/reference/android/media/AudioTrack), [AudioRouting](https://developer.android.com/reference/android/media/AudioRouting), [AudioDeviceCallback](https://developer.android.com/reference/android/media/AudioDeviceCallback).

**Important distinction:** Even a future `getRoutedDevice()` observation obtained after deliberately starting playback is **not** an atomic, hardware-level safeguard against speaker fallback. App-side `pause/stop/flush`, silence injection or software volume muting cannot retrospectively remove physical sound already passed into OS/Bluetooth/output queues. Android audio policy, device callbacks and thread scheduling are outside the third-party app's absolute control. There is no justified "zero leakage" claim here. Testing these effects would require a separately authorized *nonhuman*, acoustically instrumented experiment.

## SW3-C code delivered

A pure-Java `PassiveRouteAudit` in the separate `apps/android-mic-probe` diagnostic APK:

- No `AudioTrack`, `MediaPlayer`, output PCM, sound generation, audio-focus request, network upload or DSP-to-headset bridge.
- Manual start of a **30-second silent** prediction watch; 1-second polls while foreground, plus existing device-added/removed checks. Ends automatically. Does not affect the M01 caption app.
- First sample requires exactly one matching anticipated Bluetooth sink for both MEDIA/speech and ACCESSIBILITY/speech, in normal OS audio mode. Support in this *observation-only policy* is A2DP and `BLE_HEADSET` if reported; it does not imply AIR31 supports LE Audio.
- Device-ID/type change, predicted speaker, missing/ambiguous route, divergent media/accessibility predictions, non-normal mode, repeated observation sequence or app background latches `FAULTED` until **explicit user reset**. In particular reconnect never silently clears an earlier fault.
- `COMPLETE` means only a stable *prediction-window observation*; it does not certify output or quiet speaker. An immutable `outputAuthorized() == false` is tested in each significant policy state.
- Emits bounded local metadata; no capture is necessary, and the prior field result is not invalidated. The old optional SW1 mic test remains available but is not required.

The native audit is intentionally distinct from SW3's independent JavaScript synthetic 48-kHz/ear-count/profile route policy. It exercises **Android-specific evidence limitations**, never feeds a route credential to M03/SW2, and cannot transition a DSP stream to output.

## Verification, known limits, next gate

Run `node --test tools/test-sw1-no-output.test.mjs`, the Java JDK-only `PassiveRouteAuditTest` fault matrix and `gradle --no-daemon -p apps/android-mic-probe assembleDebug` in Android Actions. The workflow outputs a *versioned debug APK*; this is **not** an instruction to install or re-run the AIR31 field experiment. The CI pass establishes code/static checks and a valid build, **not** real-world route protection.

Remaining unverified: real active playback route, concurrently routed multiple outputs on API33, physical speaker leakage during A2DP loss, stop/mute reaction time, queued PCM behavior, acoustic E2E latency and L/R ear-level SPL/MPO. Also: one-second passive polls can miss transient changes and cannot reveal a playing media route that never existed in the probe. Neither stable audit samples nor an Android media-volume value means the headset is calibrated.

**Future separate authorization gate:** If revisited, first draft a dedicated isolated *nonhuman physical test* with a calibrated left/right acoustic setup and a speaker-nearfield microphone, prove headset-only actual playback and fail-closed leakage bounds on connect/disconnect/call/route-switch, and measure lag before any audiogram WDRC output. Do not infer safety from this audit, from `setPreferredDevice`, or from `AudioTrack.getRoutedDevice`. Until then retain **caption-first** and no live audio amplification.
