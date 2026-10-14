# M04-C1 — Existing phones, PC and microphones only (2026-10-14)

**User constraint (2026-10-14): do not propose purchasing or requiring extra unavailable hardware.** Available/claimed assets: existing Android phone(s), a PC, a **3.5 mm PC-input wired microphone**, and a **Bluetooth microphone**. Exact PC input topology, Bluetooth microphone type/receiver and simultaneous capture capabilities are UNKNOWN until inspected. AIR31 remains the preferred *receiver*, not a required microphone. No new equipment, SDK/ODM or external microphone requirement for daily users.

**Decision: NO-GO for live hearing amplification and for claiming a real Bluetooth mic→ear latency value.** This is an equipment-constrained, zero-purchase plan, not authorization for test-tone playback, on-ear output, live audio routing, or procurement. Preserve the [mandatory output protections](./SAFETY.md).

## What can be done now with existing hardware, without playing sound

1. On the PC, use system **Sound → Input / Recording devices** to identify the exact wired input (3.5-mm MIC vs LINE IN), number of independently recordable channels, reported sample rates, and Bluetooth-microphone device name/type. Check whether both are available as *separate* input devices. This passive inventory does not require recording, speaker output or installing a special app.
2. Record an optional short **consensual, non-personal** local speech/room sample using the wired mic and an existing OS recorder, only if useful to check that it is functional and not clipped. Do not upload real speech by default, infer dB SPL from dBFS, change the Android hearing app, or run another M01/SW1–SW4 validation.
3. Record mic/OS/device/profile metadata only: PC OS/build, device names, wired input channel count, recording format, Bluetooth microphone connection category (headset HFP vs dedicated receiver), and whether it becomes a different audio profile when active. Skip any unavailable detail.
4. If each mic yields an independent recording stream, treat them as **two unsynchronized recorders**, even if files begin together or software shows aligned tracks. USB/analog PC input, Bluetooth receiver, Windows mixer and radio buffers can have different sample clocks and offset/drift. **Do not combine into pseudo-stereo WAV** for `tools/analyze-m04-acoustic-wav.py`. That analyzer is intentionally valid only for real simultaneous stereo PCM from *one clocked recording ADC*.
5. Bluetooth Classic **headset** microphones commonly invoke HFP rather than A2DP when opened, modifying playback route/quality. This is a special caveat only for a headset microphone; a dedicated Bluetooth wireless microphone with its own USB or analog receiver can behave differently. Keep AIR31 output profile and phone built-in microphone preference distinct. Source: [Microsoft Bluetooth Classic Audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio).

## Feasibility of proposed zero-purchase tests

| Goal | Equipment-constrained answer | Evidence label |
|---|---|---|
| Show PC wired mic works and inventory local/BT input capabilities | YES, passive OS settings and optional local recording | Input functionality only |
| Show PC Bluetooth mic and analog mic sample-synchronized | **NO, not established by simultaneous app recording**. Require proof of common capture clock or external synchronization | UNKNOWN |
| Measure actual Moto g62 phone-mic → processing → AIR31 receiver acoustic latency | **NO** until a protected *nonhuman* live path exists; current SW4 is strictly input-only and M04 tool is offline | NOT MEASURED |
| Try a one-mic room sound/earbud candidate-difference inspection later | Only as a **coarse, explicitly approved** nonhuman exploratory screen with an independently safe output setup, clear direct-sound/leakage controls, manual source verification, and recorded limitations; no automatic correlation PASS | EXPLORATORY; no product decision |
| Check actual phone speaker fallback and earbud switching under faults | NOT physically verified; SW3 predicted-route flags are not atomic hardware mute, and phone speaker cannot be presumed silent | HARD SAFETY BLOCK |
| Calibrate bilateral dB SPL / MPO using an ordinary wired or BT microphone | NO: neither has validated ear-coupler transfer/level calibration and fit | HARD SAFETY BLOCK |
| Decide whether daily open-ear face-to-face hearing feels natural | NOT determinable from raw audio profiles, synthetic DSP results, or stereo media latency | UNPROVEN |

**No-purchase branch selection:** Prioritize existing-caption usefulness while holding acoustic output. If the PC has a verified *single common-clock* multichannel input built in, it can be considered for later independent safety-reviewed measurement without a new interface; otherwise stop this branch rather than repeatedly optimizing synthetic DSP or improvising unsynchronized clocks.

## Safe next interaction / minimum evidence to request

One screenshot or plain-text transcription of **Windows Settings → System → Sound → Input** showing both microphone names and the selected wired input's channel/format is sufficient for the next no-purchase decision. Device names may be redacted. This is a capability inventory, NOT a request to buy or play sound. Existing phone-mic and AIR31 field tests should not be repeated.

Do **not** equate a free software recorder, dual microphone devices, a PC line-in, an ordinary recorded video's A/V sync, or headset codec timing with a calibrated microphone-to-ear Bluetooth acoustic measurement. The [M04 offline WAV analyzer](../tools/analyze-m04-acoustic-wav.py) is retained for future qualified evidence, not repurposed to compute an impressive but invalid number from this setup.

**End state:** Current gear inventory can proceed at zero cost; true acoustic E2E latency, left/right MPO and no-speaker-fallback protection remain unverified and still block live hearing output. No mandatory equipment purchase is proposed.
