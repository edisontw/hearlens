# Moto g62 zero-only AAudio test — owner review package

**Status: ORIGINAL EXACT-APK OWNER AUTHORIZATION RECORDED; OWNER WAIVED INDEPENDENT HUMAN REVIEW FOR THAT BOUNDED RUN; PHYSICAL STREAM NOT RUN.** The runner installed and launched the authorized APK, but the visible Start control was disabled by its route guard, so it opened no AAudio stream. The runner removed the APK and captured evidence. A diagnostic update is being prepared; any rebuilt APK requires fresh exact-hash owner authorization. The waiver is not represented as a completed review. The emulator-only callback lab still rejects physical devices in native code, Android instrumentation and its fixed-serial PowerShell runner; those checks remain unchanged.

## Proposed bounded test

Target only the already identified Moto g62 5G: model `Moto g62 5G`, Android 13 / API 33, `arm64-v8a`, ADB serial `ZY22FWGQTB`. The physical-device test must be a separate zero-only research build and runner. It must not reuse an emulator bypass flag or mutate the existing emulator runner's serial.

1. Before installation, verify `adb -s ZY22FWGQTB get-state`, model, API, ABI, exact APK SHA-256 and that no other target serial can be selected by the invocation. Every ADB command must include `-s ZY22FWGQTB`.
2. The separate physical app declares no permissions and has no microphone capture, `AudioRecord`, Bluetooth APIs, network, production Web caption code, NativeSession, Auto-FIR or fixture. It uses output-only AAudio and read-only built-in speaker metadata from `AudioManager`.
3. This build supports only `ZERO_ONLY`. For every callback, it clears the full provided stereo output buffer to zero, scans every sample and fail-stops on invalid data or a nonzero sample. There is no DSP or synthetic PCM component in the APK.
4. Do not auto-select Bluetooth or request a Bluetooth route. The app refuses to start if any external output device appears in read-only `AudioManager` metadata. It requests the exact built-in speaker device ID, then verifies `AAudioStream_getDeviceId()` before starting. It refuses to start on any mismatch and stops if the selected built-in speaker disappears. It does not call a Bluetooth API.
5. The native session is hard capped at 60 seconds. The visible screen has Start and Stop controls; leaving the foreground requests stop, and `adb -s ZY22FWGQTB shell am force-stop org.hearlens.physicalzero` is the external recovery command. It stops on callback deadline overrun, callback overlap, invalid callback data, stream error/disconnect, unexpected route, nonzero output, XRun or metric capacity exhaustion. It requests stop, waits for terminal state and zero callbacks in flight, closes the stream, then persists evidence from the application thread.
6. The report captures requested and negotiated rate, format, route, performance/sharing modes, usage, frames per burst, buffer size/capacity, frame histogram, callback wall/thread-CPU/inter-arrival statistics, callback overruns, XRun count and observations, fail-stop reason, stop/close/drain outcomes, logcat and audio diagnostics. APK, result and log SHA-256 values are saved to a fresh timestamped directory. There is no fixture SHA because this zero-only APK contains no fixture. Runtime callback allocation monitoring is not claimed; the report gives a source-level audit and its limits.

This is a digital-zero callback experiment, not a listening test, hearing assistance, a safety proof for any future nonzero output, or a release of the M04 gate. Do not wear headphones or connect the phone to AIR31/Bluetooth for this test. The callback emits only zero-valued samples; startup/shutdown acoustic transients are not measured or certified.

## Authorization and review gate

The owner must explicitly approve all of the following in the test record:

- Opening an output-only AAudio stream on the named Moto g62 (serial and device identity above), including routing it to the built-in output device for up to 60 seconds.
- The exact APK SHA-256, test source commit, maximum duration and the stop/fail-stop behavior described above. This APK's only workload is ZERO_ONLY; no NativeSession workload can be selected.
- Confirmation that this is a zero-sample callback research test and does not authorize microphone use, Bluetooth APIs/routes, audible playback, headphone listening or live hearing output.

The exact-APK owner authorization record is present. The owner then explicitly instructed us to skip the separate independent human review for this one bounded run. The resulting waiver record is bound to the same APK SHA-256, source commit, device serial and zero-only scope. No independent review is claimed or recorded as PASS. The runner accepts either a valid independent review or this explicit owner-waiver record; it always requires exact-hash owner authorization and retains the device, permission, route, duration, zero-output and teardown checks. The waiver does not authorize microphone use, Bluetooth, audible content, DSP output, listening, or any future hearing test.

The records stay in the local evidence directory and should not be committed with the app. Use these field shapes after reviewing the final APK:

```json
{
  "owner": "owner identity",
  "approved": true,
  "approvedAtUtc": "ISO-8601 UTC timestamp",
  "authorizationText": "I approve the zero-only, built-in-speaker AAudio callback test on Moto g62 serial ZY22FWGQTB for at most 60 seconds using this exact APK SHA-256 and source commit.",
  "deviceSerial": "ZY22FWGQTB",
  "model": "Moto g62 5G",
  "api": 33,
  "abi": "arm64-v8a",
  "testMode": "ZERO_ONLY",
  "maxDurationSeconds": 60,
  "requestedRoute": "BUILTIN_SPEAKER_ONLY",
  "apkSha256": "64 lowercase hexadecimal characters",
  "sourceCommit": "40-character commit SHA",
  "allowMicrophone": false,
  "allowBluetooth": false,
  "allowAudiblePlayback": false,
  "allowDspOutput": false
}
```

```json
{
  "reviewer": "independent reviewer identity, different from owner",
  "reviewStatus": "PASS",
  "reviewedAtUtc": "ISO-8601 UTC timestamp",
  "reviewEvidence": "PR review URL or durable review record ID",
  "deviceSerial": "ZY22FWGQTB",
  "apkSha256": "same 64-character APK SHA-256",
  "sourceCommit": "same 40-character commit SHA",
  "reviewedAreas": [
    "isolated_arm64_build",
    "permissionless_manifest",
    "zero_output_callback",
    "builtin_speaker_route_refusal",
    "fixed_device_scope",
    "hard_duration_cap",
    "visible_stop_and_background_stop",
    "callback_allocation_audit",
    "stop_drain_close",
    "evidence_capture"
  ]
}
```

For this run, the records are stored outside the repository under `D:\Dev\Android\test-results\hearlens\physical-zero-callback\github-artifact-pr164-707ff5a-830ff182d3e4467a96e5747d7e437bf4`:

- APK SHA-256: `afd6eca9bb54b288998fcef5ec1245ca912ba6e8a8233cb302d1dcc532fcf194`
- Source commit: `707ff5a58ce46234d1adae271d74d30a7a32c5ab`
- Device serial: `ZY22FWGQTB`
- Owner authorization record SHA-256: `c88ee9cbc006e3d5a19cc96098bd20a5c264fe5ad779110bc567629fe02889fc`
- Owner review-waiver record SHA-256: `1a20cfa9898da6e4ebac2d2dbd49c6925fe5d60fc0a6cd7e7c4805743099f3bf`

These records authorize only the bounded zero-only test above for the listed APK and commit. That APK was installed and launched, but its route guard disabled Start; no physical stream was opened. The APK was removed after the attempt. A rebuilt APK is not covered by these records.

## Read-only Motorola vendor-policy evidence

Read-only ADB inspection of the Moto g62 read /vendor/etc/audio_policy_configuration.xml. Motorola lists Telephony Tx as attached, Speaker as the default output, and routes the telephony sink from voice_tx and incall_music_uplink. AudioPolicy diagnostics showed CALL_ASSISTANT selecting TELEPHONY_TX while the telephony output mix had zero active count; AudioService reported no call or connected external output. AudioDeviceInfo ID and AudioPolicy Port ID are separate namespaces even when both display 9. This evidence supports inventory-only classification of TYPE_TELEPHONY, but does not guarantee a future physical stream route.

The subsequent conditional guard requires MODE_NORMAL, a unique API 33 MEDIA-predicted built-in speaker matching the inventory speaker, generation checks around open/start, and matching AAudio-reported device IDs. During the bounded run, these observations matched speaker ID 3 while telephony ID 9 remained inventory-only. The API/AAudio observations do not guarantee physical hardware routing.

## Current state

## Read-only Motorola vendor-policy evidence

Read-only ADB inspection of the Moto g62 read /vendor/etc/audio_policy_configuration.xml. Motorola lists Telephony Tx as attached, Speaker as the default output, and routes the telephony sink from voice_tx and incall_music_uplink. AudioPolicy diagnostics showed CALL_ASSISTANT selecting TELEPHONY_TX while the telephony output mix had zero active count; AudioService reported no call or connected external output. AudioDeviceInfo ID and AudioPolicy Port ID are separate namespaces even when both display 9. This evidence supports inventory-only classification of TYPE_TELEPHONY, but does not guarantee a future physical stream route.

The subsequent conditional guard requires MODE_NORMAL, a unique API 33 MEDIA-predicted built-in speaker matching the inventory speaker, generation checks around open/start, and matching AAudio-reported device IDs. During the bounded run, these observations matched speaker ID 3 while telephony ID 9 remained inventory-only. The API/AAudio observations do not guarantee physical hardware routing.

## Current state

PR #166 adds the conditional type-18 inventory handling and route-generation/AAudio-ID monitors. Its CI artifact 15133694776 (source b955623892e212706eaec8cb47d672fc8a9389f3, APK SHA-256 8738f264db84c08aa98a2f364a126c45894f2a0a282b39331f599137adaf0dc7) completed one exact-hash owner-authorized 60-second ZERO_ONLY run on Moto g62 serial ZY22FWGQTB. The observed MEDIA prediction and AAudio-reported device ID both matched built-in speaker id 3 while TYPE_TELEPHONY id 9 remained inventory-only. All digital output samples were zero, no XRuns or callback deadline overruns occurred, and stop/drain/close/uninstall completed. The exact-hash owner waived independent review; no independent review PASS is claimed. These observations do not guarantee physical hardware routing or establish hearing safety. Evidence is at D:\Dev\Android\test-results\hearlens\physical-zero-callback\20261127-183347-715-device-85479390. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
