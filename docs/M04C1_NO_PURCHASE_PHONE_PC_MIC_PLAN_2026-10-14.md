# M04-C1 — Existing phones, PC and microphones only (2026-10-14)

**User constraint (2026-10-14): do not propose purchasing or requiring extra unavailable hardware.** Available/claimed assets: existing Android phone(s), a PC, a **3.5 mm PC-input wired microphone**, and an **AIR31 Bluetooth earbud headset (built-in microphone)**, and a **Taiwan Neon EWM1 Type-C wireless clip-on microphone currently usable only with the phone**. The PC Realtek wired-microphone input has been detected and its level bar responds to speech (functionality PASS); the PC input channel format remains unverified. The EWM1 is not a PC recording device in the present setup. AIR31 remains the preferred *receiver*, not a required microphone. No new equipment, SDK/ODM or external microphone requirement for daily users.

**Decision: NO-GO for live hearing amplification and for claiming a real Bluetooth mic→ear latency value.** This is an equipment-constrained, zero-purchase plan, not authorization for test-tone playback, on-ear output, live audio routing, or procurement. Preserve the [mandatory output protections](./SAFETY.md).

## What can be done now with existing hardware, without playing sound

1. **Completed:** Windows detected **Microphone (Realtek(R) Audio)** from the 3.5-mm jack, and the input level bar responded to speech. Treat this as basic PC wired-input PASS; percentage readout is optional, no retest needed. If a later measurement genuinely requires it, inspect the Realtek input channel/format; do not make device-property screenshots a repeated milestone.
2. No further speech recording is necessary at this decision gate: the wired mic has already shown an active input level. Avoid uploading real speech, guessing dB SPL from dBFS, changing Android hearing playback, or repeating M01/SW1–SW4 checks.
3. Keep roles separate: **Moto g62 built-in mic** = primary HearLens input; **AIR31** = preferred Bluetooth output; **EWM1 phone-connected Type-C receiver** = optional alternative input only, not necessary for the everyday architecture. Comparable Taiwan Neon Type-C wireless mic listings use a dedicated **2.4 GHz transmitter↔USB-C receiver**, not ordinary Bluetooth microphone pairing; exact EWM1 firmware/specification remains unverified. Do not infer that the EWM1 connects to the PC.
4. Any PC-wired-mic and **phone/EWM1** simultaneous captures use independent clocks, offsets and buffering. Do not combine into pseudo-stereo WAV for `tools/analyze-m04-acoustic-wav.py`; that tool requires both physical microphones recorded on one verified common-clock stereo ADC.
5. **AIR31 built-in mic** is a headset profile input (a Classic Bluetooth microphone connection may invoke HFP and change media quality). Do not switch HearLens to AIR31 input or connect AIR31 to the PC for this milestone. EWM1 is separately phone-connected through Type-C and is not evidence of AIR31 Bluetooth microphone timing. See [Microsoft Bluetooth Classic Audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio) and [Taiwan Neon comparable Type-C 2.4-GHz microphone listing](https://24h.pchome.com.tw/prod/DRAF02-A900ENM9P).

## Feasibility of proposed zero-purchase tests

| Goal | Equipment-constrained answer | Evidence label |
|---|---|---|
| Show PC Realtek wired mic is connected and responding | **PASS: Windows input level moves with speech** | Input functionality only, not calibrated |
| Treat phone-only EWM1 and PC Realtek as a synchronized dual-mic capture | **NO**; recordings are produced by separate devices without an established common clock | NOT SYNCHRONIZED |
| Measure actual Moto g62 phone-mic → processing → AIR31 receiver acoustic latency | **NO** until a protected *nonhuman* live path exists; current SW4 is strictly input-only and M04 tool is offline | NOT MEASURED |
| Try a one-mic room sound/earbud candidate-difference inspection later | Only as a **coarse, explicitly approved** nonhuman exploratory screen with an independently safe output setup, clear direct-sound/leakage controls, manual source verification, and recorded limitations; no automatic correlation PASS | EXPLORATORY; no product decision |
| Check actual phone speaker fallback and earbud switching under faults | NOT physically verified; SW3 predicted-route flags are not atomic hardware mute, and phone speaker cannot be presumed silent | HARD SAFETY BLOCK |
| Calibrate bilateral dB SPL / MPO using an ordinary wired or BT microphone | NO: neither has validated ear-coupler transfer/level calibration and fit | HARD SAFETY BLOCK |
| Decide whether daily open-ear face-to-face hearing feels natural | NOT determinable from raw audio profiles, synthetic DSP results, or stereo media latency | UNPROVEN |

**No-purchase branch selection:** Prioritize existing-caption usefulness while holding acoustic output. If the PC has a verified *single common-clock* multichannel input built in, it can be considered for later independent safety-reviewed measurement without a new interface; otherwise stop this branch rather than repeatedly optimizing synthetic DSP or improvising unsynchronized clocks.

## Safe next interaction / minimum evidence to request

The Windows Realtek microphone detection and moving input level bar already close the basic available-PC-microphone check; no further screenshot or numeric percentage is needed. AIR31 should remain paired with the phone for its intended receiver role, and EWM1 may remain phone-only/unused. With the available unsynchronized devices and no approved protected playback, **stop additional acoustic latency trials here** instead of requesting a contrived dual-device measurement. Existing phone-mic and AIR31 field tests should not be repeated.

Do **not** equate a free software recorder, dual microphone devices, a PC line-in, an ordinary recorded video's A/V sync, or headset codec timing with a calibrated microphone-to-ear Bluetooth acoustic measurement. The [M04 offline WAV analyzer](../tools/analyze-m04-acoustic-wav.py) is retained for future qualified evidence, not repurposed to compute an impressive but invalid number from this setup.

**End state:** Current gear inventory can proceed at zero cost; true acoustic E2E latency, left/right MPO and no-speaker-fallback protection remain unverified and still block live hearing output. No mandatory equipment purchase is proposed.
