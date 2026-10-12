# SW3-Native — Passive Android output-route observability (no playback)

**Primary product path:** phone built-in microphone input → future phone Native DSP → preferred everyday Bluetooth earbuds **output**. Earbud microphone input, separate microphones, forcing phone near talker, hearing-device ODM and all hardware POCs are deferred by user decision.

**Important:** This adds **Android system-route prediction only** to the existing separate `apps/android-mic-probe` diagnostic APK. It **does not create, start or route AudioTrack/MediaPlayer, generate an output test tone, call any DSP audio-output API, upload or persist microphone PCM, or enforce a physical mute**. Existing 30-second input-only recording capability is unchanged and optional. M01 web captions remain untouched.

## Android APIs and claims by strength

| API & range | What the app logs | Evidence limit |
|---|---|---|
| `AudioManager.getDevices(GET_DEVICES_OUTPUTS)` — API 23+ | List of **connected/available** output endpoints, including phone speaker or A2DP when present | Not the output route currently being used by this app or another app |
| `AudioManager.getAudioDevicesForAttributes(AudioAttributes)` — **API 33+** | **Anticipated outputs** for `USAGE_MEDIA + CONTENT_TYPE_SPEECH` and `USAGE_ASSISTANCE_ACCESSIBILITY + CONTENT_TYPE_SPEECH`, queried without creating an audio track | Routing *prediction*, not a playing AudioTrack's observed actual route; may change after query/while playing |
| `AudioManager.getCommunicationDevice()` — API 31+ | Currently selected **communication** device | This is not necessarily the **media / accessibility** playback route |
| `AudioManager.registerAudioDeviceCallback()` — API 23+ | Input/output-device **added/removed** notifications; query prediction again | Only device-list changes, **not all** system output-route changes; notification can arrive after a physical audio reroute |
| `AudioRecord.getRoutedDevice()` during capture | Active **microphone input** route (existing SW1) | Does not reveal headphone/speaker output route |
| `AudioTrack.getRoutedDevice()` during playback | Potential actual route **for a playing output track** | **NOT performed:** this APK constructs no AudioTrack; no live hearing output allowed |

Verified Android references: [AudioManager](https://developer.android.com/reference/android/media/AudioManager#getAudioDevicesForAttributes(android.media.AudioAttributes)), [AudioTrack route](https://developer.android.com/reference/android/media/AudioTrack#getRoutedDevice()), [AudioDeviceCallback](https://developer.android.com/reference/android/media/AudioDeviceCallback). The Android 13 device used in SW1 is Motorola moto g62 5G, API 33, and AIR31 listed A2DP/SCO among available endpoints. **No SW3-Native field result on that device exists yet.**

Because this is prediction-only, the JSON log deliberately includes `SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK`, `speaker_fallback_prevention=NOT_VERIFIED`, `bluetooth_codec_latency=NOT_MEASURED` and `true_earbud_wear_state=UNKNOWN`. No `active_output=AIR31` or `fail-safe speaker-mute PASS` claim is allowed.

## User-visible diagnostic

The updated Android debug app now contains a passive **「檢查媒體輸出預測（完全不播放）」** button and clearly labeled result text distinguishing **available**, **anticipated** and **actual/unknown**. It refreshes on Activity resume and on Android device-added/removed callbacks. On Android below API 33 it reports `UNAVAILABLE_API_BELOW_33` rather than making an unsupportable route claim. The app does not assume prediction is a guarantee that phone-speaker fallback cannot happen.

An independent SW3 metadata-only route safety simulator remains in [SW3 policy report](./SW3_BLUETOOTH_OUTPUT_FAIL_CLOSED_MODEL_2026-10-13.md). The Android prediction snapshot is **not** wired into that simulator as a trustworthy route credential. It is also not used to authorize the M03 or SW2 DSP to play sound.

### Minimal optional field gate on the previously tested phone

When convenient, the user can install the **new** input-only debug build, connect AIR31 in normal listening mode, open the probe and tap **「檢查媒體輸出預測（完全不播放）」**. Sharing the JSON once is sufficient for software observability. **Do not play speech, start the microphone recorder, measure STT accuracy, test HFP/SCO, remove a worn earbud, create an audio loop, or change distances.** All SW1 observations remain valid. No user field action is needed for this PR's code/CI acceptance.

## Small correctness fixes made alongside this feature

- Preserve selected input ID when repopulating the spinner after permissions/device-list changes, rather than silently reverting the visible choice to the default.
- Restore the prior Android communication mode even if a selected headset microphone's communication-route request was refused. This is a cleanup correction for the old optional input path, **not** renewed priority for headset microphone tests.

## Safety exit and next decision

The build and static tests verify that the APK remains **silent**. They cannot verify what Android would route to a *currently playing* AudioTrack or physically prevent any audio burst when A2DP disconnects; even media-route predictions and device-added/removed callbacks have a race with physical playback.

**Decision:** keep uncalibrated hearing amplification **NO-GO**. After software-only API/probe review, determine whether a trustworthy native output routing/hard-mute mechanism is possible; until a dedicated nonhuman acoustic and physical speaker-fallback proof plus independent measured per-ear MPO is approved, *do not start sound output*. The user has deferred such hardware POCs. Captions remain the tested usable feature.
