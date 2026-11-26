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

## Read-only Motorola policy follow-up (2026-11-26)

A later, read-only ADB snapshot was collected from the same serial `ZY22FWGQTB`; it did not install an APK or open a stream. The device identified as Motorola moto g62 5G, Android 13/API 33, `arm64-v8a`. `adb shell cat /vendor/etc/audio_policy_configuration.xml` succeeded. In the primary module, the vendor file lists `Telephony Tx` under `attachedDevices`, sets `Speaker` as `defaultOutputDevice`, and declares the only `Telephony Tx` mix route with sources `voice_tx,incall_music_uplink`. This is device-specific static configuration evidence that type 18 can appear in inventory while a MEDIA speaker route remains separately defined. The AOSP Coral policy is only a comparison and is not used to infer Motorola behavior.

The accompanying current `dumpsys audio` reports no call (`In ring or call: false`), `mModeOwnerPid: 0`, no connected external outputs, and the built-in earpiece as active communication device. `dumpsys media.audio_policy` labels Port ID 9 as `Telephony Tx`, shows `STRATEGY_CALL_ASSISTANT` selecting TELEPHONY_TX, and reports a zero global active count for the telephony output mix profiles. AudioDeviceInfo ID 9 from the earlier app UI and AudioPolicy Port ID 9 are distinct identifier namespaces; the matching number does not establish a shared device ID. The call-assistant selection is another reason the APK must only recognize type 18 as system communication inventory and must never target it.

The new isolated ZERO_ONLY route policy therefore permits the static type-18 inventory entry only when both mode reads are `MODE_NORMAL`, the API 33 `USAGE_MEDIA` prediction returns exactly one speaker matching the unique inventory speaker, no other sink is present, and AAudio reports the same selected device ID before start and during the run. It fail-stops on mode, inventory, prediction, generation, lifecycle, disconnect, or actual-ID changes and does not reopen. This is a conditional policy, not a hardware-route guarantee. The synthetic route tests and ARM64 build do not exercise the new policy on-device. The old APK authorization and waiver do not cover a rebuild; no new stream has been authorized or started.

Read-only evidence files and hashes are kept at `D:\Dev\Android\test-results\hearlens\telephony-route\20261126-231400-187`.
