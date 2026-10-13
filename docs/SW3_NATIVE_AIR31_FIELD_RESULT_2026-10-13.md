# SW3-Native field result — Motorola moto g62 5G + AIR31 (2026-10-13)

**Gate:** PASS for **passive Android output-route prediction** only. **No speech, microphone capture, active output, Bluetooth acoustic latency measurement, hard mute or physical speaker-fallback test.** Do not treat this as a real-time assistive hearing output pass.

## Supplied device and app evidence

| Field | User-provided value |
|---|---|
| Schema | `hearlens-sw1-input-probe-v1` (existing metadata envelope; no new report schema) |
| Android / phone | motorola moto g62 5G; API 33 / Android 13 |
| App | `probe_build=20261013-sw3-native-v0.2.0` |
| Session date | 2026-10-13, approximately 12:56:56–12:57:02 UTC+08:00 |
| Flags | `onlyMetadata=true`, `noPCM=true`, `noOutput=true` |
| Input endpoints reported available | Two `BUILTIN_MIC` entries (#15, #16), an AIR31 `BLUETOOTH_SCO#140` and other device types; **none was used for recording in this session** |
| Available output endpoints (not actual routes) | `BUILTIN_SPEAKER#3`, `BLUETOOTH_SCO#138` AIR31, **`BLUETOOTH_A2DP#135` AIR31**, and additional types |
| Available communication output list | Speaker and SCO observed; separate from media route predictions |
| `UNPROCESSED_advertised` | `false` — unchanged SW1 observation |

### Three consistent Android API 33 predictive route observations

| Local time UTC+8 | Query trigger | `USAGE_MEDIA+SPEECH` anticipated route | `USAGE_ASSISTANCE_ACCESSIBILITY+SPEECH` anticipated route |
|---|---|---|---|
| 12:56:56.547 | `activity-resumed` | **AIR31 `BLUETOOTH_A2DP#135`** | **AIR31 `BLUETOOTH_A2DP#135`** |
| 12:56:57.074 | `devices-added` | **AIR31 `BLUETOOTH_A2DP#135`** | **AIR31 `BLUETOOTH_A2DP#135`** |
| 12:57:02.327 | `user-button` | **AIR31 `BLUETOOTH_A2DP#135`** | **AIR31 `BLUETOOTH_A2DP#135`** |

The same logs print `SW3_COMMUNICATION_SELECTED_NOT_MEDIA_ROUTE=BLUETOOTH_A2DP#135`. This is a **separately observed communication-device value**; do not infer that it certifies a playing media track or that A2DP microphone capture was used. The listed **available communication devices** included SCO, not a verified active media playback stream. No need for extra HFP/SCO microphone testing.

At each predictive sample, the explicit negative evidence is:

```text
SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK;
speaker_fallback_prevention=NOT_VERIFIED;
bluetooth_codec_latency=NOT_MEASURED;
true_earbud_wear_state=UNKNOWN
```

## Conclusion and next decision

1. **PASS:** The versioned APK, metadata-only action and Android 13 predictive API work. Both media/speech and accessibility/speech queries consistently predict AIR31 A2DP. No additional user field capture is needed to establish this observation.
2. **NOT ESTABLISHED:** Actual `AudioTrack.getRoutedDevice()` during real playback; nonhuman acoustic A2DP delay; true microphone→ear elapsed time; codec, jitter or buffering; device ear-worn state; synchronous Android hardware mute; real speaker fallback suppression; SPL/MPO. Available list and predictive result are **not active output-route verification**.
3. **Architecture:** Keep phone built-in microphone as the primary future capture source; keep ordinary Bluetooth earbuds as the desired future output. No headset microphone, external microphone, or extra phone voice experiment required from this field result.
4. **Efficient next engineering step:** software/API design for *actual* native playback-route verification and hardware mute/fail-stop requirements **without producing amplified PCM**. Determine where Android native APIs alone cannot guarantee physical no-speaker fallback, and identify the earliest product GO/NO-GO decision. A future **physically instrumented nonhuman output test** remains conditional on explicit user change of priority and is not approved by this result.
5. The SW3 model and M03/STFT/SW2 causality, route and per-ear acoustic calibration gates are **unchanged**. **Live hearing amplification remains PARKED.**

Related: [SW3-Native scope](./SW3_NATIVE_ANDROID_OUTPUT_OBSERVABILITY_2026-10-13.md), [SW3 no-PCM policy](./SW3_BLUETOOTH_OUTPUT_FAIL_CLOSED_MODEL_2026-10-13.md), [Safety](./SAFETY.md).
