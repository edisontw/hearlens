# M04-B0 — Software-first exit gate and ear-local platform desk downselect (2026-10-14)

**Decision status:** completed desk evidence review; **NO new hardware purchase, firmware implementation, phone output playback, user field trial or on-ear testing authorized**. The *user-directed* active topology remains **phone builtin mic → phone native DSP → ordinary Bluetooth earbuds for optional output**, with the headset microphone and custom hardware POC deferred. This review is a contingency/exit decision, NOT a reversal of that preference.

## Why this decision now

- M01 captions are complete and independent.
- SW1 (Moto g62 5G) established a 48 kHz mono **phone builtin mic** capture route.
- SW3 field evidence predicted AIR31 A2DP for MEDIA/accessibility but observed **no active playing output** and no physical no-speaker-fallback mute. Android 13 API 33 cannot solve those unknowns via a no-output query.
- SW4 user field evidence [confirmed continuous input sample-clock timestamps](./SW4_MOTO_G62_INPUT_CLOCK_FIELD_RESULT_2026-10-14.md) on that phone, **not** acoustic input latency or receiver output. Twenty of 26 digital-amplitude windows were exact-zero PCM under *uncontrolled ambient input*; no inference about continuous speech sensitivity or vendor DSP is allowed.
- M03 nonlinear CAMFIT and WDRC numerical cross-checks are offline/synthetic; no calibrated acoustic output.
- Therefore an additional Android *passive* route monitor, synthetic gain test or Bluetooth codec/frame-size estimate **cannot determine whether this phone→BT earbud route is useful for face-to-face open-fit daily conversation**.

### Design decision — separate two meanings of “Bluetooth hearing”

**Primary software-first topology S1:** `phone mic → native DSP → Bluetooth A2DP/LE output`. Convenient and permits app PCM processing, but physical OS/Bluetooth latency, directly audible room speech versus delayed sound, speaker reroute safety and acoustic receiver output remain **unknown**. This topology is **CONDITIONAL pending an explicitly approved nonhuman acoustic/route test**; it is not an established low-delay hearing aid architecture. AIR31 being detected does not prove any acoustic property.

**Contingency ear-local topology S3:** `ear-side mic → authorized embedded local DSP → receiver`, while phone Bluetooth is **control/captions**, not the ambient PCM roundtrip. This could address direct/delayed coexistence but cannot be created by generic Android GATT, LE Audio, Bluetooth hearing-aid preset or media EQ APIs on arbitrary consumer earbuds. It requires written device/SDK support and a physical safety bench. **Desk evaluation is permitted; obtaining/using custom hardware is deferred.**

**Fallback:** captions and recent transcript only. Do not require phone placed near the talker, ear sealing, external microphone, or mandatory Bluetooth headset mic.

## October 2026 public evidence and conditional platform disposition

| Platform | Public-source verified capability | Critical missing HearLens capability | Desk disposition (not purchase order) |
|---|---|---|---|
| Existing **AIR31 / other arbitrary A2DP earbuds** | SW3 observed paired A2DP *predicted media route* on Moto g62; ordinary media transport | No documented public third-party API for ear-local ambient microphone → multiband WDRC, calibrated L/R MPO or firmware hard mute; physical output route and latency unmeasured | **STOP** for local-DSP self-fit. Retain as the familiar *S1 receiver candidate for future protected bench only*. |
| **Nordic nRF5340 Audio DK + CS47L63** | Official SDK exposes mic/audio codec configuration and I2S/CS47L63 integration; Nordic staff state PDM-input/I2S-output pieces exist and a **custom local loopback needs audio-flow modification**; 1 mono codec output per board, Nordic recommends ≥2 DKs (often 3 for TWS network experiments) | No public proof of a ready-to-use ultra-low-delay independent-bilateral CAMFIT/WDRC fitting pipeline, calibrated hard limiter, acoustic latency and safe open-ear fit. Requires firmware work and physical gear | **Most directly inspectable conditional firmware research candidate** if hardware POCs are ever approved; **NO-GO now** for automatic adoption or live output. |
| **Tympan Rev F** | Open hearing-aid-oriented Teensy/Arduino library, documented mic→headphone pass-through and gain examples; official Rev F board has 2 onboard MEMS mics and 3.5 mm jack | Physically larger wired bench, not finished wireless TWS consumer form; per-ear real-ear/coupler calibration, hard mute, short open-ear acoustic delay unverified | **Strong algorithm benchmark but procurement-blocked:** official shop lists Rev F **SOLD OUT** as checked 2026-10-14; no assumption of availability. |
| **Qualcomm QCC5181 OEM/ODM** | Official listing has Audio Development Kit toolkit, GAIA Android/iOS client source listings and QACT tools | Access to device-specific SDK/toolchain and ear-local WDRC/ambient path not granted merely by listing, no identified purchasable OEM SKU, firmware interface, L/R calibration and rollback | **Vendor/SDK authorization inquiry only**, not software-integrable without a written license and actual product evidence. |
| **Off-the-shelf manufacturer hearing/ambient modes** | First-party manufacturer applications may support hearing/ambient settings on specific devices | No general third-party arbitrary multi-band local fitting or final acoustic limiter ownership; changing a preset ≠ prescribing gain | **First-party/independent-caption coexistence benchmark** only; never pretend HearLens owns their internal DSP. |

### Evidence anchors — official primary sources

1. [Android AudioTrack.getRoutedDevice / getRoutedDevices](https://developer.android.com/reference/android/media/AudioTrack): requested device is not actual route. `getRoutedDevice` is valid for *active playback*; Android 36 added multi-route `getRoutedDevices`, which is unavailable on the tested Android 13 API33. Even observing a playing route is not an *atomic* guarantee against already queued speaker output.
2. [Nordic nRF5340 Audio DK product](https://www.nordicsemi.com/Products/Development-hardware/nRF5340-Audio-DK/Get-Started): hardware and mono CS47L63 output.
3. [Nordic NCS nRF Audio requirements](https://nrfconnectdocs.nordicsemi.com/ncs/latest/nrf/applications/nrf_audio/doc/requirements.html): 2 DKs for gateway+headset example, 3 for TWS experiment; these are transport/app demos, not hearing fitting proof.
4. [Nordic engineer response to local mic→headphone loopback](https://devzone.nordicsemi.com/f/nordic-q-a/124933/how-to-implement-audio-loopback-mic-headphone-on-nrf5340-audio-dk): application audio-flow modification needed; do not claim already implemented as a verified latency-optimized hearing loop.
5. [Tympan_Library examples](https://github.com/Tympan/Tympan_Library) and [official Rev F shop](https://shop.tympan.org/products/tympan-rev-f) (product listing currently **Sold out**, availability may change).
6. [Qualcomm QCC5181 software/tools](https://www.qualcomm.com/audio/products/qualcomm-s5-series/qcc5181/software): ADK/GAIA/QACT listings are **not** a grant of HearLens OEM firmware access.

Do not infer end-to-end acoustic delay from LC3 7.5/10 ms frames, nRF design marketing, Android buffer timestamps, or app request success. Do not turn public platform capability into a clinical hearing benefit claim.

## Minimal measurable GO / NO-GO for an *authorized future* nonhuman trial

This is a **decision gate, not permission to play anything now**. No device buy, amplifier output, custom firmware flashing or human-ear test proceeds automatically.

**Preconditions (must all be independently documented):**
1. Physical apparatus: synchronized capture of a reference sound near **phone microphone** and **earbud-on-coupler** output; calibrated coupler/measurement mic for both ears and a phone speaker monitor. Record room geometry/acoustic propagation, level, OS build, phone volume, earbuds/firmware profile, radio conditions and audio usage.
2. Protected output path: independently controllable hardware mute/kill, safe low-level nonhuman stimulus, volume/level upper limits on real transducers; **physically establish what happens on Bluetooth drop, output reroute or app failure before any hearing amplifier is connected**. App callbacks/route polling are not a substitute.
3. Test design: 20+ synchronized repeated presentations (illustrative preregistered protocol, not a universal scientific threshold); P50/P95/worst/tail and jitter by device/profile; compare wired control and BT under fixed conditions. Repeat unplug/radio off/call/audio focus/background to check phone speaker leakage. Measure each ear frequency response, max SPL/MPO, route identity and channel swapping separately.
4. Interpret **same-room direct sound plus delayed ear output** in an acoustic open-fit fixture, not only mic→DAC software delay. No universal passing-ms number is asserted here; predeclare a signal-specific acoustic tolerance and hearing-aid-use scenario before a real human test.
5. **STOP** if output reroutes to phone speaker, any channel uncalibrated, hard mute unverified, unexpectedly high level, active route ambiguous, or acoustic delay too large for the declared natural-conversation use case. Fallback remains captions; no auto retry/hearing output.

For detailed protocol, see [SW4 acoustic bench decision](./SW4_ANDROID_INPUT_CLOCK_AND_ACOUSTIC_BENCH_DECISION_2026-10-14.md) and [SAFETY](./SAFETY.md).

## Device/SDK inquiry checklist (only if procurement priority is explicitly reopened)

For one exact hardware revision/firmware/SDK combination, request **written** answers and sample source/config to all:

- Does **local onboard mic → filter/compressor → local DAC** execute without sending ambient PCM to a phone? Specify ADC/DSP/DAC timing and supported local-code path.
- Can third-party firmware or a documented API update **independent L/R 250–8000 Hz bands and 50/65/80 level-dependent gain** without granting unchecked unsafe gain values? Can changes be reverted/atomic?
- Can the developer own or verify **separate ear-level maximum output calibration, hard limiter and fail-closed mute** independently of phone Bluetooth availability?
- What are supported **firmware versions, licensing restrictions, unit price/availability, no-headphones bench tooling, source/compiled artifacts and OTA/rollback**?
- Is there a documented **BLE control-plane** protocol for importing bounded settings without reintroducing ambient PCM roundtrip and without auto-enabling output?
- Are direct-sound leakage, feedback, own-voice and **physical** input-to-ear acoustic latency measured for the *actual* form factor?

Missing answers are **UNKNOWN**, not soft passes. No board is selected as a medically safe HearLens production device.

## Milestone outcome and developer stop condition

- **M04-B0 desk capability shortlist: PASS (documentation only)**.
- **S1 phone-mic→BT everyday natural conversation: NOT YET PROVEN**; blocked by missing physical acoustic route/delay/SPL measurements. Further synthetic DSP tuning or passive route polling will not solve this evidence gap.
- **S3 local programmable ear DSP: conditional fallback, not activated**; no OEM license, device, vendor commitment, fit or acoustic test.
- **SW1, SW3, SW4 field checks remain closed and must not be repeated to fill unrelated M04 output evidence.**
- **NO-GO for real hearing amplification**; continue independently useful M01 caption UI. Do not implement new audio playback before the hardware-dependent safety gate and user approval are revisited.

The most efficient *future* step is one narrowly scoped, physically instrumented **nonhuman** S1 route + latency + SPL bench (using existing Moto/AIR31 as a candidate) **only when the required apparatus and user prioritization are available**. If S1 fails, request licensed S3 ear-local hardware evidence rather than iterating phone DSP to chase unknowable Bluetooth buffering.
