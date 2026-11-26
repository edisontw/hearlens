# Moto g62 zero-only AAudio route-guard result

## Result and provenance

The exact-hash runner validated and installed the permissionless physical research APK on Moto g62 5G, Android 13/API 33, `arm64-v8a`, ADB serial `ZY22FWGQTB`. The artifact was GitHub Actions artifact `15119591496`, built from source commit `ed174b677dac77a0fab1ed3c518b769b79faa723`:

- APK SHA-256: `39fcdf6744912e97ea46644cef9e037571cc03d3487c4dac67ed353387cafd16`
- Artifact archive SHA-256: `ad069cb74bac06bcb23955da99ccc0b8fb82b7daa8b9df3d63b5e060168cce84`
- Owner authorization and owner waiver records are stored outside the repository in `D:\Dev\Android\test-results\hearlens\physical-zero-callback\github-artifact-pr164-ed174b6-15119591496`.

The Activity displayed `Refused: unexpected output sink(s): type=18,id=9`. The Start control stayed disabled. The runner did not tap Start, and the app package was successfully uninstalled during cleanup. No physical AAudio stream or callback began.

## Device classification

Android's API defines type 18 as [`AudioDeviceInfo.TYPE_TELEPHONY`](https://developer.android.com/reference/android/media/AudioDeviceInfo#TYPE_TELEPHONY), a device type for transmitting audio over the telephony network. It is a system telephony sink, not a reported connected headset or other physical audio accessory. Its presence is still a possible non-local transmission route, so this run preserves the route refusal.

The captured system snapshot showed:

- No entries under AudioService `Connected devices` or `APM Connected device`.
- No communication route clients; `In ring or call: false`; `mModeOwnerPid: 0`.
- The active communication device was the built-in earpiece.
- AudioFlinger exposed telephony-TX output threads, but they were in standby with zero tracks and zero active fast tracks.

This identifies why the guard refused. It does not prove that a telephony route can never become active or establish that ignoring it would be safe. The app's external-route check remains unchanged.

## Metrics and limits

Because Start stayed disabled, callback timing, negotiated performance mode, frames per burst, XRuns, callback deadlines, and zero-sample counts are **NOT AVAILABLE**, not zero. No microphone, Bluetooth API, nonzero PCM, DSP output, or hearing output was used. The owner waived independent human review for this bounded run; no independent review is claimed as PASS. M04 REAL HEARING remains **BLOCKED / DEFERRED**.

Full device evidence, including the route inventory UI dump, AudioService/AudioPolicy/AudioFlinger diagnostics, logcat, authorization records, and updated SHA-256 manifest, is stored at `D:\Dev\Android\test-results\hearlens\physical-zero-callback\20261126-211750-824-device-9f0dc0d8`.

## Next step

Do not whitelist type 18 based only on its idle state in this snapshot. Before another physical attempt, establish whether the route can be safely excluded while AAudio remains pinned to and verifies the exact built-in speaker ID, and define fail-stop behavior if telephony or another route becomes active. Until then, keep the existing refusal and defer the physical callback run.
